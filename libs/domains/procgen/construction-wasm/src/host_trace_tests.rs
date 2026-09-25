use serde_json::{Value, json};

use crate::session::ConstructionSession;
use crate::test_support::{
    CAPABILITIES, key, mesh_area, opening, pin_rectangle, project, resolve, topology,
    triangle_centroids, uv_area, wall,
};

const HEIGHT: f32 = 3.0;

fn session_with_wall(geometry: Value, to: [f32; 2]) -> ConstructionSession {
    let mut session = ConstructionSession::new();
    session.set_surface_capabilities_json(CAPABILITIES).unwrap();
    wall(
        &mut session,
        "w",
        [0.0, 0.0],
        to,
        [HEIGHT, HEIGHT],
        geometry,
    );
    opening(&mut session, "o");
    session
}

fn straight() -> ConstructionSession {
    session_with_wall(json!({"kind": "line"}), [4.0, 0.0])
}

fn curved_walls() -> Vec<ConstructionSession> {
    vec![
        session_with_wall(
            json!({"kind": "arc", "center": [2.0, -1.0], "clockwise": false}),
            [4.0, 0.0],
        ),
        session_with_wall(
            json!({"kind": "bezier", "handle1": [2.0, 3.0], "handle2": [6.0, -3.0]}),
            [8.0, 0.0],
        ),
        session_with_wall(
            json!({"kind": "bezier", "handle1": [0.0, 6.0], "handle2": [8.0, 6.0]}),
            [8.0, 0.0],
        ),
    ]
}

fn curve_request(edge: &str, controls: Value) -> Value {
    json!({"edgeId": edge, "hostSurfaceKey": key("w"), "controls": controls})
}

fn pin_curve(session: &mut ConstructionSession, edge: &str, controls: Value) -> Value {
    serde_json::from_str(
        &session
            .pin_edge_curve_json(&curve_request(edge, controls).to_string())
            .unwrap(),
    )
    .unwrap()
}

