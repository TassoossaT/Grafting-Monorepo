# grafting-graph-core

### `#[repr(u8)] pub enum grafting_graph_core::GraphPrimitive`

Generic domain-agnostic primitive role for graph formation.

### `pub enum grafting_graph_core::ArcBulge`

Which side of the chord (walking from an arc's own start to its end) it
bulges toward -- see [`SurfaceCurvature`]'s own doc for what this
disambiguates and why it is the one piece of information a center point
alone can never supply.

### `pub enum grafting_graph_core::ConstructionError`

Structural error from a domain-level construction operation -- either
the graph mutation or the surface bookkeeping it coordinates can fail.

### `pub enum grafting_graph_core::ContourError`

Structural error from contour edge or region registration.

### `pub enum grafting_graph_core::ContourGeometry`

An edge's explicit geometry between its two declared nodes.

Deliberately closed to exactly these two kinds for now (line and true
circular arc) -- Bezier and other curve families are a future extension,
not implemented here; see this module's own doc for scope.

### `pub enum grafting_graph_core::ContourIdentifierError`

Failure to construct a stable contour identifier.

### `pub enum grafting_graph_core::GraphError`

Structural or algorithm error returned through the Grafting graph contract.

### `pub enum grafting_graph_core::IdentifierError`

Failure to construct a stable graph identifier.

### `pub enum grafting_graph_core::LayoutError`

Invalid input or arithmetic failure from the grouped-grid heuristic.

### `pub enum grafting_graph_core::PlanIdentityKind`

The identity category whose states overlap in an invalid plan.

### `pub enum grafting_graph_core::RegionEditError`

Structural failure of an atomic region edit.

### `pub enum grafting_graph_core::SurfaceError`

Structural error from surface registration or lookup.

### `pub enum grafting_graph_core::TransformationPlanFailure`

A planning failure. No variant applies a mutation or represents a partial
result: callers must leave the confirmed graph and surface registry intact.

### `pub fn grafting_graph_core::ConstructionError::from(error: grafting_graph_core::GraphError) -> Self`

### `pub fn grafting_graph_core::ConstructionError::from(error: grafting_graph_core::SurfaceError) -> Self`

### `pub fn grafting_graph_core::ContourEdge::bounds(&self, from: grafting_graph_core::ContourPoint, to: grafting_graph_core::ContourPoint) -> grafting_graph_core::ContourBounds`

Axis-aligned bounding box between `from` and `to`.

### `pub fn grafting_graph_core::ContourEdge::closest_point(&self, from: grafting_graph_core::ContourPoint, to: grafting_graph_core::ContourPoint, point: grafting_graph_core::ContourPoint) -> (f32, grafting_graph_core::ContourPoint)`

The parameter `t` and position on this edge closest to `point`.

### `pub fn grafting_graph_core::ContourEdge::end_node(&self) -> &grafting_graph_core::NodeId`

The node this edge ends at, in its own declared direction.

### `pub fn grafting_graph_core::ContourEdge::evaluate(&self, from: grafting_graph_core::ContourPoint, to: grafting_graph_core::ContourPoint, t: f32) -> grafting_graph_core::ContourPoint`

Position at parameter `t` in `0.0..=1.0`, walking from `from` to `to`
(the caller's resolved positions for this edge's two endpoints, in
the direction being evaluated).

### `pub fn grafting_graph_core::ContourEdge::geometry(&self) -> &grafting_graph_core::ContourGeometry`

This edge's geometry.

### `pub fn grafting_graph_core::ContourEdge::id(&self) -> &grafting_graph_core::ContourEdgeId`

This edge's stable identity.

### `pub fn grafting_graph_core::ContourEdge::intersections(&self, from: grafting_graph_core::ContourPoint, to: grafting_graph_core::ContourPoint, other: &grafting_graph_core::ContourEdge, other_from: grafting_graph_core::ContourPoint, other_to: grafting_graph_core::ContourPoint) -> alloc::vec::Vec<grafting_graph_core::ContourPoint>`

Analytic intersection points between this edge and `other`, given
both edges' resolved endpoint positions. Supports line-line,
line-arc, and arc-arc pairs; returns points that lie within both
edges' actual spans, not their full underlying line/circle.

### `pub fn grafting_graph_core::ContourEdge::length(&self, from: grafting_graph_core::ContourPoint, to: grafting_graph_core::ContourPoint) -> f32`

Arc length (or straight length) between `from` and `to`.

### `pub fn grafting_graph_core::ContourEdge::new(id: grafting_graph_core::ContourEdgeId, start_node: grafting_graph_core::NodeId, end_node: grafting_graph_core::NodeId, geometry: grafting_graph_core::ContourGeometry) -> Self`

Creates a contour edge between two nodes with explicit geometry.

### `pub fn grafting_graph_core::ContourEdge::reversed_geometry(&self) -> grafting_graph_core::ContourGeometry`

This edge's geometry as seen when traversed in the opposite
direction (end to start) -- the same physical curve, re-parameterized.
Never mutates the edge; a loop that needs to walk this edge backward
uses this alongside swapped endpoint positions.

### `pub fn grafting_graph_core::ContourEdge::split(&self, new_node: grafting_graph_core::NodeId, first_id: grafting_graph_core::ContourEdgeId, second_id: grafting_graph_core::ContourEdgeId) -> (grafting_graph_core::ContourEdge, grafting_graph_core::ContourEdge)`

Splits this edge at `at` (assumed to lie on the curve) into two edges
sharing a new node, preserving this edge's geometry description on
both fragments -- a line stays a line, an arc keeps the same center
and sweep direction (only its span shrinks).

### `pub fn grafting_graph_core::ContourEdge::start_node(&self) -> &grafting_graph_core::NodeId`

The node this edge starts from, in its own declared direction.

### `pub fn grafting_graph_core::ContourEdge::tangent(&self, from: grafting_graph_core::ContourPoint, to: grafting_graph_core::ContourPoint, t: f32) -> grafting_graph_core::ContourPoint`

Unit tangent direction at parameter `t`, walking from `from` to `to`.

### `pub fn grafting_graph_core::ContourEdge::tessellate(&self, from: grafting_graph_core::ContourPoint, to: grafting_graph_core::ContourPoint, tolerance: f32) -> alloc::vec::Vec<grafting_graph_core::ContourPoint>`

A polyline approximation of this edge, suitable only for rendering --
the graph's own topology never stores this. `tolerance` bounds the
maximum deviation (in world units) between the true curve and the
returned chord segments.

### `pub fn grafting_graph_core::ContourEdgeId::as_ref(&self) -> &str`

### `pub fn grafting_graph_core::ContourEdgeId::as_str(&self) -> &str`

Returns the identifier text.

### `pub fn grafting_graph_core::ContourEdgeId::new(value: impl core::convert::Into<alloc::string::String>) -> core::result::Result<Self, grafting_graph_core::ContourIdentifierError>`

Creates a non-empty contour edge identifier.

### `pub fn grafting_graph_core::ContourTopology::add_edge<N, E>(&mut self, graph: &grafting_graph_core::Graph<N, E>, edge: grafting_graph_core::ContourEdge) -> core::result::Result<grafting_graph_core::ContourEdgeId, grafting_graph_core::ContourError>`

Registers a new contour edge, validated against `graph`.

### `pub fn grafting_graph_core::ContourTopology::add_region(&mut self, id: grafting_graph_core::RegionId, outer_loops: alloc::vec::Vec<grafting_graph_core::ContourLoop>, holes: alloc::vec::Vec<grafting_graph_core::ContourLoop>) -> core::result::Result<grafting_graph_core::RegionId, grafting_graph_core::ContourError>`

Registers a new region from its outer loops and holes, validating
loop closure and the non-manifold-edge rule against edges already
registered via [`add_edge`](Self::add_edge). Rejects and leaves no
partial state on any failure.

### `pub fn grafting_graph_core::ContourTopology::assemble_loops(&self, edges: &[grafting_graph_core::ContourEdgeId]) -> alloc::vec::Vec<grafting_graph_core::ContourLoop>`

Chains `edges` into closed loops by shared endpoints, orienting each
use so consecutive entries meet end-to-start.

Used to rebuild the rim a removal exposes (see
[`delete_regions`](crate::delete_regions)), where the result must be
stitchable without leaving a hole or inventing a face -- so a chain
that cannot close is **dropped rather than returned half-open**, and
a caller comparing input and output counts can tell that happened.

A node where three or more of `edges` meet (a pinch point) has no
unambiguous continuation; this walk takes the first unused one it
finds, which is deterministic but not necessarily the caller's
intended pairing. Callers that can produce pinch points own
splitting `edges` into unambiguous groups first.

### `pub fn grafting_graph_core::ContourTopology::edge(&self, id: &grafting_graph_core::ContourEdgeId) -> core::option::Option<&grafting_graph_core::ContourEdge>`

Looks up a registered edge by identity.

### `pub fn grafting_graph_core::ContourTopology::edges_incident_to(&self, node: &grafting_graph_core::NodeId) -> alloc::vec::Vec<grafting_graph_core::ContourEdgeId>`

Every registered edge with `node` as one of its two endpoints, in a
caller-stable sorted order. Includes edges no region currently uses --
a caller that only cares about live boundaries filters by
[`regions_using_edge`](Self::regions_using_edge).

### `pub fn grafting_graph_core::ContourTopology::new() -> Self`

Creates an empty topology.

### `pub fn grafting_graph_core::ContourTopology::nodes_in_use(&self) -> alloc::collections::btree::set::BTreeSet<grafting_graph_core::NodeId>`

Every node referenced by an edge at least one still-registered
region actually uses. A node outside this set is safe for a caller
to delete from its own [`Graph`] -- nothing in this topology still
needs it. Deliberately does not include nodes referenced only by a
[`ContourEdge`] with zero usages: [`remove_region`](Self::remove_region)
leaves those registered (a sibling region might reuse the id later
in the same batch of edits) but they hold no region together, so
they cannot keep a node alive either.

### `pub fn grafting_graph_core::ContourTopology::prune_unused_edges(&mut self) -> alloc::vec::Vec<grafting_graph_core::ContourEdgeId>`

Drops every registered edge no region currently uses -- exactly the
garbage [`remove_region`](Self::remove_region) intentionally leaves
behind per its own doc ("another region may still reference them").
A caller that just finished a batch of removals calls this once to
reclaim whatever really did become orphaned, rather than every edge
staying registered forever.

### `pub fn grafting_graph_core::ContourTopology::region(&self, id: &grafting_graph_core::RegionId) -> core::option::Option<&grafting_graph_core::SurfaceRegion>`

Looks up a registered region by identity.

### `pub fn grafting_graph_core::ContourTopology::region_ids(&self) -> alloc::vec::Vec<grafting_graph_core::RegionId>`

Every registered region's identity, in a caller-stable sorted order.

### `pub fn grafting_graph_core::ContourTopology::region_nodes(&self, id: &grafting_graph_core::RegionId) -> core::result::Result<alloc::vec::Vec<grafting_graph_core::NodeId>, grafting_graph_core::ContourError>`

Every node on a region's own boundary (outer loops plus holes), in
first-encountered loop order -- the ordering guarantee the front end's
index-to-role mapping relies on (see
`docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`).

### `pub fn grafting_graph_core::ContourTopology::regions_touching_node(&self, node: &grafting_graph_core::NodeId) -> alloc::vec::Vec<grafting_graph_core::RegionId>`

Every region whose boundary touches `node`, in a caller-stable sorted
order -- exactly the regions whose mesh a caller must re-derive after
moving that node.

### `pub fn grafting_graph_core::ContourTopology::regions_using_edge(&self, edge: &grafting_graph_core::ContourEdgeId) -> alloc::vec::Vec<grafting_graph_core::RegionId>`

Every region currently using `edge`, in a caller-stable sorted order.
At most two, by the non-manifold rule -- see [`ContourError::NonManifoldEdge`].

### `pub fn grafting_graph_core::ContourTopology::remove_edge(&mut self, id: &grafting_graph_core::ContourEdgeId) -> core::result::Result<grafting_graph_core::ContourEdge, grafting_graph_core::ContourError>`

Drops one registered edge outright. Rejected while any region still
uses it -- a caller removing real boundary calls
[`replace_edge_uses`](Self::replace_edge_uses) or
[`remove_region`](Self::remove_region) first.

### `pub fn grafting_graph_core::ContourTopology::remove_region(&mut self, id: &grafting_graph_core::RegionId) -> core::result::Result<grafting_graph_core::SurfaceRegion, grafting_graph_core::ContourError>`

Removes a region, releasing its edge usages. Edges themselves stay
registered (another region may still reference them).

### `pub fn grafting_graph_core::ContourTopology::replace_edge_uses(&mut self, id: &grafting_graph_core::ContourEdgeId, replacement: &[grafting_graph_core::OrientedEdgeUse]) -> core::result::Result<alloc::vec::Vec<grafting_graph_core::RegionId>, grafting_graph_core::ContourError>`

Substitutes every use of `id`, across every registered region, with
`replacement` walked in that use's own direction -- a forward use is
replaced by `replacement` as given, a reversed use by `replacement`
reversed with each entry's own direction flipped. This is the single
shared mechanism behind `InsertVertex` (one edge becomes two) and
`RemoveVertex` (two edges become one); neither reimplements loop
surgery on its own.

`id` itself is left registered but unused, for
[`prune_unused_edges`](Self::prune_unused_edges) to reclaim as part of
the caller's own end-of-transaction cleanup.

### `pub fn grafting_graph_core::ContourTopology::replace_region_loops(&mut self, id: &grafting_graph_core::RegionId, outer_loops: alloc::vec::Vec<grafting_graph_core::ContourLoop>, holes: alloc::vec::Vec<grafting_graph_core::ContourLoop>) -> core::result::Result<(), grafting_graph_core::ContourError>`

Re-registers `id`'s boundary with new loops, revalidating closure and
the non-manifold rule exactly as [`add_region`](Self::add_region)
does. The region keeps its identity; on any failure the original
boundary is restored and nothing is left half-applied.

### `pub fn grafting_graph_core::ContourTopology::set_edge_geometry(&mut self, id: &grafting_graph_core::ContourEdgeId, geometry: grafting_graph_core::ContourGeometry) -> core::result::Result<(), grafting_graph_core::ContourError>`

Replaces one registered edge's geometry in place, leaving its identity
and both endpoints untouched -- the `RetypeEdge` primitive's whole
effect on topology (swap `Line` for `Arc`, or re-aim an arc's center).

### `pub fn grafting_graph_core::ContourTopology::usage_count(&self, edge: &grafting_graph_core::ContourEdgeId) -> usize`

How many registered regions currently walk `edge`. At most two, by
the non-manifold rule. **One is the number that matters:** an edge
used exactly once is a free boundary -- nothing sits on its other
side -- which is what makes it part of the rim left behind when
neighbouring regions are removed.

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

### `pub fn grafting_graph_core::Graph<N, E>::clone(&self) -> grafting_graph_core::Graph<N, E>`

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

### `pub fn grafting_graph_core::IdentityDelta<I>::clone(&self) -> grafting_graph_core::IdentityDelta<I>`

### `pub fn grafting_graph_core::IdentityDelta<I>::created(&self) -> &alloc::collections::btree::set::BTreeSet<I>`

Identities newly introduced by the plan.

### `pub fn grafting_graph_core::IdentityDelta<I>::eq(&self, other: &grafting_graph_core::IdentityDelta<I>) -> bool`

### `pub fn grafting_graph_core::IdentityDelta<I>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_graph_core::IdentityDelta<I>::is_empty(&self) -> bool`

Whether this category has no lifecycle changes.

### `pub fn grafting_graph_core::IdentityDelta<I>::new(kind: grafting_graph_core::PlanIdentityKind, created: alloc::collections::btree::set::BTreeSet<I>, preserved: alloc::collections::btree::set::BTreeSet<I>, replaced: alloc::collections::btree::set::BTreeSet<I>, removed: alloc::collections::btree::set::BTreeSet<I>) -> core::result::Result<Self, grafting_graph_core::TransformationPlanFailure>`

Validates mutually exclusive identity lifecycle states.

### `pub fn grafting_graph_core::IdentityDelta<I>::preserved(&self) -> &alloc::collections::btree::set::BTreeSet<I>`

Identities retained because they still connect unaffected geometry.

### `pub fn grafting_graph_core::IdentityDelta<I>::removed(&self) -> &alloc::collections::btree::set::BTreeSet<I>`

Identities removed by the plan.

### `pub fn grafting_graph_core::IdentityDelta<I>::replaced(&self) -> &alloc::collections::btree::set::BTreeSet<I>`

Identities superseded inside the remodeled region.

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

### `pub fn grafting_graph_core::LocalInvalidationScope::changed_surfaces(&self) -> &alloc::collections::btree::set::BTreeSet<grafting_graph_core::SurfaceKey>`

Surfaces directly changed by the plan.

### `pub fn grafting_graph_core::LocalInvalidationScope::direct_dependencies(&self) -> &alloc::collections::btree::set::BTreeSet<grafting_graph_core::SurfaceKey>`

Direct transformer dependencies, excluding unrelated clouds.

### `pub fn grafting_graph_core::LocalInvalidationScope::is_empty(&self) -> bool`

Whether the plan identifies no local refresh work.

### `pub fn grafting_graph_core::LocalInvalidationScope::new(changed_surfaces: alloc::collections::btree::set::BTreeSet<grafting_graph_core::SurfaceKey>, topology_repair_neighbors: alloc::collections::btree::set::BTreeSet<grafting_graph_core::SurfaceKey>, direct_dependencies: alloc::collections::btree::set::BTreeSet<grafting_graph_core::SurfaceKey>) -> Self`

Creates a local invalidation scope without scanning unrelated clouds.

### `pub fn grafting_graph_core::LocalInvalidationScope::topology_repair_neighbors(&self) -> &alloc::collections::btree::set::BTreeSet<grafting_graph_core::SurfaceKey>`

Adjacent surfaces inspected for topology repair or fragment cleanup.

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

### `pub fn grafting_graph_core::OrientedEdgeUse::edge(&self) -> &grafting_graph_core::ContourEdgeId`

The referenced edge's identity.

### `pub fn grafting_graph_core::OrientedEdgeUse::forward(edge: grafting_graph_core::ContourEdgeId) -> Self`

References `edge`, walked in its own declared direction.

### `pub fn grafting_graph_core::OrientedEdgeUse::is_reversed(&self) -> bool`

Whether this use walks the edge backward relative to its own
declared direction.

### `pub fn grafting_graph_core::OrientedEdgeUse::reversed(edge: grafting_graph_core::ContourEdgeId) -> Self`

References `edge`, walked from its declared end to its declared start.

### `pub fn grafting_graph_core::PrismGridMesh::cell_count(&self) -> usize`

Total number of cells in the mesh.

### `pub fn grafting_graph_core::PrismGridMesh::new(width: u32, height: u32, layers: u32, inputs: grafting_graph_core::FormationInputs) -> Self`

Constructs a grid of width x height x layers cells with 6-slot connectivity.

### `pub fn grafting_graph_core::RegionEditError::from(error: grafting_graph_core::ContourError) -> Self`

### `pub fn grafting_graph_core::RegionEditError::from(error: grafting_graph_core::GraphError) -> Self`

### `pub fn grafting_graph_core::RegionEditError::from(error: grafting_graph_core::SurfaceError) -> Self`

### `pub fn grafting_graph_core::RegionEditOutcome::merge(&mut self, other: grafting_graph_core::RegionEditOutcome)`

Folds `other` into this outcome -- what a caller applying a policy's
primary operation plus its cascade uses to report one combined result.

### `pub fn grafting_graph_core::RegionId::as_ref(&self) -> &str`

### `pub fn grafting_graph_core::RegionId::as_str(&self) -> &str`

Returns the identifier text.

### `pub fn grafting_graph_core::RegionId::new(value: impl core::convert::Into<alloc::string::String>) -> core::result::Result<Self, grafting_graph_core::ContourIdentifierError>`

Creates a non-empty region identifier.

### `pub fn grafting_graph_core::RegionSurface::physical(&self) -> bool`

Whether this region currently blocks movement or acts as ground.

### `pub fn grafting_graph_core::RegionSurface::region_id(&self) -> &grafting_graph_core::RegionId`

The stable analytic-region identity this surface decorates.

### `pub fn grafting_graph_core::RegionSurface::surface_type(&self) -> &grafting_graph_core::SurfaceType`

This region surface's open, extensible type identifier.

### `pub fn grafting_graph_core::Surface::curvature(&self) -> core::option::Option<grafting_graph_core::SurfaceCurvature>`

This surface's own curvature, if any -- see [`SurfaceCurvature`]'s
own doc.

### `pub fn grafting_graph_core::Surface::cycle(&self) -> &[grafting_graph_core::NodeId]`

Nodes forming this surface's cycle, in mesh-derivation order.

### `pub fn grafting_graph_core::Surface::physical(&self) -> bool`

Whether this surface currently blocks movement or acts as ground --
nothing about vision or rendering, that belongs to the asset layer
(`ADR-0022`).

### `pub fn grafting_graph_core::Surface::surface_type(&self) -> &grafting_graph_core::SurfaceType`

This surface's open, extensible type identifier.

### `pub fn grafting_graph_core::SurfaceKey::from_cycle(cycle: &[grafting_graph_core::NodeId]) -> Self`

Derives the order-independent identity of a node cycle.

### `pub fn grafting_graph_core::SurfaceKey::nodes(&self) -> &alloc::collections::btree::set::BTreeSet<grafting_graph_core::NodeId>`

Returns the node set this identity is derived from.

### `pub fn grafting_graph_core::SurfaceRegion::holes(&self) -> &[grafting_graph_core::ContourLoop]`

This region's holes.

### `pub fn grafting_graph_core::SurfaceRegion::id(&self) -> &grafting_graph_core::RegionId`

This region's stable identity.

### `pub fn grafting_graph_core::SurfaceRegion::outer_loops(&self) -> &[grafting_graph_core::ContourLoop]`

This region's outer boundary loops.

### `pub fn grafting_graph_core::SurfaceRegistry::add_region_surface(&mut self, topology: &grafting_graph_core::ContourTopology, region_id: grafting_graph_core::RegionId, surface_type: grafting_graph_core::SurfaceType, physical: bool) -> core::result::Result<grafting_graph_core::RegionId, grafting_graph_core::SurfaceError>`

Registers semantic attributes for an already-validated analytic
contour region. [`ContourTopology`] owns edges, loops, and manifold
validation; this registry owns the construction meaning of that region.

### `pub fn grafting_graph_core::SurfaceRegistry::add_surface<N, E>(&mut self, graph: &grafting_graph_core::Graph<N, E>, cycle: alloc::vec::Vec<grafting_graph_core::NodeId>, surface_type: grafting_graph_core::SurfaceType, physical: bool) -> core::result::Result<grafting_graph_core::SurfaceKey, grafting_graph_core::SurfaceError>`

Registers a new surface from a node cycle, validated against
`graph`. Errors if the cycle is empty, references a node the graph
does not have, or duplicates an already-registered node-set
identity.

### `pub fn grafting_graph_core::SurfaceRegistry::new() -> Self`

Creates an empty registry.

### `pub fn grafting_graph_core::SurfaceRegistry::region_surface(&self, region_id: &grafting_graph_core::RegionId) -> core::option::Option<&grafting_graph_core::RegionSurface>`

Looks up semantic attributes for an analytic region.

### `pub fn grafting_graph_core::SurfaceRegistry::region_surface_ids(&self) -> alloc::vec::Vec<grafting_graph_core::RegionId>`

Registered analytic-region surface identities in deterministic order.

### `pub fn grafting_graph_core::SurfaceRegistry::remove_region_surface(&mut self, region_id: &grafting_graph_core::RegionId) -> core::result::Result<grafting_graph_core::RegionSurface, grafting_graph_core::SurfaceError>`

Removes semantic attributes for one analytic region. The caller owns
the matching [`ContourTopology::remove_region`](crate::ContourTopology::remove_region)
operation, so shared contour edges remain available to adjacent regions.

### `pub fn grafting_graph_core::SurfaceRegistry::remove_surface(&mut self, key: &grafting_graph_core::SurfaceKey) -> core::result::Result<grafting_graph_core::Surface, grafting_graph_core::SurfaceError>`

Removes a surface by its node-set identity, returning it.

### `pub fn grafting_graph_core::SurfaceRegistry::set_curvature(&mut self, key: &grafting_graph_core::SurfaceKey, curvature: core::option::Option<grafting_graph_core::SurfaceCurvature>) -> core::result::Result<(), grafting_graph_core::SurfaceError>`

Updates a surface's curvature (see [`SurfaceCurvature`]'s own doc).
Touches no node and no cycle, for the same reason as
[`set_type`](Self::set_type) -- a curved wall's own graph topology
never encodes its curve, only this attribute does.

### `pub fn grafting_graph_core::SurfaceRegistry::set_physical(&mut self, key: &grafting_graph_core::SurfaceKey, physical: bool) -> core::result::Result<(), grafting_graph_core::SurfaceError>`

Updates a surface's `physical` flag. Touches no node and no cycle,
for the same reason as [`set_type`](Self::set_type).

### `pub fn grafting_graph_core::SurfaceRegistry::set_region_physical(&mut self, region_id: &grafting_graph_core::RegionId, physical: bool) -> core::result::Result<(), grafting_graph_core::SurfaceError>`

Updates an analytic region surface's physical flag.

### `pub fn grafting_graph_core::SurfaceRegistry::set_region_type(&mut self, region_id: &grafting_graph_core::RegionId, surface_type: grafting_graph_core::SurfaceType) -> core::result::Result<(), grafting_graph_core::SurfaceError>`

Updates an analytic region surface's type.

### `pub fn grafting_graph_core::SurfaceRegistry::set_type(&mut self, key: &grafting_graph_core::SurfaceKey, surface_type: grafting_graph_core::SurfaceType) -> core::result::Result<(), grafting_graph_core::SurfaceError>`

Updates a surface's type. Touches no node and no cycle -- per
`ADR-0022`, `type` is not derived from node positions, so this never
requires a mesh recompute.

### `pub fn grafting_graph_core::SurfaceRegistry::surface(&self, key: &grafting_graph_core::SurfaceKey) -> core::option::Option<&grafting_graph_core::Surface>`

Looks up a surface by its node-set identity.

### `pub fn grafting_graph_core::SurfaceRegistry::surface_keys(&self) -> alloc::vec::Vec<grafting_graph_core::SurfaceKey>`

Registered surface identities in deterministic identity order.

The registry's internal storage is intentionally unordered. Callers
that need to examine a local domain snapshot therefore start from this
ordered list and resolve each record through [`surface`](Self::surface).

### `pub fn grafting_graph_core::SurfaceRegistry::surfaces_referencing(&self, node: &grafting_graph_core::NodeId) -> impl core::iter::traits::iterator::Iterator<Item = &grafting_graph_core::SurfaceKey>`

Every surface referencing `node`, in deterministic identity order --
the instant lookup `ADR-0022`'s `Move` operation needs to know which
surfaces to recompute, without a full scan.

### `pub fn grafting_graph_core::SurfaceReplacementPlan<N, E>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_graph_core::SurfaceType::as_ref(&self) -> &str`

### `pub fn grafting_graph_core::SurfaceType::as_str(&self) -> &str`

Returns the identifier text.

### `pub fn grafting_graph_core::SurfaceType::new(value: impl core::convert::Into<alloc::string::String>) -> Self`

Creates a surface-type identifier from caller-chosen text.

### `pub fn grafting_graph_core::TransformationPlan::edge_ids(&self) -> &grafting_graph_core::IdentityDelta<grafting_graph_core::EdgeId>`

Edge lifecycle changes.

### `pub fn grafting_graph_core::TransformationPlan::invalidation(&self) -> &grafting_graph_core::LocalInvalidationScope`

Local derived-state refresh scope.

### `pub fn grafting_graph_core::TransformationPlan::new(node_ids: grafting_graph_core::IdentityDelta<grafting_graph_core::NodeId>, edge_ids: grafting_graph_core::IdentityDelta<grafting_graph_core::EdgeId>, surface_ids: grafting_graph_core::IdentityDelta<grafting_graph_core::SurfaceKey>, invalidation: grafting_graph_core::LocalInvalidationScope) -> core::result::Result<Self, grafting_graph_core::TransformationPlanFailure>`

Creates a plan only when it has structural changes and a local refresh scope.

### `pub fn grafting_graph_core::TransformationPlan::node_ids(&self) -> &grafting_graph_core::IdentityDelta<grafting_graph_core::NodeId>`

Node lifecycle changes.

### `pub fn grafting_graph_core::TransformationPlan::surface_ids(&self) -> &grafting_graph_core::IdentityDelta<grafting_graph_core::SurfaceKey>`

Surface lifecycle changes.

### `pub fn grafting_graph_core::add_hole(topology: &mut grafting_graph_core::ContourTopology, region: &grafting_graph_core::RegionId, hole: grafting_graph_core::ContourLoop) -> core::result::Result<grafting_graph_core::RegionEditOutcome, grafting_graph_core::RegionEditError>`

`AddHole`: registers one more inner loop on an existing region -- what a
door or a window is. A hole is not a marker: it is a real loop of
registered [`ContourEdge`]s with real graph nodes, validated by the same
closure and manifold rules as any outer loop, and consumed directly by
triangulation.

### `pub fn grafting_graph_core::apply_surface_replacement_plan<N: core::clone::Clone, E: core::clone::Clone>(graph: &mut grafting_graph_core::Graph<N, E>, surfaces: &mut grafting_graph_core::SurfaceRegistry, plan: grafting_graph_core::SurfaceReplacementPlan<N, E>) -> core::result::Result<grafting_graph_core::TransformationPlan, grafting_graph_core::ConstructionError>`

Applies a complete local surface replacement atomically.

The generic graph capability owns transactionality; domain transformers own
intersection, formation, and the cycles supplied in the batch. The current
graph and registry are cloned, all mutations are attempted on the clone,
and only a fully valid result replaces the confirmed state. This requires
cloneable caller payloads but avoids exposing the graph backend or making a
bridge reimplement partial-rollback logic.

### `pub fn grafting_graph_core::cut_region(topology: &mut grafting_graph_core::ContourTopology, surfaces: &mut grafting_graph_core::SurfaceRegistry, region: &grafting_graph_core::RegionId, cut_path: &[grafting_graph_core::OrientedEdgeUse], first: grafting_graph_core::RegionId, second: grafting_graph_core::RegionId) -> core::result::Result<grafting_graph_core::RegionEditOutcome, grafting_graph_core::RegionEditError>`

`CutRegion`: divides one region in two along `cut_path`, a chain of
already-registered edges whose two ends both sit on the region's own
outer loop. Both halves keep the cut as their shared boundary -- the
same edges, walked in opposite directions -- which is exactly what makes
them manifold neighbors rather than two unrelated regions that happen to
touch.

Scoped to a region with exactly one outer loop and no holes: with more
than one, there is no unambiguous rule for which side of the cut the
leftover loops belong to, and inventing one here would be a policy
decision this layer does not own.

### `pub fn grafting_graph_core::delete_region<N, E>(graph: &mut grafting_graph_core::Graph<N, E>, topology: &mut grafting_graph_core::ContourTopology, surfaces: &mut grafting_graph_core::SurfaceRegistry, region: &grafting_graph_core::RegionId) -> core::result::Result<grafting_graph_core::RegionEditOutcome, grafting_graph_core::RegionEditError>`

`DeleteRegion` for a single region -- [`delete_regions`] with one entry,
discarding the rim. A caller that intends to stitch anything back should
call [`delete_regions`] instead and keep it.

### `pub fn grafting_graph_core::delete_regions<N, E>(graph: &mut grafting_graph_core::Graph<N, E>, topology: &mut grafting_graph_core::ContourTopology, surfaces: &mut grafting_graph_core::SurfaceRegistry, regions: &[grafting_graph_core::RegionId]) -> core::result::Result<grafting_graph_core::RegionRemoval, grafting_graph_core::RegionEditError>`

`DeleteRegion` over a whole set at once, reporting the rim left behind.

Batching is not an optimization, it is the correctness condition: an
edge shared by two regions that are *both* being removed is interior to
the removal and must not appear in the rim. Deleting one at a time would
expose it in between, and a caller stitching onto it would weld into the
middle of its own hole.

The rim is derived, never guessed: after the removal and the shared
orphan cleanup, it is exactly those of the removed regions' own edges
that still exist and are now used by exactly one region.

### `pub fn grafting_graph_core::duplicate_region<N, E>(graph: &mut grafting_graph_core::Graph<N, E>, topology: &mut grafting_graph_core::ContourTopology, surfaces: &mut grafting_graph_core::SurfaceRegistry, region: &grafting_graph_core::RegionId, spec: grafting_graph_core::DuplicateRegionSpec<'_, N>) -> core::result::Result<grafting_graph_core::RegionEditOutcome, grafting_graph_core::RegionEditError>`

`DuplicateRegion`: mints a parallel copy of a region -- one new node per
boundary node, one new edge per boundary edge, the same loop structure,
and its own registered surface.

### `pub fn grafting_graph_core::insert_vertex<N, E>(graph: &mut grafting_graph_core::Graph<N, E>, topology: &mut grafting_graph_core::ContourTopology, edge: &grafting_graph_core::ContourEdgeId, node: grafting_graph_core::Node<N>, first_fragment: grafting_graph_core::ContourEdgeId, second_fragment: grafting_graph_core::ContourEdgeId) -> core::result::Result<grafting_graph_core::RegionEditOutcome, grafting_graph_core::RegionEditError>`

`InsertVertex`: subdivides one boundary edge, minting a new node on it.
Both fragments keep the original edge's own geometry description (an arc
keeps its center and sweep direction, only its span shrinks), and every
region using the original -- in either direction -- is rewritten to walk
the two fragments instead.

