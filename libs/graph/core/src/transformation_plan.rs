//! Data-only contract for a validated local graph transformation.
//!
//! This module intentionally contains no brush geometry, product type, or
//! application step. A future Rust transformer builds one plan before the
//! canonical session applies any graph mutation.

use std::collections::BTreeSet;

use crate::{EdgeId, NodeId, SurfaceKey};

/// The identity category whose states overlap in an invalid plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanIdentityKind {
    /// Stable graph-node identities.
    Node,
    /// Stable graph-edge identities.
    Edge,
    /// Surface identities derived from their node sets.
    Surface,
}

/// A planning failure. No variant applies a mutation or represents a partial
/// result: callers must leave the confirmed graph and surface registry intact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransformationPlanFailure {
    /// A no-op must not become a committed operation.
    NoChanges,
    /// A non-empty plan must describe the local surface scope it invalidates.
    EmptyInvalidationScope,
    /// One identity appeared in more than one lifecycle state.
    OverlappingIdentityStates {
        /// The category containing the duplicate lifecycle entry.
        kind: PlanIdentityKind,
    },
}

/// Deterministic lifecycle classification for one kind of stable identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityDelta<I> {
    created: BTreeSet<I>,
    preserved: BTreeSet<I>,
    replaced: BTreeSet<I>,
    removed: BTreeSet<I>,
}

impl<I: Ord> IdentityDelta<I> {
    /// Validates mutually exclusive identity lifecycle states.
    pub fn new(
        kind: PlanIdentityKind,
        created: BTreeSet<I>,
        preserved: BTreeSet<I>,
        replaced: BTreeSet<I>,
        removed: BTreeSet<I>,
    ) -> Result<Self, TransformationPlanFailure> {
        let sets = [&created, &preserved, &replaced, &removed];
        for left in 0..sets.len() {
            for right in (left + 1)..sets.len() {
                if sets[left].iter().any(|id| sets[right].contains(id)) {
                    return Err(TransformationPlanFailure::OverlappingIdentityStates { kind });
                }
            }
        }
        Ok(Self {
            created,
            preserved,
            replaced,
            removed,
        })
    }

    /// Identities newly introduced by the plan.
    pub fn created(&self) -> &BTreeSet<I> {
        &self.created
    }
    /// Identities retained because they still connect unaffected geometry.
    pub fn preserved(&self) -> &BTreeSet<I> {
        &self.preserved
    }
    /// Identities superseded inside the remodeled region.
    pub fn replaced(&self) -> &BTreeSet<I> {
        &self.replaced
    }
    /// Identities removed by the plan.
    pub fn removed(&self) -> &BTreeSet<I> {
        &self.removed
    }
    /// Whether this category has no lifecycle changes.
    pub fn is_empty(&self) -> bool {
        self.created.is_empty()
            && self.preserved.is_empty()
            && self.replaced.is_empty()
            && self.removed.is_empty()
    }
}

/// The surface scope a successful local transformation requires consumers to refresh.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LocalInvalidationScope {
    changed_surfaces: BTreeSet<SurfaceKey>,
    topology_repair_neighbors: BTreeSet<SurfaceKey>,
    direct_dependencies: BTreeSet<SurfaceKey>,
}

impl LocalInvalidationScope {
    /// Creates a local invalidation scope without scanning unrelated clouds.
    pub fn new(
        changed_surfaces: BTreeSet<SurfaceKey>,
        topology_repair_neighbors: BTreeSet<SurfaceKey>,
        direct_dependencies: BTreeSet<SurfaceKey>,
    ) -> Self {
        Self {
            changed_surfaces,
            topology_repair_neighbors,
            direct_dependencies,
        }
    }
    /// Surfaces directly changed by the plan.
    pub fn changed_surfaces(&self) -> &BTreeSet<SurfaceKey> {
        &self.changed_surfaces
    }
    /// Adjacent surfaces inspected for topology repair or fragment cleanup.
    pub fn topology_repair_neighbors(&self) -> &BTreeSet<SurfaceKey> {
        &self.topology_repair_neighbors
    }
    /// Direct transformer dependencies, excluding unrelated clouds.
    pub fn direct_dependencies(&self) -> &BTreeSet<SurfaceKey> {
        &self.direct_dependencies
    }
    /// Whether the plan identifies no local refresh work.
    pub fn is_empty(&self) -> bool {
        self.changed_surfaces.is_empty()
            && self.topology_repair_neighbors.is_empty()
            && self.direct_dependencies.is_empty()
    }
}

/// A validated, data-only batch describing one future atomic transformation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransformationPlan {
    node_ids: IdentityDelta<NodeId>,
    edge_ids: IdentityDelta<EdgeId>,
    surface_ids: IdentityDelta<SurfaceKey>,
    invalidation: LocalInvalidationScope,
}

impl TransformationPlan {
    /// Creates a plan only when it has structural changes and a local refresh scope.
    pub fn new(
        node_ids: IdentityDelta<NodeId>,
        edge_ids: IdentityDelta<EdgeId>,
        surface_ids: IdentityDelta<SurfaceKey>,
        invalidation: LocalInvalidationScope,
    ) -> Result<Self, TransformationPlanFailure> {
        if node_ids.is_empty() && edge_ids.is_empty() && surface_ids.is_empty() {
            return Err(TransformationPlanFailure::NoChanges);
        }
        if invalidation.is_empty() {
            return Err(TransformationPlanFailure::EmptyInvalidationScope);
        }
        Ok(Self {
            node_ids,
            edge_ids,
            surface_ids,
            invalidation,
        })
    }
    /// Node lifecycle changes.
    pub fn node_ids(&self) -> &IdentityDelta<NodeId> {
        &self.node_ids
    }
    /// Edge lifecycle changes.
    pub fn edge_ids(&self) -> &IdentityDelta<EdgeId> {
        &self.edge_ids
    }
    /// Surface lifecycle changes.
    pub fn surface_ids(&self) -> &IdentityDelta<SurfaceKey> {
        &self.surface_ids
    }
    /// Local derived-state refresh scope.
    pub fn invalidation(&self) -> &LocalInvalidationScope {
        &self.invalidation
    }
}
