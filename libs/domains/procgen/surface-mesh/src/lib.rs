//! Turns a construction `Surface`'s node cycle -- an ordered ring of 3D
//! positions -- into a triangulated mesh. `grafting_graph_core::Surface`
//! deliberately does not compute this itself (see its module doc: "turning
//! that into geometry is the caller's job"); this crate is that caller. A
//! pure `positions -> mesh` function, with no dependency on graph-core's
//! storage, matching the isolation `terrain-generation`/`structure-generation`
//! already use for generation-only crates.
//!
//! `ADR-0022` requires arbitrary (not only convex/rectangular) polygon
//! support ("a hexagon, an irregular outline"), so triangulation uses the
//! `earcut` crate (ear-clipping, handles concave simple polygons) rather
//! than a fan, which only triangulates convex/star-shaped rings correctly.
//!
//! A curved face keeps exactly the corners a straight one has -- the arc
//! only exists here, approximated right before triangulation and never
//! persisted back onto the graph. Tessellation resolution is this crate's
//! own fixed [`ARC_TESSELLATION_TOLERANCE`], not a value a caller supplies
//! or the graph stores: controlling render resolution is a rendering
//! concern, not a construction-time one.
//!
//! An **upright** face -- a wall panel, straight or curved -- gets there by
//! being unrolled rather than projected. Its ring does not lie on a plane
//! when it curves, so a best-fit plane folds it onto itself and emits
//! triangles that visibly cut across the surface. But the panel is a
//! developable surface: a section of a cylinder flattens without distortion
//! into "distance along the rail" and "height", and a straight panel is the
//! same map with an infinite radius. Unrolled, it is an ordinary 2D polygon
//! that `earcut` triangulates like any other -- openings included, which a
//! strip built facet by facet could never punch.
//!
//! The 3D positions never move: the unrolled coordinates exist only so
//! `earcut` has somewhere flat to work, and `earcut` introduces no vertices
//! of its own. Only the normals are derived from the frame, per vertex, so
//! a curve shades as a curve.

use earcut::{Earcut, utils3d};

use grafting_graph_core::{
    ContourEdge, ContourGeometry, ContourLoop, ContourTopology, NodeId, OrientedEdgeUse,
    SurfaceRegion,
};

/// Maximum deviation, in world units, between a tessellated arc's chords and
/// the true circle they approximate -- see this module's own top-level doc
/// for why this is a fixed constant here rather than a caller-supplied
/// value: nothing upstream of rendering has a legitimate reason to care
/// about tessellation resolution.
const ARC_TESSELLATION_TOLERANCE: f32 = 0.03;

/// How far apart, in world units, an edge's two endpoints may be in XZ and
/// still count as one upright side for [`upright_face_mesh`]. Only ever
/// compared against values that are meant to be exactly equal (the same
/// contour point at two heights), so this absorbs float round-trip drift,
/// not any real slant.
const VERTICAL_SIDE_EPSILON: f32 = 1e-4;

/// A triangulated mesh derived from one surface's node cycle. Vertices stay
/// in the caller-supplied cycle order (no Steiner points are introduced for
/// the simple, hole-free polygons this domain produces), so `indices`
/// reference the same order as the input `positions`.
#[derive(Debug, Clone, PartialEq)]
pub struct TriangulatedMesh {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub indices: Vec<u32>,
}

/// Derives transient meshes for every outer loop in an analytic contour
/// region. Lines and circular arcs remain analytic in graph state; this is
/// the first point where an arc is approximated for GPU consumption.
///
/// Holes are assigned to the outer loop that contains their first point in
/// the XZ contour plane. An invalid hole that is outside every outer loop
/// produces `None` rather than a visually plausible but topologically false
/// mesh. Callers resolve node positions from their authoritative graph.
pub fn triangulate_region(
    topology: &ContourTopology,
    region: &SurfaceRegion,
    mut resolve_position: impl FnMut(&NodeId) -> Option<[f32; 3]>,
) -> Option<Vec<TriangulatedMesh>> {
    // An upright face is unrolled, not projected: its ring lies on no plane
    // once it curves, and it carries its own openings through with it. See
    // [`upright_face_mesh`], which reports `None` for anything that is not
    // one, leaving the flat path below exactly as it was.
    if let Some(mesh) = upright_face_mesh(topology, region, &mut resolve_position) {
        return Some(vec![mesh]);
    }

    let outers = region
        .outer_loops()
        .iter()
        .map(|loop_| tessellate_contour_loop(topology, loop_, &mut resolve_position))
        .collect::<Option<Vec<_>>>()?;
    let holes = region
        .holes()
        .iter()
        .map(|loop_| tessellate_contour_loop(topology, loop_, &mut resolve_position))
        .collect::<Option<Vec<_>>>()?;

    // With one outer loop there is nothing to decide: every hole belongs to
    // it, because there is nowhere else for a hole of this region to be.
    // Asking anyway would only add a way to be wrong -- ray casting is
    // unreliable for a point sitting exactly on the boundary it is being
    // tested against.
    //
    // Several disjoint outer loops at once only arise from a merge
    // (unrelated surfaces consumed together, never sharing an edge to
    // collapse into one ring -- see `region_merge.rs`). There a hole really
    // can belong to one piece and not another, and one spanning across
    // them, or landing outside them all, corresponds to no single owner.
    // That must not fail the whole region's mesh -- every
    // cleanly-owned piece still has to render -- so an unresolvable hole is
    // dropped (that piece renders as its own full, unnotched loop) rather
    // than this function returning `None`.
    let owners: Vec<Option<usize>> = holes
        .iter()
        .map(|hole| {
            if outers.len() == 1 {
                return Some(0);
            }
            hole.first().and_then(|point| {
                outers
                    .iter()
                    .position(|outer| point_in_loop_xz([point[0], point[2]], outer))
            })
        })
        .collect();

    outers
        .iter()
        .enumerate()
        .map(|(index, outer)| {
            let owned_holes = holes
                .iter()
                .zip(owners.iter())
                .filter_map(|(hole, owner)| (*owner == Some(index)).then_some(hole));
            triangulate_contour_loops(outer, owned_holes)
        })
        .collect()
}

