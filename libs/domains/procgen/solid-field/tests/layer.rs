//! A layer laid on the ground, on the bare table and over a hill, as the
//! ground's own surface moved and laid again (`layer_surface`).

use std::collections::{HashMap, HashSet};

use grafting_procgen_solid_field::{Effect, Faces, Form, LayerEdit, Origin, Shape, Vec3, layer_surface};

/// Square ground of `cells` x `cells` faces `cell` wide, centred on the
/// origin, wound as the tabletop winds its ground: counter-clockwise in plan.
fn ground(cell: f64, cells: usize, height: impl Fn(f64, f64) -> f64) -> Faces {
    let origin = -cell * cells as f64 / 2.0;
    let id = |i: usize, j: usize| i * (cells + 1) + j;
    let mut vertices = Vec::new();
    for i in 0..=cells {
        for j in 0..=cells {
            let (x, z) = (origin + i as f64 * cell, origin + j as f64 * cell);
            vertices.push(Vec3::new(x, height(x, z), z));
        }
    }
    let mut faces = Vec::new();
    for i in 0..cells {
        for j in 0..cells {
            faces.push(vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
        }
    }
    Faces { vertices, faces }
}

fn raise(path: Vec<Vec3>, radius: f64, height: f64) -> Shape {
    Shape { effect: Effect::Raise, path, radius, form: Form::Profile { height }, up: Vec::new(), brush: Default::default() }
}

/// Twice the signed area of a face in plan: positive counter-clockwise.
fn plan_area(vertices: &[Vec3], face: &[usize]) -> f64 {
    (0..face.len()).map(|i| {
        let (a, b) = (vertices[face[i]], vertices[face[(i + 1) % face.len()]]);
        a.x * b.z - b.x * a.z
    }).sum()
}

fn edges(faces: &[Vec<usize>]) -> HashMap<(usize, usize), usize> {
    let mut uses = HashMap::new();
    for face in faces {
        for i in 0..face.len() {
            let (a, b) = (face[i], face[(i + 1) % face.len()]);
            *uses.entry((a.min(b), a.max(b))).or_default() += 1;
        }
    }
    uses
}

#[test]
fn a_layer_laid_on_the_bare_table_rises_from_it_as_deep_as_asked() {
    let edit = LayerEdit { shapes: vec![raise(vec![Vec3::new(-5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 0.0)], 4.0, 2.0)], blend: 0.5, face_side: 1.0, seed: 3, table: Some(0.0), beds: Vec::new() };
    let out = layer_surface(&Faces::default(), &Faces::default(), &Faces::default(), &edit).expect("the layer lays");
    assert!(out.faces.len() > 20, "{} faces", out.faces.len());
    assert!(out.faces.iter().all(|face| plan_area(&out.vertices, face) > 0.0), "every face wound as the tabletop's ground");
    let top = out.vertices.iter().map(|v| v.y).fold(f64::NEG_INFINITY, f64::max);
    assert!((top - 2.0).abs() < 0.15, "as deep as asked on the path: {top}");
    let uses = edges(&out.faces);
    let rim: HashSet<usize> = uses.iter().filter(|&(_, &n)| n == 1).flat_map(|(&(a, b), _)| [a, b]).collect();
    assert!(rim.iter().all(|&v| out.vertices[v].y.abs() < 1e-6), "its rim rests on the table");
    assert!(uses.values().all(|&n| n <= 2), "one mesh");
}

#[test]
fn a_layer_laid_over_a_hill_adds_to_it_and_gives_back_its_ring_whole() {
    let hill = |x: f64, z: f64| 4.0 * (-(x * x + z * z) / 50.0).exp();
    let all = ground(2.0, 16, hill);
    let shape = raise(vec![Vec3::new(-4.0, hill(-4.0, 0.0), 0.0), Vec3::new(4.0, hill(4.0, 0.0), 0.0)], 4.0, 1.5);
    let near = |face: &Vec<usize>| face.iter().any(|&v| shape.distance(all.vertices[v]) < 1.0);
    let patch = Faces { vertices: all.vertices.clone(), faces: all.faces.iter().filter(|f| near(f)).cloned().collect() };
    let context = Faces { vertices: all.vertices.clone(), faces: all.faces.iter().filter(|f| !near(f)).cloned().collect() };
    let edit = LayerEdit { shapes: vec![shape], blend: 0.5, face_side: 2.0, seed: 3, table: None, beds: Vec::new() };
    let out = layer_surface(&patch, &context, &Faces::default(), &edit).expect("the layer lays");

    let top = out.vertices.iter().map(|v| v.y).fold(f64::NEG_INFINITY, f64::max);
    // Read at the corners, which fall some way off the path.
    assert!(top > 4.0 + 1.0, "the layer adds to the hill under it: {top}");
    // Every corner of the patch's ring back as itself, and no new corner on a side of it.
    let ring: HashSet<usize> = edges(&patch.faces).into_iter().filter(|&(_, n)| n == 1).flat_map(|((a, b), _)| [a, b]).collect();
    let back: HashSet<usize> = out.origin.iter().flatten().map(|o| match o { Origin::Patch(v) | Origin::Given(v) => *v }).collect();
    assert!(ring.iter().all(|v| back.contains(v)), "the ring comes back whole");
    assert!(out.landed.is_empty(), "no side of the ring split: {:?}", out.landed.len());
    let open = edges(&out.faces).into_iter().filter(|&(_, n)| n == 1).count();
    assert_eq!(open, edges(&patch.faces).into_iter().filter(|&(_, n)| n == 1).count(), "the new ground's border is the ring, side for side");
}
