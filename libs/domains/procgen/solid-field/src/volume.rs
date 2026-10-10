//! Where there is solid after an edit: the ground's own mesh, with the edit's
//! shapes carved out of it or filled into it.
//!
//! Built for one edit and dropped after it. Nothing here is kept: the ground
//! is its mesh, and the next edit asks the mesh again.

use fast_surface_nets::ndshape::{RuntimeShape, Shape as _};
use fast_surface_nets::{SurfaceNetsBuffer, surface_nets};

use crate::field::{Shape, with_shapes};
use crate::mesh_distance::MeshDistance;
use crate::table::TableFloor;
use crate::vector::Vec3;

/// The ground after the edit, as a signed distance.
#[derive(Clone, Copy)]
pub struct EditField<'a> {
    pub ground: &'a MeshDistance,
    pub shapes: &'a [Shape],
    pub blend: f64,
    /// The table under the ground, solid where no ground stands.
    pub table: Option<&'a TableFloor>,
    /// How far from the ground distances are measured exactly; past it only
    /// their sign is right -- all a grid read needs of a sample far from the
    /// surface. `INFINITY` measures everywhere.
    pub reach: f64,
}

impl EditField<'_> {
    /// Signed distance, negative inside solid.
    pub fn distance(&self, point: Vec3) -> f64 {
        self.distance_and_edge(point).0
    }

    /// [`Self::distance`], and whether its sign is the ground's open border's
    /// -- nearest its edge, with no table to say -- where the sign jumps
    /// from one side of the ground to the other, as it should.
    fn distance_and_edge(&self, point: Vec3) -> (f64, bool) {
        // Where no ground stands over or under a point, it is in no ground's
        // solid -- whatever the sign past a ground's open border says -- and
        // the table is the floor there. So too where the nearest ground is its
        // open border: under the rim of a pile laid on the table, the sheet's
        // sign is no answer, and the table's is.
        let (base, edge) = match self.table {
            Some(table) => {
                let (ground, at_border) = self.ground.signed_distance_at_border_within(point, self.reach);
                let base = match table.distance(point) {
                    Some(floor) => ground.abs().min(floor),
                    None if at_border => ground.abs().min(point.y - table.height),
                    None => ground,
                };
                (base, false)
            }
            None => self.ground.signed_distance_at_border_within(point, self.reach),
        };
        (with_shapes(base, point, self.shapes, self.blend), edge)
    }

    /// The direction out of the solid at `point`, unnormalised.
    pub fn gradient(&self, point: Vec3, step: f64) -> Vec3 {
        let axis = |offset: Vec3| self.distance(point + offset) - self.distance(point - offset);
        Vec3::new(axis(Vec3::new(step, 0.0, 0.0)), axis(Vec3::new(0.0, step, 0.0)), axis(Vec3::new(0.0, 0.0, step))) * (0.5 / step)
    }

    /// `point` moved onto the surface along the gradient, a few Newton steps,
    /// never further than `limit` from where it started.
    pub fn project(&self, point: Vec3, step: f64, limit: f64) -> Vec3 {
        let mut current = point;
        for _ in 0..4 {
            let distance = self.distance(current);
            if distance.abs() < 1e-4 {
                break;
            }
            // Forward differences: three more reads where central ones take six.
            let axis = |offset: Vec3| self.distance(current + offset) - distance;
            let gradient = Vec3::new(axis(Vec3::new(step, 0.0, 0.0)), axis(Vec3::new(0.0, step, 0.0)), axis(Vec3::new(0.0, 0.0, step))) * (1.0 / step);
            let length_squared = gradient.dot(gradient);
            if length_squared < 1e-18 {
                break;
            }
            current = current - gradient * (distance / length_squared);
        }
        let moved = current - point;
        if moved.length() > limit { point + moved.normalized() * limit } else { current }
    }

    /// Settles every cell face Surface Nets would read both ways: corners
    /// alike across one diagonal and unlike the other pair, as where a trough
    /// narrower than a cell runs slantwise through the grid. Read as it
    /// stands, the four sides of such a face each hand the edge across it a
    /// quad -- an edge four faces hold. The field at the face's middle says
    /// which pair the solid (or the air) joins through; the weaker corner of
    /// the other pair is turned over to it, moving the surface less than a
    /// cell where it was finer than a cell to begin with. How many faces it
    /// settled.
    fn untwist_faces(&self, samples: &mut [f32], shape: &RuntimeShape<u32, 3>, size: [u32; 3], at: &dyn Fn([u32; 3]) -> Vec3, cell: f64) -> usize {
        let nudge = (cell * 1e-3) as f32;
        let mut settled = 0;
        for _ in 0..UNTWIST_ROUNDS {
            let mut turned = false;
            for axis in 0..3 {
                let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
                for index in 0..shape.size() {
                    let corner = shape.delinearize(index);
                    if corner[u] + 1 >= size[u] || corner[v] + 1 >= size[v] {
                        continue;
                    }
                    let step = |mut c: [u32; 3], du: u32, dv: u32| {
                        c[u] += du;
                        c[v] += dv;
                        c
                    };
                    let (c00, c10, c01, c11) = (corner, step(corner, 1, 0), step(corner, 0, 1), step(corner, 1, 1));
                    let solid = |c: [u32; 3]| samples[shape.linearize(c) as usize] < 0.0;
                    if solid(c00) != solid(c11) || solid(c10) != solid(c01) || solid(c00) == solid(c10) {
                        continue;
                    }
                    let middle = (at(c00) + at(c11)) * 0.5;
                    let inside = self.distance(middle) < 0.0;
                    let (x, y) = if inside == solid(c00) { (c10, c01) } else { (c00, c11) };
                    let (x, y) = (shape.linearize(x) as usize, shape.linearize(y) as usize);
                    let weaker = if samples[x].abs() <= samples[y].abs() { x } else { y };
                    samples[weaker] = if inside { -nudge } else { nudge };
                    turned = true;
                    settled += 1;
                }
            }
            if !turned {
                break;
            }
        }
        settled
    }

    /// The surface inside the box `min..max`, read on a grid `cell` apart:
    /// vertices and triangles wound so their normal points out of the solid,
    /// and how many faces the grid read both ways had to be settled -- solid
    /// or air finer than the grid, which a finer grid may read as it is.
    pub fn extract(&self, min: Vec3, max: Vec3, cell: f64) -> (Vec<Vec3>, Vec<[usize; 3]>, usize) {
        let count = |low: f64, high: f64| ((high - low) / cell).ceil().max(1.0) as u32 + 1;
        let size = [count(min.x, max.x), count(min.y, max.y), count(min.z, max.z)];
        let shape = RuntimeShape::<u32, 3>::new(size);
        let mut samples = vec![0f32; shape.size() as usize];
        // Samples whose sign is the ground's open border's.
        let mut edge = vec![false; shape.size() as usize];
        // Every other sample read first -- the last on each axis too -- and
        // the rest read only near the surface. The field rises at most one
        // per unit (squashed forms are scaled to keep it so), and it is exact
        // to `reach` from the ground: a sample `away` from a read one holding
        // `value` is at least `min(|value|, reach) - away` from the surface,
        // and one more than a cell's diagonal from it lies in no cell the
        // surface crosses -- its sign is all Surface Nets reads, and its sign
        // is the read one's. Where the field is whole the surface comes out
        // the same; where the ground's sign jumps, a pocket smaller than two
        // cells between read samples goes unread -- a crumb the mending would
        // only have to sweep up.
        let coarse = |i: u32, n: u32| i.is_multiple_of(2) || i == n - 1;
        let at = |[x, y, z]: [u32; 3]| min + Vec3::new(x as f64, y as f64, z as f64) * cell;
        let sure = self.reach;
        let clear = cell * 1.75;
        for index in 0..shape.size() {
            let [x, y, z] = shape.delinearize(index);
            if coarse(x, size[0]) && coarse(y, size[1]) && coarse(z, size[2]) {
                let (value, at_edge) = self.distance_and_edge(at([x, y, z]));
                samples[index as usize] = value as f32;
                edge[index as usize] = at_edge;
            }
        }
        for index in 0..shape.size() {
            let [x, y, z] = shape.delinearize(index);
            let odd = [!coarse(x, size[0]), !coarse(y, size[1]), !coarse(z, size[2])];
            let steps = odd.iter().filter(|&&o| o).count();
            if steps == 0 {
                continue;
            }
            // Every read sample round it, on both sides of each odd axis: the
            // ground's sign jumps past its open border, so no one of them
            // vouches for the others.
            let away = (steps as f64).sqrt() * cell;
            let mut sign = 0.0;
            let mut nearest = f64::INFINITY;
            let mut agree = true;
            let mut near_edge = false;
            for corner in 0..8u32 {
                if (0..3).any(|axis| !odd[axis] && corner & (1 << axis) != 0) {
                    continue;
                }
                let pick = |axis: usize, i: u32| if odd[axis] { if corner & (1 << axis) != 0 { i + 1 } else { i - 1 } } else { i };
                let read = shape.linearize([pick(0, x), pick(1, y), pick(2, z)]) as usize;
                let value = samples[read] as f64;
                near_edge |= edge[read];
                if sign == 0.0 {
                    sign = value.signum();
                }
                agree &= value.signum() == sign;
                nearest = nearest.min(value.abs());
            }
            (samples[index as usize], edge[index as usize]) = if agree && nearest.min(sure) - away > clear {
                ((sign * (nearest - away)) as f32, near_edge)
            } else {
                let (value, at_edge) = self.distance_and_edge(at([x, y, z]));
                (value as f32, at_edge)
            };
        }
        signed_from_the_band(&mut samples, &edge, &shape, size, (cell * SURE_BAND_CELLS) as f32);
        let settled = self.untwist_faces(&mut samples, &shape, size, &at, cell);
        let mut buffer = SurfaceNetsBuffer::default();
        surface_nets(&samples, &shape, [0; 3], [size[0] - 1, size[1] - 1, size[2] - 1], &mut buffer);
        let vertices: Vec<Vec3> = buffer
            .positions
            .iter()
            .map(|p| min + Vec3::new(p[0] as f64, p[1] as f64, p[2] as f64) * cell)
            .collect();
        // Surface Nets winds every quad the same way round the solid; which
        // way is settled once, by the field, for the whole mesh. Asked per
        // triangle, a roof thinner than a cell answers wrong for some of them,
        // and a triangle turned against its neighbours reads as a hole.
        let step = cell * 0.25;
        let mut triangles: Vec<[usize; 3]> = buffer.indices.chunks_exact(3).map(|t| [t[0] as usize, t[1] as usize, t[2] as usize]).collect();
        // A vote, so a spread few hundred of them answer as well as all.
        let stride = (triangles.len() / 256).max(1);
        let agreement: f64 = triangles
            .iter()
            .step_by(stride)
            .map(|&[a, b, c]| {
                let centre = (vertices[a] + vertices[b] + vertices[c]) * (1.0 / 3.0);
                let normal = (vertices[b] - vertices[a]).cross(vertices[c] - vertices[a]);
                normal.normalized().dot(self.gradient(centre, step).normalized())
            })
            .sum();
        if agreement < 0.0 {
            for t in triangles.iter_mut() {
                t.swap(1, 2);
            }
        }
        (vertices, triangles, settled)
    }
}

