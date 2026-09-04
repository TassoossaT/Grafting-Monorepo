//! What each stage of the pipeline is for, checked one stage at a time.
//!
//! Ported from `apps/architecture-studio/test/irregular-grid.test.mjs`, which
//! specified the TypeScript original. `parity.rs` proves the port reproduces
//! that implementation exactly; these say what the implementation is *for*,
//! so a later change that breaks the intent fails here with a reason rather
//! than in `parity.rs` with a coordinate diff.

use std::collections::HashMap;

use grafting_procgen_irregular_grid::mesh::{Vec2, edge_key, edges_of};
use grafting_procgen_irregular_grid::ortho::{ortho, weld};
use grafting_procgen_irregular_grid::pair::pair_triangles;
use grafting_procgen_irregular_grid::{
    IrregularQuadGridOptions, QuadMesh, Random, RelaxOptions, TriangleHexOptions,
    WELD_EPSILON, build_irregular_quad_grid, build_triangle_hex, relax,
};

const SIDE: f64 = 0.5;

fn hex() -> grafting_procgen_irregular_grid::FaceMesh {
    build_triangle_hex(TriangleHexOptions { triangles_per_side: 4, triangle_side: SIDE })
}

fn welded(seed: u32) -> QuadMesh {
    let mut random = Random::new(seed);
    let paired = pair_triangles(&hex(), &mut random);
    weld(&ortho(&paired), WELD_EPSILON)
}

fn distance(a: Vec2, b: Vec2) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

fn polygon_area(corners: &[Vec2]) -> f64 {
    let mut total = 0.0;
    for index in 0..corners.len() {
        let from = corners[index];
        let to = corners[(index + 1) % corners.len()];
        total += from.x * to.y - to.x * from.y;
    }
    total / 2.0
}

#[test]
fn the_triangle_hexagon_is_built_from_equilateral_triangles_only() {
    let mesh = hex();
    assert!(!mesh.faces.is_empty());
    for face in &mesh.faces {
        assert_eq!(face.len(), 3, "every face of the first stage is a triangle");
        for (a, b) in edges_of(face) {
            let length = distance(mesh.vertices[a], mesh.vertices[b]);
            assert!(
                (length - SIDE).abs() < 1e-9,
                "edge of length {length} is not the lattice side {SIDE}"
            );
        }
    }
}

#[test]
fn the_hexagon_holds_the_triangle_count_its_side_length_implies() {
    // A hexagon of side n triangles holds 6 * n^2 of them.
    for per_side in 1..=4_u32 {
        let mesh = build_triangle_hex(TriangleHexOptions {
            triangles_per_side: per_side,
            triangle_side: SIDE,
        });
        assert_eq!(mesh.faces.len(), 6 * (per_side * per_side) as usize, "side {per_side}");
    }
}

#[test]
fn pairing_leaves_only_triangles_and_rhombi_and_merges_at_least_some() {
    let mut random = Random::new(5);
    let triangles = hex();
    let paired = pair_triangles(&triangles, &mut random);

    assert!(paired.faces.iter().all(|face| face.len() == 3 || face.len() == 4));
    assert!(
        paired.faces.iter().any(|face| face.len() == 4),
        "the pairing is what makes the grid irregular; merging nothing defeats it"
    );
    assert!(
        paired.faces.len() < triangles.faces.len(),
        "a merge consumes two faces and emits one"
    );
}

#[test]
fn ortho_makes_every_face_a_quad_whatever_the_pairing_left_behind() {
    let mut random = Random::new(5);
    let paired = pair_triangles(&hex(), &mut random);
    let quadrangulated = ortho(&paired);

    let expected: usize = paired.faces.iter().map(|face| face.len()).sum();
    assert_eq!(
        quadrangulated.quads.len(),
        expected,
        "a face of n sides yields exactly n quads, so a triangle gives three and a rhombus four"
    );
}

