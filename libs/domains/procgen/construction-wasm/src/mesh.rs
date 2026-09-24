//! Pure inner functions deriving a triangulated mesh (positions/normals/
//! indices) for a currently-known surface, via
//! `grafting-procgen-surface-mesh::triangulate_region`. Same split as
//! `editing.rs`: `session.rs`'s `#[wasm_bindgen]` methods are thin JSON
//! wrappers over these, natively unit-testable with zero Wasm involvement.

use serde::{Deserialize, Serialize};

use grafting_graph_core::curve_offset::{ReferenceCurve, ReferenceField};
use grafting_graph_core::{ContourTopology, RegionId, SurfaceRegion, SurfaceRegistry};
use grafting_procgen_surface_mesh::{PlanarFill, TriangulatedMesh, triangulate_region_cut};

use crate::editing::SessionGraph;
use crate::pins::Cutting;

/// Reserved wire marker for a stable analytic-region identity.
pub const REGION_SURFACE_KEY_PREFIX: &str = "@region";

/// How finely a graph curve is flattened before it becomes a reference
/// curve. Tighter than the contour's own flattening on purpose: this is the
/// height and parametrization authority for everything swept from it, so its
/// own approximation error should be well under the mesh detail it answers
/// for.
const FIELD_SAMPLE_ACCURACY: f64 = 0.02;

/// Largest triangle left standing inside a filled planar face, in square
/// metres.
const PLANAR_FILL_MAX_AREA: f32 = 1.0;

/// A ground-plane extent.
type Bounds = [f32; 4];

fn grown(bounds: Bounds, by: f32) -> Bounds {
    [
        bounds[0] - by,
        bounds[1] - by,
        bounds[2] + by,
        bounds[3] + by,
    ]
}

fn overlaps(a: Bounds, b: Bounds) -> bool {
    a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}

fn enclosing(points: impl IntoIterator<Item = [f32; 3]>) -> Option<Bounds> {
    let mut bounds: Option<Bounds> = None;
    for point in points {
        bounds = Some(match bounds {
            None => [point[0], point[2], point[0], point[2]],
            Some(b) => [
                b[0].min(point[0]),
                b[1].min(point[2]),
                b[2].max(point[0]),
                b[3].max(point[2]),
            ],
        });
    }
    bounds
}

/// The ground-plane extent of a region's own boundary, from the graph
/// positions its loops are drawn between.
fn region_bounds(
    graph: &SessionGraph,
    topology: &ContourTopology,
    region: &SurfaceRegion,
) -> Option<Bounds> {
    let mut points = Vec::new();
    for loop_ in region.outer_loops().iter().chain(region.holes()) {
        for use_ in loop_ {
            let Some(edge) = topology.edge(use_.edge()) else {
                continue;
            };
            for node in [edge.start_node(), edge.end_node()] {
                if let Some(node) = graph.node(node) {
                    points.push(*node.data());
                }
            }
        }
    }
    enclosing(points)
}

/// The extent covering every one of these regions -- what a batch scopes its
/// field to, so the curve walk is paid once for the whole batch instead of
/// once per face. Per face it would be work proportional to (roads on the
/// map) x (faces being meshed), which is the wrong shape twice over.
fn regions_bounds<'a>(
    graph: &SessionGraph,
    topology: &ContourTopology,
    regions: impl IntoIterator<Item = &'a SurfaceRegion>,
) -> Option<Bounds> {
    let mut total: Option<Bounds> = None;
    for region in regions {
        let Some(bounds) = region_bounds(graph, topology, region) else {
            continue;
        };
        total = Some(match total {
            None => bounds,
            Some(t) => [
                t[0].min(bounds[0]),
                t[1].min(bounds[1]),
                t[2].max(bounds[2]),
                t[3].max(bounds[3]),
            ],
        });
    }
    total
}

