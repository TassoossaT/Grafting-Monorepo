//! Boolean union of arbitrarily many polygons, triangulated in one pass.

use earcut::Earcut;
use i_overlay::core::fill_rule::FillRule;
use i_overlay::float::simplify::SimplifyShape;

use crate::types::{Point, Polygon, TriangulatedMesh};

/// Unions every polygon's outer ring and holes together (`FillRule::NonZero`,
/// the same rule `grafting-procgen-surface-transformations`'s
/// `union_stroke_footprint` already uses for brush strokes) and triangulates
/// each resulting shape with `earcut` -- the same crate
/// `grafting-procgen-surface-mesh` already triangulates simple planar rings
/// with. A T, an X, or an L of overlapping bands all fall out of this one
/// call with no per-topology branch: the union either merges two bands into
/// one face or it doesn't, and both are the same code path.
pub fn union_and_triangulate(polygons: &[Polygon]) -> TriangulatedMesh {
    let contours: Vec<Vec<Point>> = polygons
        .iter()
        .flat_map(|polygon| std::iter::once(polygon.outer.clone()).chain(polygon.holes.iter().cloned()))
        .collect();
    if contours.is_empty() {
        return TriangulatedMesh::default();
    }

    let union = contours.simplify_shape(FillRule::NonZero);

    let mut positions = Vec::new();
    let mut indices = Vec::new();
    for shape in union {
        let mut rings = shape.into_iter();
        let Some(outer) = rings.next() else { continue };
        if outer.len() < 3 {
            continue;
        }
        let holes: Vec<Vec<Point>> = rings.collect();
        let mut ring = outer;
        let mut hole_indices = Vec::new();
        for hole in &holes {
            hole_indices.push(ring.len() as u32);
            ring.extend(hole.iter().copied());
        }
        let mut local_indices = Vec::new();
        let mut earcut = Earcut::new();
        earcut.earcut(ring.clone(), &hole_indices, &mut local_indices);
        let base = positions.len() as u32;
        positions.extend(ring);
        indices.extend(local_indices.into_iter().map(|index| index + base));
    }
    TriangulatedMesh { positions, indices }
}
