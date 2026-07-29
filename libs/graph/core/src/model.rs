use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt;

use petgraph::Direction::{Incoming, Outgoing};
use petgraph::stable_graph::{EdgeIndex, NodeIndex, StableDiGraph};
use petgraph::visit::EdgeRef;

/// Failure to construct a stable graph identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentifierError {
    /// A node identifier must contain at least one character.
    EmptyNodeId,
    /// An edge identifier must contain at least one character.
    EmptyEdgeId,
}

impl fmt::Display for IdentifierError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyNodeId => formatter.write_str("node ID must not be empty"),
            Self::EmptyEdgeId => formatter.write_str("edge ID must not be empty"),
        }
    }
}

impl Error for IdentifierError {}

macro_rules! graph_identifier {
    ($name:ident, $empty_error:expr, $description:literal) => {
        #[doc = $description]
        #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(String);

        impl $name {
            /// Creates a non-empty identifier without applying product-specific
            /// normalization rules.
            pub fn new(value: impl Into<String>) -> Result<Self, IdentifierError> {
                let value = value.into();
                if value.is_empty() {
                    return Err($empty_error);
                }
                Ok(Self(value))
            }

            /// Returns the stable identifier text.
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(&self.0)
            }
        }

        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                self.as_str()
            }
        }
    };
}

graph_identifier!(
    NodeId,
    IdentifierError::EmptyNodeId,
    "Stable Grafting node identity."
);
graph_identifier!(
    EdgeId,
    IdentifierError::EmptyEdgeId,
    "Stable Grafting edge identity."
);

/// A graph node with a stable identity and caller-chosen calculation payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node<N> {
    id: NodeId,
    data: N,
}

impl<N> Node<N> {
    /// Creates a node from a Grafting identity and payload.
    pub fn new(id: NodeId, data: N) -> Self {
        Self { id, data }
    }

    /// Returns the stable node identity.
    pub fn id(&self) -> &NodeId {
        &self.id
    }

    /// Returns the caller-owned payload.
    pub fn data(&self) -> &N {
        &self.data
    }

    /// Consumes the node and returns its identity and payload.
    pub fn into_parts(self) -> (NodeId, N) {
        (self.id, self.data)
    }
}

/// A directed graph edge with stable identity and caller-chosen payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edge<E> {
    id: EdgeId,
    source: NodeId,
    target: NodeId,
    data: E,
}

impl<E> Edge<E> {
    /// Creates a directed edge from `source` to `target`.
    pub fn new(id: EdgeId, source: NodeId, target: NodeId, data: E) -> Self {
        Self {
            id,
            source,
            target,
            data,
        }
    }

    /// Returns the stable edge identity.
    pub fn id(&self) -> &EdgeId {
        &self.id
    }

    /// Returns the source node identity.
    pub fn source(&self) -> &NodeId {
        &self.source
    }

    /// Returns the target node identity.
    pub fn target(&self) -> &NodeId {
        &self.target
    }

    /// Returns the caller-owned payload.
    pub fn data(&self) -> &E {
        &self.data
    }

    /// Consumes the edge and returns its identity, endpoints, and payload.
    pub fn into_parts(self) -> (EdgeId, NodeId, NodeId, E) {
        (self.id, self.source, self.target, self.data)
    }
}

/// Immutable, deterministically ordered graph data safe to pass to adapters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphSnapshot<N, E> {
    nodes: Vec<Node<N>>,
    edges: Vec<Edge<E>>,
}

impl<N, E> GraphSnapshot<N, E> {
    /// Nodes sorted by stable node identity.
    pub fn nodes(&self) -> &[Node<N>] {
        &self.nodes
    }

    /// Edges sorted by stable edge identity.
    pub fn edges(&self) -> &[Edge<E>] {
        &self.edges
    }

    /// Consumes the snapshot and returns its ordered records.
    pub fn into_parts(self) -> (Vec<Node<N>>, Vec<Edge<E>>) {
        (self.nodes, self.edges)
    }
}

/// Structural or algorithm error returned through the Grafting graph contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GraphError {
    DuplicateNode { id: NodeId },
    DuplicateEdge { id: EdgeId },
    MissingSource { edge: EdgeId, source: NodeId },
    MissingTarget { edge: EdgeId, target: NodeId },
    UnknownNode { id: NodeId },
    CycleDetected { remaining: Vec<NodeId> },
}

impl fmt::Display for GraphError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DuplicateNode { id } => write!(formatter, "duplicate node ID {id}"),
            Self::DuplicateEdge { id } => write!(formatter, "duplicate edge ID {id}"),
            Self::MissingSource { edge, source } => {
                write!(formatter, "edge {edge} references missing source {source}")
            }
            Self::MissingTarget { edge, target } => {
                write!(formatter, "edge {edge} references missing target {target}")
            }
            Self::UnknownNode { id } => write!(formatter, "unknown node ID {id}"),
            Self::CycleDetected { remaining } => {
                write!(formatter, "cycle prevents ordering of")?;
                for node in remaining {
                    write!(formatter, " {node}")?;
                }
                Ok(())
            }
        }
    }
}

