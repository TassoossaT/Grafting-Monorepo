//! Step 5 -- pull every cell toward a square without regularising the grid.

use std::collections::{HashMap, HashSet};

use crate::geometry::centroid_of;
use crate::mesh::{FaceMesh, QuadMesh, Vec2, edge_key, edges_of};

/// Options for [`relax`].
#[derive(Debug, Clone, Default)]
pub struct RelaxOptions {
    /// Smoothing passes. Around 10-20 settles this grid.
    pub iterations: u32,
    /// Fraction of the way to the target each pass moves a vertex.
    pub strength: f64,
    /// Whether vertices on the outer boundary stay put.
    ///
    /// A single chunk relaxed without pinning rounds off, because nothing
    /// outside pulls back. Townscaper avoids this by relaxing across
    /// overlapping neighbourhoods instead; pinning is the honest single-chunk
    /// stand-in, and what a chunked implementation replaces.
    pub pin_boundary: bool,
    /// Explicit pin targets, keyed by vertex index.
    ///
    /// `pin_boundary` only ever holds a vertex at wherever the mesh happened
    /// to place it -- which is all a *free-standing* chunk needs, since
    /// nothing outside it is fixed yet either. A grid generated against
    /// contours another cloud already committed to is different: its rim must
    /// land exactly on those, a position this mesh never produced on its own.
    /// A vertex named here is held at the given position outright, the same
    /// "excluded from the update" treatment `pin_boundary` gives its own
    /// boundary -- easing toward it instead would leave a residual gap after
    /// a fixed iteration count, and the whole point is landing *on* a
    /// committed contour, not merely near it. Wins over `pin_boundary` for
    /// the same vertex.
    pub pinned_targets: HashMap<usize, Vec2>,
}

impl RelaxOptions {
    /// The settings a free-standing chunk relaxes with.
    pub fn standard() -> Self {
        Self { iterations: 12, strength: 0.5, pin_boundary: true, pinned_targets: HashMap::new() }
    }
}

/// For each quad the best-fit square sharing its centre is found by rotating
/// each corner back by its own quarter-turn and averaging: in a true square
/// all four land on the same point, so how far they disagree is exactly how
/// far the cell is from square. Corners then move toward where that square
/// puts them.
///
/// Because every vertex is pulled by all the cells it belongs to, the result
/// is a compromise -- cells become square-ish while the irregular layout
/// survives. Averaging positions toward neighbours instead (ordinary
/// Laplacian smoothing) would shrink the mesh and say nothing about the shape
/// of a cell.
pub fn relax(mesh: &QuadMesh, options: &RelaxOptions) -> QuadMesh {
    let cells: Vec<&[usize]> = mesh.quads.iter().map(|quad| quad.as_slice()).collect();
    QuadMesh { vertices: relax_cells(&mesh.vertices, &cells, options), quads: mesh.quads.clone() }
}

/// [`relax`] for cells of any number of sides.
///
/// An `n`-sided cell is pulled toward the regular `n`-gon sharing its centre,
/// the same rule with a turn of `1/n` in place of the quarter-turn -- which is
/// the quarter-turn exactly when `n` is four, so quads relax identically
/// either way.
pub fn relax_faces(mesh: &FaceMesh, options: &RelaxOptions) -> FaceMesh {
    let cells: Vec<&[usize]> = mesh.faces.iter().map(|face| face.as_slice()).collect();
    FaceMesh { vertices: relax_cells(&mesh.vertices, &cells, options), faces: mesh.faces.clone() }
}

fn relax_cells(vertices: &[Vec2], cells: &[&[usize]], options: &RelaxOptions) -> Vec<Vec2> {
    let pinned: HashSet<usize> =
        if options.pin_boundary { boundary_of(cells) } else { HashSet::new() };

    let mut current = vertices.to_vec();

    for _ in 0..options.iterations {
        let mut sum_x = vec![0.0_f64; current.len()];
        let mut sum_y = vec![0.0_f64; current.len()];
        let mut counts = vec![0_u32; current.len()];

        for cell in cells {
            let corners: Vec<Vec2> = cell.iter().map(|&index| current[index]).collect();
            let centre = centroid_of(&corners);
            let sides = corners.len() as f64;
            let turn = std::f64::consts::TAU / sides;

            // Average the corners after undoing each one's turn.
            let mut frame_x = 0.0;
            let mut frame_y = 0.0;
            for (position, corner) in corners.iter().enumerate() {
                let dx = corner.x - centre.x;
                let dy = corner.y - centre.y;
                let angle = position as f64 * turn;
                frame_x += dx * angle.cos() - dy * angle.sin();
                frame_y += dx * angle.sin() + dy * angle.cos();
            }
            frame_x /= sides;
            frame_y /= sides;

            for (position, &index) in cell.iter().enumerate() {
                let angle = -(position as f64) * turn;
                sum_x[index] += centre.x + (frame_x * angle.cos() - frame_y * angle.sin());
                sum_y[index] += centre.y + (frame_x * angle.sin() + frame_y * angle.cos());
                counts[index] += 1;
            }
        }

        current = current
            .iter()
            .enumerate()
            .map(|(index, vertex)| {
                if let Some(target) = options.pinned_targets.get(&index) {
                    return *target;
                }
                if counts[index] == 0 || pinned.contains(&index) {
                    return *vertex;
                }
                let target_x = sum_x[index] / f64::from(counts[index]);
                let target_y = sum_y[index] / f64::from(counts[index]);
                Vec2::new(
                    vertex.x + (target_x - vertex.x) * options.strength,
                    vertex.y + (target_y - vertex.y) * options.strength,
                )
            })
            .collect();
    }

    current
}

/// Vertices on an edge belonging to exactly one quad.
pub fn boundary_vertices(mesh: &QuadMesh) -> HashSet<usize> {
    let cells: Vec<&[usize]> = mesh.quads.iter().map(|quad| quad.as_slice()).collect();
    boundary_of(&cells)
}

fn boundary_of(cells: &[&[usize]]) -> HashSet<usize> {
    let mut counts: HashMap<(usize, usize), u32> = HashMap::new();
    for cell in cells {
        for (a, b) in edges_of(cell) {
            *counts.entry(edge_key(a, b)).or_insert(0) += 1;
        }
    }

    let mut boundary = HashSet::new();
    for cell in cells {
        for (a, b) in edges_of(cell) {
            if counts.get(&edge_key(a, b)) == Some(&1) {
                boundary.insert(a);
                boundary.insert(b);
            }
        }
    }
    boundary
}