The caller supplies the new node (with the position it wants) and both
fragment identities, so ids stay caller-derived and reproducible. This
is also the whole of the "cut a movable notch out of a straight edge"
case: call it twice on the same original edge, and the middle fragment
is an independently movable segment -- there is no separate `Cut`
primitive.

### `pub fn grafting_graph_core::move_edge<N, E>(graph: &mut grafting_graph_core::Graph<N, E>, topology: &grafting_graph_core::ContourTopology, edge: &grafting_graph_core::ContourEdgeId, update: impl core::ops::function::Fn(&mut N)) -> core::result::Result<grafting_graph_core::RegionEditOutcome, grafting_graph_core::RegionEditError>`

`MoveEdge`: applies `update` to both of an edge's endpoints, moving the
whole segment as one rigid unit ("drag a whole wall panel"). Any other
edge sharing one of those endpoints follows along, exactly as it would
if the node were dragged on its own -- nodes only ever share what they
are each independently connected to.

### `pub fn grafting_graph_core::move_region<N, E>(graph: &mut grafting_graph_core::Graph<N, E>, topology: &grafting_graph_core::ContourTopology, region: &grafting_graph_core::RegionId, update: impl core::ops::function::Fn(&mut N)) -> core::result::Result<grafting_graph_core::RegionEditOutcome, grafting_graph_core::RegionEditError>`

