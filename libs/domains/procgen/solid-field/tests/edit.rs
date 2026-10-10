//! Carving into a hill of irregular-sized quads and filling over flat ground,
//! as edits of the ground's own mesh. `PROBE=1` prints what came out.

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use grafting_procgen_solid_field::{Effect, EditedSurface, Faces, Form, Shape, SurfaceEdit, Vec3, edit_surface};

fn probe() -> bool {
    std::env::var("PROBE").is_ok_and(|v| v == "1")
}

/// Square ground of `cells` x `cells` faces `cell` wide, centred on the origin,
/// wound as the tabletop winds its ground (normal by the right hand pointing down).
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

fn hill(x: f64, z: f64) -> f64 {
    6.0 * (-(x * x + z * z) / (2.0 * 7.0 * 7.0)).exp()
}

/// The faces within `reach` of any shape, as the patch; the rest as context.
fn split(all: &Faces, shapes: &[Shape], reach: f64) -> (Faces, Faces, Vec<usize>) {
    let near = |face: &Vec<usize>| face.iter().any(|&v| shapes.iter().any(|s| s.distance(all.vertices[v]) < reach));
    let mut patch = Faces::default();
    let mut context = Faces::default();
    let mut patch_of: HashMap<usize, usize> = HashMap::new();
    let mut patch_vertices: Vec<usize> = Vec::new();
    for face in &all.faces {
        if near(face) {
            let mapped = face
                .iter()
                .map(|&v| {
                    *patch_of.entry(v).or_insert_with(|| {
                        patch.vertices.push(all.vertices[v]);
                        patch_vertices.push(v);
                        patch.vertices.len() - 1
                    })
                })
                .collect();
            patch.faces.push(mapped);
        } else {
            context.faces.push(face.clone());
        }
    }
    context.vertices = all.vertices.clone();
    (patch, context, patch_vertices)
}

fn edge_uses(faces: &[Vec<usize>]) -> HashMap<(usize, usize), usize> {
    let mut uses = HashMap::new();
    for face in faces {
        for i in 0..face.len() {
            let (a, b) = (face[i], face[(i + 1) % face.len()]);
            *uses.entry((a.min(b), a.max(b))).or_default() += 1;
        }
    }
    uses
}

/// Checks every promise an edit makes, and returns the share of quads.
fn assert_edit(name: &str, patch: &Faces, out: &EditedSurface, face_side: f64) -> f64 {
    // The ring: the patch's open borders, by patch vertex.
    let patch_uses = edge_uses(&patch.faces);
    let ring: HashSet<(usize, usize)> = patch_uses.iter().filter(|(_, n)| **n == 1).map(|(e, _)| *e).collect();
    let ring_vertices: HashSet<usize> = ring.iter().flat_map(|&(a, b)| [a, b]).collect();

    // Every ring vertex comes back, at its very position.
    let returned: HashMap<usize, usize> = out.source.iter().enumerate().filter_map(|(v, s)| s.map(|s| (s, v))).collect();
    for &v in &ring_vertices {
        let Some(&at) = returned.get(&v) else { panic!("{name}: ring vertex {v} lost") };
        assert!(out.vertices[at].distance(patch.vertices[v]) < 1e-9, "{name}: ring vertex {v} moved");
    }
    // The result's open borders are exactly the ring's edges.
    let uses = edge_uses(&out.faces);
    let open: HashSet<(usize, usize)> = uses
        .iter()
        .filter(|(_, n)| **n == 1)
        .map(|(&(a, b), _)| {
            let (sa, sb) = (out.source[a], out.source[b]);
            match (sa, sb) {
                (Some(sa), Some(sb)) => (sa.min(sb), sa.max(sb)),
                _ => (usize::MAX, usize::MAX),
            }
        })
        .collect();
    assert_eq!(open, ring, "{name}: the result's open border is the ring, edge for edge");
    assert!(uses.values().all(|&n| n <= 2), "{name}: no edge held by three faces");

    // No face folded back over the one beside it.
    let normal = |face: &Vec<usize>| {
        let mut n = Vec3::default();
        for i in 0..face.len() {
            let (a, b) = (out.vertices[face[i]], out.vertices[face[(i + 1) % face.len()]]);
            n = n + Vec3::new((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y));
        }
        n.normalized()
    };
    let mut beside: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    for (f, face) in out.faces.iter().enumerate() {
        for i in 0..face.len() {
            let (a, b) = (face[i], face[(i + 1) % face.len()]);
            beside.entry((a.min(b), a.max(b))).or_default().push(f);
        }
    }
    let folds = beside.values().filter(|fs| fs.len() == 2 && normal(&out.faces[fs[0]]).dot(normal(&out.faces[fs[1]])) < -0.2).count();
    if probe() {
        println!("{name}: {folds} folded edges");
    }
    assert!(folds * 100 <= beside.len(), "{name}: {folds} edges folded over");

    let quads = out.faces.iter().filter(|f| f.len() == 4).count() as f64 / out.faces.len() as f64;
    let sides: Vec<f64> = out
        .faces
        .iter()
        .flat_map(|f| (0..f.len()).map(move |i| (f[i], f[(i + 1) % f.len()])))
        .map(|(a, b)| out.vertices[a].distance(out.vertices[b]))
        .collect();
    let mean = sides.iter().sum::<f64>() / sides.len() as f64;
    if probe() {
        println!("{name}: {} faces ({:.0}% quads), {} vertices, mean side {mean:.2} for {face_side}", out.faces.len(), quads * 100.0, out.vertices.len());
    }
    assert!(quads > 0.6, "{name}: mostly quads ({:.0}%)", quads * 100.0);
    assert!(mean > face_side * 0.5 && mean < face_side * 1.6, "{name}: faces near {face_side} wide, mean side {mean:.2}");
    quads
}

