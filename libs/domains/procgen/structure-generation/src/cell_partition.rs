//! Derives walls/floors/ceilings from an arbitrary, possibly-disconnected
//! set of unit grid cells -- a generic "paint cells, get rooms" generator,
//! not a house-specific one (the `apps/vtt` composition layer decides a
//! particular use of this is "a house"; this crate only knows about cells
//! and rooms, so the same generator fits a village block or a building
//! floor later without renaming).
//!
//! Unlike [`crate::wall::generate_wall`]'s single straight segment, the
//! input here is a whole footprint's worth of painted cells that can be any
//! shape a brush stroke produces -- not just a rectangle. Three things this
//! module does that a rectangle-tile generator (a prior version of this
//! crate, no longer here) could not:
//!
//! - **Disconnected regions become separate rooms.** A stroke that skips a
//!   gap produces two components; each is partitioned independently.
//! - **A region larger than `max_room_cells` gets bisected** (recursive,
//!   axis-aligned, seeded jitter) until every leaf is small enough --
//!   [`generate_cell_partition`] is a pure function of the *final* set of
//!   painted cells, not of the order they were painted in, so the same
//!   footprint always produces the same partition regardless of how a
//!   caller's brush stroke grew it tick by tick.
//! - **Room shapes can be non-rectangular** (an L, a plus, anything a set
//!   of grid cells can form), so floor/ceiling are generated **per cell**
//!   (a quad each, welded at shared corners by position) rather than one
//!   polygon per room -- this crate's surface pipeline is only proven for
//!   4-corner quads, and a per-cell floor is exactly the same shape
//!   `terrain-brush` already uses successfully.

use std::collections::{BTreeMap, BTreeSet};

use rand::Rng;
use rand::SeedableRng;
use rand_pcg::Pcg32;

use grafting_graph_core::{EdgeId, Node, NodeId, SurfaceSpec, SurfaceType};

use crate::ids::corner_id;
use crate::wall::{DoorOpening, StructurePiece, WallNodeRole, WallSegment, generate_wall};

/// A generated cell partition's pieces: one wall piece per maximal wall
/// run, one floor + one ceiling piece per painted cell.
#[derive(Debug, Clone, PartialEq)]
pub struct RoomGridGeneration {
    /// Wall pieces, no fixed order.
    pub walls: Vec<StructurePiece>,
    /// One floor piece per painted cell.
    pub floors: Vec<StructurePiece>,
    /// One ceiling piece per painted cell.
    pub ceilings: Vec<StructurePiece>,
}

/// One cell's grid coordinates -- not world units. Ord'd lexicographically
/// (x then z) so every collection built from a set of these has a
/// deterministic iteration order, which is what makes
/// [`generate_cell_partition`] a pure function of its input cell set alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CellCoord {
    /// Grid column.
    pub x: i32,
    /// Grid row.
    pub z: i32,
}

/// Half the generated interior door's width, as a fraction of its wall
/// segment -- same fixed/centered default the rest of this crate uses.
const DOOR_HALF_WIDTH: f32 = 0.1;

/// A wall run shorter than this (world units) never gets a door, even if it
/// borders two different rooms -- a sliver is too narrow for a sensible
/// opening, so it stays a plain wall.
const MIN_DOOR_SEGMENT_WIDTH: f32 = 1.0;

fn neighbors(cell: CellCoord) -> [CellCoord; 4] {
    [
        CellCoord { x: cell.x + 1, z: cell.z },
        CellCoord { x: cell.x - 1, z: cell.z },
        CellCoord { x: cell.x, z: cell.z + 1 },
        CellCoord { x: cell.x, z: cell.z - 1 },
    ]
}

