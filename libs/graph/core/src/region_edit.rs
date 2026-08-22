//! The atomic edit vocabulary for an already-built [`SurfaceRegion`]:
//! vertex-level, edge-level, and region-level primitives that mutate the
//! [`Graph`]/[`ContourTopology`] pair and report exactly which regions need
//! their mesh re-derived.
//!
//! **Every primitive here is type-agnostic.** Nothing in this module knows
//! what a wall, a path, a tower, or a terrain patch is, and nothing tags a
//! node or edge with a "role." Which primitives a given structure type
//! allows, what constrains their parameters, and which extra primitives fire
//! as a cascade are all owned by the front end, which is the side that
//! requested a specific generated shape and therefore already knows what
//! each index in the response means -- see
//! `docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`. The only
//! obligation this layer carries toward that split is deterministic,
//! stable ordering (see [`ContourTopology::region_nodes`]).
//!
//! **Zero orphans is a structural guarantee, not per-operation behavior.**
//! Every primitive that can remove boundary ends its own transaction by
//! calling the one shared [`prune_orphans`] step, rather than each operation
//! reimplementing cleanup -- the same rule the path-brush's own region
//! consumption already follows.
//!
//! This module deliberately replaces `ADR-0022`'s five node-set operations
//! (`move_node`, `delete_node`, `merge_surfaces`, `split_surface`,
//! `duplicate_surface`), which predate the analytic model and resolve
//! "which surfaces are affected" through [`SurfaceRegistry::surfaces_referencing`]
//! alone -- a query that cannot see a region at all.

use std::collections::BTreeSet;
use std::error::Error;
use std::fmt;

use crate::{
    ContourEdge, ContourEdgeId, ContourError, ContourGeometry, ContourLoop, ContourTopology, Graph,
    GraphError, Node, NodeId, OrientedEdgeUse, RegionId, SurfaceError, SurfaceRegistry,
    SurfaceType,
};

/// Structural failure of an atomic region edit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegionEditError {
    /// The underlying contour topology rejected the mutation.
    Contour(ContourError),
    /// The underlying graph rejected the mutation.
    Graph(GraphError),
    /// The underlying surface registry rejected the mutation.
    Surface(SurfaceError),
    /// [`remove_vertex`] requires a node used by exactly two boundary edges
    /// -- the inverse of [`insert_vertex`]. A junction (three or more) or a
    /// dangling endpoint has no single well-defined weld.
    NotWeldable {
        /// The node that could not be welded away.
        node: NodeId,
        /// How many registered boundary edges actually touch it.
        incident_edges: usize,
    },
    /// [`remove_vertex`]'s two neighboring edges do not describe the same
    /// curve, so welding them would silently invent geometry.
    IncompatibleWeld {
        /// The node whose two neighbors disagree.
        node: NodeId,
    },
    /// [`cut_region`] was given a cut path whose endpoints are not both on
    /// the region's single outer loop.
    CutEndpointsNotOnBoundary {
        /// The region that could not be cut.
        region: RegionId,
    },
    /// [`cut_region`] currently supports exactly one outer loop and no
    /// holes -- a multi-loop or holed region has no unambiguous assignment
    /// of the leftover loops to either side of the cut.
    CutShapeUnsupported {
        /// The region that could not be cut.
        region: RegionId,
    },
    /// A derived identity (a duplicate's suffixed node, edge, or region id)
    /// came out empty and cannot be registered.
    InvalidIdentifier {
        /// The identity text that was rejected.
        id: String,
    },
    /// [`remove_hole`] was given an index the region does not have.
    UnknownHole {
        /// The region queried.
        region: RegionId,
        /// The index supplied.
        index: usize,
    },
}

impl fmt::Display for RegionEditError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Contour(error) => write!(formatter, "{error}"),
            Self::Graph(error) => write!(formatter, "{error}"),
            Self::Surface(error) => write!(formatter, "{error}"),
            Self::NotWeldable {
                node,
                incident_edges,
            } => write!(
                formatter,
                "node {node} is used by {incident_edges} boundary edges; welding requires exactly 2"
            ),
            Self::IncompatibleWeld { node } => write!(
                formatter,
                "node {node}'s two neighboring edges describe different curves and cannot weld"
            ),
            Self::CutEndpointsNotOnBoundary { region } => write!(
                formatter,
                "the cut path's endpoints are not both on region {region}'s outer loop"
            ),
            Self::CutShapeUnsupported { region } => write!(
                formatter,
                "region {region} must have exactly one outer loop and no holes to be cut"
            ),
            Self::InvalidIdentifier { id } => {
                write!(
                    formatter,
                    "derived identifier {id:?} is not a valid identity"
                )
            }
            Self::UnknownHole { region, index } => {
                write!(formatter, "region {region} has no hole at index {index}")
            }
        }
    }
}

impl Error for RegionEditError {}

impl From<ContourError> for RegionEditError {
    fn from(error: ContourError) -> Self {
        Self::Contour(error)
    }
}

impl From<GraphError> for RegionEditError {
    fn from(error: GraphError) -> Self {
        Self::Graph(error)
    }
}

impl From<SurfaceError> for RegionEditError {
    fn from(error: SurfaceError) -> Self {
        Self::Surface(error)
    }
}

/// What one atomic edit changed. Every list is sorted and deduplicated, so
/// a caller batching several primitives into one transaction can merge
/// outcomes without re-normalizing.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RegionEditOutcome {
    /// Regions whose geometry changed and whose mesh must be re-derived.
    pub affected_regions: Vec<RegionId>,
    /// Regions that came into existence.
    pub created_regions: Vec<RegionId>,
    /// Regions that stopped existing.
    pub removed_regions: Vec<RegionId>,
    /// Graph nodes minted by this edit.
    pub created_nodes: Vec<NodeId>,
    /// Graph nodes the shared orphan cleanup reclaimed.
    pub removed_nodes: Vec<NodeId>,
}

