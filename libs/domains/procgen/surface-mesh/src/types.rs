//! Data structures and tolerances for surface mesh generation.

/// Maximum deviation, in world units, between a tessellated arc's chords and
/// the true circle they approximate -- see this crate's top-level doc for why
/// this is a fixed constant here rather than a caller-supplied value: nothing
/// upstream of rendering has a legitimate reason to care about tessellation
/// resolution.
pub const ARC_TESSELLATION_TOLERANCE: f32 = 0.03;

/// How far apart, in world units, an edge's two endpoints may be in XZ and
/// still count as one upright side for `upright_face_mesh`. Only ever
/// compared against values that are meant to be exactly equal (the same
/// contour point at two heights), so this absorbs float round-trip drift,
/// not any real slant.
pub const VERTICAL_SIDE_EPSILON: f32 = 1e-4;

/// A triangulated mesh derived from one surface's node cycle. Vertices stay
/// in the caller-supplied cycle order (no Steiner points are introduced for
/// the simple, hole-free polygons this domain produces), so `indices`
/// reference the same order as the input `positions`.
#[derive(Debug, Clone, PartialEq)]
pub struct TriangulatedMesh {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    /// Where each vertex sits on the surface's own flat extent, **in world
    /// units** -- not normalised to `0..1`.
    ///
    /// Metres rather than a unit box is the whole point. A normalised box
    /// stretches: the same texture would cover a 2 m panel and a 10 m one
    /// identically, so a caller would have to undo the normalisation with the
    /// panel's size to get a uniform result, and two panels meeting at a
    /// corner would disagree about where the pattern is. In metres, scale is
    /// uniform everywhere for free, and a caller divides by whatever its own
    /// tile size happens to be.
    ///
    /// An upright face measures along its rail and up; a flat one measures in
    /// world `x` and `z`. Both anchor on something the graph already fixes, so
    /// re-deriving a mesh yields the same coordinates and neighbours that share
    /// an anchor agree across the edge between them.
    pub uvs: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
}
