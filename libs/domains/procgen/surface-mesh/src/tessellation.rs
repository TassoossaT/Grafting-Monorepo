//! Tessellation of analytic contour loops into discrete 3D vertex chains.

use grafting_graph_core::{ContourEdge, ContourLoop, ContourTopology, NodeId, OrientedEdgeUse};

use crate::types::ARC_TESSELLATION_TOLERANCE;

/// One loop entry resolved into an edge that runs the way the loop
/// traverses it -- a reversed use is rebuilt with its endpoints swapped and
/// its geometry mirrored, so every caller downstream can read `start_node`
/// and `end_node` literally.
pub fn traversed_edge(topology: &ContourTopology, use_: &OrientedEdgeUse) -> Option<ContourEdge> {
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

/// Discretizes a loop of analytic contour edges into 3D world points.
pub fn tessellate_contour_loop(
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
