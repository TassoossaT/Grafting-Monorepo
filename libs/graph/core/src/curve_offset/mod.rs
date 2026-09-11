//! Canonical reusable sampling, offset and contour union primitives.
mod curve;
mod field;
mod offset;
mod types;
mod union;
pub use curve::sample_catmull_rom;
pub use field::{FieldSample, ReferenceCurve, ReferenceField};
pub use offset::offset_bands;
pub use types::{Point, Polygon, Polyline, TriangulatedMesh};
pub use union::{union_and_triangulate, union_polygons};