/// How near the surface, in cells, the field's sign is taken as it reads.
const SURE_BAND_CELLS: f64 = 1.5;

/// Every sample further than `band` from the surface signed as the samples
/// within it round its pocket say: the ground's sign is sure near its mesh
/// and nowhere else -- past a cell folded over, or through a hole, the
/// nearest face points the wrong way, and the grid would read a surface in
/// the open air metres off the ground. A pocket of far samples lies on one
/// side of the surface, so the band round it, all on that side, signs it --
/// by the most of them, a fold's few the other way outvoted. Past the
/// ground's open border the sign jumps from its top to its underside as it
/// should: a pocket never runs on across that jump.
fn signed_from_the_band(samples: &mut [f32], edge: &[bool], shape: &RuntimeShape<u32, 3>, size: [u32; 3], band: f32) {
    let far = |value: f32| value.abs() > band;
    let mut pocket = vec![usize::MAX; samples.len()];
    let mut members: Vec<usize> = Vec::new();
    for seed in 0..samples.len() {
        if pocket[seed] != usize::MAX || !far(samples[seed]) {
            continue;
        }
        members.clear();
        members.push(seed);
        pocket[seed] = seed;
        let (mut vote, mut own) = (0i64, 0i64);
        let mut k = 0;
        while k < members.len() {
            let here = members[k];
            k += 1;
            own += if samples[here] < 0.0 { -1 } else { 1 };
            let c = shape.delinearize(here as u32);
            for axis in 0..3 {
                for forward in [false, true] {
                    if (!forward && c[axis] == 0) || (forward && c[axis] + 1 >= size[axis]) {
                        continue;
                    }
                    let mut n = c;
                    n[axis] = if forward { c[axis] + 1 } else { c[axis] - 1 };
                    let next = shape.linearize(n) as usize;
                    if far(samples[next]) {
                        let jump = (samples[next] < 0.0) != (samples[here] < 0.0);
                        if pocket[next] == usize::MAX && !(jump && (edge[here] || edge[next])) {
                            pocket[next] = seed;
                            members.push(next);
                        }
                    } else {
                        vote += if samples[next] < 0.0 { -1 } else { 1 };
                    }
                }
            }
        }
        let solid = if vote != 0 { vote < 0 } else { own < 0 };
        for &m in &members {
            samples[m] = if solid { -samples[m].abs() } else { samples[m].abs() };
        }
    }
}

/// Passes [`EditField::untwist_faces`] takes at most: one turned corner can
/// leave a face beside it to settle.
const UNTWIST_ROUNDS: usize = 4;
