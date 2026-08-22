//! Construction surfaces: the `{ type, physical, mesh }` semantic record
//! `ADR-0022` defines, and the registry that tracks them alongside a
//! [`Graph`](crate::Graph). Mesh itself is deliberately not computed here --
//! deriving a real polygon from a cycle's node positions requires knowing
//! what a "position" is inside the graph's opaque `N` payload, which this
//! crate does not know. This module tracks *which* nodes define a surface
//! and *which surfaces reference a given node* (the reactive-redraw lookup
//! `ADR-0022` promises); turning that into geometry is the caller's job.

use std::collections::HashMap;
use std::error::Error;
use std::fmt;

use crate::{ContourTopology, RegionId};

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

/// The curvature a *generator* reports for one face it produced: the face's
/// boundary is not a flat polygon but has one true circular arc in it,
/// fully determined by the edge's own two endpoints plus `center` -- radius
/// is `center`'s distance to either endpoint, and `bulge` is the one
/// remaining bit no arrangement of points can supply: which of the two arcs
/// a shared center and two endpoints could describe (the "short way" or the
/// "long way" round) is a discrete choice, not a continuous coordinate.
/// Together, `(start, end, center, bulge)` completely describes an
/// arbitrary circular-arc segment.
///
/// This travels on a [`SurfaceSpec`](crate::SurfaceSpec) only, and never
/// reaches graph state: whatever applies the spec turns it into a
/// [`ContourGeometry::CircularArc`](crate::ContourGeometry) on the boundary
/// edge that is actually curved, which is where curvature belongs. It
/// mints no extra nodes either -- a curved panel's corners are its four
/// flat corners, the same as a straight one.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SurfaceCurvature {
    /// The arc's own center, in the same XZ plane as the face's corners.
    pub center: [f32; 2],
    /// Which of the two arcs a shared center and two endpoints could
    /// describe -- see this struct's own doc.
    pub bulge: ArcBulge,
}

/// The semantic attributes assigned to an analytic [`SurfaceRegion`](crate::SurfaceRegion).
///
/// This record deliberately has no node-cycle identity: its stable identity
/// is the [`RegionId`] registered by [`ContourTopology`]. A face is what its
/// boundary says it is, so nothing here re-derives identity from the set of
/// nodes that boundary happens to touch.
#[derive(Debug, Clone, PartialEq)]
pub struct RegionSurface {
    region_id: RegionId,
    surface_type: SurfaceType,
    physical: bool,
}

impl RegionSurface {
    /// The stable analytic-region identity this surface decorates.
    pub fn region_id(&self) -> &RegionId {
        &self.region_id
    }

    /// This region surface's open, extensible type identifier.
    pub fn surface_type(&self) -> &SurfaceType {
        &self.surface_type
    }

    /// Whether this region currently blocks movement or acts as ground.
    pub fn physical(&self) -> bool {
        self.physical
    }
}

/// Structural error from surface registration or lookup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SurfaceError {
    /// An analytic region surface referenced a region that the supplied
    /// [`ContourTopology`] does not contain.
    UnknownRegion {
        /// Stable region identity that could not be resolved.
        id: RegionId,
    },
    /// Two semantic surface records cannot decorate the same analytic region.
    DuplicateRegionSurface {
        /// Stable region identity that already has semantic attributes.
        id: RegionId,
    },
    /// A query or update referenced an analytic region surface that is not
    /// registered in this registry.
    UnknownRegionSurface {
        /// Stable region identity that could not be resolved.
        id: RegionId,
    },
}

impl fmt::Display for SurfaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownRegion { id } => write!(formatter, "unknown analytic region {id}"),
            Self::DuplicateRegionSurface { id } => {
                write!(
                    formatter,
                    "an analytic surface already exists for region {id}"
                )
            }
            Self::UnknownRegionSurface { id } => {
                write!(formatter, "unknown analytic surface for region {id}")
            }
        }
    }
}

impl Error for SurfaceError {}

/// Tracks the construction meaning of every analytic contour region:
/// `{ type, physical }` per [`RegionId`], with the geometry itself owned by
/// [`ContourTopology`] and the mesh derived on demand.
#[derive(Debug, Default, Clone)]
pub struct SurfaceRegistry {
    region_surfaces: HashMap<RegionId, RegionSurface>,
}

impl SurfaceRegistry {
    /// Creates an empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers semantic attributes for an already-validated analytic
    /// contour region. [`ContourTopology`] owns edges, loops, and manifold
    /// validation; this registry owns the construction meaning of that region.
    pub fn add_region_surface(
        &mut self,
        topology: &ContourTopology,
        region_id: RegionId,
        surface_type: SurfaceType,
        physical: bool,
    ) -> Result<RegionId, SurfaceError> {
        if topology.region(&region_id).is_none() {
            return Err(SurfaceError::UnknownRegion { id: region_id });
        }
        if self.region_surfaces.contains_key(&region_id) {
            return Err(SurfaceError::DuplicateRegionSurface { id: region_id });
        }
        self.region_surfaces.insert(
            region_id.clone(),
            RegionSurface {
                region_id: region_id.clone(),
                surface_type,
                physical,
            },
        );
        Ok(region_id)
    }

