//! Generic "regenerate a structure's whole geometry, apply only the diff"
//! core -- shared by every `generate_and_apply_*` operation whose
//! generator produces a *complete* replacement for some scoped region each
//! call (as opposed to `wall::generate_and_apply_wall`'s purely additive
//! model, or `room_removal::remove_room`'s purely subtractive one).
//!
//! Extracted from `cell_partition`'s own original inline implementation
//! once `wall_path` needed the identical diff/dedup/orphan-cleanup logic
//! against a different scope test (a polygon boundary, not a bounding
//! box) -- deciding *what counts as "this structure's own geometry"* is
//! each caller's own concern (see their own docs), but *what to do once
//! that's decided* -- remove what's gone, add what's new, skip what's
//! unchanged, sweep orphaned nodes -- is identical, so it lives here once.
//!
//! This only works cheaply because every id a generator in this crate's
//! sibling `grafting-procgen-structure-generation` produces is a pure
//! function of world position -- repainting the same geometry across ticks
//! or across separate calls always reproduces the exact same `SurfaceKey`s,
//! so unchanged geometry costs nothing (its key is already in
//! `old_keys_in_scope`, so it's filtered out of both the add and remove
//! sets) and only genuinely new or genuinely stale pieces are touched.

use std::collections::{HashMap, HashSet};

use grafting_graph_core::{Edge, EdgeId, Node, NodeId, SurfaceKey, SurfaceRegistry};
use grafting_procgen_structure_generation::StructurePiece;

use crate::dto::surface_key_to_wire;
use crate::editing::SessionGraph;

/// What changed, in wire-ready form -- the same shape every
/// `generate_and_apply_*` JSON response already uses.
pub struct DiffOutcome {
    pub added_surface_keys: Vec<Vec<String>>,
    pub removed_surface_keys: Vec<Vec<String>>,
    pub removed_node_ids: Vec<String>,
}

/// Diffs `all_pieces` (a generator's complete, freshly-derived output)
/// against `old_keys_in_scope` (every previously-registered surface the
/// caller has already decided belongs to this same structure), applies
/// only the difference, and sweeps any node `node_in_scope` still claims
/// but no surface references anymore.
pub fn diff_and_apply(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    old_keys_in_scope: &HashSet<SurfaceKey>,
    all_pieces: Vec<StructurePiece>,
    node_in_scope: impl Fn(&Node<[f32; 3]>) -> bool,
) -> Result<DiffOutcome, String> {
    let new_keys: HashSet<SurfaceKey> = all_pieces.iter().map(|piece| SurfaceKey::from_cycle(&piece.surface.cycle)).collect();

    let to_remove: Vec<SurfaceKey> = old_keys_in_scope.difference(&new_keys).cloned().collect();
    let to_add: Vec<_> = all_pieces.into_iter().filter(|piece| !old_keys_in_scope.contains(&SurfaceKey::from_cycle(&piece.surface.cycle))).collect();

    let mut removed_surface_keys = Vec::with_capacity(to_remove.len());
    for key in &to_remove {
        surfaces.remove_surface(key).map_err(|error| error.to_string())?;
        removed_surface_keys.push(surface_key_to_wire(key));
    }

    // Dedup nodes/edges across every kept piece before mutating -- a
    // corner or jamb shared by more than one piece must only be added
    // once, and one already present from a prior call (or a neighboring
    // piece's own) is reused, never re-added.
    let mut unique_nodes: HashMap<NodeId, Node<[f32; 3]>> = HashMap::new();
    let mut unique_edges: HashMap<EdgeId, Edge<()>> = HashMap::new();
    for piece in &to_add {
        for node in &piece.nodes {
            unique_nodes.entry(node.id().clone()).or_insert_with(|| node.clone());
        }
        for edge in &piece.edges {
            unique_edges.entry(edge.id().clone()).or_insert_with(|| edge.clone());
        }
    }
    for (id, node) in &unique_nodes {
        if graph.node(id).is_none() {
            graph.add_node(node.clone()).map_err(|error| error.to_string())?;
        }
    }
    for (id, edge) in &unique_edges {
        if graph.edge(id).is_none() {
            graph.add_edge(edge.clone()).map_err(|error| error.to_string())?;
        }
    }

    let mut added_surface_keys = Vec::with_capacity(to_add.len());
    for piece in to_add {
        let curvature = piece.surface.curvature;
        let key = surfaces.add_surface(graph, piece.surface.cycle, piece.surface.surface_type, piece.surface.physical).map_err(|error| error.to_string())?;
        if curvature.is_some() {
            surfaces.set_curvature(&key, curvature).map_err(|error| error.to_string())?;
        }
        added_surface_keys.push(surface_key_to_wire(&key));
    }

    // Orphan cleanup: any node still claimed by the caller's own scope
    // that no surface references anymore (a removed run's own private
    // jamb/facet nodes, most commonly) is deleted.
    let snapshot = graph.snapshot();
    let scoped_node_ids: Vec<NodeId> = snapshot.nodes().iter().filter(|node| node_in_scope(node)).map(|node| node.id().clone()).collect();
    let mut removed_node_ids = Vec::new();
    for id in &scoped_node_ids {
        if surfaces.surfaces_referencing(id).next().is_none() {
            graph.remove_node(id).map_err(|error| error.to_string())?;
            removed_node_ids.push(id.as_str().to_owned());
        }
    }

    Ok(DiffOutcome { added_surface_keys, removed_surface_keys, removed_node_ids })
}