/// One loop entry resolved into an edge that runs the way the loop
/// traverses it -- a reversed use is rebuilt with its endpoints swapped and
/// its geometry mirrored, so every caller downstream can read `start_node`
/// and `end_node` literally.
fn traversed_edge(topology: &ContourTopology, use_: &OrientedEdgeUse) -> Option<ContourEdge> {
    let edge = topology.edge(use_.edge())?;
    Some(if use_.is_reversed() {
        ContourEdge::new(
            edge.id().clone(),
            edge.end_node().clone(),
            edge.start_node().clone(),
            edge.reversed_geometry(),
        )
    } else {
        edge.clone()
    })
}

fn tessellate_contour_loop(
    topology: &ContourTopology,
    loop_: &ContourLoop,
    resolve_position: &mut impl FnMut(&NodeId) -> Option<[f32; 3]>,
) -> Option<Vec<[f32; 3]>> {
    let mut positions = Vec::new();
    for use_ in loop_ {
        let traversed = traversed_edge(topology, use_)?;
        let start = resolve_position(traversed.start_node())?;
        let end = resolve_position(traversed.end_node())?;
        let planar = traversed.tessellate(
            [start[0], start[2]],
            [end[0], end[2]],
            ARC_TESSELLATION_TOLERANCE,
        );
        if planar.len() < 2 {
            return None;
        }
        for (index, point) in planar.iter().take(planar.len() - 1).enumerate() {
            let t = index as f32 / (planar.len() - 1) as f32;
            positions.push([point[0], start[1] + (end[1] - start[1]) * t, point[1]]);
        }
    }
    (positions.len() >= 3).then_some(positions)
}

fn triangulate_contour_loops<'a>(
    outer: &[[f32; 3]],
    holes: impl IntoIterator<Item = &'a Vec<[f32; 3]>>,
) -> Option<TriangulatedMesh> {
    if outer.len() < 3 {
        return None;
    }
    let mut positions = outer.to_vec();
    let mut hole_indices = Vec::new();
    for hole in holes {
        if hole.len() < 3 {
            return None;
        }
        hole_indices.push(positions.len() as u32);
        positions.extend(hole.iter().copied());
    }
    // This is the path for a face that really does lie on a plane, so the
    // ring's own best-fit plane is the right place to flatten it: for an
    // XZ-planar region (terrain, a path-brush stroke) that plane already is
    // XZ. An upright face never reaches here -- it is unrolled instead, by
    // `upright_face_mesh`, because a curved one lies on no plane at all.
    let mut projected: Vec<[f32; 2]> = Vec::new();
    if !utils3d::project3d_to_2d(&positions, positions.len(), &mut projected) {
        return None;
    }
    let mut earcut = Earcut::new();
    let mut indices = Vec::new();
    earcut.earcut(projected, &hole_indices, &mut indices);
    (!indices.is_empty()).then(|| TriangulatedMesh {
        normals: vec![face_normal(outer).unwrap_or([0.0, 1.0, 0.0]); positions.len()],
        positions,
        indices,
    })
}

