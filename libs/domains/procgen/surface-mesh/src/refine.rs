//! Planar triangulation that is allowed to put vertices *inside* the face.
//!
//! **The defect this exists to remove.** Ear clipping invents nothing: it
//! covers a ring using only the ring's own corners. For a compact face that
//! is exactly right and this module never runs. For a long, narrow one -- a
//! ribbon swept along a curve is the standing example -- it is a
//! disfigurement. The only way to cover the middle of a ribbon from its
//! corners alone is to run triangles diagonally from one margin across to
//! the other, so the interior of the surface becomes a linear blend between
//! two points that may be tens of metres apart lengthwise. On level ground
//! nobody notices. On a slope the face visibly twists, and every diagonal
//! that spans a dip pulls the surface down into a trough that the contour
//! itself never had.
//!
//! It is the same failure `upright.rs` already had to answer for a curved
//! wall panel, where the diagonals cut through the cylinder and left a
//! helical crease -- and the answer there was the same one in a different
//! shape: stop asking the triangulator to cover a surface it has no
//! vertices for.
//!
//! **How it is answered here.** The ring is handed to a constrained Delaunay
//! refinement ([`triangulate_constrained`]) instead, which keeps every
//! supplied corner exactly where it is, never crosses the boundary, and
//! fills the interior with real vertices up to a bounded triangle size. A
//! vertex it invents is inside the face and therefore off the contour, so
//! nothing in the graph can say how high it is -- which is why this module
//! runs only when a reference field is present to answer that. The field
//! is also the face's parametrization, so the same call that elevates an
//! invented vertex also gives it a UV.
//!
//! Nothing here knows what kind of surface it is looking at. A face gets an
//! interior when a field claims its corners and its own size warrants one;
//! that is a statement about geometry, and any surface swept from a curve
//! answers it the same way without this module or its caller growing a
//! branch per type.

use grafting_procgen_irregular_grid::constrained::{
    ConstrainedOptions, ConstraintPoint, triangulate_constrained,
};
use grafting_procgen_irregular_grid::mesh::Vec2;

use crate::math::{cross, sub};
use crate::types::{PlanarFill, TriangulatedMesh};

/// Whether `fill`'s field claims every corner of these loops.
///
/// All of them, not most: a field that owns only part of a face would
/// elevate and parametrize that part on a different authority from the
/// rest, and the seam between the two answers is worse than either answer
/// alone. Unanimous or not at all.
pub fn field_owns_loops<'a>(
    fill: &PlanarFill<'_>,
    loops: impl IntoIterator<Item = &'a [[f32; 3]]>,
) -> bool {
    let mut any = false;
    for loop_ in loops {
        for point in loop_ {
            any = true;
            if fill
                .field
                .sample_owned(point[0], point[2], fill.reach_slack)
                .is_none()
            {
                return false;
            }
        }
    }
    any
}

/// The largest triangle the ring could be covered by without any interior
/// vertex at all -- its own area. Below `fill.max_area` the refinement would
/// add nothing, so the cheap boundary-only path is not merely adequate, it
/// is identical, and this is what lets the caller skip straight past.
pub fn needs_interior(outer: &[[f32; 3]], fill: &PlanarFill<'_>) -> bool {
    ground_area(outer) > fill.max_area
}

fn ground_area(ring: &[[f32; 3]]) -> f32 {
    let mut total = 0.0;
    for index in 0..ring.len() {
        let current = ring[index];
        let next = ring[(index + 1) % ring.len()];
        total += current[0] * next[2] - next[0] * current[2];
    }
    (total / 2.0).abs()
}

