//! Construction surfaces: the `{ type, physical, mesh }` semantic record
//! `ADR-0022` defines, and the registry that tracks them alongside a
//! [`Graph`](crate::Graph). Mesh itself is deliberately not computed here --
//! deriving a real polygon from a cycle's node positions requires knowing
//! what a "position" is inside the graph's opaque `N` payload, which this
//! crate does not know. This module tracks *which* nodes define a surface
//! and *which surfaces reference a given node* (the reactive-redraw lookup
//! `ADR-0022` promises); turning that into geometry is the caller's job.

use std::collections::{BTreeSet, HashMap};
use std::error::Error;
use std::fmt;

use crate::{Graph, NodeId};

/// Open, extensible surface-type identifier.
///
/// Deliberately not a fixed/closed enum -- the same mistake already
/// corrected for `map_state.fbs`'s `BoundaryKind` (`ADR-0022`,
/// `DEC-052`/`ADR-0014`'s "no product concept hardcoded into
/// infrastructure").
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SurfaceType(String);

impl SurfaceType {
    /// Creates a surface-type identifier from caller-chosen text.
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// Returns the identifier text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SurfaceType {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for SurfaceType {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

/// A surface's identity: the unordered set of nodes forming its cycle.
///
/// `ADR-0022`: "referencing a surface by its node-set identity, never
/// restating its geometry." Two surfaces cannot coexist on the exact same
/// node set -- a real, named limitation of this v1, not an oversight; a
/// second surface on the same footprint (e.g. a floor and a ceiling
/// sharing one boundary) needs at least one differing node today.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SurfaceKey(BTreeSet<NodeId>);

impl SurfaceKey {
    /// Derives the order-independent identity of a node cycle.
    pub fn from_cycle(cycle: &[NodeId]) -> Self {
        Self(cycle.iter().cloned().collect())
    }

    /// Returns the node set this identity is derived from.
    pub fn nodes(&self) -> &BTreeSet<NodeId> {
        &self.0
    }
}

/// Which side of the chord (walking from an arc's own start to its end) it
/// bulges toward -- see [`SurfaceCurvature`]'s own doc for what this
/// disambiguates and why it is the one piece of information a center point
/// alone can never supply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArcBulge {
    /// Bulges toward the chord's left side, facing from the arc's own start to its end.
    Left,
    /// Bulges toward the chord's right side, facing from the arc's own start to its end.
    Right,
}

/// A surface's optional curvature: this surface's own boundary is not a
/// flat polygon but has (at least) one true circular arc in it, fully
/// determined by an edge's own two endpoints plus `center` -- radius is
/// `center`'s distance to either endpoint (validated equal by the caller
/// deriving this), and `bulge` is the one remaining bit of information no
/// arrangement of points can supply on its own: which of the two arcs a
/// shared center and two endpoints could describe (the "short way" or the
/// "long way" around) is a discrete choice, not a continuous coordinate.
/// Together, `(start, end, center, bulge)` is the minimal complete
/// description of an arbitrary circular-arc segment.
///
/// Deliberately **not** used to mint extra graph nodes -- a curved wall's
/// own cycle stays exactly its flat corners (4, for a simple wall panel),
/// the same as a straight one. `curvature` is metadata a mesh generator
/// (`grafting-procgen-surface-mesh`) reads at render/re-triangulation time
/// to tessellate the true curve, not something baked into the graph's own
/// topology -- see `grafting_procgen_structure_generation::extrusion`'s own
/// doc for why minting one graph node per tessellated facet was the wrong
/// call (every downstream consumer that treats "one wall run" as "one
/// `Surface`" -- redundant-duplicate detection, a room's own wall-follower,
/// T-junction splitting -- got extra internal seams to mis-treat as
/// boundaries).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SurfaceCurvature {
    /// The arc's own center, in the same XZ plane as the surface's corners.
    pub center: [f32; 2],
    /// Which of the two arcs a shared center and two endpoints could
    /// describe -- see this struct's own doc.
    pub bulge: ArcBulge,
}

