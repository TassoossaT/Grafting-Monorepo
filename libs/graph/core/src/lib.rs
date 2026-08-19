//! Generic graph structures and deterministic algorithms owned by Grafting.
//!
//! The public contract deliberately exposes only Grafting types. [`Graph`]
//! currently uses `petgraph` privately, but consumers cannot depend on that
//! implementation detail. Presentation data remains in callers; calculation
//! inputs belong in node or edge payloads and cross explicit contracts.

#![deny(missing_docs)]
#![deny(rustdoc::broken_intra_doc_links)]

mod construction;
mod contour;
mod layout;
mod model;
mod region_edit;
mod surface;
mod transformation_plan;

pub use construction::{
    ConstructionError, SurfaceReplacementPlan, SurfaceSpec, apply_surface_replacement_plan,
};
pub use region_edit::{
    DuplicateRegionSpec, RegionEditError, RegionEditOutcome, add_hole, cut_region, delete_region,
    duplicate_region, insert_vertex, move_edge, move_region, move_vertex, prune_orphans,
    remove_hole, remove_vertex, retype_edge,
};
pub use contour::{
    ContourBounds, ContourEdge, ContourEdgeId, ContourError, ContourGeometry,
    ContourIdentifierError, ContourLoop, ContourPoint, ContourTopology, OrientedEdgeUse, RegionId,
    SurfaceRegion, straight_cycle_region,
};
pub use layout::{GroupedGridOptions, LayoutError, LayoutPosition, LayoutSnapshot};
pub use model::{
    Edge, EdgeId, FormationInputs, Graph, GraphError, GraphOps, GraphPrimitive, GraphSnapshot,
    IdentifierError, Node, NodeId, PrismGridMesh,
};
pub use surface::{
    ArcBulge, RegionSurface, Surface, SurfaceCurvature, SurfaceError, SurfaceKey, SurfaceRegistry,
    SurfaceType,
};

pub use transformation_plan::{
    IdentityDelta, LocalInvalidationScope, PlanIdentityKind, TransformationPlan,
    TransformationPlanFailure,
};