impl RegionEditOutcome {
    /// Folds `other` into this outcome -- what a caller applying a policy's
    /// primary operation plus its cascade uses to report one combined result.
    pub fn merge(&mut self, other: RegionEditOutcome) {
        extend_sorted(&mut self.affected_regions, other.affected_regions);
        extend_sorted(&mut self.created_regions, other.created_regions);
        extend_sorted(&mut self.removed_regions, other.removed_regions);
        extend_sorted(&mut self.created_nodes, other.created_nodes);
        extend_sorted(&mut self.removed_nodes, other.removed_nodes);
    }
}

fn extend_sorted<T: Ord>(target: &mut Vec<T>, extra: Vec<T>) {
    target.extend(extra);
    target.sort();
    target.dedup();
}

/// The one shared end-of-transaction cleanup every removing primitive runs:
/// drop every contour edge no region uses anymore, then delete every
/// candidate node no surviving region's boundary still touches. Candidates
/// are scoped to the nodes the caller's own edit could have orphaned, never
/// the whole graph, so a node staged for an unrelated in-flight operation is
/// never collected.
pub fn prune_orphans<N, E>(
    graph: &mut Graph<N, E>,
    topology: &mut ContourTopology,
    candidates: &[NodeId],
) -> Result<Vec<NodeId>, RegionEditError> {
    topology.prune_unused_edges();
    let in_use = topology.nodes_in_use();
    let mut removed = Vec::new();
    let unique: BTreeSet<NodeId> = candidates.iter().cloned().collect();
    for id in unique {
        if in_use.contains(&id) {
            continue;
        }
        if graph.node(&id).is_none() {
            continue;
        }
        graph.remove_node(&id)?;
        removed.push(id);
    }
    Ok(removed)
}

// ---- Vertex level ----

/// `MoveVertex`: applies `update` to one node's payload and reports every
/// region whose boundary touches it. Topology is untouched, so this can only
/// fail when the node does not exist.
pub fn move_vertex<N, E>(
    graph: &mut Graph<N, E>,
    topology: &ContourTopology,
    id: &NodeId,
    update: impl FnOnce(&mut N),
) -> Result<RegionEditOutcome, RegionEditError> {
    let node = graph
        .node_mut(id)
        .ok_or_else(|| GraphError::UnknownNode { id: id.clone() })?;
    update(node.data_mut());
    Ok(RegionEditOutcome {
        affected_regions: topology.regions_touching_node(id),
        ..RegionEditOutcome::default()
    })
}

/// `InsertVertex`: subdivides one boundary edge, minting a new node on it.
/// Both fragments keep the original edge's own geometry description (an arc
/// keeps its center and sweep direction, only its span shrinks), and every
/// region using the original -- in either direction -- is rewritten to walk
/// the two fragments instead.
///
/// The caller supplies the new node (with the position it wants) and both
/// fragment identities, so ids stay caller-derived and reproducible. This
/// is also the whole of the "cut a movable notch out of a straight edge"
/// case: call it twice on the same original edge, and the middle fragment
/// is an independently movable segment -- there is no separate `Cut`
/// primitive.
pub fn insert_vertex<N, E>(
    graph: &mut Graph<N, E>,
    topology: &mut ContourTopology,
    edge: &ContourEdgeId,
    node: Node<N>,
    first_fragment: ContourEdgeId,
    second_fragment: ContourEdgeId,
) -> Result<RegionEditOutcome, RegionEditError> {
    let original = topology
        .edge(edge)
        .cloned()
        .ok_or_else(|| ContourError::UnknownEdgeIdentity { id: edge.clone() })?;
    let node_id = node.id().clone();
    if graph.node(&node_id).is_none() {
        graph.add_node(node)?;
    }
    let (first, second) = original.split(node_id.clone(), first_fragment, second_fragment);
    let first_id = first.id().clone();
    let second_id = second.id().clone();
    topology.add_edge(graph, first)?;
    topology.add_edge(graph, second)?;
    let affected = topology.replace_edge_uses(
        edge,
        &[
            OrientedEdgeUse::forward(first_id),
            OrientedEdgeUse::forward(second_id),
        ],
    )?;
    topology.prune_unused_edges();
    Ok(RegionEditOutcome {
        affected_regions: affected,
        created_nodes: vec![node_id],
        ..RegionEditOutcome::default()
    })
}

