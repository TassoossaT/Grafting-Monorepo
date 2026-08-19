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
    ContourEdge, ContourEdgeId, ContourTopology, Edge, EdgeId, Node, NodeId, OrientedEdgeUse,
    RegionId, SurfaceKey, SurfaceRegistry, SurfaceType,
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
    /// Every existing analytic region this merge consumed and removed.
    pub consumed_region_ids: Vec<RegionId>,
    /// Every node this merge deleted outright because nothing -- no
    /// surviving surface, no surviving region -- still referenced it once
    /// every consumed item was retired. A node a surviving remainder's own
    /// boundary reused is never in here; only genuine orphans are.
    pub removed_node_ids: Vec<NodeId>,
    /// Every generic graph edge cascaded away by `removed_node_ids`' own
    /// deletion (an edge cannot outlive both its endpoints).
    pub removed_edge_ids: Vec<EdgeId>,
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
    let has_remainder =
        !plan.consumed_surface_keys().is_empty() || !plan.consumed_region_ids().is_empty();
    let new_region = RegionId::new(format!("region-merge-{operation_id}-new"))
        .map_err(|error| error.to_string())?;
    let remainder_region_and_type = if has_remainder {
        let remainder_region = RegionId::new(format!("region-merge-{operation_id}-remainder"))
            .map_err(|error| error.to_string())?;
        // A leftover remainder keeps whichever consumed item's own type --
        // a plain surface's or an existing region's alike, whichever this
        // merge actually found something to consume from.
        let remainder_type = plan
            .consumed_surface_keys()
            .first()
            .and_then(|key| surfaces.surface(key))
            .map(|surface| surface.surface_type().clone())
            .or_else(|| {
                plan.consumed_region_ids()
                    .first()
                    .and_then(|id| surfaces.region_surface(id))
                    .map(|region_surface| region_surface.surface_type().clone())
            })
            .ok_or("region merge has no consumed surface or region")?;
        Some((remainder_region, remainder_type))
    } else {
        None
    };

    let mut remainder_loops = Vec::new();
    for (loop_index, boundary) in plan.consumed_boundaries().iter().enumerate() {
        let mut loop_ = Vec::new();
        for (edge_index, (start, geometry)) in boundary.iter().enumerate() {
            let end = &boundary[(edge_index + 1) % boundary.len()].0;
            let id = ContourEdgeId::new(format!(
                "region-merge-{operation_id}-remainder-contour-{loop_index}-{edge_index}"
            ))
            .map_err(|error| error.to_string())?;
            topology
                .add_edge(
                    graph,
                    ContourEdge::new(id.clone(), start.clone(), end.clone(), *geometry),
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

    // Every node a consumed surface or region touched -- resolved *before*
    // that item is actually retired, since a plain `Surface`/`SurfaceRegion`
    // only exists long enough to read its own cycle/loops back out of the
    // removal call itself.
    let mut candidate_nodes = HashSet::<NodeId>::new();

    let mut consumed_surface_keys = Vec::with_capacity(plan.consumed_surface_keys().len());
    for key in plan.consumed_surface_keys() {
        known_surfaces.remove(key);
        let removed_surface = surfaces
            .remove_surface(key)
            .map_err(|error| error.to_string())?;
        candidate_nodes.extend(removed_surface.cycle().iter().cloned());
        consumed_surface_keys.push(key.clone());
    }

    // A consumed region's own edges may still be shared with an adjacent
    // region (`ContourTopology::remove_region`'s own doc), so this only
    // releases *this* region's usage of them and its semantic attributes --
    // it never deletes shared geometry out from under a sibling. Whether
    // any of its nodes truly became orphans is decided once, below, after
    // every consumed item (surfaces and regions alike) has been retired.
    let mut consumed_region_ids = Vec::with_capacity(plan.consumed_region_ids().len());
    for region_id in plan.consumed_region_ids() {
        let removed_region = topology
            .remove_region(region_id)
            .map_err(|error| error.to_string())?;
        for loop_ in removed_region
            .outer_loops()
            .iter()
            .chain(removed_region.holes().iter())
        {
            for use_ in loop_ {
                if let Some(edge) = topology.edge(use_.edge()) {
                    candidate_nodes.insert(edge.start_node().clone());
                    candidate_nodes.insert(edge.end_node().clone());
                }
            }
        }
        surfaces
            .remove_region_surface(region_id)
            .map_err(|error| error.to_string())?;
        known_regions.remove(region_id);
        consumed_region_ids.push(region_id.clone());
    }

    // A candidate node survives if the new region, its remainder, or any
    // untouched sibling surface/region still needs it -- both loops above
    // already registered every one of those before this point, so this is
    // the final, authoritative answer, not a guess.
    let nodes_in_use = topology.nodes_in_use();
    let mut removed_node_ids = Vec::new();
    let mut removed_edge_ids = Vec::new();
    for node_id in candidate_nodes {
        let still_used_by_surface = surfaces.surfaces_referencing(&node_id).next().is_some();
        if still_used_by_surface || nodes_in_use.contains(&node_id) {
            continue;
        }
        let snapshot = graph.snapshot();
        for edge in snapshot.edges() {
            if edge.source() == &node_id || edge.target() == &node_id {
                removed_edge_ids.push(edge.id().clone());
            }
        }
        graph
            .remove_node(&node_id)
            .map_err(|error| error.to_string())?;
        removed_node_ids.push(node_id);
    }
    topology.prune_unused_edges();

    Ok(RegionMergeOutcome {
        created_node_ids,
        created_edge_ids,
        remainder_region,
        new_region,
        consumed_surface_keys,
        consumed_region_ids,
        removed_node_ids,
        removed_edge_ids,
    })
}
