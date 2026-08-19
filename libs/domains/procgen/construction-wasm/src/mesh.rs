//! Pure inner functions deriving a triangulated mesh (positions/normals/
//! indices) for a currently-known surface, via
//! `grafting-procgen-surface-mesh::triangulate_surface`. Same split as
//! `editing.rs`: `session.rs`'s `#[wasm_bindgen]` methods are thin JSON
//! wrappers over these, natively unit-testable with zero Wasm involvement.

use serde::{Deserialize, Serialize};

use grafting_graph_core::{ContourTopology, RegionId, SurfaceKey, SurfaceRegistry};
use grafting_procgen_surface_mesh::{triangulate_region, triangulate_surface};

use crate::dto::surface_key_to_wire;
use crate::editing::SessionGraph;

/// Reserved wire marker for a stable analytic-region identity.
pub const REGION_SURFACE_KEY_PREFIX: &str = "@region";

/// Converts a stable analytic region id to the existing surface-key wire
/// slot without changing legacy node-set callers.
pub fn region_id_to_wire(id: &RegionId) -> Vec<String> {
    vec![REGION_SURFACE_KEY_PREFIX.into(), id.as_str().into()]
}

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
fn mesh_dto_for(
    graph: &SessionGraph,
    surfaces: &SurfaceRegistry,
    key: &SurfaceKey,
) -> Option<SurfaceMeshDto> {
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
    topology: &ContourTopology,
    known_regions: &std::collections::HashSet<RegionId>,
) -> Vec<SurfaceMeshDto> {
    let mut keys: Vec<&SurfaceKey> = known_surfaces.iter().collect();
    keys.sort();
    let mut meshes = keys
        .into_iter()
        .filter_map(|key| mesh_dto_for(graph, surfaces, key))
        .collect::<Vec<_>>();
    let mut regions = known_regions.iter().collect::<Vec<_>>();
    regions.sort();
    for region_id in regions {
        let Some(region) = topology.region(region_id) else {
            continue;
        };
        let Some(surface) = surfaces.region_surface(region_id) else {
            continue;
        };
        let Some(region_meshes) = triangulate_region(topology, region, |id| {
            graph.node(id).map(|node| *node.data())
        }) else {
            continue;
        };
        meshes.extend(region_meshes.into_iter().map(|mesh| SurfaceMeshDto {
            surface_key: region_id_to_wire(region_id),
            surface_type: surface.surface_type().as_str().to_owned(),
            physical: surface.physical(),
            positions: mesh.positions.into_iter().flatten().collect(),
            normals: mesh.normals.into_iter().flatten().collect(),
            indices: mesh.indices,
        }));
    }
    meshes
}