/// Splits `cells` into its 4-connected components. Each returned set's
/// membership is a pure graph property of `cells` -- deterministic
/// regardless of traversal order -- but the *order components are
/// returned in* is also deterministic here (smallest remaining coordinate
/// first), since [`generate_cell_partition`]'s seeded jitter is consumed
/// in that order.
fn connected_components(cells: &BTreeSet<CellCoord>) -> Vec<BTreeSet<CellCoord>> {
    let mut remaining: BTreeSet<CellCoord> = cells.clone();
    let mut components = Vec::new();
    while let Some(&start) = remaining.iter().next() {
        remaining.remove(&start);
        let mut stack = vec![start];
        let mut component = BTreeSet::new();
        component.insert(start);
        while let Some(cell) = stack.pop() {
            for neighbor in neighbors(cell) {
                if remaining.remove(&neighbor) {
                    component.insert(neighbor);
                    stack.push(neighbor);
                }
            }
        }
        components.push(component);
    }
    components
}

fn bounds(component: &BTreeSet<CellCoord>) -> (i32, i32, i32, i32) {
    let mut min_x = i32::MAX;
    let mut max_x = i32::MIN;
    let mut min_z = i32::MAX;
    let mut max_z = i32::MIN;
    for cell in component {
        min_x = min_x.min(cell.x);
        max_x = max_x.max(cell.x);
        min_z = min_z.min(cell.z);
        max_z = max_z.max(cell.z);
    }
    (min_x, max_x, min_z, max_z)
}

/// Splits `component` (at least 2 cells) into two non-empty halves by a
/// straight cut along whichever axis has the larger extent, jittered
/// (seeded) within the middle half of that extent so splits don't all
/// land dead-center. Guaranteed non-empty on both sides: the low side
/// always keeps the cell(s) at the minimum coordinate, the high side
/// always keeps the cell(s) at the maximum.
fn bisect(component: &BTreeSet<CellCoord>, rng: &mut Pcg32) -> (BTreeSet<CellCoord>, BTreeSet<CellCoord>) {
    let (min_x, max_x, min_z, max_z) = bounds(component);
    let split_on_x = (max_x - min_x) >= (max_z - min_z);
    let (min, max) = if split_on_x { (min_x, max_x) } else { (min_z, max_z) };

    let mid = (min + max) / 2;
    let jitter_span = (max - min) / 4;
    let jitter = if jitter_span > 0 { rng.gen_range(-jitter_span..=jitter_span) } else { 0 };
    let cut = (mid + jitter).clamp(min, max - 1);

    let mut low = BTreeSet::new();
    let mut high = BTreeSet::new();
    for &cell in component {
        let coordinate = if split_on_x { cell.x } else { cell.z };
        if coordinate <= cut { low.insert(cell) } else { high.insert(cell) };
    }
    (low, high)
}

/// Partitions `cells` into rooms: every disconnected region becomes its
/// own room-in-waiting, then any region over `max_room_cells` is
/// recursively bisected (re-splitting into connected components after
/// each cut, since a straight cut across an irregular region's bounding
/// box can separate it into pieces that are no longer contiguous) until
/// every leaf fits. `max_room_cells` is clamped to at least 1 so a
/// single-cell region (which can never be bisected -- zero extent on
/// both axes) always terminates the recursion.
fn partition_into_rooms(cells: &BTreeSet<CellCoord>, max_room_cells: usize, rng: &mut Pcg32) -> Vec<BTreeSet<CellCoord>> {
    let max_room_cells = max_room_cells.max(1);
    let mut queue: Vec<BTreeSet<CellCoord>> = connected_components(cells);
    let mut leaves = Vec::new();
    while let Some(component) = queue.pop() {
        if component.len() <= max_room_cells {
            leaves.push(component);
            continue;
        }
        let (low, high) = bisect(&component, rng);
        queue.extend(connected_components(&low));
        queue.extend(connected_components(&high));
    }
    leaves
}

