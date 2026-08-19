//! Compact analytic contours for one normalized path-brush sweep.
//!
//! The contour is a construction-time description of the *whole* swept
//! area. It deliberately contains only fitted stroke primitives and true
//! circular arcs; renderer tessellation happens later in
//! `grafting-procgen-surface-mesh`.

use grafting_graph_core::ContourGeometry;

use crate::stroke::{StrokePrimitive, fit_stroke};
use crate::{BrushShape, PathBrushFailure, PathBrushRequest};

/// One closed analytic contour, with one geometry entry for every directed
/// edge from `vertices[index]` to `vertices[(index + 1) % vertices.len()]`.
///
/// This is intentionally independent of graph identities. The construction
/// session assigns stable node and contour-edge ids only after a contour has
/// been accepted as one semantic brush operation.
#[derive(Debug, Clone, PartialEq)]
pub struct AnalyticBrushContour {
    vertices: Vec<[f32; 2]>,
    edge_geometries: Vec<ContourGeometry>,
}

impl AnalyticBrushContour {
    /// Ordered XZ vertices of this closed contour.
    pub fn vertices(&self) -> &[[f32; 2]] {
        &self.vertices
    }

    /// Geometry for each directed boundary edge.
    pub fn edge_geometries(&self) -> &[ContourGeometry] {
        &self.edge_geometries
    }
}

/// Produces an exact compact contour for a point, line, or circular-arc
/// stroke fitted from the complete pointer batch.
///
/// A complex fitted stroke is intentionally rejected here rather than being
/// decomposed into overlapping per-segment regions: the caller must first
/// normalize their union into one non-overlapping area. That explicit
/// boundary prevents the historical micro-fragment regression from being
/// reintroduced through this new API.
pub fn compact_analytic_brush_contour(
    request: &PathBrushRequest,
) -> Result<AnalyticBrushContour, PathBrushFailure> {
    if !request.shape.valid() {
        return Err(PathBrushFailure::InvalidBrush);
    }
    let primitives = fit_stroke(
        &request.samples,
        request.shape.extent() * super::STROKE_FIT_TOLERANCE_FACTOR,
    );
    let [primitive] = primitives.as_slice() else {
        return Err(PathBrushFailure::RequiresNormalizedBrushUnion);
    };
    match (primitive, &request.shape) {
        (StrokePrimitive::Point(center), BrushShape::Circle { radius }) => {
            Ok(circle(*center, *radius))
        }
        (StrokePrimitive::Line { start, end }, BrushShape::Circle { radius }) => {
            Ok(round_line(*start, *end, *radius))
        }
        (
            StrokePrimitive::Arc {
                center,
                radius,
                start_angle,
                sweep_angle,
            },
            BrushShape::Circle {
                radius: brush_radius,
            },
        ) => round_arc(*center, *radius, *start_angle, *sweep_angle, *brush_radius),
        (StrokePrimitive::Point(center), shape) => polygon(shape.footprint(*center)),
        (StrokePrimitive::Line { start, end }, shape) => {
            let mut vertices = shape.footprint(*start);
            vertices.extend(shape.footprint(*end));
            polygon(super::convex_hull(vertices))
        }
        (StrokePrimitive::Arc { .. }, _) => Err(PathBrushFailure::RequiresNormalizedBrushUnion),
    }
}

fn circle(center: [f32; 2], radius: f32) -> AnalyticBrushContour {
    let vertices = [
        [center[0], center[1] + radius],
        [center[0] + radius, center[1]],
        [center[0], center[1] - radius],
        [center[0] - radius, center[1]],
    ]
    .to_vec();
    AnalyticBrushContour {
        vertices,
        edge_geometries: vec![
            ContourGeometry::CircularArc {
                center,
                clockwise: true,
            };
            4
        ],
    }
}

fn round_line(start: [f32; 2], end: [f32; 2], radius: f32) -> AnalyticBrushContour {
    let dx = end[0] - start[0];
    let dz = end[1] - start[1];
    let length = (dx * dx + dz * dz).sqrt();
    if length <= f32::EPSILON {
        return circle(start, radius);
    }
    let normal = [-dz * radius / length, dx * radius / length];
    let start_left = [start[0] + normal[0], start[1] + normal[1]];
    let end_left = [end[0] + normal[0], end[1] + normal[1]];
    let end_right = [end[0] - normal[0], end[1] - normal[1]];
    let start_right = [start[0] - normal[0], start[1] - normal[1]];
    AnalyticBrushContour {
        vertices: vec![start_left, end_left, end_right, start_right],
        edge_geometries: vec![
            ContourGeometry::Line,
            ContourGeometry::CircularArc {
                center: end,
                clockwise: true,
            },
            ContourGeometry::Line,
            ContourGeometry::CircularArc {
                center: start,
                clockwise: true,
            },
        ],
    }
}

