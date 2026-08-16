//! Derives shared walls, floors, and ceilings from an arbitrary set of
//! axis-aligned rectangles that tile a footprint exactly -- no gaps, no
//! overlaps. Generic on purpose: nothing here knows whether the tiles came
//! from a uniform lattice, a squarified treemap, or a hand-authored list,
//! so this is the reusable capability a village's block layout or a
//! building floor's room layout can share later without renaming, exactly
//! the same way [`crate::wall::generate_wall`] is shared by every wall
//! generator in this crate.
//!
//! Unlike a uniform lattice, an arbitrary tiling can put more than one
//! neighbor along a single wall's length -- e.g. one wide room bordering
//! two narrower rooms stacked beside it. This is a genuine T-junction, not
//! an edge case to special-case away: every interior wall line is swept
//! for the *coverage changes* on each side (a room starting or ending)
//! and split into one wall piece per maximal run where the pair of
//! neighboring rooms stays constant.

use std::collections::BTreeMap;

use grafting_graph_core::{NodeId, SurfaceSpec, SurfaceType};

use crate::wall::{DoorOpening, StructurePiece, WallNodeRole, WallSegment, generate_wall};

/// A generated tiling's pieces: one wall piece per maximal wall run (see
/// the module doc for why a run can be shorter than a whole tile edge),
/// and one floor + one ceiling piece per tile.
#[derive(Debug, Clone, PartialEq)]
pub struct RoomGridGeneration {
    /// Wall pieces, in sweep order (all vertical lines, then all horizontal lines).
    pub walls: Vec<StructurePiece>,
    /// One floor piece per tile, in input order.
    pub floors: Vec<StructurePiece>,
    /// One ceiling piece per tile, in input order.
    pub ceilings: Vec<StructurePiece>,
}

/// One rectangular room's footprint, in the tiling's own ground plane
/// (`x`/`z`, matching every other generator in this crate). `width` runs
/// along `x`, `depth` runs along `z`. Must not overlap any other tile in
/// the same call, and the full set must tile its bounding footprint with
/// no gaps -- both are the caller's responsibility (e.g. `streemap`'s own
/// contract), not validated here.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RectTile {
    /// This tile's minimum corner along X.
    pub x: f32,
    /// This tile's minimum corner along Z.
    pub z: f32,
    /// This tile's extent along X.
    pub width: f32,
    /// This tile's extent along Z.
    pub depth: f32,
}

impl RectTile {
    fn x1(&self) -> f32 {
        self.x + self.width
    }
    fn z1(&self) -> f32 {
        self.z + self.depth
    }
}

/// Half the generated interior door's width, as a fraction of its wall
/// segment -- same fixed/centered default as the uniform grid generator.
const DOOR_HALF_WIDTH: f32 = 0.1;

/// A wall segment shorter than this (world units) never gets a door, even
/// if it borders two different rooms -- a sliver produced by a T-junction
/// is too narrow for a sensible opening, so it stays a plain wall.
const MIN_DOOR_SEGMENT_WIDTH: f32 = 1.0;

/// Rounds a coordinate to millimeter precision before formatting it into
/// an id -- two tiles that are supposed to share a corner get the exact
/// same id even if the upstream layout computation left a sliver of
/// floating-point noise between them, without any runtime nearest-node
/// search (the tiling's topology is fully known upfront, same principle
/// as the uniform grid's `(row, col)` ids, just keyed on quantized
/// position instead of integer coordinates).
fn corner_id(id_prefix: &str, x: f32, z: f32, top: bool) -> NodeId {
    let end = if top { "top" } else { "bottom" };
    NodeId::new(format!("{id_prefix}:corner:{:.3}:{:.3}:{end}", x as f64, z as f64))
        .expect("formatted id is never empty")
}

/// Resolves one corner's id: `corner_override` first (a caller-supplied
/// weld -- e.g. `VTT-HOUSE-INCREMENTAL-EDIT`'s room-addition welding a new
/// tile's touching corners onto whatever nodes already exist at those
/// positions), the default position-derived id otherwise. Keeping the
/// override keyed on `(x, z, top)` rather than on the id this function
/// would otherwise produce means a caller never has to replicate this
/// crate's own id-formatting convention -- it only ever deals in
/// positions and pre-existing ids, the same shape `wall-corner-weld.ts`'s
/// live node query already produces.
fn resolve_corner_id(id_prefix: &str, x: f32, z: f32, top: bool, corner_override: &impl Fn(f32, f32, bool) -> Option<NodeId>) -> NodeId {
    corner_override(x, z, top).unwrap_or_else(|| corner_id(id_prefix, x, z, top))
}

