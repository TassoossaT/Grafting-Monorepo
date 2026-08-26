//! Generic curve, offset, and polygon-union primitives for construction
//! generation. Stateless pure geometry -- no dependency on
//! `grafting-graph-core`, and no vocabulary for what a curve or a band is
//! *for* (a road, a path, anything else): this crate only knows points,
//! polylines, polygons, and meshes, matching the isolation
//! `grafting-procgen-surface-mesh` already uses for generation-only crates.
//! A composition layer decides what a curve means; this crate only turns
//! control points into a flattened curve, a flattened curve into banded
//! ribbons, and any number of ribbons into one unioned, triangulated mesh.

mod curve;
mod offset;
mod types;
mod union;

pub use curve::sample_catmull_rom;
pub use offset::offset_bands;
pub use types::{Point, Polygon, Polyline, TriangulatedMesh};
pub use union::union_and_triangulate;

#[cfg(test)]
mod tests;