`MoveRegion`: applies `update` to every node on a region's own boundary,
including its holes. Neighboring regions sharing any of those nodes are
reported as affected too -- a shared boundary moves with it by
construction, since both regions reference the very same edges.

### `pub fn grafting_graph_core::move_vertex<N, E>(graph: &mut grafting_graph_core::Graph<N, E>, topology: &grafting_graph_core::ContourTopology, id: &grafting_graph_core::NodeId, update: impl core::ops::function::FnOnce(&mut N)) -> core::result::Result<grafting_graph_core::RegionEditOutcome, grafting_graph_core::RegionEditError>`

`MoveVertex`: applies `update` to one node's payload and reports every
region whose boundary touches it. Topology is untouched, so this can only
fail when the node does not exist.

### `pub fn grafting_graph_core::prune_orphans<N, E>(graph: &mut grafting_graph_core::Graph<N, E>, topology: &mut grafting_graph_core::ContourTopology, surfaces: &grafting_graph_core::SurfaceRegistry, candidates: &[grafting_graph_core::NodeId]) -> core::result::Result<alloc::vec::Vec<grafting_graph_core::NodeId>, grafting_graph_core::RegionEditError>`

The one shared end-of-transaction cleanup every removing primitive runs:
drop every contour edge no region uses anymore, then delete every
candidate node nothing references -- neither a surviving region's
boundary nor a legacy [`crate::Surface`]. Candidates are scoped to the
nodes the caller's own edit could have orphaned, never the whole graph,
so a node staged for an unrelated in-flight operation is never collected.