/// `RemoveVertex`: welds a node's two neighboring boundary edges into one,
/// the exact inverse of [`insert_vertex`]. Requires exactly two incident
/// boundary edges describing the same curve; a junction or a geometry
/// mismatch is rejected rather than silently reshaped.
///
/// Runs the shared [`prune_orphans`] cleanup, so the welded-away node and
/// both replaced edges are gone when this returns.
pub fn remove_vertex<N, E>(
    graph: &mut Graph<N, E>,
    topology: &mut ContourTopology,
    node: &NodeId,
    welded_edge: ContourEdgeId,
) -> Result<RegionEditOutcome, RegionEditError> {
    let incident = topology.edges_incident_to(node);
    if incident.len() != 2 {
        return Err(RegionEditError::NotWeldable {
            node: node.clone(),
            incident_edges: incident.len(),
        });
    }
    let incoming = topology
        .edge(&incident[0])
        .cloned()
        .expect("edges_incident_to only names registered edges");
    let outgoing = topology
        .edge(&incident[1])
        .cloned()
        .expect("edges_incident_to only names registered edges");
    if incoming.geometry() != outgoing.geometry() {
        return Err(RegionEditError::IncompatibleWeld { node: node.clone() });
    }

    // Orient the pair as `far_start -> node -> far_end` regardless of how
    // either edge happens to be declared.
    let (first, first_reversed) = if incoming.end_node() == node {
        (incoming.start_node().clone(), false)
    } else {
        (incoming.end_node().clone(), true)
    };
    // Only the first edge's own orientation decides how the welded edge is
    // walked -- the second edge's use is dropped, not substituted, so its
    // declared direction never reaches a loop.
    let second = if outgoing.start_node() == node {
        outgoing.end_node().clone()
    } else {
        outgoing.start_node().clone()
    };

    let welded_id = welded_edge.clone();
    topology.add_edge(
        graph,
        ContourEdge::new(welded_edge, first, second, *incoming.geometry()),
    )?;

    // Both replaced uses go in one pass: substituting them one at a time
    // would leave the loop momentarily open at `node`, which
    // `replace_region_loops` rightly rejects.
    let mut affected = topology.regions_using_edge(incoming.id());
    affected.extend(topology.regions_using_edge(outgoing.id()));
    affected.sort();
    affected.dedup();
    for region_id in &affected {
        let region = topology
            .region(region_id)
            .expect("usage bookkeeping never names an unregistered region")
            .clone();
        let weld = |loops: &[ContourLoop]| -> Vec<ContourLoop> {
            loops
                .iter()
                .map(|loop_| {
                    loop_
                        .iter()
                        .filter_map(|use_| {
                            if use_.edge() == outgoing.id() {
                                return None;
                            }
                            if use_.edge() != incoming.id() {
                                return Some(use_.clone());
                            }
                            Some(if first_reversed != use_.is_reversed() {
                                OrientedEdgeUse::reversed(welded_id.clone())
                            } else {
                                OrientedEdgeUse::forward(welded_id.clone())
                            })
                        })
                        .collect()
                })
                .collect()
        };
        let outer_loops = weld(region.outer_loops());
        let holes = weld(region.holes());
        topology.replace_region_loops(region_id, outer_loops, holes)?;
    }

    let removed_nodes = prune_orphans(graph, topology, &[node.clone()])?;
    Ok(RegionEditOutcome {
        affected_regions: affected,
        removed_nodes,
        ..RegionEditOutcome::default()
    })
}

// ---- Edge level ----

/// `RetypeEdge`: swaps one boundary edge's geometry -- `Line` for `Arc`, or
/// an arc's own center/sweep -- without touching either endpoint.
pub fn retype_edge(
    topology: &mut ContourTopology,
    edge: &ContourEdgeId,
    geometry: ContourGeometry,
) -> Result<RegionEditOutcome, RegionEditError> {
    let affected = topology.regions_using_edge(edge);
    topology.set_edge_geometry(edge, geometry)?;
    Ok(RegionEditOutcome {
        affected_regions: affected,
        ..RegionEditOutcome::default()
    })
}

/// `MoveEdge`: applies `update` to both of an edge's endpoints, moving the
/// whole segment as one rigid unit ("drag a whole wall panel"). Any other
/// edge sharing one of those endpoints follows along, exactly as it would
/// if the node were dragged on its own -- nodes only ever share what they
/// are each independently connected to.
pub fn move_edge<N, E>(
    graph: &mut Graph<N, E>,
    topology: &ContourTopology,
    edge: &ContourEdgeId,
    update: impl Fn(&mut N),
) -> Result<RegionEditOutcome, RegionEditError> {
    let resolved = topology
        .edge(edge)
        .ok_or_else(|| ContourError::UnknownEdgeIdentity { id: edge.clone() })?;
    let endpoints = [resolved.start_node().clone(), resolved.end_node().clone()];
    let mut outcome = RegionEditOutcome::default();
    for id in endpoints.iter().collect::<BTreeSet<_>>() {
        outcome.merge(move_vertex(graph, topology, id, &update)?);
    }
    Ok(outcome)
}

// ---- Region level ----

/// `MoveRegion`: applies `update` to every node on a region's own boundary,
/// including its holes. Neighboring regions sharing any of those nodes are
/// reported as affected too -- a shared boundary moves with it by
/// construction, since both regions reference the very same edges.
pub fn move_region<N, E>(
    graph: &mut Graph<N, E>,
    topology: &ContourTopology,
    region: &RegionId,
    update: impl Fn(&mut N),
) -> Result<RegionEditOutcome, RegionEditError> {
    let nodes = topology.region_nodes(region)?;
    let mut outcome = RegionEditOutcome::default();
    for id in &nodes {
        outcome.merge(move_vertex(graph, topology, id, &update)?);
    }
    Ok(outcome)
}

/// What a removal left behind: the edit's own outcome, plus the rim the
/// hole is now bounded by.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RegionRemoval {
    /// Affected neighbours, removed regions, reclaimed nodes.
    pub outcome: RegionEditOutcome,
    /// Closed loops of surviving edges now used by exactly one region --
    /// the literal boundary of the hole the removal opened, and therefore
    /// exactly what a caller must stitch back onto to leave neither a hole
    /// nor an extra face.
    ///
    /// **Each use is already oriented for the stitching face**, opposite to
    /// how the surviving neighbour walks it, so a caller registers a new
    /// region with these verbatim. Using the neighbour's own direction would
    /// be an illegal second use in the same direction.
    ///
    /// Empty when the removal opened no hole (nothing neighboured it).
    pub exposed_loops: Vec<ContourLoop>,
}

