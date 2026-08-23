//! Turns a construction `Surface`'s node cycle -- an ordered ring of 3D
//! positions -- into a triangulated mesh. `grafting_graph_core::Surface`
//! deliberately does not compute this itself (see its module doc: "turning
//! that into geometry is the caller's job"); this crate is that caller. A
//! pure `positions -> mesh` function, with no dependency on graph-core's
//! storage, matching the isolation `terrain-generation`/`structure-generation`
//! already use for generation-only crates.
//!
//! `ADR-0022` requires arbitrary (not only convex/rectangular) polygon
//! support ("a hexagon, an irregular outline"), so triangulation uses the
//! `earcut` crate (ear-clipping, handles concave simple polygons) rather
//! than a fan, which only triangulates convex/star-shaped rings correctly.
//!
//! A curved face keeps exactly the corners a straight one has -- the arc
//! only exists here, approximated right before triangulation and never
//! persisted back onto the graph. Tessellation resolution is this crate's
//! own fixed [`ARC_TESSELLATION_TOLERANCE`], not a value a caller supplies
//! or the graph stores: controlling render resolution is a rendering
//! concern, not a construction-time one.
//!
//! An **upright** face -- a wall panel, straight or curved -- gets there by
//! being unrolled rather than projected. Its ring does not lie on a plane
//! when it curves, so a best-fit plane folds it onto itself and emits
//! triangles that visibly cut across the surface. But the panel is a
//! developable surface: a section of a cylinder flattens without distortion
//! into "distance along the rail" and "height", and a straight panel is the
//! same map with an infinite radius. Unrolled, it is an ordinary 2D polygon
//! that `earcut` triangulates like any other -- openings included, which a
//! strip built facet by facet could never punch.
//!
//! The 3D positions never move: the unrolled coordinates are where `earcut`
//! works, and `earcut` introduces no vertices of its own. The normals are
//! derived from the frame, per vertex, so a curve shades as a curve.
//!
//! Those unrolled coordinates also leave the crate, as [`TriangulatedMesh`]'s
//! `uvs`. They are metres of the surface's own extent, not a normalised
//! `0..1` box, which is what makes them usable for more than one thing:
//! anything laid out over a surface -- a tiling texture, a course of
//! replicated units -- needs the same origin, the same two directions, and
//! the same extent in metres, so emitting the frame once means both land on
//! the same grid.

pub mod frame;
pub mod math;
pub mod planar;
pub mod tessellation;
pub mod types;
pub mod upright;

#[cfg(test)]
mod tests;

pub use types::{ARC_TESSELLATION_TOLERANCE, TriangulatedMesh, VERTICAL_SIDE_EPSILON};

use grafting_graph_core::{ContourTopology, NodeId, SurfaceRegion};

use math::point_in_loop_xz;
use planar::triangulate_contour_loops;
use tessellation::tessellate_contour_loop;
use upright::upright_face_mesh;

/// Derives transient meshes for every outer loop in an analytic contour
/// region. Lines and circular arcs remain analytic in graph state; this is
/// the first point where an arc is approximated for GPU consumption.
///
/// Holes are assigned to the outer loop that contains their first point in
/// the XZ contour plane. An invalid hole that is outside every outer loop
/// produces `None` rather than a visually plausible but topologically false
/// mesh. Callers resolve node positions from their authoritative graph.
pub fn triangulate_region(
    topology: &ContourTopology,
    region: &SurfaceRegion,
    mut resolve_position: impl FnMut(&NodeId) -> Option<[f32; 3]>,
) -> Option<Vec<TriangulatedMesh>> {
    // An upright face is unrolled, not projected: its ring lies on no plane
    // once it curves, and it carries its own openings through with it. See
    // [`upright_face_mesh`], which reports `None` for anything that is not
    // one, leaving the flat path below exactly as it was.
    if let Some(mesh) = upright_face_mesh(topology, region, &mut resolve_position) {
        return Some(vec![mesh]);
    }

    let outers = region
        .outer_loops()
        .iter()
        .map(|loop_| tessellate_contour_loop(topology, loop_, &mut resolve_position))
        .collect::<Option<Vec<_>>>()?;
    let holes = region
        .holes()
        .iter()
        .map(|loop_| tessellate_contour_loop(topology, loop_, &mut resolve_position))
        .collect::<Option<Vec<_>>>()?;

    // With one outer loop there is nothing to decide: every hole belongs to
    // it, because there is nowhere else for a hole of this region to be.
    // Asking anyway would only add a way to be wrong -- ray casting is
    // unreliable for a point sitting exactly on the boundary it is being
    // tested against.
    //
    // Several disjoint outer loops at once only arise from a merge
    // (unrelated surfaces consumed together, never sharing an edge to
    // collapse into one ring -- see `region_merge.rs`). There a hole really
    // can belong to one piece and not another, and one spanning across
    // them, or landing outside them all, corresponds to no single owner.
    // That must not fail the whole region's mesh -- every
    // cleanly-owned piece still has to render -- so an unresolvable hole is
    // dropped (that piece renders as its own full, unnotched loop) rather
    // than this function returning `None`.
    let owners: Vec<Option<usize>> = holes
        .iter()
        .map(|hole| {
            if outers.len() == 1 {
                return Some(0);
            }
            hole.first().and_then(|point| {
                outers
                    .iter()
                    .position(|outer| point_in_loop_xz([point[0], point[2]], outer))
            })
        })
        .collect();

    outers
        .iter()
        .enumerate()
        .map(|(index, outer)| {
            let owned_holes = holes
                .iter()
                .zip(owners.iter())
                .filter_map(|(hole, owner)| (*owner == Some(index)).then_some(hole));
            triangulate_contour_loops(outer, owned_holes)
        })
        .collect()
}