impl Error for GraphError {}

/// Generic directed multigraph with private storage and deterministic queries.
#[derive(Debug)]
pub struct Graph<N, E> {
    storage: StableDiGraph<Node<N>, Edge<E>>,
    node_indices: BTreeMap<NodeId, NodeIndex>,
    edge_indices: BTreeMap<EdgeId, EdgeIndex>,
}

impl<N, E> Graph<N, E> {
    /// Validates identities and endpoints, then constructs the graph.
    pub fn try_from_parts(nodes: Vec<Node<N>>, edges: Vec<Edge<E>>) -> Result<Self, GraphError> {
        let mut storage = StableDiGraph::new();
        let mut node_indices = BTreeMap::new();
        let mut edge_indices = BTreeMap::new();

        for node in nodes {
            let id = node.id.clone();
            if node_indices.contains_key(&id) {
                return Err(GraphError::DuplicateNode { id });
            }
            let index = storage.add_node(node);
            node_indices.insert(id, index);
        }

        for edge in edges {
            let id = edge.id.clone();
            if edge_indices.contains_key(&id) {
                return Err(GraphError::DuplicateEdge { id });
            }
            let source = node_indices.get(&edge.source).copied().ok_or_else(|| {
                GraphError::MissingSource {
                    edge: id.clone(),
                    source: edge.source.clone(),
                }
            })?;
            let target = node_indices.get(&edge.target).copied().ok_or_else(|| {
                GraphError::MissingTarget {
                    edge: id.clone(),
                    target: edge.target.clone(),
                }
            })?;
            let index = storage.add_edge(source, target, edge);
            edge_indices.insert(id, index);
        }

        Ok(Self {
            storage,
            node_indices,
            edge_indices,
        })
    }

    /// Number of nodes in the graph.
    pub fn node_count(&self) -> usize {
        self.node_indices.len()
    }

    /// Number of edges in the graph.
    pub fn edge_count(&self) -> usize {
        self.edge_indices.len()
    }

    /// Looks up a node without exposing the storage engine's index type.
    pub fn node(&self, id: &NodeId) -> Option<&Node<N>> {
        self.node_indices
            .get(id)
            .and_then(|index| self.storage.node_weight(*index))
    }

    /// Looks up an edge without exposing the storage engine's index type.
    pub fn edge(&self, id: &EdgeId) -> Option<&Edge<E>> {
        self.edge_indices
            .get(id)
            .and_then(|index| self.storage.edge_weight(*index))
    }

    /// Returns unique successor IDs in deterministic identity order.
    pub fn successors(&self, id: &NodeId) -> Result<Vec<NodeId>, GraphError> {
        self.neighbors(id, Outgoing)
    }

    /// Returns unique predecessor IDs in deterministic identity order.
    pub fn predecessors(&self, id: &NodeId) -> Result<Vec<NodeId>, GraphError> {
        self.neighbors(id, Incoming)
    }

    /// Returns a deterministic topological order or the nodes left blocked by a cycle.
    pub fn topological_order(&self) -> Result<Vec<NodeId>, GraphError> {
        let mut in_degree = self
            .node_indices
            .keys()
            .cloned()
            .map(|id| (id, 0_usize))
            .collect::<BTreeMap<_, _>>();

        for edge_index in self.storage.edge_indices() {
            let (_, target) = self
                .storage
                .edge_endpoints(edge_index)
                .expect("an existing edge always has endpoints");
            let target_id = self.storage[target].id();
            *in_degree
                .get_mut(target_id)
                .expect("every stored edge target has an indexed node") += 1;
        }

        let mut ready = in_degree
            .iter()
            .filter_map(|(id, degree)| (*degree == 0).then_some(id.clone()))
            .collect::<BTreeSet<_>>();
        let mut ordered = Vec::with_capacity(self.node_count());

        while let Some(id) = ready.pop_first() {
            let index = self.node_indices[&id];
            ordered.push(id);

            let mut targets = self
                .storage
                .edges_directed(index, Outgoing)
                .map(|edge| self.storage[edge.target()].id().clone())
                .collect::<Vec<_>>();
            targets.sort();

            for target in targets {
                let degree = in_degree
                    .get_mut(&target)
                    .expect("every stored edge target has an indexed node");
                *degree -= 1;
                if *degree == 0 {
                    ready.insert(target);
                }
            }
        }

        if ordered.len() != self.node_count() {
            let remaining = in_degree
                .into_iter()
                .filter_map(|(id, degree)| (degree > 0).then_some(id))
                .collect();
            return Err(GraphError::CycleDetected { remaining });
        }

        Ok(ordered)
    }

