//! The transactional surface-replacement batch a domain transformer
//! produces, plus the semantic attributes it registers new surfaces with.
//!
//! `ADR-0022`'s five node-set operations (`Move`, `Delete`, `Merge`,
//! `Split`, `Duplicate`) used to live here. They resolved "which surfaces
//! are affected" through [`SurfaceRegistry::surfaces_referencing`] alone --
//! a query with no way to see an analytic [`SurfaceRegion`](crate::SurfaceRegion)
//! at all -- so once every creation path moved onto regions they could no
//! longer receive real input. Their replacement is the atomic edit
//! vocabulary in [`region_edit`](crate::region_edit), which mutates the
//! [`ContourTopology`](crate::ContourTopology) directly.

use std::error::Error;
use std::fmt;

use crate::{
    Edge, Graph, GraphError, Node, NodeId, SurfaceCurvature, SurfaceError, SurfaceKey,
    SurfaceRegistry, SurfaceType, TransformationPlan,
};

/// Structural error from a domain-level construction operation -- either
/// the graph mutation or the surface bookkeeping it coordinates can fail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConstructionError {
    /// The underlying graph query or mutation failed.
    Graph(GraphError),
    /// The underlying surface registry mutation failed.
    Surface(SurfaceError),
}

impl fmt::Display for ConstructionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Graph(error) => write!(formatter, "{error}"),
            Self::Surface(error) => write!(formatter, "{error}"),
        }
    }
}

impl Error for ConstructionError {}

impl From<GraphError> for ConstructionError {
    fn from(error: GraphError) -> Self {
        Self::Graph(error)
    }
}

impl From<SurfaceError> for ConstructionError {
    fn from(error: SurfaceError) -> Self {
        Self::Surface(error)
    }
}

/// A surface's non-identity attributes, for a transformer registering a new
/// surface as one step of a larger [`SurfaceReplacementPlan`] rather than
/// standalone via [`SurfaceRegistry::add_surface`].
#[derive(Debug, Clone, PartialEq)]
pub struct SurfaceSpec {
    /// Nodes forming the new surface's cycle, in mesh-derivation order.
    pub cycle: Vec<NodeId>,
    /// The new surface's open, extensible type identifier.
    pub surface_type: SurfaceType,
    /// Whether the new surface blocks movement or acts as ground.
    pub physical: bool,
    /// The new surface's own curvature, if any -- see [`SurfaceCurvature`]'s
    /// own doc.
    pub curvature: Option<SurfaceCurvature>,
}

/// Generic replacement batch produced by a domain transformer.
///
/// The batch contains only graph records and semantic surface records. It has
/// no product type branches or geometry interpretation: a caller computes the
/// local cycles and supplies the already-validated [`TransformationPlan`].
/// [`apply_surface_replacement_plan`] validates the entire replacement on a
/// private graph/registry copy before publishing it, so callers never observe
/// a partial surface transformation.
#[derive(Debug)]
pub struct SurfaceReplacementPlan<N, E> {
    /// Phase-A lifecycle and invalidation contract for this replacement.
    pub transformation: TransformationPlan,
    /// Existing graph nodes whose payload changes while identity is preserved.
    pub updated_nodes: Vec<Node<N>>,
    /// New graph nodes required by replacement surface cycles.
    pub added_nodes: Vec<Node<N>>,
    /// New graph edges required by replacement surface cycles.
    pub added_edges: Vec<Edge<E>>,
    /// Existing surfaces to remove before registering replacements.
    pub removed_surfaces: Vec<SurfaceKey>,
    /// Replacement surfaces to register after the graph records exist.
    pub added_surfaces: Vec<SurfaceSpec>,
}