fn point_in_loop_xz(point: [f32; 2], loop_: &[[f32; 3]]) -> bool {
    let mut inside = false;
    for (current, next) in loop_
        .iter()
        .zip(loop_.iter().cycle().skip(1))
        .take(loop_.len())
    {
        let current_z = current[2];
        let next_z = next[2];
        if (current_z > point[1]) == (next_z > point[1]) {
            continue;
        }
        let intersection_x =
            (next[0] - current[0]) * (point[1] - current_z) / (next_z - current_z) + current[0];
        if point[0] < intersection_x {
            inside = !inside;
        }
    }
    inside
}

/// The flat frame an upright face unrolls into: one coordinate running
/// along its rail, one running up it.
///
/// A wall panel is developable, so this map loses nothing. `Chord` is the
/// straight case and `Cylinder` the curved one, and they are the same idea
/// -- a chord is an arc whose radius has gone to infinity.
#[derive(Debug, Clone, Copy)]
enum UnrollFrame {
    Chord {
        origin: [f32; 2],
        direction: [f32; 2],
    },
    Cylinder {
        center: [f32; 2],
        radius: f32,
        start_angle: f32,
        clockwise: bool,
    },
}

impl UnrollFrame {
    /// Builds the frame from the rail's own geometry and where that rail starts.
    fn of(geometry: &ContourGeometry, start: [f32; 3], end: [f32; 3]) -> Option<Self> {
        match geometry {
            ContourGeometry::Line => {
                let (dx, dz) = (end[0] - start[0], end[2] - start[2]);
                let length = (dx * dx + dz * dz).sqrt();
                (length > f32::EPSILON).then_some(Self::Chord {
                    origin: [start[0], start[2]],
                    direction: [dx / length, dz / length],
                })
            }
            ContourGeometry::CircularArc { center, clockwise } => {
                let radius = distance_xz(*center, [start[0], start[2]]);
                (radius > f32::EPSILON).then_some(Self::Cylinder {
                    center: *center,
                    radius,
                    start_angle: angle_xz(*center, [start[0], start[2]]),
                    clockwise: *clockwise,
                })
            }
        }
    }

    /// `point` as (distance along the rail, height). Distance grows the way
    /// the rail is walked, so the whole face lands on one side of the origin.
    fn unroll(&self, point: [f32; 3]) -> [f32; 2] {
        match self {
            Self::Chord { origin, direction } => [
                (point[0] - origin[0]) * direction[0] + (point[2] - origin[1]) * direction[1],
                point[1],
            ],
            Self::Cylinder {
                center,
                radius,
                start_angle,
                clockwise,
            } => {
                let swept = sweep(
                    *start_angle,
                    angle_xz(*center, [point[0], point[2]]),
                    *clockwise,
                );
                [radius * swept, point[1]]
            }
        }
    }

    /// The outward horizontal direction at `point` -- radial for a cylinder,
    /// constant for a chord. Sign is settled once for the whole face by
    /// [`upright_face_mesh`], from the winding its own triangles came out with.
    fn normal_at(&self, point: [f32; 3]) -> [f32; 3] {
        match self {
            Self::Chord { direction, .. } => [-direction[1], 0.0, direction[0]],
            Self::Cylinder { center, .. } => {
                let (dx, dz) = (point[0] - center[0], point[2] - center[1]);
                let length = (dx * dx + dz * dz).sqrt();
                if length <= f32::EPSILON {
                    [0.0, 0.0, 1.0]
                } else {
                    [dx / length, 0.0, dz / length]
                }
            }
        }
    }
}

