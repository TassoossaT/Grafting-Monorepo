//! The plane primitives every stage of the pipeline shares.
//!
//! One module rather than a copy wherever one was needed. There are already
//! four hand-rolled point-in-polygon tests across this workspace
//! (`surface-mesh::math::point_in_loop_xz`,
//! `surface-transformations::point_in_footprint`, and the two the TypeScript
//! side keeps), and adding a fifth scattered across this crate is how that
//! happens again.
//!
//! **Why these are not simply the existing ones.** Every primitive already in
//! the workspace is `f32`, and this crate cannot be. Two independent reasons:
//! spade decides face orientation with exact predicates over `f64`, which is
//! the entire robustness argument for using it; and the parity fixture holds
//! the TypeScript generator own output, where every number was a `f64`, so a
//! single `f32` rounding anywhere in the pipeline breaks bit-exactness with
//! ground already saved in real tables.
//!
//! Consolidating these with their `f32` cousins therefore means making the
//! others generic over the scalar, which is a workspace-wide change and does
//! not belong to the terrain work. Kept together and named here so that
//! refactor has one place to come and take them from.

use crate::mesh::Vec2;

/// The average of a set of points.
pub fn centroid_of(points: &[Vec2]) -> Vec2 {
    let mut x = 0.0;
    let mut y = 0.0;
    for point in points {
        x += point.x;
        y += point.y;
    }
    let count = points.len() as f64;
    Vec2::new(x / count, y / count)
}

/// Twice the signed area of the triangle `a b c` -- positive counter-clockwise.
///
/// Only ever read for its sign here, to normalise winding. This is a plain
/// float determinant and not an exact predicate on purpose: spade has already
/// decided the topology by the time anything in this crate looks at winding,
/// so a wrong answer on a triangle of near-zero area costs a face that carries
/// no ground either way.
pub fn signed_area(a: Vec2, b: Vec2, c: Vec2) -> f64 {
    (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
}

/// Even-odd containment against one closed ring.
pub fn inside_ring(ring: &[Vec2], point: Vec2) -> bool {
    if ring.len() < 3 {
        return false;
    }
    let mut inside = false;
    let mut previous = ring[ring.len() - 1];
    for &current in ring {
        let straddles = (current.y > point.y) != (previous.y > point.y);
        if straddles {
            let crossing =
                (previous.x - current.x) * (point.y - current.y) / (previous.y - current.y)
                    + current.x;
            if point.x < crossing {
                inside = !inside;
            }
        }
        previous = current;
    }
    inside
}

/// Shortest distance from `point` to the finite segment `from`-`to`.
pub fn distance_to_segment(point: Vec2, from: Vec2, to: Vec2) -> f64 {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    let length_squared = dx * dx + dy * dy;
    let t = if length_squared <= f64::EPSILON {
        0.0
    } else {
        (((point.x - from.x) * dx + (point.y - from.y) * dy) / length_squared).clamp(0.0, 1.0)
    };
    let nearest_x = from.x + t * dx;
    let nearest_y = from.y + t * dy;
    ((point.x - nearest_x).powi(2) + (point.y - nearest_y).powi(2)).sqrt()
}