### `pub fn grafting_graph_core::remove_hole<N, E>(graph: &mut grafting_graph_core::Graph<N, E>, topology: &mut grafting_graph_core::ContourTopology, surfaces: &grafting_graph_core::SurfaceRegistry, region: &grafting_graph_core::RegionId, index: usize) -> core::result::Result<grafting_graph_core::RegionEditOutcome, grafting_graph_core::RegionEditError>`

`RemoveHole`: drops one of a region's inner loops by index, then runs the
shared orphan cleanup over the nodes that loop used.

### `pub fn grafting_graph_core::remove_vertex<N, E>(graph: &mut grafting_graph_core::Graph<N, E>, topology: &mut grafting_graph_core::ContourTopology, surfaces: &grafting_graph_core::SurfaceRegistry, node: &grafting_graph_core::NodeId, welded_edge: grafting_graph_core::ContourEdgeId) -> core::result::Result<grafting_graph_core::RegionEditOutcome, grafting_graph_core::RegionEditError>`

`RemoveVertex`: welds a node's two neighboring boundary edges into one,
the exact inverse of [`insert_vertex`]. Requires exactly two incident
boundary edges describing the same curve; a junction or a geometry
mismatch is rejected rather than silently reshaped.

Runs the shared [`prune_orphans`] cleanup, so the welded-away node and
both replaced edges are gone when this returns.