/// Triangulates `outer` (less `holes`) with interior vertices, elevating and
/// parametrizing everything it invents from `fill`'s field.
///
/// Returns `None` when the constraints cannot be triangulated at all, which
/// the caller reads as "mesh this the way it was meshed before" rather than
/// as a failure -- a degenerate ring mid-edit is a transient state.
pub fn refined_planar_mesh(
    outer: &[[f32; 3]],
    holes: &[&Vec<[f32; 3]>],
    fill: &PlanarFill<'_>,
) -> Option<TriangulatedMesh> {
    if outer.len() < 3 {
        return None;
    }

    // Every supplied corner keeps its own stored position, so the mesh and
    // the graph never drift apart about where a node is. `source` is the
    // index back into this table; the refinement carries it through
    // untouched and reports `None` for anything it made itself.
    let mut supplied: Vec<[f32; 3]> = Vec::new();
    let ring_of = |ring: &[[f32; 3]], supplied: &mut Vec<[f32; 3]>| -> Vec<ConstraintPoint> {
        ring.iter()
            .map(|point| {
                let source = supplied.len() as u32;
                supplied.push(*point);
                ConstraintPoint {
                    position: Vec2::new(point[0] as f64, point[2] as f64),
                    source: Some(source),
                }
            })
            .collect()
    };

    let boundary = vec![ring_of(outer, &mut supplied)];
    let hole_rings = holes
        .iter()
        .filter(|hole| hole.len() >= 3)
        .map(|hole| ring_of(hole, &mut supplied))
        .collect();

    let max_area = fill.max_area.max(1e-3) as f64;
    let triangles = triangulate_constrained(&ConstrainedOptions {
        boundary,
        holes: hole_rings,
        // No lattice to agree with here. The unconstrained generator seeds
        // its own points so the interior matches the rest of the world's
        // spacing; a face swept from a curve has no such neighbour to match,
        // and letting the refinement place every interior vertex itself
        // keeps the result symmetric about the curve rather than about some
        // lattice origin the curve never knew about.
        seeds: Vec::new(),
        seed_clearance: 0.0,
        max_area,
        min_area: max_area * fill.min_area_ratio,
        min_angle_degrees: fill.min_angle_degrees,
        max_additional_vertices: fill.max_additional_vertices,
    })?;

    let mut positions = Vec::with_capacity(triangles.mesh.vertices.len());
    let mut uvs = Vec::with_capacity(triangles.mesh.vertices.len());
    for (vertex, source) in triangles.mesh.vertices.iter().zip(&triangles.sources) {
        let (x, z) = (vertex.x as f32, vertex.y as f32);
        let sample = fill.field.sample(x, z);
        positions.push(match source.and_then(|index| supplied.get(index as usize)) {
            Some(point) => *point,
            // Off the contour, so the graph has no height for it. The field
            // is the only authority that does, and having one is the whole
            // precondition for being here.
            None => [x, sample.map_or(0.0, |sample| sample.y), z],
        });
        uvs.push(sample.map_or([x, z], |sample| [sample.s, sample.t]));
    }

    let mut indices: Vec<u32> = Vec::new();
    for face in &triangles.mesh.faces {
        let [a, b, c] = face[..] else { continue };
        let normal = cross(
            sub(positions[b], positions[a]),
            sub(positions[c], positions[a]),
        );
        // Counter-clockwise in XZ, so the face is lit from the sky like
        // every other horizontal one.
        if normal[1] < 0.0 {
            indices.extend([a as u32, c as u32, b as u32]);
        } else {
            indices.extend([a as u32, b as u32, c as u32]);
        }
    }
    if indices.is_empty() {
        return None;
    }

    Some(TriangulatedMesh {
        normals: vertex_normals(&positions, &indices),
        positions,
        uvs,
        indices,
    })
}