#[test]
fn a_sphere_carved_into_the_hillside_lays_back_irregular_ground_on_the_same_ring() {
    let all = ground(2.0, 20, hill);
    let shapes = vec![Shape::capsule(Effect::Carve, vec![Vec3::new(-6.0, hill(-6.0, 0.0), 0.0)], 2.5)];
    let blend = 0.8;
    let (patch, context, _) = split(&all, &shapes, 2.5 + blend + 2.0 * 2.0);
    let started = Instant::now();
    let out = edit_surface(&patch, &context, &SurfaceEdit { shapes: shapes.clone(), blend, face_side: 2.0, seed: 7, table: None, neighbours: Faces::default() }).expect("the edit lays");
    if probe() {
        println!("sphere: {} ms", started.elapsed().as_millis());
    }
    assert_edit("sphere", &patch, &out, 2.0);
    // A crater: some corner sits well under where the hill was.
    let deepest = out.vertices.iter().map(|p| p.y - hill(p.x, p.z)).fold(f64::INFINITY, f64::min);
    assert!(deepest < -1.5, "dug into the hill: {deepest:.2}");
}

#[test]
fn a_tunnel_carved_through_the_hill_opens_both_sides_and_keeps_its_roof() {
    let all = ground(2.0, 20, hill);
    let y = 1.9;
    let shapes = vec![Shape::capsule(Effect::Carve, vec![Vec3::new(-14.0, y, 0.0), Vec3::new(14.0, y, 0.0)], 1.8)];
    let blend = 0.6;
    let (patch, context, _) = split(&all, &shapes, 1.8 + blend + 2.0 * 2.0);
    let started = Instant::now();
    let out = edit_surface(&patch, &context, &SurfaceEdit { shapes: shapes.clone(), blend, face_side: 1.5, seed: 7, table: None, neighbours: Faces::default() }).expect("the edit lays");
    if probe() {
        println!("tunnel: {} ms", started.elapsed().as_millis());
    }
    assert_edit("tunnel", &patch, &out, 1.5);
    // Over the middle of the tunnel: a floor, a ceiling and the hill on top.
    let over: Vec<f64> = out.vertices.iter().filter(|p| p.x.abs() < 1.5 && p.z.abs() < 0.8).map(|p| p.y).collect();
    let (low, high) = (over.iter().copied().fold(f64::INFINITY, f64::min), over.iter().copied().fold(f64::NEG_INFINITY, f64::max));
    assert!(low < y - 1.0, "a floor under the axis: {low:.2}");
    assert!(over.iter().any(|&h| h > y + 1.0 && h < y + 2.5), "a ceiling over the axis: {over:?}");
    assert!(high > 5.0, "the hill still stands over it: {high:.2}");
}

#[test]
fn an_earth_bridge_filled_over_flat_ground_rises_from_it_on_the_same_ring() {
    let all = ground(2.0, 16, |_, _| 0.0);
    let shapes = vec![Shape {
        effect: Effect::Fill,
        path: vec![Vec3::new(-9.0, -0.5, 0.0), Vec3::new(-4.0, 3.0, 0.0), Vec3::new(4.0, 3.0, 0.0), Vec3::new(9.0, -0.5, 0.0)],
        radius: 1.2,
        form: Form::Swept { squash: 1.0 },
        up: Vec::new(),
        brush: Default::default(),
    }];
    let blend = 0.5;
    let (patch, context, _) = split(&all, &shapes, 1.2 + blend + 2.0 * 2.0);
    let out = edit_surface(&patch, &context, &SurfaceEdit { shapes: shapes.clone(), blend, face_side: 1.2, seed: 7, table: None, neighbours: Faces::default() }).expect("the edit lays");
    assert_edit("bridge", &patch, &out, 1.2);
    let top = out.vertices.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max);
    assert!(top > 3.5, "the deck stands over the ground: {top:.2}");
}

