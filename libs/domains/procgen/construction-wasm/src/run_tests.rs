use serde_json::{Value, json};

use crate::pin_tests::{
    CAPABILITIES, key, mesh_area, opening, pin_rectangle, project, resolve, topology,
};
use crate::session::ConstructionSession;

const HEIGHT: f32 = 3.0;

struct Panel {
    from: usize,
    to: usize,
    /// Walk the loop so the base runs `to -> from`.
    flip: bool,
    /// Its own side edges over the shared column nodes, as a separately
    /// drawn wall has; an edge carries at most two faces, in opposite directions.
    own_sides: bool,
    surface_type: &'static str,
    geometry: Value,
}

fn panel(from: usize, to: usize) -> Panel {
    Panel {
        from,
        to,
        flip: false,
        own_sides: false,
        surface_type: "wall",
        geometry: json!({"kind": "line"}),
    }
}

/// Upright panels between columns, each column one shared vertical side.
/// Panel `i` is region `p{i}`.
fn panels(session: &mut ConstructionSession, columns: &[[f32; 2]], panels: &[Panel]) {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for (index, [x, z]) in columns.iter().enumerate() {
        nodes.push(json!({"id": format!("b{index}"), "position": [x, 0.0, z]}));
        nodes.push(json!({"id": format!("t{index}"), "position": [x, HEIGHT, z]}));
        edges.push(json!({"edgeId": format!("s{index}"), "startNodeId": format!("b{index}"), "endNodeId": format!("t{index}")}));
    }
    let mut regions = Vec::new();
    for (index, panel) in panels.iter().enumerate() {
        let (a, b) = (panel.from, panel.to);
        let side = |column: usize| {
            if panel.own_sides || panel.flip {
                format!("s{column}-{index}")
            } else {
                format!("s{column}")
            }
        };
        if panel.own_sides || panel.flip {
            for column in [a, b] {
                edges.push(json!({"edgeId": side(column), "startNodeId": format!("b{column}"), "endNodeId": format!("t{column}")}));
            }
        }
        edges.push(json!({"edgeId": format!("base{index}"), "startNodeId": format!("b{a}"), "endNodeId": format!("b{b}"), "geometry": panel.geometry}));
        edges.push(json!({"edgeId": format!("top{index}"), "startNodeId": format!("t{a}"), "endNodeId": format!("t{b}"), "geometry": panel.geometry}));
        let uses = |edge: String, reversed: bool| json!({"edgeId": edge, "reversed": reversed});
        let boundary = if panel.flip {
            vec![
                uses(side(a), false),
                uses(format!("top{index}"), false),
                uses(side(b), true),
                uses(format!("base{index}"), true),
            ]
        } else {
            vec![
                uses(format!("base{index}"), false),
                uses(side(b), false),
                uses(format!("top{index}"), true),
                uses(side(a), true),
            ]
        };
        regions.push(json!({
            "regionId": format!("p{index}"),
            "boundary": boundary,
            "surfaceType": panel.surface_type,
            "physical": true,
        }));
    }
    let response: Value = serde_json::from_str(
        &session
            .add_patch_json(
                &json!({"nodes": nodes, "edges": edges, "regions": regions}).to_string(),
            )
            .expect("panels register"),
    )
    .unwrap();
    assert_eq!(response["skippedRegionIds"], json!([]), "{response}");
}

fn session_with(columns: &[[f32; 2]], list: &[Panel]) -> ConstructionSession {
    let mut session = ConstructionSession::new();
    session.set_surface_capabilities_json(CAPABILITIES).unwrap();
    panels(&mut session, columns, list);
    session
}

fn run(session: &ConstructionSession, region: &str) -> Value {
    serde_json::from_str(
        &session
            .panel_run_json(&json!({"surfaceKey": key(region)}).to_string())
            .unwrap(),
    )
    .unwrap()
}

fn order(run: &Value) -> Vec<String> {
    run["panels"]
        .as_array()
        .unwrap()
        .iter()
        .map(|panel| panel["surfaceKey"][1].as_str().unwrap().to_owned())
        .collect()
}

