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
//! A curved `Surface` (see [`grafting_graph_core::SurfaceCurvature`]) keeps
//! exactly 4 graph-cycle corners, the same as a straight one -- the actual
//! arc only exists here, tessellated into a many-point ring right before
//! triangulation, never persisted back onto the graph. This is the one
//! place `SurfaceCurvature`'s `facets` is ever read.

use earcut::{utils3d, Earcut};

use grafting_graph_core::{ArcBulge, SurfaceCurvature};

/// A triangulated mesh derived from one surface's node cycle. Vertices stay
/// in the caller-supplied cycle order (no Steiner points are introduced for
/// the simple, hole-free polygons this domain produces), so `indices`
/// reference the same order as the input `positions`.
#[derive(Debug, Clone, PartialEq)]
pub struct TriangulatedMesh {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub indices: Vec<u32>,
}

/// Triangulates a simple (hole-free) polygon given by `positions` -- an
/// ordered ring, e.g. `Surface::cycle()`'s node ids resolved to their
/// current graph positions. When `curvature` is given and `positions` is
/// exactly the 4-corner shape [`crate`]'s own doc describes (bottom start,
/// bottom end, top end, top start), the two curved edges are tessellated
/// into a many-point ring first, per `curvature.facets`. Returns `None` for
/// fewer than 3 positions or a degenerate (collinear/zero-area) ring; both
/// are states a caller may see transiently mid-edit, not error conditions
/// to propagate.
pub fn triangulate_surface(positions: &[[f32; 3]], curvature: Option<SurfaceCurvature>) -> Option<TriangulatedMesh> {
    let tessellated;
    let positions = match curvature {
        Some(curvature) if positions.len() == 4 => {
            tessellated = tessellate_curved_quad(positions, curvature);
            tessellated.as_slice()
        }
        _ => positions,
    };

    if positions.len() < 3 {
        return None;
    }

    let mut projected: Vec<[f32; 2]> = Vec::new();
    if !utils3d::project3d_to_2d(positions, positions.len(), &mut projected) {
        return None;
    }

    let mut earcut = Earcut::new();
    let mut indices: Vec<u32> = Vec::new();
    earcut.earcut(projected, &[] as &[u32], &mut indices);
    if indices.is_empty() {
        return None;
    }

    let normal = face_normal(positions).unwrap_or([0.0, 0.0, 1.0]);
    Some(TriangulatedMesh {
        positions: positions.to_vec(),
        normals: vec![normal; positions.len()],
        indices,
    })
}

/// Expands a curved quad's 4 corners (bottom start, bottom end, top end, top
/// start -- [`grafting_procgen_structure_generation::extrusion`]'s own
/// `quad_piece` winding) into a many-point ring: the bottom edge tessellated
/// start-to-end, then the top edge as the same tessellation mirrored at the
/// top's own height and reversed, to close back from end to start. The
/// first/last point of each half is forced back to the exact input corner,
/// so this ring still welds byte-identically at both ends.
fn tessellate_curved_quad(positions: &[[f32; 3]], curvature: SurfaceCurvature) -> Vec<[f32; 3]> {
    let (bottom_start, bottom_end, top_end, top_start) = (positions[0], positions[1], positions[2], positions[3]);

    let bottom_arc = tessellate_arc(bottom_start, bottom_end, curvature.center, curvature.bulge, curvature.facets);
    let mut top_arc: Vec<[f32; 3]> = bottom_arc.iter().rev().map(|point| [point[0], top_end[1], point[2]]).collect();
    if let Some(first) = top_arc.first_mut() {
        *first = top_end;
    }
    if let Some(last) = top_arc.last_mut() {
        *last = top_start;
    }

    let mut ring = bottom_arc;
    ring.extend(top_arc);
    ring
}

/// Tessellates one circular-arc edge into the `facets + 1` points of its own
/// polyline, `start` to `end` in order, around `center` (in the same XZ
/// plane as `start`/`end`). The first and last points are forced to the
/// exact input `start`/`end` (not just approximately equal after the trig
/// round-trip), so a tessellated arc's own endpoints weld byte-identically
/// with whatever straight edge or other arc shares that same corner.
fn tessellate_arc(start: [f32; 3], end: [f32; 3], center: [f32; 2], bulge: ArcBulge, facets: usize) -> Vec<[f32; 3]> {
    let y = start[1];
    let (sx, sz) = (start[0], start[2]);
    let (ex, ez) = (end[0], end[2]);
    let (mx, mz) = (center[0], center[1]);
    let chord_length = ((ex - sx).powi(2) + (ez - sz).powi(2)).sqrt();
    let radius = ((sx - mx).powi(2) + (sz - mz).powi(2)).sqrt();
    let (ux, uz) = ((ex - sx) / chord_length, (ez - sz) / chord_length);
    let (nx, nz) = (-uz, ux);
    let sign: f32 = match bulge {
        ArcBulge::Left => 1.0,
        ArcBulge::Right => -1.0,
    };

    let mut points: Vec<[f32; 3]> = Vec::with_capacity(facets + 1);
    for step in 0..=facets {
        if step == 0 {
            points.push(start);
            continue;
        }
        if step == facets {
            points.push(end);
            continue;
        }
        let t = step as f32 / facets as f32;
        let theta = std::f32::consts::PI * (1.0 - t);
        let x = mx + radius * theta.cos() * ux + sign * radius * theta.sin() * nx;
        let z = mz + radius * theta.cos() * uz + sign * radius * theta.sin() * nz;
        points.push([x, y, z]);
    }
    points
}

