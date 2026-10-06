//! Ground at a face size: the one way every caller asks the constrained
//! generator for ground, so ground laid in the plane and ground laid in a
//! surface's own chart come out the same size and the same look.

use crate::constrained::{ConstrainedOptions, ConstraintPoint};
use crate::hex::{lattice_covering, lattice_triangle_area};
use crate::mesh::Vec2;
use crate::{ConstrainedQuadGrid, RelaxOptions, build_constrained_quad_grid};

/// How much wider the lattice triangle is than the face that descends from it.
///
/// Two stages sit in between. Pairing turns two triangles into one rhombus,
/// and the Conway ortho step cuts every cell into four, so four faces come out
/// of every two triangles: geometrically a face is `sqrt(sqrt(3) / 8)` of a
/// triangle side, about `0.47`. The refinement then adds its own points on top
/// of the seeded lattice, which makes the real result finer again -- measured
/// across four scales it settles at about a third rather than a half, and
/// stays there, which is why this is one measured constant rather than the
/// clean derivation.
///
/// The bridge's `a_face_comes_back_the_size_it_was_asked_for` is what holds it
/// honest; if the pipeline's stages ever change, that test moves this number.
pub const FACE_SIDE_TO_LATTICE_SIDE: f64 = 3.0;

/// How hard the refinement works; see [`ConstrainedOptions`] for each.
#[derive(Debug, Clone, Copy)]
pub struct GroundRefinement {
    pub min_angle_degrees: f64,
    pub max_additional_vertices: usize,
    /// The smallest triangle worth improving, as a share of the largest one
    /// allowed. See `ConstrainedOptions::min_area` for what it buys.
    pub min_area_ratio: f64,
}

impl Default for GroundRefinement {
    fn default() -> Self {
        Self { min_angle_degrees: 20.5, max_additional_vertices: 2_500, min_area_ratio: 0.25 }
    }
}

/// The box every supplied ring fits inside, which is what the seed lattice
/// has to cover. `None` where no ring holds a usable point.
fn bounds_of(rings: &[Vec<ConstraintPoint>]) -> Option<(Vec2, Vec2)> {
    let mut min = Vec2::new(f64::MAX, f64::MAX);
    let mut max = Vec2::new(f64::MIN, f64::MIN);
    let mut any = false;
    for point in rings.iter().flatten().map(|entry| entry.position) {
        if !point.x.is_finite() || !point.y.is_finite() {
            continue;
        }
        min = Vec2::new(min.x.min(point.x), min.y.min(point.y));
        max = Vec2::new(max.x.max(point.x), max.y.max(point.y));
        any = true;
    }
    if any { Some((min, max)) } else { None }
}

/// Ground enclosed by `boundary` and not taken back by `holes`, laid in
/// irregular cells about `face_side` wide.
pub fn ground_grid(
    boundary: Vec<Vec<ConstraintPoint>>,
    holes: Vec<Vec<ConstraintPoint>>,
    face_side: f64,
    seed: u32,
    refinement: &GroundRefinement,
    relax: &RelaxOptions,
) -> Result<ConstrainedQuadGrid, String> {
    if !(face_side > 0.0) {
        return Err("faceSide must be a positive number".to_string());
    }
    if boundary.iter().all(|ring| ring.len() < 3) {
        return Err("boundary needs at least one ring of three or more points".to_string());
    }
    let triangle_side = face_side * FACE_SIDE_TO_LATTICE_SIDE;
    let (min, max) = bounds_of(&boundary).ok_or("boundary holds no usable point")?;
    let options = ConstrainedOptions {
        seeds: lattice_covering(min, max, triangle_side),
        boundary,
        holes,
        seed_clearance: triangle_side * 0.25,
        max_area: lattice_triangle_area(triangle_side),
        min_area: lattice_triangle_area(triangle_side) * refinement.min_area_ratio,
        min_angle_degrees: refinement.min_angle_degrees,
        max_additional_vertices: refinement.max_additional_vertices,
    };
    build_constrained_quad_grid(&options, seed, relax).ok_or_else(|| "the supplied contours describe no ground that can be triangulated".to_string())
}
