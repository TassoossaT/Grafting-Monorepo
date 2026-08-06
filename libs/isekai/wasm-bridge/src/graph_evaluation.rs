//! Batched JSON adapter for Grafting's Rust-owned evaluation ordering.
//!
//! A cycle is reported as data rather than as an error: while a user is wiring
//! a dataflow graph, a temporary cycle is an ordinary authoring state that the
//! surface should explain, not an exceptional condition.

use grafting_graph_core::{Edge, EdgeId, Graph, GraphError, Node, NodeId};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Deserialize)]
struct EvaluationOrderRequest {
    nodes: Vec<String>,
    edges: Vec<EvaluationEdge>,
}

#[derive(Debug, Deserialize)]
struct EvaluationEdge {
    id: String,
    source: String,
    target: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
enum EvaluationOrderResponse {
    /// Every node can run, in the order given.
    Ordered { order: Vec<String> },
    /// One or more cycles block the listed nodes.
    Cyclic { blocked: Vec<String> },
}

fn calculate_order(request_json: &str) -> Result<EvaluationOrderResponse, String> {
    let request = serde_json::from_str::<EvaluationOrderRequest>(request_json)
        .map_err(|error| format!("invalid evaluation order request: {error}"))?;
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
    let graph = Graph::try_from_parts(nodes, edges).map_err(|error| error.to_string())?;

    match graph.topological_order() {
        Ok(order) => Ok(EvaluationOrderResponse::Ordered {
            order: order.iter().map(|id| id.as_str().to_owned()).collect(),
        }),
        Err(GraphError::CycleDetected { remaining }) => Ok(EvaluationOrderResponse::Cyclic {
            blocked: remaining.iter().map(|id| id.as_str().to_owned()).collect(),
        }),
        Err(error) => Err(error.to_string()),
    }
}

/// Calculates one deterministic evaluation order from a batched JSON request.
///
/// JSON is an adapter-owned ABI representation. Callers should use a typed
/// Grafting client and must not treat this serialization shape as graph logic.
/// Ordering and cycle detection stay authoritative in `grafting-graph-core`.
#[wasm_bindgen]
pub fn evaluation_order_json(request_json: &str) -> Result<String, JsValue> {
    let response = calculate_order(request_json).map_err(|error| JsValue::from_str(&error))?;
    serde_json::to_string(&response)
        .map_err(|error| JsValue::from_str(&format!("cannot serialize evaluation order: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn orders_producers_before_the_nodes_that_consume_them() {
        let response = calculate_order(
            r#"{
                "nodes":["node-2","node-1","node-3"],
                "edges":[
                    {"id":"edge-1","source":"node-1","target":"node-2"},
                    {"id":"edge-2","source":"node-2","target":"node-3"}
                ]
            }"#,
        )
        .unwrap();

        match response {
            EvaluationOrderResponse::Ordered { order } => {
                assert_eq!(order, vec!["node-1", "node-2", "node-3"]);
            }
            EvaluationOrderResponse::Cyclic { blocked } => {
                panic!("expected an order, got a cycle blocking {blocked:?}")
            }
        }
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn reports_a_cycle_as_data_instead_of_failing() {
        let response = calculate_order(
            r#"{
                "nodes":["node-1","node-2"],
                "edges":[
                    {"id":"edge-1","source":"node-1","target":"node-2"},
                    {"id":"edge-2","source":"node-2","target":"node-1"}
                ]
            }"#,
        )
        .unwrap();

        match response {
            EvaluationOrderResponse::Cyclic { blocked } => {
                assert_eq!(blocked, vec!["node-1", "node-2"]);
            }
            EvaluationOrderResponse::Ordered { order } => {
                panic!("expected a cycle, got the order {order:?}")
            }
        }
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn orders_an_unconnected_graph_deterministically() {
        let response =
            calculate_order(r#"{"nodes":["node-3","node-1","node-2"],"edges":[]}"#).unwrap();

        match response {
            EvaluationOrderResponse::Ordered { order } => {
                assert_eq!(order, vec!["node-1", "node-2", "node-3"]);
            }
            EvaluationOrderResponse::Cyclic { blocked } => {
                panic!("expected an order, got a cycle blocking {blocked:?}")
            }
        }
    }
}