### `pub fn grafting_graph_core::retype_edge(topology: &mut grafting_graph_core::ContourTopology, edge: &grafting_graph_core::ContourEdgeId, geometry: grafting_graph_core::ContourGeometry) -> core::result::Result<grafting_graph_core::RegionEditOutcome, grafting_graph_core::RegionEditError>`

`RetypeEdge`: swaps one boundary edge's geometry -- `Line` for `Arc`, or
an arc's own center/sweep -- without touching either endpoint.

### `pub fn grafting_graph_core::straight_cycle_region<N, E>(topology: &mut grafting_graph_core::ContourTopology, graph: &grafting_graph_core::Graph<N, E>, id: grafting_graph_core::RegionId, cycle: &[grafting_graph_core::NodeId]) -> core::result::Result<grafting_graph_core::RegionId, grafting_graph_core::ContourError>`

Builds a single-outer-loop, hole-free [`SurfaceRegion`] out of straight
[`ContourGeometry::Line`] edges from an existing node cycle -- the
migration bridge for a straight surface that used to be described only
as [`Surface::cycle`](crate::Surface::cycle). Produces edge ids of the
form `"{region_id}-{index}"`; callers that need stable, caller-chosen
edge ids should build the loop directly instead.

Registers the produced edges and region into `topology`, validated
against `graph` exactly as any other region would be.

