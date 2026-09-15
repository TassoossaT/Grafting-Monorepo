//! Frame mappings for developable upright surfaces (straight or curved walls).

use grafting_graph_core::ContourGeometry;

use crate::math::{angle_xz, cubic_bezier_eval, cubic_bezier_tangent, distance_xz, sweep};

/// How many chords a Bézier rail's arc-length table is built from. A wall
/// segment is short (a handful of metres at most), so this is far finer than
/// the curve needs for either the length table's own accuracy or the
/// nearest-parameter search below to stay well inside a visually
/// imperceptible error.
const BEZIER_UNROLL_STEPS: usize = 64;

/// The flat frame an upright face unrolls into: one coordinate running
/// along its rail, one running up it.
///
/// A wall panel is developable, so this map loses nothing. `Chord` is the
/// straight case and `Cylinder` the curved one, and they are the same idea
/// -- a chord is an arc whose radius has gone to infinity. `Curve` is the
/// general case either specializes: a Bézier rail has no closed-form
/// arc-length or nearest-point query, so it keeps a fine sampled table
/// instead, built once in [`UnrollFrame::of`].
#[derive(Debug, Clone)]
pub enum UnrollFrame {
    Chord {
        origin: [f32; 2],
        direction: [f32; 2],
    },
    Cylinder {
        center: [f32; 2],
        radius: f32,
        start_angle: f32,
        total_sweep: f32,
        clockwise: bool,
    },
    Curve {
        p0: [f32; 2],
        p1: [f32; 2],
        p2: [f32; 2],
        p3: [f32; 2],
        /// Cumulative arc length at `BEZIER_UNROLL_STEPS + 1` evenly spaced
        /// parameters, index `i` at `t = i / BEZIER_UNROLL_STEPS`.
        cumulative_length: Vec<f32>,
    },
}

/// The curve parameter `t` nearest `xz` on the cubic Bézier `p0 p1 p2 p3`: a
/// coarse uniform scan (matching the table's own resolution) followed by a
/// ternary-search refinement either side of the best sample. Every point this
/// is ever asked about already lies on the curve in practice (a wall carries
/// no lateral thickness), so this is a projection in name only -- what it
/// really finds is `xz`'s own station.
fn nearest_parameter(p0: [f32; 2], p1: [f32; 2], p2: [f32; 2], p3: [f32; 2], xz: [f32; 2]) -> f32 {
    let distance_sq_at = |t: f32| {
        let p = cubic_bezier_eval(p0, p1, p2, p3, t);
        (p[0] - xz[0]).powi(2) + (p[1] - xz[1]).powi(2)
    };
    let mut best_t = 0.0_f32;
    let mut best_d2 = f32::INFINITY;
    for index in 0..=BEZIER_UNROLL_STEPS {
        let t = index as f32 / BEZIER_UNROLL_STEPS as f32;
        let d2 = distance_sq_at(t);
        if d2 < best_d2 {
            best_d2 = d2;
            best_t = t;
        }
    }
    let step = 1.0 / BEZIER_UNROLL_STEPS as f32;
    let mut lo = (best_t - step).max(0.0);
    let mut hi = (best_t + step).min(1.0);
    for _ in 0..24 {
        let m1 = lo + (hi - lo) / 3.0;
        let m2 = hi - (hi - lo) / 3.0;
        if distance_sq_at(m1) < distance_sq_at(m2) {
            hi = m2;
        } else {
            lo = m1;
        }
    }
    (lo + hi) / 2.0
}

impl UnrollFrame {
    /// Builds the frame from the rail's own geometry and where that rail starts.
    pub fn of(geometry: &ContourGeometry, start: [f32; 3], end: [f32; 3]) -> Option<Self> {
        match geometry {
            ContourGeometry::Line => {
                let (dx, dz) = (end[0] - start[0], end[2] - start[2]);
                let length = (dx * dx + dz * dz).sqrt();
                (length > f32::EPSILON).then_some(Self::Chord {
                    origin: [start[0], start[2]],
                    direction: [dx / length, dz / length],
                })
            }
            ContourGeometry::CircularArc { center, clockwise } => {
                let radius = distance_xz(*center, [start[0], start[2]]);
                let start_angle = angle_xz(*center, [start[0], start[2]]);
                let end_angle = angle_xz(*center, [end[0], end[2]]);
                let total_sweep = sweep(start_angle, end_angle, *clockwise);
                (radius > f32::EPSILON).then_some(Self::Cylinder {
                    center: *center,
                    radius,
                    start_angle,
                    total_sweep,
                    clockwise: *clockwise,
                })
            }
            ContourGeometry::Bezier { handle1, handle2 } => {
                let p0 = [start[0], start[2]];
                let p3 = [end[0], end[2]];
                let (p1, p2) = (*handle1, *handle2);
                let mut cumulative_length = Vec::with_capacity(BEZIER_UNROLL_STEPS + 1);
                cumulative_length.push(0.0);
                let mut previous = p0;
                let mut total = 0.0;
                for index in 1..=BEZIER_UNROLL_STEPS {
                    let t = index as f32 / BEZIER_UNROLL_STEPS as f32;
                    let point = cubic_bezier_eval(p0, p1, p2, p3, t);
                    total += distance_xz(previous, point);
                    cumulative_length.push(total);
                    previous = point;
                }
                (total > f32::EPSILON).then_some(Self::Curve { p0, p1, p2, p3, cumulative_length })
            }
        }
    }

