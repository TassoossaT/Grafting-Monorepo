//! Benchmark: fidget as a surface generator for a massing-plus-detail pipeline.
//!
//! Two shapes stand for the two things this project actually needs, chosen so
//! that the answers cannot be read off a datasheet:
//!
//! - `building` — a box with window openings cut out of it. Sharp edges, and
//!   the case a CSG library would normally be reached for. Under an implicit
//!   kernel a boolean is just `min`/`max`, so it tests whether a separate CSG
//!   dependency is needed at all.
//! - `rock` — smoothly blended spheres. The organic case that split grammars
//!   are documented to be worst at, and the reason to look at implicits.
//!
//! Every run reports a hash of the mesh as well as its size and timing.
//! `DEC-016`/`ADR-0004` make the map replicated state, so a generator that is
//! merely *fast* is useless if two hosts disagree about what it produced.

use std::time::Instant;

use fidget::context::Tree;
use fidget::mesh::{Octree, Settings};
use fidget::vm::VmShape;

/// Axis-aligned box as a signed distance-ish field, centred on the origin.
fn boxed(hx: f64, hy: f64, hz: f64) -> Tree {
    let dx = Tree::x().abs() - hx;
    let dy = Tree::y().abs() - hy;
    let dz = Tree::z().abs() - hz;
    dx.max(dy).max(dz)
}

fn translated(t: Tree, x: f64, y: f64, z: f64) -> Tree {
    t.remap_xyz(Tree::x() - x, Tree::y() - y, Tree::z() - z)
}

fn sphere(r: f64, x: f64, y: f64, z: f64) -> Tree {
    let dx = Tree::x() - x;
    let dy = Tree::y() - y;
    let dz = Tree::z() - z;
    (dx.square() + dy.square() + dz.square()).sqrt() - r
}

/// Polynomial smooth minimum -- how an implicit kernel blends rather than joins.
fn smooth_min(a: Tree, b: Tree, k: f64) -> Tree {
    // h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1)
    let h = (Tree::constant(0.5) + (b.clone() - a.clone()) * (0.5 / k))
        .max(Tree::constant(0.0))
        .min(Tree::constant(1.0));
    let mixed = b.clone() + (a - b) * h.clone();
    mixed - h.clone() * (Tree::constant(1.0) - h) * k
}

/// A wall with four openings: the "building" case, all sharp edges.
fn building() -> Tree {
    let shell = boxed(0.8, 0.5, 0.15);
    let mut solid = shell;
    for (x, y) in [(-0.4, 0.15), (0.0, 0.15), (0.4, 0.15), (0.0, -0.25)] {
        let opening = translated(boxed(0.12, 0.12, 0.4), x, y, 0.0);
        // Difference: max(solid, -opening).
        solid = solid.max(-opening);
    }
    solid
}

/// Blended spheres: the "rock" case, all curvature.
fn rock() -> Tree {
    let mut blob = sphere(0.45, -0.25, -0.1, 0.0);
    for (r, x, y, z) in [
        (0.38, 0.28, 0.05, 0.1),
        (0.30, 0.0, 0.30, -0.15),
        (0.26, -0.1, -0.35, 0.2),
        (0.22, 0.45, -0.28, -0.1),
    ] {
        blob = smooth_min(blob, sphere(r, x, y, z), 0.25);
    }
    blob
}

/// FNV-1a over the raw bits of every vertex, in order.
///
/// Bit patterns rather than rounded values on purpose: the question is whether
/// two hosts agree exactly, and rounding first would hide precisely the
/// disagreement worth finding.
fn hash_mesh(
    vertices: &[nalgebra::Vector3<f32>],
    triangles: &[nalgebra::Vector3<usize>],
) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut eat = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x1000_0000_01b3);
        }
    };
    for v in vertices {
        eat(&v.x.to_bits().to_le_bytes());
        eat(&v.y.to_bits().to_le_bytes());
        eat(&v.z.to_bits().to_le_bytes());
    }
    for t in triangles {
        for index in t.iter() {
            eat(&(*index as u64).to_le_bytes());
        }
    }
    hash
}

fn run(name: &str, tree: Tree, depth: u8, threads: Option<usize>) {
    let shape = VmShape::from(tree);
    let bound = shape.try_into().expect("no extra vars");

    let mut settings = Settings {
        depth,
        ..Default::default()
    };
    let pool;
    if let Some(count) = threads {
        pool = fidget::render::ThreadPool::Custom(
            rayon::ThreadPoolBuilder::new()
                .num_threads(count)
                .build()
                .expect("thread pool"),
        );
        settings.threads = Some(&pool);
    } else {
        settings.threads = None;
    }

    let started = Instant::now();
    let octree = Octree::build(&bound, &settings).expect("octree");
    let mesh = octree.walk_dual();
    let elapsed = started.elapsed();

    println!(
        "{{\"shape\":\"{name}\",\"depth\":{depth},\"threads\":{},\"vertices\":{},\"triangles\":{},\"hash\":\"{:016x}\",\"ms\":{:.2}}}",
        threads.map(|t| t.to_string()).unwrap_or_else(|| "null".into()),
        mesh.vertices.len(),
        mesh.triangles.len(),
        hash_mesh(&mesh.vertices, &mesh.triangles),
        elapsed.as_secs_f64() * 1000.0,
    );
}

fn main() {
    for depth in [4u8, 5, 6, 7] {
        run("building", building(), depth, None);
        run("rock", rock(), depth, None);
    }
    // Does adding threads change the result, not just the time? On wasm32 there
    // is no pool, so a native host that used one would disagree with a browser.
    for count in [2usize, 4] {
        run("building", building(), 6, Some(count));
        run("rock", rock(), 6, Some(count));
    }
}