fn outline(session: &ConstructionSession, region: &str) -> Vec<[f64; 2]> {
    let dto: Value = serde_json::from_str(
        &session
            .host_outline_json(&json!({"surfaceKey": key(region)}).to_string())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(dto["hostSurfaceKey"], key("w"));
    serde_json::from_value(dto["uv"].clone()).unwrap()
}

fn host_curves(session: &ConstructionSession, region: &str) -> Vec<Value> {
    topology(session, region)["outerLoops"][0]
        .as_array()
        .unwrap()
        .iter()
        .map(|edge| edge["hostCurve"].clone())
        .collect()
}

fn points_of(curve: &Value) -> Vec<[f32; 3]> {
    serde_json::from_value(curve["points"].clone()).unwrap()
}

/// How far each point is from the host surface: its own projection put back.
fn off_surface(session: &ConstructionSession, points: &[[f32; 3]]) -> f32 {
    let uv: Vec<[f64; 2]> = project(session, "w", points)
        .into_iter()
        .map(|uv| [uv["u"].as_f64().unwrap(), uv["v"].as_f64().unwrap()])
        .collect();
    resolve(session, "w", &uv)
        .into_iter()
        .zip(points)
        .map(|(on, point)| {
            (0..3)
                .map(|axis| (on[axis] - point[axis]).powi(2))
                .sum::<f32>()
                .sqrt()
        })
        .fold(0.0, f32::max)
}

fn shoelace(ring: &[[f64; 2]]) -> f64 {
    ring.iter()
        .zip(ring.iter().cycle().skip(1))
        .map(|(a, b)| a[0] * b[1] - b[0] * a[1])
        .sum::<f64>()
        .abs()
        / 2.0
}

#[test]
fn straight_edges_between_pinned_nodes_follow_a_curved_wall() {
    for mut session in curved_walls() {
        let solid = uv_area(&session, "w");
        let length = solid / HEIGHT;
        pin_rectangle(&mut session, "o", "w", [0.3, 0.6], [0.2, 0.6]);
        let removed = 0.3 * length * 0.4 * HEIGHT;

        for curve in host_curves(&session, "o") {
            let points = points_of(&curve);
            assert!(points.len() >= 2);
            assert!(off_surface(&session, &points) < 1e-3, "{curve}");
            let chords: Vec<[f32; 3]> = points
                .windows(2)
                .map(|pair| [0, 1, 2].map(|axis| 0.5 * (pair[0][axis] + pair[1][axis])))
                .collect();
            assert!(
                off_surface(&session, &chords) < 0.003,
                "a chord leaves the surface"
            );
        }
        let horizontal = points_of(&host_curves(&session, "o")[0]);
        assert!(
            horizontal.len() > 2,
            "a horizontal side is traced along the curve"
        );

        let cut = uv_area(&session, "w");
        assert!(
            (solid - cut - removed).abs() < 0.01 * removed,
            "{solid} -> {cut}, expected -{removed}"
        );
        let pane = mesh_area(&session, "o");
        assert!(
            (pane - removed).abs() < 0.01 * removed,
            "pane {pane} vs {removed}"
        );
        let centroids = triangle_centroids(&session, "o");
        assert!(
            off_surface(&session, &centroids) < 0.03,
            "the pane follows the wall"
        );

        let uv = outline(&session, "o");
        for [u, v] in &uv {
            assert!((0.3 - 1e-4..=0.6 + 1e-4).contains(u) && (0.2 - 1e-4..=0.6 + 1e-4).contains(v));
        }
        assert!((shoelace(&uv) - 0.12).abs() < 1e-3, "{}", shoelace(&uv));
    }
}

#[test]
fn a_straight_edge_on_a_straight_wall_stays_two_points() {
    let mut session = straight();
    pin_rectangle(&mut session, "o", "w", [0.25, 0.5], [0.2, 0.6]);
    assert_eq!(outline(&session, "o").len(), 4);
    for curve in host_curves(&session, "o") {
        assert_eq!(points_of(&curve).len(), 2, "{curve}");
    }
    assert!((mesh_area(&session, "w") - 10.8).abs() < 1e-3);
    assert!((mesh_area(&session, "o") - 1.2).abs() < 1e-3);
}

/// The top edge `o-e2` runs from `(u1, v1)` to `(u0, v1)`; a cubic with its
/// controls `4/3 r` above both ends is the usual one-curve semicircle.
fn arch_controls(u: [f64; 2], v1: f64, rise: f64) -> Value {
    json!([[u[1], v1 + rise], [u[0], v1 + rise]])
}

fn cubic_cap_area(width: f64, rise: f64) -> f64 {
    let samples = 20_000;
    let point = |t: f64| {
        let s = 1.0 - t;
        let w = [s * s * s, 3.0 * s * s * t, 3.0 * s * t * t, t * t * t];
        let xs = [width, width, 0.0, 0.0];
        let ys = [0.0, rise, rise, 0.0];
        [
            (0..4).map(|i| w[i] * xs[i]).sum::<f64>(),
            (0..4).map(|i| w[i] * ys[i]).sum::<f64>(),
        ]
    };
    let ring: Vec<[f64; 2]> = (0..=samples)
        .map(|i| point(i as f64 / samples as f64))
        .collect();
    shoelace(&ring)
}

#[test]
fn a_pinned_cubic_arch_cuts_the_host_exactly() {
    let v = [0.2, 0.5];
    let mut sessions = vec![straight()];
    sessions.extend(curved_walls());
    for mut session in sessions {
        let solid = uv_area(&session, "w");
        let length = f64::from(solid / HEIGHT);
        let half = 0.6 / length;
        let u = [0.5 - half, 0.5 + half];
        pin_rectangle(&mut session, "o", "w", u, v);
        let width = (u[1] - u[0]) * length;
        let radius = width / 2.0;
        let rise = 4.0 / 3.0 * radius;
        pin_curve(
            &mut session,
            "o-e2",
            arch_controls(u, v[1], rise / f64::from(HEIGHT)),
        );

        let expected =
            (width * (v[1] - v[0]) * f64::from(HEIGHT) + cubic_cap_area(width, rise)) as f32;
        let cut = uv_area(&session, "w");
        assert!(
            (solid - cut - expected).abs() < 0.01 * expected,
            "{solid} -> {cut}, expected -{expected}"
        );
        let pane = mesh_area(&session, "o");
        assert!(
            (pane - expected).abs() < 0.01 * expected,
            "pane {pane} vs {expected}"
        );
        assert!(off_surface(&session, &triangle_centroids(&session, "o")) < 0.03);

        assert_eq!(
            topology(&session, "o")["nodes"].as_array().unwrap().len(),
            4,
            "no extra nodes"
        );
        let arch = &host_curves(&session, "o")[2];
        assert_eq!(
            arch["controls"],
            arch_controls(u, v[1], rise / f64::from(HEIGHT))
        );
        let points = points_of(arch);
        assert!(points.len() > 8 && points.len() < 200, "{}", points.len());
        assert!(off_surface(&session, &points) < 1e-3);
        let top = points.iter().map(|point| point[1]).fold(f32::MIN, f32::max);
        let apex = (v[1] * f64::from(HEIGHT) + 0.75 * rise) as f32;
        assert!((top - apex).abs() < 2e-3, "{top} vs {apex}");
    }
}

#[test]
fn a_reversed_use_walks_the_curve_backwards() {
    let mut session = straight();
    pin_rectangle(&mut session, "o", "w", [0.25, 0.75], [0.2, 0.5]);
    pin_curve(&mut session, "o-e2", json!([[0.75, 0.9], [0.25, 0.9]]));
    let forward = outline(&session, "o");
    session
        .pin_edge_curve_json(&json!({"edgeId": "o-e2", "controls": null}).to_string())
        .unwrap();
    assert_eq!(
        outline(&session, "o").len(),
        4,
        "back to a straight path in (u, v)"
    );
    pin_curve(&mut session, "o-e2", json!([[0.75, 0.9], [0.25, 0.9]]));
    assert_eq!(outline(&session, "o"), forward);
}

#[test]
fn a_pinned_curve_follows_its_host() {
    let mut session = straight();
    pin_rectangle(&mut session, "o", "w", [0.25, 0.75], [0.2, 0.5]);
    let controls = [[0.75, 0.8], [0.25, 0.8]];
    pin_curve(&mut session, "o-e2", json!(controls));
    let area = mesh_area(&session, "o");
    let uv = outline(&session, "o");

    let outcome: Value = serde_json::from_str(
        &session
            .move_vertex_json(&json!({"nodeId": "w-c", "position": [4.0, 5.0, 0.0]}).to_string())
            .unwrap(),
    )
    .unwrap();
    assert!(
        outcome["affectedSurfaceKeys"]
            .as_array()
            .unwrap()
            .contains(&key("o"))
    );
    let arch = &host_curves(&session, "o")[2];
    let handles: Vec<[f32; 3]> = serde_json::from_value(arch["handles"].clone()).unwrap();
    let expected = resolve(&session, "w", &controls);
    for (handle, expected) in handles.iter().zip(&expected) {
        assert!((0..3).all(|axis| (handle[axis] - expected[axis]).abs() < 1e-5));
    }
    assert!(
        mesh_area(&session, "o") > area,
        "a taller host stretches the arch"
    );
    let stretched = outline(&session, "o");
    assert_eq!(stretched.len(), uv.len());

    let before = points_of(arch);
    session
        .move_region_json(&json!({"surfaceKey": key("w"), "delta": [0.0, 0.0, 2.0]}).to_string())
        .unwrap();
    let after = points_of(&host_curves(&session, "o")[2]);
    assert_eq!(before.len(), after.len());
    for (a, b) in before.iter().zip(&after) {
        assert!((b[2] - a[2] - 2.0).abs() < 1e-4 && (b[0] - a[0]).abs() < 1e-4);
    }
}

#[test]
fn curves_are_undoable_and_dropped_with_their_pins_or_edge() {
    let mut session = straight();
    pin_rectangle(&mut session, "o", "w", [0.25, 0.75], [0.2, 0.5]);
    session.begin_transaction("arch").unwrap();
    pin_curve(&mut session, "o-e2", json!([[0.75, 0.8], [0.25, 0.8]]));
    assert!(session.commit_transaction("arch").unwrap());
    let arched = mesh_area(&session, "w");

    session.undo_region_overlay("arch").unwrap();
    assert!(host_curves(&session, "o")[2].get("controls").is_none());
    assert!((mesh_area(&session, "w") - (12.0 - 1.8)).abs() < 1e-3);
    session.redo_region_overlay("arch").unwrap();
    assert!(host_curves(&session, "o")[2]["controls"].is_array());
    assert!((mesh_area(&session, "w") - arched).abs() < 1e-5);

    session.begin_transaction("flatten").unwrap();
    session
        .pin_edge_curve_json(&json!({"edgeId": "o-e2", "controls": null}).to_string())
        .unwrap();
    assert!(session.annotations.curves.is_empty());
    session.rollback_transaction("flatten").unwrap();
    assert_eq!(session.annotations.curves.len(), 1);

    session
        .unpin_nodes_json(&json!({"nodeIds": ["o-n2"]}).to_string())
        .unwrap();
    assert!(
        session.annotations.curves.is_empty(),
        "an end no longer on the host drops the curve"
    );

    let mut session = straight();
    pin_rectangle(&mut session, "o", "w", [0.25, 0.75], [0.2, 0.5]);
    pin_curve(&mut session, "o-e2", json!([[0.75, 0.8], [0.25, 0.8]]));
    session
        .delete_region_json(&json!({"surfaceKey": key("o")}).to_string())
        .unwrap();
    assert!(session.annotations.curves.is_empty());
}

#[test]
fn a_curve_needs_both_ends_pinned_to_its_host() {
    let mut session = straight();
    let refused = crate::pins::pin_edge_curve(
        &session.topology,
        &session.annotations.pins,
        &mut session.annotations.curves,
        serde_json::from_value(curve_request("o-e2", json!([[0.75, 0.8], [0.25, 0.8]]))).unwrap(),
    )
    .unwrap_err();
    assert!(refused.contains("not pinned"), "{refused}");
    let refused = crate::pins::host_outline(
        &session.graph,
        &session.topology,
        crate::pins::HostTracer::new(&session.annotations),
        serde_json::from_value(json!({"surfaceKey": key("o")})).unwrap(),
    )
    .unwrap_err();
    assert!(refused.contains("not all pinned"), "{refused}");
    assert!(session.annotations.curves.is_empty());
}