    /// `point` as (distance along the rail, height). Distance grows the way
    /// the rail is walked, so the whole face lands on one side of the origin.
    pub fn unroll(&self, point: [f32; 3]) -> [f32; 2] {
        match self {
            Self::Chord { origin, direction } => [
                (point[0] - origin[0]) * direction[0] + (point[2] - origin[1]) * direction[1],
                point[1],
            ],
            Self::Cylinder {
                center,
                radius,
                start_angle,
                total_sweep,
                clockwise,
            } => {
                let raw_swept = sweep(
                    *start_angle,
                    angle_xz(*center, [point[0], point[2]]),
                    *clockwise,
                );
                let swept = if raw_swept > std::f32::consts::TAU - 1e-3 {
                    0.0
                } else if *total_sweep > 0.0
                    && raw_swept > *total_sweep
                    && (raw_swept - *total_sweep) < 1e-3
                {
                    *total_sweep
                } else {
                    raw_swept
                };
                [radius * swept, point[1]]
            }
            Self::Curve { p0, p1, p2, p3, cumulative_length } => {
                let t = nearest_parameter(*p0, *p1, *p2, *p3, [point[0], point[2]]);
                let steps = cumulative_length.len() - 1;
                let position = t * steps as f32;
                let low = (position.floor() as usize).min(steps);
                let high = (low + 1).min(steps);
                let fraction = position - low as f32;
                let length = cumulative_length[low] + (cumulative_length[high] - cumulative_length[low]) * fraction;
                [length, point[1]]
            }
        }
    }

    /// The inverse of [`unroll`](Self::unroll): a point on the flattened face
    /// put back onto the surface it came from.
    ///
    /// What makes it worth having is that the flat place is where a
    /// triangulator is allowed to invent vertices. One it invents has no
    /// counterpart in the contour, so the only way back onto the wall is to
    /// roll it there.
    pub fn roll(&self, unrolled: [f32; 2]) -> [f32; 3] {
        match self {
            Self::Chord { origin, direction } => [
                origin[0] + direction[0] * unrolled[0],
                unrolled[1],
                origin[1] + direction[1] * unrolled[0],
            ],
            Self::Cylinder {
                center,
                radius,
                start_angle,
                clockwise,
                ..
            } => {
                let swept = unrolled[0] / radius;
                let angle = if *clockwise {
                    start_angle - swept
                } else {
                    start_angle + swept
                };
                [
                    center[0] + radius * angle.cos(),
                    unrolled[1],
                    center[1] + radius * angle.sin(),
                ]
            }
            Self::Curve { p0, p1, p2, p3, cumulative_length } => {
                let steps = cumulative_length.len() - 1;
                let target = unrolled[0].clamp(0.0, *cumulative_length.last().unwrap());
                // Binary search for the bracket `target` falls in --
                // `cumulative_length` is monotonically non-decreasing.
                let mut low = 0usize;
                let mut high = steps;
                while low + 1 < high {
                    let mid = (low + high) / 2;
                    if cumulative_length[mid] <= target {
                        low = mid;
                    } else {
                        high = mid;
                    }
                }
                let segment_length = (cumulative_length[high] - cumulative_length[low]).max(f32::EPSILON);
                let fraction = (target - cumulative_length[low]) / segment_length;
                let t = (low as f32 + fraction) / steps as f32;
                let xz = cubic_bezier_eval(*p0, *p1, *p2, *p3, t);
                [xz[0], unrolled[1], xz[1]]
            }
        }
    }

    /// The outward horizontal direction at `point` -- radial for a cylinder,
    /// constant for a chord, and the tangent's own perpendicular for a
    /// general curve (any consistent perpendicular does: `upright_face_mesh`
    /// already corrects a globally-flipped normal from its own winding
    /// check, so there is no separate "which side is outward" question to
    /// answer here).
    pub fn normal_at(&self, point: [f32; 3]) -> [f32; 3] {
        match self {
            Self::Chord { direction, .. } => [-direction[1], 0.0, direction[0]],
            Self::Cylinder { center, .. } => {
                let (dx, dz) = (point[0] - center[0], point[2] - center[1]);
                let length = (dx * dx + dz * dz).sqrt();
                if length <= f32::EPSILON {
                    [0.0, 0.0, 1.0]
                } else {
                    [dx / length, 0.0, dz / length]
                }
            }
            Self::Curve { p0, p1, p2, p3, .. } => {
                let t = nearest_parameter(*p0, *p1, *p2, *p3, [point[0], point[2]]);
                let tangent = cubic_bezier_tangent(*p0, *p1, *p2, *p3, t);
                [-tangent[1], 0.0, tangent[0]]
            }
        }
    }
}