fn cell_floor_ceiling(cell: CellCoord, cell_size: f32, origin: [f32; 3], id_prefix: &str, floor_type: SurfaceType, ceiling_type: SurfaceType) -> (StructurePiece, StructurePiece) {
    let x0 = origin[0] + cell.x as f32 * cell_size;
    let x1 = origin[0] + (cell.x + 1) as f32 * cell_size;
    let z0 = origin[2] + cell.z as f32 * cell_size;
    let z1 = origin[2] + (cell.z + 1) as f32 * cell_size;
    let y = origin[1];

    let corners = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)];

    let bottom_ids: Vec<NodeId> = corners.iter().map(|(x, z)| corner_id(id_prefix, *x, *z, false)).collect();
    let bottom_nodes: Vec<Node<[f32; 3]>> = bottom_ids.iter().zip(corners).map(|(id, (x, z))| Node::new(id.clone(), [x, y, z])).collect();

    let mut top_ids: Vec<NodeId> = corners.iter().map(|(x, z)| corner_id(id_prefix, *x, *z, true)).collect();
    let mut top_nodes: Vec<Node<[f32; 3]>> = top_ids.iter().zip(corners).map(|(id, (x, z))| Node::new(id.clone(), [x, y, z])).collect();
    top_ids.reverse();
    top_nodes.reverse();

    (
        StructurePiece { nodes: bottom_nodes, edges: Vec::new(), surface: SurfaceSpec { cycle: bottom_ids, surface_type: floor_type, physical: true } },
        StructurePiece { nodes: top_nodes, edges: Vec::new(), surface: SurfaceSpec { cycle: top_ids, surface_type: ceiling_type, physical: true } },
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Axis {
    X,
    Z,
}

/// One cell-edge that needs a wall: `axis`/`line` fix the grid line (a
/// vertical line at grid-x `line` for [`Axis::X`], a horizontal line at
/// grid-z `line` for [`Axis::Z`]), `span` is the single cell-width
/// interval `[span, span + 1)` along that line. `interior` is true iff a
/// painted neighbor cell exists on the other side (in a different room).
#[derive(Debug, Clone, Copy)]
struct WallEdge {
    axis: Axis,
    line: i32,
    span: i32,
    interior: bool,
}

/// Collects every cell-edge needing a wall. Only the positive-direction
/// neighbor (east for a vertical line, south for a horizontal line) is
/// checked when a neighbor is present, to avoid emitting the same shared
/// edge twice from both sides; a missing neighbor (perimeter) is always
/// emitted regardless of direction, since no other cell exists to emit it
/// from.
fn collect_wall_edges(cells: &BTreeSet<CellCoord>, leaf_of: &BTreeMap<CellCoord, usize>) -> Vec<WallEdge> {
    let mut edges = Vec::new();
    let needs_wall = |cell: CellCoord, neighbor: CellCoord| -> Option<bool> {
        match leaf_of.get(&neighbor) {
            None => Some(false),
            Some(neighbor_leaf) => {
                let this_leaf = leaf_of[&cell];
                (neighbor_leaf != &this_leaf).then_some(true)
            }
        }
    };
    for &cell in cells {
        let east = CellCoord { x: cell.x + 1, z: cell.z };
        if let Some(interior) = needs_wall(cell, east) {
            edges.push(WallEdge { axis: Axis::X, line: cell.x + 1, span: cell.z, interior });
        }
        let south = CellCoord { x: cell.x, z: cell.z + 1 };
        if let Some(interior) = needs_wall(cell, south) {
            edges.push(WallEdge { axis: Axis::Z, line: cell.z + 1, span: cell.x, interior });
        }
        let west = CellCoord { x: cell.x - 1, z: cell.z };
        if !cells.contains(&west) {
            edges.push(WallEdge { axis: Axis::X, line: cell.x, span: cell.z, interior: false });
        }
        let north = CellCoord { x: cell.x, z: cell.z - 1 };
        if !cells.contains(&north) {
            edges.push(WallEdge { axis: Axis::Z, line: cell.z, span: cell.x, interior: false });
        }
    }
    edges
}

/// A merged run of consecutive same-interior-ness cell-edges along one
/// grid line -- `[from, to)` in cell-grid units, `to` exclusive.
struct WallRun {
    axis: Axis,
    line: i32,
    from: i32,
    to: i32,
    interior: bool,
}

fn merge_wall_runs(mut edges: Vec<WallEdge>) -> Vec<WallRun> {
    edges.sort_by_key(|edge| (edge.axis == Axis::Z, edge.line, edge.span));
    let mut runs: Vec<WallRun> = Vec::new();
    for edge in edges {
        if let Some(last) = runs.last_mut() {
            if last.axis == edge.axis && last.line == edge.line && last.interior == edge.interior && last.to == edge.span {
                last.to = edge.span + 1;
                continue;
            }
        }
        runs.push(WallRun { axis: edge.axis, line: edge.line, from: edge.span, to: edge.span + 1, interior: edge.interior });
    }
    runs
}

fn generate_cell_wall_run(id_prefix: &str, cell_size: f32, origin: [f32; 3], wall_height: f32, run: &WallRun, wall_type: &SurfaceType, door_type: &SurfaceType) -> Vec<StructurePiece> {
    let axis_label = match run.axis {
        Axis::X => "x",
        Axis::Z => "z",
    };
    let (start, end) = match run.axis {
        Axis::X => {
            let x = origin[0] + run.line as f32 * cell_size;
            ([x, origin[1], origin[2] + run.from as f32 * cell_size], [x, origin[1], origin[2] + run.to as f32 * cell_size])
        }
        Axis::Z => {
            let z = origin[2] + run.line as f32 * cell_size;
            ([origin[0] + run.from as f32 * cell_size, origin[1], z], [origin[0] + run.to as f32 * cell_size, origin[1], z])
        }
    };

    let wall = WallSegment { start, end, height: wall_height };
    let run_length = (run.to - run.from) as f32 * cell_size;
    let long_enough_for_a_door = run_length >= MIN_DOOR_SEGMENT_WIDTH;
    let door = (run.interior && long_enough_for_a_door).then_some(DoorOpening { opens_at: 0.5 - DOOR_HALF_WIDTH, closes_at: 0.5 + DOOR_HALF_WIDTH });

    let node_id = |role: WallNodeRole| -> NodeId {
        match role {
            WallNodeRole::StartBottom => corner_id(id_prefix, start[0], start[2], false),
            WallNodeRole::StartTop => corner_id(id_prefix, start[0], start[2], true),
            WallNodeRole::EndBottom => corner_id(id_prefix, end[0], end[2], false),
            WallNodeRole::EndTop => corner_id(id_prefix, end[0], end[2], true),
            other => NodeId::new(format!("{id_prefix}:jamb:{axis_label}:{}:{}:{}:{other:?}", run.line, run.from, run.to)).expect("formatted id is never empty"),
        }
    };
    let edge_id = |from_role: WallNodeRole, to_role: WallNodeRole| {
        EdgeId::new(format!("{id_prefix}:edge:{axis_label}:{}:{}:{}:{from_role:?}-{to_role:?}", run.line, run.from, run.to)).expect("formatted id is never empty")
    };

    let generation = generate_wall(&wall, door.as_ref(), node_id, edge_id, wall_type.clone(), door_type.clone()).expect("centered default door opening is always within bounds");
    generation.pieces
}

/// Generates every painted cell's floor/ceiling and every wall run needed
/// between/around them. `cells` may repeat and may be in any order --
/// deduplicated internally. Empty input produces an empty generation.
/// `max_room_cells` is clamped to at least 1. See the module doc for the
/// three ways this differs from a fixed-rectangle generator.
#[allow(clippy::too_many_arguments)]
pub fn generate_cell_partition(
    cells: &[CellCoord],
    cell_size: f32,
    origin: [f32; 3],
    wall_height: f32,
    max_room_cells: usize,
    seed: u64,
    id_prefix: &str,
    wall_type: SurfaceType,
    door_type: SurfaceType,
    floor_type: SurfaceType,
    ceiling_type: SurfaceType,
) -> RoomGridGeneration {
    let cell_set: BTreeSet<CellCoord> = cells.iter().copied().collect();
    if cell_set.is_empty() {
        return RoomGridGeneration { walls: Vec::new(), floors: Vec::new(), ceilings: Vec::new() };
    }

    let mut rng = Pcg32::seed_from_u64(seed);
    let leaves = partition_into_rooms(&cell_set, max_room_cells, &mut rng);

    let mut leaf_of: BTreeMap<CellCoord, usize> = BTreeMap::new();
    for (index, leaf) in leaves.iter().enumerate() {
        for &cell in leaf {
            leaf_of.insert(cell, index);
        }
    }

    let mut floors = Vec::with_capacity(cell_set.len());
    let mut ceilings = Vec::with_capacity(cell_set.len());
    for &cell in &cell_set {
        let (floor, ceiling) = cell_floor_ceiling(cell, cell_size, origin, id_prefix, floor_type.clone(), ceiling_type.clone());
        floors.push(floor);
        ceilings.push(ceiling);
    }

    let edges = collect_wall_edges(&cell_set, &leaf_of);
    let runs = merge_wall_runs(edges);
    let mut walls = Vec::new();
    for run in &runs {
        walls.extend(generate_cell_wall_run(id_prefix, cell_size, origin, wall_height, run, &wall_type, &door_type));
    }

    RoomGridGeneration { walls, floors, ceilings }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn types() -> (SurfaceType, SurfaceType, SurfaceType, SurfaceType) {
        (SurfaceType::new("wall"), SurfaceType::new("door"), SurfaceType::new("floor"), SurfaceType::new("ceiling"))
    }

    fn generate(cells: &[CellCoord], max_room_cells: usize, seed: u64) -> RoomGridGeneration {
        let (wall_type, door_type, floor_type, ceiling_type) = types();
        generate_cell_partition(cells, 2.0, [0.0, 0.0, 0.0], 3.0, max_room_cells, seed, "brush-1", wall_type, door_type, floor_type, ceiling_type)
    }

    #[test]
    fn empty_input_produces_nothing() {
        let generation = generate(&[], 6, 1);
        assert!(generation.walls.is_empty() && generation.floors.is_empty() && generation.ceilings.is_empty());
    }

    #[test]
    fn a_single_cell_has_4_plain_walls_and_one_floor_ceiling() {
        let generation = generate(&[CellCoord { x: 0, z: 0 }], 6, 1);
        assert_eq!(generation.walls.len(), 4);
        assert_eq!(generation.floors.len(), 1);
        assert_eq!(generation.ceilings.len(), 1);
        assert!(generation.walls.iter().all(|piece| piece.surface.surface_type == SurfaceType::new("wall")));
    }

    #[test]
    fn two_adjacent_cells_under_the_threshold_share_one_room_with_no_interior_wall() {
        let generation = generate(&[CellCoord { x: 0, z: 0 }, CellCoord { x: 1, z: 0 }], 6, 1);
        assert_eq!(generation.floors.len(), 2);
        // Fully open interior: perimeter only, no wall on the shared edge.
        // North and south each merge into one run spanning both cells;
        // east and west are each one cell wide -- 4 pieces total.
        assert_eq!(generation.walls.len(), 4);
        assert!(generation.walls.iter().all(|piece| piece.surface.surface_type != SurfaceType::new("door")));
    }

    #[test]
    fn a_gap_in_the_stroke_produces_two_disconnected_rooms() {
        let generation = generate(&[CellCoord { x: 0, z: 0 }, CellCoord { x: 5, z: 5 }], 6, 1);
        assert_eq!(generation.floors.len(), 2);
        // Two fully separate 1-cell rooms: 4 perimeter walls each, no doors.
        assert_eq!(generation.walls.len(), 8);
    }

    #[test]
    fn a_region_over_the_threshold_gets_bisected_with_a_door_between_the_halves() {
        // A 1x4 strip, threshold 2: must split into two 1x2 rooms.
        let cells: Vec<CellCoord> = (0..4).map(|x| CellCoord { x, z: 0 }).collect();
        let generation = generate(&cells, 2, 1);
        assert_eq!(generation.floors.len(), 4);
        let door_count = generation.walls.iter().filter(|piece| piece.surface.surface_type == SurfaceType::new("door")).count();
        assert_eq!(door_count, 1, "expected exactly one door on the single interior split");
    }

    #[test]
    fn the_same_final_cell_set_produces_the_same_partition_regardless_of_input_order() {
        let cells: Vec<CellCoord> = (0..6).map(|x| CellCoord { x, z: 0 }).collect();
        let mut reversed = cells.clone();
        reversed.reverse();

        let a = generate(&cells, 2, 7);
        let b = generate(&reversed, 2, 7);

        let mut ids_a: Vec<_> = a.floors.iter().flat_map(|piece| piece.surface.cycle.clone()).collect();
        let mut ids_b: Vec<_> = b.floors.iter().flat_map(|piece| piece.surface.cycle.clone()).collect();
        ids_a.sort();
        ids_b.sort();
        assert_eq!(ids_a, ids_b);
        assert_eq!(a.walls.len(), b.walls.len());
    }

    #[test]
    fn painting_the_same_cell_twice_across_separate_calls_yields_identical_ids() {
        let a = generate(&[CellCoord { x: 2, z: 3 }], 6, 1);
        let b = generate(&[CellCoord { x: 2, z: 3 }], 6, 1);
        assert_eq!(a.floors[0].surface.cycle, b.floors[0].surface.cycle);
    }

    #[test]
    fn an_l_shaped_region_does_not_lose_the_concave_corner_wall() {
        // An L: (0,0),(1,0),(0,1) -- no cell at (1,1). High threshold so it
        // stays one room; the concave corner at (1,1) must still get walls
        // on both of its exposed sides.
        let cells = [CellCoord { x: 0, z: 0 }, CellCoord { x: 1, z: 0 }, CellCoord { x: 0, z: 1 }];
        let generation = generate(&cells, 10, 1);
        assert_eq!(generation.floors.len(), 3);
        // Perimeter of an L-tromino is 8 unit edges, but the bottom pair and
        // the left pair each merge into one run (same line, same
        // perimeter-ness, contiguous span): 8 - 2 = 6 wall pieces.
        assert_eq!(generation.walls.len(), 6);
    }

    #[test]
    fn every_floor_and_ceiling_corner_has_its_own_node_data() {
        // A fully-interior corner shared by 4 same-room cells has no wall
        // touching it -- floors/ceilings must carry their own node data or
        // that corner would never exist anywhere in the generation output.
        let cells = [
            CellCoord { x: 0, z: 0 },
            CellCoord { x: 1, z: 0 },
            CellCoord { x: 0, z: 1 },
            CellCoord { x: 1, z: 1 },
        ];
        let generation = generate(&cells, 10, 1);
        let interior_corner = corner_id("brush-1", 2.0, 2.0, false);
        let touched_by_wall = generation.walls.iter().any(|piece| piece.nodes.iter().any(|node| node.id() == &interior_corner));
        assert!(!touched_by_wall, "test premise: this corner is fully interior, no wall should touch it");
        let touched_by_floor = generation.floors.iter().any(|piece| piece.nodes.iter().any(|node| node.id() == &interior_corner));
        assert!(touched_by_floor, "the interior corner must still have node data from a floor piece");
    }
}
