//! Deterministic planning for local construction-surface transformations.
//!
//! This crate owns authoritative brush/surface intersection, contour
//! formation, and merge planning. It never mutates a graph: callers receive
//! one plan for the whole confirmed stroke and apply it themselves.

#![deny(missing_docs)]
#![deny(rustdoc::broken_intra_doc_links)]

mod analytic_brush;
mod stroke;
mod sweep;

use std::error::Error;
use std::fmt;

use grafting_graph_core::SurfaceType;
use stroke::{StrokePrimitive, distance_to_stroke, fit_stroke};

pub use analytic_brush::{
    AnalyticBrushContour, BoundaryVertex, RegionMergePlan, compact_analytic_brush_contour,
    plan_region_merge, polygonal_contour,
};
pub use sweep::{
    SweepFormationFailure, SweepFormationPlan, SweepFormationRequest, TransverseProfilePoint,
    plan_sweep_formation,
};

const CIRCLE_SEGMENTS: usize = 16;
const STROKE_FIT_TOLERANCE_FACTOR: f32 = 0.1;
const ARC_SWEEP_ERROR_FACTOR: f32 = 0.02;

/// Renderer-neutral convex brush footprint shared by surface and terrain tools.
#[derive(Debug, Clone, PartialEq)]
pub enum BrushShape {
    /// A circular footprint approximated deterministically for graph clipping.
    Circle {
        /// World-space radius.
        radius: f32,
    },
    /// A rotated square footprint.
    Square {
        /// Full world-space side length.
        size: f32,
        /// Rotation around world Y in radians.
        rotation_radians: f32,
    },
    /// A rotated regular hexagonal footprint.
    Hexagon {
        /// World-space circumradius.
        radius: f32,
        /// Rotation around world Y in radians.
        rotation_radians: f32,
    },
}

impl BrushShape {
    fn valid(&self) -> bool {
        match self {
            Self::Circle { radius } => radius.is_finite() && *radius > 0.0,
            Self::Square {
                size,
                rotation_radians,
            } => size.is_finite() && *size > 0.0 && rotation_radians.is_finite(),
            Self::Hexagon {
                radius,
                rotation_radians,
            } => radius.is_finite() && *radius > 0.0 && rotation_radians.is_finite(),
        }
    }

    fn extent(&self) -> f32 {
        match self {
            Self::Circle { radius } | Self::Hexagon { radius, .. } => *radius,
            Self::Square { size, .. } => *size * 0.5,
        }
    }

    fn footprint(&self, center: [f32; 2]) -> Vec<[f32; 2]> {
        match self {
            Self::Circle { radius } => regular_polygon(center, *radius, CIRCLE_SEGMENTS, 0.0),
            Self::Square {
                size,
                rotation_radians,
            } => regular_polygon(
                center,
                *size / 2.0_f32.sqrt(),
                4,
                *rotation_radians + std::f32::consts::FRAC_PI_4,
            ),
            Self::Hexagon {
                radius,
                rotation_radians,
            } => regular_polygon(center, *radius, 6, *rotation_radians),
        }
    }
}
/// One convex brush stroke resolved in construction-world XZ space.
#[derive(Debug, Clone, PartialEq)]
pub struct PathBrushRequest {
    /// Caller-stable identity used to make introduced graph IDs deterministic.
    pub operation_id: String,
    /// Ordered pointer samples forming the confirmed stroke.
    pub samples: Vec<[f32; 2]>,
    /// Convex footprint applied at every resampled stroke point.
    pub shape: BrushShape,
    /// Maximum downward displacement at the path centre line.
    pub depth: f32,
    /// Source types eligible for local replacement in the same atomic stroke.
    pub source_types: Vec<SurfaceType>,
    /// Type assigned to the painted local region.
    pub target_type: SurfaceType,
}

