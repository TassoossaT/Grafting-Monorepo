//! An upright face as a host other geometry is placed on in relative
//! coordinates, and the mesh left once that geometry is cut out of it.
//!
//! Both read the face through the same [`upright_structure`] frame the
//! mesher unrolls it with, so a point placed at `(u, v)` and the cut made
//! around it land exactly where the face itself is drawn.
//!
//! `u` runs along the base run's travel, `v` up the face's *local* height
//! at that travel -- from the base run to the top run directly above it --
//! so a slanted or uneven top deforms whatever is placed on it rather than
//! letting it poke out.

use earcut::Earcut;
use grafting_graph_core::{
    ContourEdge, ContourEdgeId, ContourTopology, NodeId, PlanarBoolean, PlanarShape, SurfaceRegion, planar_boolean,
};
use i_triangle::float::uniform::UniformTriangulatable;

use crate::frame::UnrollFrame;
use crate::math::{dot, winding_normal};
use crate::tessellation::tessellate_contour_loop;
use crate::types::{ARC_TESSELLATION_TOLERANCE, TriangulatedMesh};
use crate::upright::{upright_face_mesh, upright_structure};

/// Unrolled area below which a cut is treated as having removed nothing.
const NEGLIGIBLE_CUT_AREA: f32 = 1e-5;

/// An upright face's unrolled extent: its frame plus the base and top runs
/// as `(travel, height)` polylines sorted by travel.
#[derive(Debug, Clone)]
pub struct HostFace {
    pub frame: UnrollFrame,
    base: Vec<[f32; 2]>,
    top: Vec<[f32; 2]>,
    travel: [f32; 2],
    sides: [ContourEdgeId; 2],
}

fn run_points(edges: &[(ContourEdge, [f32; 3], [f32; 3])]) -> Option<Vec<[f32; 3]>> {
    let mut points = Vec::new();
    for (edge, start, end) in edges {
        let planar = edge.tessellate(
            [start[0], start[2]],
            [end[0], end[2]],
            ARC_TESSELLATION_TOLERANCE,
        );
        if planar.len() < 2 {
            return None;
        }
        for (index, point) in planar.iter().enumerate() {
            let t = index as f32 / (planar.len() - 1) as f32;
            points.push([point[0], start[1] + (end[1] - start[1]) * t, point[1]]);
        }
    }
    Some(points)
}

fn height_at(run: &[[f32; 2]], travel: f32) -> f32 {
    let (Some(first), Some(last)) = (run.first(), run.last()) else {
        return 0.0;
    };
    if travel <= first[0] {
        return first[1];
    }
    if travel >= last[0] {
        return last[1];
    }
    for pair in run.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        if travel <= b[0] {
            let span = b[0] - a[0];
            if span <= f32::EPSILON {
                return b[1];
            }
            return a[1] + (b[1] - a[1]) * (travel - a[0]) / span;
        }
    }
    last[1]
}

impl HostFace {
    /// `None` for anything that does not mesh as an upright face.
    pub fn of(
        topology: &ContourTopology,
        region: &SurfaceRegion,
        resolve_position: &mut impl FnMut(&NodeId) -> Option<[f32; 3]>,
    ) -> Option<Self> {
        if region.profile().is_some() {
            return None;
        }
        let [outer_loop] = region.outer_loops() else {
            return None;
        };
        let structure = upright_structure(topology, outer_loop, resolve_position)?;
        let unroll_run = |edges| -> Option<Vec<[f32; 2]>> {
            let mut run: Vec<[f32; 2]> = run_points(edges)?
                .into_iter()
                .map(|point| structure.frame.unroll(point))
                .collect();
            run.sort_by(|a, b| a[0].total_cmp(&b[0]));
            Some(run)
        };
        let base = unroll_run(&structure.base_edges)?;
        let top = unroll_run(&structure.top_edges)?;
        let travel = [base.first()?[0], base.last()?[0]];
        let [one, other] = &structure.side_edges;
        let from_start = |(_, start, _): &(ContourEdge, [f32; 3], [f32; 3])| {
            (structure.frame.unroll(*start)[0] - travel[0]).abs()
        };
        let sides = if from_start(one) <= from_start(other) {
            [one.0.id().clone(), other.0.id().clone()]
        } else {
            [other.0.id().clone(), one.0.id().clone()]
        };
        (travel[1] - travel[0] > f32::EPSILON).then_some(Self {
            frame: structure.frame,
            base,
            top,
            travel,
            sides,
        })
    }

