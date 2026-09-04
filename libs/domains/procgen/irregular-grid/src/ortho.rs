//! Steps 3 and 4 -- quadrangulation, then merging the duplicates it emits.

use std::collections::HashMap;

use crate::geometry::centroid_of;
use crate::mesh::{FaceMesh, Quad, QuadMesh, Vec2};

/// Step 3 -- Conway's ortho operator: every face becomes quads.
///
/// A face of `n` sides yields `n` quads, each spanning one corner, the two
/// adjacent edge midpoints, and the face centre. A triangle becomes three
/// quads and a rhombus four, so nothing has to be done about faces that never
/// found a partner -- the mesh is all-quad regardless of how the pairing went.
pub fn ortho(mesh: &FaceMesh) -> QuadMesh {
    let mut vertices: Vec<Vec2> = mesh.vertices.clone();
    let mut quads: Vec<Quad> = Vec::new();

    for face in &mesh.faces {
        if face.len() < 3 {
            continue;
        }
        let points: Vec<Vec2> = face.iter().map(|&vertex| mesh.vertices[vertex]).collect();

        let centre = vertices.len();
        vertices.push(centroid_of(&points));

        // Midpoints are emitted per face and deduplicated later by `weld`;
        // computing them once globally would need an edge table that the weld
        // step already amounts to.
        let midpoints: Vec<usize> = face
            .iter()
            .enumerate()
            .map(|(position, &vertex)| {
                let next = face[(position + 1) % face.len()];
                let from = mesh.vertices[vertex];
                let to = mesh.vertices[next];
                vertices.push(Vec2::new((from.x + to.x) / 2.0, (from.y + to.y) / 2.0));
                vertices.len() - 1
            })
            .collect();

        for (position, &vertex) in face.iter().enumerate() {
            let ahead = midpoints[position];
            let behind = midpoints[(position + face.len() - 1) % face.len()];
            quads.push([vertex, ahead, centre, behind]);
        }
    }

    QuadMesh { vertices, quads }
}

/// Step 4 -- merge coincident vertices.
///
/// Required before relaxation rather than merely tidy: each face produced its
/// own copy of every shared edge midpoint, and until those are one vertex,
/// smoothing moves each copy independently and tears the mesh apart.
pub fn weld(mesh: &QuadMesh, epsilon: f64) -> QuadMesh {
    weld_tracked(mesh, epsilon).0
}

/// [`weld`], plus where each vertex went.
///
/// `remap[before] == after`. A caller carrying per-vertex facts the mesh
/// itself does not hold -- which node of the graph a corner already is --
/// needs this, and deriving it afterwards would mean matching positions,
/// which is the one thing this whole approach exists to avoid.
pub fn weld_tracked(mesh: &QuadMesh, epsilon: f64) -> (QuadMesh, Vec<usize>) {
    let mut vertices: Vec<Vec2> = Vec::new();
    let mut lookup: HashMap<(i64, i64), usize> = HashMap::new();
    let mut remap: Vec<usize> = Vec::with_capacity(mesh.vertices.len());

    for vertex in &mesh.vertices {
        let key = ((vertex.x / epsilon).round() as i64, (vertex.y / epsilon).round() as i64);
        let resolved = *lookup.entry(key).or_insert_with(|| {
            vertices.push(*vertex);
            vertices.len() - 1
        });
        remap.push(resolved);
    }

    let quads = mesh
        .quads
        .iter()
        .map(|quad| quad.map(|vertex| remap[vertex]))
        // A quad whose corners collapsed onto each other is degenerate and
        // would contribute a zero-area cell to every later stage.
        .filter(|quad| {
            let mut seen = *quad;
            seen.sort_unstable();
            seen.windows(2).all(|pair| pair[0] != pair[1])
        })
        .collect();

    (QuadMesh { vertices, quads }, remap)
}
