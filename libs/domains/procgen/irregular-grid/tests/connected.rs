use std::collections::{HashMap, HashSet};

use grafting_procgen_irregular_grid::constrained::{ConstrainedOptions, ConstraintPoint};
use grafting_procgen_irregular_grid::hex::{lattice_covering, lattice_triangle_area};
use grafting_procgen_irregular_grid::mesh::Vec2;
use grafting_procgen_irregular_grid::relax::RelaxOptions;
use grafting_procgen_irregular_grid::{QuadMesh, build_constrained_quad_grid};

fn ring(points: &[(f64, f64)]) -> Vec<ConstraintPoint> {
    points.iter().map(|&(x, y)| ConstraintPoint { position: Vec2 { x, y }, source: None }).collect()
}

fn walked_square(low: f64, high: f64, step: f64) -> Vec<(f64, f64)> {
    let mut points = Vec::new();
    let mut at = low;
    while at < high { points.push((at, low)); at += step; }
    let mut at = low;
    while at < high { points.push((high, at)); at += step; }
    let mut at = high;
    while at > low { points.push((at, high)); at -= step; }
    let mut at = high;
    while at > low { points.push((low, at)); at -= step; }
    points
}

/// Every undirected edge, and how many quads use it.
fn edge_uses(mesh: &QuadMesh) -> HashMap<(usize, usize), usize> {
    let mut uses: HashMap<(usize, usize), usize> = HashMap::new();
    for quad in &mesh.quads {
        for index in 0..4 {
            let a = quad[index];
            let b = quad[(index + 1) % 4];
            *uses.entry(if a < b { (a, b) } else { (b, a) }).or_default() += 1;
        }
    }
    uses
}

/// How many connected components the quads form, joined through shared edges.
fn components(mesh: &QuadMesh) -> usize {
    let mut by_edge: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    for (face, quad) in mesh.quads.iter().enumerate() {
        for index in 0..4 {
            let a = quad[index];
            let b = quad[(index + 1) % 4];
            by_edge.entry(if a < b { (a, b) } else { (b, a) }).or_default().push(face);
        }
    }
    let mut seen: HashSet<usize> = HashSet::new();
    let mut found = 0;
    for start in 0..mesh.quads.len() {
        if !seen.insert(start) { continue; }
        found += 1;
        let mut stack = vec![start];
        while let Some(face) = stack.pop() {
            let quad = mesh.quads[face];
            for index in 0..4 {
                let a = quad[index];
                let b = quad[(index + 1) % 4];
                for &other in by_edge.get(&if a < b { (a, b) } else { (b, a) }).into_iter().flatten() {
                    if seen.insert(other) { stack.push(other); }
                }
            }
        }
    }
    found
}

fn build(boundary: Vec<(f64, f64)>, face_side: f64) -> QuadMesh {
    let triangle_side = face_side * 3.0;
    let options = ConstrainedOptions {
        boundary: vec![ring(&boundary)],
        holes: Vec::new(),
        seeds: lattice_covering(Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 24.0, y: 24.0 }, triangle_side),
        seed_clearance: triangle_side * 0.25,
        max_area: lattice_triangle_area(triangle_side),
        min_area: lattice_triangle_area(triangle_side) * 0.15,
        min_angle_degrees: 30.0,
        max_additional_vertices: 50_000,
    };
    build_constrained_quad_grid(&options, 7, &RelaxOptions::standard()).expect("built").mesh
}

/// Every quad, wound the same way, and every interior edge walked once in
/// each direction. A mesh that fails this looks correct and cannot be
/// registered: two faces meeting on an edge both claim the same side of it.
fn orientation(mesh: &QuadMesh) -> (usize, usize) {
    let mut backwards = 0;
    for quad in &mesh.quads {
        let mut twice = 0.0;
        for index in 0..4 {
            let a = mesh.vertices[quad[index]];
            let b = mesh.vertices[quad[(index + 1) % 4]];
            twice += a.x * b.y - b.x * a.y;
        }
        if twice <= 0.0 {
            backwards += 1;
        }
    }
    let mut directed: HashMap<(usize, usize), usize> = HashMap::new();
    for quad in &mesh.quads {
        for index in 0..4 {
            *directed.entry((quad[index], quad[(index + 1) % 4])).or_default() += 1;
        }
    }
    let clashes = directed.values().filter(|&&n| n > 1).count();
    (backwards, clashes)
}

fn check(label: &str, mesh: &QuadMesh) {
    let uses = edge_uses(mesh);
    let over = uses.values().filter(|&&n| n > 2).count();
    let boundary = uses.values().filter(|&&n| n == 1).count();
    let parts = components(mesh);
    let (backwards, clashes) = orientation(mesh);
    println!(
        "{label}: {backwards} quads wound backwards, {clashes} edges walked the same way twice"
    );
    println!(
        "{label}: {} quads, {} vertices, {} edges ({boundary} on the rim, {over} used more than twice), {parts} component(s)",
        mesh.quads.len(),
        mesh.vertices.len(),
        uses.len(),
    );
    assert_eq!(over, 0, "{label}: an edge used by more than two quads is not a surface");
    assert_eq!(parts, 1, "{label}: the generated quads must be one mesh, not {parts} pieces");
}

#[test]
fn a_generated_grid_is_one_connected_surface() {
    check("open corners  ", &build(vec![(0.0,0.0),(24.0,0.0),(24.0,24.0),(0.0,24.0)], 2.0));
    check("walked at 2.0 ", &build(walked_square(0.0, 24.0, 2.0), 2.0));
    check("walked at 1.0 ", &build(walked_square(0.0, 24.0, 1.0), 2.0));
    check("small walked  ", &build(walked_square(0.0, 8.0, 2.0), 2.0));
}