    /// The base run's extent in the frame's arc-length measure: `u` scales it.
    pub fn length(&self) -> f32 {
        self.travel[1] - self.travel[0]
    }

    /// The vertical side edges at `u = 0` and at `u = 1`.
    pub fn sides(&self) -> &[ContourEdgeId; 2] {
        &self.sides
    }

    fn local_height(&self, travel: f32) -> (f32, f32) {
        let base = height_at(&self.base, travel);
        (base, height_at(&self.top, travel) - base)
    }

    /// Relative `(u, v)` as a point of the face's unrolled frame.
    pub fn unrolled_at(&self, u: f64, v: f64) -> [f32; 2] {
        let travel = self.travel[0] + (self.travel[1] - self.travel[0]) * u as f32;
        let (base, height) = self.local_height(travel);
        [travel, base + height * v as f32]
    }

    /// The world point at relative `(u, v)` on this face.
    pub fn resolve(&self, u: f64, v: f64) -> [f32; 3] {
        self.frame.roll(self.unrolled_at(u, v))
    }

    /// The inverse of [`unrolled_at`](Self::unrolled_at), unclamped.
    pub fn uv_of_unrolled(&self, [travel, height]: [f32; 2]) -> [f64; 2] {
        let u = (travel - self.travel[0]) / (self.travel[1] - self.travel[0]);
        let (base, local) = self.local_height(travel);
        let v = if local.abs() <= f32::EPSILON {
            0.0
        } else {
            (height - base) / local
        };
        [f64::from(u), f64::from(v)]
    }

    /// The inverse of [`resolve`](Self::resolve), unclamped.
    pub fn project(&self, point: [f32; 3]) -> [f64; 2] {
        self.uv_of_unrolled(self.frame.unroll(point))
    }

    /// A path drawn on the face between two `(u, v)` points, as points of the
    /// unrolled frame with both ends included: straight in `(u, v)`, or the
    /// cubic Bézier through `controls` there.
    ///
    /// Subdivided only where the path strays from its chord -- in the flat,
    /// or in the world once rolled onto a curved face -- by more than
    /// [`HOST_TRACE_TOLERANCE`], so a straight path on a flat face stays two
    /// points.
    pub fn trace(
        &self,
        from: [f64; 2],
        to: [f64; 2],
        controls: Option<[[f64; 2]; 2]>,
    ) -> Vec<[f32; 2]> {
        let at = |t: f64| -> [f32; 2] {
            let [u, v] = match controls {
                None => [0, 1].map(|axis| from[axis] + (to[axis] - from[axis]) * t),
                Some([c1, c2]) => {
                    let s = 1.0 - t;
                    let w = [s * s * s, 3.0 * s * s * t, 3.0 * s * t * t, t * t * t];
                    [0, 1].map(|axis| {
                        w[0] * from[axis] + w[1] * c1[axis] + w[2] * c2[axis] + w[3] * to[axis]
                    })
                }
            };
            self.unrolled_at(u, v)
        };
        let spans = if controls.is_some() {
            CURVE_TRACE_SPANS
        } else {
            1
        };
        let mut points = vec![at(0.0)];
        for span in 0..spans {
            let (t0, t1) = (span as f64 / spans as f64, (span + 1) as f64 / spans as f64);
            self.refine_trace(&at, (t0, at(t0)), (t1, at(t1)), 0, &mut points);
        }
        points
    }

    fn refine_trace(
        &self,
        at: &dyn Fn(f64) -> [f32; 2],
        (t0, a): (f64, [f32; 2]),
        (t1, b): (f64, [f32; 2]),
        depth: u32,
        points: &mut Vec<[f32; 2]>,
    ) {
        let tm = 0.5 * (t0 + t1);
        let m = at(tm);
        if depth < MAX_TRACE_DEPTH && self.chord_deviation(a, m, b) > HOST_TRACE_TOLERANCE {
            self.refine_trace(at, (t0, a), (tm, m), depth + 1, points);
            self.refine_trace(at, (tm, m), (t1, b), depth + 1, points);
        } else {
            points.push(b);
        }
    }

