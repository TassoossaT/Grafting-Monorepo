//! Regenerating ground against a contour the grid itself produced must not
//! keep adding nodes to that contour.
//!
//! Two neighbouring regions regenerated in turn is exactly what a road edit
//! does to the terrain beside it: the replaced faces are laid again against
//! the rim of the faces that stayed, and the next edit may replace those. Any
//! node the grid puts on the shared side is adopted into the neighbour, and
//! read back as part of the neighbour's contour the next time round.

use grafting_procgen_irregular_grid::build_constrained_quad_grid;
use grafting_procgen_irregular_grid::constrained::{ConstrainedOptions, ConstraintPoint};
use grafting_procgen_irregular_grid::hex::{lattice_covering, lattice_triangle_area};
use grafting_procgen_irregular_grid::mesh::Vec2;
use grafting_procgen_irregular_grid::relax::RelaxOptions;

const FACE: f64 = 2.0;
const SEAM_X: f64 = 12.0;
/// What the application refuses to split below: `SHORTEST_USEFUL_FRACTION`
/// times the face size, in `terrain-constraints.ts`.
const FLOOR: f64 = 0.5;

/// The ring of a 12x12 square starting at `x0`, walked at `FACE`, with the
/// seam side (x = 12) walked through `seam` instead. Every point names a node,
/// the way a rim of standing terrain arrives.
fn ring(x0: f64, seam: &[f64]) -> Vec<ConstraintPoint> {
    let mut points: Vec<(f64, f64)> = Vec::new();
    let x1 = x0 + 12.0;
    let steps = 6;
    let side = |from: f64, to: f64, i: usize| from + (to - from) * i as f64 / steps as f64;
    if x0 < SEAM_X {
        for i in 0..steps { points.push((side(x0, x1, i), 0.0)); }
        for &z in seam.iter().take(seam.len() - 1) { points.push((SEAM_X, z)); }
        for i in 0..steps { points.push((side(x1, x0, i), 12.0)); }
        for i in 0..steps { points.push((x0, side(12.0, 0.0, i))); }
    } else {
        for i in 0..steps { points.push((side(x0, x1, i), 0.0)); }
        for i in 0..steps { points.push((x1, side(0.0, 12.0, i))); }
        for i in 0..steps { points.push((side(x1, x0, i), 12.0)); }
        for &z in seam.iter().rev().take(seam.len() - 1) { points.push((SEAM_X, z)); }
    }
    points
        .into_iter()
        .enumerate()
        .map(|(i, (x, y))| ConstraintPoint { position: Vec2::new(x, y), source: Some(i as u32) })
        .collect()
}

/// Generates one region against `seam` with the parameters the application
/// bridge uses, and returns its cell count and the seam its neighbour ends up
/// with once every node the grid put on it has been adopted.
fn regenerate(x0: f64, seam: &[f64], seed: u32) -> (usize, Vec<f64>) {
    let triangle_side = FACE * 3.0;
    let options = ConstrainedOptions {
        seeds: lattice_covering(Vec2::new(x0, 0.0), Vec2::new(x0 + 12.0, 12.0), triangle_side),
        boundary: vec![ring(x0, seam)],
        holes: Vec::new(),
        seed_clearance: triangle_side * 0.25,
        max_area: lattice_triangle_area(triangle_side),
        min_area: lattice_triangle_area(triangle_side) * 0.25,
        min_angle_degrees: 20.5,
        max_additional_vertices: 500,
    };
    let relax = RelaxOptions { iterations: 12, strength: 0.7, pin_boundary: false, pinned_targets: Default::default() };
    let grid = build_constrained_quad_grid(&options, seed, &relax).expect("grid");
    assert!(grid.seams_kept, "these rings cross nothing, so no seam should be lost");
    let mut next: Vec<f64> = seam.to_vec();
    for node in &grid.on_contour {
        let v = grid.mesh.vertices[node.vertex];
        if (v.x - SEAM_X).abs() > 1e-6 { continue; }
        if next.iter().any(|&z| (z - v.y).abs() < FLOOR) { continue; }
        next.push(v.y);
    }
    next.sort_by(f64::total_cmp);
    (grid.mesh.faces.len(), next)
}

#[test]
fn two_neighbours_regenerated_in_turn_leave_the_seam_between_them_as_it_was() {
    let original: Vec<f64> = (0..=6).map(|i| i as f64 * FACE).collect();
    let mut seam = original.clone();
    let mut cells = Vec::new();
    for round in 1..=6 {
        let x0 = if round % 2 == 1 { SEAM_X } else { 0.0 };
        let (count, next) = regenerate(x0, &seam, 7 + round);
        // Measured before seams were kept: 7 -> 13 -> 25 nodes, and 76 -> 110
        // cells for the same 12x12 region.
        assert_eq!(next, original, "round {round}: the seam gained nodes");
        cells.push(count);
        seam = next;
    }
    let (fewest, most) = (cells.iter().min().unwrap(), cells.iter().max().unwrap());
    assert!(
        most - fewest <= fewest / 10,
        "the same ground keeps coming back at the same density: {cells:?}"
    );
}
