//! Generic graph structures and deterministic algorithms owned by Grafting.
//!
//! The public contract deliberately exposes only Grafting types. [`Graph`]
//! currently uses `petgraph` privately, but consumers cannot depend on that
//! implementation detail. Presentation data remains in callers; calculation
//! inputs belong in node or edge payloads and cross explicit contracts.

#![deny(missing_docs)]
#![deny(rustdoc::broken_intra_doc_links)]

mod layout;
mod model;
mod surface;

pub use layout::{GroupedGridOptions, LayoutError, LayoutPosition, LayoutSnapshot};
pub use model::{
    Edge, EdgeId, FormationInputs, Graph, GraphError, GraphOps, GraphPrimitive, GraphSnapshot,
    IdentifierError, Node, NodeId, PrismGridMesh,
};
pub use surface::{Surface, SurfaceError, SurfaceKey, SurfaceRegistry, SurfaceType};

