use serde_json::{Value, json};

use crate::session::ConstructionSession;

pub(crate) const CAPABILITIES: &str = r#"{"capabilities":[
    {"surfaceType":"wall","cuts":false,"acceptsCuts":true},
    {"surfaceType":"opening","cuts":true,"acceptsCuts":false}]}"#;

pub(crate) fn key(id: &str) -> Value {
    json!(["@region", id])
}

/// An upright panel from `from` to `to` (XZ), base at height 0, top at
/// `heights` over the start and end corners.
pub(crate) fn wall(
    session: &mut ConstructionSession,
    id: &str,
    from: [f32; 2],
    to: [f32; 2],
    heights: [f32; 2],
    geometry: Value,
) {
    let node = |suffix: &str| format!("{id}-{suffix}");
    let request = json!({
        "nodes": [
            {"id": node("a"), "position": [from[0], 0.0, from[1]]},
            {"id": node("b"), "position": [to[0], 0.0, to[1]]},
            {"id": node("c"), "position": [to[0], heights[1], to[1]]},
            {"id": node("d"), "position": [from[0], heights[0], from[1]]},
        ],
        "edges": [
            {"edgeId": node("base"), "startNodeId": node("a"), "endNodeId": node("b"), "geometry": geometry},
            {"edgeId": node("right"), "startNodeId": node("b"), "endNodeId": node("c")},
            {"edgeId": node("top"), "startNodeId": node("d"), "endNodeId": node("c"), "geometry": geometry},
            {"edgeId": node("left"), "startNodeId": node("d"), "endNodeId": node("a")},
        ],
        "regions": [{
            "regionId": id,
            "boundary": [
                {"edgeId": node("base"), "reversed": false},
                {"edgeId": node("right"), "reversed": false},
                {"edgeId": node("top"), "reversed": true},
                {"edgeId": node("left"), "reversed": false},
            ],
            "surfaceType": "wall",
            "physical": true,
        }],
    });
    session
        .add_patch_json(&request.to_string())
        .expect("wall registers");
}

fn straight_wall(session: &mut ConstructionSession, id: &str) {
    wall(
        session,
        id,
        [0.0, 0.0],
        [4.0, 0.0],
        [3.0, 3.0],
        json!({"kind": "line"}),
    );
}

/// A four-node region with its own nodes, placed away from everything.
pub(crate) fn opening(session: &mut ConstructionSession, id: &str) {
    let node = |index: usize| format!("{id}-n{index}");
    let edge = |index: usize| format!("{id}-e{index}");
    let request = json!({
        "nodes": (0..4).map(|index| json!({"id": node(index), "position": [index as f32, 0.0, 50.0 + index as f32]})).collect::<Vec<_>>(),
        "edges": (0..4).map(|index| json!({"edgeId": edge(index), "startNodeId": node(index), "endNodeId": node((index + 1) % 4)})).collect::<Vec<_>>(),
        "regions": [{
            "regionId": id,
            "boundary": (0..4).map(|index| json!({"edgeId": edge(index), "reversed": false})).collect::<Vec<_>>(),
            "surfaceType": "opening",
            "physical": false,
        }],
    });
    session
        .add_patch_json(&request.to_string())
        .expect("opening registers");
}

/// Pins the opening's four nodes to the rectangle `u0..u1` x `v0..v1` on `host`.
pub(crate) fn pin_rectangle(
    session: &mut ConstructionSession,
    id: &str,
    host: &str,
    [u0, u1]: [f64; 2],
    [v0, v1]: [f64; 2],
) -> Value {
    let corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    let pins: Vec<Value> = corners
        .iter()
        .enumerate()
        .map(|(index, [u, v])| json!({"nodeId": format!("{id}-n{index}"), "hostSurfaceKey": key(host), "u": u, "v": v}))
        .collect();
    serde_json::from_str(
        &session
            .pin_nodes_json(&json!({ "pins": pins }).to_string())
            .unwrap(),
    )
    .unwrap()
}

pub(crate) fn resolve(session: &ConstructionSession, host: &str, uv: &[[f64; 2]]) -> Vec<[f32; 3]> {
    serde_json::from_str(
        &session
            .resolve_on_host_json(&json!({"hostSurfaceKey": key(host), "uv": uv}).to_string())
            .unwrap(),
    )
    .unwrap()
}

