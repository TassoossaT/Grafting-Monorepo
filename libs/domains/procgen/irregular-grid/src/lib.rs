//! Townscaper-style irregular quad grid.
//!
//! The substrate buildable ground sits on. The organic quality does not come
//! from any later solve -- it comes from here: pairing triangles at random
//! before quadrangulating gives cells that vary in size and orientation, and
//! relaxation then pulls them back toward squares without restoring the
//! regularity. Build on a plain square grid and it works perfectly and looks
//! like a chessboard.
//!
//! The algorithm follows the sequence documented in Boris The Brave's Sylves
//! tutorial (<https://boristhebrave.com/docs/sylves/1/articles/tutorials/townscaper.html>),
//! itself a walkthrough of Oskar Stalberg's technique. Written from that
//! description rather than adapted from any implementation's source.
//!
//! Ported from `apps/vtt/src/features/edit-construction/topology/irregular-grid.ts`,
//! which it replaces. Bit-for-bit compatible on the unconstrained path
//! (see [`random::Random`]) so ground already generated keeps generating the
//! same way.
//!
//! **The five steps**, and why the first one is now pluggable:
//!
//! ```text
//! triangulate -> pair into rhombi -> ortho -> weld -> relax
//! ```
//!
//! Steps 2 to 5 are what makes the grid look the way it does, and they are
//! indifferent to where the triangles came from. Step 1 is not: a stroke on
//! empty ground wants the equilateral hexagon lattice ([`hex`]), while ground
//! that has to meet contours another cloud already committed to wants those
//! contours held as edges no triangle may cross ([`constrained`]).
//!
//! That split is the whole reason this crate exists as one piece rather than
//! two. Regenerating ground around a road is not a repair with its own
//! algorithm -- it is this same pipeline, with the road's contour named as a
//! constraint. Creation and regeneration are one code path or they drift.

pub mod constrained;
pub mod hex;
pub mod mesh;
pub mod ortho;
pub mod pair;
pub mod random;
pub mod relax;

pub use hex::{TriangleHexOptions, build_triangle_hex};
pub use mesh::{Face, FaceMesh, Quad, QuadMesh, Vec2};
pub use random::Random;
pub use relax::{RelaxOptions, boundary_vertices, relax};

/// The epsilon [`ortho::weld`] merges coincident vertices at.
///
/// Well below any distance the pipeline itself produces between two vertices
/// that are meant to be distinct, and well above the float noise between two
/// that are meant to be one.
pub const WELD_EPSILON: f64 = 1e-6;

/// Everything [`build_irregular_quad_grid`] needs.
#[derive(Debug, Clone)]
pub struct IrregularQuadGridOptions {
    pub seed: u32,
    pub hex: TriangleHexOptions,
    pub relax: RelaxOptions,
}

/// Runs the five steps in order, unconstrained. The whole technique, start to
/// finish, for ground with nothing already standing near it.
pub fn build_irregular_quad_grid(options: &IrregularQuadGridOptions) -> QuadMesh {
    let mut random = Random::new(options.seed);
    let triangles = build_triangle_hex(options.hex);
    build_from_triangles(&triangles, &mut random, &options.relax)
}

/// Steps 2 to 5 -- the part that is the same however the triangles arrived.
///
/// Public because [`constrained`] produces its triangles a different way and
/// then wants exactly this, and because keeping the shared tail in one place
/// is what stops the constrained path from quietly becoming a second grid
/// generator with its own aesthetic.
pub fn build_from_triangles(
    triangles: &FaceMesh,
    random: &mut Random,
    relax_options: &RelaxOptions,
) -> QuadMesh {
    let paired = pair::pair_triangles(triangles, random);
    let quadrangulated = ortho::ortho(&paired);
    let welded = ortho::weld(&quadrangulated, WELD_EPSILON);
    relax(&welded, relax_options)
}

/// A grid, and what each of its corners already is.
#[derive(Debug, Clone)]
pub struct ConstrainedQuadGrid {
    pub mesh: QuadMesh,
    /// Index-aligned with `mesh.vertices`: the caller own identity for that
    /// corner, where it had one. `None` is new ground.
    pub sources: Vec<Option<u32>>,
    /// Indices of corners that sit *on* a contour the caller supplied but
    /// arrived with no source of their own.
    ///
    /// These are the nodes the owning cloud has to accept along its own
    /// boundary. Two things make them: the refinement splitting a constraint
    /// segment, and `ortho` putting a midpoint on every edge it quadrangulates
    /// -- a contour edge included. Both are wanted. The alternative to a
    /// shared node here is a terrain corner resting against the middle of a
    /// road edge without sharing it, which is the T-junction that reads as a
    /// gap along the path.
    pub on_contour: Vec<usize>,
    /// `false` where the refinement stopped at its vertex budget.
    pub refinement_complete: bool,
}

/// The whole technique against contours somebody else already owns.
///
/// The same five steps as [`build_irregular_quad_grid`], differing only in
/// where step 1 gets its triangles -- which is the point. Ground created on
/// empty land and ground regenerated around a road that moved are not two
/// algorithms that must be kept in agreement; they are this one call with a
/// different set of constraints.
///
/// Every corner sitting on a contour is pinned through relaxation, at the
/// position the triangulation put it. Relaxing them with everything else
/// would pull the ground off the road it was just made to meet -- by a
/// little, which is worse than by a lot, because a seam that is nearly right
/// still renders as a crack and no longer reads as a bug in the fill.
pub fn build_constrained_quad_grid(
    options: &constrained::ConstrainedOptions,
    seed: u32,
    relax_options: &RelaxOptions,
) -> Option<ConstrainedQuadGrid> {
    let triangles = constrained::triangulate_constrained(options)?;
    let mut random = Random::new(seed);

    let paired = pair::pair_triangles(&triangles.mesh, &mut random);
    let quadrangulated = ortho::ortho(&paired);
    // `ortho` copies the triangulation vertices through unchanged and appends
    // its own centres and midpoints, so an index below the original count
    // still means what it meant.
    let mut before_weld = triangles.sources.clone();
    before_weld.resize(quadrangulated.vertices.len(), None);

    let (welded, remap) = ortho::weld_tracked(&quadrangulated, WELD_EPSILON);
    let mut sources: Vec<Option<u32>> = vec![None; welded.vertices.len()];
    for (before, source) in before_weld.iter().enumerate() {
        if let Some(id) = source {
            sources[remap[before]] = Some(*id);
        }
    }

    let on_contour: Vec<usize> = (0..welded.vertices.len())
        .filter(|&index| {
            sources[index].is_none()
                && constrained::lies_on_a_contour(options, welded.vertices[index], WELD_EPSILON)
        })
        .collect();

    let mut pinned = relax_options.clone();
    for index in on_contour.iter().copied().chain(
        (0..welded.vertices.len()).filter(|&index| sources[index].is_some()),
    ) {
        pinned.pinned_targets.insert(index, welded.vertices[index]);
    }

    Some(ConstrainedQuadGrid {
        mesh: relax(&welded, &pinned),
        sources,
        on_contour,
        refinement_complete: triangles.refinement_complete,
    })
}
