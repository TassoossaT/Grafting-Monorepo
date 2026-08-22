//! Pure inner functions for bootstrapping a session's graph: first-time
//! node/edge creation and outright removal. Each function is
//! `fn(...) -> Result<T, String>`, natively unit-testable with zero Wasm
//! involvement -- `session.rs`'s `#[wasm_bindgen]` methods are the only
//! place a `String` becomes a `JsValue`.
//!
//! Editing an already-built surface lives in `region_editing.rs`, against
//! the analytic `SurfaceRegion` model. `ADR-0022`'s five node-set
//! operations used to live here and are retired -- see
//! `docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.

use serde::{Deserialize, Serialize};

use grafting_graph_core::{ContourTopology, Edge, EdgeId, Graph, Node, NodeId, SurfaceRegistry};

use crate::mesh::region_id_from_wire;

/// The concrete graph payload every construction-wasm session uses -- bare
/// 3D position, no edge payload -- matching `construction.rs`'s own
/// `pyramid()` test fixture and `ADR-0022`'s "each node carries its spatial
/// position as payload."
pub type SessionGraph = Graph<[f32; 3], ()>;

fn parse_node_id(id: String) -> Result<NodeId, String> {
    NodeId::new(id).map_err(|error| error.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceKeyResponse {
    pub surface_key: Vec<String>,
}

// ---- Bootstrapping: first-time creation, outside construction.rs's scope ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddNodeRequest {
    pub id: String,
    pub position: [f32; 3],
}

/// Adds a brand-new node. None of the five construction operations perform
/// first-time creation -- this is reachable only via `Graph::add_node`
/// directly, per this crate's own design notes.
pub fn add_node(graph: &mut SessionGraph, request: AddNodeRequest) -> Result<(), String> {
    let id = parse_node_id(request.id)?;
    graph
        .add_node(Node::new(id, request.position))
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddEdgeRequest {
    pub id: String,
    pub source: String,
    pub target: String,
}

/// Adds a brand-new edge between two existing nodes.
pub fn add_edge(graph: &mut SessionGraph, request: AddEdgeRequest) -> Result<(), String> {
    let id = EdgeId::new(request.id).map_err(|error| error.to_string())?;
    let source = parse_node_id(request.source)?;
    let target = parse_node_id(request.target)?;
    graph
        .add_edge(Edge::new(id, source, target, ()))
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveSurfaceRequest {
    pub surface_key: Vec<String>,
}

/// Unregisters one region outright -- no hole-repair, no cascading, no
/// orphan cleanup. A caller composing a bigger removal (an enclosed room, a
/// whole structure) calls this once per face it already knows belongs to
/// that removal; there is no dedicated "delete a room" primitive here,
/// because that is nothing more than this operation over a caller-known set
/// plus [`remove_edge`] for whatever boundary ends up unreferenced.
///
/// See `region_editing::apply_delete_region` for the cascading counterpart,
/// which does prune what it orphans.
pub fn remove_surface(
    surfaces: &mut SurfaceRegistry,
    topology: &mut ContourTopology,
    request: RemoveSurfaceRequest,
) -> Result<(), String> {
    let region_id = region_id_from_wire(&request.surface_key)?;
    surfaces
        .remove_region_surface(&region_id)
        .map_err(|error| error.to_string())?;
    topology
        .remove_region(&region_id)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveEdgeRequest {
    pub edge_id: String,
}

/// Removes an edge outright -- no repair, no cascading. See
/// [`remove_surface`]'s own doc: this and `construction::delete_node` are
/// the raw primitives a caller composes any bigger removal from.
pub fn remove_edge(graph: &mut SessionGraph, request: RemoveEdgeRequest) -> Result<(), String> {
    let id = EdgeId::new(request.edge_id).map_err(|error| error.to_string())?;
    graph.remove_edge(&id).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_graph() -> SessionGraph {
        Graph::try_from_parts(Vec::new(), Vec::new()).unwrap()
    }

    fn add(graph: &mut SessionGraph, id: &str, position: [f32; 3]) {
        add_node(
            graph,
            AddNodeRequest {
                id: id.to_string(),
                position,
            },
        )
        .unwrap();
    }

    fn edge(graph: &mut SessionGraph, id: &str, a: &str, b: &str) {
        add_edge(
            graph,
            AddEdgeRequest {
                id: id.to_string(),
                source: a.to_string(),
                target: b.to_string(),
            },
        )
        .unwrap();
    }

    #[test]
    fn remove_surface_unregisters_a_region_without_touching_the_graph() {
        let mut graph = empty_graph();
        add(&mut graph, "a", [0.0, 0.0, 0.0]);
        add(&mut graph, "b", [1.0, 0.0, 0.0]);
        add(&mut graph, "c", [0.0, 1.0, 0.0]);
        let mut surfaces = SurfaceRegistry::new();
        let mut topology = ContourTopology::new();
        let region_id = grafting_graph_core::RegionId::new("triangle").unwrap();
        grafting_graph_core::straight_cycle_region(
            &mut topology,
            &graph,
            region_id.clone(),
            &[
                NodeId::new("a").unwrap(),
                NodeId::new("b").unwrap(),
                NodeId::new("c").unwrap(),
            ],
        )
        .unwrap();
        surfaces
            .add_region_surface(
                &topology,
                region_id.clone(),
                grafting_graph_core::SurfaceType::new("wall"),
                true,
            )
            .unwrap();

        remove_surface(
            &mut surfaces,
            &mut topology,
            RemoveSurfaceRequest {
                surface_key: vec!["@region".into(), "triangle".into()],
            },
        )
        .unwrap();

        assert!(surfaces.region_surface(&region_id).is_none());
        assert!(topology.region(&region_id).is_none());
        assert!(
            graph.node(&NodeId::new("a").unwrap()).is_some(),
            "removing a face never touches its nodes"
        );
    }

    #[test]
    fn remove_surface_rejects_an_unknown_key() {
        let mut surfaces = SurfaceRegistry::new();
        let mut topology = ContourTopology::new();
        let error = remove_surface(
            &mut surfaces,
            &mut topology,
            RemoveSurfaceRequest {
                surface_key: vec!["@region".into(), "missing".into()],
            },
        )
        .unwrap_err();
        assert!(!error.is_empty());
    }

    #[test]
    fn remove_edge_removes_it_without_touching_its_endpoints() {
        let mut graph = empty_graph();
        add(&mut graph, "a", [0.0, 0.0, 0.0]);
        add(&mut graph, "b", [1.0, 0.0, 0.0]);
        edge(&mut graph, "ab", "a", "b");

        remove_edge(
            &mut graph,
            RemoveEdgeRequest {
                edge_id: "ab".into(),
            },
        )
        .unwrap();

        assert!(graph.edge(&EdgeId::new("ab").unwrap()).is_none());
        assert!(graph.node(&NodeId::new("a").unwrap()).is_some());
        assert!(graph.node(&NodeId::new("b").unwrap()).is_some());
    }

    #[test]
    fn remove_edge_rejects_an_unknown_id() {
        let mut graph = empty_graph();
        let error = remove_edge(
            &mut graph,
            RemoveEdgeRequest {
                edge_id: "missing".into(),
            },
        )
        .unwrap_err();
        assert!(!error.is_empty());
    }

    #[test]
    fn add_node_rejects_a_duplicate_id() {
        let mut graph = empty_graph();
        add(&mut graph, "a", [0.0, 0.0, 0.0]);
        let error = add_node(
            &mut graph,
            AddNodeRequest {
                id: "a".into(),
                position: [1.0, 1.0, 1.0],
            },
        )
        .unwrap_err();
        assert!(error.contains("duplicate"), "unexpected error: {error}");
    }

    #[test]
    fn add_edge_rejects_a_missing_endpoint() {
        let mut graph = empty_graph();
        add(&mut graph, "a", [0.0, 0.0, 0.0]);
        let error = add_edge(
            &mut graph,
            AddEdgeRequest {
                id: "ab".into(),
                source: "a".into(),
                target: "missing".into(),
            },
        )
        .unwrap_err();
        assert!(error.contains("missing"), "unexpected error: {error}");
    }
}