fn reversed(run: &Value) -> Vec<bool> {
    run["panels"]
        .as_array()
        .unwrap()
        .iter()
        .map(|panel| panel["reversed"].as_bool().unwrap())
        .collect()
}

/// The world point at run distance `s`, height fraction `v`, through the
/// panel whose extent holds it (the earlier one on a seam).
fn at(session: &ConstructionSession, run: &Value, s: f32, v: f64) -> [f32; 3] {
    let panels = run["panels"].as_array().unwrap();
    let panel = panels
        .iter()
        .find(|panel| {
            let (offset, length) = (
                panel["offset"].as_f64().unwrap() as f32,
                panel["length"].as_f64().unwrap() as f32,
            );
            s <= offset + length + 1e-5
        })
        .unwrap_or_else(|| panels.last().unwrap());
    on_panel(session, panel, s, v)
}

fn on_panel(session: &ConstructionSession, panel: &Value, s: f32, v: f64) -> [f32; 3] {
    let (offset, length) = (
        panel["offset"].as_f64().unwrap(),
        panel["length"].as_f64().unwrap(),
    );
    let mut u = (f64::from(s) - offset) / length;
    if panel["reversed"].as_bool().unwrap() {
        u = 1.0 - u;
    }
    resolve(session, panel["surfaceKey"][1].as_str().unwrap(), &[[u, v]])[0]
}

fn near(a: [f32; 3], b: [f32; 3], tolerance: f32) -> bool {
    (0..3).all(|axis| (a[axis] - b[axis]).abs() <= tolerance)
}

#[test]
fn three_straight_panels_in_a_line_make_one_run() {
    let columns = [[0.0, 0.0], [4.0, 0.0], [8.0, 0.0], [12.0, 0.0]];
    let session = session_with(&columns, &[panel(0, 1), panel(1, 2), panel(2, 3)]);
    let run = run(&session, "p1");
    assert_eq!(order(&run), ["p0", "p1", "p2"]);
    assert_eq!(run["closed"], false);
    for (index, panel) in run["panels"].as_array().unwrap().iter().enumerate() {
        assert!((panel["offset"].as_f64().unwrap() - 4.0 * index as f64).abs() < 1e-5);
        assert!((panel["length"].as_f64().unwrap() - 4.0).abs() < 1e-5);
        assert_eq!(panel["reversed"], false);
    }
    for s in [0.0, 1.5, 4.0, 6.0, 9.25, 12.0] {
        assert!(
            near(at(&session, &run, s, 0.5), [s, 1.5, 0.0], 1e-4),
            "s = {s}"
        );
    }
}

#[test]
fn a_flipped_panel_is_reported_reversed_and_still_maps_onto_the_run() {
    let columns = [[0.0, 0.0], [4.0, 0.0], [8.0, 0.0], [12.0, 0.0]];
    let flipped = Panel {
        flip: true,
        ..panel(1, 2)
    };
    let session = session_with(&columns, &[panel(0, 1), flipped, panel(2, 3)]);
    let from_first = run(&session, "p0");
    assert_eq!(order(&from_first), ["p0", "p1", "p2"]);
    assert_eq!(reversed(&from_first), [false, true, false]);
    for s in [1.0, 5.0, 7.5, 11.0] {
        assert!(
            near(at(&session, &from_first, s, 0.25), [s, 0.75, 0.0], 1e-4),
            "s = {s}"
        );
    }

    let from_flipped = run(&session, "p1");
    assert_eq!(order(&from_flipped), ["p2", "p1", "p0"]);
    assert_eq!(reversed(&from_flipped), [true, false, true]);
    for s in [1.0, 5.0, 7.5, 11.0] {
        assert!(
            near(
                at(&session, &from_flipped, s, 0.25),
                [12.0 - s, 0.75, 0.0],
                1e-4
            ),
            "s = {s}"
        );
    }
}