#[test]
fn a_tunnel_whose_patch_reaches_only_past_its_axis_still_lays() {
    // The tabletop measures reach from the shape's axis, a radius short of
    // its surface; the roof over the tunnel is thinner than the grid there.
    let all = ground(2.0, 20, hill);
    let y = hill(-14.0, 0.0) + 1.8 * 1.05;
    let shapes = vec![Shape::capsule(Effect::Carve, vec![Vec3::new(-14.0, y, 0.0), Vec3::new(14.0, y, 0.0)], 1.8)];
    let blend = 1.8 * 0.35;
    let (patch, context, _) = split(&all, &shapes, blend + 2.0 * 2.0);
    let out = edit_surface(&patch, &context, &SurfaceEdit { shapes, blend, face_side: 1.08, seed: 1, table: None, neighbours: Faces::default() }).expect("the edit lays");
    assert_edit("axis reach", &patch, &out, 1.08);
}

/// A layer of earth laid along a stroke, or taken away along it.
fn mound(effect: Effect, path: Vec<Vec3>, radius: f64, height: f64) -> Shape {
    let effect = if effect == Effect::Fill { Effect::Raise } else { Effect::Lower };
    Shape { effect, path, radius, form: Form::Profile { height }, up: Vec::new(), brush: Default::default() }
}

fn no_folds(name: &str, out: &EditedSurface) {
    let uses = edge_uses(&out.faces);
    assert!(uses.values().all(|&n| n <= 2), "{name}: no edge held by three faces");
}

#[test]
fn a_pile_of_earth_on_the_bare_table_rests_on_it() {
    let shapes = vec![mound(Effect::Fill, vec![Vec3::new(-5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 0.0)], 4.0, 2.0)];
    let empty = Faces::default();
    let out = edit_surface(&empty, &empty, &SurfaceEdit { shapes, blend: 0.8, face_side: 2.0, seed: 3, table: Some(0.0), neighbours: Faces::default() }).expect("laid on the table");
    no_folds("pile on the table", &out);
    let top = out.vertices.iter().map(|v| v.y).fold(f64::MIN, f64::max);
    let bottom = out.vertices.iter().map(|v| v.y).fold(f64::MAX, f64::min);
    let uses = edge_uses(&out.faces);
    let foot: HashSet<usize> = uses.iter().filter(|&(_, &n)| n == 1).flat_map(|(&(a, b), _)| [a, b]).collect();
    if probe() {
        println!("pile on the table: {} faces, {bottom:.2}..{top:.2}, foot {}", out.faces.len(), foot.len());
    }
    assert!(out.faces.len() > 10);
    assert!((1.7..2.6).contains(&top), "about the pile's height: {top}");
    assert!(bottom > -0.05, "nothing under the table: {bottom}");
    let high_foot: Vec<f64> = foot.iter().map(|&v| out.vertices[v].y).filter(|y| y.abs() >= 0.3).collect();
    assert!(!foot.is_empty() && high_foot.is_empty(), "its foot rests on the table: {high_foot:?}");
    // Wound as the tabletop winds ground: normals by the right hand point down.
    let down = out.faces.iter().filter(|f| {
        let mut n = 0.0;
        for i in 0..f.len() {
            let (a, b) = (out.vertices[f[i]], out.vertices[f[(i + 1) % f.len()]]);
            n += (a.z - b.z) * (a.x + b.x);
        }
        n < 0.0
    }).count();
    assert!(down * 10 >= out.faces.len() * 9, "wound as tabletop ground: {down} of {}", out.faces.len());
}

#[test]
fn a_pile_laid_off_the_edge_of_the_ground_runs_on_onto_the_table() {
    // Ground over x < 0 only, wide enough that some stands beyond the pile's
    // reach; the pile runs from it out over the bare table.
    let all = ground(2.0, 16, |_, _| 0.0);
    let half = Faces { vertices: all.vertices.clone(), faces: all.faces.iter().filter(|f| f.iter().all(|&v| all.vertices[v].x <= 0.0)).cloned().collect() };
    let shapes = vec![mound(Effect::Fill, vec![Vec3::new(-4.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 0.0)], 3.0, 2.0)];
    let (patch, context, _) = split(&half, &shapes, 3.0 + 0.8 + 4.0);
    let out = edit_surface(&patch, &context, &SurfaceEdit { shapes, blend: 0.8, face_side: 2.0, seed: 3, table: Some(0.0), neighbours: Faces::default() }).expect("laid");
    no_folds("pile off the edge", &out);
    let reach = out.vertices.iter().map(|v| v.x).fold(f64::MIN, f64::max);
    if probe() {
        println!("pile off the edge: {} faces, reaches x {reach:.2}", out.faces.len());
    }
    assert!(reach > 5.0, "runs on over the table: {reach}");
    assert!(out.source.iter().any(Option::is_some), "and meets the ground's ring");
}