### `pub grafting_graph_core::ArcBulge::Left`

Bulges toward the chord's left side, facing from the arc's own start to its end.

### `pub grafting_graph_core::ArcBulge::Right`

Bulges toward the chord's right side, facing from the arc's own start to its end.

### `pub grafting_graph_core::ConstructionError::Graph(grafting_graph_core::GraphError)`

The underlying graph query or mutation failed.

### `pub grafting_graph_core::ConstructionError::Surface(grafting_graph_core::SurfaceError)`

The underlying surface registry mutation failed.

### `pub grafting_graph_core::ContourBounds::max: grafting_graph_core::ContourPoint`

Maximum X and Z.

### `pub grafting_graph_core::ContourBounds::min: grafting_graph_core::ContourPoint`

Minimum X and Z.

### `pub grafting_graph_core::ContourError::DuplicateEdge`

Two edges cannot share the exact same identity.

### `pub grafting_graph_core::ContourError::DuplicateEdge::id: grafting_graph_core::ContourEdgeId`

Identity that already had a registered edge.

### `pub grafting_graph_core::ContourError::DuplicateRegion`

Two regions cannot share the exact same identity.

### `pub grafting_graph_core::ContourError::DuplicateRegion::id: grafting_graph_core::RegionId`

Identity that already had a registered region.

### `pub grafting_graph_core::ContourError::EmptyLoop`

A loop must reference at least one edge.

### `pub grafting_graph_core::ContourError::NoOuterLoop`

A region must declare at least one outer loop.

### `pub grafting_graph_core::ContourError::NonManifoldEdge`

An edge would be used more than twice across all registered regions,
or twice in the same direction -- see this module's own doc: a
shared boundary uses the same edge in opposite directions, at most
once each.

### `pub grafting_graph_core::ContourError::NonManifoldEdge::id: grafting_graph_core::ContourEdgeId`

The edge whose usage would become invalid.

### `pub grafting_graph_core::ContourError::OpenLoop`

A loop is not closed: one edge use's end node does not match the
next use's start node.

### `pub grafting_graph_core::ContourError::OpenLoop::expected: grafting_graph_core::NodeId`

Node the previous edge use ended at.

### `pub grafting_graph_core::ContourError::OpenLoop::found: grafting_graph_core::NodeId`

Node the next edge use actually starts at.

### `pub grafting_graph_core::ContourError::UnknownEdge`

A loop referenced an edge that is not registered.

### `pub grafting_graph_core::ContourError::UnknownEdge::id: grafting_graph_core::ContourEdgeId`

Identity that could not be resolved.

### `pub grafting_graph_core::ContourError::UnknownEdgeIdentity`

A query or update referenced an edge that is not registered.

### `pub grafting_graph_core::ContourError::UnknownEdgeIdentity::id: grafting_graph_core::ContourEdgeId`

Identity that could not be resolved.

### `pub grafting_graph_core::ContourError::UnknownNode`

An edge referenced a node the graph does not have.

### `pub grafting_graph_core::ContourError::UnknownNode::id: grafting_graph_core::NodeId`

Identity that could not be resolved.

### `pub grafting_graph_core::ContourError::UnknownRegion`

A query or update referenced a region that is not registered.

### `pub grafting_graph_core::ContourError::UnknownRegion::id: grafting_graph_core::RegionId`

Identity that could not be resolved.

### `pub grafting_graph_core::ContourGeometry::CircularArc`

A true circular arc between the edge's two endpoints, in the XZ
plane. `center` plus either endpoint determines the radius; whether
the arc sweeps clockwise or counter-clockwise from the edge's own
start to its own end is the one bit no arrangement of points alone
can supply.

### `pub grafting_graph_core::ContourGeometry::CircularArc::center: grafting_graph_core::ContourPoint`

The arc's center, in the same XZ plane as its endpoints.

### `pub grafting_graph_core::ContourGeometry::CircularArc::clockwise: bool`

Sweep direction from this edge's own start to its own end.

### `pub grafting_graph_core::ContourGeometry::Line`

A straight chord between the edge's two endpoints.

### `pub grafting_graph_core::ContourIdentifierError::EmptyContourEdgeId`

A contour edge identifier must contain at least one character.

### `pub grafting_graph_core::ContourIdentifierError::EmptyRegionId`

A region identifier must contain at least one character.

### `pub grafting_graph_core::DuplicateRegionSpec::clone_payload: &'a dyn core::ops::function::Fn(&N) -> N`

Derives the copy's node payload from the original's -- where an
offset, if any, is applied.

### `pub grafting_graph_core::DuplicateRegionSpec::physical: bool`

Whether the copy is physical.

### `pub grafting_graph_core::DuplicateRegionSpec::suffix: &'a str`

Appended to the original region, edge, and node ids.

### `pub grafting_graph_core::DuplicateRegionSpec::surface_type: grafting_graph_core::SurfaceType`

The copy's surface type.

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

### `pub grafting_graph_core::PlanIdentityKind::Edge`

Stable graph-edge identities.

### `pub grafting_graph_core::PlanIdentityKind::Node`

Stable graph-node identities.

### `pub grafting_graph_core::PlanIdentityKind::Surface`

Surface identities derived from their node sets.

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

### `pub grafting_graph_core::RegionEditError::Contour(grafting_graph_core::ContourError)`

The underlying contour topology rejected the mutation.

### `pub grafting_graph_core::RegionEditError::CutEndpointsNotOnBoundary`

[`cut_region`] was given a cut path whose endpoints are not both on
the region's single outer loop.

### `pub grafting_graph_core::RegionEditError::CutEndpointsNotOnBoundary::region: grafting_graph_core::RegionId`

The region that could not be cut.

### `pub grafting_graph_core::RegionEditError::CutShapeUnsupported`

[`cut_region`] currently supports exactly one outer loop and no
holes -- a multi-loop or holed region has no unambiguous assignment
of the leftover loops to either side of the cut.

### `pub grafting_graph_core::RegionEditError::CutShapeUnsupported::region: grafting_graph_core::RegionId`

The region that could not be cut.

### `pub grafting_graph_core::RegionEditError::Graph(grafting_graph_core::GraphError)`

The underlying graph rejected the mutation.

### `pub grafting_graph_core::RegionEditError::IncompatibleWeld`

[`remove_vertex`]'s two neighboring edges do not describe the same
curve, so welding them would silently invent geometry.

