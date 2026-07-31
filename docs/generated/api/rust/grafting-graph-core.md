# grafting-graph-core

### `impl<E: core::clone::Clone> core::clone::Clone for grafting_graph_core::Edge<E>`

### `impl<E: core::cmp::Eq> core::cmp::Eq for grafting_graph_core::Edge<E>`

### `impl<E: core::cmp::PartialEq> core::cmp::PartialEq for grafting_graph_core::Edge<E>`

### `impl<E: core::fmt::Debug> core::fmt::Debug for grafting_graph_core::Edge<E>`

### `impl<E> core::marker::Freeze for grafting_graph_core::Edge<E> where E: core::marker::Freeze`

### `impl<E> core::marker::Send for grafting_graph_core::Edge<E> where E: core::marker::Send`

### `impl<E> core::marker::StructuralPartialEq for grafting_graph_core::Edge<E>`

### `impl<E> core::marker::Sync for grafting_graph_core::Edge<E> where E: core::marker::Sync`

### `impl<E> core::marker::Unpin for grafting_graph_core::Edge<E> where E: core::marker::Unpin`

### `impl<E> core::panic::unwind_safe::RefUnwindSafe for grafting_graph_core::Edge<E> where E: core::panic::unwind_safe::RefUnwindSafe`

### `impl<E> core::panic::unwind_safe::UnwindSafe for grafting_graph_core::Edge<E> where E: core::panic::unwind_safe::UnwindSafe`

### `impl<E> grafting_graph_core::Edge<E>`

### `impl<N, E> core::marker::Freeze for grafting_graph_core::Graph<N, E>`

### `impl<N, E> core::marker::Freeze for grafting_graph_core::GraphSnapshot<N, E>`

### `impl<N, E> core::marker::Send for grafting_graph_core::Graph<N, E> where N: core::marker::Send, E: core::marker::Send`

### `impl<N, E> core::marker::Send for grafting_graph_core::GraphSnapshot<N, E> where N: core::marker::Send, E: core::marker::Send`

### `impl<N, E> core::marker::StructuralPartialEq for grafting_graph_core::GraphSnapshot<N, E>`

### `impl<N, E> core::marker::Sync for grafting_graph_core::Graph<N, E> where N: core::marker::Sync, E: core::marker::Sync`

### `impl<N, E> core::marker::Sync for grafting_graph_core::GraphSnapshot<N, E> where N: core::marker::Sync, E: core::marker::Sync`

### `impl<N, E> core::marker::Unpin for grafting_graph_core::Graph<N, E> where N: core::marker::Unpin, E: core::marker::Unpin`

### `impl<N, E> core::marker::Unpin for grafting_graph_core::GraphSnapshot<N, E> where N: core::marker::Unpin, E: core::marker::Unpin`

### `impl<N, E> core::panic::unwind_safe::RefUnwindSafe for grafting_graph_core::Graph<N, E> where N: core::panic::unwind_safe::RefUnwindSafe, E: core::panic::unwind_safe::RefUnwindSafe`

### `impl<N, E> core::panic::unwind_safe::RefUnwindSafe for grafting_graph_core::GraphSnapshot<N, E> where N: core::panic::unwind_safe::RefUnwindSafe, E: core::panic::unwind_safe::RefUnwindSafe`

### `impl<N, E> core::panic::unwind_safe::UnwindSafe for grafting_graph_core::Graph<N, E> where N: core::panic::unwind_safe::UnwindSafe, E: core::panic::unwind_safe::UnwindSafe`

### `impl<N, E> core::panic::unwind_safe::UnwindSafe for grafting_graph_core::GraphSnapshot<N, E> where N: core::panic::unwind_safe::UnwindSafe, E: core::panic::unwind_safe::UnwindSafe`

### `impl<N, E> grafting_graph_core::Graph<N, E>`

### `impl<N, E> grafting_graph_core::GraphSnapshot<N, E>`

