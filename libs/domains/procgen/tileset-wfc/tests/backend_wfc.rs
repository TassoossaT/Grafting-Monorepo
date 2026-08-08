//! Tests for the `wave-function-collapse` backend specifically. Everything
//! here goes through the public trait, so the same tests describe what any
//! replacement backend must also do.

#![cfg(feature = "solver-wfc")]

use std::collections::HashSet;

use grafting_procgen_tileset_wfc::{
    CellGraph, Link, Module, Problem, SolveError, Tileset, backend::WaveFunctionCollapseSolver,
    solve_verified,
};

fn distinct_neighbours(module_count: usize) -> Tileset {
    let modules = (0..module_count)
        .map(|index| Module {
            name: format!("module-{index}"),
            sockets: vec![index; 4],
            weight: 1.0,
        })
        .collect();
    let mut compatible = Vec::new();
    for left in 0..module_count {
        for right in (left + 1)..module_count {
            compatible.push((left, right));
        }
    }
    Tileset::new(modules, compatible).expect("a valid tileset")
}

/// A closed ring of `cell_count` cells. An odd ring is the interesting case:
/// it is not two-colourable, and it is the shape an irregular grid produces
/// around a valence-3 vertex.
fn ring(cell_count: usize) -> CellGraph {
    let links = (0..cell_count).map(|cell| Link {
        from: cell,
        from_face: 0,
        to: (cell + 1) % cell_count,
        to_face: 2,
    });
    // The final link closes the ring onto cell 0's face 2, which is free.
    CellGraph::new(cell_count, 4, links).expect("a valid ring")
}

#[test]
fn it_solves_an_odd_ring_which_no_compass_grid_could_describe() {
    let problem = Problem::compile(&ring(7), &distinct_neighbours(3), &[]).unwrap();
    let assignment =
        solve_verified(&WaveFunctionCollapseSolver, &problem, 1).expect("7-ring, 3 modules solves");
    assert_eq!(assignment.violations(&problem), Vec::new());
    assert_eq!(assignment.modules().len(), 7);
}

#[test]
fn the_same_seed_gives_the_same_map() {
    // Replicated authoritative state: two hosts generating "the same" map
    // must agree, so this is a correctness requirement, not a nicety.
    let problem = Problem::compile(&ring(24), &distinct_neighbours(4), &[]).unwrap();
    let first = solve_verified(&WaveFunctionCollapseSolver, &problem, 99).unwrap();
    let second = solve_verified(&WaveFunctionCollapseSolver, &problem, 99).unwrap();
    assert_eq!(first, second);
}

#[test]
fn different_seeds_give_different_maps() {
    // Without this the tileset buys nothing over deriving geometry directly.
    let problem = Problem::compile(&ring(24), &distinct_neighbours(4), &[]).unwrap();
    let distinct: HashSet<Vec<usize>> = (0..12u64)
        .map(|seed| {
            solve_verified(&WaveFunctionCollapseSolver, &problem, seed)
                .expect("every seed solves")
                .modules()
                .to_vec()
        })
        .collect();
    assert!(distinct.len() > 1, "expected variation across seeds, got {distinct:?}");
}

#[test]
fn pinned_cells_survive_the_solve() {
    let problem = Problem::compile(&ring(12), &distinct_neighbours(4), &[(3, vec![2])]).unwrap();
    for seed in 0..6u64 {
        let assignment = solve_verified(&WaveFunctionCollapseSolver, &problem, seed).unwrap();
        assert_eq!(assignment.module(3), Some(2), "seed {seed} moved a pinned cell");
    }
}

#[test]
fn an_unsatisfiable_problem_is_reported_rather_than_solved_wrongly() {
    // An odd ring cannot be two-coloured. `compile` cannot see this -- every
    // individual link has compatible pairs -- so it reaches the backend, and
    // the backend must say so instead of returning something invalid.
    //
    // It reports `SearchFailed` rather than anything stronger: this problem
    // really has no solution, but the backend cannot tell that apart from its
    // own dead end, and claiming otherwise would be a lie in the common case.
    let problem = Problem::compile(&ring(5), &distinct_neighbours(2), &[]).unwrap();
    match solve_verified(&WaveFunctionCollapseSolver, &problem, 0) {
        Err(SolveError::SearchFailed { .. }) => {}
        Err(other) => panic!("expected a failed search, got {other}"),
        Ok(assignment) => panic!("expected no solution, got {:?}", assignment.modules()),
    }
}
