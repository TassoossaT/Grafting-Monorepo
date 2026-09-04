//! Step 2 -- randomly merge adjacent triangles into rhombi.

use std::collections::HashMap;

use crate::mesh::{Face, FaceMesh, edge_key, edges_of};
use crate::random::Random;

/// This is the step that makes the result irregular, and it is purely
/// aesthetic: whatever stays unpaired is handled by [`crate::ortho::ortho`]
/// anyway. The matching is greedy over a shuffled order, which leaves some
/// triangles unpaired by construction -- that variation is the point, so no
/// attempt is made to maximise the matching.
pub fn pair_triangles(mesh: &FaceMesh, random: &mut Random) -> FaceMesh {
    let mut edge_owners: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    for (face_index, face) in mesh.faces.iter().enumerate() {
        for (a, b) in edges_of(face) {
            edge_owners.entry(edge_key(a, b)).or_default().push(face_index);
        }
    }

    let mut merged = vec![false; mesh.faces.len()];
    let mut faces: Vec<Face> = Vec::new();

    for face_index in random.shuffled_indices(mesh.faces.len()) {
        if merged[face_index] {
            continue;
        }
        let face = &mesh.faces[face_index];

        let mut candidates = edges_of(face);
        random.shuffle(&mut candidates);

        let partner = candidates.into_iter().find_map(|(a, b)| {
            edge_owners
                .get(&edge_key(a, b))
                .and_then(|owners| {
                    owners.iter().find(|&&candidate| candidate != face_index && !merged[candidate])
                })
                .map(|&other| (other, (a, b)))
        });

        match partner {
            None => {
                merged[face_index] = true;
                faces.push(face.clone());
            }
            Some((other, shared)) => {
                merged[face_index] = true;
                merged[other] = true;
                faces.push(merge_across_edge(face, &mesh.faces[other], shared));
            }
        }
    }

    FaceMesh { vertices: mesh.vertices.clone(), faces }
}

/// Joins two triangles sharing an edge into one four-sided face.
///
/// Walks the first triangle from its unshared vertex and substitutes the
/// other triangle's unshared vertex for the shared edge, which preserves
/// winding -- a merged face with reversed winding would survive
/// quadrangulation and only surface later as a backwards-facing cell.
fn merge_across_edge(a: &[usize], b: &[usize], shared: (usize, usize)) -> Face {
    let unshared = |face: &[usize]| {
        face.iter().copied().find(|&vertex| vertex != shared.0 && vertex != shared.1)
    };
    let (Some(apex), Some(opposite)) = (unshared(a), unshared(b)) else {
        return a.to_vec();
    };

    // Order the shared pair as the first triangle sees it, so the result
    // keeps that triangle's orientation.
    let Some(position) = a.iter().position(|&vertex| vertex == apex) else {
        return a.to_vec();
    };
    let first = a[(position + 1) % a.len()];
    let second = a[(position + 2) % a.len()];
    vec![apex, first, opposite, second]
}