    /// Removes semantic attributes for one analytic region. The caller owns
    /// the matching [`ContourTopology::remove_region`](crate::ContourTopology::remove_region)
    /// operation, so shared contour edges remain available to adjacent regions.
    pub fn remove_region_surface(
        &mut self,
        region_id: &RegionId,
    ) -> Result<RegionSurface, SurfaceError> {
        self.region_surfaces
            .remove(region_id)
            .ok_or_else(|| SurfaceError::UnknownRegionSurface {
                id: region_id.clone(),
            })
    }

    /// Looks up semantic attributes for an analytic region.
    pub fn region_surface(&self, region_id: &RegionId) -> Option<&RegionSurface> {
        self.region_surfaces.get(region_id)
    }

    /// Registered analytic-region surface identities in deterministic order.
    pub fn region_surface_ids(&self) -> Vec<RegionId> {
        let mut ids = self.region_surfaces.keys().cloned().collect::<Vec<_>>();
        ids.sort();
        ids
    }

    /// Updates an analytic region surface's type.
    pub fn set_region_type(
        &mut self,
        region_id: &RegionId,
        surface_type: SurfaceType,
    ) -> Result<(), SurfaceError> {
        let surface = self.region_surfaces.get_mut(region_id).ok_or_else(|| {
            SurfaceError::UnknownRegionSurface {
                id: region_id.clone(),
            }
        })?;
        surface.surface_type = surface_type;
        Ok(())
    }

    /// Updates an analytic region surface's physical flag.
    pub fn set_region_physical(
        &mut self,
        region_id: &RegionId,
        physical: bool,
    ) -> Result<(), SurfaceError> {
        let surface = self.region_surfaces.get_mut(region_id).ok_or_else(|| {
            SurfaceError::UnknownRegionSurface {
                id: region_id.clone(),
            }
        })?;
        surface.physical = physical;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Edge, EdgeId, Graph, Node, NodeId, straight_cycle_region};

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

    fn square_region(
        topology: &mut ContourTopology,
        graph: &Graph<(), ()>,
        name: &str,
    ) -> RegionId {
        let id = RegionId::new(name).unwrap();
        straight_cycle_region(topology, graph, id.clone(), &ids(&["a", "b", "c", "d"])).unwrap();
        id
    }

    #[test]
    fn region_surfaces_register_read_update_and_remove() {
        let graph = ring_graph();
        let mut topology = ContourTopology::new();
        let first = square_region(&mut topology, &graph, "analytic-a");
        let second = square_region(&mut topology, &graph, "analytic-b");
        let mut registry = SurfaceRegistry::new();
        registry
            .add_region_surface(&topology, second.clone(), SurfaceType::new("water"), false)
            .unwrap();
        registry
            .add_region_surface(&topology, first.clone(), SurfaceType::new("path"), true)
            .unwrap();

        assert_eq!(
            registry.region_surface_ids(),
            vec![first.clone(), second.clone()]
        );
        assert_eq!(
            registry.region_surface(&first).unwrap().surface_type(),
            &SurfaceType::new("path")
        );

        registry
            .set_region_type(&first, SurfaceType::new("road"))
            .unwrap();
        registry.set_region_physical(&first, false).unwrap();
        let region = registry.region_surface(&first).unwrap();
        assert_eq!(region.region_id(), &first);
        assert_eq!(region.surface_type(), &SurfaceType::new("road"));
        assert!(!region.physical());

        let removed = registry.remove_region_surface(&second).unwrap();
        assert_eq!(removed.region_id(), &second);
        assert_eq!(registry.region_surface_ids(), vec![first]);
    }

    #[test]
    fn analytic_region_surface_reports_lifecycle_errors() {
        let graph = ring_graph();
        let mut topology = ContourTopology::new();
        let registered = square_region(&mut topology, &graph, "registered");
        let missing = RegionId::new("missing").unwrap();
        let mut registry = SurfaceRegistry::new();

        assert_eq!(
            registry
                .add_region_surface(&topology, missing.clone(), SurfaceType::new("path"), true)
                .unwrap_err(),
            SurfaceError::UnknownRegion {
                id: missing.clone()
            }
        );

        registry
            .add_region_surface(
                &topology,
                registered.clone(),
                SurfaceType::new("path"),
                true,
            )
            .unwrap();
        assert_eq!(
            registry
                .add_region_surface(
                    &topology,
                    registered.clone(),
                    SurfaceType::new("path"),
                    true
                )
                .unwrap_err(),
            SurfaceError::DuplicateRegionSurface {
                id: registered.clone()
            }
        );
        assert_eq!(
            registry.set_region_physical(&missing, false).unwrap_err(),
            SurfaceError::UnknownRegionSurface {
                id: missing.clone()
            }
        );
        assert_eq!(
            registry.remove_region_surface(&missing).unwrap_err(),
            SurfaceError::UnknownRegionSurface { id: missing }
        );
    }
}
