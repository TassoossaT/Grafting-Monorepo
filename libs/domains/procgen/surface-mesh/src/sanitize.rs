//! A flat face whose loops cannot be triangulated as given -- a loop that
//! crosses itself, or one collapsed to fewer than three distinct points --
//! resolved into simple pieces and meshed from those.
//!
//! The loops are read under the non-zero fill rule, the same one every
//! other planar boolean here uses: outer loops are unioned, holes are
//! subtracted, and what remains is a set of simple polygons with holes.
//! Degenerate loops enclose nothing and simply drop out. The face is read
//! in its own best-fit plane, so an upright face resolves as a flat one does.

use earcut::Earcut;
use grafting_graph_core::{
    ContourTopology, NodeId, PlanarBoolean, PlanarShape, SurfaceRegion, planar_boolean,
};

use crate::math::{cross, dot, sub};
use crate::tessellation::tessellate_contour_loop;
use crate::types::TriangulatedMesh;

fn orientation(a: [f32; 2], b: [f32; 2], c: [f32; 2]) -> f32 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

fn crosses(a: [f32; 2], b: [f32; 2], c: [f32; 2], d: [f32; 2]) -> bool {
    orientation(a, b, c) * orientation(a, b, d) < 0.0
        && orientation(c, d, a) * orientation(c, d, b) < 0.0
}

/// The plane a face is resolved in. A face whose best-fit plane faces more
/// up than sideways is read in world XZ with Y as its height; any other is
/// read in its own plane, with the offset along its normal as its height.
#[derive(Clone, Copy)]
enum Frame {
    Ground,
    Plane {
        origin: [f32; 3],
        u: [f32; 3],
        v: [f32; 3],
        n: [f32; 3],
    },
}

fn best_fit_normal(points: &[[f32; 3]]) -> Option<[f32; 3]> {
    if points.len() < 3 {
        return None;
    }
    let count = points.len() as f32;
    let centroid = points.iter().fold([0.0; 3], |sum, p| {
        [
            sum[0] + p[0] / count,
            sum[1] + p[1] / count,
            sum[2] + p[2] / count,
        ]
    });
    let (mut xx, mut xy, mut xz, mut yy, mut yz, mut zz) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    for point in points {
        let r = sub(*point, centroid);
        xx += r[0] * r[0];
        xy += r[0] * r[1];
        xz += r[0] * r[2];
        yy += r[1] * r[1];
        yz += r[1] * r[2];
        zz += r[2] * r[2];
    }
    let det_x = yy * zz - yz * yz;
    let det_y = xx * zz - xz * xz;
    let det_z = xx * yy - xy * xy;
    let det_max = det_x.max(det_y).max(det_z);
    if !(det_max > 0.0) {
        return None;
    }
    let direction = if det_max == det_x {
        [det_x, xz * yz - xy * zz, xy * yz - xz * yy]
    } else if det_max == det_y {
        [xz * yz - xy * zz, det_y, xy * xz - yz * xx]
    } else {
        [xy * yz - xz * yy, xy * xz - yz * xx, det_z]
    };
    normalize(direction)
}

fn normalize(a: [f32; 3]) -> Option<[f32; 3]> {
    let length = dot(a, a).sqrt();
    (length.is_finite() && length > f32::EPSILON)
        .then(|| [a[0] / length, a[1] / length, a[2] / length])
}