### `pub grafting_graph_core::RegionEditError::IncompatibleWeld::node: grafting_graph_core::NodeId`

The node whose two neighbors disagree.

### `pub grafting_graph_core::RegionEditError::InvalidIdentifier`

A derived identity (a duplicate's suffixed node, edge, or region id)
came out empty and cannot be registered.

### `pub grafting_graph_core::RegionEditError::InvalidIdentifier::id: alloc::string::String`

The identity text that was rejected.

### `pub grafting_graph_core::RegionEditError::NotWeldable`

[`remove_vertex`] requires a node used by exactly two boundary edges
-- the inverse of [`insert_vertex`]. A junction (three or more) or a
dangling endpoint has no single well-defined weld.

### `pub grafting_graph_core::RegionEditError::NotWeldable::incident_edges: usize`

How many registered boundary edges actually touch it.

### `pub grafting_graph_core::RegionEditError::NotWeldable::node: grafting_graph_core::NodeId`

The node that could not be welded away.

### `pub grafting_graph_core::RegionEditError::Surface(grafting_graph_core::SurfaceError)`

The underlying surface registry rejected the mutation.

### `pub grafting_graph_core::RegionEditError::UnknownHole`

[`remove_hole`] was given an index the region does not have.

### `pub grafting_graph_core::RegionEditError::UnknownHole::index: usize`

The index supplied.

### `pub grafting_graph_core::RegionEditError::UnknownHole::region: grafting_graph_core::RegionId`

The region queried.

### `pub grafting_graph_core::RegionEditOutcome::affected_regions: alloc::vec::Vec<grafting_graph_core::RegionId>`

Regions whose geometry changed and whose mesh must be re-derived.

### `pub grafting_graph_core::RegionEditOutcome::created_nodes: alloc::vec::Vec<grafting_graph_core::NodeId>`

Graph nodes minted by this edit.

### `pub grafting_graph_core::RegionEditOutcome::created_regions: alloc::vec::Vec<grafting_graph_core::RegionId>`

Regions that came into existence.

### `pub grafting_graph_core::RegionEditOutcome::removed_nodes: alloc::vec::Vec<grafting_graph_core::NodeId>`

Graph nodes the shared orphan cleanup reclaimed.

### `pub grafting_graph_core::RegionEditOutcome::removed_regions: alloc::vec::Vec<grafting_graph_core::RegionId>`

Regions that stopped existing.

### `pub grafting_graph_core::RegionRemoval::exposed_loops: alloc::vec::Vec<grafting_graph_core::ContourLoop>`

Closed loops of surviving edges now used by exactly one region --
the literal boundary of the hole the removal opened, and therefore
exactly what a caller must stitch back onto to leave neither a hole
nor an extra face.

Empty when the removal opened no hole (nothing neighboured it).

### `pub grafting_graph_core::RegionRemoval::outcome: grafting_graph_core::RegionEditOutcome`

Affected neighbours, removed regions, reclaimed nodes.

### `pub grafting_graph_core::SurfaceCurvature::bulge: grafting_graph_core::ArcBulge`

Which of the two arcs a shared center and two endpoints could
describe -- see this struct's own doc.

### `pub grafting_graph_core::SurfaceCurvature::center: [f32; 2]`

The arc's own center, in the same XZ plane as the surface's corners.

### `pub grafting_graph_core::SurfaceError::DuplicateRegionSurface`

Two semantic surface records cannot decorate the same analytic region.

### `pub grafting_graph_core::SurfaceError::DuplicateRegionSurface::id: grafting_graph_core::RegionId`

Stable region identity that already has semantic attributes.

### `pub grafting_graph_core::SurfaceError::DuplicateSurface`

Two surfaces cannot share the exact same node-set identity.

### `pub grafting_graph_core::SurfaceError::DuplicateSurface::key: grafting_graph_core::SurfaceKey`

Identity that already had a registered surface.

### `pub grafting_graph_core::SurfaceError::EmptyCycle`

A cycle must reference at least one node.

### `pub grafting_graph_core::SurfaceError::UnknownNode`

A cycle referenced a node that is not present in the graph.

### `pub grafting_graph_core::SurfaceError::UnknownNode::id: grafting_graph_core::NodeId`

Identity that could not be resolved.

### `pub grafting_graph_core::SurfaceError::UnknownRegion`

An analytic region surface referenced a region that the supplied
[`ContourTopology`] does not contain.

### `pub grafting_graph_core::SurfaceError::UnknownRegion::id: grafting_graph_core::RegionId`

Stable region identity that could not be resolved.

### `pub grafting_graph_core::SurfaceError::UnknownRegionSurface`

A query or update referenced an analytic region surface that is not
registered in this registry.

### `pub grafting_graph_core::SurfaceError::UnknownRegionSurface::id: grafting_graph_core::RegionId`

Stable region identity that could not be resolved.

### `pub grafting_graph_core::SurfaceError::UnknownSurface`

A query or update referenced a surface that is not registered.

### `pub grafting_graph_core::SurfaceError::UnknownSurface::key: grafting_graph_core::SurfaceKey`

Identity that could not be resolved.

### `pub grafting_graph_core::SurfaceReplacementPlan::added_edges: alloc::vec::Vec<grafting_graph_core::Edge<E>>`

New graph edges required by replacement surface cycles.

### `pub grafting_graph_core::SurfaceReplacementPlan::added_nodes: alloc::vec::Vec<grafting_graph_core::Node<N>>`

New graph nodes required by replacement surface cycles.

### `pub grafting_graph_core::SurfaceReplacementPlan::added_surfaces: alloc::vec::Vec<grafting_graph_core::SurfaceSpec>`

Replacement surfaces to register after the graph records exist.

### `pub grafting_graph_core::SurfaceReplacementPlan::removed_surfaces: alloc::vec::Vec<grafting_graph_core::SurfaceKey>`

Existing surfaces to remove before registering replacements.

### `pub grafting_graph_core::SurfaceReplacementPlan::transformation: grafting_graph_core::TransformationPlan`

Phase-A lifecycle and invalidation contract for this replacement.

### `pub grafting_graph_core::SurfaceReplacementPlan::updated_nodes: alloc::vec::Vec<grafting_graph_core::Node<N>>`

Existing graph nodes whose payload changes while identity is preserved.

### `pub grafting_graph_core::SurfaceSpec::curvature: core::option::Option<grafting_graph_core::SurfaceCurvature>`

The new surface's own curvature, if any -- see [`SurfaceCurvature`]'s
own doc.

### `pub grafting_graph_core::SurfaceSpec::cycle: alloc::vec::Vec<grafting_graph_core::NodeId>`

Nodes forming the new surface's cycle, in mesh-derivation order.

### `pub grafting_graph_core::SurfaceSpec::physical: bool`

Whether the new surface blocks movement or acts as ground.

### `pub grafting_graph_core::SurfaceSpec::surface_type: grafting_graph_core::SurfaceType`

The new surface's open, extensible type identifier.

### `pub grafting_graph_core::TransformationPlanFailure::EmptyInvalidationScope`

A non-empty plan must describe the local surface scope it invalidates.

### `pub grafting_graph_core::TransformationPlanFailure::NoChanges`

A no-op must not become a committed operation.

### `pub grafting_graph_core::TransformationPlanFailure::OverlappingIdentityStates`

One identity appeared in more than one lifecycle state.

### `pub grafting_graph_core::TransformationPlanFailure::OverlappingIdentityStates::kind: grafting_graph_core::PlanIdentityKind`

The category containing the duplicate lifecycle entry.

### `pub mod grafting_graph_core`

Generic graph structures and deterministic algorithms owned by Grafting.

The public contract deliberately exposes only Grafting types. [`Graph`]
currently uses `petgraph` privately, but consumers cannot depend on that
implementation detail. Presentation data remains in callers; calculation
inputs belong in node or edge payloads and cross explicit contracts.

### `pub struct grafting_graph_core::ContourBounds`

An edge's 2D axis-aligned bounding box, in the XZ plane.

### `pub struct grafting_graph_core::ContourEdge`

An oriented curve between two graph nodes, with explicit geometry.

Position data is resolved by the caller (mirroring [`Surface`](crate::Surface)'s
own separation between topology and geometry) -- every method that needs
an endpoint's actual location takes it as a parameter rather than storing
it, since this crate does not interpret the opaque node payload `N`.

### `pub struct grafting_graph_core::ContourEdgeId(_)`

Stable identity of a [`ContourEdge`], independent of which node pair it
currently spans.

### `pub struct grafting_graph_core::ContourTopology`

Tracks every registered [`ContourEdge`] and [`SurfaceRegion`], enforcing
loop closure and the non-manifold-edge rule at registration time -- see
[`ContourError::NonManifoldEdge`]. A region under active construction (a
brush stroke mid-edit) is expected to stay unregistered, off-graph, until
normalized; only a manifold result is ever submitted here.

### `pub struct grafting_graph_core::DuplicateRegionSpec<'a, N>`

How [`duplicate_region`] derives every new identity and payload from the
original's. Deterministic on purpose: the same original plus the same
suffix always reproduces the same ids, so a caller can re-issue a
duplicate without minting a second copy.

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

### `pub struct grafting_graph_core::IdentityDelta<I>`

Deterministic lifecycle classification for one kind of stable identity.

### `pub struct grafting_graph_core::LayoutPosition`

Position assigned to one stable node by a graph layout snapshot.

### `pub struct grafting_graph_core::LayoutSnapshot`

Immutable deterministic output from a grouped-grid layout operation.

### `pub struct grafting_graph_core::LocalInvalidationScope`

The surface scope a successful local transformation requires consumers to refresh.

### `pub struct grafting_graph_core::Node<N>`

A graph node with a stable identity and caller-chosen calculation payload.

### `pub struct grafting_graph_core::NodeId(_)`

Stable Grafting node identity.

### `pub struct grafting_graph_core::OrientedEdgeUse`

A single edge-use inside a [`SurfaceRegion`] loop: which [`ContourEdge`]
and whether it is walked in its own declared direction or reversed.

### `pub struct grafting_graph_core::PrismGridMesh`

A 3D prism grid mesh representing cells with 6 contiguous neighbor slots
(4 lateral, 1 bottom, 1 top), positions, and deformation inputs.

### `pub struct grafting_graph_core::RegionEditOutcome`

What one atomic edit changed. Every list is sorted and deduplicated, so
a caller batching several primitives into one transaction can merge
outcomes without re-normalizing.

### `pub struct grafting_graph_core::RegionId(_)`

Stable identity of a [`SurfaceRegion`], independent of its node set --
the replacement for [`SurfaceKey`](crate::SurfaceKey)'s node-set identity,
which cannot distinguish two regions sharing nodes but differing edges.

### `pub struct grafting_graph_core::RegionRemoval`

What a removal left behind: the edit's own outcome, plus the rim the
hole is now bounded by.

### `pub struct grafting_graph_core::RegionSurface`

The semantic attributes assigned to an analytic [`SurfaceRegion`](crate::SurfaceRegion).

Unlike [`Surface`], this record deliberately has no node-cycle identity: its
stable identity is the [`RegionId`] registered by [`ContourTopology`]. This
migration bridge lets legacy polygon surfaces and analytic contour regions
coexist while consumers move to region-authoring APIs.

### `pub struct grafting_graph_core::Surface`

The semantic record `ADR-0022` defines: `{ type, physical, mesh }` minus
`mesh`, which is derived on demand by the caller from [`cycle`](Self::cycle)
and a [`Graph`]'s current node positions, not stored here.

### `pub struct grafting_graph_core::SurfaceCurvature`

A surface's optional curvature: this surface's own boundary is not a
flat polygon but has (at least) one true circular arc in it, fully
determined by an edge's own two endpoints plus `center` -- radius is
`center`'s distance to either endpoint (validated equal by the caller
deriving this), and `bulge` is the one remaining bit of information no
arrangement of points can supply on its own: which of the two arcs a
shared center and two endpoints could describe (the "short way" or the
"long way" around) is a discrete choice, not a continuous coordinate.
Together, `(start, end, center, bulge)` is the minimal complete
description of an arbitrary circular-arc segment.