fn corner_position(origin_y: f32, x: f32, z: f32) -> [f32; 3] {
    [x, origin_y, z]
}

/// A single swept wall line's neighbor pairing, broken at every point
/// where the room on either side starts or ends.
struct WallRun {
    from: f32,
    to: f32,
    /// Index into the tile slice for the room on the negative side (lower
    /// x for a vertical line, lower z for a horizontal line), if any.
    negative: Option<usize>,
    /// Index into the tile slice for the room on the positive side, if any.
    positive: Option<usize>,
}

/// Sweeps one fixed line (a vertical line at some `x`, or a horizontal
/// line at some `z`) and returns the wall runs along it, in order.
/// `along` extracts a tile's [start, end) interval along the swept
/// line's own direction (z-range for a vertical line, x-range for a
/// horizontal one). `negative_at`/`positive_at` report whether a tile
/// borders the line from the negative/positive side.
fn sweep_line(
    tiles: &[RectTile],
    negative_at: impl Fn(&RectTile) -> bool,
    positive_at: impl Fn(&RectTile) -> bool,
    along: impl Fn(&RectTile) -> (f32, f32),
) -> Vec<WallRun> {
    let mut breakpoints: Vec<f32> = Vec::new();
    for tile in tiles {
        if negative_at(tile) || positive_at(tile) {
            let (from, to) = along(tile);
            breakpoints.push(from);
            breakpoints.push(to);
        }
    }
    breakpoints.sort_by(|a, b| a.partial_cmp(b).expect("tile coordinates are always finite"));
    breakpoints.dedup_by(|a, b| (*a - *b).abs() < 1e-4);

    let mut runs = Vec::new();
    for window in breakpoints.windows(2) {
        let (from, to) = (window[0], window[1]);
        if to - from < 1e-4 {
            continue;
        }
        let mid = (from + to) / 2.0;
        let negative = tiles.iter().position(|tile| negative_at(tile) && covers(along(tile), mid));
        let positive = tiles.iter().position(|tile| positive_at(tile) && covers(along(tile), mid));
        if negative.is_none() && positive.is_none() {
            continue;
        }
        runs.push(WallRun { from, to, negative, positive });
    }
    runs
}

fn covers(interval: (f32, f32), value: f32) -> bool {
    interval.0 - 1e-4 <= value && value <= interval.1 + 1e-4
}

#[allow(clippy::too_many_arguments)]
fn generate_run_wall(
    id_prefix: &str,
    wall_height: f32,
    start: [f32; 3],
    end: [f32; 3],
    line_axis: &str,
    line_coordinate: f32,
    from: f32,
    to: f32,
    interior: bool,
    wall_type: &SurfaceType,
    door_type: &SurfaceType,
    corner_override: &impl Fn(f32, f32, bool) -> Option<NodeId>,
) -> Vec<StructurePiece> {
    let wall = WallSegment { start, end, height: wall_height };
    let long_enough_for_a_door = (to - from).abs() >= MIN_DOOR_SEGMENT_WIDTH;
    let door = (interior && long_enough_for_a_door)
        .then_some(DoorOpening { opens_at: 0.5 - DOOR_HALF_WIDTH, closes_at: 0.5 + DOOR_HALF_WIDTH });

    let node_id = |role: WallNodeRole| -> NodeId {
        match role {
            WallNodeRole::StartBottom => resolve_corner_id(id_prefix, start[0], start[2], false, corner_override),
            WallNodeRole::StartTop => resolve_corner_id(id_prefix, start[0], start[2], true, corner_override),
            WallNodeRole::EndBottom => resolve_corner_id(id_prefix, end[0], end[2], false, corner_override),
            WallNodeRole::EndTop => resolve_corner_id(id_prefix, end[0], end[2], true, corner_override),
            other => NodeId::new(format!(
                "{id_prefix}:jamb:{line_axis}:{line_coordinate:.3}:{from:.3}:{to:.3}:{other:?}"
            ))
            .expect("formatted id is never empty"),
        }
    };
    let edge_id = |from_role: WallNodeRole, to_role: WallNodeRole| {
        grafting_graph_core::EdgeId::new(format!(
            "{id_prefix}:edge:{line_axis}:{line_coordinate:.3}:{from:.3}:{to:.3}:{from_role:?}-{to_role:?}"
        ))
        .expect("formatted id is never empty")
    };

    let generation = generate_wall(&wall, door.as_ref(), node_id, edge_id, wall_type.clone(), door_type.clone())
        .expect("centered default door opening is always within bounds");
    generation.pieces
}

