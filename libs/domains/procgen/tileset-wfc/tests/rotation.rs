//! Generated orientations. Runs without any backend feature.

use grafting_procgen_tileset_wfc::{Module, Rotation, RotationError, Tileset};

/// Four lateral faces that rotate, plus an up and a down face that must not.
fn lateral() -> Rotation {
    Rotation::cycle([0, 1, 2, 3]).expect("a cycle of distinct faces is valid")
}

fn module(name: &str, sockets: [usize; 6]) -> Module {
    Module { name: name.into(), sockets: sockets.to_vec(), weight: 1.0 }
}

#[test]
fn a_repeated_face_is_refused() {
    assert_eq!(
        Rotation::cycle([0, 1, 0]),
        Err(RotationError::RepeatedFace { face: 0 }),
    );
}

#[test]
fn one_turn_moves_each_socket_to_the_next_face_and_leaves_the_rest() {
    // Sockets 10..13 sit on the rotating faces; 8 and 9 on the vertical ones.
    let sockets = [10, 11, 12, 13, 8, 9];
    let turned = lateral().apply(&sockets, 1).expect("faces are in range");
    assert_eq!(turned, vec![13, 10, 11, 12, 8, 9]);
    // The vertical faces are untouched -- the property that makes this usable
    // for a stacked grid, where up and down are not interchangeable with sides.
    assert_eq!(&turned[4..], &[8, 9]);
}

#[test]
fn a_full_lap_returns_the_module_unchanged() {
    let sockets = [10, 11, 12, 13, 8, 9];
    assert_eq!(lateral().apply(&sockets, 4).unwrap(), sockets.to_vec());
}

#[test]
fn an_asymmetric_module_yields_four_orientations() {
    let tileset = Tileset::rotated(
        vec![module("corner", [1, 1, 0, 0, 2, 3])],
        [(0, 0), (1, 1)],
        &lateral(),
    )
    .expect("a single module rotates cleanly");

    assert_eq!(tileset.modules().len(), 4);
    let names: Vec<&str> = tileset.modules().iter().map(|m| m.name.as_str()).collect();
    assert_eq!(names, ["corner", "corner@1", "corner@2", "corner@3"]);
}

#[test]
fn a_symmetric_module_yields_one() {
    // Ground looks the same from every side, so rotating it produces nothing
    // new. Nobody had to declare that; it falls out of the sockets.
    let tileset =
        Tileset::rotated(vec![module("ground", [0, 0, 0, 0, 1, 2])], [(0, 0)], &lateral())
            .expect("a symmetric module collapses to itself");
    assert_eq!(tileset.modules().len(), 1);
    assert_eq!(tileset.modules()[0].name, "ground");
}

#[test]
fn a_two_fold_module_yields_two() {
    // A straight piece maps onto itself after half a turn.
    let tileset =
        Tileset::rotated(vec![module("wall", [1, 0, 1, 0, 2, 3])], [(0, 0), (1, 1)], &lateral())
            .expect("a two-fold module halves");
    assert_eq!(tileset.modules().len(), 2);
}

#[test]
fn weight_is_shared_across_a_module_s_orientations() {
    // The point: a corner must not become four times as common as ground
    // merely because it is asymmetric. Both modules were authored at weight
    // 1.0, so both must end up with a total mass of 1.0.
    let tileset = Tileset::rotated(
        vec![module("ground", [0, 0, 0, 0, 1, 2]), module("corner", [1, 1, 0, 0, 2, 3])],
        [(0, 0), (1, 1)],
        &lateral(),
    )
    .expect("a mixed tileset expands");

    let mass = |prefix: &str| -> f32 {
        tileset
            .modules()
            .iter()
            .filter(|m| m.name.starts_with(prefix))
            .map(|m| m.weight)
            .sum()
    };
    assert!((mass("ground") - 1.0).abs() < 1e-6, "ground mass {}", mass("ground"));
    assert!((mass("corner") - 1.0).abs() < 1e-6, "corner mass {}", mass("corner"));
}

#[test]
fn every_variant_reports_the_module_it_came_from() {
    let tileset = Tileset::rotated(
        vec![module("ground", [0, 0, 0, 0, 1, 2]), module("corner", [1, 1, 0, 0, 2, 3])],
        [(0, 0), (1, 1)],
        &lateral(),
    )
    .expect("a mixed tileset expands");

    // Ground collapses to one variant, so the corner's four start at index 1.
    let origins: Vec<(usize, usize)> = (0..tileset.modules().len())
        .map(|id| {
            let origin = tileset.origin(id).expect("every module has an origin");
            (origin.source, origin.turns)
        })
        .collect();
    assert_eq!(origins, [(0, 0), (1, 0), (1, 1), (1, 2), (1, 3)]);
}

#[test]
fn a_tileset_built_without_rotation_reports_identity_origins() {
    let tileset = Tileset::new(vec![module("a", [0, 0, 0, 0, 0, 0])], [(0, 0)])
        .expect("a plain tileset builds");
    let origin = tileset.origin(0).expect("origins exist even unrotated");
    assert_eq!((origin.source, origin.turns), (0, 0));
}

#[test]
fn the_identity_rotation_changes_nothing() {
    let modules = vec![module("corner", [1, 1, 0, 0, 2, 3])];
    let tileset = Tileset::rotated(modules.clone(), [(0, 0), (1, 1)], &Rotation::none())
        .expect("the identity is a valid rotation");
    assert_eq!(tileset.modules(), modules.as_slice());
}
