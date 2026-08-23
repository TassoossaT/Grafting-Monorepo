use serde_json::json;
use wasm_bindgen_test::wasm_bindgen_test;

use crate::mesh;
use crate::path_brush;
use crate::session::ConstructionSession;

fn terrain_cell(
    session: &mut ConstructionSession,
    cell: usize,
    width: usize,
    y: f32,
    nodes: [&str; 4],
) {
    let x = (cell % width) as f32;
    let z = (cell / width) as f32;
    let corners = [
        [x, y, z],
        [x + 1.0, y, z],
        [x + 1.0, y, z + 1.0],
        [x, y, z + 1.0],
    ];
    let mut edges = Vec::new();
    let mut boundary = Vec::new();
    for index in 0..4 {
        let from = nodes[index];
        let to = nodes[(index + 1) % 4];
        let forward = from < to;
        let (start, end) = if forward { (from, to) } else { (to, from) };
        let edge_id = format!("seg:{start}~{end}");
        edges.push(json!({"edgeId": edge_id, "startNodeId": start, "endNodeId": end}));
        boundary.push(json!({"edgeId": edge_id, "reversed": !forward}));
    }
    let request = json!({
        "nodes": nodes
            .iter()
            .zip(corners.iter())
            .map(|(id, position)| json!({"id": id, "position": position}))
            .collect::<Vec<_>>(),
        "edges": edges,
        "regions": [{
            "regionId": nodes.join("|"),
            "boundary": boundary,
            "surfaceType": "terrain",
            "physical": true,
        }],
    });
    session
        .add_patch_json(&request.to_string())
        .expect("terrain patch registers");
}

