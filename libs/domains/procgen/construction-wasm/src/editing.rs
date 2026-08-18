//! Pure inner functions for bootstrapping a session's graph (first-time
//! creation, which none of `grafting-graph-core::construction`'s five
//! operations perform) and for those five operations themselves. Each
//! function is `fn(...) -> Result<T, String>`, natively unit-testable with
//! zero Wasm involvement -- `session.rs`'s `#[wasm_bindgen]` methods are the
//! only place a `String` becomes a `JsValue`.

use serde::{Deserialize, Serialize};

use grafting_graph_core::{
    DuplicateSpec, Edge, EdgeId, Graph, Node, NodeId, SurfaceRegistry, SurfaceSpec, SurfaceType,
    delete_node, duplicate_surface, merge_surfaces, move_node, split_surface,
};

use crate::dto::{surface_key_from_wire, surface_key_to_wire};

/// The concrete graph payload every construction-wasm session uses -- bare
/// 3D position, no edge payload -- matching `construction.rs`'s own
/// `pyramid()` test fixture and `ADR-0022`'s "each node carries its spatial
/// position as payload."
pub type SessionGraph = Graph<[f32; 3], ()>;

fn parse_node_id(id: String) -> Result<NodeId, String> {
    NodeId::new(id).map_err(|error| error.to_string())
}

