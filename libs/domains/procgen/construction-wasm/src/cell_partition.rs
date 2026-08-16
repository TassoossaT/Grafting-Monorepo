//! Pure inner function for `generate_and_apply_cell_partition`: the
//! "Pintar Casa" tool's per-tick commit. Unlike every other
//! `generate_and_apply_*` operation in this crate (purely additive) or
//! `room_removal::remove_room` (purely subtractive), this one **replaces**
//! a structure's geometry with whatever
//! `grafting_procgen_structure_generation::generate_cell_partition` derives
//! from the request's full current cell set, every call -- necessary
//! because reformulating a painted house (a split moving, two rooms
//! merging) can both add and remove surfaces in the same tick.
//!
//! This only works cheaply because every id `generate_cell_partition`
//! produces is a pure function of world position (see that crate's own
//! doc) -- repainting the same cells across ticks or across separate
//! strokes always reproduces the exact same `SurfaceKey`s, so unchanged
//! geometry costs nothing (its key is already in `known_surfaces`, so it's
//! filtered out of both the add and remove sets) and only genuinely new or
//! genuinely stale pieces are touched.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use grafting_graph_core::{Edge, EdgeId, Node, NodeId, SurfaceKey, SurfaceRegistry, SurfaceType};
use grafting_procgen_structure_generation::{CellCoord, generate_cell_partition};