#[test]
fn a_run_wraps_an_l_corner() {
    let session = session_with(
        &[[0.0, 0.0], [4.0, 0.0], [4.0, 3.0]],
        &[panel(0, 1), panel(1, 2)],
    );
    let run = run(&session, "p1");
    assert_eq!(order(&run), ["p0", "p1"]);
    let panels = run["panels"].as_array().unwrap();
    assert!((panels[1]["offset"].as_f64().unwrap() - 4.0).abs() < 1e-5);
    assert!((panels[1]["length"].as_f64().unwrap() - 3.0).abs() < 1e-5);
    assert!(near(at(&session, &run, 5.5, 0.0), [4.0, 0.0, 1.5], 1e-4));
}

/// Points on a half circle of radius 5, each span a Bézier approximating its arc.
fn curved_chain(spans: usize) -> (Vec<[f32; 2]>, Vec<Panel>) {
    let radius = 5.0_f32;
    let step = std::f32::consts::PI / spans as f32;
    let point = |angle: f32| [radius * angle.cos(), radius * angle.sin()];
    let tangent = |angle: f32| [-angle.sin(), angle.cos()];
    let reach = 4.0 / 3.0 * (step / 4.0).tan() * radius;
    let columns = (0..=spans)
        .map(|index| point(step * index as f32))
        .collect();
    let list = (0..spans)
        .map(|index| {
            let (a0, a1) = (step * index as f32, step * (index + 1) as f32);
            let (p0, p1, t0, t1) = (point(a0), point(a1), tangent(a0), tangent(a1));
            Panel {
                flip: index % 2 == 1,
                geometry: json!({"kind": "bezier",
                    "handle1": [p0[0] + t0[0] * reach, p0[1] + t0[1] * reach],
                    "handle2": [p1[0] - t1[0] * reach, p1[1] - t1[1] * reach]}),
                ..panel(index, index + 1)
            }
        })
        .collect();
    (columns, list)
}

#[test]
fn a_brush_like_chain_of_bezier_panels_runs_continuously_across_flips() {
    let (columns, list) = curved_chain(4);
    let session = session_with(&columns, &list);
    let run = run(&session, "p2");
    assert_eq!(order(&run), ["p0", "p1", "p2", "p3"]);
    assert_eq!(reversed(&run), [false, true, false, true]);
    let panels = run["panels"].as_array().unwrap();
    let total: f64 = panels
        .iter()
        .map(|panel| panel["length"].as_f64().unwrap())
        .sum();
    assert!((total - 5.0 * std::f64::consts::PI).abs() < 0.01, "{total}");
    for pair in panels.windows(2) {
        let seam = pair[1]["offset"].as_f64().unwrap() as f32;
        for v in [0.0, 0.5, 1.0] {
            let (end, start) = (
                on_panel(&session, &pair[0], seam, v),
                on_panel(&session, &pair[1], seam, v),
            );
            assert!(near(end, start, 1e-4), "{end:?} vs {start:?}");
        }
    }
    let mut previous = f32::NEG_INFINITY;
    for step in 0..=40 {
        let s = total as f32 * step as f32 / 40.0;
        let point = at(&session, &run, s, 0.5);
        let angle = point[2].atan2(point[0]);
        assert!((point[0].hypot(point[2]) - 5.0).abs() < 0.01);
        assert!((angle - s / 5.0).abs() < 0.01, "s = {s}: angle {angle}");
        assert!(angle >= previous - 1e-5);
        previous = angle;
    }
}

#[test]
fn a_branch_stops_the_run() {
    let session = session_with(
        &[[0.0, 0.0], [4.0, 0.0], [8.0, 0.0], [4.0, 4.0], [12.0, 0.0]],
        &[
            panel(0, 1),
            panel(1, 2),
            Panel {
                own_sides: true,
                ..panel(1, 3)
            },
            panel(2, 4),
        ],
    );
    assert_eq!(order(&run(&session, "p0")), ["p0"]);
    assert_eq!(order(&run(&session, "p3")), ["p1", "p3"]);
}

