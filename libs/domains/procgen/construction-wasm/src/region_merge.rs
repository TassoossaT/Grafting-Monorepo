//! Generic "overlay one new region onto the graph, destroying whatever it
//! covers" apply step -- the mutating half of a region-merge operation.
//! `grafting_procgen_surface_transformations::plan_region_merge` builds the
//! plan without touching the graph; this module applies it.
//!
//! No product concept lives here: what type the new region gets, what type
//! its leftover remainder keeps, and how tall each of its own new nodes
//! stand are all caller-supplied. A path-brush stroke, a future wall
//! opening, or anything else that overlays one new closed shape onto the
//! current graph and destroys whatever it covers can reuse this unchanged.

use std::collections::HashSet;

use grafting_graph_core::{
    ContourEdge, ContourEdgeId, ContourGeometry, ContourTopology, Edge, EdgeId, Node, NodeId,
    OrientedEdgeUse, RegionId, SurfaceKey, SurfaceRegistry, SurfaceType,
};
use grafting_procgen_surface_transformations::RegionMergePlan;

use crate::editing::SessionGraph;

/// One region-merge outcome, in Rust-native form -- generic across who
/// created it; each caller (e.g. `path_brush.rs`) translates this into its
/// own wire-ready response shape.
pub struct RegionMergeOutcome {
    /// Every node minted for the new region's own contour.
    pub created_node_ids: Vec<NodeId>,
    /// Every generic graph edge minted for the new region's own contour.
    pub created_edge_ids: Vec<EdgeId>,
    /// The leftover remainder region, if anything was actually consumed.
    pub remainder_region: Option<RegionId>,
    /// The new region this merge created.
    pub new_region: RegionId,
    /// Every existing surface this merge consumed.
    pub consumed_surface_keys: Vec<SurfaceKey>,
}

/// Applies `plan` (see `RegionMergePlan`'s own doc): destroys every surface
/// `plan` consumed, rebuilds their leftover exterior boundary as one
/// remainder region carrying the new contour as its own hole (only if
/// anything was actually consumed -- a merge with nothing underneath simply
/// creates the new region on its own), and creates the new region itself.
///
/// `operation_id` only seeds stable, deterministic ids for the nodes/edges
/// this mints. `new_region_type` is the type assigned to the new region.
/// `height_for` computes each new node's own Y from its XZ position --
/// callers vary widely here (a path brush measures down from nearby
/// terrain; a flat cap might just return a fixed height), so this step has
/// no opinion of its own about height.
pub fn apply_region_merge(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    topology: &mut ContourTopology,
    known_surfaces: &mut HashSet<SurfaceKey>,
    known_regions: &mut HashSet<RegionId>,
    operation_id: &str,
    new_region_type: SurfaceType,
    height_for: impl Fn(&SessionGraph, [f32; 2]) -> f32,
    plan: RegionMergePlan,
) -> Result<RegionMergeOutcome, String> {
    let has_remainder = !plan.consumed_surface_keys().is_empty();
    let new_region = RegionId::new(format!("region-merge-{operation_id}-new"))
        .map_err(|error| error.to_string())?;
    let remainder_region_and_type = if has_remainder {
        let remainder_region = RegionId::new(format!("region-merge-{operation_id}-remainder"))
            .map_err(|error| error.to_string())?;
        let remainder_type = plan
            .consumed_surface_keys()
            .first()
            .and_then(|key| surfaces.surface(key))
            .ok_or("region merge has no consumed surface")?
            .surface_type()
            .clone();
        Some((remainder_region, remainder_type))
    } else {
        None
    };

    let mut remainder_loops = Vec::new();
    for (loop_index, boundary) in plan.consumed_boundaries().iter().enumerate() {
        let mut loop_ = Vec::new();
        for (edge_index, (start, end)) in boundary
            .iter()
            .cloned()
            .zip(boundary.iter().cloned().cycle().skip(1))
            .take(boundary.len())
            .enumerate()
        {
            let id = ContourEdgeId::new(format!(
                "region-merge-{operation_id}-remainder-contour-{loop_index}-{edge_index}"
            ))
            .map_err(|error| error.to_string())?;
            topology
                .add_edge(
                    graph,
                    ContourEdge::new(id.clone(), start, end, ContourGeometry::Line),
                )
                .map_err(|error| error.to_string())?;
            loop_.push(OrientedEdgeUse::forward(id));
        }
        remainder_loops.push(loop_);
    }

    let contour = plan.contour();
    let mut new_nodes = Vec::new();
    let mut created_node_ids = Vec::new();
    for (index, point) in contour.vertices().iter().enumerate() {
        let id = NodeId::new(format!("region-merge-{operation_id}-node-{index}"))
            .map_err(|error| error.to_string())?;
        let y = height_for(graph, *point);
        graph
            .add_node(Node::new(id.clone(), [point[0], y, point[1]]))
            .map_err(|error| error.to_string())?;
        created_node_ids.push(id.clone());
        new_nodes.push(id);
    }
    let mut new_loop = Vec::new();
    let mut created_edge_ids = Vec::new();
    for (index, geometry) in contour.edge_geometries().iter().copied().enumerate() {
        let start = new_nodes[index].clone();
        let end = new_nodes[(index + 1) % new_nodes.len()].clone();
        let generic_id = EdgeId::new(format!("region-merge-{operation_id}-edge-{index}"))
            .map_err(|error| error.to_string())?;
        graph
            .add_edge(Edge::new(generic_id.clone(), start.clone(), end.clone(), ()))
            .map_err(|error| error.to_string())?;
        created_edge_ids.push(generic_id);
        let contour_id =
            ContourEdgeId::new(format!("region-merge-{operation_id}-new-contour-{index}"))
                .map_err(|error| error.to_string())?;
        topology
            .add_edge(
                graph,
                ContourEdge::new(contour_id.clone(), start, end, geometry),
            )
            .map_err(|error| error.to_string())?;
        new_loop.push(OrientedEdgeUse::forward(contour_id));
    }

    let remainder_region = if let Some((remainder_region, remainder_type)) = remainder_region_and_type {
        let hole = new_loop
            .iter()
            .rev()
            .map(|use_| OrientedEdgeUse::reversed(use_.edge().clone()))
            .collect();
        topology
            .add_region(remainder_region.clone(), remainder_loops, vec![hole])
            .map_err(|error| error.to_string())?;
        surfaces
            .add_region_surface(topology, remainder_region.clone(), remainder_type, true)
            .map_err(|error| error.to_string())?;
        known_regions.insert(remainder_region.clone());
        Some(remainder_region)
    } else {
        None
    };
    topology
        .add_region(new_region.clone(), vec![new_loop], Vec::new())
        .map_err(|error| error.to_string())?;
    surfaces
        .add_region_surface(topology, new_region.clone(), new_region_type, true)
        .map_err(|error| error.to_string())?;
    known_regions.insert(new_region.clone());

    let mut consumed_surface_keys = Vec::with_capacity(plan.consumed_surface_keys().len());
    for key in plan.consumed_surface_keys() {
        known_surfaces.remove(key);
        consumed_surface_keys.push(key.clone());
    }

    Ok(RegionMergeOutcome {
        created_node_ids,
        created_edge_ids,
        remainder_region,
        new_region,
        consumed_surface_keys,
    })
}