#[test]
fn a_trench_dug_along_flat_ground_goes_down_as_deep_as_asked() {
    let all = ground(2.0, 12, |_, _| 0.0);
    let shapes = vec![mound(Effect::Carve, vec![Vec3::new(-5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 0.0)], 3.0, 2.0)];
    let (patch, context, _) = split(&all, &shapes, 3.0 + 0.8 + 4.0);
    let out = edit_surface(&patch, &context, &SurfaceEdit { shapes, blend: 0.8, face_side: 2.0, seed: 3, table: None, neighbours: Faces::default() }).expect("dug");
    assert_edit("trench", &patch, &out, 2.0);
    let bottom = out.vertices.iter().map(|v| v.y).fold(f64::MAX, f64::min);
    assert!((-2.6..-1.6).contains(&bottom), "about the trench's depth: {bottom}");
}

#[test]
fn a_hillside_levelled_comes_out_flat_where_it_was_levelled() {
    let all = ground(2.0, 12, hill);
    let level = 3.0;
    let path = vec![Vec3::new(-2.0, level, -2.0), Vec3::new(2.0, level, 2.0)];
    let shapes = vec![
        Shape { effect: Effect::Fill, path: path.clone(), radius: 3.0, form: Form::Column { low: level - 4.0, high: level }, up: Vec::new(), brush: Default::default() },
        Shape { effect: Effect::Carve, path, radius: 3.0, form: Form::Column { low: level, high: level + 4.0 }, up: Vec::new(), brush: Default::default() },
    ];
    let (patch, context, _) = split(&all, &shapes, 3.0 + 0.6 + 4.0);
    let out = edit_surface(&patch, &context, &SurfaceEdit { shapes, blend: 0.6, face_side: 2.0, seed: 3, table: None, neighbours: Faces::default() }).expect("levelled");
    assert_edit("level", &patch, &out, 2.0);
    let inside: Vec<f64> = out.vertices.iter().filter(|v| v.x.abs() < 1.0 && v.z.abs() < 1.0).map(|v| v.y).collect();
    if probe() {
        println!("level: {} faces, {} corners inside, {:?}", out.faces.len(), inside.len(), inside.iter().map(|y| (y * 100.0).round() / 100.0).collect::<Vec<_>>());
    }
    assert!(!inside.is_empty() && inside.iter().all(|y| (y - level).abs() < 0.3), "flat at the level inside: {inside:?}");
}

fn folds(out: &EditedSurface) -> (usize, usize) {
    let normal = |face: &Vec<usize>| {
        let mut n = Vec3::default();
        for i in 0..face.len() {
            let (a, b) = (out.vertices[face[i]], out.vertices[face[(i + 1) % face.len()]]);
            n = n + Vec3::new((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y));
        }
        n.normalized()
    };
    let mut beside: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    for (f, face) in out.faces.iter().enumerate() {
        for i in 0..face.len() {
            let (a, b) = (face[i], face[(i + 1) % face.len()]);
            beside.entry((a.min(b), a.max(b))).or_default().push(f);
        }
    }
    let pairs: Vec<&Vec<usize>> = beside.values().filter(|fs| fs.len() == 2).collect();
    (pairs.iter().filter(|fs| normal(&out.faces[fs[0]]).dot(normal(&out.faces[fs[1]])) < -0.2).count(), pairs.len())
}

#[test]
fn a_narrow_tall_layer_over_a_hill_never_doubles_back() {
    let all = ground(2.0, 20, hill);
    let n = (8.0 * std::f64::consts::PI / 0.5).ceil() as usize;
    let path: Vec<Vec3> = (0..=n).map(|i| {
        let a = std::f64::consts::PI * i as f64 / n as f64;
        let (x, z) = (8.0 * a.cos(), 8.0 * a.sin());
        Vec3::new(x, hill(x, z), z)
    }).collect();
    let shapes = vec![mound(Effect::Fill, path, 1.5, 2.0)];
    let (patch, context, _) = split(&all, &shapes, 1.5 + 0.5 + 0.5);
    let out = edit_surface(&patch, &context, &SurfaceEdit { shapes, blend: 0.5, face_side: 2.0, seed: 3, table: Some(0.0), neighbours: Faces::default() }).expect("laid");
    let (f, total) = folds(&out);
    if probe() {
        println!("narrow tall layer: {} faces, {f} folds of {total}", out.faces.len());
    }
    assert!(f * 100 <= total, "{f} folds of {total} sides");
}
