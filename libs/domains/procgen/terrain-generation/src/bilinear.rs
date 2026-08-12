//! Bilinear mapping of a unit-cell point onto an irregular quad's 4 actual
//! corners, ported from
//! `apps/architecture-studio/src/vtt/module-placement.ts`'s
//! `interpolateEdge`/`interiorPoint`/`mapPoint`, generalized from that
//! prototype's 2D-plus-separate-height model to a single 3D point (since a
//! [`crate::generate::generate_terrain_cell_surface`] cell's corners are
//! already full 3D positions, not a flat quad with height layered on top).
//!
//! `P(u, v) = (1-u)(1-v)C0 + u(1-v)C1 + uv C2 + (1-u)v C3`, evaluated
//! component-wise. At an exact boundary (`u` or `v` at `0.0` or `1.0`) the
//! terms belonging to the two corners not on that boundary multiply out to
//! exactly `0.0`, and a term multiplying by exactly `1.0` is exact -- so a
//! boundary point already depends only on that edge's two corners, and a
//! corner point (`u`,`v` both `0.0`/`1.0`) is recovered exactly, with no
//! extra edge/corner branching needed to get that property (unlike the
//! ported TS, which special-cases boundaries explicitly). This is what lets
//! two adjacent `PrismGridMesh` cells sharing an edge agree along it with no
//! crack, whatever their other two corners do.

use crate::module::CORNER_COUNT;

/// A quad's 4 corners, in the same cyclic order
/// `grafting_graph_core::PrismGridMesh::cell_corners` already uses for one
/// ring: `[bottom-left, bottom-right, top-right, top-left]` in `(u, v)`
/// terms, i.e. `(0,0), (1,0), (1,1), (0,1)`.
pub type QuadCorners = [[f32; 3]; CORNER_COUNT];

/// Maps unit-cell point `(u, v)` onto `corners`, per the module doc's
/// bilinear formula. `u`/`v` are not clamped to `[0, 1]` -- a caller may
/// legitimately extrapolate past the quad's own edge.
pub fn bilinear_point(corners: QuadCorners, u: f32, v: f32) -> [f32; 3] {
    let weights = [
        (1.0 - u) * (1.0 - v),
        u * (1.0 - v),
        u * v,
        (1.0 - u) * v,
    ];
    let mut point = [0.0f32; 3];
    for (corner, weight) in corners.iter().zip(weights) {
        for axis in 0..3 {
            point[axis] += weight * corner[axis];
        }
    }
    point
}

#[cfg(test)]
mod tests {
    use super::*;

    fn irregular_quad() -> QuadCorners {
        // Deliberately non-planar-square, so a passing test cannot be an
        // accident of a degenerate (e.g. unit-square) fixture.
        [
            [0.0, 0.0, 0.0],
            [2.0, -0.5, 0.3],
            [1.8, 1.6, -0.2],
            [-0.3, 1.2, 0.1],
        ]
    }

    #[test]
    fn recovers_each_corner_exactly() {
        let corners = irregular_quad();
        let uv = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
        for (index, (u, v)) in uv.into_iter().enumerate() {
            assert_eq!(bilinear_point(corners, u, v), corners[index]);
        }
    }

    #[test]
    fn a_boundary_point_depends_only_on_that_edges_two_corners() {
        let corners = irregular_quad();
        // The bottom edge (v = 0) interpolates strictly between C0 and C1;
        // perturbing C2/C3 must not move a point on it.
        let mut perturbed = corners;
        perturbed[2] = [100.0, -100.0, 50.0];
        perturbed[3] = [-50.0, 200.0, -30.0];

        for tenths in 0..=10 {
            let u = tenths as f32 / 10.0;
            assert_eq!(bilinear_point(corners, u, 0.0), bilinear_point(perturbed, u, 0.0));
        }
    }

    #[test]
    fn interior_point_matches_hand_computed_value() {
        let corners = irregular_quad();
        let point = bilinear_point(corners, 0.5, 0.5);
        // (C0 + C1 + C2 + C3) / 4 at the exact center.
        let expected = [
            (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4.0,
            (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4.0,
            (corners[0][2] + corners[1][2] + corners[2][2] + corners[3][2]) / 4.0,
        ];
        for axis in 0..3 {
            assert!((point[axis] - expected[axis]).abs() < 1e-6);
        }
    }
}
