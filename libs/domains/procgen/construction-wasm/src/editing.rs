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

use grafting_graph_core::{ContourTopology, Graph, SurfaceRegistry};

use crate::mesh::region_id_from_wire;

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
}