/// The curves near `bounds`, as the field that elevates and parametrizes
/// whatever was swept from them.
///
/// **A curve-carrying edge is the whole test.** Not an id prefix, not a
/// surface type -- an edge that stores handles is, by construction, an edge
/// something was generated along, and its own band offsets say how far that
/// generation reached. So this needs no list of which kinds of surface have
/// curves under them, and a future one that does inherits the correct mesh
/// without anybody revisiting this function.
///
/// **Scoped, which is the difference between this being affordable and
/// not.** Built for every curve on the map, the walk is proportional to how
/// much road exists rather than to how much is being meshed, and it is paid
/// again on every mesh batch -- which is what made this unusable the first
/// time it was wired up. A curve can only answer for ground within its own
/// reach of itself, so one further away than that from everything being
/// meshed cannot contribute to the answer and is skipped before it is ever
/// sampled. The cheap test is the curve's control polygon, which contains
/// the curve itself, so nothing that could matter is skipped.
///
/// Rebuilt per mesh request rather than cached: the graph is the only copy
/// of this, and a cache would be one more thing that can disagree with it.
pub fn reference_field_near(graph: &SessionGraph, bounds: Option<Bounds>) -> ReferenceField {
    let Some(bounds) = bounds else {
        return ReferenceField::default();
    };
    ReferenceField::new(graph.edges().into_iter().filter_map(|edge| {
        let handles = edge.data().as_ref()?;
        let reach = handles
            .band_offsets
            .iter()
            .fold(0.0_f64, |widest, offset| widest.max(offset.abs()));
        if reach <= 0.0 {
            return None;
        }
        let start = graph.node(edge.source())?.data().map(f64::from);
        let end = graph.node(edge.target())?.data().map(f64::from);
        let curve = handles.resolve(start, end);
        let hull = enclosing(
            curve
                .points
                .iter()
                .map(|point| [point[0] as f32, point[1] as f32, point[2] as f32]),
        )?;
        if !overlaps(grown(hull, reach as f32), bounds) {
            return None;
        }
        let samples = curve.sample(FIELD_SAMPLE_ACCURACY).ok()?;
        Some(ReferenceCurve {
            points: samples
                .iter()
                .map(|sample| {
                    [
                        sample.position[0] as f32,
                        sample.position[1] as f32,
                        sample.position[2] as f32,
                    ]
                })
                .collect(),
            reach: reach as f32,
        })
    }))
}

/// The fill a region mesh is derived with, or `None` when no curve reaches
/// it and there is nothing to fill against.
fn planar_fill(field: &ReferenceField) -> Option<PlanarFill<'_>> {
    (!field.is_empty()).then(|| PlanarFill::new(field, PLANAR_FILL_MAX_AREA))
}

/// One region's mesh pieces: cut by whatever is pinned to it, or, when it
/// lies wholly on a host and cuts nothing out of itself, drawn in that
/// host's frame.
fn region_meshes(
    graph: &SessionGraph,
    surfaces: &SurfaceRegistry,
    topology: &ContourTopology,
    region_id: &RegionId,
    region: &SurfaceRegion,
    fill: Option<PlanarFill<'_>>,
    cutting: Option<&Cutting<'_>>,
) -> Option<Vec<TriangulatedMesh>> {
    let cutters = cutting.map_or_else(Vec::new, |cutting| {
        cutting.rings(graph, surfaces, topology, region_id)
    });
    if cutters.is_empty()
        && let Some(mesh) =
            cutting.and_then(|cutting| cutting.tracer().mesh(graph, topology, region))
    {
        return Some(vec![mesh]);
    }
    triangulate_region_cut(
        topology,
        region,
        |id| graph.node(id).map(|node| *node.data()),
        fill,
        &cutters,
    )
}

/// Converts a stable analytic region id to the existing surface-key wire
/// slot without changing legacy node-set callers.
pub fn region_id_to_wire(id: &RegionId) -> Vec<String> {
    vec![REGION_SURFACE_KEY_PREFIX.into(), id.as_str().into()]
}

