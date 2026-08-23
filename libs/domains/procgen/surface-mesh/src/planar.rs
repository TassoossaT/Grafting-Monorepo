//! Planar surface triangulation via best-fit plane projection and earcut.

use earcut::{Earcut, utils3d};

use crate::math::face_normal;
use crate::types::TriangulatedMesh;

/// Triangulates a planar surface consisting of an outer boundary loop and
/// optional hole loops.
pub fn triangulate_contour_loops<'a>(
    outer: &[[f32; 3]],
    holes: impl IntoIterator<Item = &'a Vec<[f32; 3]>>,
) -> Option<TriangulatedMesh> {
    if outer.len() < 3 {
        return None;
    }
    let mut positions = outer.to_vec();
    let mut hole_indices = Vec::new();
    for hole in holes {
        if hole.len() < 3 {
            return None;
        }
        hole_indices.push(positions.len() as u32);
        positions.extend(hole.iter().copied());
    }
    // This is the path for a face that really does lie on a plane, so the
    // ring's own best-fit plane is the right place to flatten it: for an
    // XZ-planar region (terrain, a path-brush stroke) that plane already is
    // XZ. An upright face never reaches here -- it is unrolled instead, by
    // `upright_face_mesh`, because a curved one lies on no plane at all.
    let mut projected: Vec<[f32; 2]> = Vec::new();
    if !utils3d::project3d_to_2d(&positions, positions.len(), &mut projected) {
        return None;
    }
    let mut earcut = Earcut::new();
    let mut indices = Vec::new();
    earcut.earcut(projected, &hole_indices, &mut indices);
    // World `xz` rather than the best-fit basis just used for triangulation:
    // that basis is whatever the ring's own fit produced, so it can rotate or
    // flip between two rebuilds of the same face and would slide the pattern
    // sitting on it. World `xz` is fixed once for the entire map, which makes
    // every horizontal face agree with every other one without any of them
    // knowing about the others.
    //
    // A face tilted off horizontal foreshortens under this, since `xz` is its
    // shadow rather than its surface. Nothing produces one today -- upright
    // faces unroll instead, and everything left is XZ-planar -- and a real
    // tilted case wants the plane's own basis anchored to something stable,
    // which is a frame that does not exist yet rather than a fix to this one.
    let uvs = positions.iter().map(|point| [point[0], point[2]]).collect();
    (!indices.is_empty()).then(|| TriangulatedMesh {
        normals: vec![face_normal(outer).unwrap_or([0.0, 1.0, 0.0]); positions.len()],
        positions,
        uvs,
        indices,
    })
}