fn newell(ring: &[[f32; 3]]) -> [f32; 3] {
    let mut sum = [0.0; 3];
    for index in 0..ring.len() {
        let (a, b) = (ring[index], ring[(index + 1) % ring.len()]);
        sum[0] += (a[1] - b[1]) * (a[2] + b[2]);
        sum[1] += (a[2] - b[2]) * (a[0] + b[0]);
        sum[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    sum
}

impl Frame {
    fn of(rings: &[&[[f32; 3]]]) -> Frame {
        let points: Vec<[f32; 3]> = rings.iter().flat_map(|ring| ring.iter().copied()).collect();
        let Some(mut n) = best_fit_normal(&points) else {
            return Frame::Ground;
        };
        if n[1].abs() >= n[0].abs() && n[1].abs() >= n[2].abs() {
            return Frame::Ground;
        }
        let facing = rings.iter().fold([0.0; 3], |sum, ring| {
            let r = newell(ring);
            [sum[0] + r[0], sum[1] + r[1], sum[2] + r[2]]
        });
        if dot(facing, n) < 0.0 {
            n = [-n[0], -n[1], -n[2]];
        }
        let Some(u) = normalize(cross([0.0, 1.0, 0.0], n)) else {
            return Frame::Ground;
        };
        Frame::Plane {
            origin: points[0],
            u,
            v: cross(n, u),
            n,
        }
    }

    fn flat(self, point: [f32; 3]) -> [f32; 2] {
        match self {
            Frame::Ground => [point[0], point[2]],
            Frame::Plane { origin, u, v, .. } => {
                let r = sub(point, origin);
                [dot(r, u), dot(r, v)]
            }
        }
    }

    fn height(self, point: [f32; 3]) -> f32 {
        match self {
            Frame::Ground => point[1],
            Frame::Plane { origin, n, .. } => dot(sub(point, origin), n),
        }
    }

    fn place(self, flat: [f32; 2], height: f32) -> [f32; 3] {
        match self {
            Frame::Ground => [flat[0], height, flat[1]],
            Frame::Plane { origin, u, v, n } => std::array::from_fn(|axis| {
                origin[axis] + u[axis] * flat[0] + v[axis] * flat[1] + n[axis] * height
            }),
        }
    }

    fn normal(self) -> [f32; 3] {
        match self {
            Frame::Ground => [0.0, 1.0, 0.0],
            Frame::Plane { n, .. } => n,
        }
    }

    fn needs_swap(self, orientation: f32) -> bool {
        match self {
            Frame::Ground => orientation > 0.0,
            Frame::Plane { .. } => orientation < 0.0,
        }
    }
}

/// Whether any ring has two non-adjacent segments properly crossing in its
/// own best-fit plane. Touching at a shared point is not a crossing.
pub fn any_self_crossing<'a>(rings: impl IntoIterator<Item = &'a Vec<[f32; 3]>>) -> bool {
    rings.into_iter().any(|ring| ring_self_crosses(ring))
}

fn ring_self_crosses(ring: &[[f32; 3]]) -> bool {
    let count = ring.len();
    if count < 4 {
        return false;
    }
    let frame = Frame::of(&[ring]);
    let flat: Vec<[f32; 2]> = ring.iter().map(|point| frame.flat(*point)).collect();
    let point = |index: usize| flat[index % count];
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

fn flat_ring(ring: &[[f32; 3]], frame: Frame) -> Option<Vec<[f32; 2]>> {
    let mut out: Vec<[f32; 2]> = Vec::with_capacity(ring.len());
    for point in ring {
        let flat = frame.flat(*point);
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
fn lift(point: [f32; 2], sources: &[Vec<[f32; 3]>], frame: Frame) -> f32 {
    let mut best = (f32::INFINITY, 0.0);
    for ring in sources {
        for index in 0..ring.len() {
            let (start, end) = (ring[index], ring[(index + 1) % ring.len()]);
            let (a, b) = (frame.flat(start), frame.flat(end));
            let (rise_a, rise_b) = (frame.height(start), frame.height(end));
            let d = [b[0] - a[0], b[1] - a[1]];
            let length_sq = d[0] * d[0] + d[1] * d[1];
            let t = if length_sq <= f32::EPSILON {
                0.0
            } else {
                (((point[0] - a[0]) * d[0] + (point[1] - a[1]) * d[1]) / length_sq).clamp(0.0, 1.0)
            };
            let (x, z) = (a[0] + d[0] * t, a[1] + d[1] * t);
            let distance = (point[0] - x).powi(2) + (point[1] - z).powi(2);
            if distance < best.0 {
                best = (distance, rise_a + (rise_b - rise_a) * t);
            }
        }
    }
    best.1
}

fn component_mesh(
    shape: &PlanarShape,
    sources: &[Vec<[f32; 3]>],
    frame: Frame,
) -> Option<TriangulatedMesh> {
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
    // Wound so the face looks along its frame's normal: up, for a ground
    // face, as the ordinary planar path winds it.
    for triangle in indices.chunks_exact_mut(3) {
        let [a, b, c] = [triangle[0], triangle[1], triangle[2]].map(|index| flat[index as usize]);
        if frame.needs_swap(orientation([a[0], a[1]], [b[0], b[1]], [c[0], c[1]])) {
            triangle.swap(1, 2);
        }
    }
    let positions: Vec<[f32; 3]> = flat
        .iter()
        .map(|p| frame.place(*p, lift(*p, sources, frame)))
        .collect();
    Some(TriangulatedMesh {
        normals: vec![frame.normal(); positions.len()],
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
    let frame = Frame::of(&outers.iter().map(Vec::as_slice).collect::<Vec<_>>());
    let subject: Vec<PlanarShape> = outers
        .iter()
        .filter_map(|ring| flat_ring(ring, frame))
        .map(|ring| vec![ring])
        .collect();
    if subject.is_empty() {
        return None;
    }
    let clip: Vec<PlanarShape> = holes
        .iter()
        .filter_map(|ring| flat_ring(ring, frame))
        .map(|ring| vec![ring])
        .collect();
    let mut pieces = planar_boolean(&subject, &[], PlanarBoolean::Union).ok()?;
    if !clip.is_empty() && !pieces.is_empty() {
        pieces = planar_boolean(&pieces, &clip, PlanarBoolean::Difference).ok()?;
    }
    let sources: Vec<Vec<[f32; 3]>> = outers.into_iter().chain(holes).collect();
    let meshes: Vec<TriangulatedMesh> = pieces
        .iter()
        .filter_map(|shape| component_mesh(shape, &sources, frame))
        .collect();
    (!meshes.is_empty()).then_some(meshes)
}
