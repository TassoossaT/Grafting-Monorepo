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
//! A curved `Surface` (see [`grafting_graph_core::SurfaceCurvature`]) keeps
//! exactly 4 graph-cycle corners, the same as a straight one -- the actual
//! arc only exists here, tessellated into a strip of quads right before
//! triangulation, never persisted back onto the graph. Tessellation
//! resolution is this crate's own fixed [`ARC_TESSELLATION_TOLERANCE`], not
//! a value a caller supplies or the graph stores -- controlling render
//! resolution is a rendering concern, not a construction-time one.
//!
//! That strip is built directly (a triangle per half of each tessellated
//! quad segment), **not** by flattening the curve into one many-point ring
//! and handing it to `earcut` -- a curved wall's mesh is a section of a
//! cylinder, so its vertices do not lie on one flat plane, and `earcut`'s
//! own 3D-to-2D projection assumes (near-)planarity. Folding a real curve
//! onto that best-fit plane self-intersects in 2D for anything but the
//! shallowest arc, producing triangles that visibly cut across the surface
//! instead of following it.

use earcut::{Earcut, utils3d};

use grafting_graph_core::{
    ArcBulge, ContourEdge, ContourGeometry, ContourLoop, ContourTopology, NodeId, OrientedEdgeUse,
    SurfaceCurvature, SurfaceRegion,
};

/// Maximum deviation, in world units, between a tessellated arc's chords and
/// the true circle they approximate -- see this module's own top-level doc
/// for why this is a fixed constant here rather than a caller-supplied
/// value: nothing upstream of rendering has a legitimate reason to care
/// about tessellation resolution.
const ARC_TESSELLATION_TOLERANCE: f32 = 0.03;

/// How far apart, in world units, a side edge's two endpoints may be in XZ
/// and still count as one vertical line for [`ruled_strip_mesh`]. Only ever
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

