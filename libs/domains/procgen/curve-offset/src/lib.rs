//! Compatibility exports; geometry is canonical in grafting-graph-core.
pub use grafting_graph_core::curve_offset::{
    Point, Polygon, Polyline, TriangulatedMesh, offset_bands, sample_catmull_rom,
    union_and_triangulate,
};
#[cfg(test)]
mod tests;
