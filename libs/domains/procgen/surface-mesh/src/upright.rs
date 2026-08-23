//! Triangulation of developable upright surfaces (straight or curved wall panels).

use earcut::Earcut;
use grafting_graph_core::{ContourEdge, ContourLoop, ContourTopology, NodeId, SurfaceRegion};

use crate::frame::UnrollFrame;
use crate::math::{cross, dot, sub, winding_normal};
use crate::tessellation::{tessellate_contour_loop, traversed_edge};
use crate::types::{TriangulatedMesh, ARC_TESSELLATION_TOLERANCE, VERTICAL_SIDE_EPSILON};

/// The rail and structure of an upright face.
pub struct UprightStructure {
    pub frame: UnrollFrame,
    pub base_edges: Vec<(ContourEdge, [f32; 3], [f32; 3])>,
    pub top_edges: Vec<(ContourEdge, [f32; 3], [f32; 3])>,
}

/// Reads a loop as an upright face: a run along the base, one side rising,
/// a run back along the top, one side coming down.
///
/// Recognised by structure rather than by counting edges, so a panel whose
/// base has since been subdivided -- a T-junction welding another wall onto
/// its side -- is still the same upright face it always was.
pub fn upright_structure(
    topology: &ContourTopology,
    loop_: &ContourLoop,
    resolve_position: &mut impl FnMut(&NodeId) -> Option<[f32; 3]>,
) -> Option<UprightStructure> {
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
    let after_first = walked[first + 1..second].to_vec();
    let after_second = walked[second + 1..]
        .iter()
        .chain(walked[..first].iter())
        .cloned()
        .collect::<Vec<_>>();
    let mean_height = |run: &[(ContourEdge, [f32; 3], [f32; 3])]| -> Option<f32> {
        (!run.is_empty())
            .then(|| run.iter().map(|(_, start, _)| start[1]).sum::<f32>() / run.len() as f32)
    };
    let (base_edges, top_edges) = match (mean_height(&after_first), mean_height(&after_second)) {
        (Some(one), Some(other)) if one <= other => (after_first, after_second),
        (Some(_), Some(_)) => (after_second, after_first),
        _ => return None,
    };

    let (edge, start, _) = base_edges.first()?;
    let (_, _, end) = base_edges.last()?;
    let frame = UnrollFrame::of(edge.geometry(), *start, *end)?;

    Some(UprightStructure {
        frame,
        base_edges,
        top_edges,
    })
}

/// Meshes a solid curved or straight upright panel as a clean ruled strip.
///
/// Every vertex along the bottom curve is paired with the corresponding vertex
/// directly above it along the ruled vertical generator lines of the cylinder.
/// This completely prevents ear-clipping from creating diagonal chords cutting
/// through the 3D volume of the cylinder (which causes helical/twisted artifacts).
fn ruled_upright_mesh(
    base_edges: &[(ContourEdge, [f32; 3], [f32; 3])],
    top_edges: &[(ContourEdge, [f32; 3], [f32; 3])],
    frame: &UnrollFrame,
) -> Option<TriangulatedMesh> {
    let mut base_points = Vec::new();
    for (edge, start, end) in base_edges {
        let planar = edge.tessellate(
            [start[0], start[2]],
            [end[0], end[2]],
            ARC_TESSELLATION_TOLERANCE,
        );
        let count = planar.len();
        if count < 2 {
            return None;
        }
        for (index, point) in planar.iter().take(count - 1).enumerate() {
            let t = index as f32 / (count - 1) as f32;
            base_points.push([point[0], start[1] + (end[1] - start[1]) * t, point[1]]);
        }
    }
    if let Some((_, _, end)) = base_edges.last() {
        base_points.push(*end);
    }

    let count = base_points.len();
    if count < 2 {
        return None;
    }

    // The top run travels in reverse (from top_end to top_start).
    // So top_edges.last()'s end is the top point at base_start (t = 0),
    // and top_edges.first()'s start is the top point at base_end (t = 1).
    let top_start_height = top_edges.last().map(|(_, _, end)| end[1])?;
    let top_end_height = top_edges.first().map(|(_, start, _)| start[1])?;

    let mut positions = Vec::with_capacity(count * 2);
    let mut normals = Vec::with_capacity(count * 2);
    let mut uvs = Vec::with_capacity(count * 2);

    for (index, base_pt) in base_points.iter().enumerate() {
        let t = index as f32 / (count - 1) as f32;
        let top_y = top_start_height + (top_end_height - top_start_height) * t;
        let top_pt = [base_pt[0], top_y, base_pt[2]];

        let u = frame.unroll(*base_pt)[0];

        positions.push(*base_pt);
        normals.push(frame.normal_at(*base_pt));
        uvs.push([u, base_pt[1]]);

        positions.push(top_pt);
        normals.push(frame.normal_at(top_pt));
        uvs.push([u, top_pt[1]]);
    }

    let mut indices = Vec::with_capacity((count - 1) * 6);
    for index in 0..count - 1 {
        let b_a = (index * 2) as u32;
        let t_a = b_a + 1;
        let b_b = b_a + 2;
        let t_b = b_b + 1;

        let v1 = sub(positions[b_b as usize], positions[b_a as usize]);
        let v2 = sub(positions[t_a as usize], positions[b_a as usize]);
        let face_n = cross(v1, v2);
        let radial = normals[b_a as usize];

        if dot(face_n, radial) > 0.0 {
            indices.extend_from_slice(&[b_a, b_b, t_a, t_a, b_b, t_b]);
        } else {
            indices.extend_from_slice(&[b_a, t_a, b_b, t_a, t_b, b_b]);
        }
    }

    Some(TriangulatedMesh {
        positions,
        normals,
        uvs,
        indices,
    })
}