/// Recovers a [`RegionId`] from the wire marker [`region_id_to_wire`]
/// produces, for callers (e.g. `session.rs`'s post-mutation bookkeeping)
/// that received one back from a JSON response and need the real id again.
pub fn region_id_from_wire(wire: &[String]) -> Result<RegionId, String> {
    match wire {
        [prefix, id] if prefix == REGION_SURFACE_KEY_PREFIX => {
            RegionId::new(id.clone()).map_err(|error| error.to_string())
        }
        _ => Err(format!("not a region wire key: {wire:?}")),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceMeshDto {
    pub surface_key: Vec<String>,
    pub surface_type: String,
    pub physical: bool,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    /// Flat `uv` pairs, in world units -- see
    /// `grafting_procgen_surface_mesh::TriangulatedMesh::uvs` for why these
    /// are metres of the surface's own extent rather than a `0..1` box.
    pub uvs: Vec<f32>,
    pub indices: Vec<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceMeshRequest {
    pub surface_key: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceMeshesRequest {
    pub surface_keys: Vec<Vec<String>>,
}

/// Every currently-known region's mesh, in stable id order -- the
/// bootstrap call a caller uses once to render everything already in the
/// session. Skips (does not error on) any region that cannot currently be
/// triangulated: a degenerate boundary mid-edit is a transient state, not
/// an error.
pub fn all_surface_meshes(
    graph: &SessionGraph,
    surfaces: &SurfaceRegistry,
    topology: &ContourTopology,
    known_regions: &std::collections::HashSet<RegionId>,
    cutting: Option<&Cutting<'_>>,
) -> Vec<SurfaceMeshDto> {
    let mut meshes = Vec::new();
    let mut regions = known_regions.iter().collect::<Vec<_>>();
    regions.sort();
    let field = reference_field_near(
        graph,
        regions_bounds(
            graph,
            topology,
            regions.iter().filter_map(|id| topology.region(id)),
        ),
    );
    let fill = planar_fill(&field);
    for region_id in regions {
        let Some(region) = topology.region(region_id) else {
            continue;
        };
        let Some(surface) = surfaces.region_surface(region_id) else {
            continue;
        };
        let Some(region_meshes) =
            region_meshes(graph, surfaces, topology, region_id, region, fill, cutting)
        else {
            continue;
        };
        meshes.extend(region_meshes.into_iter().map(|mesh| SurfaceMeshDto {
            surface_key: region_id_to_wire(region_id),
            surface_type: surface.surface_type().as_str().to_owned(),
            physical: surface.physical(),
            positions: mesh.positions.into_iter().flatten().collect(),
            normals: mesh.normals.into_iter().flatten().collect(),
            uvs: mesh.uvs.into_iter().flatten().collect(),
            indices: mesh.indices,
        }));
    }
    meshes
}

/// One region's mesh piece(s), by key -- what a caller re-fetches for each
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
    cutting: Option<&Cutting<'_>>,
) -> Result<Vec<SurfaceMeshDto>, String> {
    let field = reference_field_near(
        graph,
        region_id_from_wire(&request.surface_key)
            .ok()
            .and_then(|id| topology.region(&id))
            .and_then(|region| region_bounds(graph, topology, region)),
    );
    surface_mesh_with(graph, surfaces, topology, request, planar_fill(&field), cutting)
}

/// [`surface_mesh`] against a field the caller already built.
///
/// Deriving the field walks the graph's curves once, so a caller asking for
/// several keys at a time builds it once for the whole batch rather than
/// paying that walk per face.
fn surface_mesh_with(
    graph: &SessionGraph,
    surfaces: &SurfaceRegistry,
    topology: &ContourTopology,
    request: SurfaceMeshRequest,
    fill: Option<PlanarFill<'_>>,
    cutting: Option<&Cutting<'_>>,
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
        let meshes = region_meshes(graph, surfaces, topology, &region_id, region, fill, cutting)
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
                uvs: mesh.uvs.into_iter().flatten().collect(),
                indices: mesh.indices,
            })
            .collect());
    }
    Err(format!(
        "not an analytic region key: {:?}",
        request.surface_key
    ))
}