fn round_arc(
    center: [f32; 2],
    radius: f32,
    start_angle: f32,
    sweep_angle: f32,
    brush_radius: f32,
) -> Result<AnalyticBrushContour, PathBrushFailure> {
    let inner_radius = radius - brush_radius;
    if inner_radius <= f32::EPSILON || sweep_angle.abs() <= f32::EPSILON {
        return Err(PathBrushFailure::RequiresNormalizedBrushUnion);
    }
    let outer_radius = radius + brush_radius;
    let end_angle = start_angle + sweep_angle;
    let point = |distance: f32, angle: f32| {
        [
            center[0] + distance * angle.cos(),
            center[1] + distance * angle.sin(),
        ]
    };
    let clockwise = sweep_angle < 0.0;
    let cap_clockwise = !clockwise;
    let start = point(radius, start_angle);
    let end = point(radius, end_angle);

    // For a counter-clockwise centre line the left offset is the inner arc;
    // a clockwise centre line reverses that relation.
    let (left_radius, right_radius) = if clockwise {
        (outer_radius, inner_radius)
    } else {
        (inner_radius, outer_radius)
    };
    Ok(AnalyticBrushContour {
        vertices: vec![
            point(left_radius, start_angle),
            point(left_radius, end_angle),
            point(right_radius, end_angle),
            point(right_radius, start_angle),
        ],
        edge_geometries: vec![
            ContourGeometry::CircularArc { center, clockwise },
            ContourGeometry::CircularArc {
                center: end,
                clockwise: cap_clockwise,
            },
            ContourGeometry::CircularArc {
                center,
                clockwise: !clockwise,
            },
            ContourGeometry::CircularArc {
                center: start,
                clockwise: cap_clockwise,
            },
        ],
    })
}

fn polygon(vertices: Vec<[f32; 2]>) -> Result<AnalyticBrushContour, PathBrushFailure> {
    if vertices.len() < 3 {
        return Err(PathBrushFailure::RequiresNormalizedBrushUnion);
    }
    Ok(AnalyticBrushContour {
        edge_geometries: vec![ContourGeometry::Line; vertices.len()],
        vertices,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BrushShape, PathBrushRequest};
    use grafting_graph_core::SurfaceType;

    fn request(samples: Vec<[f32; 2]>, shape: BrushShape) -> PathBrushRequest {
        PathBrushRequest {
            operation_id: "analytic-brush".into(),
            samples,
            shape,
            depth: 1.0,
            source_types: vec![SurfaceType::new("terrain")],
            target_type: SurfaceType::new("path"),
        }
    }

    #[test]
    fn a_dense_straight_circle_stroke_has_four_analytic_edges() {
        let contour = compact_analytic_brush_contour(&request(
            (0..=200).map(|index| [index as f32 * 0.01, 0.0]).collect(),
            BrushShape::Circle { radius: 0.5 },
        ))
        .unwrap();
        assert_eq!(contour.vertices().len(), 4);
        assert_eq!(contour.edge_geometries().len(), 4);
        assert_eq!(
            contour
                .edge_geometries()
                .iter()
                .filter(|geometry| matches!(geometry, ContourGeometry::CircularArc { .. }))
                .count(),
            2
        );
    }

    #[test]
    fn a_fitted_circle_arc_stays_four_analytic_arcs() {
        let contour = compact_analytic_brush_contour(&request(
            (0..=40)
                .map(|index| {
                    let angle = std::f32::consts::FRAC_PI_2 * index as f32 / 40.0;
                    [2.0 * angle.cos(), 2.0 * angle.sin()]
                })
                .collect(),
            BrushShape::Circle { radius: 0.25 },
        ))
        .unwrap();
        assert_eq!(contour.vertices().len(), 4);
        assert!(
            contour
                .edge_geometries()
                .iter()
                .all(|geometry| matches!(geometry, ContourGeometry::CircularArc { .. }))
        );
    }

    #[test]
    fn a_multi_primitive_stroke_requires_union_normalization() {
        let error = compact_analytic_brush_contour(&request(
            vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [2.0, 1.0]],
            BrushShape::Circle { radius: 0.25 },
        ))
        .unwrap_err();
        assert_eq!(error, PathBrushFailure::RequiresNormalizedBrushUnion);
    }
}