/// Triangulates a simple (hole-free) polygon given by `positions` -- an
/// ordered ring, e.g. `Surface::cycle()`'s node ids resolved to their
/// current graph positions. When `curvature` is given and `positions` is
/// exactly the 4-corner shape [`crate`]'s own doc describes (bottom start,
/// bottom end, top end, top start), the two curved edges are tessellated
/// into a many-point ring first, at [`ARC_TESSELLATION_TOLERANCE`]. Returns `None` for
/// fewer than 3 positions or a degenerate (collinear/zero-area) ring; both
/// are states a caller may see transiently mid-edit, not error conditions
/// to propagate.
pub fn triangulate_surface(
    positions: &[[f32; 3]],
    curvature: Option<SurfaceCurvature>,
) -> Option<TriangulatedMesh> {
    if let Some(curvature) = curvature {
        if positions.len() == 4 {
            return triangulate_curved_quad(positions, curvature);
        }
    }

    if positions.len() < 3 {
        return None;
    }

    let mut projected: Vec<[f32; 2]> = Vec::new();
    if !utils3d::project3d_to_2d(positions, positions.len(), &mut projected) {
        return None;
    }

    let mut earcut = Earcut::new();
    let mut indices: Vec<u32> = Vec::new();
    earcut.earcut(projected, &[] as &[u32], &mut indices);
    if indices.is_empty() {
        return None;
    }

    let normal = face_normal(positions).unwrap_or([0.0, 0.0, 1.0]);
    Some(TriangulatedMesh {
        positions: positions.to_vec(),
        normals: vec![normal; positions.len()],
        indices,
    })
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
    // A vertical ruled strip's own boundary ring lies on no single plane
    // (see [`ruled_strip_mesh`]), so it can never survive the projection-
    // and-earcut path below. Detected per outer loop, from the loop's own
    // analytic edges, before anything has been flattened. Skipped outright
    // when the region carries holes: a strip has no interior to punch.
    let mut strips: Vec<Option<TriangulatedMesh>> = if region.holes().is_empty() {
        region
            .outer_loops()
            .iter()
            .map(|loop_| ruled_strip_mesh(topology, loop_, &mut resolve_position))
            .collect()
    } else {
        vec![None; region.outer_loops().len()]
    };

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

    // A hole only ever cleanly nests inside a *single* outer loop when that
    // outer loop is one connected piece the hole was actually carved out
    // of. A region can legitimately have several disjoint outer loops at
    // once (several unrelated surfaces consumed by the same merge, never
    // sharing an edge to collapse into one ring -- see `region_merge.rs`),
    // and a hole spanning across more than one of them, or landing outside
    // all of them, doesn't correspond to any single owner. That must not
    // fail the *entire* region's mesh -- every other, cleanly-owned piece
    // still has to render -- so an unresolvable hole is simply dropped
    // (that one piece renders as its own full, unnotched loop) rather than
    // this whole function returning `None`.
    let owners: Vec<Option<usize>> = holes
        .iter()
        .map(|hole| {
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
            if let Some(strip) = strips[index].take() {
                return Some(strip);
            }
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
    // A region's own contour geometry (`ContourGeometry::CircularArc`) is
    // always authored in the XZ plane (see `grafting_graph_core::contour`'s
    // own "spatial policy" doc), but the *surface* it bounds is not -- a
    // vertical wall or tower panel has constant X or Z and only varies in
    // Y, which a naive `[x, z]` drop projects onto a degenerate
    // (near-zero-area) line. `project3d_to_2d` derives the ring's own
    // best-fit plane instead, the same general projection
    // `triangulate_surface`'s own flat (non-curved) path already uses --
    // for an XZ-planar region (terrain, a path-brush stroke) that best-fit
    // plane so happens to already be XZ, so this changes no existing output.
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

/// A loop of four contour edges whose two side edges are vertical -- both
/// endpoints at the same XZ point, differing only in Y -- and at least one
/// of whose two rails is a circular arc describes a *ruled strip*: a
/// section of a cylinder, not a flat polygon. Its boundary ring genuinely
/// lies on no single plane, so [`triangulate_contour_loops`]'s own
/// projection has no plane to find and folds the ring onto itself, emitting
/// triangles that visibly cut across the surface -- the same failure this
/// crate's own top-level doc describes for the non-analytic path.
///
/// This builds the strip directly instead: the bottom rail's own
/// tessellated polyline, those same XZ points lifted to the top rail's own
/// heights, then [`ruled_strip`].
///
/// The condition is a statement about a region's own geometry, not about
/// whatever produced it -- any region shaped this way takes this path.
/// `None` whenever the shape does not match, which leaves the loop on the
/// general path completely unchanged.
fn ruled_strip_mesh(
    topology: &ContourTopology,
    loop_: &ContourLoop,
    resolve_position: &mut impl FnMut(&NodeId) -> Option<[f32; 3]>,
) -> Option<TriangulatedMesh> {
    if loop_.len() != 4 {
        return None;
    }
    let mut edges: Vec<(ContourEdge, [f32; 3], [f32; 3])> = Vec::with_capacity(4);
    for use_ in loop_ {
        let edge = traversed_edge(topology, use_)?;
        let start = resolve_position(edge.start_node())?;
        let end = resolve_position(edge.end_node())?;
        edges.push((edge, start, end));
    }

    let is_vertical = |entry: &(ContourEdge, [f32; 3], [f32; 3])| {
        let (edge, start, end) = entry;
        matches!(edge.geometry(), ContourGeometry::Line)
            && (start[0] - end[0]).abs() <= VERTICAL_SIDE_EPSILON
            && (start[2] - end[2]).abs() <= VERTICAL_SIDE_EPSILON
    };
    if !is_vertical(&edges[1]) || !is_vertical(&edges[3]) {
        return None;
    }
    let is_curved = |entry: &(ContourEdge, [f32; 3], [f32; 3])| {
        matches!(entry.0.geometry(), ContourGeometry::CircularArc { .. })
    };
    if !is_curved(&edges[0]) && !is_curved(&edges[2]) {
        return None;
    }

    let (bottom_edge, bottom_start, bottom_end) = &edges[0];
    let (_, top_start, top_end) = &edges[2];
    let planar = bottom_edge.tessellate(
        [bottom_start[0], bottom_start[2]],
        [bottom_end[0], bottom_end[2]],
        ARC_TESSELLATION_TOLERANCE,
    );
    let count = planar.len();
    if count < 2 {
        return None;
    }

    // The top rail runs the opposite way round the loop, so the corner
    // above the bottom rail's own *start* is the top rail's own *end*.
    let mut bottom_rail = Vec::with_capacity(count);
    let mut top_rail = Vec::with_capacity(count);
    for (index, point) in planar.iter().enumerate() {
        let t = index as f32 / (count - 1) as f32;
        bottom_rail.push([
            point[0],
            bottom_start[1] + (bottom_end[1] - bottom_start[1]) * t,
            point[1],
        ]);
        top_rail.push([
            point[0],
            top_end[1] + (top_start[1] - top_end[1]) * t,
            point[1],
        ]);
    }
    ruled_strip(&bottom_rail, &top_rail)
}

/// Triangulates two equal-length rails into a strip: consecutive rail pairs
/// interleaved bottom-then-top, two triangles per facet between them, and
/// each triangle carrying the real cross product of its own edges as its
/// normal (not an idealized "radially outward" formula), so shading stays
/// correct whichever way the strip bends. `None` for fewer than 2 pairs or
/// rails of differing length.
fn ruled_strip(bottom: &[[f32; 3]], top: &[[f32; 3]]) -> Option<TriangulatedMesh> {
    let count = bottom.len();
    if count < 2 || top.len() != count {
        return None;
    }

    let mut positions = Vec::with_capacity(count * 2);
    for index in 0..count {
        positions.push(bottom[index]);
        positions.push(top[index]);
    }

    let mut normals = vec![[0.0, 0.0, 1.0]; positions.len()];
    let mut indices = Vec::with_capacity((count - 1) * 6);
    for index in 0..count - 1 {
        let bottom_a = index * 2;
        let top_a = bottom_a + 1;
        let bottom_b = bottom_a + 2;
        let top_b = bottom_a + 3;

        let facet_normal = unit_normal(cross(
            sub(positions[bottom_b], positions[bottom_a]),
            sub(positions[top_a], positions[bottom_a]),
        ));
        for vertex in [bottom_a, top_a, bottom_b, top_b] {
            normals[vertex] = facet_normal;
        }

        indices.extend_from_slice(&[
            bottom_a as u32,
            bottom_b as u32,
            top_a as u32,
            top_a as u32,
            bottom_b as u32,
            top_b as u32,
        ]);
    }

    Some(TriangulatedMesh {
        positions,
        normals,
        indices,
    })
}

/// Triangulates a curved quad (see [`crate`]'s own doc for the 4-corner
/// shape) as a ruled strip: the bottom edge's own tessellated arc paired
/// with the same arc mirrored at the top's own height, two triangles per
/// facet between consecutive pairs. Each triangle's own normal is the real
/// cross product of its own edges (not an idealized "radially outward"
/// formula), so it stays correct regardless of which way `curvature.bulge`
/// faces. `None` only if [`tessellate_arc`] returns fewer than 2 points --
/// unreachable in practice, since [`ARC_TESSELLATION_TOLERANCE`] always
/// yields at least a 2-point (start, end) polyline.
fn triangulate_curved_quad(
    positions: &[[f32; 3]],
    curvature: SurfaceCurvature,
) -> Option<TriangulatedMesh> {
    let (bottom_start, bottom_end, top_end, top_start) =
        (positions[0], positions[1], positions[2], positions[3]);

    let bottom_arc = tessellate_arc(
        bottom_start,
        bottom_end,
        curvature.center,
        curvature.bulge,
        ARC_TESSELLATION_TOLERANCE,
    );
    let mut top_arc: Vec<[f32; 3]> = bottom_arc
        .iter()
        .map(|point| [point[0], top_end[1], point[2]])
        .collect();
    if let Some(first) = top_arc.first_mut() {
        *first = top_start;
    }
    if let Some(last) = top_arc.last_mut() {
        *last = top_end;
    }

    ruled_strip(&bottom_arc, &top_arc)
}

fn unit_normal(vector: [f32; 3]) -> [f32; 3] {
    let length = (vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]).sqrt();
    if length <= f32::EPSILON {
        return [0.0, 0.0, 1.0];
    }
    [vector[0] / length, vector[1] / length, vector[2] / length]
}

/// Tessellates one circular-arc edge into a polyline, `start` to `end` in
/// order, around `center` (in the same XZ plane as `start`/`end`). The
/// facet count is derived from `tolerance` (the maximum allowed deviation,
/// in world units, between a chord and the true circle) rather than being a
/// caller-chosen input -- see this module's own top-level doc. The first
/// and last points are forced to the exact input `start`/`end` (not just
/// approximately equal after the trig round-trip), so a tessellated arc's
/// own endpoints weld byte-identically with whatever straight edge or other
/// arc shares that same corner.
///
/// General to any circular arc, not only a semicircle: the arc's own swept
/// angle is not a separate stored input (matching
/// `grafting_graph_core::SurfaceCurvature`'s own doc that `(start, end,
/// center, bulge)` is a curved edge's complete description) -- it is
/// recovered from `center`'s own offset off the chord, via the same
/// apothem relationship `grafting_procgen_structure_generation::extrusion`'s
/// own `arc_center` uses to place `center` in the first place.
fn tessellate_arc(
    start: [f32; 3],
    end: [f32; 3],
    center: [f32; 2],
    bulge: ArcBulge,
    tolerance: f32,
) -> Vec<[f32; 3]> {
    let y = start[1];
    let (sx, sz) = (start[0], start[2]);
    let (ex, ez) = (end[0], end[2]);
    let (mx, mz) = (center[0], center[1]);
    let chord_length = ((ex - sx).powi(2) + (ez - sz).powi(2)).sqrt();
    let radius = ((sx - mx).powi(2) + (sz - mz).powi(2))
        .sqrt()
        .max(f32::EPSILON);
    let (ux, uz) = ((ex - sx) / chord_length, (ez - sz) / chord_length);
    let (nx, nz) = (-uz, ux);
    let sign: f32 = match bulge {
        ArcBulge::Left => 1.0,
        ArcBulge::Right => -1.0,
    };

    let (midx, midz) = ((sx + ex) / 2.0, (sz + ez) / 2.0);
    let apothem = -sign * ((mx - midx) * nx + (mz - midz) * nz);
    let included_angle = 2.0 * (chord_length / 2.0).atan2(apothem);

    // Max angular step such that a chord's own sagitta stays under `tolerance`.
    let clamped_tolerance = tolerance.max(f32::EPSILON).min(radius);
    let max_step = 2.0 * (1.0 - clamped_tolerance / radius).clamp(-1.0, 1.0).acos();
    let facets = (included_angle.abs() / max_step.max(f32::EPSILON))
        .ceil()
        .max(1.0) as usize;

    let mut points: Vec<[f32; 3]> = Vec::with_capacity(facets + 1);
    for step in 0..=facets {
        if step == 0 {
            points.push(start);
            continue;
        }
        if step == facets {
            points.push(end);
            continue;
        }
        let t = step as f32 / facets as f32;
        let theta = std::f32::consts::FRAC_PI_2 + included_angle * (0.5 - t);
        let x = mx + radius * theta.cos() * ux + sign * radius * theta.sin() * nx;
        let z = mz + radius * theta.cos() * uz + sign * radius * theta.sin() * nz;
        points.push([x, y, z]);
    }
    points
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
    fn fewer_than_three_positions_is_none() {
        assert_eq!(triangulate_surface(&[], None), None);
        assert_eq!(
            triangulate_surface(&[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]], None),
            None
        );
    }

    #[test]
    fn collinear_positions_are_none() {
        let collinear = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]];
        assert_eq!(triangulate_surface(&collinear, None), None);
    }

    #[test]
    fn triangle_produces_one_face() {
        let triangle = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let mesh = triangulate_surface(&triangle, None).expect("valid triangle");
        assert_eq!(mesh.positions, triangle);
        assert_eq!(mesh.normals.len(), 3);
        assert_eq!(mesh.indices.len(), 3);
        for normal in &mesh.normals {
            let length =
                (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
            assert!(
                (length - 1.0).abs() < 1e-4,
                "normal not unit length: {normal:?}"
            );
        }
    }

    #[test]
    fn axis_aligned_quad_produces_two_faces() {
        let quad = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
        ];
        let mesh = triangulate_surface(&quad, None).expect("valid quad");
        assert_eq!(mesh.positions, quad);
        assert_eq!(mesh.indices.len(), 6, "two triangles = six indices");
        for normal in &mesh.normals {
            assert!(
                (normal[2].abs() - 1.0).abs() < 1e-4,
                "quad in the XY plane should have a Z-aligned normal, got {normal:?}"
            );
        }
    }

    #[test]
    fn concave_hexagon_triangulates_without_fan_artifacts() {
        // An "L"-shaped hexagon: convex fan triangulation from vertex 0
        // would produce a triangle crossing outside the polygon; earcut
        // must not.
        let hexagon = [
            [0.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [2.0, 1.0, 0.0],
            [1.0, 1.0, 0.0],
            [1.0, 2.0, 0.0],
            [0.0, 2.0, 0.0],
        ];
        let mesh = triangulate_surface(&hexagon, None).expect("valid concave hexagon");
        assert_eq!(mesh.positions, hexagon);
        // A simple hexagon triangulates into exactly 4 triangles (n - 2).
        assert_eq!(mesh.indices.len(), 12);
        for index in &mesh.indices {
            assert!((*index as usize) < hexagon.len());
        }
    }

    #[test]
    fn a_curved_quads_four_corners_tessellate_into_a_bottom_top_strip() {
        // Same 4-corner shape `extrusion.rs::quad_piece` mints for a
        // semicircle edge: bottom start, bottom end, top end, top start.
        let corners = [
            [0.0, 0.0, 0.0],
            [4.0, 0.0, 0.0],
            [4.0, 3.0, 0.0],
            [0.0, 3.0, 0.0],
        ];
        let curvature = SurfaceCurvature {
            center: [2.0, 0.0],
            bulge: ArcBulge::Left,
        };
        let mesh = triangulate_surface(&corners, Some(curvature)).expect("valid curved quad");
        // Interleaved bottom/top pairs -- always an even position count, at
        // least the 2 pairs (4 points) a degenerate single-segment strip needs.
        assert!(mesh.positions.len() >= 4 && mesh.positions.len() % 2 == 0);
        let last = mesh.positions.len();
        assert_eq!(
            mesh.positions[0],
            [0.0, 0.0, 0.0],
            "first pair's bottom is the edge's own start"
        );
        assert_eq!(
            mesh.positions[1],
            [0.0, 3.0, 0.0],
            "first pair's top is directly above the start"
        );
        assert_eq!(
            mesh.positions[last - 2],
            [4.0, 0.0, 0.0],
            "last pair's bottom is the edge's own end"
        );
        assert_eq!(
            mesh.positions[last - 1],
            [4.0, 3.0, 0.0],
            "last pair's top is directly above the end"
        );
        // Two triangles (6 indices) per quad segment between consecutive pairs.
        assert_eq!(mesh.indices.len(), (last / 2 - 1) * 6);
        for index in &mesh.indices {
            assert!((*index as usize) < mesh.positions.len());
        }
        assert_eq!(mesh.normals.len(), mesh.positions.len());
        for normal in &mesh.normals {
            let length =
                (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
            assert!(
                (length - 1.0).abs() < 1e-4,
                "normal not unit length: {normal:?}"
            );
        }
    }

    /// A minor (< 180°) arc, whose own `center` is off the chord (the exact
    /// case a semicircle-only formula could never place correctly -- see
    /// `extrusion.rs::arc_center`'s own doc) tessellates its own midpoint at
    /// the correct radius from `center`, not the chord's own midpoint.
    #[test]
    fn a_minor_arc_tessellates_through_its_own_true_circle() {
        // A regular triangle inscribed in a radius-2 circle centered at the
        // origin: one 120° edge from (2,0) to (-1, 1.7320508), bulging Right
        // (see `extrusion.rs`'s own matching test for the derivation).
        let bottom = [2.0, 0.0, 0.0];
        let end = [-1.0, 0.0, 1.7320508];
        let corners = [
            bottom,
            end,
            [end[0], 3.0, end[2]],
            [bottom[0], 3.0, bottom[2]],
        ];
        let curvature = SurfaceCurvature {
            center: [0.0, 0.0],
            bulge: ArcBulge::Right,
        };
        let mesh = triangulate_surface(&corners, Some(curvature)).expect("valid curved quad");

        // Every bottom point (even indices) must sit on the true circle:
        // distance 2 from the origin, not from the chord.
        for bottom in mesh.positions.iter().step_by(2) {
            let distance_from_center = (bottom[0].powi(2) + bottom[2].powi(2)).sqrt();
            assert!(
                (distance_from_center - 2.0).abs() < 1e-3,
                "expected the true circle's own radius (2.0), got {distance_from_center}"
            );
        }

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
            let length = (area[0] * area[0] + area[1] * area[1] + area[2] * area[2]).sqrt();
            assert!(length > 1e-6, "degenerate triangle at indices {a},{b},{c}");
        }
    }

    /// Every triangle in a curved quad's own strip must be a real,
    /// non-degenerate triangle (nonzero area) -- the regression case for the
    /// old earcut-on-a-flattened-ring approach, which could fold the strip
    /// onto itself and emit triangles that visibly cut across the surface.
    #[test]
    fn every_triangle_in_a_curved_strip_has_nonzero_area() {
        let corners = [
            [0.0, 0.0, 0.0],
            [4.0, 0.0, 0.0],
            [4.0, 3.0, 0.0],
            [0.0, 3.0, 0.0],
        ];
        let curvature = SurfaceCurvature {
            center: [2.0, 0.0],
            bulge: ArcBulge::Left,
        };
        let mesh = triangulate_surface(&corners, Some(curvature)).expect("valid curved quad");
        for triangle in mesh.indices.chunks_exact(3) {
            let [a, b, c] = [
                triangle[0] as usize,
                triangle[1] as usize,
                triangle[2] as usize,
            ];
            let edge_ab = sub(mesh.positions[b], mesh.positions[a]);
            let edge_ac = sub(mesh.positions[c], mesh.positions[a]);
            let area = cross(edge_ab, edge_ac);
            let length = (area[0] * area[0] + area[1] * area[1] + area[2] * area[2]).sqrt();
            assert!(length > 1e-6, "degenerate triangle at indices {a},{b},{c}");
        }
    }

    #[test]
    fn curvature_is_ignored_when_positions_are_not_a_four_corner_quad() {
        let triangle = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let curvature = SurfaceCurvature {
            center: [0.5, 0.0],
            bulge: ArcBulge::Left,
        };
        let mesh = triangulate_surface(&triangle, Some(curvature)).expect("valid triangle");
        assert_eq!(
            mesh.positions, triangle,
            "curvature only applies to the 4-corner quad shape a curved edge mints"
        );
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

    /// A curved *wall panel* region -- a bottom arc, a vertical side, the
    /// same arc back along the top, another vertical side -- is a section of
    /// a cylinder whose ring lies on no plane. It must take the ruled-strip
    /// path, not projection-and-earcut: every triangle real, and the facet
    /// normals genuinely turning along the arc rather than one flat normal
    /// shared by the whole panel.
    #[test]
    fn a_curved_wall_panel_region_meshes_as_a_ruled_strip() {
        let graph = graph_with_positions(&[
            ("bottom-start", [2.0, 0.0, 0.0]),
            ("bottom-end", [-2.0, 0.0, 0.0]),
            ("top-end", [-2.0, 3.0, 0.0]),
            ("top-start", [2.0, 3.0, 0.0]),
        ]);
        let mut topology = ContourTopology::new();
        let arc = |clockwise: bool| ContourGeometry::CircularArc {
            center: [0.0, 0.0],
            clockwise,
        };
        let spec: [(&str, &str, &str, ContourGeometry); 4] = [
            ("base", "bottom-start", "bottom-end", arc(false)),
            ("right", "bottom-end", "top-end", ContourGeometry::Line),
            ("top", "top-end", "top-start", arc(true)),
            ("left", "top-start", "bottom-start", ContourGeometry::Line),
        ];
        let loop_ = spec
            .iter()
            .map(|(id, start, end, geometry)| {
                let edge_id = ContourEdgeId::new(*id).unwrap();
                topology
                    .add_edge(
                        &graph,
                        ContourEdge::new(edge_id.clone(), nid(start), nid(end), *geometry),
                    )
                    .unwrap();
                OrientedEdgeUse::forward(edge_id)
            })
            .collect();
        let region_id = RegionId::new("panel").unwrap();
        topology
            .add_region(region_id.clone(), vec![loop_], Vec::new())
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

        // Interleaved bottom/top pairs, both rails on the true circle.
        assert!(mesh.positions.len() >= 4 && mesh.positions.len() % 2 == 0);
        for point in &mesh.positions {
            let radius = (point[0].powi(2) + point[2].powi(2)).sqrt();
            assert!(
                (radius - 2.0).abs() < 1e-2,
                "point left the true cylinder: {point:?}"
            );
            assert!(point[1] == 0.0 || point[1] == 3.0);
        }
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
            let length = (area[0] * area[0] + area[1] * area[1] + area[2] * area[2]).sqrt();
            assert!(length > 1e-6, "degenerate triangle at indices {a},{b},{c}");
        }
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
                "a vertical panel's own normals stay horizontal, got {normal:?}"
            );
        }
    }

    /// A *flat* vertical panel -- same shape, straight rails -- has a
    /// perfectly good plane, so it must stay on the general path and keep
    /// its own four-corner ring rather than being widened into a strip.
    #[test]
    fn a_flat_vertical_panel_region_stays_on_the_general_path() {
        let graph = graph_with_positions(&[
            ("a", [0.0, 0.0, 0.0]),
            ("b", [4.0, 0.0, 0.0]),
            ("c", [4.0, 3.0, 0.0]),
            ("d", [0.0, 3.0, 0.0]),
        ]);
        let mut topology = ContourTopology::new();
        let loop_ = line_loop(&mut topology, &graph, "flat", &["a", "b", "c", "d"]);
        let region_id = RegionId::new("flat-panel").unwrap();
        topology
            .add_region(region_id.clone(), vec![loop_], Vec::new())
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

        assert_eq!(mesh.positions.len(), 4);
        assert_eq!(mesh.indices.len(), 6);
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
