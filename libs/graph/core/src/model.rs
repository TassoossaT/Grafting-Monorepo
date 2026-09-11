use std::collections::{BTreeMap, BTreeSet, HashMap};
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

    /// Returns mutable access to the caller-owned payload -- identity and
    /// graph membership are unaffected, only the payload changes.
    pub fn data_mut(&mut self) -> &mut N {
        &mut self.data
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
    /// Two input nodes use the same stable identity.
    DuplicateNode {
        /// Identity that appeared more than once.
        id: NodeId,
    },
    /// Two input edges use the same stable identity.
    DuplicateEdge {
        /// Identity that appeared more than once.
        id: EdgeId,
    },
    /// An edge refers to a source node that is not present.
    MissingSource {
        /// Edge containing the invalid endpoint.
        edge: EdgeId,
        /// Source identity that could not be resolved.
        source: NodeId,
    },
    /// An edge refers to a target node that is not present.
    MissingTarget {
        /// Edge containing the invalid endpoint.
        edge: EdgeId,
        /// Target identity that could not be resolved.
        target: NodeId,
    },
    /// A query refers to a node that is not present.
    UnknownNode {
        /// Identity that could not be resolved.
        id: NodeId,
    },
    /// A query refers to an edge that is not present.
    UnknownEdge {
        /// Identity that could not be resolved.
        id: EdgeId,
    },
    /// Topological ordering cannot consume every node because a cycle exists.
    CycleDetected {
        /// Deterministically sorted nodes left blocked by one or more cycles.
        remaining: Vec<NodeId>,
    },
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
            Self::UnknownEdge { id } => write!(formatter, "unknown edge ID {id}"),
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
#[derive(Debug, Clone)]
pub struct Graph<N, E> {
    storage: StableDiGraph<Node<N>, Edge<E>>,
    node_indices: HashMap<NodeId, NodeIndex>,
    edge_indices: HashMap<EdgeId, EdgeIndex>,
}

impl<N, E> Graph<N, E> {
    /// Validates identities and endpoints, then constructs the graph.
    pub fn try_from_parts(nodes: Vec<Node<N>>, edges: Vec<Edge<E>>) -> Result<Self, GraphError> {
        let mut storage = StableDiGraph::new();
        let mut node_indices = HashMap::with_capacity(nodes.len());
        let mut edge_indices = HashMap::with_capacity(edges.len());

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

    /// Inserts a new node. Errors if its identity is already used.
    pub fn add_node(&mut self, node: Node<N>) -> Result<(), GraphError> {
        let id = node.id().clone();
        if self.node_indices.contains_key(&id) {
            return Err(GraphError::DuplicateNode { id });
        }
        let index = self.storage.add_node(node);
        self.node_indices.insert(id, index);
        Ok(())
    }

    /// Inserts a new edge. Errors if its identity is already used or an
    /// endpoint is not a node already present in the graph.
    pub fn add_edge(&mut self, edge: Edge<E>) -> Result<(), GraphError> {
        let id = edge.id().clone();
        if self.edge_indices.contains_key(&id) {
            return Err(GraphError::DuplicateEdge { id });
        }
        let source = self
            .node_indices
            .get(edge.source())
            .copied()
            .ok_or_else(|| GraphError::MissingSource {
                edge: id.clone(),
                source: edge.source().clone(),
            })?;
        let target = self
            .node_indices
            .get(edge.target())
            .copied()
            .ok_or_else(|| GraphError::MissingTarget {
                edge: id.clone(),
                target: edge.target().clone(),
            })?;
        let index = self.storage.add_edge(source, target, edge);
        self.edge_indices.insert(id, index);
        Ok(())
    }

    /// Removes an edge by its stable identity, returning its payload.
    pub fn remove_edge(&mut self, id: &EdgeId) -> Result<Edge<E>, GraphError> {
        let index = self
            .edge_indices
            .remove(id)
            .ok_or_else(|| GraphError::UnknownEdge { id: id.clone() })?;
        Ok(self
            .storage
            .remove_edge(index)
            .expect("edge_indices and storage stay in sync"))
    }

    /// Removes a node and every edge incident to it, returning the node's
    /// payload. Callers needing the deletion-repair cycle rule
    /// (`ADR-0022`) implement it on top of this and [`successors`]/
    /// [`predecessors`], called *before* removal, to know which nodes were
    /// the deleted node's neighbors.
    ///
    /// [`successors`]: Self::successors
    /// [`predecessors`]: Self::predecessors
    pub fn remove_node(&mut self, id: &NodeId) -> Result<Node<N>, GraphError> {
        let index = self
            .node_indices
            .get(id)
            .copied()
            .ok_or_else(|| GraphError::UnknownNode { id: id.clone() })?;

        let mut incident_edge_ids = self
            .storage
            .edges_directed(index, Outgoing)
            .chain(self.storage.edges_directed(index, Incoming))
            .map(|edge_ref| edge_ref.weight().id().clone())
            .collect::<Vec<_>>();
        incident_edge_ids.sort();
        incident_edge_ids.dedup();
        for edge_id in incident_edge_ids {
            self.edge_indices.remove(&edge_id);
        }

        self.node_indices.remove(id);
        // `remove_node` cascades removal of every edge still incident to
        // `index` inside `storage` itself (petgraph's own behavior) -- the
        // loop above only keeps this crate's separate `edge_indices` id map
        // in sync with that cascade, it does not duplicate the removal.
        Ok(self
            .storage
            .remove_node(index)
            .expect("node_indices and storage stay in sync"))
    }

    /// Mutable access to a node's payload by stable identity.
    pub fn node_mut(&mut self, id: &NodeId) -> Option<&mut Node<N>> {
        let index = self.node_indices.get(id).copied()?;
        self.storage.node_weight_mut(index)
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
    ///
    /// Sorts explicitly rather than relying on iteration order: the
    /// identity maps are a `HashMap` (unordered), not a `BTreeMap`, so
    /// `GraphSnapshot`'s "sorted by stable identity" contract has to be
    /// established here, not inherited for free from storage.
    pub fn snapshot(&self) -> GraphSnapshot<N, E>
    where
        N: Clone,
        E: Clone,
    {
        let mut nodes = self
            .node_indices
            .values()
            .map(|index| self.storage[*index].clone())
            .collect::<Vec<_>>();
        nodes.sort_by(|left, right| left.id().cmp(right.id()));
        let mut edges = self
            .edge_indices
            .values()
            .map(|index| self.storage[*index].clone())
            .collect::<Vec<_>>();
        edges.sort_by(|left, right| left.id().cmp(right.id()));
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

/// Minimal read/traversal capability graph algorithms need, independent of
/// which concrete storage backend implements it.
///
/// Deliberately narrow: "given a node, its neighbors," per this crate's own
/// scoping (`docs/architecture/vtt-roadmap.md` E1.2) -- not a general graph
/// interface. [`Graph::topological_order`] and [`Graph::snapshot`] stay
/// inherent-only, since a construction-focused backend was explicitly
/// scoped to not need them. Mutation (`add_node`/`remove_node`/`add_edge`/
/// `remove_edge`/`node_mut`) stays inherent-only too, deliberately: there is
/// still exactly one backend, so splitting it into its own trait has no
/// second implementor to justify it yet -- add that split when (not before)
/// a second backend actually needs it.
///
/// Exists so a future storage backend (e.g. a deterministic backend, if
/// multiplayer replay becomes a real requirement) is an additional
/// implementation of this trait, not a rewrite of every algorithm already
/// written against it.
pub trait GraphOps<N, E> {
    /// Looks up a node by its stable identity.
    fn node(&self, id: &NodeId) -> Option<&Node<N>>;

    /// Looks up an edge by its stable identity.
    fn edge(&self, id: &EdgeId) -> Option<&Edge<E>>;

    /// Returns unique successor IDs in deterministic identity order.
    fn successors(&self, id: &NodeId) -> Result<Vec<NodeId>, GraphError>;

    /// Returns unique predecessor IDs in deterministic identity order.
    fn predecessors(&self, id: &NodeId) -> Result<Vec<NodeId>, GraphError>;
}

impl<N, E> GraphOps<N, E> for Graph<N, E> {
    fn node(&self, id: &NodeId) -> Option<&Node<N>> {
        Graph::node(self, id)
    }

    fn edge(&self, id: &EdgeId) -> Option<&Edge<E>> {
        Graph::edge(self, id)
    }

    fn successors(&self, id: &NodeId) -> Result<Vec<NodeId>, GraphError> {
        Graph::successors(self, id)
    }

    fn predecessors(&self, id: &NodeId) -> Result<Vec<NodeId>, GraphError> {
        Graph::predecessors(self, id)
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
    fn add_node_and_add_edge_reject_duplicates_and_missing_endpoints() {
        let mut graph = Graph::<(), ()>::try_from_parts(vec![node("a")], vec![]).unwrap();

        assert_eq!(
            graph.add_node(node("a")).unwrap_err(),
            GraphError::DuplicateNode {
                id: NodeId::new("a").unwrap()
            }
        );
        graph.add_node(node("b")).unwrap();
        assert_eq!(graph.node_count(), 2);

        assert_eq!(
            graph.add_edge(edge("e", "a", "missing")).unwrap_err(),
            GraphError::MissingTarget {
                edge: EdgeId::new("e").unwrap(),
                target: NodeId::new("missing").unwrap(),
            }
        );

        graph.add_edge(edge("ab", "a", "b")).unwrap();
        assert_eq!(
            graph.add_edge(edge("ab", "a", "b")).unwrap_err(),
            GraphError::DuplicateEdge {
                id: EdgeId::new("ab").unwrap()
            }
        );
        assert_eq!(
            graph.successors(&NodeId::new("a").unwrap()).unwrap(),
            vec![NodeId::new("b").unwrap()]
        );
    }

    #[test]
    fn remove_edge_rejects_unknown_id_and_forgets_the_edge() {
        let mut graph =
            Graph::<(), ()>::try_from_parts(vec![node("a"), node("b")], vec![edge("ab", "a", "b")])
                .unwrap();

        assert_eq!(
            graph
                .remove_edge(&EdgeId::new("missing").unwrap())
                .unwrap_err(),
            GraphError::UnknownEdge {
                id: EdgeId::new("missing").unwrap()
            }
        );

        graph.remove_edge(&EdgeId::new("ab").unwrap()).unwrap();
        assert_eq!(graph.edge_count(), 0);
        assert_eq!(
            graph.successors(&NodeId::new("a").unwrap()).unwrap(),
            Vec::new()
        );
        // The freed id is genuinely gone, not left as a dangling reservation.
        graph.add_edge(edge("ab", "a", "b")).unwrap();
    }

    #[test]
    fn remove_node_cascades_incident_edges_out_of_edge_indices() {
        let mut graph = Graph::<(), ()>::try_from_parts(
            vec![node("a"), node("b"), node("c")],
            vec![edge("ab", "a", "b"), edge("cb", "c", "b")],
        )
        .unwrap();

        assert_eq!(
            graph
                .remove_node(&NodeId::new("missing").unwrap())
                .unwrap_err(),
            GraphError::UnknownNode {
                id: NodeId::new("missing").unwrap()
            }
        );

        graph.remove_node(&NodeId::new("b").unwrap()).unwrap();
        assert_eq!(graph.node_count(), 2);
        // Both edges were incident to "b" and must be gone, not just the node.
        assert_eq!(graph.edge_count(), 0);
        assert!(graph.node(&NodeId::new("b").unwrap()).is_none());

        // The freed node and edge ids are genuinely gone, not dangling
        // reservations left over from the cascade -- this is exactly the
        // bug this test exists to catch: `storage.remove_node` cascades
        // edge removal internally, and `edge_indices` must be kept in sync
        // by hand or these two calls would incorrectly fail as duplicates.
        graph.add_node(node("b")).unwrap();
        graph.add_edge(edge("ab", "a", "b")).unwrap();
    }

    #[test]
    fn node_mut_allows_updating_payload_by_stable_identity() {
        let mut graph =
            Graph::<u32, ()>::try_from_parts(vec![Node::new(NodeId::new("a").unwrap(), 1)], vec![])
                .unwrap();

        assert!(graph.node_mut(&NodeId::new("missing").unwrap()).is_none());

        let payload = graph
            .node_mut(&NodeId::new("a").unwrap())
            .unwrap()
            .data_mut();
        *payload = 42;
        assert_eq!(*graph.node(&NodeId::new("a").unwrap()).unwrap().data(), 42);
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
    fn graph_ops_trait_is_generically_usable() {
        fn reachable_within_two_hops<N, E, G: GraphOps<N, E>>(
            graph: &G,
            start: &NodeId,
        ) -> Result<Vec<NodeId>, GraphError> {
            let mut seen = BTreeSet::new();
            for first in graph.successors(start)? {
                for second in graph.successors(&first)? {
                    seen.insert(second);
                }
                seen.insert(first);
            }
            Ok(seen.into_iter().collect())
        }

        let graph = Graph::try_from_parts(
            vec![node("a"), node("b"), node("c"), node("d")],
            vec![edge("ab", "a", "b"), edge("bc", "b", "c")],
        )
        .unwrap();

        assert_eq!(
            reachable_within_two_hops(&graph, &NodeId::new("a").unwrap()).unwrap(),
            vec![NodeId::new("b").unwrap(), NodeId::new("c").unwrap()]
        );
        assert!(GraphOps::node(&graph, &NodeId::new("d").unwrap()).is_some());
        assert!(GraphOps::edge(&graph, &EdgeId::new("ab").unwrap()).is_some());
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

    #[test]
    fn prism_grid_mesh_builds_and_verifies_six_slots() {
        let inputs = FormationInputs {
            primitive: GraphPrimitive::Surface,
            deformation_xy: 0.5,
            deformation_z: 0.2,
        };
        let mesh = PrismGridMesh::new(2, 2, 1, inputs);
        assert_eq!(mesh.cell_count(), 4);
        assert_eq!(mesh.cell_neighbors.len(), 4 * 6);
        assert_eq!(mesh.positions.len(), 9 * 2); // (2+1)*(2+1) per layer * 2 layers
    }
}

/// Generic domain-agnostic primitive role for graph formation.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum GraphPrimitive {
    /// Open passage / empty cell space.
    Passage = 0,
    /// Vertical separating structure / boundary.
    Boundary = 1,
    /// Horizontal ground or surface support.
    Surface = 2,
}

/// Generic formation inputs for mesh deformation and top-down layout.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FormationInputs {
    /// The primitive topological role.
    pub primitive: GraphPrimitive,
    /// Planar XY alignment deformation factor (0.0 = regular quad lattice, 1.0 = organic quad mesh).
    pub deformation_xy: f32,
    /// Vertical Z height variation factor (0.0 = flat plane, 1.0 = chaotic terrain desnivel).
    pub deformation_z: f32,
}

impl Default for FormationInputs {
    fn default() -> Self {
        Self {
            primitive: GraphPrimitive::Surface,
            deformation_xy: 0.0,
            deformation_z: 0.0,
        }
    }
}

/// A 3D prism grid mesh representing cells with 6 contiguous neighbor slots
/// (4 lateral, 1 bottom, 1 top), positions, and deformation inputs.
#[derive(Debug, Clone, PartialEq)]
pub struct PrismGridMesh {
    /// Flat list of 3D vertex positions [x, y, z] for corners across all layers.
    pub positions: Vec<[f32; 3]>,
    /// 8 corner vertex indices per cell [V0..V7].
    pub cell_corners: Vec<[u32; 8]>,
    /// Contiguous list of 6 neighbor cell IDs per cell [North, East, South, West, Bottom, Top].
    /// u32::MAX indicates a boundary edge (no neighbor).
    pub cell_neighbors: Vec<u32>,
    /// Formation inputs per cell.
    pub inputs: Vec<FormationInputs>,
    /// Width of the grid in cells.
    pub width: u32,
    /// Height of the grid in cells.
    pub height: u32,
    /// Number of vertical layers in the grid.
    pub layers: u32,
}

impl PrismGridMesh {
    /// Constructs a grid of width x height x layers cells with 6-slot connectivity.
    pub fn new(width: u32, height: u32, layers: u32, inputs: FormationInputs) -> Self {
        let cell_count = (width * height * layers) as usize;
        let vert_cols = (width + 1) * (height + 1);
        let vert_count = (vert_cols * (layers + 1)) as usize;

        let mut positions = Vec::with_capacity(vert_count);
        for l in 0..=layers {
            let z_base = l as f32;
            for y in 0..=height {
                for x in 0..=width {
                    let mut px = x as f32;
                    let mut py = y as f32;
                    let mut pz = z_base;

                    if inputs.deformation_xy > 0.0 && x > 0 && x < width && y > 0 && y < height {
                        let shift_x =
                            (x as f32 * 1.3 + y as f32 * 0.7).sin() * 0.25 * inputs.deformation_xy;
                        let shift_y =
                            (x as f32 * 0.9 - y as f32 * 1.1).cos() * 0.25 * inputs.deformation_xy;
                        px += shift_x;
                        py += shift_y;
                    }

                    if inputs.deformation_z > 0.0 {
                        let shift_z = (x as f32 * 0.8 + y as f32 * 1.2 + l as f32 * 0.5).sin()
                            * 0.5
                            * inputs.deformation_z;
                        pz += shift_z;
                    }

                    positions.push([px, py, pz]);
                }
            }
        }

        let mut cell_corners = Vec::with_capacity(cell_count);
        let mut cell_neighbors = vec![u32::MAX; cell_count * 6];
        let cell_inputs = vec![inputs; cell_count];

        for l in 0..layers {
            for y in 0..height {
                for x in 0..width {
                    let cell_idx = (l * width * height + y * width + x) as usize;

                    let stride_xy = width + 1;
                    let layer_offset = l * vert_cols;
                    let next_layer_offset = (l + 1) * vert_cols;

                    let v0 = layer_offset + y * stride_xy + x;
                    let v1 = layer_offset + y * stride_xy + (x + 1);
                    let v2 = layer_offset + (y + 1) * stride_xy + (x + 1);
                    let v3 = layer_offset + (y + 1) * stride_xy + x;

                    let v4 = next_layer_offset + y * stride_xy + x;
                    let v5 = next_layer_offset + y * stride_xy + (x + 1);
                    let v6 = next_layer_offset + (y + 1) * stride_xy + (x + 1);
                    let v7 = next_layer_offset + (y + 1) * stride_xy + x;

                    cell_corners.push([
                        v0 as u32, v1 as u32, v2 as u32, v3 as u32, v4 as u32, v5 as u32,
                        v6 as u32, v7 as u32,
                    ]);

                    // Neighbors: [North(0), East(1), South(2), West(3), Bottom(4), Top(5)]
                    let base_n = cell_idx * 6;
                    if y > 0 {
                        cell_neighbors[base_n] = (l * width * height + (y - 1) * width + x) as u32;
                    }
                    if x + 1 < width {
                        cell_neighbors[base_n + 1] =
                            (l * width * height + y * width + (x + 1)) as u32;
                    }
                    if y + 1 < height {
                        cell_neighbors[base_n + 2] =
                            (l * width * height + (y + 1) * width + x) as u32;
                    }
                    if x > 0 {
                        cell_neighbors[base_n + 3] =
                            (l * width * height + y * width + (x - 1)) as u32;
                    }
                    if l > 0 {
                        cell_neighbors[base_n + 4] =
                            ((l - 1) * width * height + y * width + x) as u32;
                    }
                    if l + 1 < layers {
                        cell_neighbors[base_n + 5] =
                            ((l + 1) * width * height + y * width + x) as u32;
                    }
                }
            }
        }

        Self {
            positions,
            cell_corners,
            cell_neighbors,
            inputs: cell_inputs,
            width,
            height,
            layers,
        }
    }

    /// Total number of cells in the mesh.
    pub fn cell_count(&self) -> usize {
        (self.width * self.height * self.layers) as usize
    }
}
