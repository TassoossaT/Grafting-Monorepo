//! Frame mappings for developable upright surfaces (straight or curved walls).

use grafting_graph_core::ContourGeometry;

use crate::math::{angle_xz, distance_xz, sweep};

/// The flat frame an upright face unrolls into: one coordinate running
/// along its rail, one running up it.
///
/// A wall panel is developable, so this map loses nothing. `Chord` is the
/// straight case and `Cylinder` the curved one, and they are the same idea
/// -- a chord is an arc whose radius has gone to infinity.
#[derive(Debug, Clone, Copy)]
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
        }
    }

    /// Converts an unrolled (u, y) coordinate back into a 3D position on the developable surface.
    pub fn roll(&self, u: f32, y: f32) -> [f32; 3] {
        match self {
            Self::Chord { origin, direction } => [
                origin[0] + direction[0] * u,
                y,
                origin[1] + direction[1] * u,
            ],
            Self::Cylinder {
                center,
                radius,
                start_angle,
                clockwise,
                ..
            } => {
                let swept = u / radius;
                let angle = *start_angle + if *clockwise { -swept } else { swept };
                [
                    center[0] + radius * angle.cos(),
                    y,
                    center[1] + radius * angle.sin(),
                ]
            }
        }
    }

    /// The outward horizontal direction at `point` -- radial for a cylinder,
    /// constant for a chord.
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
        }
    }
}