/// The semantic record `ADR-0022` defines: `{ type, physical, mesh }` minus
/// `mesh`, which is derived on demand by the caller from [`cycle`](Self::cycle)
/// and a [`Graph`]'s current node positions, not stored here.
#[derive(Debug, Clone, PartialEq)]
pub struct Surface {
    cycle: Vec<NodeId>,
    surface_type: SurfaceType,
    physical: bool,
    curvature: Option<SurfaceCurvature>,
}

impl Surface {
    /// Nodes forming this surface's cycle, in mesh-derivation order.
    pub fn cycle(&self) -> &[NodeId] {
        &self.cycle
    }

    /// This surface's open, extensible type identifier.
    pub fn surface_type(&self) -> &SurfaceType {
        &self.surface_type
    }

    /// Whether this surface currently blocks movement or acts as ground --
    /// nothing about vision or rendering, that belongs to the asset layer
    /// (`ADR-0022`).
    pub fn physical(&self) -> bool {
        self.physical
    }

    /// This surface's own curvature, if any -- see [`SurfaceCurvature`]'s
    /// own doc.
    pub fn curvature(&self) -> Option<SurfaceCurvature> {
        self.curvature
    }
}

/// Structural error from surface registration or lookup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SurfaceError {
    /// A cycle must reference at least one node.
    EmptyCycle,
    /// A cycle referenced a node that is not present in the graph.
    UnknownNode {
        /// Identity that could not be resolved.
        id: NodeId,
    },
    /// Two surfaces cannot share the exact same node-set identity.
    DuplicateSurface {
        /// Identity that already had a registered surface.
        key: SurfaceKey,
    },
    /// A query or update referenced a surface that is not registered.
    UnknownSurface {
        /// Identity that could not be resolved.
        key: SurfaceKey,
    },
}

impl fmt::Display for SurfaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyCycle => {
                formatter.write_str("a surface cycle must reference at least one node")
            }
            Self::UnknownNode { id } => {
                write!(formatter, "surface cycle references unknown node {id}")
            }
            Self::DuplicateSurface { key } => {
                write!(formatter, "a surface already exists for node set {key:?}")
            }
            Self::UnknownSurface { key } => {
                write!(formatter, "unknown surface for node set {key:?}")
            }
        }
    }
}

impl Error for SurfaceError {}

/// Tracks every construction [`Surface`] and the reverse node -> surfaces
/// index `ADR-0022`'s reactive-redraw behavior needs: an instant lookup of
/// which surfaces reference a given node, without a full scan.
#[derive(Debug, Default, Clone)]
pub struct SurfaceRegistry {
    surfaces: HashMap<SurfaceKey, Surface>,
    by_node: HashMap<NodeId, BTreeSet<SurfaceKey>>,
}

impl SurfaceRegistry {
    /// Creates an empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a new surface from a node cycle, validated against
    /// `graph`. Errors if the cycle is empty, references a node the graph
    /// does not have, or duplicates an already-registered node-set
    /// identity.
    pub fn add_surface<N, E>(
        &mut self,
        graph: &Graph<N, E>,
        cycle: Vec<NodeId>,
        surface_type: SurfaceType,
        physical: bool,
    ) -> Result<SurfaceKey, SurfaceError> {
        if cycle.is_empty() {
            return Err(SurfaceError::EmptyCycle);
        }
        for id in &cycle {
            if graph.node(id).is_none() {
                return Err(SurfaceError::UnknownNode { id: id.clone() });
            }
        }
        let key = SurfaceKey::from_cycle(&cycle);
        if self.surfaces.contains_key(&key) {
            return Err(SurfaceError::DuplicateSurface { key });
        }
        for id in &cycle {
            self.by_node
                .entry(id.clone())
                .or_default()
                .insert(key.clone());
        }
        self.surfaces.insert(
            key.clone(),
            Surface {
                cycle,
                surface_type,
                physical,
                curvature: None,
            },
        );
        Ok(key)
    }

    /// Removes a surface by its node-set identity, returning it.
    pub fn remove_surface(&mut self, key: &SurfaceKey) -> Result<Surface, SurfaceError> {
        let surface = self
            .surfaces
            .remove(key)
            .ok_or_else(|| SurfaceError::UnknownSurface { key: key.clone() })?;
        for id in &surface.cycle {
            if let Some(referencing) = self.by_node.get_mut(id) {
                referencing.remove(key);
                if referencing.is_empty() {
                    self.by_node.remove(id);
                }
            }
        }
        Ok(surface)
    }

