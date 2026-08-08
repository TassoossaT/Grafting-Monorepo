//! Tests for the solver-agnostic model. These run with no backend enabled,
//! which is itself the point: the domain must not depend on a solver.

use grafting_procgen_tileset_wfc::{
    Assignment, CellGraph, ConstraintSolver, Link, Module, Problem, SolveError, Tileset, Violation,
    graph::GraphError, problem::ProblemError, solve_verified, tileset::TilesetError,
};

/// Three cells each adjacent to the other two -- what surrounds a valence-3
/// vertex, and a topology no compass-direction labelling can describe.
fn triangle_graph() -> CellGraph {
    CellGraph::new(
        3,
        4,
        [
            Link { from: 0, from_face: 0, to: 1, to_face: 2 },
            Link { from: 1, from_face: 0, to: 2, to_face: 1 },
            Link { from: 0, from_face: 3, to: 2, to_face: 0 },
        ],
    )
    .expect("the triangle is a valid graph")
}

/// `n` modules, all sockets distinct, where socket `i` meets any socket but
/// `i` -- so neighbours must differ.
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

#[test]
fn a_graph_rejects_adjacency_it_cannot_mean() {
    let link = Link { from: 0, from_face: 0, to: 5, to_face: 0 };
    assert_eq!(
        CellGraph::new(3, 4, [link]).unwrap_err(),
        GraphError::UnknownCell { cell: 5, cell_count: 3 },
    );

    let self_link = Link { from: 1, from_face: 0, to: 1, to_face: 2 };
    assert_eq!(
        CellGraph::new(3, 4, [self_link]).unwrap_err(),
        GraphError::SelfLink { cell: 1 },
    );

    let reused = [
        Link { from: 0, from_face: 0, to: 1, to_face: 2 },
        Link { from: 0, from_face: 0, to: 2, to_face: 1 },
    ];
    assert_eq!(
        CellGraph::new(3, 4, reused).unwrap_err(),
        GraphError::DuplicateFace { cell: 0, face: 0 },
    );
}

#[test]
fn a_tileset_rejects_modules_that_cannot_be_placed() {
    assert_eq!(Tileset::new(Vec::new(), []).unwrap_err(), TilesetError::Empty);

    let ragged = vec![
        Module { name: "a".into(), sockets: vec![0; 4], weight: 1.0 },
        Module { name: "b".into(), sockets: vec![0; 3], weight: 1.0 },
    ];
    assert_eq!(
        Tileset::new(ragged, []).unwrap_err(),
        TilesetError::FaceCountMismatch { module: 1, declared: 3, expected: 4 },
    );

    let weightless = vec![Module { name: "a".into(), sockets: vec![0; 4], weight: 0.0 }];
    assert_eq!(
        Tileset::new(weightless, []).unwrap_err(),
        TilesetError::InvalidWeight { module: 0 },
    );
}

#[test]
fn compiling_refuses_a_graph_and_tileset_that_disagree_about_faces() {
    let graph = triangle_graph();
    let hexagonal = Tileset::new(
        vec![Module { name: "a".into(), sockets: vec![0; 6], weight: 1.0 }],
        [(0, 0)],
    )
    .unwrap();
    assert_eq!(
        Problem::compile(&graph, &hexagonal, &[]).unwrap_err(),
        ProblemError::FaceCountMismatch { graph: 4, tileset: 6 },
    );
}

#[test]
fn compiling_names_the_link_that_makes_a_problem_impossible() {
    // Two modules that must differ, but cell 0 and cell 1 are both pinned to
    // module 0 -- unsatisfiable, and cheap to see.
    let graph = triangle_graph();
    let tileset = distinct_neighbours(2);
    let pinned = vec![(0usize, vec![0usize]), (1usize, vec![0usize])];
    assert_eq!(
        Problem::compile(&graph, &tileset, &pinned).unwrap_err(),
        ProblemError::NoCompatiblePair { from: 0, to: 1 },
    );
}

#[test]
fn compiling_refuses_a_cell_with_nothing_left_to_choose() {
    let graph = triangle_graph();
    let tileset = distinct_neighbours(3);
    assert_eq!(
        Problem::compile(&graph, &tileset, &[(1, Vec::new())]).unwrap_err(),
        ProblemError::NoCandidates { cell: 1 },
    );
}

