//! Pure inner function for `generate_and_apply_room_grid`: calls
//! `grafting-procgen-structure-generation`'s pure `generate_room_grid`, then
//! applies every wall/floor/ceiling piece to the session's own live
//! `Graph`/`SurfaceRegistry` in one call, deduping shared corner nodes
//! across sibling wall pieces (and between walls and the floor/ceiling
//! pieces that reference them) and pre-validating every id is free first --
//! mirrors `wall::generate_and_apply_wall`'s own atomicity.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use grafting_graph_core::{Node, NodeId, SurfaceKey, SurfaceRegistry, SurfaceType};
use grafting_procgen_structure_generation::{RoomGridLayout, generate_room_grid};

use crate::dto::surface_key_to_wire;
use crate::editing::SessionGraph;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomGridLayoutDto {
    pub origin: [f32; 3],
    pub rows: u32,
    pub cols: u32,
    pub cell_width: f32,
    pub cell_depth: f32,
    pub wall_height: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAndApplyRoomGridRequest {
    pub layout: RoomGridLayoutDto,
    /// Namespaces every id this call generates (corners, door jambs, ring
    /// edges) -- e.g. `"table1:brush-house-3"`, the same `tableId:salt`
    /// shape every other generator in this crate uses, so two calls never
    /// collide with each other or with any other generated geometry.
    pub id_prefix: String,
    pub wall_type: String,
    pub door_type: String,
    pub floor_type: String,
    pub ceiling_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomGridPieceResponse {
    pub surface_key: Vec<String>,
    pub surface_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAndApplyRoomGridResponse {
    pub pieces: Vec<RoomGridPieceResponse>,
}

/// Generates a room grid's wall/floor/ceiling pieces and applies them to the
/// session's live state. Errors, leaving nothing added, if `rows`/`cols` is
/// 0, or any generated id collides with the graph's existing state -- since
/// every id is namespaced by `request.id_prefix` (see
/// [`GenerateAndApplyRoomGridRequest::id_prefix`]), a collision only ever
/// means the same prefix was reused for a second call.
pub fn generate_and_apply_room_grid(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    request: GenerateAndApplyRoomGridRequest,
) -> Result<GenerateAndApplyRoomGridResponse, String> {
    if request.layout.rows == 0 || request.layout.cols == 0 {
        return Err("layout.rows and layout.cols must each be at least 1".to_string());
    }

    let layout = RoomGridLayout {
        origin: request.layout.origin,
        rows: request.layout.rows,
        cols: request.layout.cols,
        cell_width: request.layout.cell_width,
        cell_depth: request.layout.cell_depth,
        wall_height: request.layout.wall_height,
    };
    let generation = generate_room_grid(
        &layout,
        &request.id_prefix,
        SurfaceType::new(request.wall_type),
        SurfaceType::new(request.door_type),
        SurfaceType::new(request.floor_type),
        SurfaceType::new(request.ceiling_type),
    );

    // Dedup shared corner nodes across sibling wall pieces (every grid
    // corner touched by more than one wall is emitted by each, per
    // `generate_room_grid`'s own doc), then pre-validate every unique node
    // id, every ring edge id, and every surface cycle (walls, floors,
    // ceilings alike) is free before committing anything.
    let mut unique_nodes: HashMap<NodeId, Node<[f32; 3]>> = HashMap::new();
    for piece in &generation.walls {
        for node in &piece.nodes {
            unique_nodes.entry(node.id().clone()).or_insert_with(|| node.clone());
        }
    }
    for id in unique_nodes.keys() {
        if graph.node(id).is_some() {
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

    for (_, node) in unique_nodes {
        graph.add_node(node).expect("checked above: id is free");
    }
    for piece in &generation.walls {
        for edge in piece.edges.clone() {
            graph.add_edge(edge).expect("checked above: id is free, endpoints were just added");
        }
    }

    let mut pieces = Vec::new();
    for piece in generation.walls.into_iter().chain(generation.floors.into_iter()).chain(generation.ceilings.into_iter()) {
        let surface_type_label = piece.surface.surface_type.as_str().to_owned();
        let key = surfaces
            .add_surface(graph, piece.surface.cycle, piece.surface.surface_type, piece.surface.physical)
            .expect("pre-validated: nodes exist (just added), identity does not collide");
        pieces.push(RoomGridPieceResponse { surface_key: surface_key_to_wire(&key), surface_type: surface_type_label });
    }

    Ok(GenerateAndApplyRoomGridResponse { pieces })
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::Graph;

    fn empty_graph() -> SessionGraph {
        Graph::try_from_parts(Vec::new(), Vec::new()).unwrap()
    }

    fn request(rows: u32, cols: u32, id_prefix: &str) -> GenerateAndApplyRoomGridRequest {
        GenerateAndApplyRoomGridRequest {
            layout: RoomGridLayoutDto { origin: [0.0, 0.0, 0.0], rows, cols, cell_width: 4.0, cell_depth: 4.0, wall_height: 3.0 },
            id_prefix: id_prefix.to_string(),
            wall_type: "wall-white".into(),
            door_type: "door".into(),
            floor_type: "floor".into(),
            ceiling_type: "ceiling".into(),
        }
    }

    #[test]
    fn a_2x1_grid_applies_one_shared_interior_wall_and_two_rooms_worth_of_floor_ceiling() {
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();

        let response = generate_and_apply_room_grid(&mut graph, &mut surfaces, request(1, 2, "house-1")).unwrap();

        // 9 wall pieces (see structure-generation's own test for the count
        // breakdown) + 2 floors + 2 ceilings.
        assert_eq!(response.pieces.len(), 13);
        // 6 grid corners (3 cols x 1 row + 1) x 2 (bottom/top) = 12, plus 2
        // fresh door-jamb pairs (4 nodes) for the one interior wall's door = 16.
        assert_eq!(graph.node_count(), 16);
    }

    #[test]
    fn zero_rows_or_cols_errors_without_mutating() {
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();

        let error = generate_and_apply_room_grid(&mut graph, &mut surfaces, request(0, 2, "house-1")).unwrap_err();
        assert!(error.contains("rows"));
        assert_eq!(graph.node_count(), 0);
    }

    #[test]
    fn reusing_the_same_id_prefix_twice_errors_on_the_second_call() {
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();

        generate_and_apply_room_grid(&mut graph, &mut surfaces, request(1, 1, "house-1")).unwrap();
        let error = generate_and_apply_room_grid(&mut graph, &mut surfaces, request(1, 1, "house-1")).unwrap_err();
        assert!(error.contains("already exists"));
    }
}