    fn chord_deviation(&self, a: [f32; 2], m: [f32; 2], b: [f32; 2]) -> f32 {
        let flat =
            ((m[0] - 0.5 * (a[0] + b[0])).powi(2) + (m[1] - 0.5 * (a[1] + b[1])).powi(2)).sqrt();
        let [a, m, b] = [a, m, b].map(|point| self.frame.roll(point));
        let world = (0..3)
            .map(|axis| (m[axis] - 0.5 * (a[axis] + b[axis])).powi(2))
            .sum::<f32>()
            .sqrt();
        flat.max(world)
    }
}

/// Largest gap, in metres, left between a path traced on a host face and
/// the chords it is drawn with. Finer than the mesher's own tolerance: what
/// is traced on a face is a small feature on it, and its outline is seen.
pub const HOST_TRACE_TOLERANCE: f32 = 0.002;

/// Bounds a traced path's subdivision at `2^12` chords per span.
const MAX_TRACE_DEPTH: u32 = 12;

/// Spans a curved path is checked in before refining, so a curve whose
/// midpoint happens to sit on its chord is still followed.
const CURVE_TRACE_SPANS: usize = 4;

fn signed_area(ring: &[[f32; 2]]) -> f32 {
    ring.iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
        .map(|(current, next)| current[0] * next[1] - next[0] * current[1])
        .sum::<f32>()
        / 2.0
}

fn wound(mut ring: Vec<[f32; 2]>, counter_clockwise: bool) -> Vec<[f32; 2]> {
    if (signed_area(&ring) > 0.0) != counter_clockwise {
        ring.reverse();
    }
    ring
}

fn shape_area(shape: &PlanarShape) -> f32 {
    let mut rings = shape.iter();
    let outer = rings.next().map_or(0.0, |ring| signed_area(ring).abs());
    outer - rings.map(|ring| signed_area(ring).abs()).sum::<f32>()
}

fn cleaned(ring: Vec<[f32; 2]>) -> Option<Vec<[f32; 2]>> {
    let mut out: Vec<[f32; 2]> = Vec::with_capacity(ring.len());
    for point in ring {
        if point.iter().any(|value| !value.is_finite()) {
            return None;
        }
        if out.last().is_none_or(|last| {
            (last[0] - point[0]).abs() > 1e-6 || (last[1] - point[1]).abs() > 1e-6
        }) {
            out.push(point);
        }
    }
    while out.len() > 1 && {
        let (first, last) = (out[0], out[out.len() - 1]);
        (first[0] - last[0]).abs() <= 1e-6 && (first[1] - last[1]).abs() <= 1e-6
    } {
        out.pop();
    }
    (out.len() >= 3 && signed_area(&out).abs() > f32::EPSILON).then_some(out)
}

/// One unrolled component triangulated in the flat, as `(points, indices)`.
fn triangulate_component(
    frame: &UnrollFrame,
    shape: &PlanarShape,
) -> Option<(Vec<[f32; 2]>, Vec<u32>)> {
    if let Some(edge_length) = frame.lattice_step() {
        let rings: Vec<Vec<[f32; 2]>> = shape
            .iter()
            .enumerate()
            .map(|(index, ring)| wound(ring.clone(), index == 0))
            .collect();
        let mesh = rings
            .uniform_triangulate(edge_length)
            .to_triangulation::<u32>();
        if !mesh.indices.is_empty() {
            return Some((mesh.points, mesh.indices));
        }
    }
    let mut points = Vec::new();
    let mut hole_indices = Vec::new();
    for (index, ring) in shape.iter().enumerate() {
        if index > 0 {
            hole_indices.push(points.len() as u32);
        }
        points.extend(ring.iter().copied());
    }
    let mut indices: Vec<u32> = Vec::new();
    Earcut::new().earcut(points.iter().copied(), &hole_indices, &mut indices);
    (!indices.is_empty()).then_some((points, indices))
}