/// Failure while building a path-brush replacement plan.
#[derive(Debug, Clone, PartialEq)]
pub enum PathBrushFailure {
    /// Samples, shape, or depth are missing, non-finite, or not positive where required.
    InvalidBrush,
    /// The request identity could not become a graph identifier.
    InvalidOperationId,
    /// A stroke needs full planar union normalization before it can be
    /// represented as one non-overlapping analytic contour.
    RequiresNormalizedBrushUnion,
    /// No source surface had a semantic delta, so no operation may be committed.
    NoChanges,
}

impl fmt::Display for PathBrushFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBrush => formatter.write_str(
                "path brush requires finite samples, a valid brush shape, and finite positive depth",
            ),
            Self::InvalidOperationId => formatter
                .write_str("path brush operation identity cannot form deterministic graph IDs"),
            Self::RequiresNormalizedBrushUnion => formatter.write_str(
                "path brush requires union normalization before its analytic contour can be committed",
            ),
            Self::NoChanges => formatter.write_str("path brush produced no semantic change"),
        }
    }
}

impl Error for PathBrushFailure {}

/// Validates a path-brush request's own scalar/geometric fields (operation
/// identity, samples, shape, depth) -- the path-specific checks
/// `plan_region_merge` itself has no reason to know about, since it takes
/// an already-built contour and a plain eligibility predicate, not a
/// `PathBrushRequest`. A caller building a path-brush stroke on top of that
/// generic planner calls this first.
pub fn validate_request(request: &PathBrushRequest) -> Result<(), PathBrushFailure> {
    if request.operation_id.is_empty() {
        return Err(PathBrushFailure::InvalidOperationId);
    }
    if request.samples.is_empty()
        || request
            .samples
            .iter()
            .flatten()
            .any(|coordinate| !coordinate.is_finite())
        || !request.shape.valid()
        || !request.depth.is_finite()
        || request.depth <= 0.0
    {
        return Err(PathBrushFailure::InvalidBrush);
    }
    Ok(())
}

fn regular_polygon(
    center: [f32; 2],
    radius: f32,
    segments: usize,
    rotation_radians: f32,
) -> Vec<[f32; 2]> {
    (0..segments)
        .map(|index| {
            let angle = rotation_radians + std::f32::consts::TAU * index as f32 / segments as f32;
            [
                center[0] + radius * angle.cos(),
                center[1] + radius * angle.sin(),
            ]
        })
        .collect()
}

fn point_in_footprint(point: [f32; 2], footprint: &[[f32; 2]]) -> bool {
    footprint.iter().enumerate().all(|(index, start)| {
        let end = footprint[(index + 1) % footprint.len()];
        (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0])
            >= -0.000_01
    })
}

/// Returns whether `point` lies in the continuous sweep of `shape` over `samples`.
///
/// This is the shared authoritative footprint query used by terrain-cell
/// generation and surface transformations, so both tools interpret brush
/// shape, rotation, and gaps between pointer samples identically.
pub fn swept_brush_contains(shape: &BrushShape, samples: &[[f32; 2]], point: [f32; 2]) -> bool {
    if samples.is_empty() || !shape.valid() || point.iter().any(|value| !value.is_finite()) {
        return false;
    }
    let (regions, primitives) = compact_sweep(shape, samples);
    stroke_contains_point(shape, &regions, &primitives, point)
}

fn compact_sweep(
    shape: &BrushShape,
    samples: &[[f32; 2]],
) -> (Vec<Vec<[f32; 2]>>, Vec<StrokePrimitive>) {
    let primitives = fit_stroke(samples, shape.extent() * STROKE_FIT_TOLERANCE_FACTOR);
    let mut regions = Vec::new();

    for primitive in &primitives {
        let centers = primitive.tessellated_centers(shape.extent() * ARC_SWEEP_ERROR_FACTOR);
        if centers.len() == 1 {
            regions.push(shape.footprint(centers[0]));
            continue;
        }
        for pair in centers.windows(2) {
            let mut vertices = shape.footprint(pair[0]);
            vertices.extend(shape.footprint(pair[1]));
            regions.push(convex_hull(vertices));
        }
    }

    (regions, primitives)
}

