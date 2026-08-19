//! Compact analytic contours for one normalized path-brush sweep.
//!
//! The contour is a construction-time description of the *whole* swept
//! area. It deliberately contains only fitted stroke primitives and true
//! circular arcs; renderer tessellation happens later in
//! `grafting-procgen-surface-mesh`.

use std::collections::BTreeMap;

use grafting_graph_core::ContourGeometry;
use grafting_graph_core::{ContourEdge, ContourEdgeId, Graph, NodeId, SurfaceKey, SurfaceRegistry, SurfaceType};

use crate::stroke::{StrokePrimitive, fit_stroke};
use crate::{BrushShape, PathBrushFailure, PathBrushRequest};

/// Precision for [`contour_polygon`]'s own point-in-region tests -- not a
/// rendering tolerance (real tessellation for display happens later, from
/// the true analytic edges, in `grafting-procgen-surface-mesh`), just fine
/// enough that a spatial eligibility check never misjudges a corner sitting
/// close to a curved edge.
const CONTOUR_POLYGON_TOLERANCE: f32 = 0.05;

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

/// One region-overlay merge plan: which existing surfaces a new region's
/// contour destroys, their cancelled exterior boundaries (what a leftover
/// remainder region must carry as its own hole), and the contour itself.
///
/// Nothing here is specific to any one tool. A path-brush stroke, a future
/// wall opening, or anything else that overlays one new closed shape onto
/// the current graph and destroys whatever it covers can reuse this
/// unchanged -- see [`plan_region_merge`].
#[derive(Debug, Clone, PartialEq)]
pub struct RegionMergePlan {
    consumed_surface_keys: Vec<SurfaceKey>,
    consumed_boundaries: Vec<Vec<NodeId>>,
    contour: AnalyticBrushContour,
}

impl RegionMergePlan {
    /// Existing surfaces the new contour destroys.
    pub fn consumed_surface_keys(&self) -> &[SurfaceKey] {
        &self.consumed_surface_keys
    }

    /// Closed exterior boundaries after shared edges among consumed surfaces cancel.
    pub fn consumed_boundaries(&self) -> &[Vec<NodeId>] {
        &self.consumed_boundaries
    }

    /// The new region's own contour, unchanged from what the caller built.
    pub fn contour(&self) -> &AnalyticBrushContour {
        &self.contour
    }
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

/// Produces one compact contour for the complete pointer batch.
///
/// Consecutive fitted primitives become one continuous tube with round joins
/// and caps. The result is never a list of overlapping per-segment
/// footprints, so a dense gesture has no more topology than its fitted
/// lines/arcs require.
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
    if primitives.len() != 1 {
        return union_stroke_footprint(&primitives, &request.shape);
    }
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
        // A single arc primitive with a non-circle brush used to be the one
        // case this whole module gave up on outright. It's really no
        // different from any other multi-segment case -- fall into the same
        // union path.
        (StrokePrimitive::Arc { .. }, shape) => union_stroke_footprint(&primitives, shape),
    }
}

/// Precision for [`tessellate_primitive`]'s own arc subdivision -- coarser
/// than rendering quality is fine, since [`union_stroke_footprint`]'s output
/// is already a faceted (straight-edge) polygon, not a true-arc contour.
const UNION_STROKE_TOLERANCE_FACTOR: f32 = 0.1;

