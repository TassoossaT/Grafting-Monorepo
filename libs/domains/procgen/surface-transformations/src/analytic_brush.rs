//! Compact analytic contours for one normalized path-brush sweep.
//!
//! The contour is a construction-time description of the *whole* swept
//! area. It deliberately contains only fitted stroke primitives and true
//! circular arcs; renderer tessellation happens later in
//! `grafting-procgen-surface-mesh`.

use std::collections::BTreeMap;

use grafting_graph_core::ContourGeometry;
use grafting_graph_core::{
    ContourEdge, ContourEdgeId, ContourLoop, ContourTopology, Graph, NodeId, RegionId,
    SurfaceRegistry, SurfaceType,
};

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

/// One vertex of a cancelled exterior boundary, paired with the geometry of
/// the edge leading from it to the *next* vertex in the same boundary
/// (wrapping from the last vertex back to the first). Unlike a plain
/// surface's cycle (always straight), a consumed analytic region's own
/// edges can be curved, and the remainder boundary this vertex ends up in
/// must keep that curve, not silently flatten it to a line.
pub type BoundaryVertex = (NodeId, ContourGeometry);

/// One region-overlay merge plan: which existing surfaces and existing
/// analytic regions a new region's contour destroys, their cancelled
/// exterior boundaries (what a leftover remainder region must carry as its
/// own hole), and the contour itself.
///
/// Nothing here is specific to any one tool. A path-brush stroke, a future
/// wall opening, or anything else that overlays one new closed shape onto
/// the current graph and destroys whatever it covers can reuse this
/// unchanged -- see [`plan_region_merge`]. Consuming an existing *region*
/// (not just a plain surface) matters as soon as more than one such
/// overlay can happen in the same place: without it, a second stroke can
/// never touch, cut, or remove what an earlier one already created, and it
/// just sits there orphaned forever.
#[derive(Debug, Clone, PartialEq)]
pub struct RegionMergePlan {
    consumed_region_ids: Vec<RegionId>,
    consumed_boundaries: Vec<Vec<BoundaryVertex>>,
    contour: AnalyticBrushContour,
}

impl RegionMergePlan {
    /// Existing analytic regions the new contour destroys.
    pub fn consumed_region_ids(&self) -> &[RegionId] {
        &self.consumed_region_ids
    }

