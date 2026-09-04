//! The port produces the grid the TypeScript original produced.
//!
//! This is the only test that can say the port is finished, and it is worth
//! more than any property check beside it. The grid is not merely *a* correct
//! irregular quad mesh -- it is the one already baked into every saved table.
//! A port that satisfies "all quads, positive area, consistent winding" and
//! disagrees on a single coordinate silently reshapes ground people have
//! already built on.
//!
//! The fixture is the TypeScript implementation own output, dumped for one
//! seed before it was deleted. Equality is exact rather than approximate: the
//! two implementations run the same operations in the same order on the same
//! `f64` values, so any drift at all means an operation was reordered, and
//! rounding tolerance would only hide that.

use grafting_procgen_irregular_grid::{
    IrregularQuadGridOptions, RelaxOptions, TriangleHexOptions, build_irregular_quad_grid,
};

struct Fixture {
    vertices: Vec<(f64, f64)>,
    quads: Vec<[usize; 4]>,
}

fn load_fixture() -> Fixture {
    let raw = include_str!("fixtures/typescript-seed-7.txt");
    let mut lines = raw.lines().filter(|line| !line.trim().is_empty());

    let header: Vec<usize> = lines
        .next()
        .expect("fixture header")
        .split_whitespace()
        .map(|value| value.parse().expect("count"))
        .collect();
    let (vertex_count, quad_count) = (header[0], header[1]);

    let vertices = (0..vertex_count)
        .map(|_| {
            let line = lines.next().expect("vertex line");
            let mut parts = line.split_whitespace();
            let x = parts.next().expect("x").parse().expect("x is a number");
            let y = parts.next().expect("y").parse().expect("y is a number");
            (x, y)
        })
        .collect();

    let quads = (0..quad_count)
        .map(|_| {
            let line = lines.next().expect("quad line");
            let parts: Vec<usize> =
                line.split_whitespace().map(|value| value.parse().expect("index")).collect();
            [parts[0], parts[1], parts[2], parts[3]]
        })
        .collect();

    Fixture { vertices, quads }
}

fn seed_7() -> IrregularQuadGridOptions {
    IrregularQuadGridOptions {
        seed: 7,
        hex: TriangleHexOptions { triangles_per_side: 4, triangle_side: 0.5 },
        relax: RelaxOptions::standard(),
    }
}

#[test]
fn the_port_reproduces_the_typescript_grid_exactly() {
    let expected = load_fixture();
    let actual = build_irregular_quad_grid(&seed_7());

    assert_eq!(actual.vertices.len(), expected.vertices.len(), "vertex count");
    assert_eq!(actual.quads.len(), expected.quads.len(), "quad count");

    for (index, (produced, wanted)) in
        actual.vertices.iter().zip(expected.vertices.iter()).enumerate()
    {
        assert_eq!(
            (produced.x, produced.y),
            *wanted,
            "vertex {index} moved between the two implementations"
        );
    }

    for (index, (produced, wanted)) in actual.quads.iter().zip(expected.quads.iter()).enumerate() {
        assert_eq!(produced, wanted, "quad {index} is made of different corners");
    }
}

#[test]
fn the_same_seed_always_produces_the_same_grid() {
    let first = build_irregular_quad_grid(&seed_7());
    let second = build_irregular_quad_grid(&seed_7());
    assert_eq!(first.vertices, second.vertices);
    assert_eq!(first.quads, second.quads);
}

#[test]
fn different_seeds_produce_different_grids() {
    let first = build_irregular_quad_grid(&seed_7());
    let mut other = seed_7();
    other.seed = 8;
    let second = build_irregular_quad_grid(&other);
    assert_ne!(first.quads, second.quads);
}