### `impl<N: core::clone::Clone, E: core::clone::Clone> core::clone::Clone for grafting_graph_core::GraphSnapshot<N, E>`

### `impl<N: core::clone::Clone, E: core::clone::Clone> grafting_graph_core::Graph<N, E>`

### `impl<N: core::clone::Clone> core::clone::Clone for grafting_graph_core::Node<N>`

### `impl<N: core::cmp::Eq, E: core::cmp::Eq> core::cmp::Eq for grafting_graph_core::GraphSnapshot<N, E>`

### `impl<N: core::cmp::Eq> core::cmp::Eq for grafting_graph_core::Node<N>`

### `impl<N: core::cmp::PartialEq, E: core::cmp::PartialEq> core::cmp::PartialEq for grafting_graph_core::GraphSnapshot<N, E>`

### `impl<N: core::cmp::PartialEq> core::cmp::PartialEq for grafting_graph_core::Node<N>`

### `impl<N: core::fmt::Debug, E: core::fmt::Debug> core::fmt::Debug for grafting_graph_core::Graph<N, E>`

### `impl<N: core::fmt::Debug, E: core::fmt::Debug> core::fmt::Debug for grafting_graph_core::GraphSnapshot<N, E>`

### `impl<N: core::fmt::Debug> core::fmt::Debug for grafting_graph_core::Node<N>`

### `impl<N> core::marker::Freeze for grafting_graph_core::Node<N> where N: core::marker::Freeze`

### `impl<N> core::marker::Send for grafting_graph_core::Node<N> where N: core::marker::Send`

### `impl<N> core::marker::StructuralPartialEq for grafting_graph_core::Node<N>`

### `impl<N> core::marker::Sync for grafting_graph_core::Node<N> where N: core::marker::Sync`

### `impl<N> core::marker::Unpin for grafting_graph_core::Node<N> where N: core::marker::Unpin`

### `impl<N> core::panic::unwind_safe::RefUnwindSafe for grafting_graph_core::Node<N> where N: core::panic::unwind_safe::RefUnwindSafe`

### `impl<N> core::panic::unwind_safe::UnwindSafe for grafting_graph_core::Node<N> where N: core::panic::unwind_safe::UnwindSafe`

### `impl<N> grafting_graph_core::Node<N>`

### `pub enum grafting_graph_core::GraphError`

Structural or algorithm error returned through the Grafting graph contract.

### `pub enum grafting_graph_core::IdentifierError`

Failure to construct a stable graph identifier.

### `pub enum grafting_graph_core::LayoutError`

Invalid input or arithmetic failure from the grouped-grid heuristic.

### `pub fn grafting_graph_core::Edge<E>::clone(&self) -> grafting_graph_core::Edge<E>`

### `pub fn grafting_graph_core::Edge<E>::data(&self) -> &E`

Returns the caller-owned payload.

### `pub fn grafting_graph_core::Edge<E>::eq(&self, other: &grafting_graph_core::Edge<E>) -> bool`

### `pub fn grafting_graph_core::Edge<E>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_graph_core::Edge<E>::id(&self) -> &grafting_graph_core::EdgeId`

Returns the stable edge identity.

### `pub fn grafting_graph_core::Edge<E>::into_parts(self) -> (grafting_graph_core::EdgeId, grafting_graph_core::NodeId, grafting_graph_core::NodeId, E)`

Consumes the edge and returns its identity, endpoints, and payload.

### `pub fn grafting_graph_core::Edge<E>::new(id: grafting_graph_core::EdgeId, source: grafting_graph_core::NodeId, target: grafting_graph_core::NodeId, data: E) -> Self`

Creates a directed edge from `source` to `target`.

### `pub fn grafting_graph_core::Edge<E>::source(&self) -> &grafting_graph_core::NodeId`

Returns the source node identity.

### `pub fn grafting_graph_core::Edge<E>::target(&self) -> &grafting_graph_core::NodeId`

Returns the target node identity.

### `pub fn grafting_graph_core::EdgeId::as_ref(&self) -> &str`