/// One surface's mesh piece(s), by key -- what a caller re-fetches for each
/// entry in an operation's `affectedSurfaceKeys` after a mutation, instead
/// of re-fetching everything via [`all_surface_meshes`]. An analytic region
/// surface can legitimately triangulate into more than one disjoint mesh
/// (one per outer loop -- see [`triangulate_region`]), so this always
/// returns every piece a caller must render for the key, never just the
/// first: a single-key lookup that silently kept only one piece is exactly
/// how a merged path-brush region used to lose most of its own geometry.
pub fn surface_mesh(
    graph: &SessionGraph,
    surfaces: &SurfaceRegistry,
    topology: &ContourTopology,
    request: SurfaceMeshRequest,
) -> Result<Vec<SurfaceMeshDto>, String> {
    if let [prefix, region_id] = request.surface_key.as_slice()
        && prefix == REGION_SURFACE_KEY_PREFIX
    {
        let region_id = RegionId::new(region_id.clone()).map_err(|error| error.to_string())?;
        let region = topology
            .region(&region_id)
            .ok_or_else(|| format!("unknown analytic region {region_id}"))?;
        let surface = surfaces
            .region_surface(&region_id)
            .ok_or_else(|| format!("unknown analytic region surface {region_id}"))?;
        let meshes = triangulate_region(topology, region, |id| {
            graph.node(id).map(|node| *node.data())
        })
        .ok_or_else(|| format!("no mesh derivable for analytic region {region_id}"))?;
        if meshes.is_empty() {
            return Err(format!("no mesh derivable for analytic region {region_id}"));
        }
        return Ok(meshes
            .into_iter()
            .map(|mesh| SurfaceMeshDto {
                surface_key: region_id_to_wire(&region_id),
                surface_type: surface.surface_type().as_str().to_owned(),
                physical: surface.physical(),
                positions: mesh.positions.into_iter().flatten().collect(),
                normals: mesh.normals.into_iter().flatten().collect(),
                indices: mesh.indices,
            })
            .collect());
    }
    let key = crate::dto::surface_key_from_wire(&request.surface_key)?;
    let dto = mesh_dto_for(graph, surfaces, &key)
        .ok_or_else(|| format!("no mesh derivable for surface {key:?}"))?;
    Ok(vec![dto])
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::{
        ContourEdge, ContourEdgeId, ContourGeometry, Edge, EdgeId, Graph, Node, NodeId,
        OrientedEdgeUse, SurfaceType,
    };

    fn quad_session() -> (SessionGraph, SurfaceRegistry, SurfaceKey) {
        let mut graph: SessionGraph = Graph::try_from_parts(
            vec![
                Node::new(NodeId::new("a").unwrap(), [0.0, 0.0, 0.0]),
                Node::new(NodeId::new("b").unwrap(), [1.0, 0.0, 0.0]),
                Node::new(NodeId::new("c").unwrap(), [1.0, 1.0, 0.0]),
                Node::new(NodeId::new("d").unwrap(), [0.0, 1.0, 0.0]),
            ],
            vec![
                Edge::new(
                    EdgeId::new("ab").unwrap(),
                    NodeId::new("a").unwrap(),
                    NodeId::new("b").unwrap(),
                    (),
                ),
                Edge::new(
                    EdgeId::new("bc").unwrap(),
                    NodeId::new("b").unwrap(),
                    NodeId::new("c").unwrap(),
                    (),
                ),
                Edge::new(
                    EdgeId::new("cd").unwrap(),
                    NodeId::new("c").unwrap(),
                    NodeId::new("d").unwrap(),
                    (),
                ),
                Edge::new(
                    EdgeId::new("da").unwrap(),
                    NodeId::new("d").unwrap(),
                    NodeId::new("a").unwrap(),
                    (),
                ),
            ],
        )
        .unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let key = surfaces
            .add_surface(
                &graph,
                vec![
                    NodeId::new("a").unwrap(),
                    NodeId::new("b").unwrap(),
                    NodeId::new("c").unwrap(),
                    NodeId::new("d").unwrap(),
                ],
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
        let dtos = surface_mesh(
            &graph,
            &surfaces,
            &ContourTopology::new(),
            SurfaceMeshRequest {
                surface_key: surface_key_to_wire(&key),
            },
        )
        .unwrap();
        assert_eq!(dtos.len(), 1, "a plain (non-region) surface is one piece");
        let dto = &dtos[0];
        assert_eq!(dto.surface_type, "floor");
        assert!(dto.physical);
        assert_eq!(dto.positions.len(), 12, "4 vertices * 3 components");
        assert_eq!(dto.indices.len(), 6, "2 triangles * 3 indices");
    }

    fn quad_loop(
        topology: &mut ContourTopology,
        graph: &SessionGraph,
        prefix: &str,
        nodes: [&str; 4],
    ) -> Vec<OrientedEdgeUse> {
        nodes
            .iter()
            .enumerate()
            .map(|(index, start)| {
                let end = nodes[(index + 1) % nodes.len()];
                let edge_id = ContourEdgeId::new(format!("{prefix}-{index}")).unwrap();
                topology
                    .add_edge(
                        graph,
                        ContourEdge::new(
                            edge_id.clone(),
                            NodeId::new(*start).unwrap(),
                            NodeId::new(end).unwrap(),
                            ContourGeometry::Line,
                        ),
                    )
                    .unwrap();
                OrientedEdgeUse::forward(edge_id)
            })
            .collect()
    }

    /// Two spatially disjoint quads folded into ONE analytic region -- a
    /// source region merged by a path-brush stroke crossing two separate
    /// terrain surfaces legitimately has one outer loop per original piece
    /// (`plan_analytic_path_brush`'s `source_boundaries`). A single-piece
    /// lookup here would silently drop the second quad's geometry: exactly
    /// the real bug behind surfaces "disappearing" after applying a path
    /// brush -- `#applyConstructionMutation`'s per-key refetch only ever
    /// rendered whichever piece happened to come back first.
    #[test]
    fn surface_mesh_returns_every_piece_of_a_multi_loop_region() {
        let graph: SessionGraph = Graph::try_from_parts(
            vec![
                Node::new(NodeId::new("a0").unwrap(), [0.0, 0.0, 0.0]),
                Node::new(NodeId::new("a1").unwrap(), [1.0, 0.0, 0.0]),
                Node::new(NodeId::new("a2").unwrap(), [1.0, 0.0, 1.0]),
                Node::new(NodeId::new("a3").unwrap(), [0.0, 0.0, 1.0]),
                Node::new(NodeId::new("b0").unwrap(), [10.0, 0.0, 0.0]),
                Node::new(NodeId::new("b1").unwrap(), [11.0, 0.0, 0.0]),
                Node::new(NodeId::new("b2").unwrap(), [11.0, 0.0, 1.0]),
                Node::new(NodeId::new("b3").unwrap(), [10.0, 0.0, 1.0]),
            ],
            Vec::new(),
        )
        .unwrap();

        let mut topology = ContourTopology::new();
        let loop_a = quad_loop(&mut topology, &graph, "a", ["a0", "a1", "a2", "a3"]);
        let loop_b = quad_loop(&mut topology, &graph, "b", ["b0", "b1", "b2", "b3"]);

        let region_id = RegionId::new("two-piece").unwrap();
        topology
            .add_region(region_id.clone(), vec![loop_a, loop_b], Vec::new())
            .unwrap();

        let mut surfaces = SurfaceRegistry::new();
        surfaces
            .add_region_surface(&topology, region_id.clone(), SurfaceType::new("terrain"), true)
            .unwrap();

        let dtos = surface_mesh(
            &graph,
            &surfaces,
            &topology,
            SurfaceMeshRequest {
                surface_key: region_id_to_wire(&region_id),
            },
        )
        .unwrap();

        assert_eq!(
            dtos.len(),
            2,
            "a region with two disjoint outer loops must return both mesh pieces, not just the first"
        );
        for dto in &dtos {
            assert!(!dto.indices.is_empty());
        }
    }

    #[test]
    fn surface_mesh_rejects_an_unregistered_key() {
        let (graph, surfaces, _key) = quad_session();
        let error = surface_mesh(
            &graph,
            &surfaces,
            &ContourTopology::new(),
            SurfaceMeshRequest {
                surface_key: vec!["missing".into()],
            },
        )
        .unwrap_err();
        assert!(
            error.contains("no mesh derivable"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn all_surface_meshes_returns_only_known_surfaces() {
        let (graph, surfaces, key) = quad_session();
        let mut known = std::collections::HashSet::new();
        known.insert(key.clone());
        let meshes = all_surface_meshes(
            &graph,
            &surfaces,
            &known,
            &ContourTopology::new(),
            &std::collections::HashSet::new(),
        );
        assert_eq!(meshes.len(), 1);
        assert_eq!(meshes[0].surface_key.len(), 4);
    }

    #[test]
    fn all_surface_meshes_skips_a_stale_key_without_erroring() {
        let (graph, surfaces, key) = quad_session();
        let mut known = std::collections::HashSet::new();
        known.insert(key);
        known.insert(SurfaceKey::from_cycle(&[NodeId::new("gone").unwrap()]));
        let meshes = all_surface_meshes(
            &graph,
            &surfaces,
            &known,
            &ContourTopology::new(),
            &std::collections::HashSet::new(),
        );
        assert_eq!(
            meshes.len(),
            1,
            "the stale/unknown key is skipped, not an error"
        );
    }
}