/// `DeleteRegion` over a whole set at once, reporting the rim left behind.
///
/// Batching is not an optimization, it is the correctness condition: an
/// edge shared by two regions that are *both* being removed is interior to
/// the removal and must not appear in the rim. Deleting one at a time would
/// expose it in between, and a caller stitching onto it would weld into the
/// middle of its own hole.
///
/// The rim is derived, never guessed: after the removal and the shared
/// orphan cleanup, it is exactly those of the removed regions' own edges
/// that still exist and are now used by exactly one region.
pub fn delete_regions<N, E>(
    graph: &mut Graph<N, E>,
    topology: &mut ContourTopology,
    surfaces: &mut SurfaceRegistry,
    regions: &[RegionId],
) -> Result<RegionRemoval, RegionEditError> {
    let removed: BTreeSet<RegionId> = regions.iter().cloned().collect();
    let mut touched_edges: Vec<ContourEdgeId> = Vec::new();
    let mut candidate_nodes: Vec<NodeId> = Vec::new();
    let mut neighbors: Vec<RegionId> = Vec::new();

    for id in &removed {
        let region = topology
            .region(id)
            .ok_or_else(|| ContourError::UnknownRegion { id: id.clone() })?;
        for use_ in region
            .outer_loops()
            .iter()
            .chain(region.holes().iter())
            .flatten()
        {
            touched_edges.push(use_.edge().clone());
            neighbors.extend(topology.regions_using_edge(use_.edge()));
        }
        candidate_nodes.extend(topology.region_nodes(id)?);
    }
    touched_edges.sort();
    touched_edges.dedup();
    neighbors.retain(|id| !removed.contains(id));
    neighbors.sort();
    neighbors.dedup();

    for id in &removed {
        topology.remove_region(id)?;
        if surfaces.region_surface(id).is_some() {
            surfaces.remove_region_surface(id)?;
        }
    }
    let removed_nodes = prune_orphans(graph, topology, &candidate_nodes)?;

    // Each rim use is oriented **opposite** to how the surviving neighbour
    // walks it, so a caller can stitch a face onto the rim by using these
    // verbatim. Handing back the neighbour's own direction instead would
    // make every such face an illegal second use in the same direction.
    let rim: Vec<OrientedEdgeUse> = touched_edges
        .into_iter()
        .filter_map(|edge| {
            topology.sole_usage_reversed(&edge).map(|reversed| {
                if reversed {
                    OrientedEdgeUse::forward(edge)
                } else {
                    OrientedEdgeUse::reversed(edge)
                }
            })
        })
        .collect();
    Ok(RegionRemoval {
        outcome: RegionEditOutcome {
            affected_regions: neighbors,
            removed_regions: removed.into_iter().collect(),
            removed_nodes,
            ..RegionEditOutcome::default()
        },
        exposed_loops: topology.assemble_oriented_loops(&rim),
    })
}

/// `DeleteRegion` for a single region -- [`delete_regions`] with one entry,
/// discarding the rim. A caller that intends to stitch anything back should
/// call [`delete_regions`] instead and keep it.
pub fn delete_region<N, E>(
    graph: &mut Graph<N, E>,
    topology: &mut ContourTopology,
    surfaces: &mut SurfaceRegistry,
    region: &RegionId,
) -> Result<RegionEditOutcome, RegionEditError> {
    Ok(delete_regions(graph, topology, surfaces, std::slice::from_ref(region))?.outcome)
}

/// How [`duplicate_region`] derives every new identity and payload from the
/// original's. Deterministic on purpose: the same original plus the same
/// suffix always reproduces the same ids, so a caller can re-issue a
/// duplicate without minting a second copy.
pub struct DuplicateRegionSpec<'a, N> {
    /// Appended to the original region, edge, and node ids.
    pub suffix: &'a str,
    /// Derives the copy's node payload from the original's -- where an
    /// offset, if any, is applied.
    pub clone_payload: &'a dyn Fn(&N) -> N,
    /// The copy's surface type.
    pub surface_type: SurfaceType,
    /// Whether the copy is physical.
    pub physical: bool,
}

/// `DuplicateRegion`: mints a parallel copy of a region -- one new node per
/// boundary node, one new edge per boundary edge, the same loop structure,
/// and its own registered surface.
pub fn duplicate_region<N, E>(
    graph: &mut Graph<N, E>,
    topology: &mut ContourTopology,
    surfaces: &mut SurfaceRegistry,
    region: &RegionId,
    spec: DuplicateRegionSpec<'_, N>,
) -> Result<RegionEditOutcome, RegionEditError> {
    let source = topology
        .region(region)
        .ok_or_else(|| ContourError::UnknownRegion { id: region.clone() })?
        .clone();

    let mut created_nodes = Vec::new();
    for id in topology.region_nodes(region)? {
        let copy_id = suffixed_node(&id, spec.suffix)?;
        if graph.node(&copy_id).is_none() {
            let payload = (spec.clone_payload)(
                graph
                    .node(&id)
                    .expect("region_nodes only names live graph nodes")
                    .data(),
            );
            graph.add_node(Node::new(copy_id.clone(), payload))?;
        }
        created_nodes.push(copy_id);
    }

    let copy_loop = |topology: &mut ContourTopology,
                     graph: &Graph<N, E>,
                     loop_: &ContourLoop|
     -> Result<ContourLoop, RegionEditError> {
        let mut copied = Vec::with_capacity(loop_.len());
        for use_ in loop_ {
            let edge = topology
                .edge(use_.edge())
                .expect("a registered region only references registered edges")
                .clone();
            let copy_id = suffixed_edge(edge.id(), spec.suffix)?;
            if topology.edge(&copy_id).is_none() {
                topology.add_edge(
                    graph,
                    ContourEdge::new(
                        copy_id.clone(),
                        suffixed_node(edge.start_node(), spec.suffix)?,
                        suffixed_node(edge.end_node(), spec.suffix)?,
                        *edge.geometry(),
                    ),
                )?;
            }
            copied.push(if use_.is_reversed() {
                OrientedEdgeUse::reversed(copy_id)
            } else {
                OrientedEdgeUse::forward(copy_id)
            });
        }
        Ok(copied)
    };

    let mut outer_loops = Vec::with_capacity(source.outer_loops().len());
    for loop_ in source.outer_loops() {
        outer_loops.push(copy_loop(topology, graph, loop_)?);
    }
    let mut holes = Vec::with_capacity(source.holes().len());
    for loop_ in source.holes() {
        holes.push(copy_loop(topology, graph, loop_)?);
    }

    let copy_region = suffixed_region(region, spec.suffix)?;
    topology.add_region(copy_region.clone(), outer_loops, holes)?;
    surfaces.add_region_surface(
        topology,
        copy_region.clone(),
        spec.surface_type,
        spec.physical,
    )?;
    Ok(RegionEditOutcome {
        created_regions: vec![copy_region],
        created_nodes,
        ..RegionEditOutcome::default()
    })
}

