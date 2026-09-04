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
    add_hole, delete_region, duplicate_region, insert_vertex, move_edge, move_region, move_vertex,
    remove_hole, remove_vertex, retype_edge,
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
            affected_surface_keys: outcome
                .affected_regions
                .iter()
                .map(region_id_to_wire)
                .collect(),
            created_surface_keys: outcome
                .created_regions
                .iter()
                .map(region_id_to_wire)
                .collect(),
            removed_surface_keys: outcome
                .removed_regions
                .iter()
                .map(region_id_to_wire)
                .collect(),
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
    let outcome = move_vertex(graph, topology, &id, |position| {
        *position = request.position
    })
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
    request: RemoveVertexRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let outcome = remove_vertex(
        graph,
        topology,
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
    let outcome = move_edge(
        graph,
        topology,
        &parse_edge_id(&request.edge_id)?,
        |position| {
            for axis in 0..3 {
                position[axis] += delta[axis];
            }
        },
    )
    .map_err(|error| error.to_string())?;
    Ok(outcome.into())
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

fn loop_dto(topology: &ContourTopology, loop_: &ContourLoop) -> Result<Vec<RegionEdgeDto>, String> {
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
    let (Some(boundary), Some(surface)) =
        (topology.region(region), surfaces.region_surface(region))
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
        let (mut graph, mut topology, _surfaces, region) = quad();
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
            dto.nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
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

    /// The whole of what an opening is: the wall keeps one face and gains an
    /// inner loop, and a second face takes that very loop as its own
    /// boundary. The rim is shared -- used once by the wall as a hole, once
    /// by the filling face, walked the other way -- so the two are joined
    /// exactly the way any two faces are, and moving a rim node moves both.
    ///
    /// Declared in one transaction on purpose: half of it is a wall with an
    /// opening nobody stands in.
    #[test]
    fn a_face_may_be_opened_and_the_opening_filled_in_one_patch() {
        let mut graph: SessionGraph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();

        let panel = ["p0", "p1", "p2", "p3"];
        let rim = ["h0", "h1", "h2", "h3"];
        let positions = [
            ("p0", [0.0, 0.0, 0.0]),
            ("p1", [4.0, 0.0, 0.0]),
            ("p2", [4.0, 3.0, 0.0]),
            ("p3", [0.0, 3.0, 0.0]),
            ("h0", [1.0, 1.0, 0.0]),
            ("h1", [3.0, 1.0, 0.0]),
            ("h2", [3.0, 2.0, 0.0]),
            ("h3", [1.0, 2.0, 0.0]),
        ];
        let ring = |names: [&str; 4], prefix: &str| {
            (0..4)
                .map(|index| PatchEdgeDto {
                    edge_id: format!("{prefix}-{index}"),
                    start_node_id: names[index].to_owned(),
                    end_node_id: names[(index + 1) % 4].to_owned(),
                    geometry: None,
                })
                .collect::<Vec<_>>()
        };
        // Walking a ring the other way is not just flipping each use: the
        // order reverses too, or the loop stops being closed.
        let uses = |prefix: &str, reversed: bool| {
            let mut walk = (0..4)
                .map(|index| OrientedEdgeUseDto {
                    edge_id: format!("{prefix}-{index}"),
                    reversed,
                })
                .collect::<Vec<_>>();
            if reversed {
                walk.reverse();
            }
            walk
        };

        let response = apply_add_patch(
            &mut graph,
            &mut topology,
            &mut surfaces,
            AddPatchRequest {
                nodes: positions
                    .iter()
                    .map(|(id, position)| PatchNodeDto {
                        id: (*id).to_owned(),
                        position: *position,
                    })
                    .collect(),
                edges: ring(panel, "panel")
                    .into_iter()
                    .chain(ring(rim, "rim"))
                    .collect(),
                regions: vec![
                    PatchRegionDto {
                        region_id: "wall".into(),
                        boundary: uses("panel", false),
                        holes: vec![uses("rim", false)],
                        surface_type: "wall-white".into(),
                        physical: true,
                    },
                    PatchRegionDto {
                        region_id: "window".into(),
                        // The other way round the very same rim: the free
                        // side the hole left is the side this face takes.
                        boundary: uses("rim", true),
                        holes: Vec::new(),
                        surface_type: "window".into(),
                        physical: false,
                    },
                ],
            },
        )
        .unwrap();

        assert!(
            response.skipped_region_ids.is_empty(),
            "neither face was refused: {:?}",
            response.skipped_region_ids
        );

        let wall = topology.region(&RegionId::new("wall").unwrap()).unwrap();
        assert_eq!(
            wall.outer_loops().len(),
            1,
            "a wall with a window is still one wall"
        );
        assert_eq!(wall.holes().len(), 1);

        let window = topology.region(&RegionId::new("window").unwrap()).unwrap();
        assert_eq!(window.outer_loops().len(), 1);
        assert!(window.holes().is_empty());

        for index in 0..4 {
            let edge = ContourEdgeId::new(format!("rim-{index}")).unwrap();
            assert_eq!(
                topology.usage_count(&edge),
                2,
                "the rim bounds the wall on one side and the window on the other"
            );
        }
        assert_eq!(
            surfaces
                .region_surface(&RegionId::new("window").unwrap())
                .unwrap()
                .surface_type()
                .as_str(),
            "window",
            "the opening is a face with its own type, not a marker on the wall"
        );
    }

    /// A malformed region -- boundary edges submitted out of walk order, so
    /// no consecutive pair actually connects -- costs only itself. Earlier
    /// versions of `apply_add_patch` propagated `add_region`'s own error via
    /// `?`, aborting the whole call the moment one region turned out
    /// malformed; anything processed earlier in the same batch had already
    /// mutated `topology` by then and was never rolled back, so a caller
    /// reading the thrown error as "nothing landed" was wrong. `add_region`
    /// itself fully validates before it mutates anything (its own doc), so
    /// treating its failure as a skip -- exactly like "no room" -- is safe:
    /// nothing about this region's own failure touches what came before it.
    #[test]
    fn a_region_whose_boundary_does_not_close_is_skipped_not_fatal_to_an_earlier_region_in_the_same_batch() {
        let mut graph: SessionGraph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();

        let nodes = [
            ("a", [0.0, 0.0, 0.0]),
            ("b", [1.0, 0.0, 0.0]),
            ("c", [1.0, 1.0, 0.0]),
            ("d", [0.0, 1.0, 0.0]),
            ("w", [10.0, 0.0, 0.0]),
            ("x", [11.0, 0.0, 0.0]),
            ("y", [11.0, 1.0, 0.0]),
            ("z", [10.0, 1.0, 0.0]),
        ];
        let ring = |names: [&str; 4], prefix: &str| {
            (0..4)
                .map(|index| PatchEdgeDto {
                    edge_id: format!("{prefix}-{index}"),
                    start_node_id: names[index].to_owned(),
                    end_node_id: names[(index + 1) % 4].to_owned(),
                    geometry: None,
                })
                .collect::<Vec<_>>()
        };
        let closed_boundary = |prefix: &str| {
            (0..4)
                .map(|index| OrientedEdgeUseDto {
                    edge_id: format!("{prefix}-{index}"),
                    reversed: false,
                })
                .collect::<Vec<_>>()
        };
        // The same four real edges a genuinely closed "bad" quad would use,
        // submitted out of walk order: edge[0] ("bad-0", w->x) ends at x, but
        // edge[1] here is "bad-2" (y->z), which starts at y -- exactly the
        // "expected next edge to start at X, found Y" mismatch a wrongly
        // paired real-to-real weld produces.
        let broken_boundary = vec![
            OrientedEdgeUseDto { edge_id: "bad-0".into(), reversed: false },
            OrientedEdgeUseDto { edge_id: "bad-2".into(), reversed: false },
            OrientedEdgeUseDto { edge_id: "bad-1".into(), reversed: false },
            OrientedEdgeUseDto { edge_id: "bad-3".into(), reversed: false },
        ];

        let response = apply_add_patch(
            &mut graph,
            &mut topology,
            &mut surfaces,
            AddPatchRequest {
                nodes: nodes
                    .iter()
                    .map(|(id, position)| PatchNodeDto {
                        id: (*id).to_owned(),
                        position: *position,
                    })
                    .collect(),
                edges: ring(["a", "b", "c", "d"], "good")
                    .into_iter()
                    .chain(ring(["w", "x", "y", "z"], "bad"))
                    .collect(),
                regions: vec![
                    PatchRegionDto {
                        region_id: "good".into(),
                        boundary: closed_boundary("good"),
                        holes: Vec::new(),
                        surface_type: "terrain".into(),
                        physical: true,
                    },
                    PatchRegionDto {
                        region_id: "bad".into(),
                        boundary: broken_boundary,
                        holes: Vec::new(),
                        surface_type: "terrain".into(),
                        physical: true,
                    },
                ],
            },
        )
        .expect("a malformed region must not abort the whole submission");

        assert_eq!(
            response.skipped_region_ids,
            vec!["bad".to_string()],
            "the malformed region is skipped, not fatal"
        );
        assert!(
            topology.region(&RegionId::new("good").unwrap()).is_some(),
            "an earlier, valid region in the same batch still lands"
        );
        assert!(topology.region(&RegionId::new("bad").unwrap()).is_none());
    }

    /// A face can carry more than one opening, and closing one leaves the
    /// others standing.
    #[test]
    fn a_face_may_carry_several_openings_and_close_them_one_at_a_time() {
        let mut graph: SessionGraph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();

        let mut nodes = vec![
            PatchNodeDto {
                id: "p0".into(),
                position: [0.0, 0.0, 0.0],
            },
            PatchNodeDto {
                id: "p1".into(),
                position: [6.0, 0.0, 0.0],
            },
            PatchNodeDto {
                id: "p2".into(),
                position: [6.0, 3.0, 0.0],
            },
            PatchNodeDto {
                id: "p3".into(),
                position: [0.0, 3.0, 0.0],
            },
        ];
        let mut edges = (0..4)
            .map(|index| PatchEdgeDto {
                edge_id: format!("panel-{index}"),
                start_node_id: format!("p{index}"),
                end_node_id: format!("p{}", (index + 1) % 4),
                geometry: None,
            })
            .collect::<Vec<_>>();
        let mut holes = Vec::new();
        for (opening, left) in [("a", 1.0_f32), ("b", 4.0_f32)] {
            let corners = [
                (format!("{opening}0"), [left, 1.0, 0.0]),
                (format!("{opening}1"), [left + 1.0, 1.0, 0.0]),
                (format!("{opening}2"), [left + 1.0, 2.0, 0.0]),
                (format!("{opening}3"), [left, 2.0, 0.0]),
            ];
            for (id, position) in &corners {
                nodes.push(PatchNodeDto {
                    id: id.clone(),
                    position: *position,
                });
            }
            for index in 0..4 {
                edges.push(PatchEdgeDto {
                    edge_id: format!("{opening}-{index}"),
                    start_node_id: corners[index].0.clone(),
                    end_node_id: corners[(index + 1) % 4].0.clone(),
                    geometry: None,
                });
            }
            holes.push(
                (0..4)
                    .map(|index| OrientedEdgeUseDto {
                        edge_id: format!("{opening}-{index}"),
                        reversed: false,
                    })
                    .collect::<Vec<_>>(),
            );
        }

        apply_add_patch(
            &mut graph,
            &mut topology,
            &mut surfaces,
            AddPatchRequest {
                nodes,
                edges,
                regions: vec![PatchRegionDto {
                    region_id: "wall".into(),
                    boundary: (0..4)
                        .map(|index| OrientedEdgeUseDto {
                            edge_id: format!("panel-{index}"),
                            reversed: false,
                        })
                        .collect(),
                    holes,
                    surface_type: "wall-white".into(),
                    physical: true,
                }],
            },
        )
        .unwrap();

        let wall = RegionId::new("wall").unwrap();
        assert_eq!(topology.region(&wall).unwrap().holes().len(), 2);

        apply_remove_hole(
            &mut graph,
            &mut topology,
            RemoveHoleRequest {
                surface_key: vec!["@region".into(), "wall".into()],
                index: 0,
            },
        )
        .unwrap();

        assert_eq!(
            topology.region(&wall).unwrap().holes().len(),
            1,
            "closing one opening leaves the other standing"
        );
    }

    /// A patch is the only way a generator names a **shared** edge, so an
    /// arc that two faces meet along has to be declarable here -- otherwise
    /// curvature is only reachable through a path that mints an unshared
    /// edge per face. An edge with no declared geometry stays a straight
    /// chord, which is what every flat-ground patch relies on.
    #[test]
    fn a_patch_edge_carries_its_own_declared_geometry() {
        let mut graph: SessionGraph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();

        apply_add_patch(
            &mut graph,
            &mut topology,
            &mut surfaces,
            AddPatchRequest {
                nodes: vec![
                    PatchNodeDto {
                        id: "east".into(),
                        position: [2.0, 0.0, 0.0],
                    },
                    PatchNodeDto {
                        id: "west".into(),
                        position: [-2.0, 0.0, 0.0],
                    },
                ],
                edges: vec![
                    PatchEdgeDto {
                        edge_id: "curved".into(),
                        start_node_id: "east".into(),
                        end_node_id: "west".into(),
                        geometry: Some(ContourGeometryDto::Arc {
                            center: [0.0, 0.0],
                            clockwise: false,
                        }),
                    },
                    PatchEdgeDto {
                        edge_id: "straight".into(),
                        start_node_id: "west".into(),
                        end_node_id: "east".into(),
                        geometry: None,
                    },
                ],
                regions: Vec::new(),
            },
        )
        .unwrap();

        let curved = topology
            .edge(&ContourEdgeId::new("curved").unwrap())
            .unwrap();
        assert_eq!(
            *curved.geometry(),
            ContourGeometry::CircularArc {
                center: [0.0, 0.0],
                clockwise: false,
            }
        );
        let straight = topology
            .edge(&ContourEdgeId::new("straight").unwrap())
            .unwrap();
        assert_eq!(*straight.geometry(), ContourGeometry::Line);
    }
}

// ---- Holes ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddHoleRequest {
    pub surface_key: Vec<String>,
    pub hole: Vec<OrientedEdgeUseDto>,
}