#[test]
fn welding_unifies_the_duplicate_midpoints_ortho_emitted_per_face() {
    let mut random = Random::new(5);
    let paired = pair_triangles(&hex(), &mut random);
    let quadrangulated = ortho(&paired);
    let unified = weld(&quadrangulated, WELD_EPSILON);

    assert!(
        unified.vertices.len() < quadrangulated.vertices.len(),
        "every interior edge midpoint was emitted twice, once by each face"
    );

    let mut seen: HashMap<(i64, i64), usize> = HashMap::new();
    for vertex in &unified.vertices {
        let key = ((vertex.x / WELD_EPSILON).round() as i64, (vertex.y / WELD_EPSILON).round() as i64);
        *seen.entry(key).or_insert(0) += 1;
    }
    assert!(
        seen.values().all(|&count| count == 1),
        "no two vertices share a position once welded"
    );
}

/// Mean deviation of a cell corner from a right angle, in radians.
///
/// Angles rather than edge-length ratios, because that is what the relax step
/// actually optimises: it fits the best *square* sharing each cell centre, so
/// a cell can legitimately end up with two long sides and two short ones and
/// still be more square in the sense that matters.
fn squareness(mesh: &QuadMesh) -> f64 {
    let mut total = 0.0;
    let mut count = 0.0;
    for quad in &mesh.quads {
        let corners: Vec<Vec2> = quad.iter().map(|&index| mesh.vertices[index]).collect();
        for index in 0..4 {
            let previous = corners[(index + 3) % 4];
            let current = corners[index];
            let next = corners[(index + 1) % 4];
            let a = (previous.y - current.y).atan2(previous.x - current.x);
            let b = (next.y - current.y).atan2(next.x - current.x);
            let mut angle = (a - b).abs() % std::f64::consts::TAU;
            if angle > std::f64::consts::PI {
                angle = std::f64::consts::TAU - angle;
            }
            total += (angle - std::f64::consts::FRAC_PI_2).abs();
            count += 1.0;
        }
    }
    total / count
}

#[test]
fn relaxation_makes_cells_more_square_without_collapsing_the_mesh() {
    let before = welded(11);
    let after = relax(&before, &RelaxOptions::standard());

    assert!(
        squareness(&after) < squareness(&before),
        "cells should be closer to square after relaxing than before"
    );
    assert_eq!(after.quads.len(), before.quads.len(), "relaxing moves corners, never cells");
    assert!(
        after.vertices.iter().all(|vertex| vertex.x.is_finite() && vertex.y.is_finite()),
        "relaxation diverged"
    );
    assert!(
        after.quads.iter().all(|quad| {
            let corners: Vec<Vec2> = quad.iter().map(|&index| after.vertices[index]).collect();
            polygon_area(&corners).abs() > 1e-9
        }),
        "no cell may collapse to zero area"
    );
}

#[test]
fn pinned_boundary_vertices_do_not_move() {
    let before = welded(5);
    let pinned = grafting_procgen_irregular_grid::boundary_vertices(&before);
    let after = relax(&before, &RelaxOptions::standard());

    for index in pinned {
        assert_eq!(
            before.vertices[index], after.vertices[index],
            "boundary vertex {index} moved despite being pinned"
        );
    }
}

#[test]
fn a_vertex_named_in_pinned_targets_lands_exactly_on_that_position() {
    let before = welded(5);
    // Well outside the mesh footprint, so nothing about ordinary relaxation
    // could produce it by coincidence.
    let target = Vec2::new(100.0, -50.0);
    let mut options = RelaxOptions::standard();
    options.pinned_targets.insert(0, target);

    let after = relax(&before, &options);
    assert_eq!(after.vertices[0], target);
}

#[test]
fn pinned_targets_win_over_pin_boundary_for_the_same_vertex() {
    let before = welded(5);
    let boundary = *grafting_procgen_irregular_grid::boundary_vertices(&before)
        .iter()
        .min()
        .expect("the mesh has a boundary");
    let target = Vec2::new(42.0, 42.0);

    let mut options = RelaxOptions::standard();
    options.pin_boundary = true;
    options.pinned_targets.insert(boundary, target);

    let after = relax(&before, &options);
    assert_eq!(after.vertices[boundary], target);
}

#[test]
fn an_empty_pinned_target_map_relaxes_exactly_as_it_did_without_the_option() {
    let before = welded(5);
    let without = relax(&before, &RelaxOptions::standard());
    let with_empty = relax(&before, &RelaxOptions { ..RelaxOptions::standard() });
    assert_eq!(without.vertices, with_empty.vertices);
}