fn suffixed_node(id: &NodeId, suffix: &str) -> Result<NodeId, RegionEditError> {
    NodeId::new(format!("{id}{suffix}")).map_err(|_| invalid_identifier(id.as_str(), suffix))
}

fn suffixed_edge(id: &ContourEdgeId, suffix: &str) -> Result<ContourEdgeId, RegionEditError> {
    ContourEdgeId::new(format!("{id}{suffix}")).map_err(|_| invalid_identifier(id.as_str(), suffix))
}

fn suffixed_region(id: &RegionId, suffix: &str) -> Result<RegionId, RegionEditError> {
    RegionId::new(format!("{id}{suffix}")).map_err(|_| invalid_identifier(id.as_str(), suffix))
}

fn invalid_identifier(id: &str, suffix: &str) -> RegionEditError {
    RegionEditError::InvalidIdentifier {
        id: format!("{id}{suffix}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ContourGeometry, straight_cycle_region};

    type TestGraph = Graph<[f32; 3], ()>;

    fn nid(name: &str) -> NodeId {
        NodeId::new(name).unwrap()
    }

    fn eid(name: &str) -> ContourEdgeId {
        ContourEdgeId::new(name).unwrap()
    }

    fn rid(name: &str) -> RegionId {
        RegionId::new(name).unwrap()
    }

    /// One unit quad registered as an analytic region, plus its own surface
    /// -- what every structured type (a wall panel, a tower facet, a terrain
    /// tile) reduces to at this layer.
    fn quad() -> (TestGraph, ContourTopology, SurfaceRegistry, RegionId) {
        let graph: TestGraph = Graph::try_from_parts(
            vec![
                Node::new(nid("a"), [0.0, 0.0, 0.0]),
                Node::new(nid("b"), [1.0, 0.0, 0.0]),
                Node::new(nid("c"), [1.0, 0.0, 1.0]),
                Node::new(nid("d"), [0.0, 0.0, 1.0]),
            ],
            Vec::new(),
        )
        .unwrap();
        let mut topology = ContourTopology::new();
        let region = straight_cycle_region(
            &mut topology,
            &graph,
            rid("quad"),
            &[nid("a"), nid("b"), nid("c"), nid("d")],
        )
        .unwrap();
        let mut surfaces = SurfaceRegistry::new();
        surfaces
            .add_region_surface(&topology, region.clone(), SurfaceType::new("wall"), true)
            .unwrap();
        (graph, topology, surfaces, region)
    }

    #[test]
    fn move_vertex_reports_every_region_touching_the_node() {
        let (mut graph, topology, _surfaces, region) = quad();
        let outcome = move_vertex(&mut graph, &topology, &nid("a"), |position| {
            position[1] = 4.0;
        })
        .unwrap();
        assert_eq!(outcome.affected_regions, vec![region]);
        assert_eq!(graph.node(&nid("a")).unwrap().data(), &[0.0, 4.0, 0.0]);
    }

    /// The exact gap that made a path-brush-created node look frozen while a
    /// tower's node moved: the retired `move_node` resolved affected
    /// A region's own boundary is what `move_vertex` reports against --
    /// there is no node-set index anywhere for it to miss.
    #[test]
    fn move_vertex_reports_every_region_whose_boundary_touches_the_node() {
        let (mut graph, topology, _surfaces, _region) = quad();
        let outcome = move_vertex(&mut graph, &topology, &nid("a"), |_| {}).unwrap();
        assert_eq!(outcome.affected_regions.len(), 1);
    }

    #[test]
    fn insert_vertex_subdivides_the_edge_in_the_region_loop() {
        let (mut graph, mut topology, _surfaces, region) = quad();
        let outcome = insert_vertex(
            &mut graph,
            &mut topology,
            &eid("quad-0"),
            Node::new(nid("mid"), [0.5, 0.0, 0.0]),
            eid("quad-0-1"),
            eid("quad-0-2"),
        )
        .unwrap();

        assert_eq!(outcome.affected_regions, vec![region.clone()]);
        assert_eq!(outcome.created_nodes, vec![nid("mid")]);
        assert_eq!(topology.region(&region).unwrap().outer_loops()[0].len(), 5);
        assert!(
            topology.edge(&eid("quad-0")).is_none(),
            "the replaced edge is reclaimed, never left orphaned"
        );
        assert!(
            topology
                .region_nodes(&region)
                .unwrap()
                .contains(&nid("mid"))
        );
    }

    /// The "carve a movable notch out of a straight edge" case the design
    /// doc deliberately refuses to give its own primitive: two inserts on
    /// the same original edge leave a middle segment nothing links back to
    /// either original corner.
    #[test]
    fn two_inserts_on_one_edge_leave_an_independently_movable_middle_segment() {
        let (mut graph, mut topology, _surfaces, region) = quad();
        insert_vertex(
            &mut graph,
            &mut topology,
            &eid("quad-0"),
            Node::new(nid("p1"), [0.25, 0.0, 0.0]),
            eid("left"),
            eid("rest"),
        )
        .unwrap();
        insert_vertex(
            &mut graph,
            &mut topology,
            &eid("rest"),
            Node::new(nid("p2"), [0.75, 0.0, 0.0]),
            eid("middle"),
            eid("right"),
        )
        .unwrap();

        assert_eq!(topology.region(&region).unwrap().outer_loops()[0].len(), 6);
        let middle = topology.edge(&eid("middle")).unwrap();
        assert_eq!(middle.start_node(), &nid("p1"));
        assert_eq!(middle.end_node(), &nid("p2"));

        move_edge(&mut graph, &topology, &eid("middle"), |position| {
            position[2] -= 0.5;
        })
        .unwrap();
        assert_eq!(graph.node(&nid("a")).unwrap().data(), &[0.0, 0.0, 0.0]);
        assert_eq!(graph.node(&nid("b")).unwrap().data(), &[1.0, 0.0, 0.0]);
        assert_eq!(graph.node(&nid("p1")).unwrap().data(), &[0.25, 0.0, -0.5]);
        assert_eq!(graph.node(&nid("p2")).unwrap().data(), &[0.75, 0.0, -0.5]);
    }

    #[test]
    fn remove_vertex_is_the_inverse_of_insert_vertex_and_leaves_no_orphans() {
        let (mut graph, mut topology, _surfaces, region) = quad();
        insert_vertex(
            &mut graph,
            &mut topology,
            &eid("quad-0"),
            Node::new(nid("mid"), [0.5, 0.0, 0.0]),
            eid("first"),
            eid("second"),
        )
        .unwrap();

        let outcome = remove_vertex(&mut graph, &mut topology, &nid("mid"), eid("welded")).unwrap();

        assert_eq!(outcome.affected_regions, vec![region.clone()]);
        assert_eq!(outcome.removed_nodes, vec![nid("mid")]);
        assert_eq!(topology.region(&region).unwrap().outer_loops()[0].len(), 4);
        assert!(graph.node(&nid("mid")).is_none());
        assert!(topology.edge(&eid("first")).is_none());
        assert!(topology.edge(&eid("second")).is_none());
        let welded = topology.edge(&eid("welded")).unwrap();
        assert_eq!(welded.start_node(), &nid("a"));
        assert_eq!(welded.end_node(), &nid("b"));
    }

    #[test]
    fn remove_vertex_rejects_a_junction_instead_of_guessing_a_weld() {
        let (mut graph, mut topology, _surfaces, _region) = quad();
        topology
            .add_edge(
                &graph,
                ContourEdge::new(eid("spur"), nid("a"), nid("c"), ContourGeometry::Line),
            )
            .unwrap();
        let error = remove_vertex(&mut graph, &mut topology, &nid("a"), eid("welded")).unwrap_err();
        assert_eq!(
            error,
            RegionEditError::NotWeldable {
                node: nid("a"),
                incident_edges: 3,
            }
        );
    }

    #[test]
    fn retype_edge_swaps_geometry_without_touching_endpoints() {
        let (_graph, mut topology, _surfaces, region) = quad();
        let arc = ContourGeometry::CircularArc {
            center: [0.5, -0.5],
            clockwise: false,
        };
        let outcome = retype_edge(&mut topology, &eid("quad-0"), arc).unwrap();
        assert_eq!(outcome.affected_regions, vec![region]);
        let edge = topology.edge(&eid("quad-0")).unwrap();
        assert_eq!(edge.geometry(), &arc);
        assert_eq!(edge.start_node(), &nid("a"));
        assert_eq!(edge.end_node(), &nid("b"));
    }

    #[test]
    fn move_region_moves_every_boundary_node_once() {
        let (mut graph, topology, _surfaces, region) = quad();
        move_region(&mut graph, &topology, &region, |position| {
            position[0] += 10.0;
        })
        .unwrap();
        assert_eq!(graph.node(&nid("a")).unwrap().data(), &[10.0, 0.0, 0.0]);
        assert_eq!(graph.node(&nid("c")).unwrap().data(), &[11.0, 0.0, 1.0]);
    }

    #[test]
    fn delete_region_leaves_zero_orphaned_nodes_or_edges() {
        let (mut graph, mut topology, mut surfaces, region) = quad();
        let outcome = delete_region(&mut graph, &mut topology, &mut surfaces, &region).unwrap();
        assert_eq!(outcome.removed_regions, vec![region.clone()]);
        assert_eq!(
            outcome.removed_nodes,
            vec![nid("a"), nid("b"), nid("c"), nid("d")]
        );
        assert_eq!(graph.node_count(), 0);
        assert!(topology.edge(&eid("quad-0")).is_none());
        assert!(surfaces.region_surface(&region).is_none());
    }

    /// A 4x4 grid of quad faces sharing every interior edge -- shaped like a
    /// real terrain lattice, and big enough that a *pair* of adjacent faces
    /// can both be interior (a 3x3 has only one such face, so every pair
    /// touches the outside).
    ///
    /// That surrounding is the whole point: an edge only survives a removal
    /// if something on its other side still holds it. A face on the
    /// lattice's outer rim therefore leaves a notch open to the outside, not
    /// an enclosed hole -- which is correct, and is why a 1-wide strip is
    /// the wrong fixture for this.
    ///
    /// `regions[row][column]` is `face{column}_{row}`.
    fn lattice() -> (
        TestGraph,
        ContourTopology,
        SurfaceRegistry,
        Vec<Vec<RegionId>>,
    ) {
        const SIDE: usize = 4;
        let mut nodes = Vec::new();
        for row in 0..=SIDE {
            for column in 0..=SIDE {
                nodes.push(Node::new(
                    nid(&format!("n{column}_{row}")),
                    [column as f32, 0.0, row as f32],
                ));
            }
        }
        let graph: TestGraph = Graph::try_from_parts(nodes, Vec::new()).unwrap();
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();

        for row in 0..=SIDE {
            for column in 0..SIDE {
                topology
                    .add_edge(
                        &graph,
                        ContourEdge::new(
                            eid(&format!("h{column}_{row}")),
                            nid(&format!("n{column}_{row}")),
                            nid(&format!("n{}_{row}", column + 1)),
                            ContourGeometry::Line,
                        ),
                    )
                    .unwrap();
            }
        }
        for row in 0..SIDE {
            for column in 0..=SIDE {
                topology
                    .add_edge(
                        &graph,
                        ContourEdge::new(
                            eid(&format!("v{column}_{row}")),
                            nid(&format!("n{column}_{row}")),
                            nid(&format!("n{column}_{}", row + 1)),
                            ContourGeometry::Line,
                        ),
                    )
                    .unwrap();
            }
        }

        let mut regions = Vec::new();
        for row in 0..SIDE {
            let mut in_row = Vec::new();
            for column in 0..SIDE {
                let id = rid(&format!("face{column}_{row}"));
                topology
                    .add_region(
                        id.clone(),
                        vec![vec![
                            OrientedEdgeUse::forward(eid(&format!("h{column}_{row}"))),
                            OrientedEdgeUse::forward(eid(&format!("v{}_{row}", column + 1))),
                            OrientedEdgeUse::reversed(eid(&format!("h{column}_{}", row + 1))),
                            OrientedEdgeUse::reversed(eid(&format!("v{column}_{row}"))),
                        ]],
                        Vec::new(),
                    )
                    .unwrap();
                surfaces
                    .add_region_surface(&topology, id.clone(), SurfaceType::new("terrain"), true)
                    .unwrap();
                in_row.push(id);
            }
            regions.push(in_row);
        }
        (graph, topology, surfaces, regions)
    }

    #[test]
    fn removing_a_surrounded_face_exposes_the_rim_its_neighbours_still_hold() {
        let (mut graph, mut topology, mut surfaces, regions) = lattice();

        let removal = delete_regions(
            &mut graph,
            &mut topology,
            &mut surfaces,
            &[regions[1][1].clone()],
        )
        .unwrap();

        assert_eq!(
            removal.outcome.affected_regions,
            vec![
                regions[1][0].clone(),
                regions[0][1].clone(),
                regions[2][1].clone(),
                regions[1][2].clone(),
            ],
            "all four neighbours lost their other side and must re-derive"
        );
        assert_eq!(removal.exposed_loops.len(), 1, "one face leaves one hole");
        let rim: BTreeSet<ContourEdgeId> = removal.exposed_loops[0]
            .iter()
            .map(|use_| use_.edge().clone())
            .collect();
        assert_eq!(
            rim,
            BTreeSet::from([eid("h1_1"), eid("v2_1"), eid("h1_2"), eid("v1_1")]),
            "the rim is the removed face's own edges, each now used exactly once"
        );
        for edge in &rim {
            assert_eq!(topology.usage_count(edge), 1);
        }
        assert!(
            removal.outcome.removed_nodes.is_empty(),
            "every corner is still held by a neighbouring face"
        );
    }

    /// A face on the lattice's own outer rim has edges nothing sits behind.
    /// Those are reclaimed rather than reported, so the result is an open
    /// notch with no closed loop -- correctly, since there is no ring there
    /// to stitch onto.
    #[test]
    fn removing_a_face_on_the_outer_rim_leaves_an_open_notch_not_a_loop() {
        let (mut graph, mut topology, mut surfaces, regions) = lattice();

        let removal = delete_regions(
            &mut graph,
            &mut topology,
            &mut surfaces,
            &[regions[0][0].clone()],
        )
        .unwrap();

        assert!(
            removal.exposed_loops.is_empty(),
            "a corner face's outward edges had nothing behind them to keep them alive"
        );
        assert!(topology.edge(&eid("h0_0")).is_none());
        assert_eq!(
            topology.usage_count(&eid("v1_0")),
            1,
            "the inward edges do survive"
        );
    }

    /// The correctness condition behind batching: an edge between two faces
    /// that are *both* going away is interior to the removal. Reporting it
    /// as rim would send a caller stitching into the middle of its own hole.
    #[test]
    fn an_edge_between_two_removed_faces_is_never_part_of_the_rim() {
        let (mut graph, mut topology, mut surfaces, regions) = lattice();

        let removal = delete_regions(
            &mut graph,
            &mut topology,
            &mut surfaces,
            &[regions[1][1].clone(), regions[1][2].clone()],
        )
        .unwrap();

        assert_eq!(removal.exposed_loops.len(), 1);
        let rim: BTreeSet<ContourEdgeId> = removal.exposed_loops[0]
            .iter()
            .map(|use_| use_.edge().clone())
            .collect();
        assert!(
            !rim.contains(&eid("v2_1")),
            "v2_1 sat between the two removed faces and is interior to the removal"
        );
        assert!(
            topology.edge(&eid("v2_1")).is_none(),
            "and it was reclaimed"
        );
        assert_eq!(rim.len(), 6, "two merged faces leave one six-edge rim");
    }

    /// The rim's whole purpose: a face registered with those uses verbatim
    /// must be *accepted*, sharing each rim edge with the neighbour that
    /// still holds it. If the orientation were handed back as the
    /// neighbour's own, this would be rejected as a second use in the same
    /// direction -- which is precisely the mistake the rim exists to prevent.
    #[test]
    fn a_face_stitched_onto_the_rim_verbatim_is_accepted_as_a_shared_boundary() {
        let (mut graph, mut topology, mut surfaces, regions) = lattice();
        let removal = delete_regions(
            &mut graph,
            &mut topology,
            &mut surfaces,
            &[regions[1][1].clone()],
        )
        .unwrap();

        let rim = removal.exposed_loops[0].clone();
        let patch = rid("stitched");
        topology
            .add_region(patch.clone(), vec![rim.clone()], Vec::new())
            .expect("the rim's own orientation must be directly usable");

        for use_ in &rim {
            assert_eq!(
                topology.usage_count(use_.edge()),
                2,
                "each rim edge is now shared by the neighbour and the stitched face"
            );
        }
        assert!(topology.region(&patch).is_some());
    }

    #[test]
    fn the_exposed_rim_is_a_closed_walk_a_caller_can_stitch_onto() {
        let (mut graph, mut topology, mut surfaces, regions) = lattice();
        let removal = delete_regions(
            &mut graph,
            &mut topology,
            &mut surfaces,
            &[regions[1][1].clone()],
        )
        .unwrap();

        let walked = &removal.exposed_loops[0];
        for window in walked.windows(2) {
            let ends_at = topology.edge(window[0].edge()).map(|edge| {
                if window[0].is_reversed() {
                    edge.start_node().clone()
                } else {
                    edge.end_node().clone()
                }
            });
            let starts_at = topology.edge(window[1].edge()).map(|edge| {
                if window[1].is_reversed() {
                    edge.end_node().clone()
                } else {
                    edge.start_node().clone()
                }
            });
            assert_eq!(ends_at, starts_at, "consecutive rim uses must meet");
        }
    }

    /// Removing a face nothing neighbours opens no hole, so there is nothing
    /// to stitch -- and the rim must be empty rather than reporting the
    /// outer perimeter, which was already free before the removal.
    #[test]
    fn removing_an_isolated_region_exposes_no_rim() {
        let (mut graph, mut topology, mut surfaces, region) = quad();
        let removal =
            delete_regions(&mut graph, &mut topology, &mut surfaces, &[region.clone()]).unwrap();
        assert!(removal.exposed_loops.is_empty());
        assert_eq!(removal.outcome.removed_nodes.len(), 4);
    }

    #[test]
    fn duplicate_region_mints_a_parallel_copy_with_derived_ids() {
        let (mut graph, mut topology, mut surfaces, region) = quad();
        let offset = |position: &[f32; 3]| [position[0], position[1] + 3.0, position[2]];
        let outcome = duplicate_region(
            &mut graph,
            &mut topology,
            &mut surfaces,
            &region,
            DuplicateRegionSpec {
                suffix: ":copy",
                clone_payload: &offset,
                surface_type: SurfaceType::new("wall"),
                physical: true,
            },
        )
        .unwrap();

        assert_eq!(outcome.created_regions, vec![rid("quad:copy")]);
        assert_eq!(graph.node(&nid("a:copy")).unwrap().data(), &[0.0, 3.0, 0.0]);
        assert_eq!(
            topology.region(&rid("quad:copy")).unwrap().outer_loops()[0].len(),
            4
        );
        assert!(surfaces.region_surface(&rid("quad:copy")).is_some());
        assert!(
            topology.region(&region).is_some(),
            "duplicating never disturbs the original"
        );
    }

    #[test]
    fn an_edit_on_a_shared_boundary_reports_both_neighboring_regions() {
        let mut graph: TestGraph = Graph::try_from_parts(
            vec![
                Node::new(nid("a"), [0.0, 0.0, 0.0]),
                Node::new(nid("b"), [1.0, 0.0, 0.0]),
                Node::new(nid("c"), [1.0, 0.0, 1.0]),
                Node::new(nid("d"), [0.0, 0.0, 1.0]),
            ],
            Vec::new(),
        )
        .unwrap();
        let mut topology = ContourTopology::new();
        for (id, start, end) in [
            ("shared", "a", "c"),
            ("a-b", "a", "b"),
            ("b-c", "b", "c"),
            ("c-d", "c", "d"),
            ("d-a", "d", "a"),
        ] {
            topology
                .add_edge(
                    &graph,
                    ContourEdge::new(eid(id), nid(start), nid(end), ContourGeometry::Line),
                )
                .unwrap();
        }
        topology
            .add_region(
                rid("lower"),
                vec![vec![
                    OrientedEdgeUse::forward(eid("a-b")),
                    OrientedEdgeUse::forward(eid("b-c")),
                    OrientedEdgeUse::reversed(eid("shared")),
                ]],
                Vec::new(),
            )
            .unwrap();
        topology
            .add_region(
                rid("upper"),
                vec![vec![
                    OrientedEdgeUse::forward(eid("shared")),
                    OrientedEdgeUse::forward(eid("c-d")),
                    OrientedEdgeUse::forward(eid("d-a")),
                ]],
                Vec::new(),
            )
            .unwrap();

        let outcome = insert_vertex(
            &mut graph,
            &mut topology,
            &eid("shared"),
            Node::new(nid("mid"), [0.5, 0.0, 0.5]),
            eid("shared-1"),
            eid("shared-2"),
        )
        .unwrap();

        assert_eq!(outcome.affected_regions, vec![rid("lower"), rid("upper")]);
        for id in [rid("lower"), rid("upper")] {
            assert_eq!(
                topology.region(&id).unwrap().outer_loops()[0].len(),
                4,
                "both sides of a shared boundary see the subdivision"
            );
        }
    }
}
