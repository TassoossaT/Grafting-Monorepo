use grafting_graph_core::{
    Edge, EdgeId, Graph, GraphError, GraphOps, GraphSnapshot, GroupedGridOptions, IdentifierError,
    LayoutError, LayoutPosition, LayoutSnapshot, Node, NodeId,
};

#[test]
fn public_names_and_signatures_remain_consumable() {
    let node_id = NodeId::new("node:a").expect("valid node ID");
    let target_id = NodeId::new("node:b").expect("valid node ID");
    let edge_id = EdgeId::new("edge:a-b").expect("valid edge ID");
    let nodes = vec![
        Node::new(node_id.clone(), 10_u32),
        Node::new(target_id.clone(), 20_u32),
    ];
    let edges = vec![Edge::new(
        edge_id.clone(),
        node_id.clone(),
        target_id.clone(),
        "depends_on",
    )];

    let graph: Graph<u32, &str> = Graph::try_from_parts(nodes, edges).expect("valid graph");
    let _: usize = graph.node_count();
    let _: usize = graph.edge_count();
    let _: Option<&Node<u32>> = graph.node(&node_id);
    let _: Option<&Edge<&str>> = graph.edge(&edge_id);
    let _: Result<Vec<NodeId>, GraphError> = graph.successors(&node_id);
    let _: Result<Vec<NodeId>, GraphError> = graph.predecessors(&target_id);
    let _: Result<Vec<NodeId>, GraphError> = graph.topological_order();

    fn via_graph_ops<'a, N, E, G: GraphOps<N, E>>(graph: &'a G, id: &NodeId) -> Option<&'a Node<N>> {
        graph.node(id)
    }
    let _: Option<&Node<u32>> = via_graph_ops(&graph, &node_id);
    let snapshot: GraphSnapshot<u32, &str> = graph.snapshot();
    let _: &[Node<u32>] = snapshot.nodes();
    let _: &[Edge<&str>] = snapshot.edges();

    let layout_options: GroupedGridOptions =
        GroupedGridOptions::new(220, 56, 24, 18, 72, 48, 3, 2).expect("valid layout");
    let layout: LayoutSnapshot = graph
        .grouped_grid_layout(&[], layout_options)
        .expect("valid grouped layout");
    let _: &[LayoutPosition] = layout.positions();
    let _: u32 = layout.width();
    let _: u32 = layout.height();
    let _: (Vec<LayoutPosition>, u32, u32) = layout.into_parts();
    let _: Option<LayoutError> = None;

    let _: Result<NodeId, IdentifierError> = NodeId::new(String::from("node:c"));
    let _: Result<EdgeId, IdentifierError> = EdgeId::new(String::from("edge:c"));
}
