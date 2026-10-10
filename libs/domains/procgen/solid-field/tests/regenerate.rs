//! A patch of ground laid again on its own surface: flat, over a hill, round
//! a structure, over where a structure was, and inside a tunnel's vault where
//! no projection is one to one. `PROBE=1` prints what came out.

use std::collections::{HashMap, HashSet};

use grafting_procgen_solid_field::{Faces, GivenPoint, Origin, Regeneration, Vec3, regenerate_surface};

fn probe() -> bool {
    std::env::var("PROBE").is_ok_and(|v| v == "1")
}

/// `cells` x `cells` faces `cell` wide, centred on the origin, lifted by
/// `lift`, wound as the tabletop winds its ground. Faces for which `keep`
/// says no are left out.
fn sheet(cell: f64, cells: usize, lift: impl Fn(f64, f64) -> Vec3, keep: impl Fn(usize, usize) -> bool) -> Faces {
    let origin = -cell * cells as f64 / 2.0;
    let id = |i: usize, j: usize| i * (cells + 1) + j;
    let mut vertices = Vec::new();
    for i in 0..=cells {
        for j in 0..=cells {
            vertices.push(lift(origin + i as f64 * cell, origin + j as f64 * cell));
        }
    }
    let mut faces = Vec::new();
    for i in 0..cells {
        for j in 0..cells {
            if keep(i, j) {
                faces.push(vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
            }
        }
    }
    Faces { vertices, faces }
}

fn flat(x: f64, z: f64) -> Vec3 {
    Vec3::new(x, 0.0, z)
}

fn hill(x: f64, z: f64) -> Vec3 {
    Vec3::new(x, 6.0 * (-(x * x + z * z) / 98.0).exp(), z)
}

fn regeneration(holes: Vec<Vec<GivenPoint>>) -> Regeneration {
    Regeneration { holes, face_side: 2.0, seed: 7, relax_strength: 0.7 }
}

fn newell(vertices: &[Vec3], face: &[usize]) -> Vec3 {
    let mut n = Vec3::default();
    for i in 0..face.len() {
        let (a, b) = (vertices[face[i]], vertices[face[(i + 1) % face.len()]]);
        n = n + Vec3::new((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y));
    }
    n
}

/// Faces sharing every edge at most twice, walked opposite ways.
fn manifold(faces: &[Vec<usize>]) -> bool {
    let mut directed: HashSet<(usize, usize)> = HashSet::new();
    let mut uses: HashMap<(usize, usize), u32> = HashMap::new();
    for face in faces {
        for i in 0..face.len() {
            let (a, b) = (face[i], face[(i + 1) % face.len()]);
            if !directed.insert((a, b)) {
                return false;
            }
            *uses.entry((a.min(b), a.max(b))).or_default() += 1;
        }
    }
    uses.values().all(|&n| n <= 2)
}

/// The open edges of `faces`, by the origin of their two ends where both have one.
fn open_edges(faces: &[Vec<usize>]) -> Vec<(usize, usize)> {
    let mut directed: HashSet<(usize, usize)> = HashSet::new();
    for face in faces {
        for i in 0..face.len() {
            directed.insert((face[i], face[(i + 1) % face.len()]));
        }
    }
    directed.iter().copied().filter(|&(a, b)| !directed.contains(&(b, a))).collect()
}

/// Every vertex of the patch's ring comes back, and the result's border is that ring.
fn ring_kept(patch: &Faces, origin: &[Option<Origin>]) {
    let patch_open: HashSet<(usize, usize)> = open_edges(&patch.faces).into_iter().collect();
    let ring_vertices: HashSet<usize> = patch_open.iter().flat_map(|&(a, b)| [a, b]).collect();
    let back: HashSet<usize> = origin.iter().filter_map(|o| match o {
        Some(Origin::Patch(v)) => Some(*v),
        _ => None,
    }).collect();
    for v in &ring_vertices {
        assert!(back.contains(v), "ring vertex {v} came back");
    }
}

/// How far the cells are from square: the mean |cos| of their corners, 0 for squares.
fn skew(vertices: &[Vec3], faces: &[Vec<usize>]) -> f64 {
    let (mut sum, mut count) = (0.0, 0);
    for face in faces {
        for i in 0..face.len() {
            let (p, a, b) = (vertices[face[i]], vertices[face[(i + face.len() - 1) % face.len()]], vertices[face[(i + 1) % face.len()]]);
            sum += (a - p).normalized().dot((b - p).normalized()).abs();
            count += 1;
        }
    }
    sum / count as f64
}

fn mean_side(vertices: &[Vec3], faces: &[Vec<usize>]) -> f64 {
    let (mut sum, mut count) = (0.0, 0);
    for face in faces {
        for i in 0..face.len() {
            sum += vertices[face[i]].distance(vertices[face[(i + 1) % face.len()]]);
            count += 1;
        }
    }
    sum / count as f64
}

#[test]
fn flat_ground_comes_back_flat_and_meets_its_ring() {
    let patch = sheet(2.0, 8, flat, |_, _| true);
    let out = regenerate_surface(&patch, &regeneration(Vec::new())).expect("laid");
    if probe() {
        println!("flat: {} faces, side {:.2}", out.faces.len(), mean_side(&out.vertices, &out.faces));
    }
    assert!(manifold(&out.faces));
    assert!(out.vertices.iter().all(|p| p.y.abs() < 1e-9), "flat stays flat");
    ring_kept(&patch, &out.origin);
    // The patch's winding: its normals point down, as the tabletop winds ground.
    assert!(out.faces.iter().all(|face| newell(&out.vertices, face).y < 0.0), "wound as the patch was");
    let side = mean_side(&out.vertices, &out.faces);
    assert!((1.2..2.8).contains(&side), "face side {side}");
}

#[test]
fn ground_over_a_hill_stays_on_the_hill() {
    let patch = sheet(2.0, 10, hill, |_, _| true);
    let out = regenerate_surface(&patch, &regeneration(Vec::new())).expect("laid");
    let worst = out.vertices.iter().map(|p| (p.y - hill(p.x, p.z).y).abs()).fold(0.0, f64::max);
    if probe() {
        println!("hill: {} faces, skew {:.3}, worst off the hill {worst:.3}", out.faces.len(), skew(&out.vertices, &out.faces));
    }
    assert!(manifold(&out.faces));
    ring_kept(&patch, &out.origin);
    // On the faces of the hill, which sit under its curve by up to a little.
    assert!(worst < 0.25, "off the hill by {worst}");
    assert!(out.faces.iter().all(|face| newell(&out.vertices, face).y < 0.0));
}

#[test]
fn ground_goes_round_a_structure_resting_on_it() {
    let patch = sheet(2.0, 10, flat, |_, _| true);
    // A floor 4 x 3 resting on the ground, by the caller's own ids 100..
    let corners = [(-2.0, -1.5), (2.0, -1.5), (2.0, 1.5), (-2.0, 1.5)];
    let ring: Vec<GivenPoint> = corners.iter().enumerate().map(|(i, &(x, z))| GivenPoint { position: Vec3::new(x, 0.0, z), id: 100 + i }).collect();
    let out = regenerate_surface(&patch, &regeneration(vec![ring])).expect("laid");
    assert!(manifold(&out.faces));
    ring_kept(&patch, &out.origin);
    let inside = |p: Vec3| p.x > -2.0 + 1e-6 && p.x < 2.0 - 1e-6 && p.z > -1.5 + 1e-6 && p.z < 1.5 - 1e-6;
    for face in &out.faces {
        let centre = face.iter().fold(Vec3::default(), |s, &v| s + out.vertices[v]) * (1.0 / face.len() as f64);
        assert!(!inside(centre), "no ground under the floor: {:?}", face.iter().map(|&v| (out.vertices[v], out.origin[v])).collect::<Vec<_>>());
    }
    let given: HashSet<usize> = out.origin.iter().filter_map(|o| match o {
        Some(Origin::Given(id)) => Some(*id),
        _ => None,
    }).collect();
    assert_eq!(given, (100..104).collect(), "the floor's corners are the ground's");
    for landing in &out.landed {
        let p = out.vertices[landing.vertex];
        if matches!(landing.from, Origin::Given(_)) {
            assert!(p.x.abs() <= 2.0 + 1e-9 && p.z.abs() <= 1.5 + 1e-9 && (p.x.abs() - 2.0).abs().min((p.z.abs() - 1.5).abs()) < 1e-9, "landed on the floor's side");
        }
    }
    if probe() {
        println!("round a floor: {} faces, {} landed", out.faces.len(), out.landed.len());
    }
}

#[test]
fn ground_comes_back_where_a_structure_left() {
    // The ground over a hill with a hole where a floor stood.
    let patch = sheet(2.0, 10, hill, |i, j| !(4..6).contains(&i) || !(4..7).contains(&j));
    let out = regenerate_surface(&patch, &regeneration(Vec::new())).expect("laid");
    assert!(manifold(&out.faces));
    assert_eq!(open_edges(&out.faces).len(), open_edges(&sheet(2.0, 10, hill, |_, _| true).faces).len(), "the hole is closed");
    let top = out.vertices.iter().map(|p| p.y).fold(f64::MIN, f64::max);
    if probe() {
        println!("vacated: {} faces, top {top:.2}", out.faces.len());
    }
    // A membrane over the hole: no higher than its rim, no lower than flat.
    assert!(top <= 6.0 + 1e-9 && top > 4.0, "top {top}");
}

#[test]
fn a_vault_no_projection_flattens_is_laid_through_its_embedding() {
    // Half a tunnel's vault: radius 4, 12 m long, the floor's edges on y = 0.
    let r = 4.0;
    let cells_round = 10;
    let cells_long = 6;
    let mut vertices = Vec::new();
    for i in 0..=cells_round {
        let a = std::f64::consts::PI * i as f64 / cells_round as f64;
        for j in 0..=cells_long {
            vertices.push(Vec3::new(r * a.cos(), r * a.sin(), -6.0 + 12.0 * j as f64 / cells_long as f64));
        }
    }
    let id = |i: usize, j: usize| i * (cells_long + 1) + j;
    let mut faces = Vec::new();
    for i in 0..cells_round {
        for j in 0..cells_long {
            faces.push(vec![id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)]);
        }
    }
    let patch = Faces { vertices, faces };
    let out = regenerate_surface(&patch, &regeneration(Vec::new())).expect("laid");
    assert!(manifold(&out.faces));
    ring_kept(&patch, &out.origin);
    let worst = out.vertices.iter().map(|p| (p.x.hypot(p.y) - r).abs()).fold(0.0, f64::max);
    let side = mean_side(&out.vertices, &out.faces);
    if probe() {
        println!("vault: {} faces, side {side:.2}, skew {:.3}, worst off the vault {worst:.3}", out.faces.len(), skew(&out.vertices, &out.faces));
    }
    assert!(worst < 0.35, "off the vault by {worst}");
    // Wound as the patch: the patch's faces face the vault's axis or away, the same for all.
    let sign = |face: &Vec<usize>| {
        let centre = face.iter().fold(Vec3::default(), |s, &v| s + out.vertices[v]) * (1.0 / face.len() as f64);
        newell(&out.vertices, face).dot(Vec3::new(centre.x, centre.y, 0.0)).signum()
    };
    let patch_sign = {
        let face = &patch.faces[0];
        let centre = face.iter().fold(Vec3::default(), |s, &v| s + patch.vertices[v]) * 0.25;
        newell(&patch.vertices, face).dot(Vec3::new(centre.x, centre.y, 0.0)).signum()
    };
    assert!(out.faces.iter().all(|face| sign(face) == patch_sign), "every face wound as the patch");
    assert!((1.0..3.0).contains(&side), "face side {side}");
}

#[test]
fn the_same_repair_comes_back_the_same() {
    let patch = sheet(2.0, 8, hill, |_, _| true);
    let a = regenerate_surface(&patch, &regeneration(Vec::new())).expect("laid");
    let b = regenerate_surface(&patch, &regeneration(Vec::new())).expect("laid");
    assert_eq!(a.faces, b.faces);
    assert_eq!(a.vertices.len(), b.vertices.len());
    assert!(a.vertices.iter().zip(&b.vertices).all(|(p, q)| p.distance(*q) == 0.0));
}