#[wasm_bindgen_test]
fn a_full_session_sequence_generates_moves_and_merges() {
    let mut session = ConstructionSession::new();

    terrain_cell(&mut session, 0, 2, 1.0, ["n0", "n1", "n2", "n3"]);
    terrain_cell(&mut session, 1, 2, 1.0, ["n4", "n5", "n6", "n7"]);

    let move_response = session
        .move_vertex_json(r#"{"nodeId":"n0","position":[9.0,9.0,9.0]}"#)
        .expect("n0 exists");
    assert!(
        move_response.contains("@region"),
        "a generated cell is an analytic region, and moving its vertex must report it: {move_response}"
    );

    let snapshot = session.snapshot_json().expect("snapshot always succeeds");
    assert!(snapshot.contains("\"n0\""));
    assert!(snapshot.contains("\"surfaces\""));
}

#[test]
fn applying_path_brush_replaces_terrain_through_the_wasm_boundary() {
    let mut session = ConstructionSession::new();
    terrain_cell(&mut session, 0, 2, 0.0, ["n0", "n1", "n2", "n3"]);

    let request = r#"{"operationId":"path-1","samples":[[0.5,0.5]],"brushShape":{"kind":"circle","radius":0.25},"depth":0.1,"sourceSurfaceTypes":["terrain"],"targetSurfaceType":"path"}"#;
    let before = session.snapshot_json().expect("snapshot before the stroke");
    let response = session
        .apply_path_brush_json(request)
        .expect("path brush applies");
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert!(!parsed["surfaceIds"]["created"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(session.snapshot_json().unwrap().contains("\"path\""));

    let meshes: Vec<serde_json::Value> =
        serde_json::from_str(&session.all_surface_meshes_json().unwrap()).unwrap();
    assert!(meshes.iter().any(|mesh| mesh["surfaceType"] == "path"));
    assert!(meshes.iter().any(|mesh| mesh["surfaceType"] == "terrain"));

    session
        .undo_path_brush("path-1")
        .expect("whole stroke undoes");
    assert_eq!(session.snapshot_json().unwrap(), before);
    session
        .redo_path_brush("path-1")
        .expect("whole stroke redoes");
    assert!(session.snapshot_json().unwrap().contains("\"path\""));
}

#[test]
fn a_multi_segment_stroke_over_terrain_leaves_a_derivable_remainder_mesh() {
    let mut session = ConstructionSession::new();
    for cell in 0..16 {
        let x = cell % 4;
        let z = cell / 4;
        terrain_cell(
            &mut session,
            cell,
            4,
            0.0,
            [
                &format!("n{x}-{z}-0"),
                &format!("n{x}-{z}-1"),
                &format!("n{x}-{z}-2"),
                &format!("n{x}-{z}-3"),
            ],
        );
    }

    let request = serde_json::json!({
        "operationId": "path-multi-1",
        "samples": [[1.0, 1.0], [3.0, 1.0], [3.0, 3.0], [5.0, 3.0]],
        "brushShape": {"kind": "circle", "radius": 0.5},
        "depth": 0.1,
        "sourceSurfaceTypes": ["terrain"],
        "targetSurfaceType": "path",
    })
    .to_string();

    let response = session
        .apply_path_brush_json(&request)
        .expect("multi-segment path brush applies");
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(
        parsed["surfaceIds"]["created"].as_array().unwrap().len(),
        2,
        "both the remainder terrain and the new path region must be created"
    );

    let meshes_json = session
        .all_surface_meshes_json()
        .expect("every created region, including the remainder, must have a derivable mesh");
    let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
    assert!(meshes.iter().any(|mesh| mesh["surfaceType"] == "path"));
    assert!(
        meshes.iter().any(|mesh| mesh["surfaceType"] == "terrain"),
        "the remainder terrain must still be present and meshable: {meshes_json}"
    );
}

#[test]
fn a_loop_stroke_fully_covering_its_only_terrain_cell_still_meshes() {
    let mut session = ConstructionSession::new();
    terrain_cell(&mut session, 0, 2, 0.0, ["n0", "n1", "n2", "n3"]);

    let loop_samples: Vec<[f32; 2]> = (0..=32)
        .map(|index| {
            let angle = std::f32::consts::TAU * index as f32 / 32.0;
            [1.0 + 3.0 * angle.cos(), 1.0 + 3.0 * angle.sin()]
        })
        .collect();
    let request = serde_json::json!({
        "operationId": "path-loop-cover",
        "samples": loop_samples,
        "brushShape": {"kind": "circle", "radius": 0.5},
        "depth": 0.1,
        "sourceSurfaceTypes": ["terrain"],
        "targetSurfaceType": "path",
    })
    .to_string();

    let response = session
        .apply_path_brush_json(&request)
        .expect("a loop stroke fully covering its only terrain cell must still apply");
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert!(!parsed["surfaceIds"]["created"]
        .as_array()
        .unwrap()
        .is_empty());

    let meshes_json = session
        .all_surface_meshes_json()
        .expect("every created region must have a derivable mesh, remainder included");
    let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
    assert!(meshes.iter().any(|mesh| mesh["surfaceType"] == "path"));
}

#[test]
fn a_second_overlapping_path_brush_stroke_consumes_the_first_ones_region() {
    let mut session = ConstructionSession::new();
    for cell in 0..16 {
        let x = cell % 4;
        let z = cell / 4;
        terrain_cell(
            &mut session,
            cell,
            4,
            0.0,
            [
                &format!("n{x}-{z}-0"),
                &format!("n{x}-{z}-1"),
                &format!("n{x}-{z}-2"),
                &format!("n{x}-{z}-3"),
            ],
        );
    }

    let first = serde_json::json!({
        "operationId": "path-overlap-1",
        "samples": [[1.0, 1.0], [3.0, 1.0]],
        "brushShape": {"kind": "circle", "radius": 0.5},
        "depth": 0.1,
        "sourceSurfaceTypes": ["terrain"],
        "targetSurfaceType": "path",
    })
    .to_string();
    let first_response = session
        .apply_path_brush_json(&first)
        .expect("first path brush applies");
    let first_parsed: serde_json::Value = serde_json::from_str(&first_response).unwrap();
    let first_remainder_region = first_parsed["surfaceIds"]["created"]
        .as_array()
        .unwrap()
        .first()
        .unwrap()
        .clone();

    let second = serde_json::json!({
        "operationId": "path-overlap-2",
        "samples": [[1.5, 0.5], [1.5, 2.5]],
        "brushShape": {"kind": "circle", "radius": 0.5},
        "depth": 0.1,
        "sourceSurfaceTypes": ["terrain"],
        "targetSurfaceType": "path",
    })
    .to_string();
    let response = session
        .apply_path_brush_json(&second)
        .expect("second, overlapping path brush stroke must still apply");
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert!(!parsed["surfaceIds"]["created"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(
        parsed["surfaceIds"]["removed"]
            .as_array()
            .unwrap()
            .contains(&first_remainder_region),
        "the second stroke must report the first stroke's own remainder region as removed: {response}"
    );

    let meshes_json = session
        .all_surface_meshes_json()
        .expect("every surface, including anything from the first stroke, must still mesh");
    let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
    assert!(
        !meshes
            .iter()
            .any(|mesh| mesh["surfaceKey"] == first_remainder_region),
        "the first stroke's own remainder region must no longer be rendered after being consumed"
    );
    assert!(!meshes.is_empty());
}

#[test]
fn a_path_stroke_cuts_a_path_region_from_an_earlier_stroke_regardless_of_type() {
    let mut session = ConstructionSession::new();
    for cell in 0..16 {
        let x = cell % 4;
        let z = cell / 4;
        terrain_cell(
            &mut session,
            cell,
            4,
            0.0,
            [
                &format!("n{x}-{z}-0"),
                &format!("n{x}-{z}-1"),
                &format!("n{x}-{z}-2"),
                &format!("n{x}-{z}-3"),
            ],
        );
    }

    let first = serde_json::json!({
        "operationId": "path-type-1",
        "samples": [[1.0, 1.0], [3.0, 1.0]],
        "brushShape": {"kind": "circle", "radius": 0.5},
        "depth": 0.1,
        "sourceSurfaceTypes": ["terrain"],
        "targetSurfaceType": "path",
    })
    .to_string();
    let first_response = session
        .apply_path_brush_json(&first)
        .expect("first path brush applies");
    let first_parsed: serde_json::Value = serde_json::from_str(&first_response).unwrap();
    let first_path_region = first_parsed["surfaceIds"]["created"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();

    let second = serde_json::json!({
        "operationId": "path-type-2",
        "samples": [[2.0, 1.0]],
        "brushShape": {"kind": "circle", "radius": 0.6},
        "depth": 0.1,
        "sourceSurfaceTypes": ["terrain"],
        "targetSurfaceType": "path",
    })
    .to_string();
    let response = session
        .apply_path_brush_json(&second)
        .expect("second stroke over the first stroke's own path region must still apply");
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert!(
        parsed["surfaceIds"]["removed"]
            .as_array()
            .unwrap()
            .contains(&first_path_region),
        "a path region from an earlier stroke must be cut like anything else under the brush: {response}"
    );
}

#[test]
fn consuming_shared_quads_deletes_the_now_orphaned_center_node() {
    let mut session = ConstructionSession::new();
    let mut corners: Vec<serde_json::Value> = Vec::new();
    let mut corner = |id: &str, x: f32, z: f32| {
        corners.push(serde_json::json!({"id": id, "position": [x, 0.0, z]}));
    };
    corner("q-a", 0.0, 0.0);
    corner("q-b", 1.0, 0.0);
    corner("q-c", 2.0, 0.0);
    corner("q-d", 0.0, 1.0);
    corner("q-e", 1.0, 1.0);
    corner("q-f", 2.0, 1.0);
    corner("q-g", 0.0, 2.0);
    corner("q-h", 1.0, 2.0);
    corner("q-i", 2.0, 2.0);

    let mut quad = |cycle: [&str; 4]| {
        let segment = |from: &str, to: &str| {
            let forward = from < to;
            let (start, end) = if forward { (from, to) } else { (to, from) };
            (
                format!("seg:{start}~{end}"),
                start.to_string(),
                end.to_string(),
                forward,
            )
        };
        let steps: Vec<_> = (0..4)
            .map(|index| segment(cycle[index], cycle[(index + 1) % 4]))
            .collect();
        let edges: Vec<_> = steps
            .iter()
            .map(|(id, start, end, _)| {
                serde_json::json!({"edgeId": id, "startNodeId": start, "endNodeId": end})
            })
            .collect();
        let boundary: Vec<_> = steps
            .iter()
            .map(|(id, _, _, forward)| serde_json::json!({"edgeId": id, "reversed": !forward}))
            .collect();
        session
            .add_patch_json(
                &serde_json::json!({
                    "nodes": corners,
                    "edges": edges,
                    "regions": [{
                        "regionId": cycle.join("|"),
                        "boundary": boundary,
                        "surfaceType": "terrain",
                        "physical": true,
                    }],
                })
                .to_string(),
            )
            .expect("quad patch adds");
    };
    quad(["q-a", "q-b", "q-e", "q-d"]);
    quad(["q-b", "q-c", "q-f", "q-e"]);
    quad(["q-d", "q-e", "q-h", "q-g"]);
    quad(["q-e", "q-f", "q-i", "q-h"]);

    let request = serde_json::json!({
        "operationId": "path-orphan-cleanup",
        "samples": [[1.0, 1.0]],
        "brushShape": {"kind": "circle", "radius": 1.6},
        "depth": 0.1,
        "sourceSurfaceTypes": ["terrain"],
        "targetSurfaceType": "path",
    })
    .to_string();
    let response = session
        .apply_path_brush_json(&request)
        .expect("a brush covering the whole grid applies");
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();

    let removed_node_ids: Vec<&str> = parsed["nodeIds"]["removed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap())
        .collect();
    assert_eq!(
        removed_node_ids,
        vec!["q-e"],
        "only the shared center node has every one of its own edges cancel out: {response}"
    );
    assert!(
        session
            .graph
            .node(&grafting_graph_core::NodeId::new("q-e").unwrap())
            .is_none(),
        "the reported orphan must actually be gone from the graph"
    );
    for surviving in ["q-a", "q-b", "q-c", "q-d", "q-f", "q-g", "q-h", "q-i"] {
        assert!(
            session
                .graph
                .node(&grafting_graph_core::NodeId::new(surviving).unwrap())
                .is_some(),
            "{surviving} still anchors a surviving remainder edge and must not be deleted"
        );
    }
}

#[test]
fn a_single_point_circle_brush_dot_applies_as_a_pure_arc_region() {
    let mut session = ConstructionSession::new();
    let request = r#"{"operationId":"path-dot","samples":[[0.0,0.0]],"brushShape":{"kind":"circle","radius":0.5},"depth":0.1,"sourceSurfaceTypes":["terrain"],"targetSurfaceType":"path"}"#;

    let response = session
        .apply_path_brush_json(request)
        .expect("a pure-arc contour must apply");
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(parsed["surfaceIds"]["created"].as_array().unwrap().len(), 1);
    assert!(session.snapshot_json().unwrap().contains("\"path\""));

    let meshes_json = session.all_surface_meshes_json().unwrap();
    let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
    assert_eq!(
        meshes.len(),
        1,
        "the pure-arc region must produce exactly one mesh: {meshes_json}"
    );
    assert!(
        !meshes[0]["indices"].as_array().unwrap().is_empty(),
        "the pure-arc region's mesh must have real triangles, not be empty: {meshes_json}"
    );
}

#[test]
fn a_self_overlapping_loop_stroke_applies_and_renders_as_one_region() {
    let mut session = ConstructionSession::new();
    let loop_samples: Vec<[f32; 2]> = (0..=32)
        .map(|index| {
            let angle = std::f32::consts::TAU * index as f32 / 32.0;
            [2.0 * angle.cos(), 2.0 * angle.sin()]
        })
        .collect();
    let request = serde_json::json!({
        "operationId": "path-loop",
        "samples": loop_samples,
        "brushShape": {"kind": "circle", "radius": 0.5},
        "depth": 0.1,
        "sourceSurfaceTypes": ["terrain"],
        "targetSurfaceType": "path",
    })
    .to_string();

    let response = session
        .apply_path_brush_json(&request)
        .expect("a self-overlapping loop stroke must apply, not require union normalization");
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(parsed["surfaceIds"]["created"].as_array().unwrap().len(), 1);

    let meshes_json = session.all_surface_meshes_json().unwrap();
    let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
    assert_eq!(
        meshes.len(),
        1,
        "the looped stroke must produce exactly one mesh: {meshes_json}"
    );
    assert!(
        !meshes[0]["indices"].as_array().unwrap().is_empty(),
        "the looped stroke's mesh must have real triangles, not be empty: {meshes_json}"
    );
}

#[test]
fn applying_path_brush_with_no_terrain_at_all_still_creates_the_path() {
    let mut session = ConstructionSession::new();
    let request = r#"{"operationId":"path-empty","samples":[[0.0,0.0],[1.0,0.0]],"brushShape":{"kind":"circle","radius":0.25},"depth":0.1,"sourceSurfaceTypes":["terrain"],"targetSurfaceType":"path"}"#;

    let response = session
        .apply_path_brush_json(request)
        .expect("path brush applies with no terrain underneath");
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(
        parsed["surfaceIds"]["created"].as_array().unwrap().len(),
        1,
        "only the target region is created, there is no source region to make"
    );
    assert!(
        parsed["surfaceIds"]["removed"]
            .as_array()
            .unwrap()
            .is_empty(),
        "nothing existed to remove"
    );
    assert!(session.snapshot_json().unwrap().contains("\"path\""));
}

struct Xorshift(u32);
impl Xorshift {
    fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0
    }
    fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (self.next() as f32 / u32::MAX as f32) * (hi - lo)
    }
}

#[test]
fn many_random_overlapping_strokes_never_leave_an_unmeshable_surface() {
    let mut session = ConstructionSession::new();
    for cell in 0..36 {
        let x = cell % 6;
        let z = cell / 6;
        terrain_cell(
            &mut session,
            cell,
            4,
            0.0,
            [
                &format!("n{x}-{z}-0"),
                &format!("n{x}-{z}-1"),
                &format!("n{x}-{z}-2"),
                &format!("n{x}-{z}-3"),
            ],
        );
    }

    let mut rng = Xorshift(0x9e3779b1);
    for stroke in 0..80 {
        let shape = match rng.next() % 3 {
            0 => serde_json::json!({"kind": "circle", "radius": rng.range(0.3, 1.5)}),
            1 => {
                serde_json::json!({"kind": "square", "size": rng.range(0.6, 3.0), "rotationRadians": rng.range(0.0, 6.28)})
            }
            _ => {
                serde_json::json!({"kind": "hexagon", "radius": rng.range(0.3, 1.5), "rotationRadians": rng.range(0.0, 6.28)})
            }
        };
        let sample_count = 1 + (rng.next() % 3) as usize;
        let samples: Vec<[f32; 2]> = (0..sample_count)
            .map(|_| [rng.range(-1.0, 7.0), rng.range(-1.0, 7.0)])
            .collect();
        let request_json = serde_json::json!({
            "operationId": format!("path-stress-{stroke}"),
            "samples": samples,
            "brushShape": shape,
            "depth": 0.1,
            "sourceSurfaceTypes": ["terrain"],
            "targetSurfaceType": "path",
        })
        .to_string();
        let request: path_brush::ApplyPathBrushRequest = serde_json::from_str(&request_json)
            .unwrap_or_else(|error| panic!("bad request json {request_json}: {error}"));

        let response = match path_brush::apply_path_brush(
            &mut session.graph,
            &mut session.surfaces,
            &mut session.topology,
            &mut session.known_regions,
            request,
        ) {
            Ok(response) => response,
            Err(message) => {
                if message.contains("produced no semantic change") {
                    continue;
                }
                panic!("stroke {stroke} ({request_json}) failed to apply: {message}");
            }
        };
        let response_json = serde_json::to_string(&response).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&response_json).unwrap();

        for key in parsed["surfaceIds"]["created"].as_array().unwrap() {
            let surface_key: Vec<String> = key
                .as_array()
                .unwrap()
                .iter()
                .map(|part| part.as_str().unwrap().to_string())
                .collect();
            if let Err(message) = mesh::surface_mesh(
                &session.graph,
                &session.surfaces,
                &session.topology,
                mesh::SurfaceMeshRequest {
                    surface_key: surface_key.clone(),
                },
            ) {
                panic!(
                    "stroke {stroke} created {surface_key:?} but it doesn't mesh: {message}\nstroke request: {request_json}\nstroke response: {response_json}"
                );
            }
        }
    }
}

#[wasm_bindgen_test]
fn invalid_json_is_rejected_not_panicking() {
    let mut session = ConstructionSession::new();
    let error = session.move_vertex_json("not json").unwrap_err();
    assert!(error.as_string().unwrap().contains("invalid request JSON"));
}

#[wasm_bindgen_test]
fn a_registered_patch_exposes_its_mesh() {
    let mut session = ConstructionSession::new();
    terrain_cell(&mut session, 0, 2, 1.0, ["n0", "n1", "n2", "n3"]);

    let meshes_json = session
        .all_surface_meshes_json()
        .expect("meshes always succeed");
    let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
    assert_eq!(meshes.len(), 1);
    assert_eq!(
        meshes[0]["positions"].as_array().unwrap().len(),
        12,
        "4 vertices * 3 components"
    );
    assert_eq!(
        meshes[0]["indices"].as_array().unwrap().len(),
        6,
        "2 triangles * 3 indices"
    );
}

#[wasm_bindgen_test]
fn a_tower_stamp_patch_meshes_all_four_quarters_cleanly() {
    let mut session = ConstructionSession::new();
    let patch_json = r#"{
        "nodes": [
            {"id": "b0", "position": [2.0, 0.0, 0.0]},
            {"id": "t0", "position": [2.0, 3.0, 0.0]},
            {"id": "b1", "position": [0.0, 0.0, 2.0]},
            {"id": "t1", "position": [0.0, 3.0, 2.0]},
            {"id": "b2", "position": [-2.0, 0.0, 0.0]},
            {"id": "t2", "position": [-2.0, 3.0, 0.0]},
            {"id": "b3", "position": [0.0, 0.0, -2.0]},
            {"id": "t3", "position": [0.0, 3.0, -2.0]}
        ],
        "edges": [
            {"edgeId": "e_b0_b1", "startNodeId": "b0", "endNodeId": "b1", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
            {"edgeId": "e_b1_t1", "startNodeId": "b1", "endNodeId": "t1"},
            {"edgeId": "e_t0_t1", "startNodeId": "t0", "endNodeId": "t1", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
            {"edgeId": "e_t0_b0", "startNodeId": "t0", "endNodeId": "b0"},
            {"edgeId": "e_b1_b2", "startNodeId": "b1", "endNodeId": "b2", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
            {"edgeId": "e_b2_t2", "startNodeId": "b2", "endNodeId": "t2"},
            {"edgeId": "e_t1_t2", "startNodeId": "t1", "endNodeId": "t2", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
            {"edgeId": "e_b2_b3", "startNodeId": "b2", "endNodeId": "b3", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
            {"edgeId": "e_b3_t3", "startNodeId": "b3", "endNodeId": "t3"},
            {"edgeId": "e_t2_t3", "startNodeId": "t2", "endNodeId": "t3", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
            {"edgeId": "e_b3_b0", "startNodeId": "b3", "endNodeId": "b0", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
            {"edgeId": "e_t3_t0", "startNodeId": "t3", "endNodeId": "t0", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}}
        ],
        "regions": [
            {
                "regionId": "r0",
                "boundary": [
                    {"edge": "e_b0_b1", "reversed": false},
                    {"edge": "e_b1_t1", "reversed": false},
                    {"edge": "e_t0_t1", "reversed": true},
                    {"edge": "e_t0_b0", "reversed": false}
                ],
                "surfaceType": "wall-white",
                "physical": true
            },
            {
                "regionId": "r1",
                "boundary": [
                    {"edge": "e_b1_b2", "reversed": false},
                    {"edge": "e_b2_t2", "reversed": false},
                    {"edge": "e_t1_t2", "reversed": true},
                    {"edge": "e_b1_t1", "reversed": true}
                ],
                "surfaceType": "wall-white",
                "physical": true
            },
            {
                "regionId": "r2",
                "boundary": [
                    {"edge": "e_b2_b3", "reversed": false},
                    {"edge": "e_b3_t3", "reversed": false},
                    {"edge": "e_t2_t3", "reversed": true},
                    {"edge": "e_b2_t2", "reversed": true}
                ],
                "surfaceType": "wall-white",
                "physical": true
            },
            {
                "regionId": "r3",
                "boundary": [
                    {"edge": "e_b3_b0", "reversed": false},
                    {"edge": "e_t0_b0", "reversed": true},
                    {"edge": "e_t3_t0", "reversed": true},
                    {"edge": "e_b3_t3", "reversed": true}
                ],
                "surfaceType": "wall-white",
                "physical": true
            }
        ]
    }"#;
    session.add_patch_json(patch_json).unwrap();
    let meshes_json = session.all_surface_meshes_json().unwrap();
    let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
    assert_eq!(meshes.len(), 4);
    for mesh in meshes {
        let positions: Vec<f32> = mesh["positions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap() as f32)
            .collect();
        let indices: Vec<u32> = mesh["indices"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_u64().unwrap() as u32)
            .collect();
        assert!(!indices.is_empty());
        for triangle in indices.chunks_exact(3) {
            let p0 = [
                positions[triangle[0] as usize * 3],
                positions[triangle[0] as usize * 3 + 1],
                positions[triangle[0] as usize * 3 + 2],
            ];
            let p1 = [
                positions[triangle[1] as usize * 3],
                positions[triangle[1] as usize * 3 + 1],
                positions[triangle[1] as usize * 3 + 2],
            ];
            let p2 = [
                positions[triangle[2] as usize * 3],
                positions[triangle[2] as usize * 3 + 1],
                positions[triangle[2] as usize * 3 + 2],
            ];
            let a0 = p0[2].atan2(p0[0]);
            let a1 = p1[2].atan2(p1[0]);
            let a2 = p2[2].atan2(p2[0]);
            let mut span = (a0 - a1).abs().max((a1 - a2).abs()).max((a2 - a0).abs());
            if span > std::f32::consts::PI {
                span = std::f32::consts::TAU - span;
            }
            assert!(
                span < 0.4,
                "triangle cut diagonally across tower: angular span = {span}"
            );
        }
    }
}

#[wasm_bindgen_test]
fn a_curved_wall_with_an_opening_preserves_cylinder_curvature() {
    let mut session = ConstructionSession::new();
    let patch_json = r#"{
        "nodes": [
            {"id": "b0", "position": [2.0, 0.0, 0.0]},
            {"id": "t0", "position": [2.0, 3.0, 0.0]},
            {"id": "b1", "position": [0.0, 0.0, 2.0]},
            {"id": "t1", "position": [0.0, 3.0, 2.0]}
        ],
        "edges": [
            {"edgeId": "e_b0_b1", "startNodeId": "b0", "endNodeId": "b1", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
            {"edgeId": "e_b1_t1", "startNodeId": "b1", "endNodeId": "t1"},
            {"edgeId": "e_t0_t1", "startNodeId": "t0", "endNodeId": "t1", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
            {"edgeId": "e_t0_b0", "startNodeId": "t0", "endNodeId": "b0"}
        ],
        "regions": [
            {
                "regionId": "r0",
                "boundary": [
                    {"edge": "e_b0_b1", "reversed": false},
                    {"edge": "e_b1_t1", "reversed": false},
                    {"edge": "e_t0_t1", "reversed": true},
                    {"edge": "e_t0_b0", "reversed": false}
                ],
                "surfaceType": "wall-white",
                "physical": true
            }
        ]
    }"#;
    session.add_patch_json(patch_json).unwrap();

    let win_patch_json = r#"{
        "nodes": [
            {"id": "w0", "position": [1.847759, 1.0, 0.765366]},
            {"id": "w1", "position": [1.414213, 1.0, 1.414213]},
            {"id": "w2", "position": [1.414213, 2.0, 1.414213]},
            {"id": "w3", "position": [1.847759, 2.0, 0.765366]}
        ],
        "edges": [
            {"edgeId": "e_w0_w1", "startNodeId": "w0", "endNodeId": "w1", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": false}},
            {"edgeId": "e_w1_w2", "startNodeId": "w1", "endNodeId": "w2"},
            {"edgeId": "e_w2_w3", "startNodeId": "w2", "endNodeId": "w3", "geometry": {"kind": "arc", "center": [0.0, 0.0], "clockwise": true}},
            {"edgeId": "e_w3_w0", "startNodeId": "w3", "endNodeId": "w0"}
        ],
        "regions": [
            {
                "regionId": "r_win",
                "boundary": [
                    {"edge": "e_w0_w1", "reversed": false},
                    {"edge": "e_w1_w2", "reversed": false},
                    {"edge": "e_w2_w3", "reversed": false},
                    {"edge": "e_w3_w0", "reversed": false}
                ],
                "surfaceType": "window",
                "physical": false
            }
        ]
    }"#;
    session.add_patch_json(win_patch_json).unwrap();

    let add_hole_json = r#"{
        "surfaceKey": ["@region", "r0"],
        "hole": [
            {"edgeId": "e_w3_w0", "reversed": true},
            {"edgeId": "e_w2_w3", "reversed": true},
            {"edgeId": "e_w1_w2", "reversed": true},
            {"edgeId": "e_w0_w1", "reversed": true}
        ]
    }"#;
    session.add_hole_json(add_hole_json).unwrap();

    let meshes_json = session.all_surface_meshes_json().unwrap();
    let meshes: Vec<serde_json::Value> = serde_json::from_str(&meshes_json).unwrap();
    assert_eq!(meshes.len(), 2, "1 wall with hole + 1 window glass");

    for mesh in meshes {
        let positions: Vec<f32> = mesh["positions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap() as f32)
            .collect();
        let indices: Vec<u32> = mesh["indices"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_u64().unwrap() as u32)
            .collect();
        assert!(!indices.is_empty());

        for chunk in positions.chunks_exact(3) {
            let r = (chunk[0].powi(2) + chunk[2].powi(2)).sqrt();
            assert!(
                (r - 2.0).abs() < 0.05,
                "vertex on curved wall/window flattened off cylinder: r = {r}, pos = {chunk:?}"
            );
        }

        for triangle in indices.chunks_exact(3) {
            let p0 = [
                positions[triangle[0] as usize * 3],
                positions[triangle[0] as usize * 3 + 1],
                positions[triangle[0] as usize * 3 + 2],
            ];
            let p1 = [
                positions[triangle[1] as usize * 3],
                positions[triangle[1] as usize * 3 + 1],
                positions[triangle[1] as usize * 3 + 2],
            ];
            let p2 = [
                positions[triangle[2] as usize * 3],
                positions[triangle[2] as usize * 3 + 1],
                positions[triangle[2] as usize * 3 + 2],
            ];
            let a0 = p0[2].atan2(p0[0]);
            let a1 = p1[2].atan2(p1[0]);
            let a2 = p2[2].atan2(p2[0]);
            let mut span = (a0 - a1).abs().max((a1 - a2).abs()).max((a2 - a0).abs());
            if span > std::f32::consts::PI {
                span = std::f32::consts::TAU - span;
            }
            assert!(
                span < 0.4,
                "triangle cut diagonally across curved wall with opening: angular span = {span}"
            );
        }
    }
}
