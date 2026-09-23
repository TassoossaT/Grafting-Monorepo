//! A flat face whose loops cannot be triangulated as given -- a loop that
//! crosses itself, or one collapsed to fewer than three distinct points --
//! resolved into simple pieces and meshed from those.
//!
//! The loops are read under the non-zero fill rule, the same one every
//! other planar boolean here uses: outer loops are unioned, holes are
//! subtracted, and what remains is a set of simple polygons with holes.
//! Degenerate loops enclose nothing and simply drop out.

use earcut::Earcut;
use grafting_graph_core::{
    ContourTopology, NodeId, PlanarBoolean, PlanarShape, SurfaceRegion, planar_boolean,
};

use crate::tessellation::tessellate_contour_loop;
use crate::types::TriangulatedMesh;

fn orientation(a: [f32; 2], b: [f32; 2], c: [f32; 2]) -> f32 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

fn crosses(a: [f32; 2], b: [f32; 2], c: [f32; 2], d: [f32; 2]) -> bool {
    orientation(a, b, c) * orientation(a, b, d) < 0.0
        && orientation(c, d, a) * orientation(c, d, b) < 0.0
}

/// Whether any ring has two non-adjacent segments properly crossing in XZ.
/// Touching at a shared point is not a crossing.
pub fn any_self_crossing<'a>(rings: impl IntoIterator<Item = &'a Vec<[f32; 3]>>) -> bool {
    rings.into_iter().any(|ring| ring_self_crosses(ring))
}

fn ring_self_crosses(ring: &[[f32; 3]]) -> bool {
    let count = ring.len();
    if count < 4 {
        return false;
    }
    let point = |index: usize| [ring[index % count][0], ring[index % count][2]];
    let mut segments: Vec<(f32, f32, usize)> = (0..count)
        .map(|index| {
            let (a, b) = (point(index), point(index + 1));
            (a[0].min(b[0]), a[0].max(b[0]), index)
        })
        .collect();
    segments.sort_by(|x, y| x.0.total_cmp(&y.0));
    for (position, &(_, max_x, i)) in segments.iter().enumerate() {
        for &(min_x, _, j) in &segments[position + 1..] {
            if min_x > max_x {
                break;
            }
            let adjacent = i.abs_diff(j) == 1 || i.abs_diff(j) == count - 1;
            if !adjacent && crosses(point(i), point(i + 1), point(j), point(j + 1)) {
                return true;
            }
        }
    }
    false
}

fn flat_ring(ring: &[[f32; 3]]) -> Option<Vec<[f32; 2]>> {
    let mut out: Vec<[f32; 2]> = Vec::with_capacity(ring.len());
    for point in ring {
        let flat = [point[0], point[2]];
        if flat.iter().any(|value| !value.is_finite()) {
            return None;
        }
        if out.last() != Some(&flat) {
            out.push(flat);
        }
    }
    if out.len() > 1 && out.first() == out.last() {
        out.pop();
    }
    // Unsigned, so a bow tie whose lobes cancel is still kept; only a ring
    // with every point on one line encloses nothing.
    let spread: f32 = out
        .windows(2)
        .skip(1)
        .map(|pair| orientation(out[0], pair[0], pair[1]).abs())
        .sum();
    (out.len() >= 3 && spread > f32::EPSILON).then_some(out)
}

/// The height at `point` read off the nearest source segment, so a vertex
/// the boolean invents on a crossing sits on the loops it came from.
fn lift(point: [f32; 2], sources: &[Vec<[f32; 3]>]) -> f32 {
    let mut best = (f32::INFINITY, 0.0);
    for ring in sources {
        for index in 0..ring.len() {
            let (a, b) = (ring[index], ring[(index + 1) % ring.len()]);
            let d = [b[0] - a[0], b[2] - a[2]];
            let length_sq = d[0] * d[0] + d[1] * d[1];
            let t = if length_sq <= f32::EPSILON {
                0.0
            } else {
                (((point[0] - a[0]) * d[0] + (point[1] - a[2]) * d[1]) / length_sq).clamp(0.0, 1.0)
            };
            let (x, z) = (a[0] + d[0] * t, a[2] + d[1] * t);
            let distance = (point[0] - x).powi(2) + (point[1] - z).powi(2);
            if distance < best.0 {
                best = (distance, a[1] + (b[1] - a[1]) * t);
            }
        }
    }
    best.1
}

fn component_mesh(shape: &PlanarShape, sources: &[Vec<[f32; 3]>]) -> Option<TriangulatedMesh> {
    let mut flat = Vec::new();
    let mut hole_indices = Vec::new();
    for (index, ring) in shape.iter().enumerate() {
        if index > 0 {
            hole_indices.push(flat.len() as u32);
        }
        flat.extend(ring.iter().copied());
    }
    let mut indices: Vec<u32> = Vec::new();
    Earcut::new().earcut(flat.iter().copied(), &hole_indices, &mut indices);
    if indices.is_empty() {
        return None;
    }
    // Wound so the face looks up, as the ordinary planar path winds it.
    for triangle in indices.chunks_exact_mut(3) {
        let [a, b, c] = [triangle[0], triangle[1], triangle[2]].map(|index| flat[index as usize]);
        if orientation([a[0], a[1]], [b[0], b[1]], [c[0], c[1]]) > 0.0 {
            triangle.swap(1, 2);
        }
    }
    let positions: Vec<[f32; 3]> = flat
        .iter()
        .map(|p| [p[0], lift(*p, sources), p[1]])
        .collect();
    Some(TriangulatedMesh {
        normals: vec![[0.0, 1.0, 0.0]; positions.len()],
        uvs: flat,
        positions,
        indices,
    })
}

/// Meshes a flat face through the boolean resolution described above.
/// `None` when nothing with area is left.
pub fn sanitized_planar_meshes(
    topology: &ContourTopology,
    region: &SurfaceRegion,
    resolve_position: &mut impl FnMut(&NodeId) -> Option<[f32; 3]>,
) -> Option<Vec<TriangulatedMesh>> {
    let mut tessellate = |loops: &[grafting_graph_core::ContourLoop]| -> Vec<Vec<[f32; 3]>> {
        loops
            .iter()
            .filter_map(|loop_| tessellate_contour_loop(topology, loop_, resolve_position))
            .collect()
    };
    let outers = tessellate(region.outer_loops());
    let holes = tessellate(region.holes());
    let subject: Vec<PlanarShape> = outers
        .iter()
        .filter_map(|ring| flat_ring(ring))
        .map(|ring| vec![ring])
        .collect();
    if subject.is_empty() {
        return None;
    }
    let clip: Vec<PlanarShape> = holes
        .iter()
        .filter_map(|ring| flat_ring(ring))
        .map(|ring| vec![ring])
        .collect();
    let mut pieces = planar_boolean(&subject, &[], PlanarBoolean::Union).ok()?;
    if !clip.is_empty() && !pieces.is_empty() {
        pieces = planar_boolean(&pieces, &clip, PlanarBoolean::Difference).ok()?;
    }
    let sources: Vec<Vec<[f32; 3]>> = outers.into_iter().chain(holes).collect();
    let meshes: Vec<TriangulatedMesh> = pieces
        .iter()
        .filter_map(|shape| component_mesh(shape, &sources))
        .collect();
    (!meshes.is_empty()).then_some(meshes)
}