pub(crate) fn project(session: &ConstructionSession, host: &str, points: &[[f32; 3]]) -> Vec<Value> {
    serde_json::from_str(
        &session
            .project_to_host_json(
                &json!({"hostSurfaceKey": key(host), "points": points}).to_string(),
            )
            .unwrap(),
    )
    .unwrap()
}

pub(crate) fn topology(session: &ConstructionSession, region: &str) -> Value {
    serde_json::from_str(
        &session
            .region_topology_json(&json!({"surfaceKey": key(region)}).to_string())
            .unwrap(),
    )
    .unwrap()
}

fn node_position(session: &ConstructionSession, region: &str, node: &str) -> [f32; 3] {
    let dto = topology(session, region);
    let entry = dto["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"] == node)
        .unwrap();
    serde_json::from_value(entry["position"].clone()).unwrap()
}

pub(crate) fn mesh_area(session: &ConstructionSession, region: &str) -> f32 {
    let pieces: Vec<Value> = serde_json::from_str(
        &session
            .surface_mesh_json(&json!({"surfaceKey": key(region)}).to_string())
            .unwrap(),
    )
    .unwrap();
    let mut area = 0.0;
    for piece in pieces {
        let positions: Vec<f32> = serde_json::from_value(piece["positions"].clone()).unwrap();
        let indices: Vec<usize> = serde_json::from_value(piece["indices"].clone()).unwrap();
        for triangle in indices.chunks_exact(3) {
            let p = |index: usize| {
                [
                    positions[index * 3],
                    positions[index * 3 + 1],
                    positions[index * 3 + 2],
                ]
            };
            let (a, b, c) = (p(triangle[0]), p(triangle[1]), p(triangle[2]));
            let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let cross = [
                ab[1] * ac[2] - ab[2] * ac[1],
                ab[2] * ac[0] - ab[0] * ac[2],
                ab[0] * ac[1] - ab[1] * ac[0],
            ];
            area += 0.5 * (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]).sqrt();
        }
    }
    area
}

fn close(a: [f32; 3], b: [f32; 3], tolerance: f32) -> bool {
    (0..3).all(|axis| (a[axis] - b[axis]).abs() <= tolerance)
}

fn affected(outcome: &Value) -> Vec<Value> {
    outcome["affectedSurfaceKeys"].as_array().unwrap().clone()
}

fn round_trip(geometry: Value, tolerance: f64) {
    let mut session = ConstructionSession::new();
    wall(
        &mut session,
        "w",
        [0.0, 0.0],
        [4.0, 0.0],
        [3.0, 3.0],
        geometry,
    );
    let uv = [[0.0, 0.0], [0.1, 0.9], [0.5, 0.5], [0.75, 0.2], [1.0, 1.0]];
    let points = resolve(&session, "w", &uv);
    for (expected, projected) in uv.iter().zip(project(&session, "w", &points)) {
        assert!(
            (projected["u"].as_f64().unwrap() - expected[0]).abs() < tolerance,
            "{projected} vs {expected:?}"
        );
        assert!(
            (projected["v"].as_f64().unwrap() - expected[1]).abs() < tolerance,
            "{projected} vs {expected:?}"
        );
        assert_eq!(projected["inside"], true);
    }
    let outside = resolve(&session, "w", &[[0.5, 1.5]]);
    assert_eq!(project(&session, "w", &outside)[0]["inside"], false);
}

#[test]
fn resolve_and_project_round_trip_on_a_straight_panel() {
    round_trip(json!({"kind": "line"}), 1e-4);
    let mut session = ConstructionSession::new();
    straight_wall(&mut session, "w");
    assert!(close(
        resolve(&session, "w", &[[0.25, 0.5]])[0],
        [1.0, 1.5, 0.0],
        1e-5
    ));
}

#[test]
fn resolve_and_project_round_trip_on_an_arc_panel() {
    round_trip(
        json!({"kind": "arc", "center": [2.0, -1.0], "clockwise": false}),
        1e-3,
    );
    round_trip(
        json!({"kind": "arc", "center": [2.0, -1.0], "clockwise": true}),
        1e-3,
    );
}