/// Flat face normal for shading: the first non-degenerate cross product
/// among triples anchored at `positions[0]`. `project3d_to_2d` already
/// proved the ring is not globally degenerate before this runs, so this is
/// just picking a representative triple, not re-deriving planarity.
fn face_normal(positions: &[[f32; 3]]) -> Option<[f32; 3]> {
    let origin = positions[0];
    for window in positions[1..].windows(2) {
        let cross = cross(sub(window[0], origin), sub(window[1], origin));
        let length = (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]).sqrt();
        if length > f32::EPSILON {
            return Some([cross[0] / length, cross[1] / length, cross[2] / length]);
        }
    }
    None
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fewer_than_three_positions_is_none() {
        assert_eq!(triangulate_surface(&[], None), None);
        assert_eq!(triangulate_surface(&[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]], None), None);
    }

    #[test]
    fn collinear_positions_are_none() {
        let collinear = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]];
        assert_eq!(triangulate_surface(&collinear, None), None);
    }

    #[test]
    fn triangle_produces_one_face() {
        let triangle = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let mesh = triangulate_surface(&triangle, None).expect("valid triangle");
        assert_eq!(mesh.positions, triangle);
        assert_eq!(mesh.normals.len(), 3);
        assert_eq!(mesh.indices.len(), 3);
        for normal in &mesh.normals {
            let length = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
            assert!((length - 1.0).abs() < 1e-4, "normal not unit length: {normal:?}");
        }
    }

    #[test]
    fn axis_aligned_quad_produces_two_faces() {
        let quad = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
        ];
        let mesh = triangulate_surface(&quad, None).expect("valid quad");
        assert_eq!(mesh.positions, quad);
        assert_eq!(mesh.indices.len(), 6, "two triangles = six indices");
        for normal in &mesh.normals {
            assert!(
                (normal[2].abs() - 1.0).abs() < 1e-4,
                "quad in the XY plane should have a Z-aligned normal, got {normal:?}"
            );
        }
    }

    #[test]
    fn concave_hexagon_triangulates_without_fan_artifacts() {
        // An "L"-shaped hexagon: convex fan triangulation from vertex 0
        // would produce a triangle crossing outside the polygon; earcut
        // must not.
        let hexagon = [
            [0.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [2.0, 1.0, 0.0],
            [1.0, 1.0, 0.0],
            [1.0, 2.0, 0.0],
            [0.0, 2.0, 0.0],
        ];
        let mesh = triangulate_surface(&hexagon, None).expect("valid concave hexagon");
        assert_eq!(mesh.positions, hexagon);
        // A simple hexagon triangulates into exactly 4 triangles (n - 2).
        assert_eq!(mesh.indices.len(), 12);
        for index in &mesh.indices {
            assert!((*index as usize) < hexagon.len());
        }
    }

    #[test]
    fn a_curved_quads_four_corners_tessellate_into_a_many_point_ring() {
        // Same 4-corner shape `extrusion.rs::quad_piece` mints for a
        // semicircle edge: bottom start, bottom end, top end, top start.
        let corners = [[0.0, 0.0, 0.0], [4.0, 0.0, 0.0], [4.0, 3.0, 0.0], [0.0, 3.0, 0.0]];
        let curvature = SurfaceCurvature { center: [2.0, 0.0], bulge: ArcBulge::Left, facets: 6 };
        let mesh = triangulate_surface(&corners, Some(curvature)).expect("valid curved quad");
        // 6 facets -> 7 points on the bottom ring, 7 mirrored on top -> 14 positions total.
        assert_eq!(mesh.positions.len(), 14);
        assert_eq!(mesh.positions[0], [0.0, 0.0, 0.0], "bottom ring starts at the edge's own start");
        assert_eq!(mesh.positions[6], [4.0, 0.0, 0.0], "bottom ring ends at the edge's own end");
        assert_eq!(mesh.positions[7], [4.0, 3.0, 0.0], "top ring starts back at the end, mirrored at height");
        assert_eq!(mesh.positions[13], [0.0, 3.0, 0.0], "top ring closes back at the start, mirrored at height");
        assert!(!mesh.indices.is_empty());
    }

    #[test]
    fn curvature_is_ignored_when_positions_are_not_a_four_corner_quad() {
        let triangle = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let curvature = SurfaceCurvature { center: [0.5, 0.0], bulge: ArcBulge::Left, facets: 4 };
        let mesh = triangulate_surface(&triangle, Some(curvature)).expect("valid triangle");
        assert_eq!(mesh.positions, triangle, "curvature only applies to the 4-corner quad shape a curved edge mints");
    }
}