/// Per-vertex normals, area-weighted by the incident triangles.
///
/// One flat normal for the whole face -- what the boundary-only path emits
/// -- is fine for a face that really is flat and wrong for one that follows
/// a curve uphill: the surface shades as though it were level while plainly
/// climbing, which reads as a much deeper dip than the geometry has. Taking
/// the cross product unnormalised weights each triangle by its own area for
/// free, so a sliver cannot outvote the face around it.
fn vertex_normals(positions: &[[f32; 3]], indices: &[u32]) -> Vec<[f32; 3]> {
    let mut normals = vec![[0.0_f32; 3]; positions.len()];
    for triangle in indices.chunks_exact(3) {
        let [a, b, c] = [
            triangle[0] as usize,
            triangle[1] as usize,
            triangle[2] as usize,
        ];
        let weighted = cross(sub(positions[b], positions[a]), sub(positions[c], positions[a]));
        for corner in [a, b, c] {
            for axis in 0..3 {
                normals[corner][axis] += weighted[axis];
            }
        }
    }
    for normal in &mut normals {
        let length = (normal[0].powi(2) + normal[1].powi(2) + normal[2].powi(2)).sqrt();
        *normal = if length > f32::EPSILON {
            [
                normal[0] / length,
                normal[1] / length,
                normal[2] / length,
            ]
        } else {
            [0.0, 1.0, 0.0]
        };
    }
    normals
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::planar::triangulate_contour_loops;
    use grafting_graph_core::curve_offset::{ReferenceCurve, ReferenceField};

    const LENGTH: f32 = 40.0;
    const HALF_WIDTH: f32 = 2.0;
    const STATION: f32 = 4.0;

    /// A run that climbs and drops from one station to the next rather than
    /// smoothly, so a triangle spanning two of them misses the ground
    /// between by a real margin instead of by rounding. This is what a road
    /// crossing rolling terrain does, compressed into a test.
    fn height_at(x: f32) -> f32 {
        if ((x / STATION).round() as i32) % 2 == 0 { 0.0 } else { 3.0 }
    }

    /// The surface the run actually describes: straight ramps between the
    /// stations, which is what both the contour and the field interpolate.
    /// The station heights alone are not the ground truth -- comparing
    /// against those would mark a correct ramp wrong at every midpoint.
    fn true_height(x: f32) -> f32 {
        let station = (x / STATION).floor().clamp(0.0, LENGTH / STATION - 1.0);
        let (from, to) = (station * STATION, (station + 1.0) * STATION);
        let t = ((x - from) / STATION).clamp(0.0, 1.0);
        height_at(from) + (height_at(to) - height_at(from)) * t
    }

    fn stations() -> Vec<f32> {
        (0..=(LENGTH / STATION) as i32)
            .map(|index| index as f32 * STATION)
            .collect()
    }

    /// The ribbon's own boundary: up one margin and back down the other,
    /// exactly what the contour union hands over.
    fn ribbon_ring() -> Vec<[f32; 3]> {
        let mut ring: Vec<[f32; 3]> = stations()
            .iter()
            .map(|&x| [x, height_at(x), -HALF_WIDTH])
            .collect();
        ring.extend(
            stations()
                .iter()
                .rev()
                .map(|&x| [x, height_at(x), HALF_WIDTH]),
        );
        ring
    }

    fn spine_field() -> ReferenceField {
        ReferenceField::new([ReferenceCurve {
            points: stations().iter().map(|&x| [x, height_at(x), 0.0]).collect(),
            reach: HALF_WIDTH,
        }])
    }

    /// The mesh's own height above `(x, z)`, by locating the triangle over
    /// that point and interpolating its corners -- what the eye sees, rather
    /// than what any single vertex says.
    fn surface_height(mesh: &TriangulatedMesh, x: f32, z: f32) -> Option<f32> {
        for triangle in mesh.indices.chunks_exact(3) {
            let [a, b, c] = [
                mesh.positions[triangle[0] as usize],
                mesh.positions[triangle[1] as usize],
                mesh.positions[triangle[2] as usize],
            ];
            let area = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
            if area.abs() < 1e-9 {
                continue;
            }
            let u = ((b[0] - x) * (c[2] - z) - (c[0] - x) * (b[2] - z)) / area;
            let v = ((c[0] - x) * (a[2] - z) - (a[0] - x) * (c[2] - z)) / area;
            let w = 1.0 - u - v;
            if u >= -1e-4 && v >= -1e-4 && w >= -1e-4 {
                return Some(a[1] * u + b[1] * v + c[1] * w);
            }
        }
        None
    }

    /// The worst the mesh misses the run's true height by, swept across the
    /// whole interior rather than checked at one convenient point -- so the
    /// measurement does not depend on which diagonals the triangulator
    /// happened to pick.
    fn worst_height_error(mesh: &TriangulatedMesh) -> f32 {
        let mut worst: f32 = 0.0;
        let mut steps = 0;
        while steps < 400 {
            let x = LENGTH * steps as f32 / 400.0;
            for lane in [-0.5, 0.0, 0.5] {
                if let Some(height) = surface_height(mesh, x, HALF_WIDTH * lane) {
                    worst = worst.max((height - true_height(x)).abs());
                }
            }
            steps += 1;
        }
        worst
    }

    fn fill_at(field: &ReferenceField, max_area: f32) -> PlanarFill<'_> {
        PlanarFill::new(field, max_area)
    }

    #[test]
    fn the_boundary_only_mesh_invents_nothing_and_so_misses_the_ground_between_stations() {
        let ring = ribbon_ring();
        let mesh = triangulate_contour_loops(&ring, std::iter::empty()).unwrap();
        assert_eq!(
            mesh.positions.len(),
            ring.len(),
            "ear clipping adds no vertex, which is the whole problem",
        );
        // Every ramp of the run is straight, and both margins agree on it
        // at every station. Anything the surface does other than follow that
        // ramp is a diagonal spanning two stations, and the depth of that
        // departure is the twist and the trough being measured.
        assert!(
            worst_height_error(&mesh) > 1.0,
            "expected the diagonals to cut well below the run",
        );
    }

    #[test]
    fn refining_follows_the_run_instead_of_spanning_it() {
        let ring = ribbon_ring();
        let field = spine_field();
        let refined = refined_planar_mesh(&ring, &[], &fill_at(&field, 1.0)).unwrap();
        assert!(
            refined.positions.len() > ring.len(),
            "the interior must gain real vertices",
        );
        let error = worst_height_error(&refined);
        assert!(
            error < 0.35,
            "refined surface still misses the run by {error}",
        );
    }

    #[test]
    fn every_supplied_corner_keeps_its_stored_position() {
        let ring = ribbon_ring();
        let field = spine_field();
        let refined = refined_planar_mesh(&ring, &[], &fill_at(&field, 1.0)).unwrap();
        // The mesh and the graph must never disagree about where a node is,
        // so a corner survives refinement untouched rather than being
        // re-derived from the field.
        for corner in &ring {
            assert!(
                refined.positions.iter().any(|position| {
                    (position[0] - corner[0]).abs() < 1e-4
                        && (position[1] - corner[1]).abs() < 1e-4
                        && (position[2] - corner[2]).abs() < 1e-4
                }),
                "corner {corner:?} was moved or dropped",
            );
        }
    }

    #[test]
    fn uvs_measure_along_and_across_the_run() {
        let ring = ribbon_ring();
        let field = spine_field();
        let refined = refined_planar_mesh(&ring, &[], &fill_at(&field, 1.0)).unwrap();
        for (position, uv) in refined.positions.iter().zip(&refined.uvs) {
            // `s` is distance travelled, which on a run laid along +x with
            // stations every 4 m is longer than `x` itself wherever the run
            // climbed -- and never shorter.
            assert!(uv[0] >= position[0] - 1e-3, "s ran backwards of travel");
            assert!(
                uv[1].abs() <= HALF_WIDTH + 1e-3,
                "t left the run's own width",
            );
        }
        let widest = refined.uvs.iter().fold(0.0_f32, |worst, uv| worst.max(uv[1].abs()));
        assert!(widest > HALF_WIDTH - 1e-2, "t never reached the margins");
    }

    #[test]
    fn a_face_the_field_does_not_claim_is_left_to_the_old_path() {
        let ring = ribbon_ring();
        let field = ReferenceField::new([ReferenceCurve {
            points: vec![[0.0, 0.0, 500.0], [LENGTH, 0.0, 500.0]],
            reach: HALF_WIDTH,
        }]);
        let fill = fill_at(&field, 1.0);
        assert!(
            !field_owns_loops(&fill, std::iter::once(ring.as_slice())),
            "a curve half a kilometre away must not claim this face",
        );
    }

    #[test]
    fn a_face_no_bigger_than_one_triangle_skips_refinement_entirely() {
        let ring = ribbon_ring();
        let field = spine_field();
        assert!(needs_interior(&ring, &fill_at(&field, 1.0)));
        assert!(!needs_interior(&ring, &fill_at(&field, 10_000.0)));
    }
}
