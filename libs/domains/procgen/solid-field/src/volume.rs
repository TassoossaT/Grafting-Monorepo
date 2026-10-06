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
pub struct EditField<'a> {
    pub ground: &'a MeshDistance,
    pub shapes: &'a [Shape],
    pub blend: f64,
    /// The table under the ground, solid where no ground stands.
    pub table: Option<&'a TableFloor>,
}

impl EditField<'_> {
    /// Signed distance, negative inside solid.
    pub fn distance(&self, point: Vec3) -> f64 {
        let ground = self.ground.signed_distance(point);
        // Where no ground stands over or under a point, it is in no ground's
        // solid -- whatever the sign past a ground's open border says -- and
        // the table is the floor there.
        let base = match self.table.and_then(|table| table.distance(point)) {
            Some(table) => ground.abs().min(table),
            None => ground,
        };
        with_shapes(base, point, self.shapes, self.blend)
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

    /// The surface inside the box `min..max`, read on a grid `cell` apart:
    /// vertices and triangles wound so their normal points out of the solid.
    pub fn extract(&self, min: Vec3, max: Vec3, cell: f64) -> (Vec<Vec3>, Vec<[usize; 3]>) {
        let count = |low: f64, high: f64| ((high - low) / cell).ceil().max(1.0) as u32 + 1;
        let size = [count(min.x, max.x), count(min.y, max.y), count(min.z, max.z)];
        let shape = RuntimeShape::<u32, 3>::new(size);
        let mut samples = vec![0f32; shape.size() as usize];
        for index in 0..shape.size() {
            let [x, y, z] = shape.delinearize(index);
            let point = min + Vec3::new(x as f64, y as f64, z as f64) * cell;
            samples[index as usize] = self.distance(point) as f32;
        }
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
        let agreement: f64 = triangles
            .iter()
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
        (vertices, triangles)
    }
}
