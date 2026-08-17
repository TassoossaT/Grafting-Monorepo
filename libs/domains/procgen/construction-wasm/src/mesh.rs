//! Pure inner functions deriving a triangulated mesh (positions/normals/
//! indices) for a currently-known surface, via
//! `grafting-procgen-surface-mesh::triangulate_surface`. Same split as
//! `editing.rs`: `session.rs`'s `#[wasm_bindgen]` methods are thin JSON
//! wrappers over these, natively unit-testable with zero Wasm involvement.

use serde::{Deserialize, Serialize};

use grafting_graph_core::{SurfaceKey, SurfaceRegistry};
use grafting_procgen_surface_mesh::triangulate_surface;

use crate::dto::surface_key_to_wire;
use crate::editing::SessionGraph;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceMeshDto {
    pub surface_key: Vec<String>,
    pub surface_type: String,
    pub physical: bool,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub indices: Vec<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceMeshRequest {
    pub surface_key: Vec<String>,
}

/// Resolves one surface's cycle to its current graph positions and
/// triangulates it. `None` if the key is not registered, a cycle node was
/// removed from the graph without the surface being cleaned up, or the
/// cycle is currently degenerate (e.g. mid-edit) -- all transient/absent
/// states, not errors, matching `triangulate_surface`'s own `None` cases.
fn mesh_dto_for(graph: &SessionGraph, surfaces: &SurfaceRegistry, key: &SurfaceKey) -> Option<SurfaceMeshDto> {
    let surface = surfaces.surface(key)?;
    let positions: Vec<[f32; 3]> = surface
        .cycle()
        .iter()
        .map(|id| graph.node(id).map(|node| *node.data()))
        .collect::<Option<Vec<_>>>()?;
    let mesh = triangulate_surface(&positions, surface.curvature())?;
    Some(SurfaceMeshDto {
        surface_key: surface_key_to_wire(key),
        surface_type: surface.surface_type().as_str().to_owned(),
        physical: surface.physical(),
        positions: mesh.positions.into_iter().flatten().collect(),
        normals: mesh.normals.into_iter().flatten().collect(),
        indices: mesh.indices,
    })
}

/// Every currently-known surface's mesh, in stable key order -- the
/// bootstrap call a caller uses once to render everything already in the
/// session. Skips (does not error on) any surface that cannot currently be
/// triangulated, per [`mesh_dto_for`].
pub fn all_surface_meshes(
    graph: &SessionGraph,
    surfaces: &SurfaceRegistry,
    known_surfaces: &std::collections::HashSet<SurfaceKey>,
) -> Vec<SurfaceMeshDto> {
    let mut keys: Vec<&SurfaceKey> = known_surfaces.iter().collect();
    keys.sort();
    keys.into_iter().filter_map(|key| mesh_dto_for(graph, surfaces, key)).collect()
}

/// One surface's mesh, by key -- what a caller re-fetches for each entry in
/// an operation's `affectedSurfaceKeys` after a mutation, instead of
/// re-fetching everything via [`all_surface_meshes`].
pub fn surface_mesh(graph: &SessionGraph, surfaces: &SurfaceRegistry, request: SurfaceMeshRequest) -> Result<SurfaceMeshDto, String> {
    let key = crate::dto::surface_key_from_wire(&request.surface_key)?;
    mesh_dto_for(graph, surfaces, &key).ok_or_else(|| format!("no mesh derivable for surface {key:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::{Edge, EdgeId, Graph, Node, NodeId, SurfaceType};

    fn quad_session() -> (SessionGraph, SurfaceRegistry, SurfaceKey) {
        let mut graph: SessionGraph = Graph::try_from_parts(
            vec![
                Node::new(NodeId::new("a").unwrap(), [0.0, 0.0, 0.0]),
                Node::new(NodeId::new("b").unwrap(), [1.0, 0.0, 0.0]),
                Node::new(NodeId::new("c").unwrap(), [1.0, 1.0, 0.0]),
                Node::new(NodeId::new("d").unwrap(), [0.0, 1.0, 0.0]),
            ],
            vec![
                Edge::new(EdgeId::new("ab").unwrap(), NodeId::new("a").unwrap(), NodeId::new("b").unwrap(), ()),
                Edge::new(EdgeId::new("bc").unwrap(), NodeId::new("b").unwrap(), NodeId::new("c").unwrap(), ()),
                Edge::new(EdgeId::new("cd").unwrap(), NodeId::new("c").unwrap(), NodeId::new("d").unwrap(), ()),
                Edge::new(EdgeId::new("da").unwrap(), NodeId::new("d").unwrap(), NodeId::new("a").unwrap(), ()),
            ],
        )
        .unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let key = surfaces
            .add_surface(
                &graph,
                vec![NodeId::new("a").unwrap(), NodeId::new("b").unwrap(), NodeId::new("c").unwrap(), NodeId::new("d").unwrap()],
                SurfaceType::new("floor"),
                true,
            )
            .unwrap();
        let _ = &mut graph;
        (graph, surfaces, key)
    }

    #[test]
    fn surface_mesh_triangulates_a_registered_quad() {
        let (graph, surfaces, key) = quad_session();
        let dto = surface_mesh(&graph, &surfaces, SurfaceMeshRequest { surface_key: surface_key_to_wire(&key) }).unwrap();
        assert_eq!(dto.surface_type, "floor");
        assert!(dto.physical);
        assert_eq!(dto.positions.len(), 12, "4 vertices * 3 components");
        assert_eq!(dto.indices.len(), 6, "2 triangles * 3 indices");
    }

    #[test]
    fn surface_mesh_rejects_an_unregistered_key() {
        let (graph, surfaces, _key) = quad_session();
        let error = surface_mesh(&graph, &surfaces, SurfaceMeshRequest { surface_key: vec!["missing".into()] }).unwrap_err();
        assert!(error.contains("no mesh derivable"), "unexpected error: {error}");
    }

    #[test]
    fn all_surface_meshes_returns_only_known_surfaces() {
        let (graph, surfaces, key) = quad_session();
        let mut known = std::collections::HashSet::new();
        known.insert(key.clone());
        let meshes = all_surface_meshes(&graph, &surfaces, &known);
        assert_eq!(meshes.len(), 1);
        assert_eq!(meshes[0].surface_key.len(), 4);
    }

    #[test]
    fn all_surface_meshes_skips_a_stale_key_without_erroring() {
        let (graph, surfaces, key) = quad_session();
        let mut known = std::collections::HashSet::new();
        known.insert(key);
        known.insert(SurfaceKey::from_cycle(&[NodeId::new("gone").unwrap()]));
        let meshes = all_surface_meshes(&graph, &surfaces, &known);
        assert_eq!(meshes.len(), 1, "the stale/unknown key is skipped, not an error");
    }
}