#[test]
fn resolve_and_project_round_trip_on_a_bezier_panel() {
    round_trip(
        json!({"kind": "bezier", "handle1": [1.0, 1.5], "handle2": [3.0, 1.5]}),
        5e-3,
    );
}

#[test]
fn v_is_a_fraction_of_the_local_height_under_a_slanted_top() {
    let mut session = ConstructionSession::new();
    wall(
        &mut session,
        "w",
        [0.0, 0.0],
        [4.0, 0.0],
        [1.0, 3.0],
        json!({"kind": "line"}),
    );
    let points = resolve(&session, "w", &[[0.5, 0.5], [1.0, 1.0], [0.0, 1.0]]);
    assert!(close(points[0], [2.0, 1.0, 0.0], 1e-5), "{:?}", points[0]);
    assert!(close(points[1], [4.0, 3.0, 0.0], 1e-5));
    assert!(close(points[2], [0.0, 1.0, 0.0], 1e-5));
}

#[test]
fn project_refuses_a_host_that_is_not_an_upright_panel() {
    let mut session = ConstructionSession::new();
    opening(&mut session, "flat");
    let request = json!({"hostSurfaceKey": key("flat"), "points": [[0.0, 0.0, 0.0]]}).to_string();
    let face = crate::pins::project_to_host(
        &session.graph,
        &session.topology,
        serde_json::from_str(&request).unwrap(),
    );
    assert!(face.unwrap_err().contains("not an upright panel"));
}

#[test]
fn pinning_moves_nodes_onto_the_host_and_reports_both_regions() {
    let mut session = ConstructionSession::new();
    straight_wall(&mut session, "w");
    opening(&mut session, "o");
    let outcome = pin_rectangle(&mut session, "o", "w", [0.25, 0.5], [0.2, 0.6]);
    assert!(affected(&outcome).contains(&key("o")));
    assert!(affected(&outcome).contains(&key("w")));
    assert!(close(
        node_position(&session, "o", "o-n0"),
        [1.0, 0.6, 0.0],
        1e-5
    ));
    assert!(close(
        node_position(&session, "o", "o-n2"),
        [2.0, 1.8, 0.0],
        1e-5
    ));
    let pin = &topology(&session, "o")["nodes"][0]["pin"];
    assert_eq!(pin["hostSurfaceKey"], key("w"));
    assert!((pin["u"].as_f64().unwrap() - 0.25).abs() < 1e-12);
    assert!(topology(&session, "w")["nodes"][0].get("pin").is_none());

    let unpinned: Value = serde_json::from_str(
        &session
            .unpin_nodes_json(&json!({"nodeIds": ["o-n0"]}).to_string())
            .unwrap(),
    )
    .unwrap();
    assert!(affected(&unpinned).contains(&key("w")));
    assert!(topology(&session, "o")["nodes"][0].get("pin").is_none());
    assert!(
        close(node_position(&session, "o", "o-n0"), [1.0, 0.6, 0.0], 1e-5),
        "unpinning keeps the position"
    );
}

#[test]
fn moving_a_host_top_vertex_re_resolves_its_pinned_nodes() {
    let mut session = ConstructionSession::new();
    straight_wall(&mut session, "w");
    opening(&mut session, "o");
    pin_rectangle(&mut session, "o", "w", [0.5, 0.75], [0.2, 0.5]);
    assert!(close(
        node_position(&session, "o", "o-n2"),
        [3.0, 1.5, 0.0],
        1e-5
    ));

    let outcome: Value = serde_json::from_str(
        &session
            .move_vertex_json(&json!({"nodeId": "w-c", "position": [4.0, 5.0, 0.0]}).to_string())
            .unwrap(),
    )
    .unwrap();
    assert!(
        affected(&outcome).contains(&key("o")),
        "the carried opening is reported: {outcome}"
    );
    assert!(close(
        node_position(&session, "o", "o-n2"),
        [3.0, 2.25, 0.0],
        1e-5
    ));
    assert!(close(
        node_position(&session, "o", "o-n0"),
        [2.0, 0.8, 0.0],
        1e-5
    ));

    let moved: Value = serde_json::from_str(
        &session
            .move_region_json(
                &json!({"surfaceKey": key("w"), "delta": [0.0, 0.0, 2.0]}).to_string(),
            )
            .unwrap(),
    )
    .unwrap();
    assert!(affected(&moved).contains(&key("o")));
    assert!(close(
        node_position(&session, "o", "o-n2"),
        [3.0, 2.25, 2.0],
        1e-5
    ));
}

