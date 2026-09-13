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

/// What a planar face may put *inside* itself, and on whose authority.
///
/// Absent, a face is covered from its own corners alone -- ear clipping,
/// which is exactly right for a compact face and disfigures a long narrow
/// one (see [`crate::refine`]). Present, the face is refined to a bounded
/// triangle size and every vertex the refinement invents is elevated and
/// parametrized by `field`.
///
/// The field is the precondition, not a decoration: an interior vertex is
/// off the contour, so the graph holds no height for it, and inventing one
/// is how a surface acquires shape nobody authored.
#[derive(Debug, Clone, Copy)]
pub struct PlanarFill<'a> {
    /// The curves the face was swept from -- its height and `(s, t)`
    /// authority, and the thing that decides whether the face is its at all.
    pub field: &'a grafting_graph_core::curve_offset::ReferenceField,
    /// Largest triangle left standing, in world units squared. A face
    /// smaller than this gains nothing from refinement and skips it.
    pub max_area: f32,
    /// Smallest triangle worth improving, as a fraction of [`Self::max_area`]
    /// -- the guard against two contours running close and near-parallel,
    /// where local feature size collapses and an unfloored refinement fills
    /// the wedge with slivers.
    pub min_area_ratio: f64,
    /// Smallest angle the refinement leaves standing. Ruppert only
    /// terminates provably below about 20.7 degrees.
    pub min_angle_degrees: f64,
    /// Hard ceiling on invented points, so a pathological contour costs a
    /// coarser mesh rather than an unbounded loop.
    pub max_additional_vertices: usize,
    /// Multiplier on each curve's own reach when deciding whether the field
    /// claims a corner, absorbing a mitre or a union vertex sitting a hair
    /// outside the swept width.
    pub reach_slack: f32,
    /// Spacing, in world units, of the `(s, t)` lattice the interior is
    /// seeded with -- the length of a quad along the curve and across it.
    ///
    /// Seeding rather than letting the refinement place its own points is
    /// what makes the interior a *strip*: rows that follow the curve and
    /// columns that cross it, so every triangle is local in both directions
    /// and a slope is followed station by station instead of spanned. Where
    /// two curves meet, their lattices overlap and the triangulation makes
    /// the patch between them out of what is already there, which is a
    /// junction for free.
    ///
    /// Zero disables seeding, leaving the unstructured refinement that was
    /// here before.
    pub station_step: f32,
    /// Ceiling on lattice points, so a very long or very wide field costs a
    /// coarser interior rather than an unbounded one.
    pub max_lattice_points: usize,
    /// How far the field's height may vary across a face before the face is
    /// worth giving an interior at all, in world units.
    ///
    /// A level face gains nothing: its corners already say everything there
    /// is to say about where the surface is, ear clipping puts no vertex
    /// anywhere the surface is not, and refining it buys triangles and
    /// nothing else. The defect being answered here is a face that *follows*
    /// something -- a run crossing a slope, where covering the middle from
    /// the margins alone twists it -- so this is the test for whether there
    /// is anything to follow. A flat map pays the cost of sampling its
    /// corners and nothing more.
    pub min_relief: f32,
}

impl<'a> PlanarFill<'a> {
    /// A fill on `field` at `max_area`, with the refinement settings the
    /// constrained ground generator already runs at -- same triangulator,
    /// same tuning, so a face and the ground beside it are meshed to
    /// comparable density rather than to two unrelated opinions.
    pub fn new(
        field: &'a grafting_graph_core::curve_offset::ReferenceField,
        max_area: f32,
    ) -> Self {
        Self {
            field,
            max_area,
            min_area_ratio: 0.25,
            min_angle_degrees: 20.5,
            max_additional_vertices: 2_500,
            reach_slack: 1.25,
            // A metre square: a few of them fit across an ordinary run,
            // which is what it takes for the surface to follow a slope
            // rather than span it, and coarse enough that a long run stays
            // well inside the vertex budget.
            station_step: 1.0,
            max_lattice_points: 4_000,
            // Two centimetres over a whole face is flat for any purpose a
            // mesh has, and well above the noise a curve's own flattening
            // leaves behind.
            min_relief: 0.02,
        }
    }
}

/// A triangulated mesh derived from one surface's node cycle. Vertices stay
/// in the caller-supplied cycle order wherever the contour alone can carry
/// the surface, so `indices` reference the same order as the input
/// `positions`. The exception is a curved panel with an opening: that one is
/// filled with a uniform mesh whose interior vertices exist only here, so
/// `positions` is longer than the contour and in the mesher's own order.
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
    /// An upright face measures along its rail and up. A flat one measures
    /// along and across the curve it was swept from -- `(s, t)`, from its
    /// [`PlanarFill`] field -- or, with no such curve, in world `x` and `z`.
    /// All three anchor on something the graph already fixes, so re-deriving
    /// a mesh yields the same coordinates and neighbours that share an anchor
    /// agree across the edge between them.
    ///
    /// `(s, t)` is the one worth building on. World `xz` is the face's
    /// *shadow*: it foreshortens wherever the surface is not level and says
    /// nothing about where along a run a point sits. Distance travelled and
    /// distance off, in metres, is the coordinate anything laid out over the
    /// surface actually wants -- a course of replicated units, a marking, a
    /// structure placed at a station -- and it survives the surface being
    /// rebuilt, refined differently or widened, which a vertex index does
    /// not.
    pub uvs: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
}
