//! Step 1 (unconstrained) -- a hexagon filled with equilateral triangles.

use std::collections::HashMap;

use crate::mesh::{FaceMesh, Vec2, centroid_of};

const SQRT3_OVER_2: f64 = 0.866_025_403_784_438_6;

/// Options for [`build_triangle_hex`].
#[derive(Debug, Clone, Copy)]
pub struct TriangleHexOptions {
    /// Triangles along one hexagon edge. Sylves' walkthrough uses `4`.
    pub triangles_per_side: u32,
    /// Edge length of one equilateral triangle.
    pub triangle_side: f64,
}

impl Default for TriangleHexOptions {
    fn default() -> Self {
        Self { triangles_per_side: 4, triangle_side: 0.5 }
    }
}

/// A hexagon rather than a square because hexagons tile the plane while each
/// one stays a self-contained chunk, which is what later lets the grid extend
/// indefinitely with each chunk seeded from its own coordinates.
///
/// This is the *unconstrained* first stage, kept whole after the constrained
/// one arrived beside it: a stroke landing on empty ground has nothing to be
/// constrained by, and paying for a triangulation to discover that is waste.
/// [`crate::constrained`] is the same stage where something already stands.
pub fn build_triangle_hex(options: TriangleHexOptions) -> FaceMesh {
    let side = options.triangle_side;
    let per_side = options.triangles_per_side.max(1) as i64;

    let hex_radius = per_side as f64 * side;
    let apothem = hex_radius * SQRT3_OVER_2;

    // Lattice basis. `b` is 60 degrees from `a`, which is what makes every
    // lattice triangle equilateral.
    let ax = side;
    let bx = side / 2.0;
    let by = side * SQRT3_OVER_2;
    let position_at = |i: i64, j: i64| Vec2::new(i as f64 * ax + j as f64 * bx, j as f64 * by);

    let mut vertices: Vec<Vec2> = Vec::new();
    let mut index: HashMap<(i64, i64), usize> = HashMap::new();
    let mut vertex_at = |i: i64, j: i64, vertices: &mut Vec<Vec2>| -> usize {
        *index.entry((i, j)).or_insert_with(|| {
            vertices.push(position_at(i, j));
            vertices.len() - 1
        })
    };

    let mut faces: Vec<Vec<usize>> = Vec::new();
    let span = per_side + 1;
    for j in -span..=span {
        for i in -span..=span {
            // Each lattice cell holds one upward and one downward triangle.
            let upward = [(i, j), (i + 1, j), (i, j + 1)];
            let downward = [(i + 1, j), (i + 1, j + 1), (i, j + 1)];
            for corners in [upward, downward] {
                let points: Vec<Vec2> = corners.iter().map(|&(ci, cj)| position_at(ci, cj)).collect();
                if !inside_hexagon(centroid_of(&points), apothem) {
                    continue;
                }
                faces.push(
                    corners.iter().map(|&(ci, cj)| vertex_at(ci, cj, &mut vertices)).collect(),
                );
            }
        }
    }

    FaceMesh { vertices, faces }
}

/// A regular hexagon has three distinct edge normals, so three tests decide
/// containment rather than six.
fn inside_hexagon(point: Vec2, apothem: f64) -> bool {
    let epsilon = apothem * 1e-9;
    for angle in [
        std::f64::consts::FRAC_PI_6,
        std::f64::consts::FRAC_PI_2,
        5.0 * std::f64::consts::FRAC_PI_6,
    ] {
        let projection = (point.x * angle.cos() + point.y * angle.sin()).abs();
        if projection > apothem + epsilon {
            return false;
        }
    }
    true
}
