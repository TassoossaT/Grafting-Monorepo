//! Session fixtures and mesh measures shared by the session-level tests.

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

pub(crate) fn straight_wall(session: &mut ConstructionSession, id: &str) {
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

pub(crate) fn project(
    session: &ConstructionSession,
    host: &str,
    points: &[[f32; 3]],
) -> Vec<Value> {
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

pub(crate) fn node_position(session: &ConstructionSession, region: &str, node: &str) -> [f32; 3] {
    let dto = topology(session, region);
    let entry = dto["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"] == node)
        .unwrap();
    serde_json::from_value(entry["position"].clone()).unwrap()
}

/// A region's mesh pieces as `(positions, uvs, indices)`.
pub(crate) fn mesh_pieces(
    session: &ConstructionSession,
    region: &str,
) -> Vec<(Vec<f32>, Vec<f32>, Vec<usize>)> {
    let pieces: Vec<Value> = serde_json::from_str(
        &session
            .surface_mesh_json(&json!({"surfaceKey": key(region)}).to_string())
            .unwrap(),
    )
    .unwrap();
    pieces
        .into_iter()
        .map(|piece| {
            (
                serde_json::from_value(piece["positions"].clone()).unwrap(),
                serde_json::from_value(piece["uvs"].clone()).unwrap(),
                serde_json::from_value(piece["indices"].clone()).unwrap(),
            )
        })
        .collect()
}

/// Every triangle of a region's mesh, as its three world corners.
pub(crate) fn triangles(session: &ConstructionSession, region: &str) -> Vec<[[f32; 3]; 3]> {
    mesh_pieces(session, region)
        .into_iter()
        .flat_map(|(positions, _, indices)| {
            indices
                .chunks_exact(3)
                .map(|triangle| {
                    [0, 1, 2].map(|corner| {
                        let index = triangle[corner] * 3;
                        [positions[index], positions[index + 1], positions[index + 2]]
                    })
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

pub(crate) fn mesh_area(session: &ConstructionSession, region: &str) -> f32 {
    triangles(session, region)
        .into_iter()
        .map(|[a, b, c]| {
            let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let cross = [
                ab[1] * ac[2] - ab[2] * ac[1],
                ab[2] * ac[0] - ab[0] * ac[2],
                ab[0] * ac[1] - ab[1] * ac[0],
            ];
            0.5 * (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]).sqrt()
        })
        .sum()
}

pub(crate) fn triangle_centroids(session: &ConstructionSession, region: &str) -> Vec<[f32; 3]> {
    triangles(session, region)
        .into_iter()
        .map(|corners| [0, 1, 2].map(|axis| corners.iter().map(|p| p[axis]).sum::<f32>() / 3.0))
        .collect()
}

/// A mesh's area measured in its own unrolled `uvs`, free of the faceting
/// a curved face's world triangles lose.
pub(crate) fn uv_area(session: &ConstructionSession, region: &str) -> f32 {
    let mut area = 0.0;
    for (_, uvs, indices) in mesh_pieces(session, region) {
        for triangle in indices.chunks_exact(3) {
            let [a, b, c] =
                [0, 1, 2].map(|corner| [uvs[triangle[corner] * 2], uvs[triangle[corner] * 2 + 1]]);
            area += 0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).abs();
        }
    }
    area
}

pub(crate) fn close(a: [f32; 3], b: [f32; 3], tolerance: f32) -> bool {
    (0..3).all(|axis| (a[axis] - b[axis]).abs() <= tolerance)
}
