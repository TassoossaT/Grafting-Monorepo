//! Triangulation of developable upright surfaces (straight or curved wall panels).

use earcut::Earcut;
use grafting_graph_core::{ContourEdge, ContourLoop, ContourTopology, NodeId, SurfaceRegion};

use crate::frame::UnrollFrame;
use crate::math::{dot, winding_normal};
use crate::tessellation::{tessellate_contour_loop, traversed_edge};
use crate::types::{TriangulatedMesh, VERTICAL_SIDE_EPSILON};

/// The rail an upright face is unrolled along, and whether the loop had the
/// shape of an upright face at all.
pub struct UprightRail {
    pub frame: UnrollFrame,
}

/// Reads a loop as an upright face: a run along the base, one side rising,
/// a run back along the top, one side coming down.
///
/// Recognised by structure rather than by counting edges, so a panel whose
/// base has since been subdivided -- a T-junction welding another wall onto
/// its side -- is still the same upright face it always was.
pub fn upright_rail(
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

    let (edge, start, _) = base.first()?;
    let (_, _, end) = base.last()?;
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
pub fn upright_face_mesh(
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

    // The flat place `earcut` works, and the face's texture coordinates, are
    // the same numbers: distance along the rail and height, both in metres.
    // So this is kept rather than consumed -- deriving it twice, or deriving
    // it again downstream from a frame that would have to be re-established
    // there, would be two ways to compute one thing.
    let unrolled: Vec<[f32; 2]> = positions
        .iter()
        .map(|point| rail.frame.unroll(*point))
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
        .map(|point| rail.frame.normal_at(*point))
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
