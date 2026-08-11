//! E1.1 measurement spike (`docs/architecture/vtt-roadmap.md`): is the
//! existing `BTreeMap<NodeId, NodeIndex>` translation layer in `Graph<N, E>`
//! fast enough, or does construction need a second, dense-index-only
//! storage backend? Not shipped code -- a throwaway harness whose output
//! feeds `docs/benchmarks/graph-storage-2026-08-11.md`. Run with:
//!   cargo run --release --example storage_bench -p grafting-graph-core

use std::hint::black_box;
use std::time::{Duration, Instant};

use grafting_graph_core::{Edge, EdgeId, Graph, Node, NodeId};

/// Deterministic xorshift PRNG so repeated runs are comparable without a
/// `rand` dependency.
struct Rng(u64);

impl Rng {
    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn next_usize(&mut self, bound: usize) -> usize {
        (self.next_u64() % bound as u64) as usize
    }
}

/// One 6-neighbor prism-grid cell layout, shared by both storage paths so
/// the comparison isolates storage/lookup cost, not topology cost.
struct GridSpec {
    width: u32,
    height: u32,
    layers: u32,
}

impl GridSpec {
    fn cell_count(&self) -> usize {
        (self.width * self.height * self.layers) as usize
    }

    fn index(&self, x: u32, y: u32, l: u32) -> usize {
        ((l * self.height + y) * self.width + x) as usize
    }

    fn id_string(&self, x: u32, y: u32, l: u32) -> String {
        format!("c{l}_{y}_{x}")
    }

    /// 6-slot neighbor cell indices [N, E, S, W, Bottom, Top], `None` at
    /// grid edges -- the same connectivity `PrismGridMesh` already uses.
    fn neighbors(&self, x: u32, y: u32, l: u32) -> [Option<usize>; 6] {
        [
            (y > 0).then(|| self.index(x, y - 1, l)),
            (x + 1 < self.width).then(|| self.index(x + 1, y, l)),
            (y + 1 < self.height).then(|| self.index(x, y + 1, l)),
            (x > 0).then(|| self.index(x - 1, y, l)),
            (l > 0).then(|| self.index(x, y, l - 1)),
            (l + 1 < self.layers).then(|| self.index(x, y, l + 1)),
        ]
    }
}

fn build_existing(spec: &GridSpec) -> (Graph<(), ()>, Duration) {
    let mut nodes = Vec::with_capacity(spec.cell_count());
    let mut edges = Vec::with_capacity(spec.cell_count() * 3);

    for l in 0..spec.layers {
        for y in 0..spec.height {
            for x in 0..spec.width {
                nodes.push(Node::new(NodeId::new(spec.id_string(x, y, l)).unwrap(), ()));
            }
        }
    }

    let mut edge_seq = 0u64;
    for l in 0..spec.layers {
        for y in 0..spec.height {
            for x in 0..spec.width {
                for neighbor in spec.neighbors(x, y, l).into_iter().flatten() {
                    let (nx, ny, nl) = unflatten(spec, neighbor);
                    edge_seq += 1;
                    edges.push(Edge::new(
                        EdgeId::new(format!("e{edge_seq}")).unwrap(),
                        NodeId::new(spec.id_string(x, y, l)).unwrap(),
                        NodeId::new(spec.id_string(nx, ny, nl)).unwrap(),
                        (),
                    ));
                }
            }
        }
    }

    let start = Instant::now();
    let graph = Graph::try_from_parts(nodes, edges).expect("well-formed grid");
    (graph, start.elapsed())
}

fn unflatten(spec: &GridSpec, index: usize) -> (u32, u32, u32) {
    let plane = (spec.width * spec.height) as usize;
    let l = (index / plane) as u32;
    let rem = index % plane;
    let y = (rem / spec.width as usize) as u32;
    let x = (rem % spec.width as usize) as u32;
    (x, y, l)
}

/// Dense baseline: `usize` indices only, no `NodeId`/`String` allocation,
/// no `BTreeMap` -- the floor cost E1.2 would buy by adding a second
/// backend, per the roadmap's stated comparison.
struct DenseGrid {
    neighbors: Vec<[u32; 6]>,
}

fn build_dense(spec: &GridSpec) -> (DenseGrid, Duration) {
    let start = Instant::now();
    let mut neighbors = Vec::with_capacity(spec.cell_count());
    for l in 0..spec.layers {
        for y in 0..spec.height {
            for x in 0..spec.width {
                let slots = spec.neighbors(x, y, l);
                neighbors.push(slots.map(|slot| slot.map(|i| i as u32).unwrap_or(u32::MAX)));
            }
        }
    }
    let elapsed = start.elapsed();
    (DenseGrid { neighbors }, elapsed)
}

fn bench_point_lookup_existing(graph: &Graph<(), ()>, spec: &GridSpec, rng: &mut Rng, iterations: usize) -> Duration {
    let start = Instant::now();
    for _ in 0..iterations {
        let idx = rng.next_usize(spec.cell_count());
        let (x, y, l) = unflatten(spec, idx);
        let id = NodeId::new(spec.id_string(x, y, l)).unwrap();
        black_box(graph.node(&id));
    }
    start.elapsed()
}

