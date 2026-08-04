use std::env;
use std::fs;
use std::path::Path;
use std::process::ExitCode;

use grafting_graph_core::{Edge, EdgeId, Graph, Node, NodeId};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphIrDocument {
    nodes: Vec<GraphIrNode>,
    edges: Vec<GraphIrEdge>,
}

#[derive(Deserialize)]
struct GraphIrNode {
    id: String,
}

#[derive(Deserialize)]
struct GraphIrEdge {
    id: String,
    source: String,
    target: String,
}

fn validate(path: &Path) -> Result<(usize, usize), String> {
    let source = fs::read_to_string(path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    let document: GraphIrDocument = serde_json::from_str(&source)
        .map_err(|error| format!("cannot parse {}: {error}", path.display()))?;

    let nodes = document
        .nodes
        .into_iter()
        .map(|node| {
            NodeId::new(node.id)
                .map(|id| Node::new(id, ()))
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let edges = document
        .edges
        .into_iter()
        .map(|edge| {
            let id = EdgeId::new(edge.id).map_err(|error| error.to_string())?;
            let source = NodeId::new(edge.source).map_err(|error| error.to_string())?;
            let target = NodeId::new(edge.target).map_err(|error| error.to_string())?;
            Ok(Edge::new(id, source, target, ()))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let graph = Graph::try_from_parts(nodes, edges).map_err(|error| error.to_string())?;
    Ok((graph.node_count(), graph.edge_count()))
}

fn main() -> ExitCode {
    let mut arguments = env::args_os().skip(1);
    let Some(path) = arguments.next() else {
        eprintln!("usage: validate-graph-ir <graph-ir.json>");
        return ExitCode::FAILURE;
    };
    if arguments.next().is_some() {
        eprintln!("validate-graph-ir accepts exactly one file");
        return ExitCode::FAILURE;
    }

    let path = Path::new(&path);
    match validate(path) {
        Ok((nodes, edges)) => {
            let node_label = if nodes == 1 { "node" } else { "nodes" };
            let edge_label = if edges == 1 { "edge" } else { "edges" };
            println!(
                "Graph IR structure valid: {} ({nodes} {node_label}, {edges} {edge_label})",
                path.display()
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("Graph IR structural validation failed: {error}");
            ExitCode::FAILURE
        }
    }
}
