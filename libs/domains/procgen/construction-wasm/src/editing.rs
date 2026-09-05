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

use serde::Deserialize;

use grafting_graph_core::{prune_orphans, ContourTopology, Graph, SurfaceRegistry};

use crate::mesh::region_id_from_wire;
use crate::region_editing::RegionEditOutcomeDto;

/// The concrete graph payload every construction-wasm session uses -- bare
/// 3D position, no edge payload -- matching `construction.rs`'s own
/// `pyramid()` test fixture and `ADR-0022`'s "each node carries its spatial
/// position as payload."
pub type SessionGraph = Graph<[f32; 3], ()>;

// ---- Bootstrapping: first-time creation, outside construction.rs's scope ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveSurfaceRequest {
    pub surface_key: Vec<String>,
}

/// Unregisters one region outright and prunes any nodes it orphaned from the
/// graph. A caller composing a bigger removal (an enclosed room, a whole
/// structure) calls this once per face it already knows belongs to that
/// removal; there is no dedicated "delete a room" primitive here, because
/// that is nothing more than this operation over a caller-known set.
///
/// See `region_editing::apply_delete_region` for the cascading counterpart,
/// which additionally computes exposed rim loops for hole repair.
pub fn remove_surface(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    topology: &mut ContourTopology,
    request: RemoveSurfaceRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let region_id = region_id_from_wire(&request.surface_key)?;
    let candidate_nodes = topology
        .region_nodes(&region_id)
        .map_err(|error| error.to_string())?;
    surfaces
        .remove_region_surface(&region_id)
        .map_err(|error| error.to_string())?;
    topology
        .remove_region(&region_id)
        .map_err(|error| error.to_string())?;
    let removed_nodes = prune_orphans(graph, topology, &candidate_nodes)
        .map_err(|error| error.to_string())?;
    let removed_node_ids = removed_nodes
        .into_iter()
        .map(|id| id.as_str().to_owned())
        .collect();
    Ok(RegionEditOutcomeDto {
        affected_surface_keys: Vec::new(),
        created_surface_keys: Vec::new(),
        removed_surface_keys: vec![request.surface_key],
        created_node_ids: Vec::new(),
        removed_node_ids,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::{Node, NodeId};

    fn empty_graph() -> SessionGraph {
        Graph::try_from_parts(Vec::new(), Vec::new()).unwrap()
    }

    fn add(graph: &mut SessionGraph, id: &str, position: [f32; 3]) {
        graph
            .add_node(Node::new(NodeId::new(id).unwrap(), position))
            .unwrap();
    }

    #[test]
    fn remove_surface_unregisters_a_region_and_prunes_orphaned_nodes() {
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

        let outcome = remove_surface(
            &mut graph,
            &mut surfaces,
            &mut topology,
            RemoveSurfaceRequest {
                surface_key: vec!["@region".into(), "triangle".into()],
            },
        )
        .unwrap();

        assert!(surfaces.region_surface(&region_id).is_none());
        assert!(topology.region(&region_id).is_none());
        assert_eq!(outcome.removed_surface_keys, vec![vec!["@region", "triangle"]]);
        assert_eq!(outcome.removed_node_ids.len(), 3);
        assert!(graph.node(&NodeId::new("a").unwrap()).is_none());
        assert!(graph.node(&NodeId::new("b").unwrap()).is_none());
        assert!(graph.node(&NodeId::new("c").unwrap()).is_none());
    }

    #[test]
    fn remove_surface_preserves_shared_nodes_and_only_prunes_exclusive_nodes() {
        let mut graph = empty_graph();
        add(&mut graph, "a", [0.0, 0.0, 0.0]);
        add(&mut graph, "b", [1.0, 0.0, 0.0]);
        add(&mut graph, "c", [0.0, 1.0, 0.0]);
        add(&mut graph, "d", [1.0, 1.0, 0.0]);
        let mut surfaces = SurfaceRegistry::new();
        let mut topology = ContourTopology::new();
        let tri1 = grafting_graph_core::RegionId::new("tri1").unwrap();
        let tri2 = grafting_graph_core::RegionId::new("tri2").unwrap();
        grafting_graph_core::straight_cycle_region(
            &mut topology,
            &graph,
            tri1.clone(),
            &[
                NodeId::new("a").unwrap(),
                NodeId::new("b").unwrap(),
                NodeId::new("c").unwrap(),
            ],
        )
        .unwrap();
        grafting_graph_core::straight_cycle_region(
            &mut topology,
            &graph,
            tri2.clone(),
            &[
                NodeId::new("b").unwrap(),
                NodeId::new("d").unwrap(),
                NodeId::new("c").unwrap(),
            ],
        )
        .unwrap();
        surfaces
            .add_region_surface(
                &topology,
                tri1.clone(),
                grafting_graph_core::SurfaceType::new("wall"),
                true,
            )
            .unwrap();
        surfaces
            .add_region_surface(
                &topology,
                tri2.clone(),
                grafting_graph_core::SurfaceType::new("wall"),
                true,
            )
            .unwrap();

        // Removing tri1 should prune only "a", leaving "b" and "c" (used by tri2) and "d"
        let outcome = remove_surface(
            &mut graph,
            &mut surfaces,
            &mut topology,
            RemoveSurfaceRequest {
                surface_key: vec!["@region".into(), "tri1".into()],
            },
        )
        .unwrap();

        assert_eq!(outcome.removed_node_ids, vec!["a"]);
        assert!(graph.node(&NodeId::new("a").unwrap()).is_none());
        assert!(graph.node(&NodeId::new("b").unwrap()).is_some());
        assert!(graph.node(&NodeId::new("c").unwrap()).is_some());
        assert!(graph.node(&NodeId::new("d").unwrap()).is_some());
    }

    #[test]
    fn remove_surface_rejects_an_unknown_key() {
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();
        let mut topology = ContourTopology::new();
        let error = remove_surface(
            &mut graph,
            &mut surfaces,
            &mut topology,
            RemoveSurfaceRequest {
                surface_key: vec!["@region".into(), "missing".into()],
            },
        )
        .unwrap_err();
        assert!(!error.is_empty());
    }
}