fn bench_point_lookup_dense(dense: &DenseGrid, rng: &mut Rng, iterations: usize) -> Duration {
    let start = Instant::now();
    for _ in 0..iterations {
        let idx = rng.next_usize(dense.neighbors.len());
        black_box(dense.neighbors[idx]);
    }
    start.elapsed()
}

/// Simulates repeated brush strokes: each stroke touches a `radius`-cell
/// square cluster on one layer and recomputes the 6-slot neighborhood for
/// every affected cell, matching E1.1's stated measurement target.
fn bench_neighbor_query_existing(
    graph: &Graph<(), ()>,
    spec: &GridSpec,
    rng: &mut Rng,
    strokes: usize,
    radius: u32,
) -> (Duration, usize) {
    let mut touched = 0usize;
    let start = Instant::now();
    for _ in 0..strokes {
        let l = rng.next_usize(spec.layers as usize) as u32;
        let cx = rng.next_usize(spec.width as usize) as u32;
        let cy = rng.next_usize(spec.height as usize) as u32;
        for dy in 0..radius {
            for dx in 0..radius {
                let x = (cx + dx).min(spec.width - 1);
                let y = (cy + dy).min(spec.height - 1);
                let id = NodeId::new(spec.id_string(x, y, l)).unwrap();
                black_box(graph.successors(&id).unwrap());
                black_box(graph.predecessors(&id).unwrap());
                touched += 1;
            }
        }
    }
    (start.elapsed(), touched)
}

fn bench_neighbor_query_dense(
    dense: &DenseGrid,
    spec: &GridSpec,
    rng: &mut Rng,
    strokes: usize,
    radius: u32,
) -> (Duration, usize) {
    let mut touched = 0usize;
    let start = Instant::now();
    for _ in 0..strokes {
        let l = rng.next_usize(spec.layers as usize) as u32;
        let cx = rng.next_usize(spec.width as usize) as u32;
        let cy = rng.next_usize(spec.height as usize) as u32;
        for dy in 0..radius {
            for dx in 0..radius {
                let x = (cx + dx).min(spec.width - 1);
                let y = (cy + dy).min(spec.height - 1);
                let idx = spec.index(x, y, l);
                black_box(dense.neighbors[idx]);
                touched += 1;
            }
        }
    }
    (start.elapsed(), touched)
}

fn run_preset(name: &str, spec: GridSpec) {
    println!("\n=== {name}: {}x{}x{} = {} cells ===", spec.width, spec.height, spec.layers, spec.cell_count());

    let (graph, existing_build) = build_existing(&spec);
    let (dense, dense_build) = build_dense(&spec);
    println!(
        "bulk insertion   existing={:>10.3?}  dense={:>10.3?}  ratio={:.1}x",
        existing_build,
        dense_build,
        existing_build.as_secs_f64() / dense_build.as_secs_f64().max(1e-12)
    );

    let mut rng = Rng(0x9E3779B97F4A7C15 ^ spec.cell_count() as u64);
    let lookup_iterations = 20_000;
    let existing_lookup = bench_point_lookup_existing(&graph, &spec, &mut rng, lookup_iterations);
    let dense_lookup = bench_point_lookup_dense(&dense, &mut rng, lookup_iterations);
    println!(
        "point lookup x{lookup_iterations}  existing={:>10.3?}  dense={:>10.3?}  ratio={:.1}x  (existing/op={:.0}ns)",
        existing_lookup,
        dense_lookup,
        existing_lookup.as_secs_f64() / dense_lookup.as_secs_f64().max(1e-12),
        existing_lookup.as_nanos() as f64 / lookup_iterations as f64
    );

    let strokes = 200;
    let radius = 7; // ~49 cells/stroke, a plausible single brush-stroke footprint
    let (existing_neighbor, touched) = bench_neighbor_query_existing(&graph, &spec, &mut rng, strokes, radius);
    let (dense_neighbor, _) = bench_neighbor_query_dense(&dense, &spec, &mut rng, strokes, radius);
    println!(
        "neighbor query x{strokes} strokes ({touched} cell-recomputes)  existing={:>10.3?}  dense={:>10.3?}  ratio={:.1}x  (existing/stroke={:.1}us)",
        existing_neighbor,
        dense_neighbor,
        existing_neighbor.as_secs_f64() / dense_neighbor.as_secs_f64().max(1e-12),
        existing_neighbor.as_secs_f64() * 1_000_000.0 / strokes as f64
    );
}

fn main() {
    run_preset("small (~1k)", GridSpec { width: 18, height: 18, layers: 3 });
    run_preset("medium (~10k)", GridSpec { width: 58, height: 58, layers: 3 });
    run_preset("large (~100k)", GridSpec { width: 183, height: 183, layers: 3 });
}
