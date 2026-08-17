//! Caps a closed boundary of arbitrary 3D points into one `Surface` --
//! shared by anything that needs a flat or per-vertex-height polygon capped
//! off a set of positions: a room's floor/ceiling (one shared Y across
//! every point), a terrain cell's quad (each corner its own Y), or any
//! future closed shape. No product noun: a caller decides whether the
//! points it hands in came from a room, a terrain cell, or something else.

use grafting_graph_core::{Node, NodeId, SurfaceSpec, SurfaceType};

use crate::extrusion::StructurePiece;
use crate::ids::corner_id;

/// Caps `points` (a closed boundary, in cycle order, each entry's own
/// `[x, y, z]`) into one `Surface`. `top` reverses winding relative to
/// `top: false`'s own order, so a caller minting both a floor
/// (`top: false`) and a ceiling (`top: true`) from the same XZ footprint
/// gets outward-facing normals on both -- the same convention this
/// crate previously kept duplicated per generator. Every node this mints goes through
/// [`corner_id`], keyed by `id_prefix` and each point's own `x`/`z` -- `top`
/// only picks which of a shared XZ position's two ids (top or bottom node)
/// applies, so two calls at the same XZ under the same `id_prefix` weld
/// automatically regardless of Y (`corner_id` never encodes Y itself).
pub fn cap_boundary(points: &[[f32; 3]], id_prefix: &str, surface_type: SurfaceType, top: bool) -> StructurePiece {
    let mut ids: Vec<NodeId> = points.iter().map(|point| corner_id(id_prefix, point[0], point[2], top)).collect();
    let mut nodes: Vec<Node<[f32; 3]>> = ids.iter().zip(points).map(|(id, point)| Node::new(id.clone(), *point)).collect();
    if top {
        ids.reverse();
        nodes.reverse();
    }
    StructurePiece { nodes, edges: Vec::new(), surface: SurfaceSpec { cycle: ids, surface_type, physical: true, curvature: None } }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_flat_quad_caps_with_uniform_y_and_four_corners() {
        let points = [[0.0, 1.0, 0.0], [2.0, 1.0, 0.0], [2.0, 1.0, 2.0], [0.0, 1.0, 2.0]];
        let piece = cap_boundary(&points, "floor-1", SurfaceType::new("floor"), false);
        assert_eq!(piece.nodes.len(), 4);
        assert!(piece.nodes.iter().all(|node| node.data()[1] == 1.0));
        assert_eq!(piece.surface.cycle.len(), 4);
    }

    #[test]
    fn top_reverses_winding_relative_to_bottom() {
        let points = [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [2.0, 0.0, 2.0], [0.0, 0.0, 2.0]];
        let bottom = cap_boundary(&points, "room-1", SurfaceType::new("floor"), false);
        let top = cap_boundary(&points, "room-1", SurfaceType::new("ceiling"), true);
        let bottom_xz: Vec<(f32, f32)> = bottom.nodes.iter().map(|node| (node.data()[0], node.data()[2])).collect();
        let mut top_xz: Vec<(f32, f32)> = top.nodes.iter().map(|node| (node.data()[0], node.data()[2])).collect();
        top_xz.reverse();
        assert_eq!(bottom_xz, top_xz, "reversing top's own point order recovers bottom's point order");
    }

    #[test]
    fn per_vertex_height_is_preserved_unlike_a_shared_baseline() {
        // A terrain cell's 4 corners, each its own height -- boundary.rs
        // makes no assumption every point shares one Y.
        let points = [[0.0, 1.0, 0.0], [1.0, 1.5, 0.0], [1.0, 2.0, 1.0], [0.0, 1.2, 1.0]];
        let piece = cap_boundary(&points, "terrain-1", SurfaceType::new("terrain"), false);
        let heights: Vec<f32> = piece.nodes.iter().map(|node| node.data()[1]).collect();
        assert_eq!(heights, vec![1.0, 1.5, 2.0, 1.2]);
    }

    #[test]
    fn repeated_calls_at_the_same_position_and_prefix_mint_identical_ids() {
        let points = [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [2.0, 0.0, 2.0], [0.0, 0.0, 2.0]];
        let a = cap_boundary(&points, "room-1", SurfaceType::new("floor"), false);
        let b = cap_boundary(&points, "room-1", SurfaceType::new("floor"), false);
        assert_eq!(a.surface.cycle, b.surface.cycle);
    }
}
