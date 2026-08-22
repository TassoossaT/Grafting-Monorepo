//! The surface a generator says it produced, before anything has been
//! registered.
//!
//! This is a plain description handed from a generator to whatever applies
//! it -- a cycle of nodes, a type, and optional curvature. It is not a
//! surface and it is not an identity: registering one is the applier's job,
//! and every applier today registers an analytic region.
//!
//! `ADR-0022`'s five node-set operations used to live here, along with a
//! transactional replacement plan that applied them. Both are gone: the
//! operations resolved affected surfaces through a node-set index no
//! analytic region was ever in, and the replacement plan had no callers left
//! once creation moved onto regions. Their replacement is the atomic edit
//! vocabulary in [`region_edit`](crate::region_edit), which mutates the
//! [`ContourTopology`](crate::ContourTopology) directly.

use crate::{NodeId, SurfaceCurvature, SurfaceType};

/// One face a generator produced, described rather than registered.
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
