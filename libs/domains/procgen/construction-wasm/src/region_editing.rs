//! The JSON wire shape for `grafting-graph-core`'s atomic region-edit
//! vocabulary, plus the region-topology query the front end's own
//! role-to-policy tables are indexed against.
//!
//! Same split as `editing.rs`: every function here is
//! `fn(...) -> Result<T, String>`, natively unit-testable with zero Wasm
//! involvement; `session.rs`'s `#[wasm_bindgen]` methods are the only place
//! a `String` becomes a `JsValue`.
//!
//! **No structure type crosses this boundary.** There is no "wall op" or
//! "terrain op" here -- which primitives a wall allows, what constrains
//! their parameters, and what cascades alongside them is entirely the front
//! end's, per `docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.
//! What this layer owes that split is the deterministic ordering
//! [`region_topology`] reports.

use serde::{Deserialize, Serialize};

use grafting_graph_core::{
    ContourEdge, ContourEdgeId, ContourGeometry, ContourLoop, ContourTopology, DuplicateRegionSpec,
    Node, NodeId, OrientedEdgeUse, RegionEditOutcome, RegionId, SurfaceRegistry, SurfaceType,
    add_hole, cut_region, delete_region, delete_regions, duplicate_region, insert_vertex, move_edge,
    move_region, move_vertex, remove_hole, remove_vertex, retype_edge,
};

use crate::editing::SessionGraph;
use crate::mesh::{region_id_from_wire, region_id_to_wire};

fn parse_node_id(id: &str) -> Result<NodeId, String> {
    NodeId::new(id.to_owned()).map_err(|error| error.to_string())
}

fn parse_edge_id(id: &str) -> Result<ContourEdgeId, String> {
    ContourEdgeId::new(id.to_owned()).map_err(|error| error.to_string())
}

fn parse_region_id(id: &str) -> Result<RegionId, String> {
    RegionId::new(id.to_owned()).map_err(|error| error.to_string())
}

/// One edge walked in a loop, in that loop's own direction.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrientedEdgeUseDto {
    pub edge_id: String,
    pub reversed: bool,
}

impl OrientedEdgeUseDto {
    fn into_use(self) -> Result<OrientedEdgeUse, String> {
        let id = parse_edge_id(&self.edge_id)?;
        Ok(if self.reversed {
            OrientedEdgeUse::reversed(id)
        } else {
            OrientedEdgeUse::forward(id)
        })
    }
}

fn parse_loop(uses: Vec<OrientedEdgeUseDto>) -> Result<ContourLoop, String> {
    uses.into_iter().map(OrientedEdgeUseDto::into_use).collect()
}

/// An edge's explicit geometry, as the front end declares it. `"line"` is a
/// straight chord; `"arc"` is a true circular arc in the surface's own XZ
/// plane -- see `grafting_graph_core::contour`'s own spatial policy.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContourGeometryDto {
    Line,
    #[serde(rename_all = "camelCase")]
    Arc {
        /// The arc's center, in XZ.
        center: [f32; 2],
        clockwise: bool,
    },
}

impl ContourGeometryDto {
    fn into_geometry(self) -> ContourGeometry {
        match self {
            Self::Line => ContourGeometry::Line,
            Self::Arc { center, clockwise } => ContourGeometry::CircularArc { center, clockwise },
        }
    }

    fn from_geometry(geometry: &ContourGeometry) -> Self {
        match geometry {
            ContourGeometry::Line => Self::Line,
            ContourGeometry::CircularArc { center, clockwise } => Self::Arc {
                center: *center,
                clockwise: *clockwise,
            },
        }
    }
}

/// What one atomic edit changed, in wire terms. Every region identity is
/// reported as the `["@region", id]` key the rest of the session ABI
/// already speaks, so a caller re-fetches meshes through the very same
/// `surface_mesh_json` path it uses after a generation call.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionEditOutcomeDto {
    pub affected_surface_keys: Vec<Vec<String>>,
    pub created_surface_keys: Vec<Vec<String>>,
    pub removed_surface_keys: Vec<Vec<String>>,
    pub created_node_ids: Vec<String>,
    pub removed_node_ids: Vec<String>,
}

