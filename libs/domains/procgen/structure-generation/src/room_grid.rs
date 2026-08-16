//! Derives a rectangular grid of walled cells sharing interior walls -- a
//! generic "rooms in a grid" generator, not a house-specific one (the
//! `apps/vtt` composition layer is where a grid becomes a "house"; this
//! crate only knows about cells and shared walls, so the same generator
//! also fits a village's block layout or a building floor's room layout
//! later without renaming).
//!
//! Each grid line segment between two adjacent corners is generated exactly
//! once via [`generate_wall`], not once per bordering cell -- an interior
//! segment (shared by two cells) gets a door, a perimeter segment does not.
//! Every corner touched by at least one wall (true for every corner in a
//! grid with at least 1 row and 1 column) is named deterministically from
//! its own row/column, so two cells sharing an edge share that edge's
//! corner node ids by construction, without any runtime nearest-node search
//! -- unlike `wall-corner-weld.ts`'s freehand weld, this generator already
//! knows its own topology upfront.

use grafting_graph_core::{EdgeId, NodeId, SurfaceSpec, SurfaceType};

use crate::wall::{DoorOpening, StructurePiece, WallNodeRole, WallSegment, generate_wall};

/// A rectangular grid of `rows` x `cols` uniform-size cells, `origin` at the
/// grid's own row-0/col-0 corner. v1 scope: uniform cell size, no L-shaped
/// or otherwise non-rectangular footprints.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RoomGridLayout {
    /// The grid's row-0/col-0 corner, at its own base (Y is the grid's floor level).
    pub origin: [f32; 3],
    /// Number of cells along Z. Must be at least 1 for a non-empty grid.
    pub rows: u32,
    /// Number of cells along X. Must be at least 1 for a non-empty grid.
    pub cols: u32,
    /// One cell's width along X.
    pub cell_width: f32,
    /// One cell's depth along Z.
    pub cell_depth: f32,
    /// Every wall's rise above `origin`'s own Y.
    pub wall_height: f32,
}

/// A generated grid's pieces: one wall piece per unique grid edge (interior
/// edges carry a door, perimeter edges do not), and one floor + one ceiling
/// piece per cell. Floor/ceiling pieces carry no new nodes/edges of their
/// own -- their cycles reference corner nodes the wall pieces already add.
#[derive(Debug, Clone, PartialEq)]
pub struct RoomGridGeneration {
    /// Wall pieces, in row-major grid-line order (all horizontal lines, then all vertical lines).
    pub walls: Vec<StructurePiece>,
    /// One floor piece per cell, in row-major cell order.
    pub floors: Vec<StructurePiece>,
    /// One ceiling piece per cell, in row-major cell order.
    pub ceilings: Vec<StructurePiece>,
}

/// Half the generated interior door's width, as a fraction of its wall
/// segment -- deliberately fixed/centered (not seeded/randomized like
/// `room-seed.ts`'s own standalone-room door), since a grid interior wall's
/// door only needs to exist, not vary; per-door placement is a documented
/// follow-up if wanted.
const DOOR_HALF_WIDTH: f32 = 0.1;

fn corner_id(id_prefix: &str, row: u32, col: u32, top: bool) -> NodeId {
    let end = if top { "top" } else { "bottom" };
    NodeId::new(format!("{id_prefix}:corner:{row}:{col}:{end}")).expect("formatted id is never empty")
}

fn corner_position(layout: &RoomGridLayout, row: u32, col: u32) -> [f32; 3] {
    [
        layout.origin[0] + col as f32 * layout.cell_width,
        layout.origin[1],
        layout.origin[2] + row as f32 * layout.cell_depth,
    ]
}