/// Meshes for a known mutation set, serialized through one Wasm crossing.
/// Stale keys are skipped exactly like the runtime's former per-key loop.
pub fn surface_meshes(
    graph: &SessionGraph,
    surfaces: &SurfaceRegistry,
    topology: &ContourTopology,
    request: SurfaceMeshesRequest,
    cutting: Option<&Cutting<'_>>,
) -> Vec<SurfaceMeshDto> {
    surface_meshes_report(graph, surfaces, topology, request, cutting).meshes
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedSurfaceMeshDto {
    pub surface_key: Vec<String>,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceMeshesReportDto {
    pub meshes: Vec<SurfaceMeshDto>,
    pub failed: Vec<FailedSurfaceMeshDto>,
}

/// [`surface_meshes`], naming every key that produced nothing and why, so a
/// caller never drops a face's render without knowing.
pub fn surface_meshes_report(
    graph: &SessionGraph,
    surfaces: &SurfaceRegistry,
    topology: &ContourTopology,
    request: SurfaceMeshesRequest,
    cutting: Option<&Cutting<'_>>,
) -> SurfaceMeshesReportDto {
    let mut seen = std::collections::HashSet::new();
    let mut meshes = Vec::new();
    let mut failed = Vec::new();
    // One field for the whole batch, scoped to the batch's own extent. A
    // refresh after a stroke asks for the handful of faces that stroke
    // touched, so this is the neighbourhood of the stroke -- not the map.
    let field = reference_field_near(
        graph,
        regions_bounds(
            graph,
            topology,
            request.surface_keys.iter().filter_map(|key| {
                topology.region(&region_id_from_wire(key).ok()?)
            }),
        ),
    );
    let fill = planar_fill(&field);
    for surface_key in request.surface_keys {
        if !seen.insert(surface_key.clone()) {
            continue;
        }
        let known = region_id_from_wire(&surface_key)
            .is_ok_and(|id| topology.region(&id).is_some() && surfaces.region_surface(&id).is_some());
        if !known {
            failed.push(FailedSurfaceMeshDto { surface_key, reason: "unknown".into() });
            continue;
        }
        match surface_mesh_with(
            graph,
            surfaces,
            topology,
            SurfaceMeshRequest { surface_key: surface_key.clone() },
            fill,
            cutting,
        ) {
            Ok(mut pieces) => meshes.append(&mut pieces),
            Err(reason) => failed.push(FailedSurfaceMeshDto { surface_key, reason }),
        }
    }
    SurfaceMeshesReportDto { meshes, failed }
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::{
        ContourEdge, ContourEdgeId, ContourGeometry, Graph, Node, NodeId, OrientedEdgeUse,
        SurfaceType,
    };

    fn quad_graph() -> SessionGraph {
        Graph::try_from_parts(
            vec![
                Node::new(NodeId::new("a").unwrap(), [0.0, 0.0, 0.0]),
                Node::new(NodeId::new("b").unwrap(), [1.0, 0.0, 0.0]),
                Node::new(NodeId::new("c").unwrap(), [1.0, 1.0, 0.0]),
                Node::new(NodeId::new("d").unwrap(), [0.0, 1.0, 0.0]),
            ],
            Vec::new(),
        )
        .unwrap()
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
    /// remainder left by an overlay crossing two separate terrain surfaces
    /// legitimately has one outer loop per original piece
    /// (`plan_region_merge_regions`'s consumed boundaries). A single-piece
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
            .add_region_surface(
                &topology,
                region_id.clone(),
                SurfaceType::new("terrain"),
                true,
            )
            .unwrap();

        let dtos = surface_mesh(
            &graph,
            &surfaces,
            &topology,
            SurfaceMeshRequest {
                surface_key: region_id_to_wire(&region_id),
            },
            None,
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

    /// One quad as the only kind of face there is: an analytic region over
    /// four straight contour edges.
    fn quad_region() -> (SessionGraph, SurfaceRegistry, ContourTopology, RegionId) {
        let graph = quad_graph();
        let mut topology = ContourTopology::new();
        let loop_ = quad_loop(&mut topology, &graph, "quad", ["a", "b", "c", "d"]);
        let region_id = RegionId::new("quad").unwrap();
        topology
            .add_region(region_id.clone(), vec![loop_], Vec::new())
            .unwrap();
        let mut surfaces = SurfaceRegistry::new();
        surfaces
            .add_region_surface(
                &topology,
                region_id.clone(),
                SurfaceType::new("floor"),
                true,
            )
            .unwrap();
        (graph, surfaces, topology, region_id)
    }

    #[test]
    fn surface_mesh_triangulates_a_registered_quad() {
        let (graph, surfaces, topology, region_id) = quad_region();
        let dtos = surface_mesh(
            &graph,
            &surfaces,
            &topology,
            SurfaceMeshRequest {
                surface_key: region_id_to_wire(&region_id),
            },
            None,
        )
        .unwrap();
        assert_eq!(dtos.len(), 1, "one outer loop is one piece");
        let dto = &dtos[0];
        assert_eq!(dto.surface_type, "floor");
        assert!(dto.physical);
        assert_eq!(dto.positions.len(), 12, "4 vertices * 3 components");
        assert_eq!(dto.indices.len(), 6, "2 triangles * 3 indices");
    }

    #[test]
    fn surface_mesh_rejects_an_unregistered_region() {
        let (graph, surfaces, topology, _region_id) = quad_region();
        let error = surface_mesh(
            &graph,
            &surfaces,
            &topology,
            SurfaceMeshRequest {
                surface_key: vec!["@region".into(), "missing".into()],
            },
            None,
        )
        .unwrap_err();
        assert!(
            error.contains("unknown analytic region"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn surface_mesh_rejects_a_key_that_is_not_a_region_at_all() {
        let (graph, surfaces, topology, _region_id) = quad_region();
        let error = surface_mesh(
            &graph,
            &surfaces,
            &topology,
            SurfaceMeshRequest {
                surface_key: vec!["a".into(), "b".into(), "c".into()],
            },
            None,
        )
        .unwrap_err();
        assert!(!error.is_empty());
    }

    #[test]
    fn all_surface_meshes_returns_only_known_regions() {
        let (graph, surfaces, topology, region_id) = quad_region();
        let known = std::collections::HashSet::from([region_id.clone()]);
        let meshes = all_surface_meshes(&graph, &surfaces, &topology, &known, None);
        assert_eq!(meshes.len(), 1);
        assert_eq!(meshes[0].surface_key, region_id_to_wire(&region_id));

        let none = all_surface_meshes(
            &graph,
            &surfaces,
            &topology,
            &std::collections::HashSet::new(),
            None,
        );
        assert!(
            none.is_empty(),
            "a region nobody knows about is not rendered"
        );
    }

    #[test]
    fn all_surface_meshes_skips_a_stale_id_without_erroring() {
        let (graph, surfaces, topology, region_id) = quad_region();
        let known = std::collections::HashSet::from([region_id, RegionId::new("gone").unwrap()]);
        let meshes = all_surface_meshes(&graph, &surfaces, &topology, &known, None);
        assert_eq!(meshes.len(), 1, "the stale id is skipped, not an error");
    }

    fn flat_region(
        nodes: &[(&str, [f32; 3])],
        outer: &[&str],
        holes: &[&[&str]],
    ) -> (SessionGraph, SurfaceRegistry, ContourTopology, RegionId) {
        let graph: SessionGraph = Graph::try_from_parts(
            nodes
                .iter()
                .map(|(id, position)| Node::new(NodeId::new(*id).unwrap(), *position))
                .collect(),
            Vec::new(),
        )
        .unwrap();
        let mut topology = ContourTopology::new();
        let mut loop_of = |prefix: &str, ids: &[&str]| -> Vec<OrientedEdgeUse> {
            (0..ids.len())
                .map(|index| {
                    let edge_id = ContourEdgeId::new(format!("{prefix}-{index}")).unwrap();
                    topology
                        .add_edge(
                            &graph,
                            ContourEdge::new(
                                edge_id.clone(),
                                NodeId::new(ids[index]).unwrap(),
                                NodeId::new(ids[(index + 1) % ids.len()]).unwrap(),
                                ContourGeometry::Line,
                            ),
                        )
                        .unwrap();
                    OrientedEdgeUse::forward(edge_id)
                })
                .collect()
        };
        let outer_loop = loop_of("outer", outer);
        let hole_loops: Vec<_> = holes
            .iter()
            .enumerate()
            .map(|(index, hole)| loop_of(&format!("hole{index}"), hole))
            .collect();
        let region_id = RegionId::new("face").unwrap();
        topology
            .add_region(region_id.clone(), vec![outer_loop], hole_loops)
            .unwrap();
        let mut surfaces = SurfaceRegistry::new();
        surfaces
            .add_region_surface(&topology, region_id.clone(), SurfaceType::new("path"), true)
            .unwrap();
        (graph, surfaces, topology, region_id)
    }

    fn xz_area(dtos: &[SurfaceMeshDto]) -> f32 {
        dtos.iter()
            .map(|dto| {
                dto.indices
                    .chunks_exact(3)
                    .map(|triangle| {
                        let p = |i: u32| [dto.positions[i as usize * 3], dto.positions[i as usize * 3 + 2]];
                        let (a, b, c) = (p(triangle[0]), p(triangle[1]), p(triangle[2]));
                        0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).abs()
                    })
                    .sum::<f32>()
            })
            .sum()
    }

    fn report(
        (graph, surfaces, topology, region_id): &(SessionGraph, SurfaceRegistry, ContourTopology, RegionId),
        extra: Vec<Vec<String>>,
    ) -> SurfaceMeshesReportDto {
        let mut surface_keys = vec![region_id_to_wire(region_id)];
        surface_keys.extend(extra);
        surface_meshes_report(graph, surfaces, topology, SurfaceMeshesRequest { surface_keys }, None)
    }

    /// A loop that crosses itself -- a bow tie -- is read under the non-zero
    /// rule as its two lobes, not refused.
    #[test]
    fn a_self_crossing_loop_meshes_as_its_filled_lobes() {
        let region = flat_region(
            &[
                ("a", [0.0, 0.0, 0.0]),
                ("b", [2.0, 0.0, 2.0]),
                ("c", [2.0, 0.0, 0.0]),
                ("d", [0.0, 0.0, 2.0]),
            ],
            &["a", "b", "c", "d"],
            &[],
        );
        let report = report(&region, Vec::new());
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        assert!((xz_area(&report.meshes) - 2.0).abs() < 1e-4, "{}", xz_area(&report.meshes));
    }

    /// A hole collapsed to two edges between the same two nodes encloses
    /// nothing; it used to fail the whole face's mesh.
    #[test]
    fn a_collapsed_hole_no_longer_fails_the_face() {
        let square = [
            ("a", [0.0, 0.0, 0.0]),
            ("b", [4.0, 0.0, 0.0]),
            ("c", [4.0, 0.0, 4.0]),
            ("d", [0.0, 0.0, 4.0]),
            ("h0", [1.0, 0.0, 1.0]),
            ("h1", [2.0, 0.0, 1.0]),
            ("k0", [2.0, 0.0, 2.0]),
            ("k1", [3.0, 0.0, 2.0]),
            ("k2", [3.0, 0.0, 3.0]),
            ("k3", [2.0, 0.0, 3.0]),
        ];
        let region = flat_region(&square, &["a", "b", "c", "d"], &[&["h0", "h1"], &["k0", "k1", "k2", "k3"]]);
        let report = report(&region, Vec::new());
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        assert!((xz_area(&report.meshes) - 15.0).abs() < 1e-4, "{}", xz_area(&report.meshes));
    }

    #[test]
    fn a_valid_face_meshes_exactly_as_before() {
        let (graph, surfaces, topology, region_id) = quad_region();
        let direct = surface_mesh(
            &graph,
            &surfaces,
            &topology,
            SurfaceMeshRequest { surface_key: region_id_to_wire(&region_id) },
            None,
        )
        .unwrap();
        let region = quad_region();
        let report = report(&region, Vec::new());
        assert_eq!(report.meshes.len(), direct.len());
        assert_eq!(report.meshes[0].positions, direct[0].positions);
        assert_eq!(report.meshes[0].indices, direct[0].indices);
    }

    #[test]
    fn the_report_names_unmeshable_and_unknown_keys() {
        let region = flat_region(
            &[("a", [0.0, 0.0, 0.0]), ("b", [1.0, 0.0, 0.0]), ("c", [2.0, 0.0, 0.0])],
            &["a", "b", "c"],
            &[],
        );
        let report = report(&region, vec![vec!["@region".into(), "gone".into()], vec!["junk".into()]]);
        assert!(report.meshes.is_empty());
        assert_eq!(report.failed.len(), 3);
        assert_eq!(report.failed[0].surface_key, region_id_to_wire(&region.3));
        assert!(report.failed[0].reason.contains("no mesh derivable"), "{}", report.failed[0].reason);
        assert_eq!(report.failed[1].reason, "unknown");
        assert_eq!(report.failed[2].reason, "unknown");
    }
}