/// Derives every tile's wall/floor/ceiling pieces: one wall piece per
/// maximal run along every interior or perimeter line the tiling
/// produces (see the module doc for why a run can be shorter than a
/// whole tile edge), and one floor + one ceiling per tile. `corner_override`
/// lets a caller weld specific corners onto pre-existing node ids instead
/// of this crate's own position-derived default -- see
/// [`resolve_corner_id`]. Pass `|_, _, _| None` for the common case (a
/// fresh, unwelded tiling, e.g. `room_grid`'s whole-footprint generation).
pub fn generate_tiled_rooms(
    tiles: &[RectTile],
    origin_y: f32,
    wall_height: f32,
    id_prefix: &str,
    wall_type: SurfaceType,
    door_type: SurfaceType,
    floor_type: SurfaceType,
    ceiling_type: SurfaceType,
    corner_override: impl Fn(f32, f32, bool) -> Option<NodeId>,
) -> RoomGridGeneration {
    let mut walls = Vec::new();

    // Vertical lines (fixed x, running along z): every distinct x where a
    // tile starts or ends.
    let mut xs: BTreeMap<i64, f32> = BTreeMap::new();
    for tile in tiles {
        xs.insert((tile.x as f64 * 1000.0).round() as i64, tile.x);
        xs.insert((tile.x1() as f64 * 1000.0).round() as i64, tile.x1());
    }
    for &x in xs.values() {
        let runs = sweep_line(
            tiles,
            |tile| (tile.x1() - x).abs() < 1e-4,
            |tile| (tile.x - x).abs() < 1e-4,
            |tile| (tile.z, tile.z1()),
        );
        for run in runs {
            let interior = run.negative.is_some() && run.positive.is_some();
            walls.extend(generate_run_wall(
                id_prefix,
                wall_height,
                corner_position(origin_y, x, run.from),
                corner_position(origin_y, x, run.to),
                "x",
                x,
                run.from,
                run.to,
                interior,
                &wall_type,
                &door_type,
                &corner_override,
            ));
        }
    }

    // Horizontal lines (fixed z, running along x): every distinct z where
    // a tile starts or ends.
    let mut zs: BTreeMap<i64, f32> = BTreeMap::new();
    for tile in tiles {
        zs.insert((tile.z as f64 * 1000.0).round() as i64, tile.z);
        zs.insert((tile.z1() as f64 * 1000.0).round() as i64, tile.z1());
    }
    for &z in zs.values() {
        let runs = sweep_line(
            tiles,
            |tile| (tile.z1() - z).abs() < 1e-4,
            |tile| (tile.z - z).abs() < 1e-4,
            |tile| (tile.x, tile.x1()),
        );
        for run in runs {
            let interior = run.negative.is_some() && run.positive.is_some();
            walls.extend(generate_run_wall(
                id_prefix,
                wall_height,
                corner_position(origin_y, run.from, z),
                corner_position(origin_y, run.to, z),
                "z",
                z,
                run.from,
                run.to,
                interior,
                &wall_type,
                &door_type,
                &corner_override,
            ));
        }
    }

    let mut floors = Vec::with_capacity(tiles.len());
    let mut ceilings = Vec::with_capacity(tiles.len());
    for tile in tiles {
        let bottom_cycle = vec![
            resolve_corner_id(id_prefix, tile.x, tile.z, false, &corner_override),
            resolve_corner_id(id_prefix, tile.x1(), tile.z, false, &corner_override),
            resolve_corner_id(id_prefix, tile.x1(), tile.z1(), false, &corner_override),
            resolve_corner_id(id_prefix, tile.x, tile.z1(), false, &corner_override),
        ];
        let mut top_cycle = vec![
            resolve_corner_id(id_prefix, tile.x, tile.z, true, &corner_override),
            resolve_corner_id(id_prefix, tile.x1(), tile.z, true, &corner_override),
            resolve_corner_id(id_prefix, tile.x1(), tile.z1(), true, &corner_override),
            resolve_corner_id(id_prefix, tile.x, tile.z1(), true, &corner_override),
        ];
        top_cycle.reverse();
        floors.push(StructurePiece {
            nodes: Vec::new(),
            edges: Vec::new(),
            surface: SurfaceSpec { cycle: bottom_cycle, surface_type: floor_type.clone(), physical: true },
        });
        ceilings.push(StructurePiece {
            nodes: Vec::new(),
            edges: Vec::new(),
            surface: SurfaceSpec { cycle: top_cycle, surface_type: ceiling_type.clone(), physical: true },
        });
    }

    RoomGridGeneration { walls, floors, ceilings }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn types() -> (SurfaceType, SurfaceType, SurfaceType, SurfaceType) {
        (SurfaceType::new("wall"), SurfaceType::new("door"), SurfaceType::new("floor"), SurfaceType::new("ceiling"))
    }

    #[test]
    fn a_single_tile_has_4_plain_walls_and_one_floor_and_ceiling() {
        let (wall_type, door_type, floor_type, ceiling_type) = types();
        let tiles = [RectTile { x: 0.0, z: 0.0, width: 4.0, depth: 4.0 }];
        let generation = generate_tiled_rooms(&tiles, 0.0, 3.0, "house-1", wall_type, door_type, floor_type, ceiling_type, |_, _, _| None);

        assert_eq!(generation.walls.len(), 4);
        assert_eq!(generation.floors.len(), 1);
        assert_eq!(generation.ceilings.len(), 1);
    }

    #[test]
    fn two_side_by_side_tiles_share_the_interior_walls_corner_ids() {
        let (wall_type, door_type, floor_type, ceiling_type) = types();
        let tiles = [
            RectTile { x: 0.0, z: 0.0, width: 4.0, depth: 4.0 },
            RectTile { x: 4.0, z: 0.0, width: 4.0, depth: 4.0 },
        ];
        let generation =
            generate_tiled_rooms(&tiles, 0.0, 3.0, "house-1", wall_type, door_type, floor_type, ceiling_type, |_, _, _| None);

        let left_floor = &generation.floors[0].surface.cycle;
        let right_floor = &generation.floors[1].surface.cycle;
        assert!(left_floor.contains(&corner_id("house-1", 4.0, 0.0, false)));
        assert!(right_floor.contains(&corner_id("house-1", 4.0, 0.0, false)));
        assert!(left_floor.contains(&corner_id("house-1", 4.0, 4.0, false)));
        assert!(right_floor.contains(&corner_id("house-1", 4.0, 4.0, false)));

        // One shared interior wall (with a door, split into 3 pieces) plus
        // 3 perimeter pieces each for the two outer edges not shared by
        // both tiles (top, bottom, left, right) -- 3 (interior) + 6
        // (perimeter: left, right, and the top/bottom pair split at x=4) = 9.
        assert_eq!(generation.walls.len(), 9);
    }

    /// A wide tile spanning two narrower tiles stacked beside it -- the
    /// wide tile's one long edge must split into two wall runs (one per
    /// narrow neighbor), a genuine T-junction, not a lattice edge.
    #[test]
    fn a_t_junction_splits_the_wide_tiles_wall_into_two_runs() {
        let (wall_type, door_type, floor_type, ceiling_type) = types();
        let tiles = [
            RectTile { x: 0.0, z: 0.0, width: 4.0, depth: 8.0 },
            RectTile { x: 4.0, z: 0.0, width: 4.0, depth: 4.0 },
            RectTile { x: 4.0, z: 4.0, width: 4.0, depth: 4.0 },
        ];
        let generation =
            generate_tiled_rooms(&tiles, 0.0, 3.0, "house-1", wall_type, door_type, floor_type, ceiling_type, |_, _, _| None);

        // The shared line at x=4 must split into two wall runs at z=4 --
        // the wide tile's own rectangle has no corner there (its corners
        // are only at z=0 and z=8), so a node at (4, 4) only exists if the
        // sweep actually broke the line at the point where the narrow
        // tiles change, proving the T-junction was detected rather than
        // the wide tile's whole edge being treated as one uninterrupted run.
        let midpoint_id = corner_id("house-1", 4.0, 4.0, false);
        let has_midpoint_node = generation.walls.iter().any(|piece| piece.nodes.iter().any(|node| *node.id() == midpoint_id));
        assert!(has_midpoint_node, "expected a wall node at the T-junction midpoint (4, 4)");
    }

    #[test]
    fn a_short_interior_run_gets_no_door() {
        let (wall_type, door_type, floor_type, ceiling_type) = types();
        // Two tiles sharing a sliver of a boundary shorter than
        // `MIN_DOOR_SEGMENT_WIDTH` must not generate a door piece there.
        let tiles = [
            RectTile { x: 0.0, z: 0.0, width: 4.0, depth: 0.5 },
            RectTile { x: 4.0, z: 0.0, width: 4.0, depth: 0.5 },
        ];
        let generation =
            generate_tiled_rooms(&tiles, 0.0, 3.0, "house-1", wall_type, door_type, floor_type, ceiling_type, |_, _, _| None);
        assert!(generation.walls.iter().all(|piece| piece.surface.surface_type != SurfaceType::new("door")));
    }
}