#[test]
fn a_closed_loop_is_returned_once_from_the_queried_panel() {
    let mut list: Vec<Panel> = (0..3).map(|index| panel(index, index + 1)).collect();
    list.push(panel(3, 0));
    list[1].flip = true;
    let session = session_with(&[[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0]], &list);
    let run = run(&session, "p2");
    assert_eq!(run["closed"], true);
    assert_eq!(order(&run), ["p2", "p3", "p0", "p1"]);
    assert_eq!(reversed(&run), [false, false, false, true]);
    assert!(near(at(&session, &run, 10.0, 0.0), [2.0, 0.0, 0.0], 1e-4));
}

#[test]
fn panels_that_do_not_accept_cuts_are_left_out() {
    let columns = [[0.0, 0.0], [4.0, 0.0], [8.0, 0.0], [12.0, 0.0]];
    let fence = Panel {
        surface_type: "fence",
        ..panel(1, 2)
    };
    let session = session_with(&columns, &[panel(0, 1), fence, panel(2, 3)]);
    assert_eq!(order(&run(&session, "p0")), ["p0"]);
    assert_eq!(order(&run(&session, "p2")), ["p2"]);
    let refused = crate::region_groups::panel_run_of(
        &session.graph,
        &session.topology,
        &session.surfaces,
        &session.surface_capabilities,
        serde_json::from_value(json!({"surfaceKey": key("p1")})).unwrap(),
    );
    assert!(refused.unwrap_err().contains("does not accept cuts"));
}

fn set_group(session: &mut ConstructionSession, regions: &[&str], group: Option<&str>) -> Value {
    let keys: Vec<Value> = regions.iter().map(|region| key(region)).collect();
    serde_json::from_str(
        &session
            .set_region_group_json(&json!({"surfaceKeys": keys, "groupId": group}).to_string())
            .unwrap(),
    )
    .unwrap()
}

#[test]
fn groups_are_undoable_and_dropped_with_their_region() {
    let mut session = session_with(
        &[[0.0, 0.0], [4.0, 0.0], [8.0, 0.0]],
        &[panel(0, 1), panel(1, 2)],
    );
    opening(&mut session, "a");
    opening(&mut session, "b");
    session.begin_transaction("group").unwrap();
    let outcome = set_group(&mut session, &["a", "b"], Some("g1"));
    assert_eq!(outcome["affectedSurfaceKeys"], json!([key("a"), key("b")]));
    assert!(session.commit_transaction("group").unwrap());
    assert_eq!(topology(&session, "a")["group"], "g1");
    assert_eq!(topology(&session, "b")["group"], "g1");
    assert!(topology(&session, "p0").get("group").is_none());

    session.undo_region_overlay("group").unwrap();
    assert!(topology(&session, "a").get("group").is_none());
    session.redo_region_overlay("group").unwrap();
    assert_eq!(topology(&session, "b")["group"], "g1");

    session.begin_transaction("rollback").unwrap();
    set_group(&mut session, &["a"], None);
    assert!(topology(&session, "a").get("group").is_none());
    session.rollback_transaction("rollback").unwrap();
    assert_eq!(topology(&session, "a")["group"], "g1");

    session
        .delete_region_json(&json!({"surfaceKey": key("a")}).to_string())
        .unwrap();
    assert!(!session.groups.keys().any(|region| region.as_str() == "a"));
    assert_eq!(topology(&session, "b")["group"], "g1");
}

#[test]
fn grouping_an_unknown_region_is_refused() {
    let mut session = ConstructionSession::new();
    opening(&mut session, "a");
    let refused = crate::region_groups::set_region_group(
        &session.topology,
        &mut session.groups,
        serde_json::from_value(json!({"surfaceKeys": [key("a"), key("ghost")], "groupId": "g"}))
            .unwrap(),
    );
    assert!(refused.unwrap_err().contains("unknown region"));
    assert!(session.groups.is_empty());
}

