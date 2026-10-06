//! Carving into a hill of irregular-sized quads and filling over flat ground,
//! as edits of the ground's own mesh. `PROBE=1` prints what came out.

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use grafting_procgen_solid_field::{Effect, EditedSurface, Faces, Shape, SurfaceEdit, Vec3, edit_surface};

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
    let shapes = vec![Shape { effect: Effect::Carve, path: vec![Vec3::new(-6.0, hill(-6.0, 0.0), 0.0)], radius: 2.5 }];
    let blend = 0.8;
    let (patch, context, _) = split(&all, &shapes, 2.5 + blend + 2.0 * 2.0);
    let started = Instant::now();
    let out = edit_surface(&patch, &context, &SurfaceEdit { shapes: shapes.clone(), blend, face_side: 2.0, seed: 7 }).expect("the edit lays");
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
    let shapes = vec![Shape { effect: Effect::Carve, path: vec![Vec3::new(-14.0, y, 0.0), Vec3::new(14.0, y, 0.0)], radius: 1.8 }];
    let blend = 0.6;
    let (patch, context, _) = split(&all, &shapes, 1.8 + blend + 2.0 * 2.0);
    let started = Instant::now();
    let out = edit_surface(&patch, &context, &SurfaceEdit { shapes: shapes.clone(), blend, face_side: 1.5, seed: 7 }).expect("the edit lays");
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
    }];
    let blend = 0.5;
    let (patch, context, _) = split(&all, &shapes, 1.2 + blend + 2.0 * 2.0);
    let out = edit_surface(&patch, &context, &SurfaceEdit { shapes: shapes.clone(), blend, face_side: 1.2, seed: 7 }).expect("the edit lays");
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
    let shapes = vec![Shape { effect: Effect::Carve, path: vec![Vec3::new(-14.0, y, 0.0), Vec3::new(14.0, y, 0.0)], radius: 1.8 }];
    let blend = 1.8 * 0.35;
    let (patch, context, _) = split(&all, &shapes, blend + 2.0 * 2.0);
    let out = edit_surface(&patch, &context, &SurfaceEdit { shapes, blend, face_side: 1.08, seed: 1 }).expect("the edit lays");
    assert_edit("axis reach", &patch, &out, 1.08);
}
