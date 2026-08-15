//! Pure inner function for `generate_and_apply_wall`: calls
//! `grafting-procgen-structure-generation`'s pure generator, then applies
//! every piece to the session's own live `Graph`/`SurfaceRegistry` in one
//! call, deduping shared jamb nodes across sibling pieces and
//! pre-validating every id is free first -- mirroring `duplicate_surface`'s
//! own atomicity.

use std::cell::RefCell;
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use grafting_graph_core::{EdgeId, Node, NodeId, SurfaceRegistry, SurfaceType};
use grafting_procgen_structure_generation::{DoorOpening, WallNodeRole, WallSegment, generate_wall};

use crate::dto::{surface_key_to_wire, wall_edge_role_pair_wire_name, wall_node_role_wire_name};
use crate::editing::SessionGraph;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallSegmentDto {
    pub start: [f32; 3],
    pub end: [f32; 3],
    pub height: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoorOpeningDto {
    pub opens_at: f32,
    pub closes_at: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAndApplyWallRequest {
    pub wall: WallSegmentDto,
    pub door: Option<DoorOpeningDto>,
    pub wall_type: String,
    pub door_type: String,
    /// Keyed by [`wall_node_role_wire_name`]. Only the entries this
    /// specific call configuration actually needs are read -- a caller may
    /// supply the full 8-role table unconditionally, or only what a
    /// no-door/boundary-door call needs.
    pub node_ids: HashMap<String, String>,
    /// Keyed by [`wall_edge_role_pair_wire_name`] (directional).
    pub edge_ids: HashMap<String, String>,
    /// Node ids (values from `node_ids`, not role names) the caller asserts
    /// already exist in the graph -- e.g. a wall corner welded onto an
    /// adjoining wall's endpoint (`VTT-WALL-CORNER-WELD`). Every other node
    /// id must still be free, exactly as before; a welded id must already
    /// exist, and is reused (not recreated) rather than requiring it be
    /// free. `#[serde(default)]` keeps every existing caller (the seed wall,
    /// any request predating this field) working unchanged with no welds.
    #[serde(default)]
    pub welded_node_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallPieceResponse {
    pub surface_key: Vec<String>,
    pub surface_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAndApplyWallResponse {
    pub pieces: Vec<WallPieceResponse>,
}

/// Generates a wall's (and, if `door` is given, its door's) surface pieces
/// and applies them to the session's live state. Errors, leaving nothing
/// added, if the door opening is invalid, a needed `nodeIds`/`edgeIds`
/// entry is missing or invalid, a non-welded id collides with the graph's
/// existing state, or a `welded_node_ids` entry does not already exist.
pub fn generate_and_apply_wall(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    request: GenerateAndApplyWallRequest,
) -> Result<GenerateAndApplyWallResponse, String> {
    let wall = WallSegment { start: request.wall.start, end: request.wall.end, height: request.wall.height };
    let door = request.door.as_ref().map(|door| DoorOpening { opens_at: door.opens_at, closes_at: door.closes_at });
    let wall_type = SurfaceType::new(request.wall_type);
    let door_type = SurfaceType::new(request.door_type);

    // generate_wall's closures are infallible (`impl Fn(...) -> NodeId`),
    // but a caller-supplied id can still be missing or malformed. Capture
    // the first such failure via a side channel instead, and discard the
    // whole generation afterward if one occurred -- this crate does not
    // need to know in advance which roles/pairs a given door configuration
    // will actually ask for (that is generate_wall's own branching, not
    // duplicated here).
    let missing: RefCell<Option<String>> = RefCell::new(None);
    let placeholder_node = || NodeId::new("construction-wasm-placeholder").expect("non-empty literal");
    let placeholder_edge = || EdgeId::new("construction-wasm-placeholder").expect("non-empty literal");

    let node_id = |role: WallNodeRole| -> NodeId {
        let wire = wall_node_role_wire_name(role);
        match request.node_ids.get(wire).and_then(|id| NodeId::new(id.clone()).ok()) {
            Some(id) => id,
            None => {
                missing.borrow_mut().get_or_insert_with(|| format!("missing or invalid nodeId for role {wire}"));
                placeholder_node()
            }
        }
    };
    let edge_id = |a: WallNodeRole, b: WallNodeRole| -> EdgeId {
        let wire = wall_edge_role_pair_wire_name(a, b);
        match request.edge_ids.get(&wire).and_then(|id| EdgeId::new(id.clone()).ok()) {
            Some(id) => id,
            None => {
                missing.borrow_mut().get_or_insert_with(|| format!("missing or invalid edgeId for pair {wire}"));
                placeholder_edge()
            }
        }
    };

    let generation = generate_wall(&wall, door.as_ref(), node_id, edge_id, wall_type, door_type).map_err(|error| error.to_string())?;
    if let Some(message) = missing.into_inner() {
        return Err(message);
    }

    let welded: Vec<NodeId> = request
        .welded_node_ids
        .iter()
        .map(|id| NodeId::new(id.clone()).map_err(|_| format!("invalid weldedNodeId: {id}")))
        .collect::<Result<_, _>>()?;

    // Dedup shared jamb nodes across sibling pieces (the same NodeId
    // intentionally appears in two adjacent pieces, per generate_wall's own
    // doc comment), then pre-validate every unique id and every surface
    // cycle is free in the current graph/registry before committing
    // anything. A welded id is the opposite of the usual rule: it must
    // already exist (it is the pre-existing node this wall's corner is
    // joining), not be free.
    let mut unique_nodes: HashMap<NodeId, Node<[f32; 3]>> = HashMap::new();
    for piece in &generation.pieces {
        for node in &piece.nodes {
            unique_nodes.entry(node.id().clone()).or_insert_with(|| node.clone());
        }
    }
    for id in unique_nodes.keys() {
        let exists = graph.node(id).is_some();
        if welded.contains(id) {
            if !exists {
                return Err(format!("welded node id does not exist: {id}"));
            }
        } else if exists {
            return Err(format!("node id already exists: {id}"));
        }
    }
    for piece in &generation.pieces {
        for edge in &piece.edges {
            if graph.edge(edge.id()).is_some() {
                return Err(format!("edge id already exists: {}", edge.id()));
            }
        }
    }
    for piece in &generation.pieces {
        let key = grafting_graph_core::SurfaceKey::from_cycle(&piece.surface.cycle);
        if surfaces.surface(&key).is_some() {
            return Err(format!("surface already exists for node set {key:?}"));
        }
    }

    for (id, node) in unique_nodes {
        if welded.contains(&id) {
            continue;
        }
        graph.add_node(node).expect("checked above: id is free");
    }
    for piece in &generation.pieces {
        for edge in piece.edges.clone() {
            graph.add_edge(edge).expect("checked above: id is free, endpoints were just added");
        }
    }

    let mut pieces = Vec::with_capacity(generation.pieces.len());
    for piece in generation.pieces {
        let surface_type_label = piece.surface.surface_type.as_str().to_owned();
        let key = surfaces
            .add_surface(graph, piece.surface.cycle, piece.surface.surface_type, piece.surface.physical)
            .expect("pre-validated: nodes exist (just added), identity does not collide");
        pieces.push(WallPieceResponse { surface_key: surface_key_to_wire(&key), surface_type: surface_type_label });
    }

    Ok(GenerateAndApplyWallResponse { pieces })
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::Graph;

    fn empty_graph() -> SessionGraph {
        Graph::try_from_parts(Vec::new(), Vec::new()).unwrap()
    }

    fn wall_dto() -> WallSegmentDto {
        WallSegmentDto { start: [0.0, 0.0, 0.0], end: [4.0, 0.0, 0.0], height: 3.0 }
    }

    fn all_node_ids() -> HashMap<String, String> {
        [
            WallNodeRole::StartBottom,
            WallNodeRole::StartTop,
            WallNodeRole::EndBottom,
            WallNodeRole::EndTop,
            WallNodeRole::DoorStartBottom,
            WallNodeRole::DoorStartTop,
            WallNodeRole::DoorEndBottom,
            WallNodeRole::DoorEndTop,
        ]
        .into_iter()
        .map(|role| (wall_node_role_wire_name(role).to_string(), format!("{}-id", wall_node_role_wire_name(role))))
        .collect()
    }

    fn all_edge_ids() -> HashMap<String, String> {
        use WallNodeRole::*;
        let roles = [StartBottom, StartTop, EndBottom, EndTop, DoorStartBottom, DoorStartTop, DoorEndBottom, DoorEndTop];
        let mut map = HashMap::new();
        for &a in &roles {
            for &b in &roles {
                if a != b {
                    map.insert(wall_edge_role_pair_wire_name(a, b), format!("{}-{}-edge", wall_node_role_wire_name(a), wall_node_role_wire_name(b)));
                }
            }
        }
        map
    }

    #[test]
    fn no_door_generates_one_piece() {
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();

        let response = generate_and_apply_wall(
            &mut graph,
            &mut surfaces,
            GenerateAndApplyWallRequest {
                wall: wall_dto(),
                door: None,
                wall_type: "wall".into(),
                door_type: "door".into(),
                node_ids: all_node_ids(),
                edge_ids: all_edge_ids(),
                welded_node_ids: Vec::new(),
            },
        )
        .unwrap();

        assert_eq!(response.pieces.len(), 1);
        assert_eq!(response.pieces[0].surface_type, "wall");
        assert_eq!(graph.node_count(), 4);
        assert_eq!(graph.edge_count(), 4);
    }

    #[test]
    fn interior_door_shares_jamb_nodes_across_three_pieces() {
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();

        let response = generate_and_apply_wall(
            &mut graph,
            &mut surfaces,
            GenerateAndApplyWallRequest {
                wall: wall_dto(),
                door: Some(DoorOpeningDto { opens_at: 0.25, closes_at: 0.75 }),
                wall_type: "wall".into(),
                door_type: "door".into(),
                node_ids: all_node_ids(),
                edge_ids: all_edge_ids(),
                welded_node_ids: Vec::new(),
            },
        )
        .unwrap();

        assert_eq!(response.pieces.len(), 3);
        // 4 roles x 2 shared jambs de-duped: Start*, End*, DoorStart*, DoorEnd* = 8 unique nodes total.
        assert_eq!(graph.node_count(), 8);
        // Each piece contributes its own 4 ring edges, none shared.
        assert_eq!(graph.edge_count(), 12);
    }

    #[test]
    fn an_invalid_door_opening_leaves_nothing_added() {
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();

        let error = generate_and_apply_wall(
            &mut graph,
            &mut surfaces,
            GenerateAndApplyWallRequest {
                wall: wall_dto(),
                door: Some(DoorOpeningDto { opens_at: 0.7, closes_at: 0.2 }),
                wall_type: "wall".into(),
                door_type: "door".into(),
                node_ids: all_node_ids(),
                edge_ids: all_edge_ids(),
                welded_node_ids: Vec::new(),
            },
        )
        .unwrap_err();

        assert!(error.contains("0.7") || error.contains("opens_at"), "unexpected error: {error}");
        assert_eq!(graph.node_count(), 0);
    }

    #[test]
    fn a_missing_node_id_entry_leaves_nothing_added() {
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();
        let mut node_ids = all_node_ids();
        node_ids.remove(wall_node_role_wire_name(WallNodeRole::StartBottom));

        let error = generate_and_apply_wall(
            &mut graph,
            &mut surfaces,
            GenerateAndApplyWallRequest {
                wall: wall_dto(),
                door: None,
                wall_type: "wall".into(),
                door_type: "door".into(),
                node_ids,
                edge_ids: all_edge_ids(),
                welded_node_ids: Vec::new(),
            },
        )
        .unwrap_err();

        assert!(error.contains("startBottom"));
        assert_eq!(graph.node_count(), 0);
        assert_eq!(graph.edge_count(), 0);
    }

    #[test]
    fn a_colliding_node_id_leaves_nothing_added() {
        let mut graph = empty_graph();
        graph.add_node(Node::new(NodeId::new("startBottom-id").unwrap(), [0.0; 3])).unwrap();
        let mut surfaces = SurfaceRegistry::new();

        let error = generate_and_apply_wall(
            &mut graph,
            &mut surfaces,
            GenerateAndApplyWallRequest {
                wall: wall_dto(),
                door: None,
                wall_type: "wall".into(),
                door_type: "door".into(),
                node_ids: all_node_ids(),
                edge_ids: all_edge_ids(),
                welded_node_ids: Vec::new(),
            },
        )
        .unwrap_err();

        assert!(error.contains("startBottom-id"));
        // Only the pre-existing node remains -- nothing else committed.
        assert_eq!(graph.node_count(), 1);
        assert_eq!(graph.edge_count(), 0);
    }

    #[test]
    fn a_welded_node_id_reuses_the_existing_node_instead_of_erroring() {
        let mut graph = empty_graph();
        graph.add_node(Node::new(NodeId::new("startBottom-id").unwrap(), [9.0, 9.0, 9.0])).unwrap();
        let mut surfaces = SurfaceRegistry::new();

        let response = generate_and_apply_wall(
            &mut graph,
            &mut surfaces,
            GenerateAndApplyWallRequest {
                wall: wall_dto(),
                door: None,
                wall_type: "wall".into(),
                door_type: "door".into(),
                node_ids: all_node_ids(),
                edge_ids: all_edge_ids(),
                welded_node_ids: vec!["startBottom-id".into()],
            },
        )
        .unwrap();

        assert_eq!(response.pieces.len(), 1);
        // The welded corner reuses the pre-existing node -- 3 new corners, not 4.
        assert_eq!(graph.node_count(), 4);
        // The welded node's own position is untouched by this call.
        assert_eq!(graph.node(&NodeId::new("startBottom-id").unwrap()).unwrap().data(), &[9.0, 9.0, 9.0]);
    }

    #[test]
    fn a_welded_node_id_that_does_not_exist_yet_errors() {
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();

        let error = generate_and_apply_wall(
            &mut graph,
            &mut surfaces,
            GenerateAndApplyWallRequest {
                wall: wall_dto(),
                door: None,
                wall_type: "wall".into(),
                door_type: "door".into(),
                node_ids: all_node_ids(),
                edge_ids: all_edge_ids(),
                welded_node_ids: vec!["startBottom-id".into()],
            },
        )
        .unwrap_err();

        assert!(error.contains("startBottom-id"));
        assert_eq!(graph.node_count(), 0);
    }
}
