//! How the cost of each engine call scales with map size.
//!
//! A local edit must cost what the edit touches, not what the map holds. On
//! fields of 1 600, 6 400 and 14 400 faces this measured, before and after:
//!
//! | call                                    | before            | after          |
//! |-----------------------------------------|-------------------|----------------|
//! | seeded `region_topologies_in_bounds`    | 39 / 157 / 945 ms | 5 / 9 / 6 ms   |
//! | `apply_patch_replacement` of one face   | 17 / 70 / 190 ms  | 8 / 43 / 95 ms |
//! | `insert_vertex`                         | 0.3 / 1.8 / 7 ms  | unchanged      |
//!
//! The replacement still copies the map once, to publish atomically and keep
//! undo history; `insert_vertex` still prunes every unused edge. Both remain
//! linear in map size. Ignored by default because it builds large fields; run
//! it with `cargo test --release -p grafting-procgen-construction-wasm --lib
//! session_cost_probe -- --ignored --nocapture`.

use std::collections::BTreeMap;
use std::time::Instant;

use serde_json::json;

use crate::mesh;
use crate::session::ConstructionSession;

fn node(x: usize, z: usize) -> String {
    format!("n{x:04}_{z:04}")
}

/// Canonical edge id for a pair, and whether walking `a -> b` reverses it.
fn edge(a: &str, b: &str) -> (String, bool) {
    if a < b { (format!("seg:{a}~{b}"), false) } else { (format!("seg:{b}~{a}"), true) }
}

fn boundary(x: usize, z: usize) -> Vec<serde_json::Value> {
    let ring = [node(x, z), node(x + 1, z), node(x + 1, z + 1), node(x, z + 1)];
    (0..4)
        .map(|i| {
            let (id, reversed) = edge(&ring[i], &ring[(i + 1) % 4]);
            json!({"edgeId": id, "reversed": reversed})
        })
        .collect()
}

fn field(width: usize) -> ConstructionSession {
    let mut session = ConstructionSession::new();
    let mut nodes = Vec::new();
    let mut edges = BTreeMap::new();
    let mut regions = Vec::new();
    for z in 0..=width {
        for x in 0..=width {
            nodes.push(json!({"id": node(x, z), "position": [x as f32, 0.0, z as f32]}));
        }
    }
    for z in 0..width {
        for x in 0..width {
            let ring = [node(x, z), node(x + 1, z), node(x + 1, z + 1), node(x, z + 1)];
            for i in 0..4 {
                let (a, b) = (&ring[i], &ring[(i + 1) % 4]);
                let (id, reversed) = edge(a, b);
                let (start, end) = if reversed { (b, a) } else { (a, b) };
                edges
                    .entry(id.clone())
                    .or_insert_with(|| json!({"edgeId": id, "startNodeId": start, "endNodeId": end}));
            }
            regions.push(json!({
                "regionId": format!("cell:{x}:{z}"),
                "boundary": boundary(x, z),
                "surfaceType": "terrain",
                "physical": true,
            }));
        }
    }
    let request = json!({"nodes": nodes, "edges": edges.values().collect::<Vec<_>>(), "regions": regions});
    session.add_patch_json(&request.to_string()).expect("field registers");
    session
}

fn key(session: &ConstructionSession, name: &str) -> Vec<String> {
    let id = session
        .known_regions
        .iter()
        .find(|id| id.as_str() == name)
        .unwrap_or_else(|| panic!("no region {name}; e.g. {:?}", session.known_regions.iter().next()));
    mesh::region_id_to_wire(id)
}

fn timed<T>(label: &str, run: impl FnOnce() -> T) -> T {
    let started = Instant::now();
    let result = run();
    println!("PROBE   {label}: {:.2?}", started.elapsed());
    result
}

#[test]
#[ignore = "benchmark: builds fields of up to 14 400 faces; run with --release -- --ignored"]
fn probe_engine_call_cost_by_map_size() {
    for width in [40, 80, 120] {
        println!("PROBE {width}x{width} = {} faces", width * width);
        let mut session = timed("build", || field(width));
        let centre = width / 2;

        timed("all_region_topologies_json", || session.all_region_topologies_json().ok().unwrap().len());

        let seed = key(&session, &format!("cell:{centre}:{centre}"));
        let bounds = json!({
            "minX": centre as f64 - 8.0, "minZ": centre as f64 - 8.0,
            "maxX": centre as f64 + 8.0, "maxZ": centre as f64 + 8.0,
            "seeds": [{"seed": seed, "surfaceType": "terrain"}],
        })
        .to_string();
        let found = timed("region_topologies_in_bounds_json (seeded, 16x16 box)", || {
            session.region_topologies_in_bounds_json(&bounds).ok().unwrap()
        });
        println!("PROBE     -> {} bytes", found.len());

        for step in 0..3 {
            let (a, b) = (node(centre + step, centre), node(centre + step + 1, centre));
            let (id, reversed) = edge(&a, &b);
            let (start, end) = if reversed { (&b, &a) } else { (&a, &b) };
            let mid = format!("probe-mid-{step}");
            let first = edge(start, &mid).0;
            let second = edge(&mid, end).0;
            let request = json!({
                "edgeId": id, "nodeId": mid,
                "position": [(centre + step) as f32 + 0.5, 0.0, centre as f32],
                "firstEdgeId": first, "secondEdgeId": second,
            })
            .to_string();
            timed(&format!("insert_vertex_json #{step}"), || session.insert_vertex_json(&request).ok().expect("split"));
        }

        for step in 0..4 {
            let (x, z) = (centre + 3 + step, centre + 3);
            let request = json!({
                "operationId": format!("probe-replace-{step}"),
                "sourceSurfaceKeys": [key(&session, &format!("cell:{x}:{z}"))],
                "patch": {"nodes": [], "edges": [], "regions": [{
                    "regionId": format!("probe-face-{step}"),
                    "boundary": boundary(x, z),
                    "surfaceType": "path",
                    "physical": true,
                }]},
            })
            .to_string();
            timed(&format!("apply_patch_replacement_json #{step} (1 face)"), || {
                session.apply_patch_replacement_json(&request).ok().expect("replace")
            });
        }
    }
}