/// Applies a complete local surface replacement atomically.
///
/// The generic graph capability owns transactionality; domain transformers own
/// intersection, formation, and the cycles supplied in the batch. The current
/// graph and registry are cloned, all mutations are attempted on the clone,
/// and only a fully valid result replaces the confirmed state. This requires
/// cloneable caller payloads but avoids exposing the graph backend or making a
/// bridge reimplement partial-rollback logic.
pub fn apply_surface_replacement_plan<N: Clone, E: Clone>(
    graph: &mut Graph<N, E>,
    surfaces: &mut SurfaceRegistry,
    plan: SurfaceReplacementPlan<N, E>,
) -> Result<TransformationPlan, ConstructionError> {
    let mut next_graph = graph.clone();
    let mut next_surfaces = surfaces.clone();

    for node in plan.updated_nodes {
        let id = node.id().clone();
        let data = node.data().clone();
        let current = next_graph
            .node_mut(&id)
            .ok_or_else(|| GraphError::UnknownNode { id: id.clone() })?;
        *current.data_mut() = data;
    }
    for node in plan.added_nodes {
        next_graph.add_node(node)?;
    }
    for edge in plan.added_edges {
        next_graph.add_edge(edge)?;
    }
    for key in &plan.removed_surfaces {
        next_surfaces.remove_surface(key)?;
    }
    for spec in plan.added_surfaces {
        let key =
            next_surfaces.add_surface(&next_graph, spec.cycle, spec.surface_type, spec.physical)?;
        next_surfaces.set_curvature(&key, spec.curvature)?;
    }

    *graph = next_graph;
    *surfaces = next_surfaces;
    Ok(plan.transformation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    use crate::{
        Edge, EdgeId, IdentityDelta, LocalInvalidationScope, Node, PlanIdentityKind,
        TransformationPlan,
    };

    fn node(id: &str) -> Node<[f32; 3]> {
        Node::new(NodeId::new(id).unwrap(), [0.0, 0.0, 0.0])
    }


    fn nid(name: &str) -> NodeId {
        NodeId::new(name).unwrap()
    }

    #[test]
    fn replacement_plan_updates_existing_node_payload_without_changing_identity() {
        let mut graph: Graph<[f32; 3], ()> =
            Graph::try_from_parts(vec![node("a"), node("b")], vec![]).unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let original = surfaces
            .add_surface(
                &graph,
                vec![nid("a"), nid("b")],
                SurfaceType::new("terrain"),
                true,
            )
            .unwrap();
        let node_delta = IdentityDelta::new(
            PlanIdentityKind::Node,
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::from([nid("a")]),
            BTreeSet::new(),
        )
        .unwrap();
        let empty_edges = IdentityDelta::new(
            PlanIdentityKind::Edge,
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::new(),
        )
        .unwrap();
        let empty_surfaces = IdentityDelta::new(
            PlanIdentityKind::Surface,
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::new(),
        )
        .unwrap();
        let transformation = TransformationPlan::new(
            node_delta,
            empty_edges,
            empty_surfaces,
            LocalInvalidationScope::new(
                BTreeSet::from([original.clone()]),
                BTreeSet::new(),
                BTreeSet::new(),
            ),
        )
        .unwrap();

        let applied = apply_surface_replacement_plan(
            &mut graph,
            &mut surfaces,
            SurfaceReplacementPlan {
                transformation,
                updated_nodes: vec![Node::new(nid("a"), [1.0, -0.25, 2.0])],
                added_nodes: Vec::new(),
                added_edges: Vec::new(),
                removed_surfaces: Vec::new(),
                added_surfaces: Vec::new(),
            },
        )
        .unwrap();

        assert_eq!(graph.node(&nid("a")).unwrap().data(), &[1.0, -0.25, 2.0]);
        assert!(applied.node_ids().replaced().contains(&nid("a")));
        assert!(surfaces.surface(&original).is_some());
    }

    #[test]
    fn replacement_plan_rolls_back_when_a_late_graph_record_is_invalid() {
        let mut graph = Graph::try_from_parts(vec![node("a"), node("b")], vec![]).unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let original = surfaces
            .add_surface(
                &graph,
                vec![nid("a"), nid("b")],
                SurfaceType::new("terrain"),
                true,
            )
            .unwrap();
        let node_delta = IdentityDelta::new(
            PlanIdentityKind::Node,
            BTreeSet::from([nid("new")]),
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::new(),
        )
        .unwrap();
        let edge_delta = IdentityDelta::new(
            PlanIdentityKind::Edge,
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::new(),
        )
        .unwrap();
        let surface_delta = IdentityDelta::new(
            PlanIdentityKind::Surface,
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::from([original.clone()]),
        )
        .unwrap();
        let transformation = TransformationPlan::new(
            node_delta,
            edge_delta,
            surface_delta,
            LocalInvalidationScope::new(
                BTreeSet::from([original.clone()]),
                BTreeSet::new(),
                BTreeSet::new(),
            ),
        )
        .unwrap();
        let error = apply_surface_replacement_plan(
            &mut graph,
            &mut surfaces,
            SurfaceReplacementPlan {
                transformation,
                updated_nodes: Vec::new(),
                added_nodes: vec![node("new")],
                added_edges: vec![Edge::new(
                    EdgeId::new("late").unwrap(),
                    nid("new"),
                    nid("missing"),
                    (),
                )],
                removed_surfaces: vec![original.clone()],
                added_surfaces: vec![],
            },
        )
        .unwrap_err();

        assert_eq!(
            error,
            ConstructionError::Graph(GraphError::MissingTarget {
                edge: EdgeId::new("late").unwrap(),
                target: nid("missing")
            })
        );
        assert!(graph.node(&nid("new")).is_none());
        assert!(surfaces.surface(&original).is_some());
    }
}
