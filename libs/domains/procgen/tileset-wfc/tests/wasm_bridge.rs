//! The flat ABI, exercised natively through `solve_inner`.
//!
//! Requires a backend, since the bridge's job is to run one end to end.

#![cfg(feature = "solver-wfc")]

use grafting_procgen_tileset_wfc::wasm::solve_inner;

/// Four cells in a ring, each with four faces. Cell `n` meets cell `n + 1`
/// across its face 1, arriving at face 3; the ring closes between 0 and 3.
fn ring_links() -> Vec<u32> {
    vec![
        0, 1, 1, 3, //
        1, 1, 2, 3, //
        2, 1, 3, 3, //
        0, 3, 3, 1, //
    ]
}

/// `ground` shows socket 0 everywhere; `corner` shows socket 1 on two adjacent
/// faces, so it is asymmetric and expands into four orientations.
const SOCKETS: [u32; 8] = [0, 0, 0, 0, 1, 1, 0, 0];
const WEIGHTS: [f32; 2] = [1.0, 1.0];
const COMPATIBLE: [u32; 4] = [0, 0, 1, 1];
const LATERAL: [u32; 4] = [0, 1, 2, 3];

fn solve(seed: u32, pinned: &[u32]) -> Result<Vec<u32>, String> {
    solve_inner(4, 4, &ring_links(), &SOCKETS, &WEIGHTS, &COMPATIBLE, &LATERAL, pinned, seed)
        .map(|solution| solution.sources())
}

#[test]
fn a_ring_solves_and_every_cell_names_an_authored_module() {
    let solution =
        solve_inner(4, 4, &ring_links(), &SOCKETS, &WEIGHTS, &COMPATIBLE, &LATERAL, &[], 42)
            .expect("the ring is satisfiable");

    assert_eq!(solution.modules().len(), 4);
    assert_eq!(solution.sources().len(), 4);
    assert_eq!(solution.turns().len(), 4);
    assert!(solution.sources().iter().all(|&source| source < 2), "sources index the input");
    assert!(solution.turns().iter().all(|&turns| turns < 4), "turns stay within a lap");
    // ground collapses to one variant, corner expands to four.
    assert_eq!(solution.variant_count(), 5);
}

#[test]
fn the_same_seed_gives_the_same_map() {
    // The reason a seed exists at all: the map is replicated state, and two
    // hosts generating "the same" map have to agree bit for bit.
    assert_eq!(solve(7, &[]).unwrap(), solve(7, &[]).unwrap());
}

#[test]
fn pinning_an_authored_module_admits_all_of_its_orientations() {
    // The rotation-aware part. A caller pins the module it authored; if the
    // pin only admitted the unrotated variant, pinning a rotatable piece
    // would quietly over-constrain the map.
    let solution =
        solve_inner(4, 4, &ring_links(), &SOCKETS, &WEIGHTS, &COMPATIBLE, &LATERAL, &[0, 1], 3)
            .expect("pinning a corner leaves the ring satisfiable");
    assert_eq!(solution.sources()[0], 1, "cell 0 must take the module it was pinned to");
}

#[test]
fn a_malformed_links_array_is_reported_not_guessed() {
    let error = solve_inner(4, 4, &[0, 1, 1], &SOCKETS, &WEIGHTS, &COMPATIBLE, &LATERAL, &[], 1)
        .expect_err("three numbers is not a whole link");
    assert!(error.contains("links"), "unhelpful message: {error}");
}

#[test]
fn a_rotation_naming_a_face_the_cells_lack_is_refused() {
    let error =
        solve_inner(4, 4, &ring_links(), &SOCKETS, &WEIGHTS, &COMPATIBLE, &[0, 1, 2, 9], &[], 1)
            .expect_err("face 9 does not exist on a four-faced cell");
    assert!(error.contains('9'), "the message should name the face: {error}");
}

#[test]
fn a_weight_count_that_disagrees_with_the_sockets_is_refused() {
    let error = solve_inner(4, 4, &ring_links(), &SOCKETS, &[1.0], &COMPATIBLE, &LATERAL, &[], 1)
        .expect_err("two modules were described but one weight given");
    assert!(error.contains("weights"), "unhelpful message: {error}");
}

#[test]
fn a_pin_naming_a_cell_outside_the_graph_is_refused() {
    let error = solve(1, &[9, 0]).expect_err("cell 9 is outside a four-cell ring");
    assert!(error.contains('9'), "the message should name the cell: {error}");
}

#[test]
fn an_impossible_tileset_is_reported_rather_than_searched_for() {
    // Sockets 0 and 1 never meet, so no two neighbours can agree. This must
    // come back as an error naming the link, not as an unbounded search.
    let error = solve_inner(
        4,
        4,
        &ring_links(),
        &[0, 0, 0, 0, 1, 1, 1, 1],
        &WEIGHTS,
        &[0, 0],
        &LATERAL,
        &[1, 1],
        1,
    )
    .expect_err("a pinned module that meets nothing makes the ring impossible");
    assert!(!error.is_empty());
}
