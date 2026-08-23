use std::collections::HashSet;

use serde_json::json;
use wasm_bindgen_test::wasm_bindgen_test;

use crate::mesh;
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

#[test]
fn application_generated_patch_is_overlaid_without_a_provisional_target() {
    let mut session = ConstructionSession::new();
    terrain_cell(&mut session, 0, 2, 0.0, ["n0", "n1", "n2", "n3"]);
    let source = mesh::region_id_to_wire(session.known_regions.iter().next().unwrap());
    let request = serde_json::json!({
        "operationId": "generic-overlay",
        "sourceSurfaceKeys": [source],
        "outline": [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5]],
        "boundary": [
            {"edgeId": "overlay-e0", "reversed": false},
            {"edgeId": "overlay-e1", "reversed": false},
            {"edgeId": "overlay-e2", "reversed": false},
            {"edgeId": "overlay-e3", "reversed": false}
        ],
        "patch": {
            "nodes": [
                {"id": "overlay-a", "position": [0.5, 0.0, 0.5]},
                {"id": "overlay-b", "position": [1.5, 0.0, 0.5]},
                {"id": "overlay-c", "position": [1.5, 0.0, 1.5]},
                {"id": "overlay-d", "position": [0.5, 0.0, 1.5]}
            ],
            "edges": [
                {"edgeId": "overlay-e0", "startNodeId": "overlay-a", "endNodeId": "overlay-b"},
                {"edgeId": "overlay-e1", "startNodeId": "overlay-b", "endNodeId": "overlay-c"},
                {"edgeId": "overlay-e2", "startNodeId": "overlay-c", "endNodeId": "overlay-d"},
                {"edgeId": "overlay-e3", "startNodeId": "overlay-d", "endNodeId": "overlay-a"}
            ],
            "regions": [{
                "regionId": "application-path-face",
                "boundary": [
                    {"edgeId": "overlay-e0", "reversed": false},
                    {"edgeId": "overlay-e1", "reversed": false},
                    {"edgeId": "overlay-e2", "reversed": false},
                    {"edgeId": "overlay-e3", "reversed": false}
                ],
                "surfaceType": "path",
                "physical": true
            }]
        }
    });
    let response = session
        .apply_region_overlay_json(&request.to_string())
        .expect("generic overlay applies");
    let response: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(
        response["outcome"]["createdSurfaceKeys"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        response["outcome"]["removedSurfaceKeys"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(
        response["outcome"]["createdSurfaceKeys"]
            .as_array()
            .unwrap()
            .iter()
            .all(|key| { !key[1].as_str().unwrap().contains("new") })
    );
    let meshes: Vec<serde_json::Value> =
        serde_json::from_str(&session.all_surface_meshes_json().unwrap()).unwrap();
    assert!(meshes.iter().any(|mesh| mesh["surfaceType"] == "terrain"));
    assert!(meshes.iter().any(|mesh| mesh["surfaceType"] == "path"));

    session
        .undo_region_overlay("generic-overlay")
        .expect("generic overlay undoes");
    let undone: Vec<serde_json::Value> =
        serde_json::from_str(&session.all_surface_meshes_json().unwrap()).unwrap();
    assert_eq!(undone.len(), 1);
    assert_eq!(undone[0]["surfaceType"], "terrain");

    session
        .redo_region_overlay("generic-overlay")
        .expect("generic overlay redoes");
    let redone: Vec<serde_json::Value> =
        serde_json::from_str(&session.all_surface_meshes_json().unwrap()).unwrap();
    assert!(redone.iter().any(|mesh| mesh["surfaceType"] == "terrain"));
    assert!(redone.iter().any(|mesh| mesh["surfaceType"] == "path"));
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

/// The table identity this fixture namespaces its shared edges under -- the
/// application's own `ctx.tableId`. Naming an edge after the table and the
/// pair of nodes it runs between is what lets two independently declared
/// faces agree on one name for the edge they meet along.
const FIXTURE_TABLE_ID: &str = "table-path";

/// Declares (or reuses) the shared edge between two sweep vertices, and
/// returns the use that walks it in that direction -- `core/boundary-edges.ts`'s
/// `use`, in the `refuse-when-full` mode a path commits under.
fn fixture_edge_use(
    operation_id: &str,
    from: usize,
    to: usize,
    edges: &mut Vec<serde_json::Value>,
    declared: &mut HashSet<String>,
) -> serde_json::Value {
    let from_node = format!("{operation_id}:path-node:{from}");
    let to_node = format!("{operation_id}:path-node:{to}");
    let forward = from_node < to_node;
    let (start, end) = if forward {
        (&from_node, &to_node)
    } else {
        (&to_node, &from_node)
    };
    let edge_id = format!("{FIXTURE_TABLE_ID}:seg:{start}~{end}");
    if declared.insert(edge_id.clone()) {
        edges.push(json!({"edgeId": edge_id, "startNodeId": start, "endNodeId": end}));
    }
    json!({"edgeId": edge_id, "reversed": !forward})
}

/// The exact orchestration `tools/paths/path-brush-tool.ts` performs, as a
/// test fixture: plan the graph-neutral sweep, declare the patch the way
/// `tools/paths/path-patch.ts` declares it, and hand both to the generic
/// overlay.
///
/// It lives in the tests rather than in the crate on purpose. What a path
/// *is* -- which nodes, which shared edges, which faces stand over them --
/// is the application's to decide, and this crate is not allowed to know.
/// The fixture only lets a Rust test issue the very transaction the
/// application issues, so the overlay can be exercised over real sweep
/// geometry without the crate growing a second opinion about paths.
fn overlay_path_stroke(
    session: &mut ConstructionSession,
    operation_id: &str,
    reference_line: &[[f32; 3]],
    formation: &serde_json::Value,
    source_surface_keys: &[serde_json::Value],
) -> serde_json::Value {
    let planned = session
        .plan_sweep_json(
            &json!({
                "referenceLine": reference_line,
                "profile": formation["profile"].clone(),
                "miterLimit": formation["miterLimit"].clone(),
            })
            .to_string(),
        )
        .expect("sweep planning is a pure query");
    let plan: serde_json::Value = serde_json::from_str(&planned).unwrap();

    let vertices = plan["vertices"].as_array().unwrap();
    let quads = plan["quads"].as_array().unwrap();
    let rim: Vec<usize> = plan["boundary"]
        .as_array()
        .unwrap()
        .iter()
        .map(|index| index.as_u64().unwrap() as usize)
        .collect();

    let mut edges: Vec<serde_json::Value> = Vec::new();
    let mut declared: HashSet<String> = HashSet::new();
    let mut regions: Vec<serde_json::Value> = Vec::new();
    for (index, quad) in quads.iter().enumerate() {
        let corners: Vec<usize> = quad
            .as_array()
            .unwrap()
            .iter()
            .map(|corner| corner.as_u64().unwrap() as usize)
            .collect();
        let boundary: Vec<serde_json::Value> = (0..corners.len())
            .map(|step| {
                fixture_edge_use(
                    operation_id,
                    corners[step],
                    corners[(step + 1) % corners.len()],
                    &mut edges,
                    &mut declared,
                )
            })
            .collect();
        regions.push(json!({
            "regionId": format!("{operation_id}:path-quad:{index}"),
            "boundary": boundary,
            "surfaceType": "path",
            "physical": true,
        }));
    }

    let boundary: Vec<serde_json::Value> = (0..rim.len())
        .map(|step| {
            fixture_edge_use(
                operation_id,
                rim[step],
                rim[(step + 1) % rim.len()],
                &mut edges,
                &mut declared,
            )
        })
        .collect();
    let outline: Vec<[f64; 2]> = rim
        .iter()
        .map(|index| {
            let vertex = vertices[*index].as_array().unwrap();
            [vertex[0].as_f64().unwrap(), vertex[2].as_f64().unwrap()]
        })
        .collect();
    let nodes: Vec<serde_json::Value> = vertices
        .iter()
        .enumerate()
        .map(|(index, vertex)| {
            json!({"id": format!("{operation_id}:path-node:{index}"), "position": vertex})
        })
        .collect();

    let response = session
        .apply_region_overlay_json(
            &json!({
                "operationId": operation_id,
                "sourceSurfaceKeys": source_surface_keys,
                "outline": outline,
                "boundary": boundary,
                "patch": {"nodes": nodes, "edges": edges, "regions": regions},
            })
            .to_string(),
        )
        .expect("the application-declared path patch overlays");
    serde_json::from_str(&response).unwrap()
}

/// Every region the session currently holds, as wire surface keys -- what
/// the application resolves through `getFootprintCoverage` and its own
/// per-type interaction table before it decides which ones to replace.
fn all_surface_keys(session: &ConstructionSession) -> Vec<serde_json::Value> {
    session
        .known_regions
        .iter()
        .map(|region| serde_json::to_value(mesh::region_id_to_wire(region)).unwrap())
        .collect()
}

#[test]
fn a_profiled_path_is_a_shared_quad_patch_and_can_start_on_empty_ground() {
    let mut session = ConstructionSession::new();
    let formation = json!({
        "profile": [
            {"lateralOffset": -1.0, "elevation": 0.4},
            {"lateralOffset": -0.5, "elevation": 0.0},
            {"lateralOffset": 0.5, "elevation": 0.0},
            {"lateralOffset": 1.0, "elevation": 0.4}
        ],
        "miterLimit": 2.0
    });

    let response = overlay_path_stroke(
        &mut session,
        "profiled-path-empty",
        &[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]],
        &formation,
        &[],
    );
    assert_eq!(
        response["outcome"]["createdSurfaceKeys"]
            .as_array()
            .unwrap()
            .len(),
        6,
        "two longitudinal segments times three transverse bands"
    );

    let meshes: Vec<serde_json::Value> =
        serde_json::from_str(&session.all_surface_meshes_json().unwrap()).unwrap();
    assert_eq!(meshes.len(), 6);
    let heights = meshes
        .iter()
        .flat_map(|mesh| {
            mesh["positions"]
                .as_array()
                .unwrap()
                .iter()
                .skip(1)
                .step_by(3)
        })
        .map(|height| height.as_f64().unwrap())
        .collect::<Vec<_>>();
    assert!(heights.iter().all(|height| *height >= 0.0));
    assert!(heights.contains(&0.0));
    assert!(heights.iter().any(|height| *height > 0.0));
}

#[test]
fn crossing_profiled_paths_union_without_leaving_a_provisional_face() {
    let mut session = ConstructionSession::new();
    let formation = json!({
        "profile": [
            {"lateralOffset": -0.5, "elevation": 0.2},
            {"lateralOffset": -0.25, "elevation": 0.0},
            {"lateralOffset": 0.25, "elevation": 0.0},
            {"lateralOffset": 0.5, "elevation": 0.2}
        ],
        "miterLimit": 2.0
    });

    overlay_path_stroke(
        &mut session,
        "profile-cross-a",
        &[[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]],
        &formation,
        &[],
    );

    // The application resolved every standing path face as a source to cut,
    // which is what `resolveCoverage` reports for path painted over path.
    let sources = all_surface_keys(&session);
    let response = overlay_path_stroke(
        &mut session,
        "profile-cross-b",
        &[[1.0, 0.0, -1.0], [1.0, 0.0, 1.0]],
        &formation,
        &sources,
    );
    assert!(
        response["outcome"]["createdSurfaceKeys"]
            .as_array()
            .unwrap()
            .iter()
            .all(|key| {
                let id = key[1].as_str().unwrap();
                id.contains("remainder") || id.contains("quad")
            })
    );
    let meshes: Vec<serde_json::Value> =
        serde_json::from_str(&session.all_surface_meshes_json().unwrap()).unwrap();
    assert!(!meshes.is_empty());
    assert!(meshes.iter().all(|mesh| mesh["surfaceType"] == "path"));
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
                    {"edgeId": "e_b0_b1", "reversed": false},
                    {"edgeId": "e_b1_t1", "reversed": false},
                    {"edgeId": "e_t0_t1", "reversed": true},
                    {"edgeId": "e_t0_b0", "reversed": false}
                ],
                "surfaceType": "wall-white",
                "physical": true
            },
            {
                "regionId": "r1",
                "boundary": [
                    {"edgeId": "e_b1_b2", "reversed": false},
                    {"edgeId": "e_b2_t2", "reversed": false},
                    {"edgeId": "e_t1_t2", "reversed": true},
                    {"edgeId": "e_b1_t1", "reversed": true}
                ],
                "surfaceType": "wall-white",
                "physical": true
            },
            {
                "regionId": "r2",
                "boundary": [
                    {"edgeId": "e_b2_b3", "reversed": false},
                    {"edgeId": "e_b3_t3", "reversed": false},
                    {"edgeId": "e_t2_t3", "reversed": true},
                    {"edgeId": "e_b2_t2", "reversed": true}
                ],
                "surfaceType": "wall-white",
                "physical": true
            },
            {
                "regionId": "r3",
                "boundary": [
                    {"edgeId": "e_b3_b0", "reversed": false},
                    {"edgeId": "e_t0_b0", "reversed": true},
                    {"edgeId": "e_t3_t0", "reversed": true},
                    {"edgeId": "e_b3_t3", "reversed": true}
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
                    {"edgeId": "e_b0_b1", "reversed": false},
                    {"edgeId": "e_b1_t1", "reversed": false},
                    {"edgeId": "e_t0_t1", "reversed": true},
                    {"edgeId": "e_t0_b0", "reversed": false}
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
                    {"edgeId": "e_w0_w1", "reversed": false},
                    {"edgeId": "e_w1_w2", "reversed": false},
                    {"edgeId": "e_w2_w3", "reversed": false},
                    {"edgeId": "e_w3_w0", "reversed": false}
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

/// A crossing consumes the crossed run's **spine**, and keeps only its rim.
///
/// `apply_region_overlay` rebuilds what it consumed from the outer boundary
/// of the consumed set, so every node on that rim survives and every node
/// interior to it does not. A spine is interior by construction -- it is the
/// seam down the middle -- so the travel line is severed exactly where two
/// runs meet, which is the one place a network most needs it intact.
///
/// Pinned here as the measured starting point for junction geometry: a real
/// junction has to put the crossed spine back on a face boundary rather than
/// leave it inside a region that is about to be replaced. Sharing a node at
/// the crossing (the application's weld) keeps that single node alive, but
/// not the chain either side of it.
#[test]
fn a_crossing_consumes_the_crossed_runs_spine_and_keeps_only_its_rim() {
    let mut session = ConstructionSession::new();
    let formation = json!({
        "profile": [
            {"lateralOffset": -2.1, "elevation": 0.0},
            {"lateralOffset": 0.0, "elevation": 0.0},
            {"lateralOffset": 2.1, "elevation": 0.0}
        ],
        "miterLimit": 2.0
    });
    overlay_path_stroke(
        &mut session,
        "road-a",
        &[[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [4.0, 0.0, 0.0], [6.0, 0.0, 0.0]],
        &formation,
        &[],
    );
    let before = session.snapshot_json().unwrap();

    let sources = all_surface_keys(&session);
    overlay_path_stroke(
        &mut session,
        "road-b",
        &[[3.0, 0.0, -4.0], [3.0, 0.0, 0.0], [3.0, 0.0, 4.0]],
        &formation,
        &sources,
    );
    let after = session.snapshot_json().unwrap();

    // Station-major over a three-slot profile, so slot 1 of every station is
    // the spine: indices 1, 4, 7, 10.
    let gone: Vec<usize> = (0..12)
        .filter(|index| {
            let id = format!("road-a:path-node:{index}");
            before.contains(&id) && !after.contains(&id)
        })
        .collect();
    assert_eq!(
        gone,
        vec![4, 7],
        "only the crossed spine stations inside the crossing are consumed"
    );
    assert!(gone.iter().all(|index| index % 3 == 1), "every loss is a spine node");
}