/// Triangulates each shape in `frame`'s flat and rolls the result onto the
/// face, every triangle facing the frame's outward side.
fn rolled_mesh(frame: &UnrollFrame, shapes: &[PlanarShape]) -> TriangulatedMesh {
    let mut flat: Vec<[f32; 2]> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    for shape in shapes {
        let Some((points, component)) = triangulate_component(frame, shape) else {
            continue;
        };
        let offset = flat.len() as u32;
        for triangle in component.chunks_exact(3) {
            let [a, b, c] =
                [triangle[0], triangle[1], triangle[2]].map(|index| points[index as usize]);
            let ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0.0;
            let [i, j, k] = [triangle[0], triangle[1], triangle[2]].map(|index| index + offset);
            indices.extend_from_slice(&if ccw { [i, j, k] } else { [i, k, j] });
        }
        flat.extend(points);
    }

    let positions: Vec<[f32; 3]> = flat.iter().map(|point| frame.roll(*point)).collect();
    let normals: Vec<[f32; 3]> = positions
        .iter()
        .map(|point| frame.normal_at(*point))
        .collect();
    if !indices.is_empty()
        && let Some(reference) = winding_normal(&positions, &indices)
        && dot(reference, normals[indices[0] as usize]) < 0.0
    {
        for triangle in indices.chunks_exact_mut(3) {
            triangle.swap(1, 2);
        }
    }
    TriangulatedMesh {
        positions,
        normals,
        uvs: flat,
        indices,
    }
}

/// An upright face's mesh with `cutters` -- closed rings in the face's own
/// unrolled frame, the one [`HostFace::of`] reads it with -- subtracted
/// from it.
///
/// `None` only when the region is not an upright face, leaving the caller's
/// ordinary path in charge. A cut that removes nothing yields exactly the
/// uncut mesh; one that removes everything yields an empty one.
pub fn upright_face_mesh_cut(
    topology: &ContourTopology,
    region: &SurfaceRegion,
    resolve_position: &mut impl FnMut(&NodeId) -> Option<[f32; 3]>,
    cutters: &[Vec<[f32; 2]>],
) -> Option<TriangulatedMesh> {
    if region.profile().is_some() {
        return None;
    }
    let [outer_loop] = region.outer_loops() else {
        return None;
    };
    let frame = upright_structure(topology, outer_loop, resolve_position)?.frame;
    let unroll = |ring: &[[f32; 3]]| -> Vec<[f32; 2]> {
        ring.iter().map(|point| frame.unroll(*point)).collect()
    };

    let clip: Vec<PlanarShape> = cutters
        .iter()
        .filter_map(|ring| cleaned(ring.clone()))
        .map(|ring| vec![wound(ring, true)])
        .collect();
    if clip.is_empty() {
        return upright_face_mesh(topology, region, resolve_position);
    }

    let outer = tessellate_contour_loop(topology, outer_loop, resolve_position)?;
    let mut subject: PlanarShape = vec![wound(cleaned(unroll(&outer))?, true)];
    for hole in region.holes() {
        let hole = tessellate_contour_loop(topology, hole, resolve_position)?;
        subject.push(wound(cleaned(unroll(&hole))?, false));
    }
    let Ok(remaining) = planar_boolean(
        std::slice::from_ref(&subject),
        &clip,
        PlanarBoolean::Difference,
    ) else {
        return upright_face_mesh(topology, region, resolve_position);
    };
    let removed = shape_area(&subject) - remaining.iter().map(shape_area).sum::<f32>();
    if removed <= NEGLIGIBLE_CUT_AREA {
        return upright_face_mesh(topology, region, resolve_position);
    }
    Some(rolled_mesh(&frame, &remaining))
}

/// A face lying on a host, meshed in the host's own frame: `outer` and
/// `holes` are rings of the host's flat, so what is drawn follows the host
/// however it curves. `None` when the outline encloses nothing.
pub fn mesh_on_host(
    face: &HostFace,
    outer: &[[f32; 2]],
    holes: &[Vec<[f32; 2]>],
) -> Option<TriangulatedMesh> {
    let mut shape: PlanarShape = vec![wound(cleaned(outer.to_vec())?, true)];
    for hole in holes {
        shape.push(wound(cleaned(hole.clone())?, false));
    }
    let mesh = rolled_mesh(&face.frame, std::slice::from_ref(&shape));
    (!mesh.indices.is_empty()).then_some(mesh)
}
