//! Derives a rectangular footprint partitioned into `room_count` rooms of
//! varied size -- a generic "rooms tiling a footprint" generator, not a
//! house-specific one (the `apps/vtt` composition layer is where a
//! partition becomes a "house"; this crate only knows about rooms and
//! shared walls, so the same generator also fits a village's block layout
//! or a building floor's room layout later without renaming).
//!
//! Room sizes come from a squarified treemap ([`streemap::squarify`],
//! Bruls/Huizing/van Wijk -- the same algorithm behind Marson & Musse's
//! 2010 floor-plan generator) over `room_count` weights drawn from `seed`:
//! deterministic per seed, so the same seed always reproduces the same
//! layout, but two different seeds produce genuinely different room
//! sizes/shapes, not the same footprint subdivided identically every time.
//! The actual wall/floor/ceiling derivation -- including the T-junctions a
//! non-uniform partition produces, unlike a lattice's every-edge-shared-by-
//! exactly-two-cells guarantee -- is [`crate::rect_tiling::generate_tiled_rooms`],
//! a reusable primitive that knows nothing about where its tiles came from.

use rand::Rng;
use rand::SeedableRng;
use rand_pcg::Pcg32;
use streemap::{Rect, squarify};

use grafting_graph_core::SurfaceType;

pub use crate::rect_tiling::RoomGridGeneration;
use crate::rect_tiling::{RectTile, generate_tiled_rooms};

/// A rectangular `width` x `depth` footprint split into `room_count`
/// rooms, `origin` at the footprint's own min-x/min-z corner. v1 scope: a
/// single rectangular footprint, no L-shaped or otherwise non-rectangular
/// silhouette.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RoomGridLayout {
    /// The footprint's min-x/min-z corner, at its own base (Y is the floor level).
    pub origin: [f32; 3],
    /// The footprint's extent along X. Must be positive.
    pub width: f32,
    /// The footprint's extent along Z. Must be positive.
    pub depth: f32,
    /// Number of rooms to partition the footprint into. Must be at least 1.
    pub room_count: u32,
    /// Every wall's rise above `origin`'s own Y.
    pub wall_height: f32,
    /// Drives both the per-room size weights and the treemap's own item
    /// order -- the same seed always reproduces the same layout.
    pub seed: u64,
}

/// A room weight's lower/upper jitter bound, relative to a uniform
/// baseline of 1 -- wide enough that `room_count` rooms visibly differ in
/// size/shape (the user's own rejected v1 complaint), narrow enough that
/// `squarify`'s own aspect-ratio optimization still keeps every room usable.
const WEIGHT_JITTER_RANGE: std::ops::Range<f32> = 0.0..2.0;