/// Generates the wall segment between grid corners `(row_a, col_a)` and
/// `(row_b, col_b)` -- 1 piece if `interior` is false (a plain wall), or 3
/// if true (a wall with a centered door, split into left remainder / door /
/// right remainder, same as any other doored wall in this crate). Every id
/// (corner or door-jamb node, ring edge) is a pure function of this wall's
/// own identity `(row_a, col_a, row_b, col_b)` plus the role/role-pair
/// asking for it -- required for jamb nodes specifically, since
/// `generate_wall`'s `node_id` closure is called once per piece that shares
/// a given role (e.g. `DoorStartBottom` is asked for by both the left
/// remainder and the door piece) and must return the *same* id each time,
/// not a fresh one -- a plain incrementing counter would silently mint two
/// ids for what should be one shared jamb node.
fn generate_grid_wall(
    layout: &RoomGridLayout,
    id_prefix: &str,
    row_a: u32,
    col_a: u32,
    row_b: u32,
    col_b: u32,
    interior: bool,
    wall_type: &SurfaceType,
    door_type: &SurfaceType,
) -> Vec<StructurePiece> {
    let wall = WallSegment {
        start: corner_position(layout, row_a, col_a),
        end: corner_position(layout, row_b, col_b),
        height: layout.wall_height,
    };
    let door = interior.then_some(DoorOpening { opens_at: 0.5 - DOOR_HALF_WIDTH, closes_at: 0.5 + DOOR_HALF_WIDTH });

    let node_id = |role: WallNodeRole| -> NodeId {
        match role {
            WallNodeRole::StartBottom => corner_id(id_prefix, row_a, col_a, false),
            WallNodeRole::StartTop => corner_id(id_prefix, row_a, col_a, true),
            WallNodeRole::EndBottom => corner_id(id_prefix, row_b, col_b, false),
            WallNodeRole::EndTop => corner_id(id_prefix, row_b, col_b, true),
            other => NodeId::new(format!("{id_prefix}:jamb:{row_a}:{col_a}:{row_b}:{col_b}:{other:?}"))
                .expect("formatted id is never empty"),
        }
    };
    let edge_id = |from: WallNodeRole, to: WallNodeRole| -> EdgeId {
        EdgeId::new(format!("{id_prefix}:edge:{row_a}:{col_a}:{row_b}:{col_b}:{from:?}-{to:?}"))
            .expect("formatted id is never empty")
    };

    // A centered [0.5 - DOOR_HALF_WIDTH, 0.5 + DOOR_HALF_WIDTH] opening is
    // always within [0, 1] with opens_at < closes_at -- cannot fail; see
    // `generate_wall`'s own validation.
    let generation = generate_wall(&wall, door.as_ref(), node_id, edge_id, wall_type.clone(), door_type.clone())
        .expect("centered default door opening is always within bounds");
    generation.pieces
}

