# grafting-graph-core

### `#[repr(u8)] pub enum grafting_graph_core::GraphPrimitive`

Generic domain-agnostic primitive role for graph formation.

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

### `pub fn grafting_graph_core::Graph<N, E>::add_edge(&mut self, edge: grafting_graph_core::Edge<E>) -> core::result::Result<(), grafting_graph_core::GraphError>`

Inserts a new edge. Errors if its identity is already used or an
endpoint is not a node already present in the graph.

### `pub fn grafting_graph_core::Graph<N, E>::add_node(&mut self, node: grafting_graph_core::Node<N>) -> core::result::Result<(), grafting_graph_core::GraphError>`

Inserts a new node. Errors if its identity is already used.

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

### `pub fn grafting_graph_core::Graph<N, E>::node_mut(&mut self, id: &grafting_graph_core::NodeId) -> core::option::Option<&mut grafting_graph_core::Node<N>>`

Mutable access to a node's payload by stable identity.

### `pub fn grafting_graph_core::Graph<N, E>::predecessors(&self, id: &grafting_graph_core::NodeId) -> core::result::Result<alloc::vec::Vec<grafting_graph_core::NodeId>, grafting_graph_core::GraphError>`

Returns unique predecessor IDs in deterministic identity order.

### `pub fn grafting_graph_core::Graph<N, E>::remove_edge(&mut self, id: &grafting_graph_core::EdgeId) -> core::result::Result<grafting_graph_core::Edge<E>, grafting_graph_core::GraphError>`

Removes an edge by its stable identity, returning its payload.

### `pub fn grafting_graph_core::Graph<N, E>::remove_node(&mut self, id: &grafting_graph_core::NodeId) -> core::result::Result<grafting_graph_core::Node<N>, grafting_graph_core::GraphError>`

Removes a node and every edge incident to it, returning the node's
payload. Callers needing the deletion-repair cycle rule
(`ADR-0022`) implement it on top of this and [`successors`]/
[`predecessors`], called *before* removal, to know which nodes were
the deleted node's neighbors.

[`successors`]: Self::successors
[`predecessors`]: Self::predecessors

### `pub fn grafting_graph_core::Graph<N, E>::snapshot(&self) -> grafting_graph_core::GraphSnapshot<N, E> where N: core::clone::Clone, E: core::clone::Clone`

Clones an immutable snapshot sorted by stable identities.

Sorts explicitly rather than relying on iteration order: the
identity maps are a `HashMap` (unordered), not a `BTreeMap`, so
`GraphSnapshot`'s "sorted by stable identity" contract has to be
established here, not inherited for free from storage.

### `pub fn grafting_graph_core::Graph<N, E>::successors(&self, id: &grafting_graph_core::NodeId) -> core::result::Result<alloc::vec::Vec<grafting_graph_core::NodeId>, grafting_graph_core::GraphError>`

Returns unique successor IDs in deterministic identity order.

### `pub fn grafting_graph_core::Graph<N, E>::topological_order(&self) -> core::result::Result<alloc::vec::Vec<grafting_graph_core::NodeId>, grafting_graph_core::GraphError>`

Returns a deterministic topological order or the nodes left blocked by a cycle.

### `pub fn grafting_graph_core::Graph<N, E>::try_from_parts(nodes: alloc::vec::Vec<grafting_graph_core::Node<N>>, edges: alloc::vec::Vec<grafting_graph_core::Edge<E>>) -> core::result::Result<Self, grafting_graph_core::GraphError>`

Validates identities and endpoints, then constructs the graph.

### `pub fn grafting_graph_core::GraphOps::edge(&self, id: &grafting_graph_core::EdgeId) -> core::option::Option<&grafting_graph_core::Edge<E>>`

Looks up an edge by its stable identity.

### `pub fn grafting_graph_core::GraphOps::node(&self, id: &grafting_graph_core::NodeId) -> core::option::Option<&grafting_graph_core::Node<N>>`

Looks up a node by its stable identity.

### `pub fn grafting_graph_core::GraphOps::predecessors(&self, id: &grafting_graph_core::NodeId) -> core::result::Result<alloc::vec::Vec<grafting_graph_core::NodeId>, grafting_graph_core::GraphError>`

Returns unique predecessor IDs in deterministic identity order.

### `pub fn grafting_graph_core::GraphOps::successors(&self, id: &grafting_graph_core::NodeId) -> core::result::Result<alloc::vec::Vec<grafting_graph_core::NodeId>, grafting_graph_core::GraphError>`

