//! Pure inner function for `generate_and_apply_room_addition`: adds ONE
//! new room to a table, welding onto whatever pre-existing geometry its
//! own corners land on -- the "Adicionar Cômodo" tool. Reuses
//! `rect_tiling::generate_tiled_rooms` (the same primitive
//! `VTT-ROOM-LAYOUT-VARIETY` built for a whole footprint's worth of
//! rooms) called with exactly one tile, plus a `corner_override` closure
//! so a caller-supplied weld candidate wins over that primitive's own
//! position-derived id -- mirroring `wall::generate_and_apply_wall`'s own
//! `welded_node_ids` mechanism, generalized from a wall's 4 corners to a
//! room's up to 8 (4 bottom + 4 top).
//!
//! Weld candidates are reported as `(x, z, top, existingNodeId)` rather
//! than as pre-computed ids -- a caller (`house-room-add-tool.ts`) only
//! ever needs to report *where* an existing node is, the same live-query
//! shape `wall-corner-weld.ts` already produces; it never has to
//! replicate this crate's own id-formatting convention.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use grafting_graph_core::{Node, NodeId, SurfaceKey, SurfaceRegistry, SurfaceType};
use grafting_procgen_structure_generation::{RectTile, generate_tiled_rooms};

use crate::dto::surface_key_to_wire;
use crate::editing::SessionGraph;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RectTileDto {
    pub x: f32,
    pub z: f32,
    pub width: f32,
    pub depth: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeldCandidateDto {
    pub x: f32,
    pub z: f32,
    pub top: bool,
    pub node_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAndApplyRoomAdditionRequest {
    pub tile: RectTileDto,
    pub origin_y: f32,
    pub wall_height: f32,
    /// Namespaces every id this call mints fresh -- same `tableId:salt`
    /// shape every other generator in this crate uses.
    pub id_prefix: String,
    pub wall_type: String,
    pub door_type: String,
    pub floor_type: String,
    pub ceiling_type: String,
    /// Corners this new room's own corners should weld onto instead of
    /// minting a fresh id. `#[serde(default)]` so a free-standing
    /// addition (no weld) is just an empty list, not a required field.
    #[serde(default)]
    pub weld_candidates: Vec<WeldCandidateDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomAdditionPieceResponse {
    pub surface_key: Vec<String>,
    pub surface_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAndApplyRoomAdditionResponse {
    pub pieces: Vec<RoomAdditionPieceResponse>,
}

/// Generates one room's wall/floor/ceiling pieces and applies them,
/// welding onto `weld_candidates` where given. Errors, leaving nothing
/// added, if `tile.width`/`tile.depth` is not positive, a
/// `weld_candidates` entry's `nodeId` is invalid or does not already
/// exist in the graph, or any non-welded generated id collides with the
/// graph's existing state.
pub fn generate_and_apply_room_addition(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    request: GenerateAndApplyRoomAdditionRequest,
) -> Result<GenerateAndApplyRoomAdditionResponse, String> {
    if request.tile.width <= 0.0 || request.tile.depth <= 0.0 {
        return Err("tile.width and tile.depth must each be positive".to_string());
    }

    let mut welded_ids: Vec<NodeId> = Vec::with_capacity(request.weld_candidates.len());
    let mut candidates: Vec<(f32, f32, bool, NodeId)> = Vec::with_capacity(request.weld_candidates.len());
    for candidate in &request.weld_candidates {
        let id = NodeId::new(candidate.node_id.clone()).map_err(|error| error.to_string())?;
        welded_ids.push(id.clone());
        candidates.push((candidate.x, candidate.z, candidate.top, id));
    }
    let corner_override = |x: f32, z: f32, top: bool| -> Option<NodeId> {
        candidates
            .iter()
            .find(|(cx, cz, ctop, _)| *ctop == top && (*cx - x).abs() < 1e-3 && (*cz - z).abs() < 1e-3)
            .map(|(_, _, _, id)| id.clone())
    };

    let tile = RectTile { x: request.tile.x, z: request.tile.z, width: request.tile.width, depth: request.tile.depth };
    let generation = generate_tiled_rooms(
        &[tile],
        request.origin_y,
        request.wall_height,
        &request.id_prefix,
        SurfaceType::new(request.wall_type),
        SurfaceType::new(request.door_type),
        SurfaceType::new(request.floor_type),
        SurfaceType::new(request.ceiling_type),
        corner_override,
    );

    // Same dedup-then-pre-validate-then-commit shape as
    // `room_grid::generate_and_apply_room_grid`, except a welded id must
    // already exist (reused, not recreated) instead of being free --
    // mirrors `wall::generate_and_apply_wall`'s own `welded` bookkeeping.
    let mut unique_nodes: HashMap<NodeId, Node<[f32; 3]>> = HashMap::new();
    for piece in &generation.walls {
        for node in &piece.nodes {
            unique_nodes.entry(node.id().clone()).or_insert_with(|| node.clone());
        }
    }
    for id in unique_nodes.keys() {
        let exists = graph.node(id).is_some();
        if welded_ids.contains(id) {
            if !exists {
                return Err(format!("welded node id does not exist: {id}"));
            }
        } else if exists {
            return Err(format!("node id already exists: {id}"));
        }
    }
    for piece in &generation.walls {
        for edge in &piece.edges {
            if graph.edge(edge.id()).is_some() {
                return Err(format!("edge id already exists: {}", edge.id()));
            }
        }
    }
    let all_pieces = generation.walls.iter().chain(generation.floors.iter()).chain(generation.ceilings.iter());
    for piece in all_pieces.clone() {
        let key = SurfaceKey::from_cycle(&piece.surface.cycle);
        if surfaces.surface(&key).is_some() {
            return Err(format!("surface already exists for node set {key:?}"));
        }
    }

    for (id, node) in unique_nodes {
        if welded_ids.contains(&id) {
            continue;
        }
        graph.add_node(node).expect("checked above: id is free");
    }
    for piece in &generation.walls {
        for edge in piece.edges.clone() {
            graph.add_edge(edge).expect("checked above: id is free, endpoints exist");
        }
    }

    let mut pieces = Vec::new();
    for piece in generation.walls.into_iter().chain(generation.floors.into_iter()).chain(generation.ceilings.into_iter()) {
        let surface_type_label = piece.surface.surface_type.as_str().to_owned();
        let key = surfaces
            .add_surface(graph, piece.surface.cycle, piece.surface.surface_type, piece.surface.physical)
            .expect("pre-validated: nodes exist (just added or welded), identity does not collide");
        pieces.push(RoomAdditionPieceResponse { surface_key: surface_key_to_wire(&key), surface_type: surface_type_label });
    }

    Ok(GenerateAndApplyRoomAdditionResponse { pieces })
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::Graph;

    fn empty_graph() -> SessionGraph {
        Graph::try_from_parts(Vec::new(), Vec::new()).unwrap()
    }

    fn request(tile: RectTileDto, weld_candidates: Vec<WeldCandidateDto>) -> GenerateAndApplyRoomAdditionRequest {
        GenerateAndApplyRoomAdditionRequest {
            tile,
            origin_y: 0.0,
            wall_height: 3.0,
            id_prefix: "room-add-1".into(),
            wall_type: "wall-white".into(),
            door_type: "door".into(),
            floor_type: "floor".into(),
            ceiling_type: "ceiling".into(),
            weld_candidates,
        }
    }

    #[test]
    fn a_free_standing_addition_mints_4_walls_and_one_floor_ceiling() {
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();

        let response = generate_and_apply_room_addition(
            &mut graph,
            &mut surfaces,
            request(RectTileDto { x: 0.0, z: 0.0, width: 4.0, depth: 4.0 }, Vec::new()),
        )
        .unwrap();

        assert_eq!(response.pieces.len(), 6); // 4 walls + floor + ceiling
        assert_eq!(graph.node_count(), 8); // 4 corners x bottom/top
    }

    #[test]
    fn welding_onto_an_existing_corner_reuses_its_id_instead_of_minting_one() {
        let mut graph = empty_graph();
        graph.add_node(Node::new(NodeId::new("existing-corner").unwrap(), [4.0, 0.0, 0.0])).unwrap();
        let mut surfaces = SurfaceRegistry::new();

        let response = generate_and_apply_room_addition(
            &mut graph,
            &mut surfaces,
            request(
                RectTileDto { x: 0.0, z: 0.0, width: 4.0, depth: 4.0 },
                vec![WeldCandidateDto { x: 4.0, z: 0.0, top: false, node_id: "existing-corner".into() }],
            ),
        )
        .unwrap();

        assert_eq!(response.pieces.len(), 6);
        // 8 corners total, minus the 1 welded (not recreated) = 7 new, plus
        // the 1 pre-existing = 8 in the graph.
        assert_eq!(graph.node_count(), 8);
        assert_eq!(graph.node(&NodeId::new("existing-corner").unwrap()).unwrap().data(), &[4.0, 0.0, 0.0]);
    }

    #[test]
    fn a_weld_candidate_that_does_not_exist_yet_errors_without_mutating() {
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();

        let error = generate_and_apply_room_addition(
            &mut graph,
            &mut surfaces,
            request(
                RectTileDto { x: 0.0, z: 0.0, width: 4.0, depth: 4.0 },
                vec![WeldCandidateDto { x: 4.0, z: 0.0, top: false, node_id: "missing".into() }],
            ),
        )
        .unwrap_err();

        assert!(error.contains("missing"));
        assert_eq!(graph.node_count(), 0);
    }

    #[test]
    fn zero_width_or_depth_errors_without_mutating() {
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();

        let error = generate_and_apply_room_addition(
            &mut graph,
            &mut surfaces,
            request(RectTileDto { x: 0.0, z: 0.0, width: 0.0, depth: 4.0 }, Vec::new()),
        )
        .unwrap_err();

        assert!(error.contains("width"));
        assert_eq!(graph.node_count(), 0);
    }
}