    /// Looks up a surface by its node-set identity.
    pub fn surface(&self, key: &SurfaceKey) -> Option<&Surface> {
        self.surfaces.get(key)
    }

    /// Registered surface identities in deterministic identity order.
    ///
    /// The registry's internal storage is intentionally unordered. Callers
    /// that need to examine a local domain snapshot therefore start from this
    /// ordered list and resolve each record through [`surface`](Self::surface).
    pub fn surface_keys(&self) -> Vec<SurfaceKey> {
        let mut keys = self.surfaces.keys().cloned().collect::<Vec<_>>();
        keys.sort();
        keys
    }
    /// Every surface referencing `node`, in deterministic identity order --
    /// the instant lookup `ADR-0022`'s `Move` operation needs to know which
    /// surfaces to recompute, without a full scan.
    pub fn surfaces_referencing(&self, node: &NodeId) -> impl Iterator<Item = &SurfaceKey> {
        self.by_node.get(node).into_iter().flatten()
    }

    /// Updates a surface's type. Touches no node and no cycle -- per
    /// `ADR-0022`, `type` is not derived from node positions, so this never
    /// requires a mesh recompute.
    pub fn set_type(
        &mut self,
        key: &SurfaceKey,
        surface_type: SurfaceType,
    ) -> Result<(), SurfaceError> {
        let surface = self
            .surfaces
            .get_mut(key)
            .ok_or_else(|| SurfaceError::UnknownSurface { key: key.clone() })?;
        surface.surface_type = surface_type;
        Ok(())
    }

    /// Updates a surface's `physical` flag. Touches no node and no cycle,
    /// for the same reason as [`set_type`](Self::set_type).
    pub fn set_physical(&mut self, key: &SurfaceKey, physical: bool) -> Result<(), SurfaceError> {
        let surface = self
            .surfaces
            .get_mut(key)
            .ok_or_else(|| SurfaceError::UnknownSurface { key: key.clone() })?;
        surface.physical = physical;
        Ok(())
    }

    /// Updates a surface's curvature (see [`SurfaceCurvature`]'s own doc).
    /// Touches no node and no cycle, for the same reason as
    /// [`set_type`](Self::set_type) -- a curved wall's own graph topology
    /// never encodes its curve, only this attribute does.
    pub fn set_curvature(
        &mut self,
        key: &SurfaceKey,
        curvature: Option<SurfaceCurvature>,
    ) -> Result<(), SurfaceError> {
        let surface = self
            .surfaces
            .get_mut(key)
            .ok_or_else(|| SurfaceError::UnknownSurface { key: key.clone() })?;
        surface.curvature = curvature;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Edge, EdgeId, Node};

    fn node(id: &str) -> Node<()> {
        Node::new(NodeId::new(id).unwrap(), ())
    }

    fn ring_graph() -> Graph<(), ()> {
        Graph::try_from_parts(
            vec![node("a"), node("b"), node("c"), node("d")],
            vec![
                Edge::new(
                    EdgeId::new("ab").unwrap(),
                    NodeId::new("a").unwrap(),
                    NodeId::new("b").unwrap(),
                    (),
                ),
                Edge::new(
                    EdgeId::new("bc").unwrap(),
                    NodeId::new("b").unwrap(),
                    NodeId::new("c").unwrap(),
                    (),
                ),
                Edge::new(
                    EdgeId::new("cd").unwrap(),
                    NodeId::new("c").unwrap(),
                    NodeId::new("d").unwrap(),
                    (),
                ),
                Edge::new(
                    EdgeId::new("da").unwrap(),
                    NodeId::new("d").unwrap(),
                    NodeId::new("a").unwrap(),
                    (),
                ),
            ],
        )
        .unwrap()
    }

    fn ids(names: &[&str]) -> Vec<NodeId> {
        names
            .iter()
            .map(|name| NodeId::new(*name).unwrap())
            .collect()
    }