### `pub fn grafting_graph_core::EdgeId::as_str(&self) -> &str`

Returns the stable identifier text.

### `pub fn grafting_graph_core::EdgeId::new(value: impl core::convert::Into<alloc::string::String>) -> core::result::Result<Self, grafting_graph_core::IdentifierError>`

Creates a non-empty identifier without applying product-specific
normalization rules.

### `pub fn grafting_graph_core::Graph<N, E>::edge(&self, id: &grafting_graph_core::EdgeId) -> core::option::Option<&grafting_graph_core::Edge<E>>`

Looks up an edge without exposing the storage engine's index type.

### `pub fn grafting_graph_core::Graph<N, E>::edge_count(&self) -> usize`

Number of edges in the graph.

### `pub fn grafting_graph_core::Graph<N, E>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_graph_core::Graph<N, E>::grouped_grid_layout(&self, grouping_edges: &[grafting_graph_core::EdgeId], options: grafting_graph_core::GroupedGridOptions) -> core::result::Result<grafting_graph_core::LayoutSnapshot, grafting_graph_core::LayoutError>`

Places one-level groups in a deterministic grid and their members below
the corresponding group root.

`grouping_edges` explicitly identifies which existing graph edges mean
containment for this calculation. All other edges remain structurally
valid graph data but do not influence this presentation heuristic.

### `pub fn grafting_graph_core::Graph<N, E>::node(&self, id: &grafting_graph_core::NodeId) -> core::option::Option<&grafting_graph_core::Node<N>>`

Looks up a node without exposing the storage engine's index type.

### `pub fn grafting_graph_core::Graph<N, E>::node_count(&self) -> usize`

Number of nodes in the graph.

### `pub fn grafting_graph_core::Graph<N, E>::predecessors(&self, id: &grafting_graph_core::NodeId) -> core::result::Result<alloc::vec::Vec<grafting_graph_core::NodeId>, grafting_graph_core::GraphError>`

Returns unique predecessor IDs in deterministic identity order.

### `pub fn grafting_graph_core::Graph<N, E>::snapshot(&self) -> grafting_graph_core::GraphSnapshot<N, E> where N: core::clone::Clone, E: core::clone::Clone`

Clones an immutable snapshot sorted by stable identities.

### `pub fn grafting_graph_core::Graph<N, E>::successors(&self, id: &grafting_graph_core::NodeId) -> core::result::Result<alloc::vec::Vec<grafting_graph_core::NodeId>, grafting_graph_core::GraphError>`

Returns unique successor IDs in deterministic identity order.

### `pub fn grafting_graph_core::Graph<N, E>::topological_order(&self) -> core::result::Result<alloc::vec::Vec<grafting_graph_core::NodeId>, grafting_graph_core::GraphError>`

Returns a deterministic topological order or the nodes left blocked by a cycle.

### `pub fn grafting_graph_core::Graph<N, E>::try_from_parts(nodes: alloc::vec::Vec<grafting_graph_core::Node<N>>, edges: alloc::vec::Vec<grafting_graph_core::Edge<E>>) -> core::result::Result<Self, grafting_graph_core::GraphError>`

Validates identities and endpoints, then constructs the graph.

### `pub fn grafting_graph_core::GraphSnapshot<N, E>::clone(&self) -> grafting_graph_core::GraphSnapshot<N, E>`

### `pub fn grafting_graph_core::GraphSnapshot<N, E>::edges(&self) -> &[grafting_graph_core::Edge<E>]`

Edges sorted by stable edge identity.

### `pub fn grafting_graph_core::GraphSnapshot<N, E>::eq(&self, other: &grafting_graph_core::GraphSnapshot<N, E>) -> bool`

### `pub fn grafting_graph_core::GraphSnapshot<N, E>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_graph_core::GraphSnapshot<N, E>::into_parts(self) -> (alloc::vec::Vec<grafting_graph_core::Node<N>>, alloc::vec::Vec<grafting_graph_core::Edge<E>>)`

