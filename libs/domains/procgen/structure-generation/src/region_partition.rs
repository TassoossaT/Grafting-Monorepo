//! Finds regions in an arbitrary, possibly-disconnected set of unit grid
//! cells, and the boundary runs between/around them -- a generic "paint
//! cells, find rooms" topology function, not a house-specific one (the
//! `apps/vtt` composition layer decides a particular use of this is "a
//! house" or "a terrain patch"; this crate only knows about cells and
//! regions). Pure topology and geometry only -- **no wall, floor, ceiling,
//! or door is generated here**; a caller turns a [`Region`]'s cells into
//! flat caps via [`crate::boundary::cap_boundary`] and a [`BoundaryRun`]
//! into a panel via [`crate::extrusion::extrude_path`], deciding for
//! itself what (if anything) goes in a `shared` run's opening.
//!
//! Unlike [`crate::extrusion::extrude_path`]'s free-form path, the input
//! here is a whole footprint's worth of painted cells that can be any
//! shape a brush stroke produces -- not just a rectangle. Two things this
//! module does that a rectangle-tile generator could not:
//!
//! - **Disconnected regions become separate regions.** A stroke that skips
//!   a gap produces two components; each is partitioned independently.
//! - **A region larger than `max_region_cells` gets bisected** (recursive,
//!   axis-aligned, seeded jitter) until every leaf is small enough --
//!   [`partition_cells_into_regions`] is a pure function of the *final* set
//!   of painted cells, not of the order they were painted in.

use std::collections::{BTreeMap, BTreeSet};

use rand::Rng;
use rand::SeedableRng;
use rand_pcg::Pcg32;

/// One cell's grid coordinates -- not world units. Ord'd lexicographically
/// (x then z) so every collection built from a set of these has a
/// deterministic iteration order, which is what makes
/// [`partition_cells_into_regions`] a pure function of its input cell set
/// alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CellCoord {
    /// Grid column.
    pub x: i32,
    /// Grid row.
    pub z: i32,
}

/// One region: a connected set of cells no larger than the `max_region_cells`
/// its own [`partition_cells_into_regions`] call was given.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Region {
    /// This region's own cells.
    pub cells: BTreeSet<CellCoord>,
}

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
/// first), since [`partition_cells_into_regions`]'s seeded jitter is
/// consumed in that order.
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

/// Partitions `cells` into regions: every disconnected component becomes
/// its own region-in-waiting, then any region over `max_region_cells` is
/// recursively bisected (re-splitting into connected components after each
/// cut, since a straight cut across an irregular region's bounding box can
/// separate it into pieces that are no longer contiguous) until every leaf
/// fits. `max_region_cells` is clamped to at least 1, so a single-cell
/// region (which can never be bisected -- zero extent on both axes) always
/// terminates the recursion -- `max_region_cells: 1` is also how a caller
/// asks for "never merge cells at all," one region per cell (a terrain
/// painter's own use, as opposed to a room painter's `max_region_cells > 1`).
/// Empty input produces no regions.
pub fn partition_cells_into_regions(cells: &[CellCoord], max_region_cells: usize, seed: u64) -> Vec<Region> {
    let cell_set: BTreeSet<CellCoord> = cells.iter().copied().collect();
    if cell_set.is_empty() {
        return Vec::new();
    }
    let max_region_cells = max_region_cells.max(1);
    let mut rng = Pcg32::seed_from_u64(seed);
    let mut queue: Vec<BTreeSet<CellCoord>> = connected_components(&cell_set);
    let mut leaves = Vec::new();
    while let Some(component) = queue.pop() {
        if component.len() <= max_region_cells {
            leaves.push(component);
            continue;
        }
        let (low, high) = bisect(&component, &mut rng);
        queue.extend(connected_components(&low));
        queue.extend(connected_components(&high));
    }
    leaves.into_iter().map(|cells| Region { cells }).collect()
}

/// Which grid axis a [`BoundaryRun`] runs perpendicular to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Axis {
    /// A vertical line at a fixed grid-x.
    X,
    /// A horizontal line at a fixed grid-z.
    Z,
}