    #[test]
    fn add_surface_rejects_empty_unknown_and_duplicate_cycles() {
        let graph = ring_graph();
        let mut registry = SurfaceRegistry::new();

        assert_eq!(
            registry
                .add_surface(&graph, vec![], SurfaceType::new("wall"), true)
                .unwrap_err(),
            SurfaceError::EmptyCycle
        );

        assert_eq!(
            registry
                .add_surface(
                    &graph,
                    ids(&["a", "missing"]),
                    SurfaceType::new("wall"),
                    true
                )
                .unwrap_err(),
            SurfaceError::UnknownNode {
                id: NodeId::new("missing").unwrap()
            }
        );

        let key = registry
            .add_surface(
                &graph,
                ids(&["a", "b", "c", "d"]),
                SurfaceType::new("floor"),
                true,
            )
            .unwrap();
        assert_eq!(
            key.nodes(),
            &ids(&["a", "b", "c", "d"]).into_iter().collect()
        );

        // Same node set, different order: same identity, rejected as a duplicate.
        assert_eq!(
            registry
                .add_surface(
                    &graph,
                    ids(&["c", "d", "a", "b"]),
                    SurfaceType::new("floor"),
                    true
                )
                .unwrap_err(),
            SurfaceError::DuplicateSurface { key }
        );
    }

    #[test]
    fn surfaces_referencing_gives_instant_reverse_lookup() {
        let graph = ring_graph();
        let mut registry = SurfaceRegistry::new();
        let wall = registry
            .add_surface(&graph, ids(&["a", "b"]), SurfaceType::new("wall"), true)
            .unwrap();
        let floor = registry
            .add_surface(
                &graph,
                ids(&["b", "c", "d", "a"]),
                SurfaceType::new("floor"),
                true,
            )
            .unwrap();

        let mut referencing_a = registry
            .surfaces_referencing(&NodeId::new("a").unwrap())
            .cloned()
            .collect::<Vec<_>>();
        referencing_a.sort();
        let mut expected = vec![wall.clone(), floor.clone()];
        expected.sort();
        assert_eq!(referencing_a, expected);

        assert_eq!(
            registry
                .surfaces_referencing(&NodeId::new("c").unwrap())
                .collect::<Vec<_>>(),
            vec![&floor]
        );

        registry.remove_surface(&wall).unwrap();
        assert_eq!(
            registry
                .surfaces_referencing(&NodeId::new("b").unwrap())
                .collect::<Vec<_>>(),
            vec![&floor]
        );
        // "a" was only referenced by the removed wall and the floor; still
        // referenced by the floor, so the reverse index entry survives.
        assert_eq!(
            registry
                .surfaces_referencing(&NodeId::new("a").unwrap())
                .collect::<Vec<_>>(),
            vec![&floor]
        );
    }

    #[test]
    fn attribute_edits_never_touch_the_cycle() {
        let graph = ring_graph();
        let mut registry = SurfaceRegistry::new();
        let key = registry
            .add_surface(
                &graph,
                ids(&["a", "b", "c"]),
                SurfaceType::new("wall"),
                true,
            )
            .unwrap();

        registry.set_type(&key, SurfaceType::new("window")).unwrap();
        registry.set_physical(&key, false).unwrap();

        let surface = registry.surface(&key).unwrap();
        assert_eq!(surface.surface_type(), &SurfaceType::new("window"));
        assert!(!surface.physical());
        assert_eq!(surface.cycle(), ids(&["a", "b", "c"]).as_slice());

        assert_eq!(
            registry
                .set_type(
                    &SurfaceKey::from_cycle(&ids(&["missing"])),
                    SurfaceType::new("x")
                )
                .unwrap_err(),
            SurfaceError::UnknownSurface {
                key: SurfaceKey::from_cycle(&ids(&["missing"]))
            }
        );
    }

    #[test]
    fn remove_surface_rejects_unknown_identity() {
        let graph = ring_graph();
        let mut registry = SurfaceRegistry::new();
        let _ = graph;
        assert_eq!(
            registry
                .remove_surface(&SurfaceKey::from_cycle(&ids(&["a", "b"])))
                .unwrap_err(),
            SurfaceError::UnknownSurface {
                key: SurfaceKey::from_cycle(&ids(&["a", "b"]))
            }
        );
    }
}