Consumes the snapshot and returns its ordered records.

### `pub fn grafting_graph_core::GraphSnapshot<N, E>::nodes(&self) -> &[grafting_graph_core::Node<N>]`

Nodes sorted by stable node identity.

### `pub fn grafting_graph_core::GroupedGridOptions::new(node_width: u32, node_height: u32, horizontal_gap: u32, vertical_gap: u32, group_gap: u32, padding: u32, group_columns: u32, member_columns: u32) -> core::result::Result<Self, grafting_graph_core::LayoutError>`

Creates validated grouped-grid dimensions.

### `pub fn grafting_graph_core::LayoutPosition::node_id(&self) -> &grafting_graph_core::NodeId`

Stable node identity associated with this position.

### `pub fn grafting_graph_core::LayoutPosition::x(&self) -> u32`

Horizontal coordinate in caller-defined presentation units.

### `pub fn grafting_graph_core::LayoutPosition::y(&self) -> u32`

Vertical coordinate in caller-defined presentation units.

### `pub fn grafting_graph_core::LayoutSnapshot::height(&self) -> u32`

Height required to contain every position and the configured padding.

### `pub fn grafting_graph_core::LayoutSnapshot::into_parts(self) -> (alloc::vec::Vec<grafting_graph_core::LayoutPosition>, u32, u32)`

Consumes the snapshot into its positions and bounds.

### `pub fn grafting_graph_core::LayoutSnapshot::positions(&self) -> &[grafting_graph_core::LayoutPosition]`

Positions sorted by stable node identity.

### `pub fn grafting_graph_core::LayoutSnapshot::width(&self) -> u32`

Width required to contain every position and the configured padding.

### `pub fn grafting_graph_core::Node<N>::clone(&self) -> grafting_graph_core::Node<N>`

### `pub fn grafting_graph_core::Node<N>::data(&self) -> &N`

Returns the caller-owned payload.

### `pub fn grafting_graph_core::Node<N>::eq(&self, other: &grafting_graph_core::Node<N>) -> bool`

### `pub fn grafting_graph_core::Node<N>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_graph_core::Node<N>::id(&self) -> &grafting_graph_core::NodeId`

Returns the stable node identity.

### `pub fn grafting_graph_core::Node<N>::into_parts(self) -> (grafting_graph_core::NodeId, N)`

Consumes the node and returns its identity and payload.

### `pub fn grafting_graph_core::Node<N>::new(id: grafting_graph_core::NodeId, data: N) -> Self`

Creates a node from a Grafting identity and payload.

### `pub fn grafting_graph_core::NodeId::as_ref(&self) -> &str`

### `pub fn grafting_graph_core::NodeId::as_str(&self) -> &str`

Returns the stable identifier text.

### `pub fn grafting_graph_core::NodeId::new(value: impl core::convert::Into<alloc::string::String>) -> core::result::Result<Self, grafting_graph_core::IdentifierError>`

Creates a non-empty identifier without applying product-specific
normalization rules.

### `pub grafting_graph_core::GraphError::CycleDetected`

Topological ordering cannot consume every node because a cycle exists.

### `pub grafting_graph_core::GraphError::CycleDetected::remaining: alloc::vec::Vec<grafting_graph_core::NodeId>`

Deterministically sorted nodes left blocked by one or more cycles.

### `pub grafting_graph_core::GraphError::DuplicateEdge`

Two input edges use the same stable identity.

### `pub grafting_graph_core::GraphError::DuplicateEdge::id: grafting_graph_core::EdgeId`

Identity that appeared more than once.

### `pub grafting_graph_core::GraphError::DuplicateNode`

Two input nodes use the same stable identity.

### `pub grafting_graph_core::GraphError::DuplicateNode::id: grafting_graph_core::NodeId`

Identity that appeared more than once.

### `pub grafting_graph_core::GraphError::MissingSource`

An edge refers to a source node that is not present.

