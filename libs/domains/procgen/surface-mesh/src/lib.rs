//! Turns a construction `Surface`'s node cycle -- an ordered ring of 3D
//! positions -- into a triangulated mesh. `grafting_graph_core::Surface`
//! deliberately does not compute this itself (see its module doc: "turning
//! that into geometry is the caller's job"); this crate is that caller. A
//! pure `positions -> mesh` function, with no dependency on graph-core's
//! storage, matching the isolation `terrain-generation`/`structure-generation`
//! already use for generation-only crates.
//!
//! `ADR-0022` requires arbitrary (not only convex/rectangular) polygon
//! support ("a hexagon, an irregular outline"), so triangulation uses the
//! `earcut` crate (ear-clipping, handles concave simple polygons) rather
//! than a fan, which only triangulates convex/star-shaped rings correctly.

use earcut::{utils3d, Earcut};

/// A triangulated mesh derived from one surface's node cycle. Vertices stay
/// in the caller-supplied cycle order (no Steiner points are introduced for
/// the simple, hole-free polygons this domain produces), so `indices`
/// reference the same order as the input `positions`.
#[derive(Debug, Clone, PartialEq)]
pub struct TriangulatedMesh {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub indices: Vec<u32>,
}

/// Triangulates a simple (hole-free) polygon given by `positions` -- an
/// ordered ring, e.g. `Surface::cycle()`'s node ids resolved to their
/// current graph positions. Returns `None` for fewer than 3 positions or a
/// degenerate (collinear/zero-area) ring; both are states a caller may see
/// transiently mid-edit, not error conditions to propagate.
pub fn triangulate_surface(positions: &[[f32; 3]]) -> Option<TriangulatedMesh> {
    if positions.len() < 3 {
        return None;
    }

    let mut projected: Vec<[f32; 2]> = Vec::new();
    if !utils3d::project3d_to_2d(positions, positions.len(), &mut projected) {
        return None;
    }

    let mut earcut = Earcut::new();
    let mut indices: Vec<u32> = Vec::new();
    earcut.earcut(projected, &[] as &[u32], &mut indices);
    if indices.is_empty() {
        return None;
    }

    let normal = face_normal(positions).unwrap_or([0.0, 0.0, 1.0]);
    Some(TriangulatedMesh {
        positions: positions.to_vec(),
        normals: vec![normal; positions.len()],
        indices,
    })
}

/// Flat face normal for shading: the first non-degenerate cross product
/// among triples anchored at `positions[0]`. `project3d_to_2d` already
/// proved the ring is not globally degenerate before this runs, so this is
/// just picking a representative triple, not re-deriving planarity.
fn face_normal(positions: &[[f32; 3]]) -> Option<[f32; 3]> {
    let origin = positions[0];
    for window in positions[1..].windows(2) {
        let cross = cross(sub(window[0], origin), sub(window[1], origin));
        let length = (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]).sqrt();
        if length > f32::EPSILON {
            return Some([cross[0] / length, cross[1] / length, cross[2] / length]);
        }
    }
    None
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fewer_than_three_positions_is_none() {
        assert_eq!(triangulate_surface(&[]), None);
        assert_eq!(triangulate_surface(&[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]]), None);
    }

    #[test]
    fn collinear_positions_are_none() {
        let collinear = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]];
        assert_eq!(triangulate_surface(&collinear), None);
    }

    #[test]
    fn triangle_produces_one_face() {
        let triangle = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let mesh = triangulate_surface(&triangle).expect("valid triangle");
        assert_eq!(mesh.positions, triangle);
        assert_eq!(mesh.normals.len(), 3);
        assert_eq!(mesh.indices.len(), 3);
        for normal in &mesh.normals {
            let length = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
            assert!((length - 1.0).abs() < 1e-4, "normal not unit length: {normal:?}");
        }
    }

    #[test]
    fn axis_aligned_quad_produces_two_faces() {
        let quad = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
        ];
        let mesh = triangulate_surface(&quad).expect("valid quad");
        assert_eq!(mesh.positions, quad);
        assert_eq!(mesh.indices.len(), 6, "two triangles = six indices");
        for normal in &mesh.normals {
            assert!(
                (normal[2].abs() - 1.0).abs() < 1e-4,
                "quad in the XY plane should have a Z-aligned normal, got {normal:?}"
            );
        }
    }

    #[test]
    fn concave_hexagon_triangulates_without_fan_artifacts() {
        // An "L"-shaped hexagon: convex fan triangulation from vertex 0
        // would produce a triangle crossing outside the polygon; earcut
        // must not.
        let hexagon = [
            [0.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [2.0, 1.0, 0.0],
            [1.0, 1.0, 0.0],
            [1.0, 2.0, 0.0],
            [0.0, 2.0, 0.0],
        ];
        let mesh = triangulate_surface(&hexagon).expect("valid concave hexagon");
        assert_eq!(mesh.positions, hexagon);
        // A simple hexagon triangulates into exactly 4 triangles (n - 2).
        assert_eq!(mesh.indices.len(), 12);
        for index in &mesh.indices {
            assert!((*index as usize) < hexagon.len());
        }
    }
}