/// `AddHole` -- what a door or a window is an opening for. Structurally
/// nothing new: a hole is a second real loop of registered edges, validated
/// by the same closure and manifold rules as any outer loop, and it leaves
/// one use free on each of them so a face can take the opening as its own
/// boundary.
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

/// `RemoveHole`: closes one opening back up.
pub fn apply_remove_hole(
    graph: &mut SessionGraph,
    topology: &mut ContourTopology,
    request: RemoveHoleRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let region = region_id_from_wire(&request.surface_key)?;
    let outcome =
        remove_hole(graph, topology, &region, request.index).map_err(|error| error.to_string())?;
    Ok(outcome.into())
}

// ---- Batched patch registration (shared edges) ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchNodeDto {
    pub id: String,
    pub position: [f32; 3],
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchEdgeDto {
    pub edge_id: String,
    pub start_node_id: String,
    pub end_node_id: String,
    /// This edge's own geometry between those two nodes. Absent means a
    /// straight chord, which is what every flat-ground patch declares and
    /// why this stays optional -- but a patch is the only way a generator
    /// names a **shared** edge, so an arc that two faces meet along has no
    /// other way to reach the graph curved. Hardcoding `Line` here is what
    /// used to force curved geometry down a separate, unshared path.
    #[serde(default)]
    pub geometry: Option<ContourGeometryDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchRegionDto {
    pub region_id: String,
    pub boundary: Vec<OrientedEdgeUseDto>,
    /// Inner loops this face is opened by -- see
    /// [`apply_add_hole`]. Absent means a solid face, which is what almost
    /// every patch declares. A generator that opens a face and fills the
    /// opening in the same breath needs both in one transaction, or the
    /// half-built state is briefly a face with a hole nobody stands in.
    #[serde(default)]
    pub holes: Vec<Vec<OrientedEdgeUseDto>>,
    pub surface_type: String,
    pub physical: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPatchRequest {
    pub nodes: Vec<PatchNodeDto>,
    pub edges: Vec<PatchEdgeDto>,
    pub regions: Vec<PatchRegionDto>,
}

/// What [`apply_add_patch`] registered, and what it refused.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPatchResponse {
    pub outcome: RegionEditOutcomeDto,
    /// Faces left unregistered because their boundary had no room -- the
    /// ground under them already has a face. Reported rather than thrown:
    /// refusing the whole stroke over one such face is what used to make
    /// painting near existing terrain do nothing at all.
    pub skipped_region_ids: Vec<String>,
    /// Why each of `skipped_region_ids` was refused, in the same order and
    /// naming the edge that decided it.
    ///
    /// A refusal is not one thing: a boundary can be turned away because an
    /// edge it wants is already interior, because the one free side of an
    /// edge faces the other way (the caller wound its loop against a
    /// neighbour it meant to meet), or because the loop is malformed and
    /// never closes. Those want opposite fixes, and a bare list of ids
    /// cannot tell them apart -- a caller reading one was left to guess,
    /// which is exactly how a repair that regenerated correct geometry could
    /// be refused wholesale with nothing to say why.
    pub skipped_region_reasons: Vec<String>,
}

/// Registers a whole generated patch -- nodes, **shared** boundary edges,
/// and the regions over them -- in one transaction.
///
/// This is what `add_surface` per face cannot do, and the difference is not
/// about batching. `add_surface` derives a region from a node cycle and
/// mints an edge per cycle step, named after that region; two faces sitting
/// side by side therefore end up with two *different* edges along the line
/// they visually share. Nothing structurally connects them, the manifold
/// rule never objects because each edge is used exactly once, and the
/// surface has no free/shared distinction left to reason about -- which is
/// why a hole in it cannot be found by looking at the topology.
///
/// Here the caller names each edge itself, so the two faces on either side
/// of a line reference the *same* edge and it ends up used twice. That is
/// what makes the patch a mesh: a boundary is shared where two faces meet
/// and free where none does, and that distinction is exactly what
/// [`crate::enclosure::unfilled_loops`] reads.
///
/// Already-present nodes, edges, and regions are skipped rather than
/// rejected: a stroke overlapping an earlier one legitimately re-declares
/// the geometry they have in common, and re-declaring it must not mint a
/// second copy.
pub fn apply_add_patch(
    graph: &mut SessionGraph,
    topology: &mut ContourTopology,
    surfaces: &mut SurfaceRegistry,
    request: AddPatchRequest,
) -> Result<AddPatchResponse, String> {
    let mut created_node_ids = Vec::new();
    for node in request.nodes {
        let id = parse_node_id(&node.id)?;
        if graph.node(&id).is_some() {
            continue;
        }
        graph
            .add_node(Node::new(id.clone(), node.position))
            .map_err(|error| error.to_string())?;
        created_node_ids.push(id.as_str().to_owned());
    }

    let mut minted: Vec<ContourEdgeId> = Vec::new();
    for edge in request.edges {
        let id = parse_edge_id(&edge.edge_id)?;
        if topology.edge(&id).is_some() {
            continue;
        }
        let start = parse_node_id(&edge.start_node_id)?;
        let end = parse_node_id(&edge.end_node_id)?;
        let geometry = edge
            .geometry
            .map_or(ContourGeometry::Line, ContourGeometryDto::into_geometry);
        topology
            .add_edge(graph, ContourEdge::new(id.clone(), start, end, geometry))
            .map_err(|error| error.to_string())?;
        minted.push(id);
    }

    let mut created_surface_keys = Vec::new();
    let mut skipped_region_ids = Vec::new();
    let mut skipped_region_reasons = Vec::new();
    let mut orphaned: Vec<ContourEdgeId> = Vec::new();
    for region in request.regions {
        let id = parse_region_id(&region.region_id)?;
        if topology.region(&id).is_some() {
            continue;
        }
        let boundary = parse_loop(region.boundary)?;
        let holes = region
            .holes
            .into_iter()
            .map(parse_loop)
            .collect::<Result<Vec<_>, _>>()?;
        // Collected before `boundary`/`holes` are moved into `add_region`
        // below -- needed either way, whether this region lands or is
        // skipped for either reason.
        let region_edges: Vec<ContourEdgeId> = boundary
            .iter()
            .chain(holes.iter().flatten())
            .map(|use_| use_.edge().clone())
            .collect();
        // Every loop the face declares has to fit, inner ones included: an
        // opening consumes a use on its rim exactly the way an outer
        // boundary does.
        let no_room = boundary_refusal(topology, &boundary)
            .or_else(|| holes.iter().find_map(|hole| boundary_refusal(topology, hole)));
        // A malformed loop (`add_region`'s own `validate_loop`, e.g. a caller
        // whose declared boundary does not actually close) is *also* just
        // this one region's problem, never the rest of the batch's --
        // `add_region` fully validates into a local buffer before it mutates
        // anything (`ContourTopology::add_region`'s own doc), so a failed
        // call here leaves `topology` exactly as it was, safe to skip
        // exactly like "no room." Propagating it instead (an earlier version
        // of this call did, via `?`) aborted the *whole* submission the
        // moment one region turned out malformed -- leaving every region
        // processed earlier in this same loop already committed, since nothing
        // here ever wrapped the loop itself in a transaction. A caller
        // reading that as "nothing landed" (this file's own `addPatch`
        // contract) was then wrong, and the next call built on graph state
        // this one had already partially, silently mutated.
        let refusal = match no_room {
            Some(reason) => Some(reason),
            None => topology
                .add_region(id.clone(), vec![boundary], holes)
                .err()
                .map(|error| format!("malformed loop: {error}")),
        };
        if let Some(reason) = refusal {
            skipped_region_ids.push(id.as_str().to_owned());
            skipped_region_reasons.push(format!("{}: {reason}", id.as_str()));
            orphaned.extend(region_edges);
            continue;
        }
        surfaces
            .add_region_surface(
                topology,
                id.clone(),
                SurfaceType::new(region.surface_type),
                region.physical,
            )
            .map_err(|error| error.to_string())?;
        created_surface_keys.push(region_id_to_wire(&id));
    }

    // An edge minted for a face that then had to be skipped can be left
    // referenced by nothing. Dropping those keeps a refused face from
    // leaving debris that would later read as free boundary. Only edges a
    // *skipped* face named are considered: a call that stages edges with no
    // regions of its own is doing that on purpose.
    for id in orphaned {
        if minted.contains(&id) && topology.usage_count(&id) == 0 {
            let _ = topology.remove_edge(&id);
        }
    }

    Ok(AddPatchResponse {
        outcome: RegionEditOutcomeDto {
            created_surface_keys,
            created_node_ids,
            ..RegionEditOutcomeDto::default()
        },
        skipped_region_ids,
        skipped_region_reasons,
    })
}

/// Why `boundary` cannot take one more use in the direction it walks --
/// `None` when it can, so a face may be registered on it.
///
/// An edge already used twice is interior -- it has a face on both sides --
/// and an edge used once in the same direction this loop wants is one whose
/// only free side faces the other way. Either way the face being registered
/// would sit on top of geometry that is already there, which is exactly the
/// "terrain is never created above anything" rule arriving at the level
/// where it is precise. Checked against the live topology, so faces earlier
/// in this same batch count.
fn boundary_refusal(topology: &ContourTopology, boundary: &ContourLoop) -> Option<String> {
    for use_ in boundary.iter() {
        let count = topology.usage_count(use_.edge());
        let edge = use_.edge().as_str();
        match count {
            0 => continue,
            1 => {
                if topology.sole_usage_reversed(use_.edge()) != Some(use_.is_reversed()) {
                    continue;
                }
                return Some(format!(
                    "no room on edge {edge} -- its one free side faces the other way; this loop walks it reversed={}, and so does the face already on it",
                    use_.is_reversed()
                ));
            }
            _ => {
                return Some(format!(
                    "no room on edge {edge} -- already used {count} times, so it is interior ground"
                ))
            }
        }
    }
    None
}
