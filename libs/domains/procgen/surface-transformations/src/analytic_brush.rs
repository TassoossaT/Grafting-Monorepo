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
        return match &request.shape {
            BrushShape::Circle { radius } => round_stroke(&primitives, *radius),
            _ => Err(PathBrushFailure::RequiresNormalizedBrushUnion),
        };
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
        (StrokePrimitive::Arc { .. }, _) => Err(PathBrushFailure::RequiresNormalizedBrushUnion),
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

#[derive(Clone, Copy)]
struct OffsetPrimitive {
    left_start: [f32; 2],
    left_end: [f32; 2],
    right_start: [f32; 2],
    right_end: [f32; 2],
    left_geometry: ContourGeometry,
    right_geometry: ContourGeometry,
    start: [f32; 2],
    end: [f32; 2],
    start_tangent: [f32; 2],
    end_tangent: [f32; 2],
}

fn round_stroke(
    primitives: &[StrokePrimitive],
    brush_radius: f32,
) -> Result<AnalyticBrushContour, PathBrushFailure> {
    let offsets = primitives
        .iter()
        .copied()
        .map(|primitive| offset_primitive(primitive, brush_radius))
        .collect::<Result<Vec<_>, _>>()?;
    let mut vertices = vec![offsets[0].left_start];
    let mut edge_geometries = Vec::new();
    let mut push_edge = |end: [f32; 2], geometry: ContourGeometry| {
        edge_geometries.push(geometry);
        vertices.push(end);
    };

    for (index, offset) in offsets.iter().enumerate() {
        push_edge(offset.left_end, offset.left_geometry);
        if let Some(next) = offsets.get(index + 1) {
            let turn = cross(offset.end_tangent, next.start_tangent);
            push_edge(
                next.left_start,
                ContourGeometry::CircularArc {
                    center: offset.end,
                    clockwise: turn < 0.0,
                },
            );
        }
    }

    let last = offsets.last().expect("non-empty offsets");
    push_edge(
        last.right_end,
        ContourGeometry::CircularArc {
            center: last.end,
            clockwise: arc_through(last.left_end, last.end_tangent, last.right_end, last.end),
        },
    );

    for index in (0..offsets.len()).rev() {
        let offset = offsets[index];
        push_edge(offset.right_start, reverse_geometry(offset.right_geometry));
        if index > 0 {
            let previous = offsets[index - 1];
            let turn = cross(previous.end_tangent, offset.start_tangent);
            push_edge(
                previous.right_end,
                ContourGeometry::CircularArc {
                    center: offset.start,
                    clockwise: turn > 0.0,
                },
            );
        }
    }

    let first = offsets[0];
    edge_geometries.push(ContourGeometry::CircularArc {
        center: first.start,
        clockwise: arc_through(
            first.right_start,
            [-first.start_tangent[0], -first.start_tangent[1]],
            first.left_start,
            first.start,
        ),
    });
    Ok(AnalyticBrushContour {
        vertices,
        edge_geometries,
    })
}

fn offset_primitive(
    primitive: StrokePrimitive,
    brush_radius: f32,
) -> Result<OffsetPrimitive, PathBrushFailure> {
    match primitive {
        StrokePrimitive::Line { start, end } => {
            let tangent = unit([end[0] - start[0], end[1] - start[1]])
                .ok_or(PathBrushFailure::RequiresNormalizedBrushUnion)?;
            let left = [-tangent[1] * brush_radius, tangent[0] * brush_radius];
            Ok(OffsetPrimitive {
                left_start: add(start, left),
                left_end: add(end, left),
                right_start: sub(start, left),
                right_end: sub(end, left),
                left_geometry: ContourGeometry::Line,
                right_geometry: ContourGeometry::Line,
                start,
                end,
                start_tangent: tangent,
                end_tangent: tangent,
            })
        }
        StrokePrimitive::Arc {
            center,
            radius,
            start_angle,
            sweep_angle,
        } => {
            let clockwise = sweep_angle < 0.0;
            let end_angle = start_angle + sweep_angle;
            let left_radius = if clockwise {
                radius + brush_radius
            } else {
                radius - brush_radius
            };
            let right_radius = if clockwise {
                radius - brush_radius
            } else {
                radius + brush_radius
            };
            if left_radius <= f32::EPSILON || right_radius <= f32::EPSILON {
                return Err(PathBrushFailure::RequiresNormalizedBrushUnion);
            }
            let point = |distance: f32, angle: f32| {
                [
                    center[0] + distance * angle.cos(),
                    center[1] + distance * angle.sin(),
                ]
            };
            let tangent = |angle: f32| {
                if clockwise {
                    [angle.sin(), -angle.cos()]
                } else {
                    [-angle.sin(), angle.cos()]
                }
            };
            Ok(OffsetPrimitive {
                left_start: point(left_radius, start_angle),
                left_end: point(left_radius, end_angle),
                right_start: point(right_radius, start_angle),
                right_end: point(right_radius, end_angle),
                left_geometry: ContourGeometry::CircularArc { center, clockwise },
                right_geometry: ContourGeometry::CircularArc { center, clockwise },
                start: point(radius, start_angle),
                end: point(radius, end_angle),
                start_tangent: tangent(start_angle),
                end_tangent: tangent(end_angle),
            })
        }
        StrokePrimitive::Point(_) => Err(PathBrushFailure::RequiresNormalizedBrushUnion),
    }
}

fn reverse_geometry(geometry: ContourGeometry) -> ContourGeometry {
    match geometry {
        ContourGeometry::Line => ContourGeometry::Line,
        ContourGeometry::CircularArc { center, clockwise } => ContourGeometry::CircularArc {
            center,
            clockwise: !clockwise,
        },
    }
}

fn arc_through(
    from: [f32; 2],
    through_direction: [f32; 2],
    to: [f32; 2],
    center: [f32; 2],
) -> bool {
    let from_angle = (from[1] - center[1]).atan2(from[0] - center[0]);
    let through_angle = through_direction[1].atan2(through_direction[0]);
    let to_angle = (to[1] - center[1]).atan2(to[0] - center[0]);
    let ccw_total = (to_angle - from_angle).rem_euclid(std::f32::consts::TAU);
    let ccw_through = (through_angle - from_angle).rem_euclid(std::f32::consts::TAU);
    ccw_through > ccw_total
}

fn unit(vector: [f32; 2]) -> Option<[f32; 2]> {
    let length = (vector[0] * vector[0] + vector[1] * vector[1]).sqrt();
    (length > f32::EPSILON).then_some([vector[0] / length, vector[1] / length])
}

fn cross(left: [f32; 2], right: [f32; 2]) -> f32 {
    left[0] * right[1] - left[1] * right[0]
}

fn add(left: [f32; 2], right: [f32; 2]) -> [f32; 2] {
    [left[0] + right[0], left[1] + right[1]]
}

fn sub(left: [f32; 2], right: [f32; 2]) -> [f32; 2] {
    [left[0] - right[0], left[1] - right[1]]
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
    fn a_multi_primitive_stroke_is_one_joined_contour() {
        let contour = compact_analytic_brush_contour(&request(
            vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [2.0, 1.0]],
            BrushShape::Circle { radius: 0.25 },
        ))
        .unwrap();
        assert_eq!(contour.vertices().len(), contour.edge_geometries().len());
        assert_eq!(contour.vertices().len(), 8);
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