    /// Clones an immutable snapshot sorted by stable identities.
    pub fn snapshot(&self) -> GraphSnapshot<N, E>
    where
        N: Clone,
        E: Clone,
    {
        let nodes = self
            .node_indices
            .values()
            .map(|index| self.storage[*index].clone())
            .collect();
        let edges = self
            .edge_indices
            .values()
            .map(|index| self.storage[*index].clone())
            .collect();
        GraphSnapshot { nodes, edges }
    }

    fn neighbors(
        &self,
        id: &NodeId,
        direction: petgraph::Direction,
    ) -> Result<Vec<NodeId>, GraphError> {
        let index = self
            .node_indices
            .get(id)
            .copied()
            .ok_or_else(|| GraphError::UnknownNode { id: id.clone() })?;
        let mut neighbors = self
            .storage
            .neighbors_directed(index, direction)
            .map(|neighbor| self.storage[neighbor].id().clone())
            .collect::<Vec<_>>();
        neighbors.sort();
        neighbors.dedup();
        Ok(neighbors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str) -> Node<()> {
        Node::new(NodeId::new(id).unwrap(), ())
    }

    fn edge(id: &str, source: &str, target: &str) -> Edge<()> {
        Edge::new(
            EdgeId::new(id).unwrap(),
            NodeId::new(source).unwrap(),
            NodeId::new(target).unwrap(),
            (),
        )
    }

    #[test]
    fn rejects_duplicate_identities_and_missing_endpoints() {
        let duplicate_node = Graph::<(), ()>::try_from_parts(vec![node("a"), node("a")], vec![]);
        assert_eq!(
            duplicate_node.unwrap_err(),
            GraphError::DuplicateNode {
                id: NodeId::new("a").unwrap()
            }
        );

        let duplicate_edge = Graph::try_from_parts(
            vec![node("a"), node("b")],
            vec![edge("e", "a", "b"), edge("e", "a", "b")],
        );
        assert_eq!(
            duplicate_edge.unwrap_err(),
            GraphError::DuplicateEdge {
                id: EdgeId::new("e").unwrap()
            }
        );

        let missing_target =
            Graph::try_from_parts(vec![node("a")], vec![edge("e", "a", "missing")]);
        assert_eq!(
            missing_target.unwrap_err(),
            GraphError::MissingTarget {
                edge: EdgeId::new("e").unwrap(),
                target: NodeId::new("missing").unwrap(),
            }
        );

        let missing_source =
            Graph::try_from_parts(vec![node("b")], vec![edge("e", "missing", "b")]);
        assert_eq!(
            missing_source.unwrap_err(),
            GraphError::MissingSource {
                edge: EdgeId::new("e").unwrap(),
                source: NodeId::new("missing").unwrap(),
            }
        );
    }

    #[test]
    fn orders_queries_and_snapshots_by_stable_identity() {
        let graph = Graph::try_from_parts(
            vec![node("c"), node("a"), node("b")],
            vec![edge("z", "a", "c"), edge("a", "a", "b")],
        )
        .unwrap();

        assert_eq!(
            graph.successors(&NodeId::new("a").unwrap()).unwrap(),
            vec![NodeId::new("b").unwrap(), NodeId::new("c").unwrap()]
        );
        assert_eq!(
            graph.topological_order().unwrap(),
            vec![
                NodeId::new("a").unwrap(),
                NodeId::new("b").unwrap(),
                NodeId::new("c").unwrap(),
            ]
        );

        let snapshot = graph.snapshot();
        let node_ids = snapshot.nodes().iter().map(Node::id).collect::<Vec<_>>();
        let edge_ids = snapshot.edges().iter().map(Edge::id).collect::<Vec<_>>();
        assert_eq!(
            node_ids,
            vec![
                &NodeId::new("a").unwrap(),
                &NodeId::new("b").unwrap(),
                &NodeId::new("c").unwrap()
            ]
        );
        assert_eq!(
            edge_ids,
            vec![&EdgeId::new("a").unwrap(), &EdgeId::new("z").unwrap()]
        );
    }

    #[test]
    fn reports_cycle_nodes_deterministically() {
        let graph = Graph::try_from_parts(
            vec![node("b"), node("a")],
            vec![edge("ab", "a", "b"), edge("ba", "b", "a")],
        )
        .unwrap();

        assert_eq!(
            graph.topological_order().unwrap_err(),
            GraphError::CycleDetected {
                remaining: vec![NodeId::new("a").unwrap(), NodeId::new("b").unwrap()]
            }
        );
    }
}
