//! Shapes that carve solid away or fill it in, and how they combine with
//! whatever already says where solid is.
//!
//! Negative is solid, positive is air, zero is the surface. A shape is a
//! capsule swept along a path; carving takes the capsule out of the solid,
//! filling adds it, both blended over a width so the lip of a tunnel or the
//! foot of a bridge rounds off instead of creasing.

use crate::vector::Vec3;

/// What a shape does to the solid it overlaps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effect {
    /// Takes solid away: a tunnel, a cave.
    Carve,
    /// Adds solid: a bridge, a ledge.
    Fill,
}

/// A capsule swept along a path: every point within `radius` of it.
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

/// `base` -- the signed distance to whatever already says where solid is --
/// with every shape applied in order, so a fill made after a carve fills it
/// back in.
pub fn with_shapes(base: f64, point: Vec3, shapes: &[Shape], blend: f64) -> f64 {
    shapes.iter().fold(base, |field, shape| {
        let shape_distance = shape.distance(point);
        match shape.effect {
            Effect::Fill => smooth_min(field, shape_distance, blend),
            Effect::Carve => -smooth_min(-field, shape_distance, blend),
        }
    })
}