fn parse_cycle(ids: Vec<String>) -> Result<Vec<NodeId>, String> {
    ids.into_iter().map(parse_node_id).collect()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceSpecDto {
    pub cycle: Vec<String>,
    pub surface_type: String,
    pub physical: bool,
}

impl SurfaceSpecDto {
    fn into_spec(self) -> Result<SurfaceSpec, String> {
        Ok(SurfaceSpec {
            cycle: parse_cycle(self.cycle)?,
            surface_type: SurfaceType::new(self.surface_type),
            physical: self.physical,
            curvature: None,
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceKeyResponse {
    pub surface_key: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AffectedSurfacesResponse {
    pub affected_surface_keys: Vec<Vec<String>>,
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

/// Registers a brand-new surface over already-existing nodes.
pub fn add_surface(
    graph: &SessionGraph,
    surfaces: &mut SurfaceRegistry,
    request: SurfaceSpecDto,
) -> Result<SurfaceKeyResponse, String> {
    let cycle = parse_cycle(request.cycle)?;
    let key = surfaces
        .add_surface(
            graph,
            cycle,
            SurfaceType::new(request.surface_type),
            request.physical,
        )
        .map_err(|error| error.to_string())?;
    Ok(SurfaceKeyResponse {
        surface_key: surface_key_to_wire(&key),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveSurfaceRequest {
    pub surface_key: Vec<String>,
}

/// Unregisters a surface outright -- no hole-repair, no cascading. A
/// caller composing a bigger removal (an enclosed region, a whole
/// structure) calls this once per surface it already knows belongs to
/// that removal; there is no dedicated "delete a room" primitive in this
/// crate, because that is nothing more than this operation applied to a
/// caller-known set of surfaces plus [`remove_edge`]/`construction::delete_node`
/// for whatever nodes end up unreferenced.
pub fn remove_surface(
    surfaces: &mut SurfaceRegistry,
    request: RemoveSurfaceRequest,
) -> Result<(), String> {
    let key = surface_key_from_wire(&request.surface_key)?;
    surfaces
        .remove_surface(&key)
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

// ---- The five construction.rs operations ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveNodeRequest {
    pub node_id: String,
    pub position: [f32; 3],
}

/// Moves a node to an absolute position, reporting every surface that
/// referenced it and therefore needs its mesh recomputed.
pub fn apply_move_node(
    graph: &mut SessionGraph,
    surfaces: &SurfaceRegistry,
    request: MoveNodeRequest,
) -> Result<AffectedSurfacesResponse, String> {
    let id = parse_node_id(request.node_id)?;
    let affected = move_node(graph, surfaces, &id, |position| {
        *position = request.position
    })
    .map_err(|error| error.to_string())?;
    Ok(AffectedSurfacesResponse {
        affected_surface_keys: affected.iter().map(surface_key_to_wire).collect(),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteNodeRequest {
    pub node_id: String,
    /// Applied uniformly to every capping cycle `delete_node` happens to
    /// find -- a caller cannot know cycle shapes ahead of the call.
    pub cap_surface_type: String,
    pub cap_physical: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteNodeResponse {
    pub removed_surface_keys: Vec<Vec<String>>,
    pub capping_surface_keys: Vec<Vec<String>>,
}

/// Deletes a node and repairs the hole it leaves, per `ADR-0022`'s general
/// cycle-repair algorithm (see `grafting_graph_core::delete_node`).
pub fn apply_delete_node(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    request: DeleteNodeRequest,
) -> Result<DeleteNodeResponse, String> {
    let id = parse_node_id(request.node_id)?;
    let cap_surface_type = SurfaceType::new(request.cap_surface_type);
    let cap_physical = request.cap_physical;
    let outcome = delete_node(graph, surfaces, &id, move |_cycle| {
        (cap_surface_type.clone(), cap_physical)
    })
    .map_err(|error| error.to_string())?;
    Ok(DeleteNodeResponse {
        removed_surface_keys: outcome
            .removed_surfaces
            .iter()
            .map(surface_key_to_wire)
            .collect(),
        capping_surface_keys: outcome
            .capping_surfaces
            .iter()
            .map(surface_key_to_wire)
            .collect(),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeSurfacesRequest {
    pub a: Vec<String>,
    pub b: Vec<String>,
    pub merged: SurfaceSpecDto,
}

/// Unites two existing surfaces into one new surface.
pub fn apply_merge_surfaces(
    graph: &SessionGraph,
    surfaces: &mut SurfaceRegistry,
    request: MergeSurfacesRequest,
) -> Result<SurfaceKeyResponse, String> {
    let a = surface_key_from_wire(&request.a)?;
    let b = surface_key_from_wire(&request.b)?;
    let merged = request.merged.into_spec()?;
    let key = merge_surfaces(graph, surfaces, &a, &b, merged).map_err(|error| error.to_string())?;
    Ok(SurfaceKeyResponse {
        surface_key: surface_key_to_wire(&key),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitSurfaceRequest {
    pub key: Vec<String>,
    pub first: SurfaceSpecDto,
    pub second: SurfaceSpecDto,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitSurfaceResponse {
    pub first_key: Vec<String>,
    pub second_key: Vec<String>,
}

/// Divides one existing surface into two new surfaces.
pub fn apply_split_surface(
    graph: &SessionGraph,
    surfaces: &mut SurfaceRegistry,
    request: SplitSurfaceRequest,
) -> Result<SplitSurfaceResponse, String> {
    let key = surface_key_from_wire(&request.key)?;
    let first = request.first.into_spec()?;
    let second = request.second.into_spec()?;
    let (first_key, second_key) =
        split_surface(graph, surfaces, &key, first, second).map_err(|error| error.to_string())?;
    Ok(SplitSurfaceResponse {
        first_key: surface_key_to_wire(&first_key),
        second_key: surface_key_to_wire(&second_key),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateNodeDto {
    pub id: String,
    pub position: [f32; 3],
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateSurfaceRequest {
    pub key: Vec<String>,
    /// New nodes, one per node in the original surface's cycle, in the same
    /// order.
    pub nodes: Vec<DuplicateNodeDto>,
    /// New edge ids, one per node in `nodes`, closing the ring -- same
    /// convention as `grafting_graph_core::DuplicateSpec::ring_edges`.
    pub ring_edge_ids: Vec<String>,
    pub surface_type: String,
    pub physical: bool,
}

/// Duplicates a surface: new nodes at caller-supplied positions, connected
/// into a closed ring, forming a new surface.
pub fn apply_duplicate_surface(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    request: DuplicateSurfaceRequest,
) -> Result<SurfaceKeyResponse, String> {
    let key = surface_key_from_wire(&request.key)?;
    let nodes = request
        .nodes
        .into_iter()
        .map(|node| Ok(Node::new(parse_node_id(node.id)?, node.position)))
        .collect::<Result<Vec<_>, String>>()?;
    let ring_edges = request
        .ring_edge_ids
        .into_iter()
        .map(|id| Ok((EdgeId::new(id).map_err(|error| error.to_string())?, ())))
        .collect::<Result<Vec<_>, String>>()?;
    let duplicate = DuplicateSpec {
        nodes,
        ring_edges,
        surface_type: SurfaceType::new(request.surface_type),
        physical: request.physical,
    };
    let new_key =
        duplicate_surface(graph, surfaces, &key, duplicate).map_err(|error| error.to_string())?;
    Ok(SurfaceKeyResponse {
        surface_key: surface_key_to_wire(&new_key),
    })
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
    fn add_node_then_add_edge_then_add_surface_round_trips() {
        let mut graph = empty_graph();
        add(&mut graph, "a", [0.0, 0.0, 0.0]);
        add(&mut graph, "b", [1.0, 0.0, 0.0]);
        add(&mut graph, "c", [0.0, 1.0, 0.0]);
        edge(&mut graph, "ab", "a", "b");
        edge(&mut graph, "bc", "b", "c");
        edge(&mut graph, "ca", "c", "a");

        let mut surfaces = SurfaceRegistry::new();
        let response = add_surface(
            &graph,
            &mut surfaces,
            SurfaceSpecDto {
                cycle: vec!["a".into(), "b".into(), "c".into()],
                surface_type: "wall".into(),
                physical: true,
            },
        )
        .unwrap();
        let mut key = response.surface_key;
        key.sort();
        assert_eq!(key, vec!["a".to_string(), "b".to_string(), "c".to_string()]);
    }

    #[test]
    fn remove_surface_unregisters_it_without_touching_the_graph() {
        let mut graph = empty_graph();
        add(&mut graph, "a", [0.0, 0.0, 0.0]);
        add(&mut graph, "b", [1.0, 0.0, 0.0]);
        add(&mut graph, "c", [0.0, 1.0, 0.0]);
        edge(&mut graph, "ab", "a", "b");
        edge(&mut graph, "bc", "b", "c");
        edge(&mut graph, "ca", "c", "a");
        let mut surfaces = SurfaceRegistry::new();
        add_surface(
            &graph,
            &mut surfaces,
            SurfaceSpecDto {
                cycle: vec!["a".into(), "b".into(), "c".into()],
                surface_type: "wall".into(),
                physical: true,
            },
        )
        .unwrap();

        remove_surface(
            &mut surfaces,
            RemoveSurfaceRequest {
                surface_key: vec!["a".into(), "b".into(), "c".into()],
            },
        )
        .unwrap();

        assert!(
            surfaces
                .surfaces_referencing(&NodeId::new("a").unwrap())
                .next()
                .is_none()
        );
        assert!(
            graph.node(&NodeId::new("a").unwrap()).is_some(),
            "removing a surface never touches its nodes"
        );
    }

    #[test]
    fn remove_surface_rejects_an_unknown_key() {
        let mut surfaces = SurfaceRegistry::new();
        let error = remove_surface(
            &mut surfaces,
            RemoveSurfaceRequest {
                surface_key: vec!["missing".into()],
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

    fn triangle_with_surface() -> (SessionGraph, SurfaceRegistry, Vec<String>) {
        let mut graph = empty_graph();
        add(&mut graph, "a", [0.0, 0.0, 0.0]);
        add(&mut graph, "b", [1.0, 0.0, 0.0]);
        add(&mut graph, "c", [0.0, 1.0, 0.0]);
        edge(&mut graph, "ab", "a", "b");
        edge(&mut graph, "bc", "b", "c");
        edge(&mut graph, "ca", "c", "a");
        let mut surfaces = SurfaceRegistry::new();
        let key = add_surface(
            &graph,
            &mut surfaces,
            SurfaceSpecDto {
                cycle: vec!["a".into(), "b".into(), "c".into()],
                surface_type: "wall".into(),
                physical: true,
            },
        )
        .unwrap()
        .surface_key;
        (graph, surfaces, key)
    }

    #[test]
    fn move_node_reports_the_referencing_surface() {
        let (mut graph, surfaces, _key) = triangle_with_surface();
        let response = apply_move_node(
            &mut graph,
            &surfaces,
            MoveNodeRequest {
                node_id: "a".into(),
                position: [9.0, 9.0, 9.0],
            },
        )
        .unwrap();
        assert_eq!(response.affected_surface_keys.len(), 1);
        assert_eq!(
            *graph.node(&NodeId::new("a").unwrap()).unwrap().data(),
            [9.0, 9.0, 9.0]
        );
    }

    #[test]
    fn move_node_rejects_an_unknown_node() {
        let (mut graph, surfaces, _key) = triangle_with_surface();
        let error = apply_move_node(
            &mut graph,
            &surfaces,
            MoveNodeRequest {
                node_id: "missing".into(),
                position: [0.0; 3],
            },
        )
        .unwrap_err();
        assert!(!error.is_empty());
    }

    #[test]
    fn delete_node_removes_the_referencing_surface_with_no_cap_for_a_triangle() {
        let (mut graph, mut surfaces, key) = triangle_with_surface();
        let response = apply_delete_node(
            &mut graph,
            &mut surfaces,
            DeleteNodeRequest {
                node_id: "a".into(),
                cap_surface_type: "floor".into(),
                cap_physical: true,
            },
        )
        .unwrap();
        let mut removed = response.removed_surface_keys[0].clone();
        removed.sort();
        let mut expected = key;
        expected.sort();
        assert_eq!(removed, expected);
        // "b" and "c" remain connected by one edge, not a cycle -- no cap.
        assert!(response.capping_surface_keys.is_empty());
    }

    #[test]
    fn merge_surfaces_unites_two_adjacent_triangles() {
        let mut graph = empty_graph();
        for (id, position) in [
            ("a", [0.0, 0.0, 0.0]),
            ("b", [1.0, 0.0, 0.0]),
            ("c", [1.0, 1.0, 0.0]),
            ("d", [0.0, 1.0, 0.0]),
        ] {
            add(&mut graph, id, position);
        }
        for (id, a, b) in [
            ("ab", "a", "b"),
            ("bc", "b", "c"),
            ("ca", "c", "a"),
            ("ac", "a", "c"),
            ("cd", "c", "d"),
            ("da", "d", "a"),
        ] {
            edge(&mut graph, id, a, b);
        }
        let mut surfaces = SurfaceRegistry::new();
        let side_abc = add_surface(
            &graph,
            &mut surfaces,
            SurfaceSpecDto {
                cycle: vec!["a".into(), "b".into(), "c".into()],
                surface_type: "wall".into(),
                physical: true,
            },
        )
        .unwrap()
        .surface_key;
        let side_acd = add_surface(
            &graph,
            &mut surfaces,
            SurfaceSpecDto {
                cycle: vec!["a".into(), "c".into(), "d".into()],
                surface_type: "wall".into(),
                physical: true,
            },
        )
        .unwrap()
        .surface_key;

        let response = apply_merge_surfaces(
            &graph,
            &mut surfaces,
            MergeSurfacesRequest {
                a: side_abc,
                b: side_acd,
                merged: SurfaceSpecDto {
                    cycle: vec!["a".into(), "b".into(), "c".into(), "d".into()],
                    surface_type: "floor".into(),
                    physical: true,
                },
            },
        )
        .unwrap();
        let mut merged = response.surface_key;
        merged.sort();
        assert_eq!(
            merged,
            vec![
                "a".to_string(),
                "b".to_string(),
                "c".to_string(),
                "d".to_string()
            ]
        );
    }

    #[test]
    fn split_surface_divides_a_quad_into_two_triangles() {
        let mut graph = empty_graph();
        for (id, position) in [
            ("a", [0.0, 0.0, 0.0]),
            ("b", [1.0, 0.0, 0.0]),
            ("c", [1.0, 1.0, 0.0]),
            ("d", [0.0, 1.0, 0.0]),
        ] {
            add(&mut graph, id, position);
        }
        for (id, a, b) in [
            ("ab", "a", "b"),
            ("bc", "b", "c"),
            ("cd", "c", "d"),
            ("da", "d", "a"),
            ("ac", "a", "c"),
        ] {
            edge(&mut graph, id, a, b);
        }
        let mut surfaces = SurfaceRegistry::new();
        let quad = add_surface(
            &graph,
            &mut surfaces,
            SurfaceSpecDto {
                cycle: vec!["a".into(), "b".into(), "c".into(), "d".into()],
                surface_type: "floor".into(),
                physical: true,
            },
        )
        .unwrap()
        .surface_key;

        let response = apply_split_surface(
            &graph,
            &mut surfaces,
            SplitSurfaceRequest {
                key: quad,
                first: SurfaceSpecDto {
                    cycle: vec!["a".into(), "b".into(), "c".into()],
                    surface_type: "floor".into(),
                    physical: true,
                },
                second: SurfaceSpecDto {
                    cycle: vec!["a".into(), "c".into(), "d".into()],
                    surface_type: "floor".into(),
                    physical: true,
                },
            },
        )
        .unwrap();
        assert_eq!(response.first_key.len(), 3);
        assert_eq!(response.second_key.len(), 3);
    }

    #[test]
    fn duplicate_surface_creates_a_parallel_copy() {
        let (graph_only, _surfaces, _key) = triangle_with_surface();
        let _ = graph_only;
        let (mut graph, mut surfaces, key) = triangle_with_surface();

        let response = apply_duplicate_surface(
            &mut graph,
            &mut surfaces,
            DuplicateSurfaceRequest {
                key,
                nodes: vec![
                    DuplicateNodeDto {
                        id: "a2".into(),
                        position: [0.0, 0.0, 1.0],
                    },
                    DuplicateNodeDto {
                        id: "b2".into(),
                        position: [1.0, 0.0, 1.0],
                    },
                    DuplicateNodeDto {
                        id: "c2".into(),
                        position: [0.0, 1.0, 1.0],
                    },
                ],
                ring_edge_ids: vec!["a2-b2".into(), "b2-c2".into(), "c2-a2".into()],
                surface_type: "wall".into(),
                physical: true,
            },
        )
        .unwrap();
        let mut new_key = response.surface_key;
        new_key.sort();
        assert_eq!(
            new_key,
            vec!["a2".to_string(), "b2".to_string(), "c2".to_string()]
        );
        assert!(graph.node(&NodeId::new("a2").unwrap()).is_some());
    }
}