fn distance_xz(a: [f32; 2], b: [f32; 2]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

fn angle_xz(center: [f32; 2], point: [f32; 2]) -> f32 {
    (point[1] - center[1]).atan2(point[0] - center[0])
}

/// Sweep from `from` to `to` in the given direction, always non-negative.
fn sweep(from: f32, to: f32, clockwise: bool) -> f32 {
    let raw = if clockwise { from - to } else { to - from };
    let full = std::f32::consts::TAU;
    let wrapped = raw % full;
    if wrapped < 0.0 {
        wrapped + full
    } else {
        wrapped
    }
}

/// The rail an upright face is unrolled along, and whether the loop had the
/// shape of an upright face at all.
struct UprightRail {
    frame: UnrollFrame,
}

/// Reads a loop as an upright face: a run along the base, one side rising,
/// a run back along the top, one side coming down.
///
/// Recognised by structure rather than by counting edges, so a panel whose
/// base has since been subdivided -- a T-junction welding another wall onto
/// its side -- is still the same upright face it always was.
fn upright_rail(
    topology: &ContourTopology,
    loop_: &ContourLoop,
    resolve_position: &mut impl FnMut(&NodeId) -> Option<[f32; 3]>,
) -> Option<UprightRail> {
    let mut walked: Vec<(ContourEdge, [f32; 3], [f32; 3])> = Vec::with_capacity(loop_.len());
    for use_ in loop_ {
        let edge = traversed_edge(topology, use_)?;
        let start = resolve_position(edge.start_node())?;
        let end = resolve_position(edge.end_node())?;
        walked.push((edge, start, end));
    }

    let is_upright = |(_, start, end): &(ContourEdge, [f32; 3], [f32; 3])| {
        (start[0] - end[0]).abs() <= VERTICAL_SIDE_EPSILON
            && (start[2] - end[2]).abs() <= VERTICAL_SIDE_EPSILON
            && (start[1] - end[1]).abs() > VERTICAL_SIDE_EPSILON
    };
    let sides: Vec<usize> = walked
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| is_upright(entry).then_some(index))
        .collect();
    // Exactly two sides is what makes the rest a base run and a top run. One
    // or three is some other shape entirely, and none is a flat face.
    if sides.len() != 2 {
        return None;
    }

    // The run leaving the lower end of the first side is the base.
    let (first, second) = (sides[0], sides[1]);
    let after_first = &walked[first + 1..second];
    let after_second = walked[second + 1..]
        .iter()
        .chain(walked[..first].iter())
        .collect::<Vec<_>>();
    let mean_height = |run: &[&(ContourEdge, [f32; 3], [f32; 3])]| -> Option<f32> {
        (!run.is_empty())
            .then(|| run.iter().map(|(_, start, _)| start[1]).sum::<f32>() / run.len() as f32)
    };
    let first_run: Vec<&(ContourEdge, [f32; 3], [f32; 3])> = after_first.iter().collect();
    let base = match (mean_height(&first_run), mean_height(&after_second)) {
        (Some(one), Some(other)) if one <= other => first_run,
        (Some(_), Some(_)) => after_second,
        _ => return None,
    };

    let (edge, start, end) = base.first()?;
    Some(UprightRail {
        frame: UnrollFrame::of(edge.geometry(), *start, *end)?,
    })
}

/// Meshes an upright face -- a wall panel, straight or curved, opened or
/// solid -- by unrolling it flat and triangulating there.
///
/// `None` for anything that is not one, which leaves every other region on
/// the ordinary projection path untouched. A region with more than one outer
/// loop is never one: those come from a merge, and a merge is flat.
fn upright_face_mesh(
    topology: &ContourTopology,
    region: &SurfaceRegion,
    resolve_position: &mut impl FnMut(&NodeId) -> Option<[f32; 3]>,
) -> Option<TriangulatedMesh> {
    let [outer_loop] = region.outer_loops() else {
        return None;
    };
    let rail = upright_rail(topology, outer_loop, resolve_position)?;

    let outer = tessellate_contour_loop(topology, outer_loop, resolve_position)?;
    let holes = region
        .holes()
        .iter()
        .map(|loop_| tessellate_contour_loop(topology, loop_, resolve_position))
        .collect::<Option<Vec<_>>>()?;

    let mut positions = outer;
    let mut hole_indices = Vec::new();
    for hole in &holes {
        if hole.len() < 3 {
            return None;
        }
        hole_indices.push(positions.len() as u32);
        positions.extend(hole.iter().copied());
    }

    let unrolled: Vec<[f32; 2]> = positions
        .iter()
        .map(|point| rail.frame.unroll(*point))
        .collect();
    let mut earcut = Earcut::new();
    let mut indices: Vec<u32> = Vec::new();
    earcut.earcut(unrolled, &hole_indices, &mut indices);
    if indices.is_empty() {
        return None;
    }

    // Which way the face actually faces is settled by the winding its own
    // triangles came out with, so the frame supplies the direction and the
    // geometry supplies the sign -- once, for the whole face.
    let mut normals: Vec<[f32; 3]> = positions
        .iter()
        .map(|point| rail.frame.normal_at(*point))
        .collect();
    if let Some(reference) = winding_normal(&positions, &indices) {
        let anchor = indices[0] as usize;
        let radial = normals[anchor];
        if dot(reference, radial) < 0.0 {
            for normal in &mut normals {
                *normal = [-normal[0], -normal[1], -normal[2]];
            }
        }
    }

    Some(TriangulatedMesh {
        positions,
        normals,
        indices,
    })
}