/// One merged run of cell-edges needing a boundary, along one grid line:
/// `axis`/`line` fix the grid line (a vertical line at grid-x `line` for
/// [`Axis::X`], a horizontal line at grid-z `line` for [`Axis::Z`]),
/// `[from, to)` is the cell-width span along it. `shared` is true iff two
/// *different* regions (from the same [`partition_cells_into_regions`]
/// call) border this run on either side -- false for the outer edge of the
/// whole painted footprint. A caller decides what (if anything) a `shared`
/// run's own opening looks like; this module only reports where one is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoundaryRun {
    /// This run's own axis.
    pub axis: Axis,
    /// The fixed grid line this run sits on.
    pub line: i32,
    /// This run's start, inclusive, in cell-grid units.
    pub from: i32,
    /// This run's end, exclusive, in cell-grid units.
    pub to: i32,
    /// True iff this run separates two different regions.
    pub shared: bool,
}

#[derive(Debug, Clone, Copy)]
struct CellEdge {
    axis: Axis,
    line: i32,
    span: i32,
    shared: bool,
}

/// Collects every cell-edge needing a boundary. Only the positive-direction
/// neighbor (east for a vertical line, south for a horizontal line) is
/// checked when a neighbor is present, to avoid emitting the same shared
/// edge twice from both sides; a missing neighbor (perimeter) is always
/// emitted regardless of direction, since no other cell exists to emit it
/// from.
fn collect_cell_edges(cells: &BTreeSet<CellCoord>, region_of: &BTreeMap<CellCoord, usize>) -> Vec<CellEdge> {
    let mut edges = Vec::new();
    let needs_boundary = |cell: CellCoord, neighbor: CellCoord| -> Option<bool> {
        match region_of.get(&neighbor) {
            None => Some(false),
            Some(neighbor_region) => {
                let this_region = region_of[&cell];
                (neighbor_region != &this_region).then_some(true)
            }
        }
    };
    for &cell in cells {
        let east = CellCoord { x: cell.x + 1, z: cell.z };
        if let Some(shared) = needs_boundary(cell, east) {
            edges.push(CellEdge { axis: Axis::X, line: cell.x + 1, span: cell.z, shared });
        }
        let south = CellCoord { x: cell.x, z: cell.z + 1 };
        if let Some(shared) = needs_boundary(cell, south) {
            edges.push(CellEdge { axis: Axis::Z, line: cell.z + 1, span: cell.x, shared });
        }
        let west = CellCoord { x: cell.x - 1, z: cell.z };
        if !cells.contains(&west) {
            edges.push(CellEdge { axis: Axis::X, line: cell.x, span: cell.z, shared: false });
        }
        let north = CellCoord { x: cell.x, z: cell.z - 1 };
        if !cells.contains(&north) {
            edges.push(CellEdge { axis: Axis::Z, line: cell.z, span: cell.x, shared: false });
        }
    }
    edges
}

fn merge_runs(mut edges: Vec<CellEdge>) -> Vec<BoundaryRun> {
    edges.sort_by_key(|edge| (edge.axis == Axis::Z, edge.line, edge.span));
    let mut runs: Vec<BoundaryRun> = Vec::new();
    for edge in edges {
        if let Some(last) = runs.last_mut() {
            if last.axis == edge.axis && last.line == edge.line && last.shared == edge.shared && last.to == edge.span {
                last.to = edge.span + 1;
                continue;
            }
        }
        runs.push(BoundaryRun { axis: edge.axis, line: edge.line, from: edge.span, to: edge.span + 1, shared: edge.shared });
    }
    runs
}