### `pub grafting_graph_core::GraphError::MissingSource::edge: grafting_graph_core::EdgeId`

Edge containing the invalid endpoint.

### `pub grafting_graph_core::GraphError::MissingSource::source: grafting_graph_core::NodeId`

Source identity that could not be resolved.

### `pub grafting_graph_core::GraphError::MissingTarget`

An edge refers to a target node that is not present.

### `pub grafting_graph_core::GraphError::MissingTarget::edge: grafting_graph_core::EdgeId`

Edge containing the invalid endpoint.

### `pub grafting_graph_core::GraphError::MissingTarget::target: grafting_graph_core::NodeId`

Target identity that could not be resolved.

### `pub grafting_graph_core::GraphError::UnknownNode`

A query refers to a node that is not present.

### `pub grafting_graph_core::GraphError::UnknownNode::id: grafting_graph_core::NodeId`

Identity that could not be resolved.

### `pub grafting_graph_core::IdentifierError::EmptyEdgeId`

An edge identifier must contain at least one character.

### `pub grafting_graph_core::IdentifierError::EmptyNodeId`

A node identifier must contain at least one character.

### `pub grafting_graph_core::LayoutError::DimensionsOverflow`

Requested dimensions exceeded the coordinate representation.

### `pub grafting_graph_core::LayoutError::InvalidOption`

A required dimension or column count was zero.

### `pub grafting_graph_core::LayoutError::InvalidOption::name: &'static str`

Stable option name suitable for an adapter error message.

### `pub grafting_graph_core::LayoutError::MultipleGroups`

One node was assigned to two different groups.

### `pub grafting_graph_core::LayoutError::MultipleGroups::first: grafting_graph_core::NodeId`

First group encountered in deterministic edge order.

### `pub grafting_graph_core::LayoutError::MultipleGroups::node: grafting_graph_core::NodeId`

Node with conflicting group ownership.

### `pub grafting_graph_core::LayoutError::MultipleGroups::second: grafting_graph_core::NodeId`

Conflicting second group.

### `pub grafting_graph_core::LayoutError::NestedGroup`

One grouping source is itself a member of another group.

### `pub grafting_graph_core::LayoutError::NestedGroup::node: grafting_graph_core::NodeId`

Group node that would require recursive layout semantics.

### `pub grafting_graph_core::LayoutError::UnknownGroupingEdge`

A grouping edge identity was not present in the graph.

### `pub grafting_graph_core::LayoutError::UnknownGroupingEdge::id: grafting_graph_core::EdgeId`

Missing grouping edge identity.

### `pub mod grafting_graph_core`

Generic graph structures and deterministic algorithms owned by Grafting.

The public contract deliberately exposes only Grafting types. [`Graph`]
currently uses `petgraph` privately, but consumers cannot depend on that
implementation detail. Presentation data remains in callers; calculation
inputs belong in node or edge payloads and cross explicit contracts.

### `pub struct grafting_graph_core::Edge<E>`

A directed graph edge with stable identity and caller-chosen payload.

### `pub struct grafting_graph_core::EdgeId(_)`

Stable Grafting edge identity.

### `pub struct grafting_graph_core::Graph<N, E>`

Generic directed multigraph with private storage and deterministic queries.

### `pub struct grafting_graph_core::GraphSnapshot<N, E>`

Immutable, deterministically ordered graph data safe to pass to adapters.

### `pub struct grafting_graph_core::GroupedGridOptions`

Caller-controlled dimensions for the deterministic grouped-grid heuristic.

### `pub struct grafting_graph_core::LayoutPosition`

Position assigned to one stable node by a graph layout snapshot.

### `pub struct grafting_graph_core::LayoutSnapshot`

Immutable deterministic output from a grouped-grid layout operation.

### `pub struct grafting_graph_core::Node<N>`

A graph node with a stable identity and caller-chosen calculation payload.

### `pub struct grafting_graph_core::NodeId(_)`

Stable Grafting node identity.