/// The normal of the first triangle with real area -- what the winding says
/// the face is facing.
fn winding_normal(positions: &[[f32; 3]], indices: &[u32]) -> Option<[f32; 3]> {
    for triangle in indices.chunks_exact(3) {
        let [a, b, c] = [
            positions[triangle[0] as usize],
            positions[triangle[1] as usize],
            positions[triangle[2] as usize],
        ];
        let normal = cross(sub(b, a), sub(c, a));
        let length = (normal[0].powi(2) + normal[1].powi(2) + normal[2].powi(2)).sqrt();
        if length > f32::EPSILON {
            return Some([normal[0] / length, normal[1] / length, normal[2] / length]);
        }
    }
    None
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// Flat face normal for shading: the first non-degenerate cross product
/// among triples anchored at `positions[0]`. `project3d_to_2d` already
/// proved the ring is not globally degenerate before this runs, so this is
/// just picking a representative triple, not re-deriving planarity.
fn face_normal(positions: &[[f32; 3]]) -> Option<[f32; 3]> {
    let origin = positions[0];
    for window in positions[1..].windows(2) {
        let cross = cross(sub(window[0], origin), sub(window[1], origin));
        let length = (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]).sqrt();
        if length > f32::EPSILON {
            return Some([cross[0] / length, cross[1] / length, cross[2] / length]);
        }
    }
    None
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    use grafting_graph_core::{
        ContourEdgeId, ContourGeometry, Graph, Node, OrientedEdgeUse, RegionId,
    };

    fn nid(name: &str) -> NodeId {
        NodeId::new(name).unwrap()
    }

    type PositionGraph = Graph<[f32; 3], ()>;

    fn graph_with_positions(positions: &[(&str, [f32; 3])]) -> PositionGraph {
        Graph::try_from_parts(
            positions
                .iter()
                .map(|(id, position)| Node::new(nid(id), *position))
                .collect(),
            Vec::new(),
        )
        .unwrap()
    }

    fn line_loop(
        topology: &mut ContourTopology,
        graph: &PositionGraph,
        prefix: &str,
        nodes: &[&str],
    ) -> ContourLoop {
        nodes
            .iter()
            .enumerate()
            .map(|(index, start)| {
                let end = nodes[(index + 1) % nodes.len()];
                let edge_id = ContourEdgeId::new(format!("{prefix}-{index}")).unwrap();
                topology
                    .add_edge(
                        graph,
                        ContourEdge::new(
                            edge_id.clone(),
                            nid(start),
                            nid(end),
                            ContourGeometry::Line,
                        ),
                    )
                    .unwrap();
                OrientedEdgeUse::forward(edge_id)
            })
            .collect()
    }

    #[test]
    fn analytic_arc_region_tessellates_only_in_the_mesh() {
        let graph = graph_with_positions(&[
            ("east", [2.0, 0.0, 0.0]),
            ("north", [0.0, 0.0, 2.0]),
            ("west", [-2.0, 0.0, 0.0]),
            ("south", [0.0, 0.0, -2.0]),
        ]);
        let mut topology = ContourTopology::new();
        let nodes = ["east", "north", "west", "south"];
        let loop_ = nodes
            .iter()
            .enumerate()
            .map(|(index, start)| {
                let end = nodes[(index + 1) % nodes.len()];
                let edge_id = ContourEdgeId::new(format!("arc-{index}")).unwrap();
                topology
                    .add_edge(
                        &graph,
                        ContourEdge::new(
                            edge_id.clone(),
                            nid(start),
                            nid(end),
                            ContourGeometry::CircularArc {
                                center: [0.0, 0.0],
                                clockwise: false,
                            },
                        ),
                    )
                    .unwrap();
                OrientedEdgeUse::forward(edge_id)
            })
            .collect();
        let region_id = RegionId::new("circle").unwrap();
        topology
            .add_region(region_id.clone(), vec![loop_], Vec::new())
            .unwrap();
        let positions = graph
            .snapshot()
            .nodes()
            .iter()
            .map(|node| (node.id().as_str().to_owned(), *node.data()))
            .collect::<HashMap<_, _>>();

        let meshes = triangulate_region(&topology, topology.region(&region_id).unwrap(), |id| {
            positions.get(id.as_str()).copied()
        })
        .unwrap();

        assert_eq!(
            topology.region(&region_id).unwrap().outer_loops()[0].len(),
            4
        );
        assert_eq!(meshes.len(), 1);
        assert!(
            meshes[0].positions.len() > 4,
            "the renderer may facet the arc"
        );
        assert!(!meshes[0].indices.is_empty());
    }

    /// One upright wall panel, straight or curved, described the way a
    /// generator declares it: a base run, a side rising, a run back along
    /// the top, a side coming down. `curved` swaps the rails' geometry and
    /// nothing else -- which is the whole point, since the construction is
    /// the same either way.
    fn upright_panel(
        topology: &mut ContourTopology,
        graph: &PositionGraph,
        prefix: &str,
        curved: Option<[f32; 2]>,
    ) -> ContourLoop {
        let rail = |clockwise: bool| match curved {
            Some(center) => ContourGeometry::CircularArc { center, clockwise },
            None => ContourGeometry::Line,
        };
        let spec: [(&str, &str, &str, ContourGeometry); 4] = [
            ("base", "bottom-start", "bottom-end", rail(false)),
            ("right", "bottom-end", "top-end", ContourGeometry::Line),
            ("top", "top-end", "top-start", rail(true)),
            ("left", "top-start", "bottom-start", ContourGeometry::Line),
        ];
        spec.iter()
            .map(|(name, start, end, geometry)| {
                let edge_id = ContourEdgeId::new(format!("{prefix}-{name}")).unwrap();
                topology
                    .add_edge(
                        graph,
                        ContourEdge::new(edge_id.clone(), nid(start), nid(end), *geometry),
                    )
                    .unwrap();
                OrientedEdgeUse::forward(edge_id)
            })
            .collect()
    }

    /// A half-circle panel of radius 2, three units tall, standing on the
    /// origin.
    fn curved_panel_graph() -> PositionGraph {
        graph_with_positions(&[
            ("bottom-start", [2.0, 0.0, 0.0]),
            ("bottom-end", [-2.0, 0.0, 0.0]),
            ("top-end", [-2.0, 3.0, 0.0]),
            ("top-start", [2.0, 3.0, 0.0]),
        ])
    }

    fn positions_of(graph: &PositionGraph) -> HashMap<String, [f32; 3]> {
        graph
            .snapshot()
            .nodes()
            .iter()
            .map(|node| (node.id().as_str().to_owned(), *node.data()))
            .collect()
    }

    fn mesh_of(
        topology: &ContourTopology,
        region_id: &RegionId,
        positions: &HashMap<String, [f32; 3]>,
    ) -> TriangulatedMesh {
        triangulate_region(topology, topology.region(region_id).unwrap(), |id| {
            positions.get(id.as_str()).copied()
        })
        .unwrap()
        .pop()
        .unwrap()
    }

    fn assert_every_triangle_has_area(mesh: &TriangulatedMesh) {
        for triangle in mesh.indices.chunks_exact(3) {
            let [a, b, c] = [
                triangle[0] as usize,
                triangle[1] as usize,
                triangle[2] as usize,
            ];
            let area = cross(
                sub(mesh.positions[b], mesh.positions[a]),
                sub(mesh.positions[c], mesh.positions[a]),
            );
            let length = (area[0].powi(2) + area[1].powi(2) + area[2].powi(2)).sqrt();
            assert!(length > 1e-6, "degenerate triangle at indices {a},{b},{c}");
        }
    }

    /// A curved panel is a section of a cylinder, so a best-fit plane folds
    /// it onto itself. Unrolled, it triangulates like any flat polygon and
    /// every vertex stays exactly where it was.
    #[test]
    fn a_curved_upright_panel_meshes_on_its_own_true_cylinder() {
        let graph = curved_panel_graph();
        let mut topology = ContourTopology::new();
        let loop_ = upright_panel(&mut topology, &graph, "panel", Some([0.0, 0.0]));
        let region_id = RegionId::new("panel").unwrap();
        topology
            .add_region(region_id.clone(), vec![loop_], Vec::new())
            .unwrap();

        let mesh = mesh_of(&topology, &region_id, &positions_of(&graph));

        for point in &mesh.positions {
            let radius = (point[0].powi(2) + point[2].powi(2)).sqrt();
            assert!(
                (radius - 2.0).abs() < 1e-2,
                "point left the cylinder: {point:?}"
            );
            assert!(point[1] == 0.0 || point[1] == 3.0);
        }
        assert_every_triangle_has_area(&mesh);
        assert!(
            mesh.normals.iter().any(|normal| {
                let first = mesh.normals[0];
                (normal[0] - first[0]).abs() > 1e-3 || (normal[2] - first[2]).abs() > 1e-3
            }),
            "a curved panel must not shade as one flat face"
        );
        for normal in &mesh.normals {
            assert!(
                normal[1].abs() < 1e-3,
                "an upright panel's normals stay horizontal, got {normal:?}"
            );
        }
    }

    /// The straight panel is the same map with an infinite radius, so it
    /// takes the same path -- and comes out as the four corners and two
    /// triangles it always was.
    #[test]
    fn a_straight_upright_panel_takes_the_same_path_and_stays_four_corners() {
        let graph = graph_with_positions(&[
            ("bottom-start", [0.0, 0.0, 0.0]),
            ("bottom-end", [4.0, 0.0, 0.0]),
            ("top-end", [4.0, 3.0, 0.0]),
            ("top-start", [0.0, 3.0, 0.0]),
        ]);
        let mut topology = ContourTopology::new();
        let loop_ = upright_panel(&mut topology, &graph, "flat", None);
        let region_id = RegionId::new("flat").unwrap();
        topology
            .add_region(region_id.clone(), vec![loop_], Vec::new())
            .unwrap();

        let mesh = mesh_of(&topology, &region_id, &positions_of(&graph));

        assert_eq!(mesh.positions.len(), 4);
        assert_eq!(mesh.indices.len(), 6);
        assert_every_triangle_has_area(&mesh);
        let first = mesh.normals[0];
        for normal in &mesh.normals {
            assert!(normal[1].abs() < 1e-3);
            assert!(
                (normal[0] - first[0]).abs() < 1e-4 && (normal[2] - first[2]).abs() < 1e-4,
                "a flat panel shades as one face"
            );
        }
    }

    /// The reason for unrolling at all: an opening is an ordinary hole in an
    /// ordinary 2D polygon once the panel is flat, so a curved wall can carry
    /// a window. A strip built facet by facet had nowhere to put one.
    #[test]
    fn a_curved_upright_panel_carries_an_opening() {
        let mut nodes = vec![
            ("bottom-start", [2.0, 0.0, 0.0]),
            ("bottom-end", [-2.0, 0.0, 0.0]),
            ("top-end", [-2.0, 3.0, 0.0]),
            ("top-start", [2.0, 3.0, 0.0]),
        ];
        // Four rim corners on the same cylinder, between a quarter and a
        // half turn round it, one and two units up.
        let rim: Vec<(String, [f32; 3])> = [(0.6_f32, 1.0_f32), (1.1, 1.0), (1.1, 2.0), (0.6, 2.0)]
            .iter()
            .enumerate()
            .map(|(index, (angle, height))| {
                (
                    format!("rim{index}"),
                    [2.0 * angle.cos(), *height, 2.0 * angle.sin()],
                )
            })
            .collect();
        let owned: Vec<(&str, [f32; 3])> = rim
            .iter()
            .map(|(id, position)| (id.as_str(), *position))
            .collect();
        nodes.extend(owned);
        let graph = graph_with_positions(&nodes);

        let mut topology = ContourTopology::new();
        let outer = upright_panel(&mut topology, &graph, "panel", Some([0.0, 0.0]));
        let hole = line_loop(
            &mut topology,
            &graph,
            "rim",
            &["rim0", "rim1", "rim2", "rim3"],
        );
        let region_id = RegionId::new("panel").unwrap();
        topology
            .add_region(region_id.clone(), vec![outer], vec![hole])
            .unwrap();

        let mesh = mesh_of(&topology, &region_id, &positions_of(&graph));

        assert_every_triangle_has_area(&mesh);
        for triangle in mesh.indices.chunks_exact(3) {
            let centroid = triangle.iter().fold([0.0; 3], |sum, index| {
                let point = mesh.positions[*index as usize];
                [
                    sum[0] + point[0] / 3.0,
                    sum[1] + point[1] / 3.0,
                    sum[2] + point[2] / 3.0,
                ]
            });
            let angle = centroid[2].atan2(centroid[0]);
            assert!(
                !(0.6..=1.1).contains(&angle) || !(1.0..=2.0).contains(&centroid[1]),
                "a triangle covered the opening: {centroid:?}"
            );
        }
    }

    /// A panel whose base has since been subdivided -- a T-junction welding
    /// another wall onto its side -- is still the same upright face, so it
    /// must still unroll rather than fall back to a plane.
    #[test]
    fn a_panel_with_a_welded_base_is_still_an_upright_face() {
        let graph = graph_with_positions(&[
            ("bottom-start", [2.0, 0.0, 0.0]),
            ("mid", [0.0, 0.0, 2.0]),
            ("bottom-end", [-2.0, 0.0, 0.0]),
            ("top-end", [-2.0, 3.0, 0.0]),
            ("top-start", [2.0, 3.0, 0.0]),
        ]);
        let mut topology = ContourTopology::new();
        let arc = |clockwise: bool| ContourGeometry::CircularArc {
            center: [0.0, 0.0],
            clockwise,
        };
        let spec: [(&str, &str, &str, ContourGeometry); 5] = [
            ("base-a", "bottom-start", "mid", arc(false)),
            ("base-b", "mid", "bottom-end", arc(false)),
            ("right", "bottom-end", "top-end", ContourGeometry::Line),
            ("top", "top-end", "top-start", arc(true)),
            ("left", "top-start", "bottom-start", ContourGeometry::Line),
        ];
        let loop_: ContourLoop = spec
            .iter()
            .map(|(name, start, end, geometry)| {
                let edge_id = ContourEdgeId::new(*name).unwrap();
                topology
                    .add_edge(
                        &graph,
                        ContourEdge::new(edge_id.clone(), nid(start), nid(end), *geometry),
                    )
                    .unwrap();
                OrientedEdgeUse::forward(edge_id)
            })
            .collect();
        let region_id = RegionId::new("welded").unwrap();
        topology
            .add_region(region_id.clone(), vec![loop_], Vec::new())
            .unwrap();

        let mesh = mesh_of(&topology, &region_id, &positions_of(&graph));

        assert_every_triangle_has_area(&mesh);
        for point in &mesh.positions {
            let radius = (point[0].powi(2) + point[2].powi(2)).sqrt();
            assert!(
                (radius - 2.0).abs() < 1e-2,
                "a welded panel still meshes on its own cylinder: {point:?}"
            );
        }
    }

    /// A window in a straight wall, kept as a regression on the whole
    /// chain: the opening reaches the mesh, and the mesh leaves it open.
    ///
    /// It used to be dropped twice over -- the containment test that
    /// assigns a hole to an outer loop could never place one for an upright
    /// panel, whose ring collapses to a line in XZ, and the strip that meshed
    /// such panels had nowhere to punch it anyway. Unrolling settles both:
    /// the face carries its own openings, flat, before earcut ever sees it.
    #[test]
    fn a_vertical_face_keeps_the_hole_punched_in_it() {
        let graph = graph_with_positions(&[
            ("o0", [0.0, 0.0, 0.0]),
            ("o1", [4.0, 0.0, 0.0]),
            ("o2", [4.0, 3.0, 0.0]),
            ("o3", [0.0, 3.0, 0.0]),
            ("h0", [1.0, 1.0, 0.0]),
            ("h1", [1.0, 2.0, 0.0]),
            ("h2", [3.0, 2.0, 0.0]),
            ("h3", [3.0, 1.0, 0.0]),
        ]);
        let mut topology = ContourTopology::new();
        let outer = line_loop(&mut topology, &graph, "outer", &["o0", "o1", "o2", "o3"]);
        let hole = line_loop(&mut topology, &graph, "hole", &["h0", "h1", "h2", "h3"]);
        let region_id = RegionId::new("panel").unwrap();
        topology
            .add_region(region_id.clone(), vec![outer], vec![hole])
            .unwrap();
        let positions = graph
            .snapshot()
            .nodes()
            .iter()
            .map(|node| (node.id().as_str().to_owned(), *node.data()))
            .collect::<HashMap<_, _>>();

        let mesh = triangulate_region(&topology, topology.region(&region_id).unwrap(), |id| {
            positions.get(id.as_str()).copied()
        })
        .unwrap()
        .pop()
        .unwrap();

        for triangle in mesh.indices.chunks_exact(3) {
            let centroid = triangle.iter().fold([0.0; 3], |sum, index| {
                let point = mesh.positions[*index as usize];
                [
                    sum[0] + point[0] / 3.0,
                    sum[1] + point[1] / 3.0,
                    sum[2] + point[2] / 3.0,
                ]
            });
            assert!(
                centroid[0] <= 1.0
                    || centroid[0] >= 3.0
                    || centroid[1] <= 1.0
                    || centroid[1] >= 2.0,
                "a triangle covered the opening: {centroid:?}"
            );
        }
    }

    #[test]
    fn analytic_region_hole_receives_no_mesh_triangles() {
        let graph = graph_with_positions(&[
            ("o0", [-2.0, 0.0, -2.0]),
            ("o1", [2.0, 0.0, -2.0]),
            ("o2", [2.0, 0.0, 2.0]),
            ("o3", [-2.0, 0.0, 2.0]),
            ("h0", [-0.5, 0.0, -0.5]),
            ("h1", [-0.5, 0.0, 0.5]),
            ("h2", [0.5, 0.0, 0.5]),
            ("h3", [0.5, 0.0, -0.5]),
        ]);
        let mut topology = ContourTopology::new();
        let outer = line_loop(&mut topology, &graph, "outer", &["o0", "o1", "o2", "o3"]);
        let hole = line_loop(&mut topology, &graph, "hole", &["h0", "h1", "h2", "h3"]);
        let region_id = RegionId::new("with-hole").unwrap();
        topology
            .add_region(region_id.clone(), vec![outer], vec![hole])
            .unwrap();
        let positions = graph
            .snapshot()
            .nodes()
            .iter()
            .map(|node| (node.id().as_str().to_owned(), *node.data()))
            .collect::<HashMap<_, _>>();

        let mesh = triangulate_region(&topology, topology.region(&region_id).unwrap(), |id| {
            positions.get(id.as_str()).copied()
        })
        .unwrap()
        .pop()
        .unwrap();

        for triangle in mesh.indices.chunks_exact(3) {
            let centroid = triangle.iter().fold([0.0; 3], |sum, index| {
                let point = mesh.positions[*index as usize];
                [
                    sum[0] + point[0] / 3.0,
                    sum[1] + point[1] / 3.0,
                    sum[2] + point[2] / 3.0,
                ]
            });
            assert!(
                centroid[0] <= -0.5
                    || centroid[0] >= 0.5
                    || centroid[2] <= -0.5
                    || centroid[2] >= 0.5,
                "triangle centroid entered the analytic hole: {centroid:?}"
            );
        }
    }
}