    /// Closed exterior boundaries after shared edges among every consumed
    /// surface and region cancel -- each carrying its own edge geometry
    /// forward, not assuming straight lines.
    pub fn consumed_boundaries(&self) -> &[Vec<BoundaryVertex>] {
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
        ) => {
            // `round_arc`'s offset-arc math cannot represent a turn tight
            // enough (or a brush fat enough) that the inner offset would
            // invert -- exactly the self-overlap case `union_stroke_footprint`
            // already exists to handle for every other multi-primitive
            // stroke. Falling back here instead of erroring is the same
            // fix the non-circle-brush arm below already got.
            round_arc(*center, *radius, *start_angle, *sweep_angle, *brush_radius)
                .or_else(|_| union_stroke_footprint(&primitives, &request.shape))
        }
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
            let steps = (sweep_angle.abs() / max_step.max(f32::EPSILON))
                .ceil()
                .max(1.0) as usize;
            (0..=steps)
                .map(|index| {
                    let angle = start_angle + sweep_angle * (index as f32 / steps as f32);
                    [
                        center[0] + radius * angle.cos(),
                        center[1] + radius * angle.sin(),
                    ]
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
        let edge = ContourEdge::new(
            scratch_id.clone(),
            scratch_start.clone(),
            scratch_end.clone(),
            geometry,
        );
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

fn reverse_geometry(geometry: ContourGeometry) -> ContourGeometry {
    match geometry {
        ContourGeometry::Line => ContourGeometry::Line,
        ContourGeometry::CircularArc { center, clockwise } => ContourGeometry::CircularArc {
            center,
            clockwise: !clockwise,
        },
    }
}

/// One existing region's own outer-loop boundary, tessellated into a flat
/// XZ polygon -- the region-surface counterpart to a plain surface's own
/// `cycle()` positions, needed only for [`plan_region_merge`]'s spatial
/// touch test. `None` if any node the loop references is missing.
fn region_loop_polygon(
    topology: &ContourTopology,
    graph: &Graph<[f32; 3], ()>,
    loop_: &ContourLoop,
    tolerance: f32,
) -> Option<Vec<[f32; 2]>> {
    let mut polygon = Vec::new();
    for use_ in loop_ {
        let edge = topology.edge(use_.edge())?;
        let (start_id, end_id) = if use_.is_reversed() {
            (edge.end_node(), edge.start_node())
        } else {
            (edge.start_node(), edge.end_node())
        };
        let from = graph.node(start_id)?.data();
        let to = graph.node(end_id)?.data();
        let from = [from[0], from[2]];
        let to = [to[0], to[2]];
        let geometry = if use_.is_reversed() {
            edge.reversed_geometry()
        } else {
            *edge.geometry()
        };
        let scratch = ContourEdge::new(
            edge.id().clone(),
            start_id.clone(),
            end_id.clone(),
            geometry,
        );
        let mut points = scratch.tessellate(from, to, tolerance);
        points.pop(); // shared with the next edge's own start vertex
        polygon.extend(points);
    }
    Some(polygon)
}

/// Plans destroying-and-rebuilding whatever existing surfaces or existing
/// analytic regions a new region's `contour` touches.
///
/// Generic across what counts as eligible to be consumed (`is_eligible`,
/// tested against each candidate's own `SurfaceType`; a caller wanting no
/// restriction at all passes `|_| true`) and knows nothing about what kind
/// of structure produced `contour` -- a path-brush stroke, a future wall
/// opening, or anything else. Never mutates the graph.
///
/// A candidate (a plain surface or an existing region alike) counts as
/// touched either way a shape can overlap a face without crossing the
/// other's own vertices: a corner landing inside the new contour, or the
/// contour's own boundary passing through the candidate's interior
/// (cutting straight through the middle of a face touches no corner at
/// all). This step then cancels interior shared edges among every touched
/// candidate once -- surfaces and regions together, in one pool, so a
/// region bordering a plain surface (or another region) cancels exactly
/// the same way two plain surfaces already did -- and keeps only the
/// exterior loops, the prerequisite for a caller replacing an entire
/// consumed patch with one region-with-a-hole instead of emitting a
/// fragment for every original piece.
///
/// **Known scope limit:** only a consumed region's *outer* loop(s)
/// participate in cancellation -- a hole already inside a consumed region
/// (an even earlier stroke's own cutout) is not carried forward as a hole
/// of the new remainder. A stroke that fully re-covers a multi-generation
/// hole "heals" it instead of preserving it. Narrower than the total
/// invisibility this replaces, but not a complete fix.
pub fn plan_region_merge(
    graph: &Graph<[f32; 3], ()>,
    surfaces: &SurfaceRegistry,
    topology: &ContourTopology,
    contour: AnalyticBrushContour,
    is_eligible: impl Fn(&SurfaceType) -> bool,
) -> Result<RegionMergePlan, PathBrushFailure> {
    let boundary_polygon = contour_polygon(&contour, CONTOUR_POLYGON_TOLERANCE);

    // A later stroke has to be able to touch, cut, or remove what an
    // earlier one created, so every existing region the contour overlaps is
    // consumable -- most commonly a previous stroke's own remainder.
    let consumed_region_ids = surfaces
        .region_surface_ids()
        .into_iter()
        .filter(|region_id| {
            surfaces
                .region_surface(region_id)
                .is_some_and(|region_surface| {
                    if !is_eligible(region_surface.surface_type()) {
                        return false;
                    }
                    let Some(region) = topology.region(region_id) else {
                        return false;
                    };
                    region.outer_loops().iter().any(|loop_| {
                        let Some(positions) =
                            region_loop_polygon(topology, graph, loop_, CONTOUR_POLYGON_TOLERANCE)
                        else {
                            return true; // missing node -- stay eligible, same posture as the plain-surface pass above
                        };
                        positions
                            .iter()
                            .any(|&position| polygon_contains_point(&boundary_polygon, position))
                            || boundary_polygon
                                .iter()
                                .any(|&vertex| polygon_contains_point(&positions, vertex))
                    })
                })
        })
        .collect::<Vec<_>>();

    // A new region can be planned with nothing eligible underneath it at
    // all -- a structure doesn't need pre-existing material to consume
    // just to be drawn. Both lists staying empty is the ordinary, valid
    // "nothing to consume" case, not a failure.
    let mut edges = BTreeMap::<(NodeId, NodeId), (NodeId, NodeId, ContourGeometry)>::new();
    let push_edge = |edges: &mut BTreeMap<(NodeId, NodeId), (NodeId, NodeId, ContourGeometry)>,
                     start: NodeId,
                     end: NodeId,
                     geometry: ContourGeometry| {
        let key = if start <= end {
            (start.clone(), end.clone())
        } else {
            (end.clone(), start.clone())
        };
        if edges.remove(&key).is_none() {
            edges.insert(key, (start, end, geometry));
        }
    };

    for region_id in &consumed_region_ids {
        let region = topology
            .region(region_id)
            .expect("region ids came from the same topology");
        for loop_ in region.outer_loops() {
            for use_ in loop_ {
                let edge = topology
                    .edge(use_.edge())
                    .expect("a region's own edge uses always resolve in the same topology");
                let (start, end, geometry) = if use_.is_reversed() {
                    (
                        edge.end_node().clone(),
                        edge.start_node().clone(),
                        edge.reversed_geometry(),
                    )
                } else {
                    (
                        edge.start_node().clone(),
                        edge.end_node().clone(),
                        *edge.geometry(),
                    )
                };
                push_edge(&mut edges, start, end, geometry);
            }
        }
    }

    let mut boundaries: Vec<Vec<BoundaryVertex>> = Vec::new();
    while let Some((_, (start, first_end, first_geometry))) = edges.pop_first() {
        let mut boundary = vec![(start.clone(), first_geometry)];
        let mut current = first_end;
        while current != start {
            let next = edges
                .iter()
                .find_map(|(key, (edge_start, edge_end, geometry))| {
                    if edge_start == &current {
                        Some((key.clone(), edge_end.clone(), *geometry))
                    } else if edge_end == &current {
                        Some((key.clone(), edge_start.clone(), reverse_geometry(*geometry)))
                    } else {
                        None
                    }
                });
            let Some((key, following, geometry)) = next else {
                return Err(PathBrushFailure::RequiresNormalizedBrushUnion);
            };
            edges.remove(&key);
            boundary.push((current.clone(), geometry));
            current = following;
        }
        if boundary.len() >= 3 {
            boundaries.push(boundary);
        }
    }
    Ok(RegionMergePlan {
        consumed_region_ids,
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
    use grafting_graph_core::{Node, SurfaceType};

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

    /// Registers one analytic region over `cycle`, the only kind of face
    /// there is -- what a real generator's patch produces.
    fn region(
        graph: &Graph<[f32; 3], ()>,
        topology: &mut ContourTopology,
        surfaces: &mut SurfaceRegistry,
        id: &str,
        cycle: &[&str],
        surface_type: &str,
    ) -> RegionId {
        let nodes: Vec<NodeId> = cycle.iter().map(|id| NodeId::new(*id).unwrap()).collect();
        let region_id = RegionId::new(id).unwrap();
        grafting_graph_core::straight_cycle_region(topology, graph, region_id.clone(), &nodes)
            .unwrap();
        surfaces
            .add_region_surface(
                topology,
                region_id.clone(),
                SurfaceType::new(surface_type),
                true,
            )
            .unwrap();
        region_id
    }

    fn graph_of(nodes: &[(&str, [f32; 3])]) -> Graph<[f32; 3], ()> {
        Graph::try_from_parts(
            nodes
                .iter()
                .map(|(id, position)| Node::new(NodeId::new(*id).unwrap(), *position))
                .collect(),
            vec![],
        )
        .unwrap()
    }

    #[test]
    fn adjacent_faces_collapse_to_their_outer_boundary_once() {
        let graph = graph_of(&[
            ("a", [0.0, 0.0, 0.0]),
            ("b", [1.0, 0.0, 0.0]),
            ("c", [2.0, 0.0, 0.0]),
            ("d", [0.0, 0.0, 1.0]),
            ("e", [1.0, 0.0, 1.0]),
            ("f", [2.0, 0.0, 1.0]),
        ]);
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();
        region(
            &graph,
            &mut topology,
            &mut surfaces,
            "left",
            &["a", "b", "e", "d"],
            "terrain",
        );
        region(
            &graph,
            &mut topology,
            &mut surfaces,
            "right",
            &["b", "c", "f", "e"],
            "terrain",
        );

        let contour = compact_analytic_brush_contour(&request(
            vec![[0.25, 0.5], [1.75, 0.5]],
            BrushShape::Circle { radius: 0.1 },
        ))
        .unwrap();
        let plan = plan_region_merge(&graph, &surfaces, &topology, contour, |surface_type| {
            surface_type == &SurfaceType::new("terrain")
        })
        .unwrap();
        assert_eq!(plan.consumed_region_ids().len(), 2);
        assert_eq!(plan.consumed_boundaries().len(), 1);
        assert_eq!(plan.consumed_boundaries()[0].len(), 6);
    }

    /// A same-typed face far from the stroke must never become a source --
    /// this is the exact bug report: painting a path anywhere used to swallow
    /// *every* terrain face on the whole table into one region, since the
    /// old filter only checked `surface_type`, never location.
    #[test]
    fn a_terrain_face_far_from_the_stroke_is_left_out_of_the_plan() {
        let graph = graph_of(&[
            ("a", [0.0, 0.0, 0.0]),
            ("b", [1.0, 0.0, 0.0]),
            ("c", [1.0, 0.0, 1.0]),
            ("d", [0.0, 0.0, 1.0]),
            ("p", [1000.0, 0.0, 1000.0]),
            ("q", [1001.0, 0.0, 1000.0]),
            ("r", [1001.0, 0.0, 1001.0]),
            ("s", [1000.0, 0.0, 1001.0]),
        ]);
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();
        let near = region(
            &graph,
            &mut topology,
            &mut surfaces,
            "near",
            &["a", "b", "c", "d"],
            "terrain",
        );
        let far = region(
            &graph,
            &mut topology,
            &mut surfaces,
            "far",
            &["p", "q", "r", "s"],
            "terrain",
        );

        let contour = compact_analytic_brush_contour(&request(
            vec![[0.25, 0.5], [0.75, 0.5]],
            BrushShape::Circle { radius: 0.1 },
        ))
        .unwrap();
        let plan = plan_region_merge(&graph, &surfaces, &topology, contour, |surface_type| {
            surface_type == &SurfaceType::new("terrain")
        })
        .unwrap();

        assert_eq!(plan.consumed_region_ids(), &[near]);
        assert!(!plan.consumed_region_ids().contains(&far));
    }

    /// `plan_region_merge` knows nothing about "path" -- it takes whatever
    /// eligibility predicate the caller hands it. A predicate matching a
    /// completely different type (or, per the next test, no type at all)
    /// must work exactly the same as the terrain-only tests above.
    #[test]
    fn eligibility_is_the_callers_predicate_not_a_hardcoded_surface_type() {
        let graph = graph_of(&[
            ("a", [0.0, 0.0, 0.0]),
            ("b", [1.0, 0.0, 0.0]),
            ("c", [1.0, 0.0, 1.0]),
            ("d", [0.0, 0.0, 1.0]),
        ]);
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();
        let roof = region(
            &graph,
            &mut topology,
            &mut surfaces,
            "roof",
            &["a", "b", "c", "d"],
            "roof",
        );

        let contour = compact_analytic_brush_contour(&request(
            vec![[0.25, 0.5], [0.75, 0.5]],
            BrushShape::Circle { radius: 0.1 },
        ))
        .unwrap();

        let excluded = plan_region_merge(
            &graph,
            &surfaces,
            &topology,
            contour.clone(),
            |surface_type| surface_type == &SurfaceType::new("terrain"),
        )
        .unwrap();
        assert!(excluded.consumed_region_ids().is_empty());

        let included = plan_region_merge(&graph, &surfaces, &topology, contour, |_| true).unwrap();
        assert_eq!(included.consumed_region_ids(), &[roof]);
    }

    /// A path is a structure like any other -- it must be plannable with no
    /// eligible ground underneath it at all, the same way terrain generation
    /// does not require anything pre-existing either.
    #[test]
    fn a_stroke_with_no_terrain_underneath_still_plans_a_target_only_contour() {
        let graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let surfaces = SurfaceRegistry::new();

        let contour = compact_analytic_brush_contour(&request(
            vec![[0.0, 0.0], [1.0, 0.0]],
            BrushShape::Circle { radius: 0.25 },
        ))
        .unwrap();
        let plan = plan_region_merge(
            &graph,
            &surfaces,
            &ContourTopology::new(),
            contour,
            |surface_type| surface_type == &SurfaceType::new("terrain"),
        )
        .unwrap();

        assert!(plan.consumed_region_ids().is_empty());
        assert!(plan.consumed_boundaries().is_empty());
        assert!(!plan.contour().vertices().is_empty());
    }
}
