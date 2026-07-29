//! Batched JSON adapter for Grafting's Rust-owned graph layout heuristic.

use grafting_graph_core::{Edge, EdgeId, Graph, GroupedGridOptions, LayoutSnapshot, Node, NodeId};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutRequest {
    nodes: Vec<String>,
    edges: Vec<LayoutEdge>,
    grouping_edge_ids: Vec<String>,
    options: LayoutOptions,
}

#[derive(Debug, Deserialize)]
struct LayoutEdge {
    id: String,
    source: String,
    target: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutOptions {
    node_width: u32,
    node_height: u32,
    horizontal_gap: u32,
    vertical_gap: u32,
    group_gap: u32,
    padding: u32,
    group_columns: u32,
    member_columns: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LayoutResponse {
    positions: Vec<LayoutResponsePosition>,
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize)]
struct LayoutResponsePosition {
    id: String,
    x: u32,
    y: u32,
}

fn calculate_layout(request_json: &str) -> Result<LayoutResponse, String> {
    let request = serde_json::from_str::<LayoutRequest>(request_json)
        .map_err(|error| format!("invalid graph layout request: {error}"))?;
    let nodes = request
        .nodes
        .into_iter()
        .map(|id| {
            NodeId::new(id)
                .map(|id| Node::new(id, ()))
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let edges = request
        .edges
        .into_iter()
        .map(|edge| {
            Ok(Edge::new(
                EdgeId::new(edge.id).map_err(|error| error.to_string())?,
                NodeId::new(edge.source).map_err(|error| error.to_string())?,
                NodeId::new(edge.target).map_err(|error| error.to_string())?,
                (),
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let grouping_edges = request
        .grouping_edge_ids
        .into_iter()
        .map(|id| EdgeId::new(id).map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    let graph = Graph::try_from_parts(nodes, edges).map_err(|error| error.to_string())?;
    let options = GroupedGridOptions::new(
        request.options.node_width,
        request.options.node_height,
        request.options.horizontal_gap,
        request.options.vertical_gap,
        request.options.group_gap,
        request.options.padding,
        request.options.group_columns,
        request.options.member_columns,
    )
    .map_err(|error| error.to_string())?;
    let snapshot = graph
        .grouped_grid_layout(&grouping_edges, options)
        .map_err(|error| error.to_string())?;
    Ok(to_response(snapshot))
}

fn to_response(snapshot: LayoutSnapshot) -> LayoutResponse {
    let width = snapshot.width();
    let height = snapshot.height();
    let positions = snapshot
        .positions()
        .iter()
        .map(|position| LayoutResponsePosition {
            id: position.node_id().as_str().to_owned(),
            x: position.x(),
            y: position.y(),
        })
        .collect();
    LayoutResponse {
        positions,
        width,
        height,
    }
}

/// Calculates one immutable grouped-grid snapshot from a batched JSON request.
///
/// JSON is an adapter-owned ABI representation. Callers should use a typed
/// Grafting client and must not treat this serialization shape as graph logic.
#[wasm_bindgen]
pub fn layout_graph_json(request_json: &str) -> Result<String, JsValue> {
    let response = calculate_layout(request_json).map_err(|error| JsValue::from_str(&error))?;
    serde_json::to_string(&response)
        .map_err(|error| JsValue::from_str(&format!("cannot serialize graph layout: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn returns_one_position_per_node_with_members_below_their_group() {
        let response = calculate_layout(
            r#"{
                "nodes":["project:a","target:a/build","project:b"],
                "edges":[{
                    "id":"edge:contains",
                    "source":"project:a",
                    "target":"target:a/build"
                }],
                "groupingEdgeIds":["edge:contains"],
                "options":{
                    "nodeWidth":220,
                    "nodeHeight":56,
                    "horizontalGap":24,
                    "verticalGap":18,
                    "groupGap":72,
                    "padding":48,
                    "groupColumns":3,
                    "memberColumns":2
                }
            }"#,
        )
        .unwrap();

        assert_eq!(response.positions.len(), 3);
        let project = response
            .positions
            .iter()
            .find(|position| position.id == "project:a")
            .unwrap();
        let target = response
            .positions
            .iter()
            .find(|position| position.id == "target:a/build")
            .unwrap();
        assert!(target.y > project.y);
    }
}