/// Every boundary run needed between/around `regions`' own cells --
/// `regions` must be `cells`' own [`partition_cells_into_regions`] result
/// (or an equivalent partition), since a run's `shared` flag is derived
/// from which region each of its two bordering cells belongs to.
pub fn boundary_runs(cells: &[CellCoord], regions: &[Region]) -> Vec<BoundaryRun> {
    let cell_set: BTreeSet<CellCoord> = cells.iter().copied().collect();
    let mut region_of: BTreeMap<CellCoord, usize> = BTreeMap::new();
    for (index, region) in regions.iter().enumerate() {
        for &cell in &region.cells {
            region_of.insert(cell, index);
        }
    }
    merge_runs(collect_cell_edges(&cell_set, &region_of))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_produces_no_regions() {
        assert!(partition_cells_into_regions(&[], 6, 1).is_empty());
    }

    #[test]
    fn a_single_cell_is_its_own_region_with_four_perimeter_runs() {
        let cells = [CellCoord { x: 0, z: 0 }];
        let regions = partition_cells_into_regions(&cells, 6, 1);
        assert_eq!(regions.len(), 1);
        let runs = boundary_runs(&cells, &regions);
        assert_eq!(runs.len(), 4);
        assert!(runs.iter().all(|run| !run.shared));
    }

    #[test]
    fn two_adjacent_cells_under_the_threshold_share_one_region_with_no_shared_run() {
        let cells = [CellCoord { x: 0, z: 0 }, CellCoord { x: 1, z: 0 }];
        let regions = partition_cells_into_regions(&cells, 6, 1);
        assert_eq!(regions.len(), 1);
        let runs = boundary_runs(&cells, &regions);
        // Perimeter only: north/south merge into one run each spanning both
        // cells, east/west are one cell wide each -- 4 runs, none shared.
        assert_eq!(runs.len(), 4);
        assert!(runs.iter().all(|run| !run.shared));
    }

    #[test]
    fn a_gap_in_the_stroke_produces_two_disconnected_regions() {
        let cells = [CellCoord { x: 0, z: 0 }, CellCoord { x: 5, z: 5 }];
        let regions = partition_cells_into_regions(&cells, 6, 1);
        assert_eq!(regions.len(), 2);
        let runs = boundary_runs(&cells, &regions);
        assert_eq!(runs.len(), 8);
        assert!(runs.iter().all(|run| !run.shared));
    }

    #[test]
    fn a_region_over_the_threshold_gets_bisected_with_one_shared_run() {
        // A 1x4 strip, threshold 2: must split into two 1x2 regions.
        let cells: Vec<CellCoord> = (0..4).map(|x| CellCoord { x, z: 0 }).collect();
        let regions = partition_cells_into_regions(&cells, 2, 1);
        assert_eq!(regions.len(), 2);
        let runs = boundary_runs(&cells, &regions);
        let shared_count = runs.iter().filter(|run| run.shared).count();
        assert_eq!(shared_count, 1, "expected exactly one shared run on the single interior split");
    }

    #[test]
    fn max_region_cells_one_never_merges_cells() {
        let cells: Vec<CellCoord> = (0..4).map(|x| CellCoord { x, z: 0 }).collect();
        let regions = partition_cells_into_regions(&cells, 1, 1);
        assert_eq!(regions.len(), 4, "every cell is its own region");
        assert!(regions.iter().all(|region| region.cells.len() == 1));
    }

    #[test]
    fn the_same_final_cell_set_produces_the_same_partition_regardless_of_input_order() {
        let cells: Vec<CellCoord> = (0..6).map(|x| CellCoord { x, z: 0 }).collect();
        let mut reversed = cells.clone();
        reversed.reverse();

        let a = partition_cells_into_regions(&cells, 2, 7);
        let b = partition_cells_into_regions(&reversed, 2, 7);

        let mut cells_a: Vec<_> = a.iter().flat_map(|region| region.cells.iter().copied()).collect();
        let mut cells_b: Vec<_> = b.iter().flat_map(|region| region.cells.iter().copied()).collect();
        cells_a.sort();
        cells_b.sort();
        assert_eq!(cells_a, cells_b);
        assert_eq!(a.len(), b.len());
    }

    #[test]
    fn an_l_shaped_region_does_not_lose_the_concave_corner_run() {
        // An L: (0,0),(1,0),(0,1) -- no cell at (1,1). High threshold so it
        // stays one region; the concave corner at (1,1) must still get
        // boundary runs on both of its exposed sides.
        let cells = [CellCoord { x: 0, z: 0 }, CellCoord { x: 1, z: 0 }, CellCoord { x: 0, z: 1 }];
        let regions = partition_cells_into_regions(&cells, 10, 1);
        assert_eq!(regions.len(), 1);
        let runs = boundary_runs(&cells, &regions);
        // Perimeter of an L-tromino is 8 unit edges, but the bottom pair and
        // the left pair each merge into one run (same line, same
        // shared-ness, contiguous span): 8 - 2 = 6 runs.
        assert_eq!(runs.len(), 6);
    }
}