/// Builds one compact contour for a stroke whose fitted primitives can't be
/// joined edge-to-edge into one non-self-overlapping analytic loop (a path
/// that curves back over itself, most commonly -- the exact case
/// `PathBrushFailure::RequiresNormalizedBrushUnion` used to just refuse).
///
/// The committed result of *any* brush stroke is always one single region
/// bounded by the outer silhouette of everywhere the brush passed over --
/// like painting overlapping circles that merge into one blob, never a
/// stitched trace of each individual segment. So instead of trying to
/// offset-and-join each primitive into a single loop (which cannot
/// represent self-overlap at all), this walks the stroke's own centerline,
/// builds one footprint polygon per consecutive point pair (the same
/// `shape.footprint(..)` + convex-hull recipe the single-line-primitive
/// case above already uses, just applied to the whole path), and takes
/// their real boolean union (`i_overlay`) -- which handles overlap by
/// construction, for any brush shape, without a special case per shape.
///
/// This trades true-arc fidelity (what a single fitted primitive still
/// gets) for a faceted result -- an acceptable cost only paid once a stroke
/// is already more complex than one clean primitive.
fn union_stroke_footprint(
    primitives: &[StrokePrimitive],
    shape: &BrushShape,
) -> Result<AnalyticBrushContour, PathBrushFailure> {
    use i_overlay::core::fill_rule::FillRule;
    use i_overlay::float::simplify::SimplifyShape;

    let tolerance = shape.extent() * UNION_STROKE_TOLERANCE_FACTOR;
    let centerline: Vec<[f32; 2]> = primitives
        .iter()
        .flat_map(|primitive| tessellate_primitive(primitive, tolerance))
        .collect();
    let Some(&first) = centerline.first() else {
        return Err(PathBrushFailure::RequiresNormalizedBrushUnion);
    };
    if centerline.len() < 2 {
        return polygon(shape.footprint(first));
    }

    let segment_footprints: Vec<Vec<[f32; 2]>> = centerline
        .windows(2)
        .map(|pair| {
            let mut vertices = shape.footprint(pair[0]);
            vertices.extend(shape.footprint(pair[1]));
            super::convex_hull(vertices)
        })
        .collect();

    let union = segment_footprints.simplify_shape(FillRule::NonZero);
    let outer = union
        .into_iter()
        .next()
        .and_then(|shape| shape.into_iter().next())
        .ok_or(PathBrushFailure::RequiresNormalizedBrushUnion)?;
    polygon(outer)
}

/// A dense centerline polyline for one fitted primitive -- feeds
/// [`union_stroke_footprint`]'s own per-segment footprint construction, not
/// a rendering tessellation (see that function's own doc for why a faceted
/// result is the accepted tradeoff here).
fn tessellate_primitive(primitive: &StrokePrimitive, tolerance: f32) -> Vec<[f32; 2]> {
    match *primitive {
        StrokePrimitive::Point(point) => vec![point],
        StrokePrimitive::Line { start, end } => vec![start, end],
        StrokePrimitive::Arc {
            center,
            radius,
            start_angle,
            sweep_angle,
        } => {
            let radius = radius.max(f32::EPSILON);
            let tolerance = tolerance.max(f32::EPSILON).min(radius);
            let max_step = 2.0 * (1.0 - tolerance / radius).clamp(-1.0, 1.0).acos();
            let steps = (sweep_angle.abs() / max_step.max(f32::EPSILON)).ceil().max(1.0) as usize;
            (0..=steps)
                .map(|index| {
                    let angle = start_angle + sweep_angle * (index as f32 / steps as f32);
                    [center[0] + radius * angle.cos(), center[1] + radius * angle.sin()]
                })
                .collect()
        }
    }
}

/// Tessellates one closed contour into a flat XZ polygon -- good enough for
/// this module's own point-in-region spatial tests, not rendering quality
/// (real tessellation for display happens later, from the true analytic
/// edges, in `grafting-procgen-surface-mesh`). Reuses `ContourEdge`'s own
/// tessellation math via throwaway node identities that are never touched
/// or inserted into any graph -- only its geometry math is used.
fn contour_polygon(contour: &AnalyticBrushContour, tolerance: f32) -> Vec<[f32; 2]> {
    let vertices = contour.vertices();
    let scratch_start = NodeId::new("region-merge-tessellate-a").expect("static id is valid");
    let scratch_end = NodeId::new("region-merge-tessellate-b").expect("static id is valid");
    let scratch_id = ContourEdgeId::new("region-merge-tessellate").expect("static id is valid");
    let mut polygon = Vec::new();
    for (index, geometry) in contour.edge_geometries().iter().copied().enumerate() {
        let from = vertices[index];
        let to = vertices[(index + 1) % vertices.len()];
        let edge = ContourEdge::new(scratch_id.clone(), scratch_start.clone(), scratch_end.clone(), geometry);
        let mut points = edge.tessellate(from, to, tolerance);
        points.pop(); // shared with the next edge's own start vertex
        polygon.extend(points);
    }
    polygon
}