impl From<RegionEditOutcome> for RegionEditOutcomeDto {
    fn from(outcome: RegionEditOutcome) -> Self {
        Self {
            affected_surface_keys: outcome.affected_regions.iter().map(region_id_to_wire).collect(),
            created_surface_keys: outcome.created_regions.iter().map(region_id_to_wire).collect(),
            removed_surface_keys: outcome.removed_regions.iter().map(region_id_to_wire).collect(),
            created_node_ids: outcome
                .created_nodes
                .iter()
                .map(|id| id.as_str().to_owned())
                .collect(),
            removed_node_ids: outcome
                .removed_nodes
                .iter()
                .map(|id| id.as_str().to_owned())
                .collect(),
        }
    }
}

// ---- Vertex level ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveVertexRequest {
    pub node_id: String,
    pub position: [f32; 3],
}

/// `MoveVertex`. Unlike the retired `move_node`, affected surfaces are
/// resolved through the contour topology, so a region-backed surface --
/// which is now every surface -- actually reports.
pub fn apply_move_vertex(
    graph: &mut SessionGraph,
    topology: &ContourTopology,
    request: MoveVertexRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let id = parse_node_id(&request.node_id)?;
    let outcome = move_vertex(graph, topology, &id, |position| *position = request.position)
        .map_err(|error| error.to_string())?;
    Ok(outcome.into())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertVertexRequest {
    pub edge_id: String,
    pub node_id: String,
    pub position: [f32; 3],
    pub first_edge_id: String,
    pub second_edge_id: String,
}

/// `InsertVertex`. Called twice on the same original edge, this is also the
/// whole of the "carve a movable notch" case -- there is no separate cut
/// primitive at the vertex level.
pub fn apply_insert_vertex(
    graph: &mut SessionGraph,
    topology: &mut ContourTopology,
    request: InsertVertexRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let outcome = insert_vertex(
        graph,
        topology,
        &parse_edge_id(&request.edge_id)?,
        Node::new(parse_node_id(&request.node_id)?, request.position),
        parse_edge_id(&request.first_edge_id)?,
        parse_edge_id(&request.second_edge_id)?,
    )
    .map_err(|error| error.to_string())?;
    Ok(outcome.into())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveVertexRequest {
    pub node_id: String,
    pub welded_edge_id: String,
}

/// `RemoveVertex`: the inverse of [`apply_insert_vertex`].
pub fn apply_remove_vertex(
    graph: &mut SessionGraph,
    topology: &mut ContourTopology,
    surfaces: &SurfaceRegistry,
    request: RemoveVertexRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let outcome = remove_vertex(
        graph,
        topology,
        surfaces,
        &parse_node_id(&request.node_id)?,
        parse_edge_id(&request.welded_edge_id)?,
    )
    .map_err(|error| error.to_string())?;
    Ok(outcome.into())
}

// ---- Edge level ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetypeEdgeRequest {
    pub edge_id: String,
    pub geometry: ContourGeometryDto,
}

/// `RetypeEdge`: swap `Line` for `Arc`, or re-aim an arc, without touching
/// either endpoint.
pub fn apply_retype_edge(
    topology: &mut ContourTopology,
    request: RetypeEdgeRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let outcome = retype_edge(
        topology,
        &parse_edge_id(&request.edge_id)?,
        request.geometry.into_geometry(),
    )
    .map_err(|error| error.to_string())?;
    Ok(outcome.into())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveEdgeRequest {
    pub edge_id: String,
    /// Applied to both endpoints, so the segment moves as one rigid unit.
    pub delta: [f32; 3],
}

/// `MoveEdge`.
pub fn apply_move_edge(
    graph: &mut SessionGraph,
    topology: &ContourTopology,
    request: MoveEdgeRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let delta = request.delta;
    let outcome = move_edge(graph, topology, &parse_edge_id(&request.edge_id)?, |position| {
        for axis in 0..3 {
            position[axis] += delta[axis];
        }
    })
    .map_err(|error| error.to_string())?;
    Ok(outcome.into())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddContourEdgeRequest {
    pub edge_id: String,
    pub start_node_id: String,
    pub end_node_id: String,
    pub geometry: ContourGeometryDto,
}

/// Registers a bare boundary edge, used by nothing yet -- the staging step
/// a caller performs before [`apply_cut_region`] or [`apply_add_hole`], both
/// of which take already-registered edges.
pub fn add_contour_edge(
    graph: &SessionGraph,
    topology: &mut ContourTopology,
    request: AddContourEdgeRequest,
) -> Result<(), String> {
    topology
        .add_edge(
            graph,
            ContourEdge::new(
                parse_edge_id(&request.edge_id)?,
                parse_node_id(&request.start_node_id)?,
                parse_node_id(&request.end_node_id)?,
                request.geometry.into_geometry(),
            ),
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

// ---- Region level ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveRegionRequest {
    pub surface_key: Vec<String>,
    pub delta: [f32; 3],
}

/// `MoveRegion`.
pub fn apply_move_region(
    graph: &mut SessionGraph,
    topology: &ContourTopology,
    request: MoveRegionRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let region = region_id_from_wire(&request.surface_key)?;
    let delta = request.delta;
    let outcome = move_region(graph, topology, &region, |position| {
        for axis in 0..3 {
            position[axis] += delta[axis];
        }
    })
    .map_err(|error| error.to_string())?;
    Ok(outcome.into())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionRequest {
    pub surface_key: Vec<String>,
}

/// `DeleteRegion`, ending in the shared zero-orphan cleanup.
pub fn apply_delete_region(
    graph: &mut SessionGraph,
    topology: &mut ContourTopology,
    surfaces: &mut SurfaceRegistry,
    request: RegionRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let region = region_id_from_wire(&request.surface_key)?;
    let outcome = delete_region(graph, topology, surfaces, &region).map_err(|e| e.to_string())?;
    Ok(outcome.into())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRegionsRequest {
    pub surface_keys: Vec<Vec<String>>,
}

/// One rim edge, resolved in the loop's own walk direction so a caller can
/// stitch onto it without re-deriving orientation.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovalResponse {
    #[serde(flatten)]
    pub outcome: RegionEditOutcomeDto,
    /// Closed loops bounding the hole the removal opened -- exactly what
    /// must be stitched back onto so the result has neither a leftover hole
    /// nor an extra face. Empty when the removal opened no hole.
    pub exposed_loops: Vec<Vec<RegionEdgeDto>>,
}

/// Removes a whole set of regions in one transaction and reports the rim
/// left behind. See `grafting_graph_core::delete_regions` for why batching
/// is a correctness condition rather than an optimization.
pub fn apply_delete_regions(
    graph: &mut SessionGraph,
    topology: &mut ContourTopology,
    surfaces: &mut SurfaceRegistry,
    request: DeleteRegionsRequest,
) -> Result<RemovalResponse, String> {
    let regions = request
        .surface_keys
        .iter()
        .map(|key| region_id_from_wire(key))
        .collect::<Result<Vec<_>, _>>()?;
    let removal =
        delete_regions(graph, topology, surfaces, &regions).map_err(|error| error.to_string())?;
    let exposed_loops = removal
        .exposed_loops
        .iter()
        .map(|loop_| loop_dto(topology, loop_))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(RemovalResponse {
        outcome: removal.outcome.into(),
        exposed_loops,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateRegionRequest {
    pub surface_key: Vec<String>,
    /// Appended to every derived node, edge, and region id -- the same
    /// suffix always reproduces the same copy rather than minting a second.
    pub suffix: String,
    pub offset: [f32; 3],
    pub surface_type: String,
    pub physical: bool,
}

/// `DuplicateRegion`.
pub fn apply_duplicate_region(
    graph: &mut SessionGraph,
    topology: &mut ContourTopology,
    surfaces: &mut SurfaceRegistry,
    request: DuplicateRegionRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let region = region_id_from_wire(&request.surface_key)?;
    let offset = request.offset;
    let clone_payload = move |position: &[f32; 3]| {
        [
            position[0] + offset[0],
            position[1] + offset[1],
            position[2] + offset[2],
        ]
    };
    let outcome = duplicate_region(
        graph,
        topology,
        surfaces,
        &region,
        DuplicateRegionSpec {
            suffix: &request.suffix,
            clone_payload: &clone_payload,
            surface_type: SurfaceType::new(request.surface_type),
            physical: request.physical,
        },
    )
    .map_err(|error| error.to_string())?;
    Ok(outcome.into())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CutRegionRequest {
    pub surface_key: Vec<String>,
    /// Already-registered edges (see [`add_contour_edge`]) whose two ends
    /// both sit on the region's own outer loop.
    pub cut_path: Vec<OrientedEdgeUseDto>,
    pub first_region_id: String,
    pub second_region_id: String,
}

/// `CutRegion`: both halves keep the cut as their shared, manifold boundary.
pub fn apply_cut_region(
    topology: &mut ContourTopology,
    surfaces: &mut SurfaceRegistry,
    request: CutRegionRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let region = region_id_from_wire(&request.surface_key)?;
    let cut_path = parse_loop(request.cut_path)?;
    let outcome = cut_region(
        topology,
        surfaces,
        &region,
        &cut_path,
        parse_region_id(&request.first_region_id)?,
        parse_region_id(&request.second_region_id)?,
    )
    .map_err(|error| error.to_string())?;
    Ok(outcome.into())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddHoleRequest {
    pub surface_key: Vec<String>,
    pub hole: Vec<OrientedEdgeUseDto>,
}

/// `AddHole` -- what a door or a window is. Structurally nothing new: a hole
/// is a second real loop of registered edges, validated by the same closure
/// and manifold rules as any outer loop.
pub fn apply_add_hole(
    topology: &mut ContourTopology,
    request: AddHoleRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let region = region_id_from_wire(&request.surface_key)?;
    let hole = parse_loop(request.hole)?;
    let outcome = add_hole(topology, &region, hole).map_err(|error| error.to_string())?;
    Ok(outcome.into())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveHoleRequest {
    pub surface_key: Vec<String>,
    pub index: usize,
}

/// `RemoveHole`.
pub fn apply_remove_hole(
    graph: &mut SessionGraph,
    topology: &mut ContourTopology,
    surfaces: &SurfaceRegistry,
    request: RemoveHoleRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let region = region_id_from_wire(&request.surface_key)?;
    let outcome = remove_hole(graph, topology, surfaces, &region, request.index)
        .map_err(|error| error.to_string())?;
    Ok(outcome.into())
}

// ---- Topology query ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionEdgeDto {
    pub edge_id: String,
    pub reversed: bool,
    /// The edge's start node **as this loop walks it**, already resolved
    /// against `reversed` -- a caller never re-derives orientation.
    pub start_node_id: String,
    pub end_node_id: String,
    pub geometry: ContourGeometryDto,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionNodeDto {
    pub id: String,
    pub position: [f32; 3],
}

/// One region's live boundary, in the deterministic order this crate
/// guarantees -- the ordering the front end's own index-to-role mapping is
/// built against.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionTopologyDto {
    pub surface_key: Vec<String>,
    pub surface_type: String,
    pub physical: bool,
    pub outer_loops: Vec<Vec<RegionEdgeDto>>,
    pub holes: Vec<Vec<RegionEdgeDto>>,
    /// Every boundary node, first-encountered loop order, with its live
    /// position -- what a caller places handles from.
    pub nodes: Vec<RegionNodeDto>,
}

fn loop_dto(
    topology: &ContourTopology,
    loop_: &ContourLoop,
) -> Result<Vec<RegionEdgeDto>, String> {
    loop_
        .iter()
        .map(|use_| {
            let edge = topology
                .edge(use_.edge())
                .ok_or_else(|| format!("unknown contour edge {}", use_.edge()))?;
            let (start, end) = if use_.is_reversed() {
                (edge.end_node(), edge.start_node())
            } else {
                (edge.start_node(), edge.end_node())
            };
            Ok(RegionEdgeDto {
                edge_id: edge.id().as_str().to_owned(),
                reversed: use_.is_reversed(),
                start_node_id: start.as_str().to_owned(),
                end_node_id: end.as_str().to_owned(),
                geometry: ContourGeometryDto::from_geometry(edge.geometry()),
            })
        })
        .collect()
}

/// One region's boundary. `None` when the region is not registered -- a
/// transient/absent state a caller iterating stale keys hits normally, not
/// an error.
pub fn region_topology(
    graph: &SessionGraph,
    topology: &ContourTopology,
    surfaces: &SurfaceRegistry,
    region: &RegionId,
) -> Result<Option<RegionTopologyDto>, String> {
    let (Some(boundary), Some(surface)) = (topology.region(region), surfaces.region_surface(region))
    else {
        return Ok(None);
    };
    let mut outer_loops = Vec::with_capacity(boundary.outer_loops().len());
    for loop_ in boundary.outer_loops() {
        outer_loops.push(loop_dto(topology, loop_)?);
    }
    let mut holes = Vec::with_capacity(boundary.holes().len());
    for loop_ in boundary.holes() {
        holes.push(loop_dto(topology, loop_)?);
    }
    let nodes = topology
        .region_nodes(region)
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter_map(|id| {
            graph.node(&id).map(|node| RegionNodeDto {
                id: id.as_str().to_owned(),
                position: *node.data(),
            })
        })
        .collect();
    Ok(Some(RegionTopologyDto {
        surface_key: region_id_to_wire(region),
        surface_type: surface.surface_type().as_str().to_owned(),
        physical: surface.physical(),
        outer_loops,
        holes,
        nodes,
    }))
}

/// Every registered region's boundary, in stable id order -- the bootstrap
/// call an edit-mode caller makes once, mirroring `all_surface_meshes`.
pub fn all_region_topologies(
    graph: &SessionGraph,
    topology: &ContourTopology,
    surfaces: &SurfaceRegistry,
) -> Result<Vec<RegionTopologyDto>, String> {
    let mut result = Vec::new();
    for id in topology.region_ids() {
        if let Some(dto) = region_topology(graph, topology, surfaces, &id)? {
            result.push(dto);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::{Graph, straight_cycle_region};

    fn quad() -> (SessionGraph, ContourTopology, SurfaceRegistry, RegionId) {
        let graph: SessionGraph = Graph::try_from_parts(
            vec![
                Node::new(NodeId::new("a").unwrap(), [0.0, 0.0, 0.0]),
                Node::new(NodeId::new("b").unwrap(), [1.0, 0.0, 0.0]),
                Node::new(NodeId::new("c").unwrap(), [1.0, 0.0, 1.0]),
                Node::new(NodeId::new("d").unwrap(), [0.0, 0.0, 1.0]),
            ],
            Vec::new(),
        )
        .unwrap();
        let mut topology = ContourTopology::new();
        let region = straight_cycle_region(
            &mut topology,
            &graph,
            RegionId::new("quad").unwrap(),
            &[
                NodeId::new("a").unwrap(),
                NodeId::new("b").unwrap(),
                NodeId::new("c").unwrap(),
                NodeId::new("d").unwrap(),
            ],
        )
        .unwrap();
        let mut surfaces = SurfaceRegistry::new();
        surfaces
            .add_region_surface(&topology, region.clone(), SurfaceType::new("wall"), true)
            .unwrap();
        (graph, topology, surfaces, region)
    }

    #[test]
    fn move_vertex_reports_the_region_as_a_region_wire_key() {
        let (mut graph, topology, _surfaces, _region) = quad();
        let response = apply_move_vertex(
            &mut graph,
            &topology,
            MoveVertexRequest {
                node_id: "a".into(),
                position: [0.0, 5.0, 0.0],
            },
        )
        .unwrap();
        assert_eq!(
            response.affected_surface_keys,
            vec![vec!["@region".to_string(), "quad".to_string()]]
        );
        assert_eq!(
            *graph.node(&NodeId::new("a").unwrap()).unwrap().data(),
            [0.0, 5.0, 0.0]
        );
    }

    #[test]
    fn insert_then_remove_vertex_round_trips_through_the_wire_shape() {
        let (mut graph, mut topology, surfaces, region) = quad();
        apply_insert_vertex(
            &mut graph,
            &mut topology,
            InsertVertexRequest {
                edge_id: "quad-0".into(),
                node_id: "mid".into(),
                position: [0.5, 0.0, 0.0],
                first_edge_id: "mid-a".into(),
                second_edge_id: "mid-b".into(),
            },
        )
        .unwrap();
        assert_eq!(topology.region(&region).unwrap().outer_loops()[0].len(), 5);

        let response = apply_remove_vertex(
            &mut graph,
            &mut topology,
            &surfaces,
            RemoveVertexRequest {
                node_id: "mid".into(),
                welded_edge_id: "welded".into(),
            },
        )
        .unwrap();
        assert_eq!(response.removed_node_ids, vec!["mid".to_string()]);
        assert_eq!(topology.region(&region).unwrap().outer_loops()[0].len(), 4);
    }

    #[test]
    fn retype_edge_accepts_an_arc_from_the_wire() {
        let (_graph, mut topology, _surfaces, _region) = quad();
        apply_retype_edge(
            &mut topology,
            RetypeEdgeRequest {
                edge_id: "quad-0".into(),
                geometry: ContourGeometryDto::Arc {
                    center: [0.5, -0.5],
                    clockwise: true,
                },
            },
        )
        .unwrap();
        assert_eq!(
            topology
                .edge(&ContourEdgeId::new("quad-0").unwrap())
                .unwrap()
                .geometry(),
            &ContourGeometry::CircularArc {
                center: [0.5, -0.5],
                clockwise: true
            }
        );
    }

    #[test]
    fn region_topology_resolves_each_loop_walk_direction_for_the_caller() {
        let (graph, topology, surfaces, region) = quad();
        let dto = region_topology(&graph, &topology, &surfaces, &region)
            .unwrap()
            .unwrap();
        assert_eq!(dto.surface_type, "wall");
        assert_eq!(dto.outer_loops.len(), 1);
        assert_eq!(dto.outer_loops[0].len(), 4);
        assert_eq!(dto.outer_loops[0][0].start_node_id, "a");
        assert_eq!(dto.outer_loops[0][0].end_node_id, "b");
        assert_eq!(
            dto.nodes.iter().map(|node| node.id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b", "c", "d"],
            "boundary order is stable -- what the front end's index-to-role map relies on"
        );
    }

    #[test]
    fn region_topology_is_absent_rather_than_an_error_for_a_stale_key() {
        let (graph, topology, surfaces, _region) = quad();
        let dto = region_topology(
            &graph,
            &topology,
            &surfaces,
            &RegionId::new("gone").unwrap(),
        )
        .unwrap();
        assert!(dto.is_none());
    }

    #[test]
    fn delete_region_reports_every_reclaimed_node() {
        let (mut graph, mut topology, mut surfaces, _region) = quad();
        let response = apply_delete_region(
            &mut graph,
            &mut topology,
            &mut surfaces,
            RegionRequest {
                surface_key: vec!["@region".into(), "quad".into()],
            },
        )
        .unwrap();
        assert_eq!(response.removed_node_ids, vec!["a", "b", "c", "d"]);
        assert_eq!(
            response.removed_surface_keys,
            vec![vec!["@region".to_string(), "quad".to_string()]]
        );
        assert_eq!(graph.node_count(), 0);
    }
}
