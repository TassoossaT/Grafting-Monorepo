//! Shapes that carve solid away or fill it in, and how they combine with
//! whatever already says where solid is.
//!
//! Negative is solid, positive is air, zero is the surface. A shape is a
//! form swept along a path -- a capsule, round or squashed, or a column
//! between two heights; carving takes it out of the solid, filling adds it,
//! both blended over a width so the lip of a tunnel or the foot of a bridge
//! rounds off instead of creasing.

use crate::vector::Vec3;

/// What a shape does to the solid it overlaps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effect {
    /// Takes solid away: a tunnel, a cave.
    Carve,
    /// Adds solid: a bridge, a ledge.
    Fill,
}

/// The solid a shape stands for, round its path.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Form {
    /// A capsule swept along the path, `squash` times as tall as it is wide:
    /// `1` round -- a tunnel's bore -- and less a pile of earth laid along a
    /// stroke, or the trench dug along one.
    Swept { squash: f64 },
    /// The column over the path's plan, `radius` wide, from height `low` to
    /// `high`: what a level is cut down to or filled up to, never reaching
    /// past those heights -- to a cave's ceiling, say.
    Column { low: f64, high: f64 },
}

/// A form swept along a path, carving or filling.
#[derive(Debug, Clone)]
pub struct Shape {
    pub effect: Effect,
    pub path: Vec<Vec3>,
    pub radius: f64,
    pub form: Form,
}

/// Distance from `point` to the polyline `path`, measured with heights
/// scaled by `y_scale`.
fn to_path(point: Vec3, path: &[Vec3], y_scale: f64) -> f64 {
    let scaled = |p: Vec3| Vec3::new(p.x, p.y * y_scale, p.z);
    let q = scaled(point);
    match path {
        [] => f64::INFINITY,
        [only] => q.distance(scaled(*only)),
        path => path.windows(2).map(|pair| q.distance_to_segment(scaled(pair[0]), scaled(pair[1]))).fold(f64::INFINITY, f64::min),
    }
}

impl Shape {
    /// A round capsule along `path`.
    pub fn capsule(effect: Effect, path: Vec<Vec3>, radius: f64) -> Self {
        Self { effect, path, radius, form: Form::Swept { squash: 1.0 } }
    }

    /// Signed distance to the shape: negative inside it. Bounded by the true
    /// distance, so a step of that length never passes through the surface.
    pub fn distance(&self, point: Vec3) -> f64 {
        match self.form {
            Form::Swept { squash } => {
                let squash = squash.max(1e-3);
                // In a space with heights stretched by 1 / squash the shape is
                // round; a step there is at most max(1, 1 / squash) of one here.
                (to_path(point, &self.path, 1.0 / squash) - self.radius) * squash.min(1.0)
            }
            Form::Column { low, high } => {
                let across = to_path(point, &self.path, 0.0) - self.radius;
                let up = (low - point.y).max(point.y - high);
                across.max(0.0).hypot(up.max(0.0)) + across.max(up).min(0.0)
            }
        }
    }

    /// How thin the shape is at its thinnest: what the faces laid on it must
    /// be finer than to describe it.
    pub fn thickness(&self) -> f64 {
        match self.form {
            Form::Swept { squash } => self.radius * squash.clamp(1e-3, 1.0),
            Form::Column { low, high } => self.radius.min(((high - low) * 0.5).max(1e-3)),
        }
    }

    /// The box the shape can change the field in, given how far the blend
    /// between it and the ground reaches.
    pub fn bounds(&self, blend: f64) -> (Vec3, Vec3) {
        let mut min = Vec3::splat(f64::INFINITY);
        let mut max = Vec3::splat(f64::NEG_INFINITY);
        for point in &self.path {
            min = min.min(*point);
            max = max.max(*point);
        }
        let across = self.radius + blend;
        match self.form {
            Form::Swept { squash } => {
                let up = self.radius * squash.max(1e-3) + blend;
                (min - Vec3::new(across, up, across), max + Vec3::new(across, up, across))
            }
            Form::Column { low, high } => (Vec3::new(min.x - across, low - blend, min.z - across), Vec3::new(max.x + across, high + blend, max.z + across)),
        }
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