#[test]
fn compiling_expands_sockets_into_per_link_pairs() {
    let graph = triangle_graph();
    let tileset = distinct_neighbours(3);
    let problem = Problem::compile(&graph, &tileset, &[]).unwrap();

    assert_eq!(problem.cell_count(), 3);
    assert_eq!(problem.module_count(), 3);
    assert_eq!(problem.links().len(), 3);
    for link in problem.links() {
        // Three modules, neighbours must differ: 3 * 2 ordered pairs.
        assert_eq!(link.allowed.len(), 6);
        assert!(link.allowed.iter().all(|(left, right)| left != right));
    }
}

#[test]
fn pinning_narrows_a_cell_and_the_links_touching_it() {
    let graph = triangle_graph();
    let tileset = distinct_neighbours(3);
    let problem = Problem::compile(&graph, &tileset, &[(0, vec![2])]).unwrap();

    assert_eq!(problem.candidates(0), &[2]);
    assert_eq!(problem.candidates(1), &[0, 1, 2]);
    for link in problem.links() {
        if link.from == 0 {
            assert!(link.allowed.iter().all(|(left, _)| *left == 2));
        }
    }
}

/// A backend written entirely outside this crate, to prove the seam is real:
/// it implements the public trait using only public types, and knows nothing
/// about `wave-function-collapse`.
struct FirstFitSolver;

impl ConstraintSolver for FirstFitSolver {
    fn solve(&self, problem: &Problem, _seed: u64) -> Result<Assignment, SolveError> {
        let mut chosen: Vec<Option<usize>> = vec![None; problem.cell_count()];
        for cell in 0..problem.cell_count() {
            let pick = problem.candidates(cell).iter().copied().find(|&module| {
                problem.links().iter().all(|link| {
                    let (other, pair): (usize, fn(usize, usize) -> (usize, usize)) =
                        if link.from == cell {
                            (link.to, |mine, theirs| (mine, theirs))
                        } else if link.to == cell {
                            (link.from, |mine, theirs| (theirs, mine))
                        } else {
                            return true;
                        };
                    match chosen[other] {
                        None => true,
                        Some(settled) => link.allowed.contains(&pair(module, settled)),
                    }
                })
            });
            match pick {
                Some(module) => chosen[cell] = Some(module),
                None => {
                    return Err(SolveError::Contradiction {
                        detail: format!("first-fit stuck at cell {cell}"),
                    });
                }
            }
        }
        Ok(Assignment::new(chosen.into_iter().map(Option::unwrap).collect()))
    }
}

#[test]
fn an_outside_backend_can_satisfy_the_trait_and_solve() {
    let graph = triangle_graph();
    let tileset = distinct_neighbours(3);
    let problem = Problem::compile(&graph, &tileset, &[]).unwrap();

    let assignment = solve_verified(&FirstFitSolver, &problem, 0).expect("first-fit solves this");
    assert_eq!(assignment.violations(&problem), Vec::new());
    // Three mutually adjacent cells that must differ need three modules.
    let mut used = assignment.modules().to_vec();
    used.sort_unstable();
    assert_eq!(used, vec![0, 1, 2]);
}

/// A deliberately broken backend: the verification wrapper must catch it.
struct AlwaysZeroSolver;

impl ConstraintSolver for AlwaysZeroSolver {
    fn solve(&self, problem: &Problem, _seed: u64) -> Result<Assignment, SolveError> {
        Ok(Assignment::new(vec![0; problem.cell_count()]))
    }
}

#[test]
fn a_backend_that_returns_nonsense_is_rejected_not_trusted() {
    let graph = triangle_graph();
    let tileset = distinct_neighbours(3);
    let problem = Problem::compile(&graph, &tileset, &[]).unwrap();

    let error = solve_verified(&AlwaysZeroSolver, &problem, 0).unwrap_err();
    let SolveError::InvalidResult { violations } = error else {
        panic!("expected the wrapper to reject the assignment");
    };
    assert!(violations.iter().any(|violation| matches!(
        violation,
        Violation::IncompatibleNeighbours { .. }
    )));
}
