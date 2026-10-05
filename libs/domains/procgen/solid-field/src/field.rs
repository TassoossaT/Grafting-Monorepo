//! The field: where there is solid, as a signed distance.
//!
//! Two kinds of truth, combined on every query rather than baked into a grid:
//!
//! - **A height over the plane** ([`HeightSource`]): ground as it has always
//!   been, one height per point. Everything a 2.5D brush does lands here.
//! - **Shapes** ([`Shape`]): capsules along a path that carve solid away or
//!   fill it in. A tunnel is one shape; deleting it gives the hill back, with
//!   nothing remembered.
//!
//! Negative is solid, positive is air, zero is the surface. The height part is
//! `y - height(x, z)`, which is not a true distance on a slope; nothing here
//! needs it to be, only to change sign at the surface and point out of it.
//!
//! Following Paris et al., *Terrain Amplification with Implicit 3D Features*
//! (2019): a height field amplified by implicit primitives, evaluated where it
//! is asked for, never voxelised as the truth.

use crate::vector::Vec3;

/// Ground as one height per point of the plane.
pub trait HeightSource {
    fn height(&self, x: f64, z: f64) -> f64;
}

impl<F: Fn(f64, f64) -> f64> HeightSource for F {
    fn height(&self, x: f64, z: f64) -> f64 {
        self(x, z)
    }
}

/// Heights sampled on a regular grid of the plane, read back bilinearly and
/// clamped at the edges.
#[derive(Debug, Clone)]
pub struct HeightGrid {
    pub origin_x: f64,
    pub origin_z: f64,
    pub spacing: f64,
    /// Samples along x.
    pub columns: usize,
    /// Samples along z.
    pub rows: usize,
    /// Row-major: `heights[row * columns + column]`.
    pub heights: Vec<f64>,
}

impl HeightGrid {
    /// Samples `source` on the grid.
    pub fn sample(source: &impl HeightSource, origin_x: f64, origin_z: f64, spacing: f64, columns: usize, rows: usize) -> Self {
        let mut heights = Vec::with_capacity(columns * rows);
        for row in 0..rows {
            for column in 0..columns {
                heights.push(source.height(origin_x + column as f64 * spacing, origin_z + row as f64 * spacing));
            }
        }
        Self { origin_x, origin_z, spacing, columns, rows, heights }
    }

    fn at(&self, column: usize, row: usize) -> f64 {
        self.heights[row.min(self.rows - 1) * self.columns + column.min(self.columns - 1)]
    }
}

impl HeightSource for HeightGrid {
    fn height(&self, x: f64, z: f64) -> f64 {
        let u = ((x - self.origin_x) / self.spacing).clamp(0.0, (self.columns - 1) as f64);
        let v = ((z - self.origin_z) / self.spacing).clamp(0.0, (self.rows - 1) as f64);
        let (column, row) = (u.floor() as usize, v.floor() as usize);
        let (fu, fv) = (u - column as f64, v - row as f64);
        let top = self.at(column, row) * (1.0 - fu) + self.at(column + 1, row) * fu;
        let bottom = self.at(column, row + 1) * (1.0 - fu) + self.at(column + 1, row + 1) * fu;
        top * (1.0 - fv) + bottom * fv
    }
}

/// What a shape does to the solid it overlaps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effect {
    /// Takes solid away: a tunnel, a cave.
    Carve,
    /// Adds solid: a bridge, a ledge.
    Fill,
}

/// A capsule swept along a path: every point within `radius` of it.
///
/// One brush stroke is one shape, however many samples the pointer produced,
/// so the list grows with what was made, not with how long the drag took.
#[derive(Debug, Clone)]
pub struct Shape {
    pub effect: Effect,
    pub path: Vec<Vec3>,
    pub radius: f64,
}

impl Shape {
    /// Signed distance to the capsule: negative inside it.
    pub fn distance(&self, point: Vec3) -> f64 {
        let nearest = match self.path.as_slice() {
            [] => f64::INFINITY,
            [only] => point.distance(*only),
            path => path
                .windows(2)
                .map(|pair| point.distance_to_segment(pair[0], pair[1]))
                .fold(f64::INFINITY, f64::min),
        };
        nearest - self.radius
    }