Returns unique successor IDs in deterministic identity order.

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

### `pub fn grafting_graph_core::Node<N>::data_mut(&mut self) -> &mut N`

Returns mutable access to the caller-owned payload -- identity and
graph membership are unaffected, only the payload changes.

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

### `pub fn grafting_graph_core::PrismGridMesh::cell_count(&self) -> usize`

Total number of cells in the mesh.

### `pub fn grafting_graph_core::PrismGridMesh::new(width: u32, height: u32, layers: u32, inputs: grafting_graph_core::FormationInputs) -> Self`

Constructs a grid of width x height x layers cells with 6-slot connectivity.

### `pub grafting_graph_core::FormationInputs::deformation_xy: f32`

Planar XY alignment deformation factor (0.0 = regular quad lattice, 1.0 = organic quad mesh).

### `pub grafting_graph_core::FormationInputs::deformation_z: f32`

Vertical Z height variation factor (0.0 = flat plane, 1.0 = chaotic terrain desnivel).

### `pub grafting_graph_core::FormationInputs::primitive: grafting_graph_core::GraphPrimitive`

The primitive topological role.

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

### `pub grafting_graph_core::GraphError::UnknownEdge`

A query refers to an edge that is not present.

### `pub grafting_graph_core::GraphError::UnknownEdge::id: grafting_graph_core::EdgeId`

Identity that could not be resolved.

### `pub grafting_graph_core::GraphError::UnknownNode`

A query refers to a node that is not present.

### `pub grafting_graph_core::GraphError::UnknownNode::id: grafting_graph_core::NodeId`

Identity that could not be resolved.

### `pub grafting_graph_core::GraphPrimitive::Boundary = 1`

Vertical separating structure / boundary.

### `pub grafting_graph_core::GraphPrimitive::Passage = 0`

Open passage / empty cell space.

### `pub grafting_graph_core::GraphPrimitive::Surface = 2`

Horizontal ground or surface support.

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

### `pub grafting_graph_core::PrismGridMesh::cell_corners: alloc::vec::Vec<[u32; 8]>`

8 corner vertex indices per cell [V0..V7].

### `pub grafting_graph_core::PrismGridMesh::cell_neighbors: alloc::vec::Vec<u32>`

Contiguous list of 6 neighbor cell IDs per cell [North, East, South, West, Bottom, Top].
u32::MAX indicates a boundary edge (no neighbor).

### `pub grafting_graph_core::PrismGridMesh::height: u32`

Height of the grid in cells.

### `pub grafting_graph_core::PrismGridMesh::inputs: alloc::vec::Vec<grafting_graph_core::FormationInputs>`

Formation inputs per cell.

### `pub grafting_graph_core::PrismGridMesh::layers: u32`

Number of vertical layers in the grid.

### `pub grafting_graph_core::PrismGridMesh::positions: alloc::vec::Vec<[f32; 3]>`

Flat list of 3D vertex positions [x, y, z] for corners across all layers.

### `pub grafting_graph_core::PrismGridMesh::width: u32`

Width of the grid in cells.

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

### `pub struct grafting_graph_core::FormationInputs`

Generic formation inputs for mesh deformation and top-down layout.

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

### `pub struct grafting_graph_core::PrismGridMesh`

A 3D prism grid mesh representing cells with 6 contiguous neighbor slots
(4 lateral, 1 bottom, 1 top), positions, and deformation inputs.

### `pub trait grafting_graph_core::GraphOps<N, E>`

Minimal read/traversal capability graph algorithms need, independent of
which concrete storage backend implements it.

Deliberately narrow: "given a node, its neighbors," per this crate's own
scoping (`docs/architecture/vtt-roadmap.md` E1.2) -- not a general graph
interface. [`Graph::topological_order`] and [`Graph::snapshot`] stay
inherent-only, since a construction-focused backend was explicitly
scoped to not need them. Mutation (`add_node`/`remove_node`/`add_edge`/
`remove_edge`/`node_mut`) stays inherent-only too, deliberately: there is
still exactly one backend, so splitting it into its own trait has no
second implementor to justify it yet -- add that split when (not before)
a second backend actually needs it.

Exists so a future storage backend (e.g. a deterministic backend, if
multiplayer replay becomes a real requirement) is an additional
implementation of this trait, not a rewrite of every algorithm already
written against it.