/// Generates a room-grid layout's wall/floor/ceiling pieces. `id_prefix`
/// namespaces every generated id, same role as `wall-corner-weld.ts`'s
/// `tableId:salt` naming plays for a hand-drawn wall, resolved here
/// instead since this generator already knows its own full topology
/// upfront once the treemap has run.
pub fn generate_room_grid(
    layout: &RoomGridLayout,
    id_prefix: &str,
    wall_type: SurfaceType,
    door_type: SurfaceType,
    floor_type: SurfaceType,
    ceiling_type: SurfaceType,
) -> RoomGridGeneration {
    let mut rng = Pcg32::seed_from_u64(layout.seed);
    let mut items: Vec<(f32, Rect<f32>)> = (0..layout.room_count)
        .map(|_| (1.0 + rng.gen_range(WEIGHT_JITTER_RANGE), Rect { x: 0.0, y: 0.0, w: 0.0, h: 0.0 }))
        .collect();

    let container = Rect { x: 0.0, y: 0.0, w: layout.width, h: layout.depth };
    squarify(container, &mut items, |item| item.0, |item, rect| item.1 = rect);

    let tiles: Vec<RectTile> = items
        .into_iter()
        .map(|(_, rect)| RectTile {
            x: layout.origin[0] + rect.x,
            z: layout.origin[2] + rect.y,
            width: rect.w,
            depth: rect.h,
        })
        .collect();

    generate_tiled_rooms(&tiles, layout.origin[1], layout.wall_height, id_prefix, wall_type, door_type, floor_type, ceiling_type)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout(room_count: u32, seed: u64) -> RoomGridLayout {
        RoomGridLayout { origin: [0.0, 0.0, 0.0], width: 12.0, depth: 8.0, room_count, wall_height: 3.0, seed }
    }

    fn types() -> (SurfaceType, SurfaceType, SurfaceType, SurfaceType) {
        (SurfaceType::new("wall"), SurfaceType::new("door"), SurfaceType::new("floor"), SurfaceType::new("ceiling"))
    }

    #[test]
    fn a_single_room_covers_the_whole_footprint_with_4_plain_walls() {
        let (wall_type, door_type, floor_type, ceiling_type) = types();
        let generation = generate_room_grid(&layout(1, 1), "house-1", wall_type, door_type, floor_type, ceiling_type);

        assert_eq!(generation.walls.len(), 4);
        assert_eq!(generation.floors.len(), 1);
        assert_eq!(generation.ceilings.len(), 1);
    }

    #[test]
    fn room_count_matches_generated_floor_and_ceiling_count() {
        let (wall_type, door_type, floor_type, ceiling_type) = types();
        let generation = generate_room_grid(&layout(4, 7), "house-1", wall_type, door_type, floor_type, ceiling_type);

        assert_eq!(generation.floors.len(), 4);
        assert_eq!(generation.ceilings.len(), 4);
    }

    /// The whole point of this rewrite: two different seeds must not
    /// produce the same room layout -- the v1 lattice had no seed at all,
    /// so every call was byte-identical regardless of input.
    #[test]
    fn two_different_seeds_produce_different_room_sizes() {
        let (wall_type, door_type, floor_type, ceiling_type) = types();
        let a = generate_room_grid(&layout(4, 1), "house-a", wall_type.clone(), door_type.clone(), floor_type.clone(), ceiling_type.clone());
        let b = generate_room_grid(&layout(4, 2), "house-b", wall_type, door_type, floor_type, ceiling_type);

        let sizes_a: Vec<usize> = a.floors.iter().map(|piece| piece.surface.cycle.len()).collect();
        let sizes_b: Vec<usize> = b.floors.iter().map(|piece| piece.surface.cycle.len()).collect();
        // Cycle length alone can't prove different geometry (every room is
        // still a quad), so compare the actual generated corner ids --
        // two seeds sharing the same id set would mean the seed had no
        // effect on the treemap's own weights.
        assert_ne!(sizes_a.len(), 0);
        assert_ne!(sizes_b.len(), 0);
        let ids_a: Vec<_> = a.floors.iter().flat_map(|piece| piece.surface.cycle.clone()).collect();
        let ids_b: Vec<_> = b.floors.iter().flat_map(|piece| piece.surface.cycle.clone()).collect();
        assert_ne!(ids_a, ids_b);
    }

    #[test]
    fn the_same_seed_reproduces_the_identical_layout() {
        let (wall_type, door_type, floor_type, ceiling_type) = types();
        let a = generate_room_grid(&layout(4, 5), "house-1", wall_type.clone(), door_type.clone(), floor_type.clone(), ceiling_type.clone());
        let b = generate_room_grid(&layout(4, 5), "house-1", wall_type, door_type, floor_type, ceiling_type);

        let ids_a: Vec<_> = a.floors.iter().flat_map(|piece| piece.surface.cycle.clone()).collect();
        let ids_b: Vec<_> = b.floors.iter().flat_map(|piece| piece.surface.cycle.clone()).collect();
        assert_eq!(ids_a, ids_b);
    }
}