#[test]
fn undo_and_redo_restore_pins_and_positions() {
    let mut session = ConstructionSession::new();
    straight_wall(&mut session, "w");
    opening(&mut session, "o");
    let before = node_position(&session, "o", "o-n0");
    session.begin_transaction("pin").unwrap();
    pin_rectangle(&mut session, "o", "w", [0.25, 0.5], [0.2, 0.6]);
    assert!(session.commit_transaction("pin").unwrap());

    session.undo_region_overlay("pin").unwrap();
    assert!(topology(&session, "o")["nodes"][0].get("pin").is_none());
    assert!(close(node_position(&session, "o", "o-n0"), before, 0.0));

    session.redo_region_overlay("pin").unwrap();
    assert_eq!(
        topology(&session, "o")["nodes"][0]["pin"]["hostSurfaceKey"],
        key("w")
    );
    assert!(close(
        node_position(&session, "o", "o-n0"),
        [1.0, 0.6, 0.0],
        1e-5
    ));
}

#[test]
fn deleting_the_host_drops_the_pins_and_keeps_the_nodes() {
    let mut session = ConstructionSession::new();
    straight_wall(&mut session, "w");
    opening(&mut session, "o");
    pin_rectangle(&mut session, "o", "w", [0.25, 0.5], [0.2, 0.6]);
    session
        .delete_region_json(&json!({"surfaceKey": key("w")}).to_string())
        .unwrap();
    assert!(session.pins.is_empty());
    assert!(close(
        node_position(&session, "o", "o-n0"),
        [1.0, 0.6, 0.0],
        1e-5
    ));
}

fn cut_session() -> ConstructionSession {
    let mut session = ConstructionSession::new();
    session.set_surface_capabilities_json(CAPABILITIES).unwrap();
    straight_wall(&mut session, "w");
    opening(&mut session, "o");
    session
}