/// Standard even-odd ray-casting point-in-polygon test on the XZ plane --
/// used only to decide whether a point lands inside a candidate surface's
/// own interior, or a candidate surface's corner lands inside the new
/// contour (see [`plan_region_merge`]'s own spatial-eligibility filter);
/// not exact on the polygon's own boundary, which is fine here since a
/// boundary-straddling point is already caught by the corner-in-contour
/// half of that same filter.
fn polygon_contains_point(polygon: &[[f32; 2]], point: [f32; 2]) -> bool {
    let mut inside = false;
    let mut previous = match polygon.last() {
        Some(vertex) => *vertex,
        None => return false,
    };
    for &current in polygon {
        let straddles = (current[1] > point[1]) != (previous[1] > point[1]);
        if straddles {
            let x_intersect = current[0]
                + (point[1] - current[1]) / (previous[1] - current[1]) * (previous[0] - current[0]);
            if point[0] < x_intersect {
                inside = !inside;
            }
        }
        previous = current;
    }
    inside
}

/// Plans destroying-and-rebuilding whatever existing surfaces a new
/// region's `contour` touches.
///
/// Generic across what counts as eligible to be consumed (`is_eligible`,
/// tested against each candidate's own `SurfaceType`; a caller wanting no
/// restriction at all passes `|_| true`) and knows nothing about what kind
/// of structure produced `contour` -- a path-brush stroke, a future wall
/// opening, or anything else. Never mutates the graph.
///
/// A candidate counts as touched either way a shape can overlap a face
/// without crossing the other's own vertices: a corner landing inside the
/// new contour, or the contour's own boundary passing through the
/// candidate's interior (cutting straight through the middle of a face
/// touches no corner at all). This step then cancels interior shared edges
/// among every touched candidate once and keeps only the exterior loops,
/// the prerequisite for a caller replacing an entire consumed patch with
/// one region-with-a-hole instead of emitting a fragment for every
/// original face.
pub fn plan_region_merge(
    graph: &Graph<[f32; 3], ()>,
    surfaces: &SurfaceRegistry,
    contour: AnalyticBrushContour,
    is_eligible: impl Fn(&SurfaceType) -> bool,
) -> Result<RegionMergePlan, PathBrushFailure> {
    let boundary_polygon = contour_polygon(&contour, CONTOUR_POLYGON_TOLERANCE);

    let consumed_surface_keys = surfaces
        .surface_keys()
        .into_iter()
        .filter(|key| {
            surfaces.surface(key).is_some_and(|surface| {
                if !is_eligible(surface.surface_type()) {
                    return false;
                }
                let mut positions = Vec::with_capacity(surface.cycle().len());
                for node_id in surface.cycle() {
                    match graph.node(node_id) {
                        Some(node) => {
                            let position = node.data();
                            positions.push([position[0], position[2]]);
                        }
                        // A missing node makes this surface invalid regardless
                        // of location -- stay eligible so the boundary-edge
                        // pass below still reports `InvalidSourceSurface` for
                        // it, instead of this spatial filter silently hiding
                        // that error.
                        None => return true,
                    }
                }
                positions
                    .iter()
                    .any(|&position| polygon_contains_point(&boundary_polygon, position))
                    || boundary_polygon
                        .iter()
                        .any(|&vertex| polygon_contains_point(&positions, vertex))
            })
        })
        .collect::<Vec<_>>();
    // A new region can be planned with nothing eligible underneath it at
    // all -- a structure doesn't need pre-existing material to consume
    // just to be drawn. `consumed_surface_keys` (and therefore `boundaries`
    // below) staying empty is the ordinary, valid "nothing to consume"
    // case, not a failure.
    let mut edges = BTreeMap::<(NodeId, NodeId), (NodeId, NodeId)>::new();
    for key in &consumed_surface_keys {
        let surface = surfaces
            .surface(key)
            .expect("surface keys came from the same registry");
        if surface.cycle().len() < 3
            || surface
                .cycle()
                .iter()
                .any(|node_id| graph.node(node_id).is_none())
        {
            return Err(PathBrushFailure::InvalidSourceSurface { key: key.clone() });
        }
        for (start, end) in surface
            .cycle()
            .iter()
            .cloned()
            .zip(surface.cycle().iter().cloned().cycle().skip(1))
            .take(surface.cycle().len())
        {
            let key = if start <= end {
                (start.clone(), end.clone())
            } else {
                (end.clone(), start.clone())
            };
            if edges.remove(&key).is_none() {
                edges.insert(key, (start, end));
            }
        }
    }

    let mut boundaries = Vec::new();
    while let Some((_, (start, first_end))) = edges.pop_first() {
        let mut boundary = vec![start.clone()];
        let mut current = first_end;
        while current != start {
            boundary.push(current.clone());
            let next = edges.iter().find_map(|(key, (left, right))| {
                if left == &current {
                    Some((key.clone(), right.clone()))
                } else if right == &current {
                    Some((key.clone(), left.clone()))
                } else {
                    None
                }
            });
            let Some((key, following)) = next else {
                return Err(PathBrushFailure::RequiresNormalizedBrushUnion);
            };
            edges.remove(&key);
            current = following;
        }
        if boundary.len() >= 3 {
            boundaries.push(boundary);
        }
    }
    Ok(RegionMergePlan {
        consumed_surface_keys,
        consumed_boundaries: boundaries,
        contour,
    })
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

    /// A multi-segment stroke that turns (never overlapping itself) goes
    /// through the same union path as a self-overlapping one -- the
    /// committed shape is always the outer silhouette of the whole swept
    /// area, not a stitched per-segment trace, so this only checks the
    /// general contract (closed, faceted, non-degenerate), not an exact
    /// vertex count tied to one specific offset-and-join algorithm.
    #[test]
    fn a_multi_primitive_stroke_is_one_joined_contour() {
        let contour = compact_analytic_brush_contour(&request(
            vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [2.0, 1.0]],
            BrushShape::Circle { radius: 0.25 },
        ))
        .unwrap();
        assert_eq!(contour.vertices().len(), contour.edge_geometries().len());
        assert!(contour.vertices().len() >= 8);
        assert!(
            contour
                .edge_geometries()
                .iter()
                .all(|geometry| matches!(geometry, ContourGeometry::Line)),
            "a union result is always faceted, never a true analytic arc"
        );
    }

    /// The exact bug report this fix addresses: a stroke that loops back
    /// over itself (like drawing a circle with the brush, sample by sample)
    /// used to fail outright with `RequiresNormalizedBrushUnion`, because
    /// the old offset-and-join algorithm cannot represent a self-overlapping
    /// tube as one simple loop. The committed area is always just one
    /// region -- the outer silhouette of everywhere the brush passed over --
    /// so this must succeed exactly like any other stroke.
    #[test]
    fn a_self_overlapping_loop_stroke_commits_as_one_region() {
        let loop_samples: Vec<[f32; 2]> = (0..=32)
            .map(|index| {
                let angle = std::f32::consts::TAU * index as f32 / 32.0;
                [2.0 * angle.cos(), 2.0 * angle.sin()]
            })
            .collect();
        let contour = compact_analytic_brush_contour(&request(
            loop_samples,
            BrushShape::Circle { radius: 0.5 },
        ))
        .unwrap();
        assert!(contour.vertices().len() >= 3);
        assert_eq!(contour.vertices().len(), contour.edge_geometries().len());
    }

    /// The union path is generic across brush shape -- a square or hexagon
    /// brush drawing a multi-segment stroke used to fail unconditionally
    /// (`round_stroke` only ever existed for circles); it must work exactly
    /// the same as a circle brush now.
    #[test]
    fn a_multi_segment_stroke_commits_with_a_square_brush() {
        let contour = compact_analytic_brush_contour(&request(
            vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [2.0, 1.0]],
            BrushShape::Square {
                size: 0.5,
                rotation_radians: 0.0,
            },
        ))
        .unwrap();
        assert!(contour.vertices().len() >= 4);
        assert_eq!(contour.vertices().len(), contour.edge_geometries().len());
    }

    /// A single arc primitive with a non-circle brush used to be an
    /// unconditional failure too, independent of self-overlap. It now falls
    /// into the same generic union path as any other multi-segment stroke.
    #[test]
    fn a_single_arc_primitive_commits_with_a_hexagon_brush() {
        let arc_samples: Vec<[f32; 2]> = (0..=20)
            .map(|index| {
                let angle = std::f32::consts::FRAC_PI_2 * index as f32 / 20.0;
                [2.0 * angle.cos(), 2.0 * angle.sin()]
            })
            .collect();
        let contour = compact_analytic_brush_contour(&request(
            arc_samples,
            BrushShape::Hexagon {
                radius: 0.3,
                rotation_radians: 0.0,
            },
        ))
        .unwrap();
        assert!(contour.vertices().len() >= 3);
        assert_eq!(contour.vertices().len(), contour.edge_geometries().len());
    }

    #[test]
    fn terrain_faces_collapse_to_their_outer_boundary_once() {
        use grafting_graph_core::{Graph, Node, SurfaceRegistry};

        let graph = Graph::try_from_parts(
            vec![
                Node::new(NodeId::new("a").unwrap(), [0.0, 0.0, 0.0]),
                Node::new(NodeId::new("b").unwrap(), [1.0, 0.0, 0.0]),
                Node::new(NodeId::new("c").unwrap(), [2.0, 0.0, 0.0]),
                Node::new(NodeId::new("d").unwrap(), [0.0, 0.0, 1.0]),
                Node::new(NodeId::new("e").unwrap(), [1.0, 0.0, 1.0]),
                Node::new(NodeId::new("f").unwrap(), [2.0, 0.0, 1.0]),
            ],
            vec![],
        )
        .unwrap();
        let mut surfaces = SurfaceRegistry::new();
        for cycle in [vec!["a", "b", "e", "d"], vec!["b", "c", "f", "e"]] {
            surfaces
                .add_surface(
                    &graph,
                    cycle
                        .into_iter()
                        .map(|id| NodeId::new(id).unwrap())
                        .collect(),
                    SurfaceType::new("terrain"),
                    true,
                )
                .unwrap();
        }
        let contour = compact_analytic_brush_contour(&request(
            vec![[0.25, 0.5], [1.75, 0.5]],
            BrushShape::Circle { radius: 0.1 },
        ))
        .unwrap();
        let plan = plan_region_merge(&graph, &surfaces, contour, |surface_type| {
            surface_type == &SurfaceType::new("terrain")
        })
        .unwrap();
        assert_eq!(plan.consumed_surface_keys().len(), 2);
        assert_eq!(plan.consumed_boundaries().len(), 1);
        assert_eq!(plan.consumed_boundaries()[0].len(), 6);
    }

    /// A same-typed surface far from the stroke must never become a source --
    /// this is the exact bug report: painting a path anywhere used to swallow
    /// *every* terrain surface on the whole table into one region, since the
    /// old filter only checked `surface_type`, never location.
    #[test]
    fn a_terrain_face_far_from_the_stroke_is_left_out_of_the_plan() {
        use grafting_graph_core::{Graph, Node, SurfaceRegistry};

        let graph = Graph::try_from_parts(
            vec![
                Node::new(NodeId::new("a").unwrap(), [0.0, 0.0, 0.0]),
                Node::new(NodeId::new("b").unwrap(), [1.0, 0.0, 0.0]),
                Node::new(NodeId::new("c").unwrap(), [1.0, 0.0, 1.0]),
                Node::new(NodeId::new("d").unwrap(), [0.0, 0.0, 1.0]),
                Node::new(NodeId::new("p").unwrap(), [1000.0, 0.0, 1000.0]),
                Node::new(NodeId::new("q").unwrap(), [1001.0, 0.0, 1000.0]),
                Node::new(NodeId::new("r").unwrap(), [1001.0, 0.0, 1001.0]),
                Node::new(NodeId::new("s").unwrap(), [1000.0, 0.0, 1001.0]),
            ],
            vec![],
        )
        .unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let near_key = surfaces
            .add_surface(
                &graph,
                ["a", "b", "c", "d"]
                    .into_iter()
                    .map(|id| NodeId::new(id).unwrap())
                    .collect(),
                SurfaceType::new("terrain"),
                true,
            )
            .unwrap();
        let far_key = surfaces
            .add_surface(
                &graph,
                ["p", "q", "r", "s"]
                    .into_iter()
                    .map(|id| NodeId::new(id).unwrap())
                    .collect(),
                SurfaceType::new("terrain"),
                true,
            )
            .unwrap();

        let contour = compact_analytic_brush_contour(&request(
            vec![[0.25, 0.5], [0.75, 0.5]],
            BrushShape::Circle { radius: 0.1 },
        ))
        .unwrap();
        let plan = plan_region_merge(&graph, &surfaces, contour, |surface_type| {
            surface_type == &SurfaceType::new("terrain")
        })
        .unwrap();

        assert_eq!(plan.consumed_surface_keys(), &[near_key]);
        assert!(!plan.consumed_surface_keys().contains(&far_key));
    }

    /// `plan_region_merge` knows nothing about "path" -- it takes whatever
    /// eligibility predicate the caller hands it. A predicate matching a
    /// completely different type (or, per the next test, no type at all)
    /// must work exactly the same as the terrain-only tests above.
    #[test]
    fn eligibility_is_the_callers_predicate_not_a_hardcoded_surface_type() {
        use grafting_graph_core::{Graph, Node, SurfaceRegistry};

        let graph = Graph::try_from_parts(
            vec![
                Node::new(NodeId::new("a").unwrap(), [0.0, 0.0, 0.0]),
                Node::new(NodeId::new("b").unwrap(), [1.0, 0.0, 0.0]),
                Node::new(NodeId::new("c").unwrap(), [1.0, 0.0, 1.0]),
                Node::new(NodeId::new("d").unwrap(), [0.0, 0.0, 1.0]),
            ],
            vec![],
        )
        .unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let key = surfaces
            .add_surface(
                &graph,
                ["a", "b", "c", "d"]
                    .into_iter()
                    .map(|id| NodeId::new(id).unwrap())
                    .collect(),
                SurfaceType::new("roof"),
                true,
            )
            .unwrap();

        let contour = compact_analytic_brush_contour(&request(
            vec![[0.25, 0.5], [0.75, 0.5]],
            BrushShape::Circle { radius: 0.1 },
        ))
        .unwrap();

        let excluded = plan_region_merge(&graph, &surfaces, contour.clone(), |surface_type| {
            surface_type == &SurfaceType::new("terrain")
        })
        .unwrap();
        assert!(excluded.consumed_surface_keys().is_empty());

        let included = plan_region_merge(&graph, &surfaces, contour, |_| true).unwrap();
        assert_eq!(included.consumed_surface_keys(), &[key]);
    }

    /// A path is a structure like any other -- it must be plannable with no
    /// eligible terrain underneath it at all, the same way terrain
    /// generation doesn't require anything pre-existing either. This used to
    /// fail outright (`PathBrushFailure::NoChanges`) whenever there was
    /// nothing to consume, treating "no terrain here" as an error instead of
    /// the ordinary case it is.
    #[test]
    fn a_stroke_with_no_terrain_underneath_still_plans_a_target_only_contour() {
        use grafting_graph_core::{Graph, SurfaceRegistry};

        let graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let surfaces = SurfaceRegistry::new();

        let contour = compact_analytic_brush_contour(&request(
            vec![[0.0, 0.0], [1.0, 0.0]],
            BrushShape::Circle { radius: 0.25 },
        ))
        .unwrap();
        let plan = plan_region_merge(&graph, &surfaces, contour, |surface_type| {
            surface_type == &SurfaceType::new("terrain")
        })
        .unwrap();

        assert!(plan.consumed_surface_keys().is_empty());
        assert!(plan.consumed_boundaries().is_empty());
        assert!(!plan.contour().vertices().is_empty());
    }
}