/// Triangle centroids of `host`'s mesh as `(u, v)` on `host`.
fn centroids_uv(session: &ConstructionSession, host: &str) -> Vec<[f64; 2]> {
    let pieces: Vec<Value> = serde_json::from_str(
        &session
            .surface_mesh_json(&json!({"surfaceKey": key(host)}).to_string())
            .unwrap(),
    )
    .unwrap();
    let mut centroids = Vec::new();
    for piece in pieces {
        let positions: Vec<f32> = serde_json::from_value(piece["positions"].clone()).unwrap();
        let indices: Vec<usize> = serde_json::from_value(piece["indices"].clone()).unwrap();
        for triangle in indices.chunks_exact(3) {
            let centroid = [0, 1, 2].map(|axis| {
                triangle
                    .iter()
                    .map(|index| positions[index * 3 + axis])
                    .sum::<f32>()
                    / 3.0
            });
            centroids.push(centroid);
        }
    }
    project(session, host, &centroids)
        .into_iter()
        .map(|uv| [uv["u"].as_f64().unwrap(), uv["v"].as_f64().unwrap()])
        .collect()
}

/// A piece at `u = 0.6..1` of `p0` and one at `u = 0..0.4` of `p1` (in each
/// panel's own `u`, mirrored when it runs backwards).
fn seam_pieces(session: &mut ConstructionSession, p1_reversed: bool) {
    opening(session, "a");
    opening(session, "b");
    pin_rectangle(session, "a", "p0", [0.6, 1.0], [0.2, 0.6]);
    let b = if p1_reversed { [1.0, 0.6] } else { [0.0, 0.4] };
    pin_rectangle(session, "b", "p1", b, [0.2, 0.6]);
    set_group(session, &["a", "b"], Some("g"));
}

fn assert_no_sliver(session: &ConstructionSession, host: &str, cut: [f64; 2]) {
    let inside = centroids_uv(session, host).into_iter().find(|[u, v]| {
        *u > cut[0] + 1e-6 && *u < cut[1] - 1e-6 && *v > 0.2 + 1e-6 && *v < 0.6 - 1e-6
    });
    assert!(
        inside.is_none(),
        "{host} keeps wall inside the cut at {inside:?}"
    );
}

#[test]
fn pieces_meeting_at_a_seam_cut_one_continuous_hole() {
    let mut session = session_with(
        &[[0.0, 0.0], [4.0, 0.0], [8.0, 0.0]],
        &[panel(0, 1), panel(1, 2)],
    );
    seam_pieces(&mut session, false);
    assert!(near(
        topology(&session, "a")["nodes"][1]["position"]
            .as_array()
            .map(|p| [0, 1, 2].map(|i| p[i].as_f64().unwrap() as f32))
            .unwrap(),
        [4.0, 0.6, 0.0],
        1e-5
    ));
    for host in ["p0", "p1"] {
        let area = mesh_area(&session, host);
        assert!((area - (12.0 - 1.92)).abs() < 1e-4, "{host}: {area}");
    }
    assert_no_sliver(&session, "p0", [0.6, 1.1]);
    assert_no_sliver(&session, "p1", [-0.1, 0.4]);
    let panes = mesh_area(&session, "a") + mesh_area(&session, "b");
    assert!(
        (panes - 3.84).abs() < 1e-4,
        "the panes fill exactly the hole: {panes}"
    );
}

#[test]
fn pieces_meeting_at_a_curved_seam_cut_one_continuous_hole() {
    let (columns, list) = curved_chain(4);
    let mut session = session_with(&columns, &list);
    let solid = [mesh_area(&session, "p0"), mesh_area(&session, "p1")];
    seam_pieces(&mut session, true);
    let run = run(&session, "p0");
    let length = run["panels"][0]["length"].as_f64().unwrap() as f32;
    let removed = 0.4 * length * 0.4 * HEIGHT;
    for (host, solid) in ["p0", "p1"].into_iter().zip(solid) {
        let area = mesh_area(&session, host);
        assert!(
            (solid - area - removed).abs() < 0.01 * removed,
            "{host}: {solid} -> {area}, expected -{removed}"
        );
    }
    assert_no_sliver(&session, "p0", [0.6, 1.1]);
    assert_no_sliver(&session, "p1", [0.6, 1.1]);
}