#[test]
fn a_pinned_cutter_inside_the_host_removes_its_own_area() {
    let mut session = cut_session();
    assert!((mesh_area(&session, "w") - 12.0).abs() < 1e-4);
    pin_rectangle(&mut session, "o", "w", [0.25, 0.5], [0.2, 0.6]);
    assert!(
        (mesh_area(&session, "w") - 10.8).abs() < 1e-3,
        "{}",
        mesh_area(&session, "w")
    );
    assert!(
        (mesh_area(&session, "o") - 1.2).abs() < 1e-3,
        "the cutter keeps its own panel"
    );

    let all: Vec<Value> =
        serde_json::from_str(&session.all_surface_meshes_json().unwrap()).unwrap();
    let wall_pieces: Vec<&Value> = all
        .iter()
        .filter(|mesh| mesh["surfaceKey"] == key("w"))
        .collect();
    assert_eq!(wall_pieces.len(), 1);
    let batch: Vec<Value> = serde_json::from_str(
        &session
            .surface_meshes_json(&json!({"surfaceKeys": [key("w")]}).to_string())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(batch[0]["indices"], wall_pieces[0]["indices"]);
}

#[test]
fn a_cutter_crossing_the_top_cuts_only_the_part_inside() {
    let mut session = cut_session();
    pin_rectangle(&mut session, "o", "w", [0.25, 0.5], [0.8, 1.2]);
    assert!(
        (mesh_area(&session, "w") - 11.4).abs() < 1e-3,
        "{}",
        mesh_area(&session, "w")
    );
}

#[test]
fn a_cutter_covering_the_whole_host_leaves_an_empty_mesh() {
    let mut session = cut_session();
    pin_rectangle(&mut session, "o", "w", [-0.1, 1.1], [-0.1, 1.1]);
    let pieces: Vec<Value> = serde_json::from_str(
        &session
            .surface_mesh_json(&json!({"surfaceKey": key("w")}).to_string())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(pieces.len(), 1);
    assert!(pieces[0]["indices"].as_array().unwrap().is_empty());
}

#[test]
fn a_cutter_pinned_across_a_corner_cuts_each_host() {
    let mut session = ConstructionSession::new();
    session.set_surface_capabilities_json(CAPABILITIES).unwrap();
    straight_wall(&mut session, "a");
    wall(
        &mut session,
        "b",
        [4.0, 0.0],
        [4.0, 4.0],
        [3.0, 3.0],
        json!({"kind": "line"}),
    );
    opening(&mut session, "o");
    let pins = json!({"pins": [
        {"nodeId": "o-n0", "hostSurfaceKey": key("a"), "u": 0.75, "v": 0.2},
        {"nodeId": "o-n1", "hostSurfaceKey": key("b"), "u": 0.25, "v": 0.2},
        {"nodeId": "o-n2", "hostSurfaceKey": key("b"), "u": 0.25, "v": 0.6},
        {"nodeId": "o-n3", "hostSurfaceKey": key("a"), "u": 0.75, "v": 0.6},
    ]});
    let outcome: Value =
        serde_json::from_str(&session.pin_nodes_json(&pins.to_string()).unwrap()).unwrap();
    assert!(affected(&outcome).contains(&key("a")) && affected(&outcome).contains(&key("b")));
    assert!(
        (mesh_area(&session, "a") - 10.8).abs() < 1e-3,
        "{}",
        mesh_area(&session, "a")
    );
    assert!(
        (mesh_area(&session, "b") - 10.8).abs() < 1e-3,
        "{}",
        mesh_area(&session, "b")
    );
}

#[test]
fn a_cut_on_an_arc_panel_keeps_a_mesh_and_removes_area() {
    let mut session = ConstructionSession::new();
    session.set_surface_capabilities_json(CAPABILITIES).unwrap();
    wall(
        &mut session,
        "w",
        [0.0, 0.0],
        [4.0, 0.0],
        [3.0, 3.0],
        json!({"kind": "arc", "center": [2.0, -1.0], "clockwise": false}),
    );
    opening(&mut session, "o");
    let solid = mesh_area(&session, "w");
    pin_rectangle(&mut session, "o", "w", [0.3, 0.6], [0.2, 0.6]);
    let cut = mesh_area(&session, "w");
    assert!(cut > 0.5 * solid && cut < solid - 0.5, "{solid} -> {cut}");
}

#[test]
fn an_unpinned_cutter_does_not_cut() {
    let mut session = cut_session();
    session
        .move_region_json(&json!({"surfaceKey": key("o"), "delta": [0.0, 0.0, -50.0]}).to_string())
        .unwrap();
    assert!((mesh_area(&session, "w") - 12.0).abs() < 1e-4);
}

#[test]
fn without_capabilities_a_pinned_region_does_not_cut() {
    let mut session = ConstructionSession::new();
    straight_wall(&mut session, "w");
    opening(&mut session, "o");
    pin_rectangle(&mut session, "o", "w", [0.25, 0.5], [0.2, 0.6]);
    assert!((mesh_area(&session, "w") - 12.0).abs() < 1e-4);
}

#[test]
fn moving_a_cutter_reports_its_host() {
    let mut session = cut_session();
    pin_rectangle(&mut session, "o", "w", [0.25, 0.5], [0.2, 0.6]);
    let outcome: Value = serde_json::from_str(
        &session
            .retype_edge_json(&json!({"edgeId": "o-e0", "geometry": {"kind": "line"}}).to_string())
            .unwrap(),
    )
    .unwrap();
    assert!(affected(&outcome).contains(&key("w")), "{outcome}");
}

fn bezier_point(handles: [[f32; 2]; 2], t: f32) -> [f32; 2] {
    let (p0, p1, p2, p3) = ([0.0, 0.0], handles[0], handles[1], [8.0, 0.0]);
    let u = 1.0 - t;
    let w = [u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t];
    [0, 1].map(|axis| w[0] * p0[axis] + w[1] * p1[axis] + w[2] * p2[axis] + w[3] * p3[axis])
}

/// Every triangle's centroid lies on the Bézier rail (in XZ) within the
/// tessellation tolerance, and the total area.
fn bezier_mesh_check(session: &ConstructionSession, handles: [[f32; 2]; 2]) -> (f32, f32) {
    let rail: Vec<[f32; 2]> = (0..=2000)
        .map(|i| bezier_point(handles, i as f32 / 2000.0))
        .collect();
    let pieces: Vec<Value> = serde_json::from_str(
        &session
            .surface_mesh_json(&json!({"surfaceKey": key("w")}).to_string())
            .unwrap(),
    )
    .unwrap();
    let mut worst: f32 = 0.0;
    for piece in pieces {
        let positions: Vec<f32> = serde_json::from_value(piece["positions"].clone()).unwrap();
        let indices: Vec<usize> = serde_json::from_value(piece["indices"].clone()).unwrap();
        for triangle in indices.chunks_exact(3) {
            let centroid = [0, 2].map(|axis| {
                triangle
                    .iter()
                    .map(|&i| positions[i * 3 + axis])
                    .sum::<f32>()
                    / 3.0
            });
            let off = rail
                .windows(2)
                .map(|pair| {
                    let (a, b) = (pair[0], pair[1]);
                    let d = [b[0] - a[0], b[1] - a[1]];
                    let t = (((centroid[0] - a[0]) * d[0] + (centroid[1] - a[1]) * d[1])
                        / (d[0] * d[0] + d[1] * d[1]))
                        .clamp(0.0, 1.0);
                    ((centroid[0] - a[0] - d[0] * t).powi(2)
                        + (centroid[1] - a[1] - d[1] * t).powi(2))
                    .sqrt()
                })
                .fold(f32::INFINITY, f32::min);
            worst = worst.max(off);
        }
    }
    (mesh_area(session, "w"), worst)
}

fn bezier_window(handles: [[f32; 2]; 2]) {
    let mut session = ConstructionSession::new();
    session.set_surface_capabilities_json(CAPABILITIES).unwrap();
    let geometry = json!({"kind": "bezier", "handle1": handles[0], "handle2": handles[1]});
    wall(
        &mut session,
        "w",
        [0.0, 0.0],
        [8.0, 0.0],
        [3.0, 3.0],
        geometry,
    );
    let length: f32 = (0..2000)
        .map(|i| {
            let (a, b) = (
                bezier_point(handles, i as f32 / 2000.0),
                bezier_point(handles, (i + 1) as f32 / 2000.0),
            );
            ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt()
        })
        .sum();
    let (solid, solid_off) = bezier_mesh_check(&session, handles);
    assert!(
        (solid - 3.0 * length).abs() < 0.01 * solid,
        "{solid} vs {}",
        3.0 * length
    );
    assert!(solid_off < 0.03, "uncut panel off the rail by {solid_off}");

    opening(&mut session, "o");
    let width = f64::from(1.2 / length);
    pin_rectangle(
        &mut session,
        "o",
        "w",
        [0.5 - width / 2.0, 0.5 + width / 2.0],
        [0.4, 0.4 + 1.0 / 3.0],
    );
    let (cut, off) = bezier_mesh_check(&session, handles);
    assert!(
        (cut - (solid - 1.2)).abs() < 0.01 * solid,
        "{cut} vs {}",
        solid - 1.2
    );
    assert!(off < 0.03, "cut mesh off the rail by {off}");
}

#[test]
fn a_window_on_an_s_bezier_panel_cuts_only_its_area_and_stays_on_the_rail() {
    bezier_window([[2.0, 3.0], [6.0, -3.0]]);
}

#[test]
fn a_window_on_a_c_bezier_panel_cuts_only_its_area_and_stays_on_the_rail() {
    bezier_window([[0.0, 6.0], [8.0, 6.0]]);
}

#[test]
fn a_bezier_host_projects_past_its_ends_as_outside() {
    let mut session = ConstructionSession::new();
    wall(
        &mut session,
        "w",
        [0.0, 0.0],
        [8.0, 0.0],
        [3.0, 3.0],
        json!({"kind": "bezier", "handle1": [2.0, 3.0], "handle2": [6.0, -3.0]}),
    );
    let beyond = resolve(&session, "w", &[[-0.1, 0.5], [1.1, 0.5]]);
    let projected = project(&session, "w", &beyond);
    assert!(
        (projected[0]["u"].as_f64().unwrap() + 0.1).abs() < 1e-3,
        "{}",
        projected[0]
    );
    assert!(
        (projected[1]["u"].as_f64().unwrap() - 1.1).abs() < 1e-3,
        "{}",
        projected[1]
    );
    assert_eq!(projected[0]["inside"], false);
    assert_eq!(projected[1]["inside"], false);
}
