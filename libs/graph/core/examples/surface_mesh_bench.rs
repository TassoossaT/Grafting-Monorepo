//! Measures the complete surface invalidation -> polygon derivation path that
//! `ADR-0022` left open after E1.1 measured graph traversal alone.
//!
//! Run the representative presets with:
//!   cargo run --release --example surface_mesh_bench -p grafting-graph-core
//!
//! Add `--huge` to include the one-million-surface construction case.

use std::collections::BTreeSet;
use std::hint::black_box;
use std::time::{Duration, Instant};

use grafting_graph_core::{move_node, Graph, Node, NodeId, SurfaceRegistry, SurfaceType};

const STROKES: usize = 200;
const BRUSH_SIDE: usize = 7;

#[derive(Debug)]
struct DerivedMesh {
    vertices: Vec<[f32; 3]>,
    triangle_indices: Vec<u32>,
    centroid: [f32; 3],
    normal: [f32; 3],
}

fn node_id(x: usize, y: usize) -> NodeId {
    NodeId::new(format!("v/{x}/{y}")).expect("generated node ids are valid")
}

fn derive_mesh(graph: &Graph<[f32; 3], ()>, cycle: &[NodeId]) -> DerivedMesh {
    let vertices = cycle
        .iter()
        .map(|id| {
            *graph
                .node(id)
                .expect("surface nodes remain in the graph")
                .data()
        })
        .collect::<Vec<_>>();

    let mut centroid = [0.0; 3];
    let mut normal = [0.0; 3];
    for (index, current) in vertices.iter().enumerate() {
        let next = vertices[(index + 1) % vertices.len()];
        centroid[0] += current[0];
        centroid[1] += current[1];
        centroid[2] += current[2];
        normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
        normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
        normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
    }
    let inverse_len = 1.0 / vertices.len() as f32;
    centroid.iter_mut().for_each(|value| *value *= inverse_len);

    let normal_length =
        (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
    if normal_length > f32::EPSILON {
        normal.iter_mut().for_each(|value| *value /= normal_length);
    }

    let mut triangle_indices = Vec::with_capacity(vertices.len().saturating_sub(2) * 3);
    for index in 1..vertices.len().saturating_sub(1) {
        triangle_indices.extend_from_slice(&[0, index as u32, (index + 1) as u32]);
    }

    DerivedMesh {
        vertices,
        triangle_indices,
        centroid,
        normal,
    }
}

fn build_grid(width: usize, height: usize) -> (Graph<[f32; 3], ()>, SurfaceRegistry, Duration) {
    let started = Instant::now();
    let mut nodes = Vec::with_capacity((width + 1) * (height + 1));
    for y in 0..=height {
        for x in 0..=width {
            nodes.push(Node::new(node_id(x, y), [x as f32, 0.0, y as f32]));
        }
    }

    let graph = Graph::try_from_parts(nodes, Vec::new()).expect("grid node ids are unique");
    let mut surfaces = SurfaceRegistry::new();
    for y in 0..height {
        for x in 0..width {
            surfaces
                .add_surface(
                    &graph,
                    vec![
                        node_id(x, y),
                        node_id(x + 1, y),
                        node_id(x + 1, y + 1),
                        node_id(x, y + 1),
                    ],
                    SurfaceType::new("terrain"),
                    true,
                )
                .expect("regular grid surfaces are unique and valid");
        }
    }
    (graph, surfaces, started.elapsed())
}

fn run_strokes(
    graph: &mut Graph<[f32; 3], ()>,
    surfaces: &SurfaceRegistry,
    width: usize,
    height: usize,
) -> (Duration, usize, usize) {
    let mut derived_surfaces = 0;
    let mut derived_vertices = 0;
    let started = Instant::now();

    for stroke in 0..STROKES {
        let available_x = width.saturating_sub(BRUSH_SIDE).max(1);
        let available_y = height.saturating_sub(BRUSH_SIDE).max(1);
        let start_x = (stroke * 37) % available_x;
        let start_y = (stroke * 53) % available_y;
        let mut affected = BTreeSet::new();

        for y in start_y..(start_y + BRUSH_SIDE).min(height + 1) {
            for x in start_x..(start_x + BRUSH_SIDE).min(width + 1) {
                let keys = move_node(graph, surfaces, &node_id(x, y), |position| {
                    position[1] += 0.01
                })
                .expect("brush nodes remain in the graph");
                affected.extend(keys);
            }
        }

        for key in affected {
            let surface = surfaces
                .surface(&key)
                .expect("reverse index returns registered surfaces");
            let mesh = derive_mesh(graph, surface.cycle());
            derived_surfaces += 1;
            derived_vertices += mesh.vertices.len();
            black_box((&mesh.triangle_indices, mesh.centroid, mesh.normal));
        }
    }

    (started.elapsed(), derived_surfaces, derived_vertices)
}

fn run_preset(name: &str, width: usize, height: usize) {
    let surface_count = width * height;
    let (mut graph, surfaces, build) = build_grid(width, height);
    let (elapsed, derived_surfaces, derived_vertices) =
        run_strokes(&mut graph, &surfaces, width, height);
    println!(
        "{name:>5} surfaces={surface_count:>8} build={build:>9.3?} strokes={STROKES} total={elapsed:>9.3?} per_stroke={:>8.1}us derived/stroke={:>6.1} vertices/stroke={:>7.1}",
        elapsed.as_secs_f64() * 1_000_000.0 / STROKES as f64,
        derived_surfaces as f64 / STROKES as f64,
        derived_vertices as f64 / STROKES as f64,
    );
}

fn main() {
    println!("surface invalidation + polygon derivation benchmark");
    println!("threshold: 1.67ms per 7x7-node brush stroke (10% of a 60fps frame)");
    run_preset("1k", 32, 32);
    run_preset("10k", 100, 100);
    run_preset("100k", 316, 316);
    if std::env::args().any(|argument| argument == "--huge") {
        run_preset("1m", 1000, 1000);
    }
}