use crate::dto::surface_key_to_wire;
use crate::editing::SessionGraph;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellCoordDto {
    pub x: i32,
    pub z: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAndApplyCellPartitionRequest {
    /// Every cell currently painted in this stroke -- the *whole*
    /// accumulated set, not just what changed since the last tick (see
    /// module doc: unchanged cells cost nothing regardless).
    pub cells: Vec<CellCoordDto>,
    pub cell_size: f32,
    pub origin: [f32; 3],
    pub wall_height: f32,
    pub max_room_cells: usize,
    pub seed: u64,
    /// Namespaces every id this call derives -- must stay the same fixed
    /// value across every tick of one structure (and across separate
    /// strokes painting the same physical structure later), unlike this
    /// crate's other generators which namespace per-call. See module doc.
    pub id_prefix: String,
    pub wall_type: String,
    pub door_type: String,
    pub floor_type: String,
    pub ceiling_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAndApplyCellPartitionResponse {
    pub added_surface_keys: Vec<Vec<String>>,
    pub removed_surface_keys: Vec<Vec<String>>,
    pub removed_node_ids: Vec<String>,
}

/// Regenerates a cell partition's full geometry and diffs it against
/// whatever this same structure's bounding box already holds (per
/// `known_surfaces`), applying only the difference. Errors, leaving
/// nothing changed yet, if `cells` is empty or `cellSize` is not positive.
pub fn generate_and_apply_cell_partition(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    known_surfaces: &HashSet<SurfaceKey>,
    request: GenerateAndApplyCellPartitionRequest,
) -> Result<GenerateAndApplyCellPartitionResponse, String> {
    if request.cells.is_empty() {
        return Err("cells must not be empty".to_string());
    }
    if request.cell_size <= 0.0 {
        return Err("cellSize must be positive".to_string());
    }

    let cells: Vec<CellCoord> = request.cells.iter().map(|cell| CellCoord { x: cell.x, z: cell.z }).collect();

    let min_x = cells.iter().map(|cell| cell.x).min().expect("cells is non-empty");
    let max_x = cells.iter().map(|cell| cell.x).max().expect("cells is non-empty");
    let min_z = cells.iter().map(|cell| cell.z).min().expect("cells is non-empty");
    let max_z = cells.iter().map(|cell| cell.z).max().expect("cells is non-empty");
    let box_min_x = request.origin[0] + min_x as f32 * request.cell_size;
    let box_max_x = request.origin[0] + (max_x + 1) as f32 * request.cell_size;
    let box_min_z = request.origin[2] + min_z as f32 * request.cell_size;
    let box_max_z = request.origin[2] + (max_z + 1) as f32 * request.cell_size;
    const EPS: f32 = 1e-3;
    let in_box = |position: &[f32; 3]| {
        position[0] >= box_min_x - EPS && position[0] <= box_max_x + EPS && position[2] >= box_min_z - EPS && position[2] <= box_max_z + EPS
    };

    let generation = generate_cell_partition(
        &cells,
        request.cell_size,
        request.origin,
        request.wall_height,
        request.max_room_cells,
        request.seed,
        &request.id_prefix,
        SurfaceType::new(request.wall_type),
        SurfaceType::new(request.door_type),
        SurfaceType::new(request.floor_type),
        SurfaceType::new(request.ceiling_type),
    );
    let all_pieces: Vec<_> = generation.walls.into_iter().chain(generation.floors.into_iter()).chain(generation.ceilings.into_iter()).collect();
    let new_keys: HashSet<SurfaceKey> = all_pieces.iter().map(|piece| SurfaceKey::from_cycle(&piece.surface.cycle)).collect();

    // Every previously-known surface fully inside this structure's own
    // bounding box -- the same position-based scoping
    // `room_removal::remove_room` already uses to answer "what belongs to
    // this structure."
    let old_keys_in_scope: HashSet<SurfaceKey> = known_surfaces
        .iter()
        .filter(|key| {
            surfaces
                .surface(key)
                .map(|surface| surface.cycle().iter().all(|id| graph.node(id).map(|node| in_box(node.data())).unwrap_or(false)))
                .unwrap_or(false)
        })
        .cloned()
        .collect();

    let to_remove: Vec<SurfaceKey> = old_keys_in_scope.difference(&new_keys).cloned().collect();
    let to_add: Vec<_> = all_pieces.into_iter().filter(|piece| !old_keys_in_scope.contains(&SurfaceKey::from_cycle(&piece.surface.cycle))).collect();

    let mut removed_surface_keys = Vec::with_capacity(to_remove.len());
    for key in &to_remove {
        surfaces.remove_surface(key).map_err(|error| error.to_string())?;
        removed_surface_keys.push(surface_key_to_wire(key));
    }

    // Dedup nodes/edges across every kept piece before mutating -- a
    // corner or jamb shared by more than one piece must only be added
    // once, and one already present from a prior tick (or a neighboring
    // cell's own piece) is reused, never re-added.
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
        let key = surfaces.add_surface(graph, piece.surface.cycle, piece.surface.surface_type, piece.surface.physical).map_err(|error| error.to_string())?;
        added_surface_keys.push(surface_key_to_wire(&key));
    }

    // Orphan cleanup, same as `room_removal::remove_room`: any node inside
    // the box no longer referenced by any surface (a removed run's own
    // private jamb nodes, most commonly) is deleted.
    let snapshot = graph.snapshot();
    let box_node_ids: Vec<NodeId> = snapshot.nodes().iter().filter(|node| in_box(node.data())).map(|node| node.id().clone()).collect();
    let mut removed_node_ids = Vec::new();
    for id in &box_node_ids {
        if surfaces.surfaces_referencing(id).next().is_none() {
            graph.remove_node(id).map_err(|error| error.to_string())?;
            removed_node_ids.push(id.as_str().to_owned());
        }
    }

    Ok(GenerateAndApplyCellPartitionResponse { added_surface_keys, removed_surface_keys, removed_node_ids })
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::Graph;

    fn empty_session() -> (SessionGraph, SurfaceRegistry, HashSet<SurfaceKey>) {
        (Graph::try_from_parts(Vec::new(), Vec::new()).unwrap(), SurfaceRegistry::new(), HashSet::new())
    }

    fn request(cells: Vec<(i32, i32)>, max_room_cells: usize) -> GenerateAndApplyCellPartitionRequest {
        GenerateAndApplyCellPartitionRequest {
            cells: cells.into_iter().map(|(x, z)| CellCoordDto { x, z }).collect(),
            cell_size: 2.0,
            origin: [0.0, 0.0, 0.0],
            wall_height: 3.0,
            max_room_cells,
            seed: 1,
            id_prefix: "brush-1".into(),
            wall_type: "wall-white".into(),
            door_type: "door".into(),
            floor_type: "floor".into(),
            ceiling_type: "ceiling".into(),
        }
    }

    fn apply(graph: &mut SessionGraph, surfaces: &mut SurfaceRegistry, known: &mut HashSet<SurfaceKey>, req: GenerateAndApplyCellPartitionRequest) -> GenerateAndApplyCellPartitionResponse {
        let response = generate_and_apply_cell_partition(graph, surfaces, known, req).unwrap();
        for key in &response.removed_surface_keys {
            known.remove(&SurfaceKey::from_cycle(&key.iter().map(|id| NodeId::new(id.clone()).unwrap()).collect::<Vec<_>>()));
        }
        for key in &response.added_surface_keys {
            known.insert(SurfaceKey::from_cycle(&key.iter().map(|id| NodeId::new(id.clone()).unwrap()).collect::<Vec<_>>()));
        }
        response
    }

    #[test]
    fn first_tick_on_one_cell_adds_geometry_and_removes_nothing() {
        let (mut graph, mut surfaces, mut known) = empty_session();
        let response = apply(&mut graph, &mut surfaces, &mut known, request(vec![(0, 0)], 6));
        assert_eq!(response.added_surface_keys.len(), 6); // 4 walls + floor + ceiling
        assert!(response.removed_surface_keys.is_empty());
    }

    #[test]
    fn repainting_the_same_cell_on_a_second_tick_is_a_no_op() {
        let (mut graph, mut surfaces, mut known) = empty_session();
        apply(&mut graph, &mut surfaces, &mut known, request(vec![(0, 0)], 6));
        let second = apply(&mut graph, &mut surfaces, &mut known, request(vec![(0, 0)], 6));
        assert!(second.added_surface_keys.is_empty());
        assert!(second.removed_surface_keys.is_empty());
    }

    #[test]
    fn growing_past_the_threshold_removes_the_old_perimeter_and_adds_a_split() {
        let (mut graph, mut surfaces, mut known) = empty_session();
        // Tick 1: a single 1x2 room, no split yet (threshold 2).
        let first = apply(&mut graph, &mut surfaces, &mut known, request(vec![(0, 0), (1, 0)], 2));
        assert!(first.removed_surface_keys.is_empty());
        let doors_before = surfaces_of_type(&surfaces, &known, "door");
        assert_eq!(doors_before, 0);

        // Tick 2: grows to 1x3, now over threshold -- must split and add a door.
        let second = apply(&mut graph, &mut surfaces, &mut known, request(vec![(0, 0), (1, 0), (2, 0)], 2));
        assert!(!second.added_surface_keys.is_empty());
        let doors_after = surfaces_of_type(&surfaces, &known, "door");
        assert_eq!(doors_after, 1, "growing past the threshold must introduce exactly one split with a door");
    }

    fn surfaces_of_type(surfaces: &SurfaceRegistry, known: &HashSet<SurfaceKey>, surface_type: &str) -> usize {
        known.iter().filter(|key| surfaces.surface(key).map(|s| s.surface_type().as_str() == surface_type).unwrap_or(false)).count()
    }

    #[test]
    fn empty_cells_errors_without_mutating() {
        let (mut graph, mut surfaces, known) = empty_session();
        let error = generate_and_apply_cell_partition(&mut graph, &mut surfaces, &known, request(vec![], 6)).unwrap_err();
        assert!(error.contains("cells"));
        assert_eq!(graph.node_count(), 0);
    }
}