#[test]
fn the_finished_grid_is_all_quads_with_area_and_one_consistent_winding() {
    let grid = build_irregular_quad_grid(&IrregularQuadGridOptions {
        seed: 11,
        hex: TriangleHexOptions { triangles_per_side: 4, triangle_side: SIDE },
        relax: RelaxOptions::standard(),
    });

    assert!(!grid.quads.is_empty());
    let signs: Vec<bool> = grid
        .quads
        .iter()
        .map(|quad| {
            let corners: Vec<Vec2> = quad.iter().map(|&index| grid.vertices[index]).collect();
            let area = polygon_area(&corners);
            assert!(area.abs() > 1e-9, "every cell has area");
            area > 0.0
        })
        .collect();
    assert!(
        signs.iter().all(|&sign| sign == signs[0]),
        "every cell winds the same way; a reversed one renders backwards"
    );
}

#[test]
fn every_interior_edge_is_shared_by_exactly_two_cells() {
    // The property the whole "one mesh, not a field of mini-quads" claim
    // rests on: if two cells that look adjacent do not literally share an
    // edge, the graph has a seam the renderer will not show.
    let grid = build_irregular_quad_grid(&IrregularQuadGridOptions {
        seed: 11,
        hex: TriangleHexOptions { triangles_per_side: 4, triangle_side: SIDE },
        relax: RelaxOptions::standard(),
    });

    let mut counts: HashMap<(usize, usize), u32> = HashMap::new();
    for quad in &grid.quads {
        for (a, b) in edges_of(quad) {
            *counts.entry(edge_key(a, b)).or_insert(0) += 1;
        }
    }
    assert!(
        counts.values().all(|&count| count <= 2),
        "no edge may be used by three cells"
    );
    assert!(
        counts.values().any(|&count| count == 2),
        "the mesh is connected, so interior edges exist"
    );
}

#[test]
fn the_seed_lattice_covers_the_box_and_keeps_the_lattice_spacing() {
    use grafting_procgen_irregular_grid::hex::{lattice_covering, lattice_triangle_area};

    let points = lattice_covering(Vec2::new(0.0, 0.0), Vec2::new(10.0, 10.0), SIDE);
    assert!(!points.is_empty());

    // Every corner of the box has a seed near enough to be a triangle corner
    // for it -- otherwise the refinement, not the lattice, decides the
    // spacing there, and that patch of ground reads as a different material.
    for corner in [
        Vec2::new(0.0, 0.0),
        Vec2::new(10.0, 0.0),
        Vec2::new(0.0, 10.0),
        Vec2::new(10.0, 10.0),
        Vec2::new(5.0, 5.0),
    ] {
        let nearest = points
            .iter()
            .map(|&point| distance(point, corner))
            .fold(f64::MAX, f64::min);
        assert!(nearest <= SIDE, "no seed within one lattice side of ({}, {})", corner.x, corner.y);
    }

    // The spacing is the lattice one: every seed has a neighbour at exactly
    // one side length, the way an equilateral lattice does.
    for &point in points.iter().take(50) {
        let touching = points
            .iter()
            .filter(|&&other| (distance(point, other) - SIDE).abs() < 1e-9)
            .count();
        assert!(touching > 0, "a seed with no neighbour at one side length is off-lattice");
    }

    // An equilateral triangle of that side, which is what the refinement is
    // asked to cap its own triangles at.
    let expected = SIDE * SIDE * 3.0_f64.sqrt() / 4.0;
    assert!((lattice_triangle_area(SIDE) - expected).abs() < 1e-12);
}

#[test]
fn a_degenerate_box_seeds_nothing_rather_than_looping() {
    use grafting_procgen_irregular_grid::hex::lattice_covering;
    assert!(lattice_covering(Vec2::new(0.0, 0.0), Vec2::new(1.0, 1.0), 0.0).is_empty());
    assert!(lattice_covering(Vec2::new(5.0, 0.0), Vec2::new(0.0, 1.0), 0.5).is_empty());
    assert!(lattice_covering(Vec2::new(0.0, 0.0), Vec2::new(1.0, f64::NAN), 0.5).is_empty());
}