fn stroke_contains_point(
    shape: &BrushShape,
    regions: &[Vec<[f32; 2]>],
    primitives: &[StrokePrimitive],
    point: [f32; 2],
) -> bool {
    match shape {
        BrushShape::Circle { radius } => distance_to_stroke(primitives, point) <= *radius,
        BrushShape::Square { .. } | BrushShape::Hexagon { .. } => regions
            .iter()
            .any(|region| point_in_footprint(point, region)),
    }
}

fn convex_hull(mut points: Vec<[f32; 2]>) -> Vec<[f32; 2]> {
    points.sort_by(|left, right| {
        left[0]
            .total_cmp(&right[0])
            .then_with(|| left[1].total_cmp(&right[1]))
    });
    points.dedup_by(|left, right| distance_sq(*left, *right) <= 0.000_000_1);
    if points.len() <= 3 {
        return points;
    }

    let cross = |origin: [f32; 2], first: [f32; 2], second: [f32; 2]| {
        (first[0] - origin[0]) * (second[1] - origin[1])
            - (first[1] - origin[1]) * (second[0] - origin[0])
    };
    let mut lower = Vec::new();
    for point in &points {
        while lower.len() >= 2
            && cross(lower[lower.len() - 2], lower[lower.len() - 1], *point) <= 0.000_01
        {
            lower.pop();
        }
        lower.push(*point);
    }
    let mut upper = Vec::new();
    for point in points.iter().rev() {
        while upper.len() >= 2
            && cross(upper[upper.len() - 2], upper[upper.len() - 1], *point) <= 0.000_01
        {
            upper.pop();
        }
        upper.push(*point);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

fn distance_sq(left: [f32; 2], right: [f32; 2]) -> f32 {
    let dx = left[0] - right[0];
    let dz = left[1] - right[1];
    dx * dx + dz * dz
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(samples: Vec<[f32; 2]>, radius: f32) -> PathBrushRequest {
        PathBrushRequest {
            operation_id: "stroke".into(),
            samples,
            shape: BrushShape::Circle { radius },
            depth: 0.2,
            source_types: vec![SurfaceType::new("terrain")],
            target_type: SurfaceType::new("path"),
        }
    }

    #[test]
    fn shared_sweep_query_closes_gaps_between_sparse_samples() {
        let shape = BrushShape::Hexagon {
            radius: 0.4,
            rotation_radians: 0.0,
        };
        assert!(swept_brush_contains(
            &shape,
            &[[0.0, 0.0], [4.0, 0.0]],
            [2.0, 0.0]
        ));
        assert!(!swept_brush_contains(
            &shape,
            &[[0.0, 0.0], [4.0, 0.0]],
            [2.0, 1.0]
        ));
    }

    #[test]
    fn rejects_an_empty_stroke() {
        assert_eq!(
            validate_request(&request(Vec::new(), 1.0)).unwrap_err(),
            PathBrushFailure::InvalidBrush
        );
    }

    #[test]
    fn rejects_a_non_positive_radius() {
        assert_eq!(
            validate_request(&request(vec![[0.0, 0.0], [1.0, 0.0]], 0.0)).unwrap_err(),
            PathBrushFailure::InvalidBrush
        );
    }

    #[test]
    fn accepts_a_real_stroke() {
        assert!(validate_request(&request(vec![[0.0, 0.0], [1.0, 0.0]], 0.5)).is_ok());
    }

    #[test]
    fn accepts_a_stroke_that_starts_without_any_source_surface() {
        let mut request = request(vec![[0.0, 0.0], [1.0, 0.0]], 0.5);
        request.source_types.clear();
        assert!(validate_request(&request).is_ok());
    }
}
