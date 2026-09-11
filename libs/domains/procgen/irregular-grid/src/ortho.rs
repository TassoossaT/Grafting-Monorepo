//! Steps 3 and 4 -- quadrangulation, then merging the duplicates it emits.

use std::collections::HashMap;

use crate::geometry::centroid_of;
use crate::mesh::{Face, FaceMesh, QuadMesh, Vec2};

/// Step 3 -- Conway's ortho operator: every face becomes quads.
///
/// A face of `n` sides yields `n` quads, each spanning one corner, the two
/// adjacent edge midpoints, and the face centre. A triangle becomes three
/// quads and a rhombus four, so nothing has to be done about faces that never
/// found a partner -- the mesh is all-quad regardless of how the pairing went.
pub fn ortho(mesh: &FaceMesh) -> QuadMesh {
    let cells = ortho_along(mesh, &HashMap::new());
    // With no seams every edge gets its midpoint, so every cell is a quad.
    let quads = cells
        .faces
        .iter()
        .map(|cell| [cell[0], cell[1], cell[2], cell[3]])
        .collect();
    QuadMesh { vertices: cells.vertices, quads }
}

/// [`ortho`], except along the edges named in `seams`.
///
/// **Why a seam must not get a midpoint.** A seam is an edge standing for a
/// stretch of a contour someone else already owns, and every node on it is
/// already there. A fresh midpoint on it is a node the owner has to adopt --
/// and the owner's next regeneration reads that node back as part of its own
/// contour, puts a midpoint on each half, and so on: two neighbours
/// regenerating in turn halve the segments of the edge between them every
/// time. Measured on two 12x12 regions sharing one side walked at the face
/// size, the side went 7 -> 13 -> 25 nodes and the cells beside it from 76 to
/// 110 for the same ground, stopping only where the caller refused splits
/// shorter than a quarter face.
///
/// So a seam brings its own: `seams[(from, to)]` lists the vertices already
/// standing strictly between the two corners, in walk order, and the two
/// cells either side of them share the middle one instead of a new midpoint.
/// That is how a contour held out of the triangulation one point in two comes
/// back exactly as it went in. An empty list is a seam too short to be worth a
/// node of its own: the cells at both of its corners merge into one polygon,
/// which is why this returns faces rather than quads. Either direction may be
/// named; the other is read reversed.
pub fn ortho_along(mesh: &FaceMesh, seams: &HashMap<(usize, usize), Vec<usize>>) -> FaceMesh {
    let mut vertices: Vec<Vec2> = mesh.vertices.clone();
    let mut faces: Vec<Face> = Vec::new();

    for face in &mesh.faces {
        if face.len() < 3 {
            continue;
        }
        let count = face.len();
        let points: Vec<Vec2> = face.iter().map(|&vertex| mesh.vertices[vertex]).collect();

        let centre = vertices.len();
        vertices.push(centroid_of(&points));

        // Midpoints are emitted per face and deduplicated later by `weld`;
        // computing them once globally would need an edge table that the weld
        // step already amounts to.
        //
        // Per edge: the vertices strictly between its corners, and which of
        // them the two corner cells share -- `None` for a seam with nothing
        // on it, whose two corners end up in one cell.
        let between: Vec<(Vec<usize>, Option<usize>)> = face
            .iter()
            .enumerate()
            .map(|(position, &vertex)| {
                let next = face[(position + 1) % count];
                let chain = match (seams.get(&(vertex, next)), seams.get(&(next, vertex))) {
                    (Some(chain), _) => chain.clone(),
                    (None, Some(chain)) => chain.iter().rev().copied().collect(),
                    (None, None) => {
                        let from = mesh.vertices[vertex];
                        let to = mesh.vertices[next];
                        vertices.push(Vec2::new((from.x + to.x) / 2.0, (from.y + to.y) / 2.0));
                        vec![vertices.len() - 1]
                    }
                };
                let shared = if chain.is_empty() { None } else { Some(chain.len() / 2) };
                (chain, shared)
            })
            .collect();

        let splits: Vec<usize> = (0..count).filter(|&edge| between[edge].1.is_some()).collect();
        if splits.len() < 2 {
            // Nothing divides the face into more than one cell: it stays
            // whole, with whatever its seams hold walked into its rim.
            let mut cell = Vec::new();
            for (position, &vertex) in face.iter().enumerate() {
                cell.push(vertex);
                cell.extend(&between[position].0);
            }
            faces.push(cell);
            continue;
        }

        // One cell per stretch between two consecutive splits, ordered by the
        // corner it starts at so an unseamed face comes out exactly as the
        // plain ortho step always emitted it: corner, ahead, centre, behind.
        let mut cells: Vec<(usize, Face)> = Vec::new();
        for (index, &behind) in splits.iter().enumerate() {
            let ahead = splits[(index + 1) % splits.len()];
            let (behind_chain, behind_shared) = &between[behind];
            let first = (behind + 1) % count;
            let mut cell = Vec::new();
            let mut corner = first;
            loop {
                cell.push(face[corner]);
                if corner == ahead {
                    break;
                }
                cell.extend(&between[corner].0);
                corner = (corner + 1) % count;
            }
            let (ahead_chain, ahead_shared) = &between[ahead];
            cell.extend(&ahead_chain[..=ahead_shared.expect("a split has a shared vertex")]);
            cell.push(centre);
            cell.extend(&behind_chain[behind_shared.expect("a split has a shared vertex")..]);
            cells.push((first, cell));
        }
        cells.sort_by_key(|&(first, _)| first);
        faces.extend(cells.into_iter().map(|(_, cell)| cell));
    }

    FaceMesh { vertices, faces }
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
    let (vertices, remap) = weld_vertices(&mesh.vertices, epsilon);
    let quads = mesh
        .quads
        .iter()
        .map(|quad| quad.map(|vertex| remap[vertex]))
        .filter(|quad| distinct_corners(quad))
        .collect();

    (QuadMesh { vertices, quads }, remap)
}

/// [`weld_tracked`] for cells of any number of sides -- what
/// [`ortho_along`] produces.
pub fn weld_faces_tracked(mesh: &FaceMesh, epsilon: f64) -> (FaceMesh, Vec<usize>) {
    let (vertices, remap) = weld_vertices(&mesh.vertices, epsilon);
    let faces = mesh
        .faces
        .iter()
        .map(|face| face.iter().map(|&vertex| remap[vertex]).collect::<Face>())
        .filter(|face| distinct_corners(face))
        .collect();

    (FaceMesh { vertices, faces }, remap)
}

fn weld_vertices(input: &[Vec2], epsilon: f64) -> (Vec<Vec2>, Vec<usize>) {
    let mut vertices: Vec<Vec2> = Vec::new();
    let mut lookup: HashMap<(i64, i64), usize> = HashMap::new();
    let mut remap: Vec<usize> = Vec::with_capacity(input.len());

    for vertex in input {
        let key = ((vertex.x / epsilon).round() as i64, (vertex.y / epsilon).round() as i64);
        let resolved = *lookup.entry(key).or_insert_with(|| {
            vertices.push(*vertex);
            vertices.len() - 1
        });
        remap.push(resolved);
    }
    (vertices, remap)
}

/// A cell whose corners collapsed onto each other is degenerate and would
/// contribute a zero-area cell to every later stage.
fn distinct_corners(cell: &[usize]) -> bool {
    let mut seen = cell.to_vec();
    seen.sort_unstable();
    seen.windows(2).all(|pair| pair[0] != pair[1])
}
