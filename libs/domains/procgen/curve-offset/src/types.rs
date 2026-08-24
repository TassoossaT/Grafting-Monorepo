//! Data structures for curve/offset/union geometry.

/// A point on the plane the caller is working in. Height is not this
/// crate's concern -- a caller that rides terrain or spans a deck
/// interpolates elevation separately, the same way `apps/vtt`'s
/// `sweep-formation.ts` already keeps height off its own reference line's
/// planar math.
pub type Point = [f32; 2];

/// An ordered, open sequence of points -- a curve already flattened to
/// straight segments.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Polyline {
    pub points: Vec<Point>,
}

/// A simple closed ring plus any holes it encloses.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Polygon {
    pub outer: Vec<Point>,
    pub holes: Vec<Vec<Point>>,
}

/// A flat 2D triangulated mesh: no separate `normals`/`uvs`, unlike
/// `grafting-procgen-surface-mesh`'s `TriangulatedMesh` -- those are a
/// world-position concern a caller adds once the union's own planar shape
/// has been decided.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TriangulatedMesh {
    pub positions: Vec<Point>,
    pub indices: Vec<u32>,
}