/// Generates a room grid's wall/floor/ceiling pieces. `id_prefix`
/// namespaces every generated id (corners, door jambs, ring edges) so two
/// calls -- or this call and any other generator's -- never collide; the
/// same role `wall-corner-weld.ts`'s `tableId:salt` naming plays for a
/// hand-drawn wall, just resolved here instead of by a caller-supplied map,
/// since this generator already knows its own full topology upfront.
pub fn generate_room_grid(
    layout: &RoomGridLayout,
    id_prefix: &str,
    wall_type: SurfaceType,
    door_type: SurfaceType,
    floor_type: SurfaceType,
    ceiling_type: SurfaceType,
) -> RoomGridGeneration {
    let mut walls = Vec::new();

    // Horizontal grid lines (running along X): between corner (r, c) and
    // (r, c + 1), for every row r in 0..=rows and column c in 0..cols.
    // Interior exactly when the row is strictly between the grid's own
    // north/south edges.
    for row in 0..=layout.rows {
        let interior = row > 0 && row < layout.rows;
        for col in 0..layout.cols {
            walls.extend(generate_grid_wall(layout, id_prefix, row, col, row, col + 1, interior, &wall_type, &door_type));
        }
    }
    // Vertical grid lines (running along Z): between corner (r, c) and
    // (r + 1, c), for every column c in 0..=cols and row r in 0..rows.
    for col in 0..=layout.cols {
        let interior = col > 0 && col < layout.cols;
        for row in 0..layout.rows {
            walls.extend(generate_grid_wall(layout, id_prefix, row, col, row + 1, col, interior, &wall_type, &door_type));
        }
    }

    // One floor + one ceiling per cell, referencing the same corner ids the
    // walls above already add -- every corner in a >=1x1 grid is touched by
    // at least one wall, so no new nodes are needed here.
    let cell_count = (layout.rows * layout.cols) as usize;
    let mut floors = Vec::with_capacity(cell_count);
    let mut ceilings = Vec::with_capacity(cell_count);
    for row in 0..layout.rows {
        for col in 0..layout.cols {
            let bottom_cycle = vec![
                corner_id(id_prefix, row, col, false),
                corner_id(id_prefix, row, col + 1, false),
                corner_id(id_prefix, row + 1, col + 1, false),
                corner_id(id_prefix, row + 1, col, false),
            ];
            let mut top_cycle = vec![
                corner_id(id_prefix, row, col, true),
                corner_id(id_prefix, row, col + 1, true),
                corner_id(id_prefix, row + 1, col + 1, true),
                corner_id(id_prefix, row + 1, col, true),
            ];
            // The ceiling is the same vertical loop as the floor, viewed
            // from above -- needs the opposite winding to keep its normal
            // facing outward (down into the room), mirroring
            // `room-derive-tool.ts`'s own floor/ceiling pairing.
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
    }

    RoomGridGeneration { walls, floors, ceilings }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout(rows: u32, cols: u32) -> RoomGridLayout {
        RoomGridLayout { origin: [0.0, 0.0, 0.0], rows, cols, cell_width: 4.0, cell_depth: 4.0, wall_height: 3.0 }
    }

    fn types() -> (SurfaceType, SurfaceType, SurfaceType, SurfaceType) {
        (SurfaceType::new("wall"), SurfaceType::new("door"), SurfaceType::new("floor"), SurfaceType::new("ceiling"))
    }

    #[test]
    fn a_single_cell_has_4_plain_walls_and_one_floor_and_ceiling() {
        let (wall_type, door_type, floor_type, ceiling_type) = types();
        let generation = generate_room_grid(&layout(1, 1), "house-1", wall_type, door_type, floor_type, ceiling_type);

        assert_eq!(generation.walls.len(), 4);
        for piece in &generation.walls {
            assert_eq!(piece.surface.surface_type, SurfaceType::new("wall"));
        }
        assert_eq!(generation.floors.len(), 1);
        assert_eq!(generation.ceilings.len(), 1);
        assert_eq!(generation.floors[0].surface.cycle.len(), 4);
        assert_eq!(generation.ceilings[0].surface.cycle.len(), 4);
    }

    #[test]
    fn a_2x1_grid_shares_the_interior_walls_corner_ids_between_both_cells() {
        let (wall_type, door_type, floor_type, ceiling_type) = types();
        let generation = generate_room_grid(&layout(1, 2), "house-1", wall_type, door_type, floor_type, ceiling_type);

        // 3 vertical lines (col 0, 1, 2) x 1 row + 2 horizontal lines (row 0, 1) x 2 cols,
        // with the interior vertical line (col 1) split into 3 pieces by its door.
        // col 0 (perimeter): 1 piece, col 1 (interior): 3 pieces, col 2 (perimeter): 1 piece,
        // row 0: 2 pieces, row 1: 2 pieces => 1+3+1+2+2 = 9.
        assert_eq!(generation.walls.len(), 9);

        let left_floor = &generation.floors[0].surface.cycle;
        let right_floor = &generation.floors[1].surface.cycle;
        // The shared edge between the two cells is corners (0,1) and (1,1) --
        // both floors must reference the exact same node ids there, not two
        // different ones, proving the interior wall is genuinely shared.
        assert!(left_floor.contains(&corner_id("house-1", 0, 1, false)));
        assert!(right_floor.contains(&corner_id("house-1", 0, 1, false)));
        assert!(left_floor.contains(&corner_id("house-1", 1, 1, false)));
        assert!(right_floor.contains(&corner_id("house-1", 1, 1, false)));
    }

    #[test]
    fn every_grid_corner_position_is_where_row_col_math_says_it_should_be() {
        let generated = corner_position(&layout(2, 2), 1, 1);
        assert_eq!(generated, [4.0, 0.0, 4.0]);
    }
}
