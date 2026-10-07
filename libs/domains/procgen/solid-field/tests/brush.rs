//! A terrain editor's brush on the layer (`layer_surface`): strength,
//! falloff and its kinds, smoothing and noise.

use grafting_procgen_solid_field::{Brush, Effect, Faces, FalloffKind, Form, LayerEdit, Shape, Vec3, layer_surface};

/// Square ground of `cells` x `cells` faces `cell` wide, centred on the origin, counter-clockwise in plan.
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

fn shape(effect: Effect, radius: f64, height: f64, brush: Brush) -> Shape {
    Shape { effect, path: vec![Vec3::new(0.0, 0.0, 0.0)], radius, form: Form::Profile { height }, up: Vec::new(), brush }
}

/// The ground laid again under `shape` -- every face within its radius and a face more.
fn laid(all: &Faces, shape: Shape) -> Vec<Vec3> {
    let reach = shape.radius + 1.0;
    let near = |face: &Vec<usize>| face.iter().any(|&v| all.vertices[v].x.hypot(all.vertices[v].z) < reach);
    let patch = Faces { vertices: all.vertices.clone(), faces: all.faces.iter().filter(|f| near(f)).cloned().collect() };
    let context = Faces { vertices: all.vertices.clone(), faces: all.faces.iter().filter(|f| !near(f)).cloned().collect() };
    let edit = LayerEdit { shapes: vec![shape], blend: 0.5, face_side: 0.5, seed: 3, table: None, beds: Vec::new() };
    layer_surface(&patch, &context, &Faces::default(), &edit).expect("the brush lays").vertices
}

/// The height of the laid ground nearest `(x, z)`.
fn at(vertices: &[Vec3], x: f64, z: f64) -> f64 {
    vertices.iter().min_by(|a, b| (a.x - x).hypot(a.z - z).total_cmp(&(b.x - x).hypot(b.z - z))).unwrap().y
}

#[test]
fn falloff_kinds_shape_the_raise_between_its_middle_and_its_rim() {
    let flat = ground(0.5, 32, |_, _| 0.0);
    let with = |kind| laid(&flat, shape(Effect::Raise, 6.0, 2.0, Brush { falloff: 0.5, kind, ..Brush::default() }));
    let (linear, spherical, tip) = (with(FalloffKind::Linear), with(FalloffKind::Spherical), with(FalloffKind::Tip));
    // Inside the falloff the whole height, for every kind.
    for vertices in [&linear, &spherical, &tip] {
        assert!((at(vertices, 1.5, 0.0) - 2.0).abs() < 0.05, "full inside the falloff: {}", at(vertices, 1.5, 0.0));
    }
    // Halfway through the falloff: a dome over a ramp over a spike.
    let (l, s, t) = (at(&linear, 4.5, 0.0), at(&spherical, 4.5, 0.0), at(&tip, 4.5, 0.0));
    assert!(s > l + 0.3 && l > t + 0.3, "spherical {s} > linear {l} > tip {t}");
    assert!(at(&linear, 7.0, 0.0).abs() < 1e-9, "nothing past the rim");
}

#[test]
fn a_smooth_takes_a_bump_most_of_the_way_down_and_leaves_the_ground_past_its_rim() {
    let bumpy = ground(0.5, 32, |x, z| if x.hypot(z) < 1.0 { 2.0 } else { 0.0 });
    let vertices = laid(&bumpy, shape(Effect::Smooth, 4.0, 0.0, Brush { strength: 1.0, falloff: 0.3, filter: 0.6, ..Brush::default() }));
    let top = at(&vertices, 0.0, 0.0);
    assert!(top < 1.2, "the bump smoothed down: {top}");
    assert!(top > 0.0, "never below the ground round it");
    assert!(at(&vertices, 6.0, 0.0).abs() < 1e-9, "past the rim untouched");
}

#[test]
fn noise_roughens_level_ground_within_the_brush_only() {
    let flat = ground(0.5, 32, |_, _| 0.0);
    let vertices = laid(&flat, shape(Effect::Noise, 5.0, 1.0, Brush { strength: 1.0, falloff: 0.2, noise_scale: 2.0, ..Brush::default() }));
    let inside: Vec<f64> = vertices.iter().filter(|v| v.x.hypot(v.z) < 3.0).map(|v| v.y).collect();
    let spread = inside.iter().cloned().fold(f64::NEG_INFINITY, f64::max) - inside.iter().cloned().fold(f64::INFINITY, f64::min);
    assert!(spread > 0.3, "rough inside the brush: {spread}");
    assert!(vertices.iter().filter(|v| v.x.hypot(v.z) > 5.5).all(|v| v.y.abs() < 1e-9), "level past it");
}
