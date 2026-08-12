//! A terrain module's corner-height profile, and how a solved rotation
//! applies to it. Ported from
//! `apps/architecture-studio/src/vtt/terrain-modules.ts`'s
//! `ModuleShape::CornerHeights` variant and `rotateUnitCell`.
//!
//! V1 scope: only the flat corner-height profile is implemented -- a
//! module gives a height at each of a cell's 4 corners, and the top
//! surface between them is what [`crate::generate::generate_terrain_cell_surface`]
//! derives. The TS prototype's `ModuleShape::Mesh` variant (arbitrary
//! authored unit-cell geometry, e.g. for an overhang or a closed box) is a
//! deliberate, documented follow-up -- [`crate::bilinear_point`] exists as
//! tested infrastructure for it, not called from this module yet.

/// How many corners a module gives a height for -- matches
/// `grafting_graph_core::PrismGridMesh`'s 4-corner ring per layer, and
/// `terrain-modules.ts`'s `MODULE_CORNERS`.
pub const CORNER_COUNT: usize = 4;

/// A flat corner-height terrain module: a top surface at 4 corner heights,
/// per `terrain-modules.ts`'s doc comment ("A flat top is `[1, 1, 1, 1]`; a
/// ramp is `[1, 1, 0, 0]`").
#[derive(Debug, Clone, PartialEq)]
pub struct CornerHeightModule {
    /// Caller-facing identity, matching
    /// `grafting_procgen_tileset_wfc::Module::name` -- how a caller maps a
    /// solved `ModuleId` back to this module's geometry. Not interpreted by
    /// this crate.
    pub name: String,
    /// Fraction of the cell's own vertical extent, one per corner, in
    /// `PrismGridMesh::cell_corners`' cyclic order: `0.0` sits at that
    /// corner slot's bottom-ring position, `1.0` at its top-ring position.
    /// Not clamped to `[0, 1]` -- a module may legitimately extrapolate
    /// past the cell's own height (an overhanging cliff face, for
    /// instance).
    pub corner_heights: [f32; CORNER_COUNT],
}

/// Applies a solved rotation to a corner-height profile.
///
/// Ported from `rotateUnitCell`, specialized to the 4 exact corner points:
/// one turn moves the unit cell's corner `i` to where corner `i + 1` was
/// (`(0,0) -> (1,0) -> (1,1) -> (0,1) -> (0,0)`, matching
/// `PrismGridMesh::cell_corners`' own `[bottom-left, bottom-right,
/// top-right, top-left]` order), so the height that was at slot `i` before
/// rotation ends up at slot `i + 1` after -- a `rotate_right` by `turns`,
/// verified by hand against `terrain-modules.ts::moduleMesh`'s per-corner
/// loop. `turns` wraps at 4, matching
/// `grafting_procgen_tileset_wfc::rotation::ModuleOrigin::turns`'s own
/// convention (one turn per quarter rotation).
pub fn rotate_corner_heights(heights: [f32; CORNER_COUNT], turns: usize) -> [f32; CORNER_COUNT] {
    let mut rotated = heights;
    rotated.rotate_right(turns % CORNER_COUNT);
    rotated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_turns_is_identity() {
        let heights = [1.0, 2.0, 3.0, 4.0];
        assert_eq!(rotate_corner_heights(heights, 0), heights);
    }

    #[test]
    fn one_turn_moves_each_height_to_the_next_slot() {
        assert_eq!(rotate_corner_heights([1.0, 2.0, 3.0, 4.0], 1), [4.0, 1.0, 2.0, 3.0]);
    }

    #[test]
    fn every_turn_count_matches_hand_derived_permutation() {
        let heights = [1.0, 2.0, 3.0, 4.0];
        assert_eq!(rotate_corner_heights(heights, 2), [3.0, 4.0, 1.0, 2.0]);
        assert_eq!(rotate_corner_heights(heights, 3), [2.0, 3.0, 4.0, 1.0]);
    }

    #[test]
    fn four_turns_equals_zero_turns() {
        let heights = [1.0, 2.0, 3.0, 4.0];
        assert_eq!(rotate_corner_heights(heights, 4), rotate_corner_heights(heights, 0));
        assert_eq!(rotate_corner_heights(heights, 7), rotate_corner_heights(heights, 3));
    }
}