    /// The box the shape can change the field in, given how far the blend
    /// between it and the ground reaches.
    pub fn bounds(&self, blend: f64) -> (Vec3, Vec3) {
        let reach = self.radius + blend;
        let mut min = Vec3::splat(f64::INFINITY);
        let mut max = Vec3::splat(f64::NEG_INFINITY);
        for point in &self.path {
            min = min.min(*point);
            max = max.max(*point);
        }
        (min - Vec3::splat(reach), max + Vec3::splat(reach))
    }
}

/// Polynomial smooth minimum (Inigo Quilez): `min(a, b)` with the corner
/// rounded over a width of `k`. `k = 0` is the plain minimum.
pub fn smooth_min(a: f64, b: f64, k: f64) -> f64 {
    if k <= 0.0 {
        return a.min(b);
    }
    let h = (k - (a - b).abs()).max(0.0) / k;
    a.min(b) - h * h * k * 0.25
}

/// Where there is solid.
pub struct SolidField<H: HeightSource> {
    pub ground: H,
    pub shapes: Vec<Shape>,
    /// Width over which a shape blends into the ground, in world units: what
    /// rounds the lip of a tunnel mouth. `0` cuts it sharp.
    pub blend: f64,
}

impl<H: HeightSource> SolidField<H> {
    pub fn new(ground: H) -> Self {
        Self { ground, shapes: Vec::new(), blend: 0.0 }
    }

    /// The height part alone: ground as if no shape stood anywhere.
    pub fn ground_distance(&self, point: Vec3) -> f64 {
        point.y - self.ground.height(point.x, point.z)
    }

    /// Signed distance, negative inside solid. Shapes apply in order, so a
    /// fill made after a carve fills it back in.
    pub fn distance(&self, point: Vec3) -> f64 {
        self.shapes.iter().fold(self.ground_distance(point), |field, shape| {
            let shape_distance = shape.distance(point);
            match shape.effect {
                Effect::Fill => smooth_min(field, shape_distance, self.blend),
                Effect::Carve => -smooth_min(-field, shape_distance, self.blend),
            }
        })
    }

    /// The direction out of the solid at `point`, unnormalised.
    pub fn gradient(&self, point: Vec3, step: f64) -> Vec3 {
        let axis = |offset: Vec3| self.distance(point + offset) - self.distance(point - offset);
        Vec3::new(
            axis(Vec3::new(step, 0.0, 0.0)),
            axis(Vec3::new(0.0, step, 0.0)),
            axis(Vec3::new(0.0, 0.0, step)),
        ) * (0.5 / step)
    }

    /// `point` moved onto the surface along the gradient, a few Newton steps.
    pub fn project(&self, point: Vec3, step: f64) -> Vec3 {
        let mut current = point;
        for _ in 0..8 {
            let distance = self.distance(current);
            if distance.abs() < 1e-7 {
                break;
            }
            let gradient = self.gradient(current, step);
            let length_squared = gradient.dot(gradient);
            if length_squared < 1e-18 {
                break;
            }
            current = current - gradient * (distance / length_squared);
        }
        current
    }

    /// The `nth` crossing (0-based) met walking from `from` along `direction`
    /// for at most `length`, refined by bisection. Crossings alternate
    /// air-to-solid and solid-to-air.
    pub fn crossing(&self, from: Vec3, direction: Vec3, length: f64, step: f64, nth: usize) -> Option<Vec3> {
        let mut seen = 0;
        let mut t = 0.0;
        let mut previous = self.distance(from);
        while t < length {
            let next_t = (t + step).min(length);
            let next = self.distance(from + direction * next_t);
            if (previous < 0.0) != (next < 0.0) {
                if seen == nth {
                    let (mut low, mut high) = (t, next_t);
                    for _ in 0..40 {
                        let middle = 0.5 * (low + high);
                        if (self.distance(from + direction * middle) < 0.0) == (previous < 0.0) {
                            low = middle;
                        } else {
                            high = middle;
                        }
                    }
                    return Some(from + direction * (0.5 * (low + high)));
                }
                seen += 1;
            }
            previous = next;
            t = next_t;
        }
        None
    }

    /// How many times the surface is crossed walking from `from` along
    /// `direction` for `length`.
    pub fn crossings(&self, from: Vec3, direction: Vec3, length: f64, step: f64) -> usize {
        let mut count = 0;
        let mut t = 0.0;
        let mut previous = self.distance(from) < 0.0;
        while t < length {
            t = (t + step).min(length);
            let inside = self.distance(from + direction * t) < 0.0;
            if inside != previous {
                count += 1;
            }
            previous = inside;
        }
        count
    }
}
