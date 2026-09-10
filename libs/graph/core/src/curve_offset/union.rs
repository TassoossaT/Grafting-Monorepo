//! Boolean contour union and hole-aware triangulation.
use super::types::{Point, Polygon, TriangulatedMesh};
use earcut::Earcut;

/// Unions oriented outer rings and holes, preserving the resulting holes.
pub fn union_polygons(polygons: &[Polygon]) -> Vec<Polygon> {
    let contours: Vec<Vec<Vec<Point>>> = polygons
        .iter()
        .map(|p| {
            std::iter::once(p.outer.clone())
                .chain(p.holes.iter().cloned())
                .collect()
        })
        .collect();
    if contours.is_empty() {
        return Vec::new();
    }
    crate::planar_boolean(&contours, &[], crate::PlanarBoolean::Union)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|shape| {
            let mut rings = shape.into_iter();
            let outer = rings.next()?;
            if outer.len() < 3 {
                return None;
            }
            Some(Polygon {
                outer,
                holes: rings.collect(),
            })
        })
        .collect()
}
/// Unions contours and triangulates their interiors, leaving holes empty.
pub fn union_and_triangulate(polygons: &[Polygon]) -> TriangulatedMesh {
    let mut positions = Vec::new();
    let mut indices = Vec::new();
    for shape in union_polygons(polygons) {
        let mut ring = shape.outer;
        let mut holes = Vec::new();
        for hole in shape.holes {
            holes.push(ring.len() as u32);
            ring.extend(hole);
        }
        let mut local = Vec::new();
        Earcut::new().earcut(ring.clone(), &holes, &mut local);
        let base = positions.len() as u32;
        positions.extend(ring);
        indices.extend(local.into_iter().map(|i| i + base));
    }
    TriangulatedMesh { positions, indices }
}