/// Meshes an upright face -- a wall panel, straight or curved, opened or
/// solid -- by unrolling it flat and triangulating there.
///
/// `None` for anything that is not one, which leaves every other region on
/// the ordinary projection path untouched. A region with more than one outer
/// loop is never one: those come from a merge, and a merge is flat.
pub fn upright_face_mesh(
    topology: &ContourTopology,
    region: &SurfaceRegion,
    resolve_position: &mut impl FnMut(&NodeId) -> Option<[f32; 3]>,
) -> Option<TriangulatedMesh> {
    let [outer_loop] = region.outer_loops() else {
        return None;
    };
    let structure = upright_structure(topology, outer_loop, resolve_position)?;

    // When the upright face is solid (has no holes), mesh it as a ruled strip.
    // This pairs every vertex on the bottom arc with the vertex directly above it
    // on the top arc along the cylinder's vertical generator lines, producing a
    // smooth cylinder surface without diagonal ear-clipping chords.
    if region.holes().is_empty() {
        if let Some(mesh) = ruled_upright_mesh(
            &structure.base_edges,
            &structure.top_edges,
            &structure.frame,
        ) {
            return Some(mesh);
        }
    }

    // General fallback path for upright panels with holes (e.g. doors, windows):
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

    // The flat place `earcut` works, and the face's texture coordinates, are
    // the same numbers: distance along the rail and height, both in metres.
    // So this is kept rather than consumed -- deriving it twice, or deriving
    // it again downstream from a frame that would have to be re-established
    // there, would be two ways to compute one thing.
    let unrolled: Vec<[f32; 2]> = positions
        .iter()
        .map(|point| structure.frame.unroll(*point))
        .collect();
    let mut earcut = Earcut::new();
    let mut indices: Vec<u32> = Vec::new();
    earcut.earcut(unrolled.iter().copied(), &hole_indices, &mut indices);
    if indices.is_empty() {
        return None;
    }

    // Which way the face actually faces is settled by the frame's outward
    // direction. If the unrolled triangle winding ended up facing inward,
    // swap the triangle winding so the mesh is front-facing from the outside.
    let normals: Vec<[f32; 3]> = positions
        .iter()
        .map(|point| structure.frame.normal_at(*point))
        .collect();
    if let Some(reference) = winding_normal(&positions, &indices) {
        let anchor = indices[0] as usize;
        let radial = normals[anchor];
        if dot(reference, radial) < 0.0 {
            for triangle in indices.chunks_exact_mut(3) {
                triangle.swap(1, 2);
            }
        }
    }

    Some(TriangulatedMesh {
        positions,
        normals,
        uvs: unrolled,
        indices,
    })
}