Deliberately **not** used to mint extra graph nodes -- a curved wall's
own cycle stays exactly its flat corners (4, for a simple wall panel),
the same as a straight one. `curvature` is metadata a mesh generator
(`grafting-procgen-surface-mesh`) reads at render/re-triangulation time
to tessellate the true curve, not something baked into the graph's own
topology -- see `grafting_procgen_structure_generation::extrusion`'s own
doc for why minting one graph node per tessellated facet was the wrong
call (every downstream consumer that treats "one wall run" as "one
`Surface`" -- redundant-duplicate detection, a room's own wall-follower,
T-junction splitting -- got extra internal seams to mis-treat as
boundaries).

### `pub struct grafting_graph_core::SurfaceKey(_)`

A surface's identity: the unordered set of nodes forming its cycle.

`ADR-0022`: "referencing a surface by its node-set identity, never
restating its geometry." Two surfaces cannot coexist on the exact same
node set -- a real, named limitation of this v1, not an oversight; a
second surface on the same footprint (e.g. a floor and a ceiling
sharing one boundary) needs at least one differing node today.

### `pub struct grafting_graph_core::SurfaceRegion`

A region bounded by one or more outer loops and zero or more holes, all
referencing shared [`ContourEdge`]s rather than restating geometry.

A region's stable identity is its own [`RegionId`], never derived from
its node set -- see this module's own doc.

### `pub struct grafting_graph_core::SurfaceRegistry`

Tracks every construction [`Surface`] and the reverse node -> surfaces
index `ADR-0022`'s reactive-redraw behavior needs: an instant lookup of
which surfaces reference a given node, without a full scan.

### `pub struct grafting_graph_core::SurfaceReplacementPlan<N, E>`

Generic replacement batch produced by a domain transformer.

The batch contains only graph records and semantic surface records. It has
no product type branches or geometry interpretation: a caller computes the
local cycles and supplies the already-validated [`TransformationPlan`].
[`apply_surface_replacement_plan`] validates the entire replacement on a
private graph/registry copy before publishing it, so callers never observe
a partial surface transformation.

### `pub struct grafting_graph_core::SurfaceSpec`

A surface's non-identity attributes, for a transformer registering a new
surface as one step of a larger [`SurfaceReplacementPlan`] rather than
standalone via [`SurfaceRegistry::add_surface`].

### `pub struct grafting_graph_core::SurfaceType(_)`

Open, extensible surface-type identifier.

Deliberately not a fixed/closed enum -- the same mistake already
corrected for `map_state.fbs`'s `BoundaryKind` (`ADR-0022`,
`DEC-052`/`ADR-0014`'s "no product concept hardcoded into
infrastructure").

### `pub struct grafting_graph_core::TransformationPlan`

A validated, data-only batch describing one future atomic transformation.

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

### `pub type grafting_graph_core::ContourLoop = alloc::vec::Vec<grafting_graph_core::OrientedEdgeUse>`

An ordered, closed sequence of oriented edge uses -- one boundary of a
[`SurfaceRegion`] (an outer loop or a hole).

### `pub type grafting_graph_core::ContourPoint = [f32; 2]`

A point in a surface's own XZ plane -- see this module's own doc for why
contour geometry commits to XZ instead of an arbitrary 3D plane.
