//! Compact straight/arc fitting for a complete brush gesture.
//!
//! Pointer density is presentation input, not graph topology. This module
//! reduces the full batch to a small deterministic vocabulary before any
//! surface clipping occurs.

const EPSILON: f32 = 0.000_01;
const ARC_MUST_BEAT_LINE_RATIO: f32 = 0.8;
const MAX_ARC_STEP: f32 = std::f32::consts::FRAC_PI_8;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum StrokePrimitive {
    Point([f32; 2]),
    Line {
        start: [f32; 2],
        end: [f32; 2],
    },
    Arc {
        center: [f32; 2],
        radius: f32,
        start_angle: f32,
        sweep_angle: f32,
    },
}

impl StrokePrimitive {
    pub(crate) fn tessellated_centers(self, maximum_error: f32) -> Vec<[f32; 2]> {
        match self {
            Self::Point(point) => vec![point],
            Self::Line { start, end } => vec![start, end],
            Self::Arc {
                center,
                radius,
                start_angle,
                sweep_angle,
            } => {
                let relative_error = (maximum_error.max(EPSILON) / radius).clamp(0.0, 1.0);
                let error_limited_step = (2.0 * (1.0 - relative_error).acos())
                    .max(EPSILON)
                    .min(MAX_ARC_STEP);
                let steps = (sweep_angle.abs() / error_limited_step).ceil().max(1.0) as usize;
                (0..=steps)
                    .map(|step| {
                        let angle = start_angle + sweep_angle * step as f32 / steps as f32;
                        [
                            center[0] + radius * angle.cos(),
                            center[1] + radius * angle.sin(),
                        ]
                    })
                    .collect()
            }
        }
    }

    pub(crate) fn distance_to(self, point: [f32; 2]) -> f32 {
        match self {
            Self::Point(center) => distance_sq(point, center).sqrt(),
            Self::Line { start, end } => distance_to_segment(point, start, end),
            Self::Arc {
                center,
                radius,
                start_angle,
                sweep_angle,
            } => {
                let angle = (point[1] - center[1]).atan2(point[0] - center[0]);
                if angle_is_within_sweep(angle, start_angle, sweep_angle) {
                    (distance_sq(point, center).sqrt() - radius).abs()
                } else {
                    let end_angle = start_angle + sweep_angle;
                    let start = [
                        center[0] + radius * start_angle.cos(),
                        center[1] + radius * start_angle.sin(),
                    ];
                    let end = [
                        center[0] + radius * end_angle.cos(),
                        center[1] + radius * end_angle.sin(),
                    ];
                    distance_sq(point, start)
                        .min(distance_sq(point, end))
                        .sqrt()
                }
            }
        }
    }
}

pub(crate) fn distance_to_stroke(primitives: &[StrokePrimitive], point: [f32; 2]) -> f32 {
    primitives
        .iter()
        .map(|primitive| primitive.distance_to(point))
        .fold(f32::INFINITY, f32::min)
}

#[derive(Debug, Clone, Copy)]
struct CircleFit {
    center: [f32; 2],
    radius: f32,
    start_angle: f32,
    sweep_angle: f32,
    residual: f32,
}

pub(crate) fn fit_stroke(samples: &[[f32; 2]], tolerance: f32) -> Vec<StrokePrimitive> {
    let mut points = Vec::with_capacity(samples.len());
    for sample in samples {
        if points
            .last()
            .is_none_or(|previous| distance_sq(*previous, *sample) > EPSILON * EPSILON)
        {
            points.push(*sample);
        }
    }
    if points.is_empty() {
        return Vec::new();
    }
    if points.len() == 1 {
        return vec![StrokePrimitive::Point(points[0])];
    }

    let mut primitives = Vec::new();
    fit_span(&points, tolerance.max(EPSILON), &mut primitives);
    merge_collinear_lines(primitives, tolerance.max(EPSILON))
}

fn fit_span(points: &[[f32; 2]], tolerance: f32, output: &mut Vec<StrokePrimitive>) {
    let start = points[0];
    let end = points[points.len() - 1];
    if points.len() == 2 {
        output.push(StrokePrimitive::Line { start, end });
        return;
    }

    let (line_residual, split_index) = line_residual(points, start, end);
    if line_residual <= tolerance {
        output.push(StrokePrimitive::Line { start, end });
        return;
    }

    if let Some(circle) = circle_fit(points)
        && circle.residual <= tolerance
        && circle.residual <= line_residual * ARC_MUST_BEAT_LINE_RATIO
    {
        output.push(StrokePrimitive::Arc {
            center: circle.center,
            radius: circle.radius,
            start_angle: circle.start_angle,
            sweep_angle: circle.sweep_angle,
        });
        return;
    }

    let split_index = split_index.clamp(1, points.len() - 2);
    fit_span(&points[..=split_index], tolerance, output);
    fit_span(&points[split_index..], tolerance, output);
}

fn line_residual(points: &[[f32; 2]], start: [f32; 2], end: [f32; 2]) -> (f32, usize) {
    let dx = end[0] - start[0];
    let dz = end[1] - start[1];
    let length_sq = dx * dx + dz * dz;
    let mut maximum = 0.0;
    let mut maximum_index = points.len() / 2;

    for (index, point) in points.iter().enumerate().skip(1).take(points.len() - 2) {
        let distance = if length_sq <= EPSILON * EPSILON {
            distance_sq(*point, start).sqrt()
        } else {
            let t = (((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / length_sq)
                .clamp(0.0, 1.0);
            let projected = [start[0] + dx * t, start[1] + dz * t];
            distance_sq(*point, projected).sqrt()
        };
        if distance > maximum {
            maximum = distance;
            maximum_index = index;
        }
    }
    (maximum, maximum_index)
}

fn circle_fit(points: &[[f32; 2]]) -> Option<CircleFit> {
    let first = points[0];
    let middle = points[points.len() / 2];
    let last = points[points.len() - 1];
    let center = circumcenter(first, middle, last)?;
    let radius = distance_sq(first, center).sqrt();
    if !radius.is_finite() || radius <= EPSILON {
        return None;
    }

    let mut residual: f32 = 0.0;
    for point in points {
        residual = residual.max((distance_sq(*point, center).sqrt() - radius).abs());
    }

    let orientation = points
        .windows(2)
        .map(|pair| {
            let first = [pair[0][0] - center[0], pair[0][1] - center[1]];
            let second = [pair[1][0] - center[0], pair[1][1] - center[1]];
            first[0] * second[1] - first[1] * second[0]
        })
        .sum::<f32>()
        .signum();
    if orientation == 0.0 {
        return None;
    }

    let start_angle = (first[1] - center[1]).atan2(first[0] - center[0]);
    let mut previous_angle = start_angle;
    let mut sweep_angle = 0.0;
    for point in points.iter().skip(1) {
        let angle = (point[1] - center[1]).atan2(point[0] - center[0]);
        let mut delta = normalize_angle(angle - previous_angle);
        if orientation > 0.0 && delta < -EPSILON {
            delta += std::f32::consts::TAU;
        } else if orientation < 0.0 && delta > EPSILON {
            delta -= std::f32::consts::TAU;
        }
        if delta.abs() > std::f32::consts::PI {
            return None;
        }
        sweep_angle += delta;
        previous_angle = angle;
    }
    if sweep_angle.abs() <= EPSILON || sweep_angle.abs() >= std::f32::consts::TAU - EPSILON {
        return None;
    }

    Some(CircleFit {
        center,
        radius,
        start_angle,
        sweep_angle,
        residual,
    })
}

fn circumcenter(first: [f32; 2], middle: [f32; 2], last: [f32; 2]) -> Option<[f32; 2]> {
    let determinant = 2.0
        * (first[0] * (middle[1] - last[1])
            + middle[0] * (last[1] - first[1])
            + last[0] * (first[1] - middle[1]));
    if determinant.abs() <= EPSILON {
        return None;
    }
    let first_norm = first[0] * first[0] + first[1] * first[1];
    let middle_norm = middle[0] * middle[0] + middle[1] * middle[1];
    let last_norm = last[0] * last[0] + last[1] * last[1];
    Some([
        (first_norm * (middle[1] - last[1])
            + middle_norm * (last[1] - first[1])
            + last_norm * (first[1] - middle[1]))
            / determinant,
        (first_norm * (last[0] - middle[0])
            + middle_norm * (first[0] - last[0])
            + last_norm * (middle[0] - first[0]))
            / determinant,
    ])
}

fn merge_collinear_lines(primitives: Vec<StrokePrimitive>, tolerance: f32) -> Vec<StrokePrimitive> {
    let mut merged: Vec<StrokePrimitive> = Vec::with_capacity(primitives.len());
    for primitive in primitives {
        if let (
            Some(StrokePrimitive::Line {
                start: previous_start,
                end: previous_end,
            }),
            StrokePrimitive::Line { start, end },
        ) = (merged.last_mut(), primitive)
        {
            let direction = [
                previous_end[0] - previous_start[0],
                previous_end[1] - previous_start[1],
            ];
            let extension = [end[0] - start[0], end[1] - start[1]];
            let cross = direction[0] * extension[1] - direction[1] * extension[0];
            let scale = (distance_sq(*previous_start, *previous_end).sqrt()
                + distance_sq(start, end).sqrt())
            .max(1.0);
            if distance_sq(*previous_end, start) <= tolerance * tolerance
                && cross.abs() <= tolerance * scale
            {
                *previous_end = end;
                continue;
            }
        }
        merged.push(primitive);
    }
    merged
}

fn normalize_angle(mut angle: f32) -> f32 {
    while angle > std::f32::consts::PI {
        angle -= std::f32::consts::TAU;
    }
    while angle < -std::f32::consts::PI {
        angle += std::f32::consts::TAU;
    }
    angle
}

fn angle_is_within_sweep(angle: f32, start_angle: f32, sweep_angle: f32) -> bool {
    let offset = normalize_angle(angle - start_angle);
    if sweep_angle >= 0.0 {
        let positive_offset = if offset < 0.0 {
            offset + std::f32::consts::TAU
        } else {
            offset
        };
        positive_offset <= sweep_angle + EPSILON
    } else {
        let negative_offset = if offset > 0.0 {
            offset - std::f32::consts::TAU
        } else {
            offset
        };
        negative_offset >= sweep_angle - EPSILON
    }
}

fn distance_to_segment(point: [f32; 2], start: [f32; 2], end: [f32; 2]) -> f32 {
    let dx = end[0] - start[0];
    let dz = end[1] - start[1];
    let length_sq = dx * dx + dz * dz;
    if length_sq <= EPSILON * EPSILON {
        return distance_sq(point, start).sqrt();
    }
    let t = (((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / length_sq).clamp(0.0, 1.0);
    distance_sq(point, [start[0] + dx * t, start[1] + dz * t]).sqrt()
}

fn distance_sq(left: [f32; 2], right: [f32; 2]) -> f32 {
    let dx = left[0] - right[0];
    let dz = left[1] - right[1];
    dx * dx + dz * dz
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dense_straight_samples_fit_one_line() {
        let samples = (0..=200)
            .map(|index| [index as f32 * 0.01, 0.0])
            .collect::<Vec<_>>();
        assert_eq!(
            fit_stroke(&samples, 0.05),
            vec![StrokePrimitive::Line {
                start: [0.0, 0.0],
                end: [2.0, 0.0],
            }]
        );
    }

    #[test]
    fn circular_samples_fit_one_true_arc() {
        let samples = (0..=40)
            .map(|index| {
                let angle = std::f32::consts::PI * index as f32 / 40.0;
                [angle.cos(), angle.sin()]
            })
            .collect::<Vec<_>>();
        let fitted = fit_stroke(&samples, 0.01);
        assert_eq!(fitted.len(), 1);
        assert!(matches!(fitted[0], StrokePrimitive::Arc { .. }));
    }

    #[test]
    fn distance_uses_the_fitted_line_instead_of_pointer_samples() {
        let primitives = fit_stroke(&[[0.0, 0.0], [10.0, 0.0]], 0.01);
        assert!((distance_to_stroke(&primitives, [5.0, 0.25]) - 0.25).abs() < EPSILON);
    }

    #[test]
    fn distance_uses_the_true_arc() {
        let samples = (0..=20)
            .map(|index| {
                let angle = std::f32::consts::FRAC_PI_2 * index as f32 / 20.0;
                [angle.cos(), angle.sin()]
            })
            .collect::<Vec<_>>();
        let primitives = fit_stroke(&samples, 0.01);
        assert!(distance_to_stroke(&primitives, [0.5_f32.sqrt(), 0.5_f32.sqrt()]) < EPSILON);
        assert!(distance_to_stroke(&primitives, [-1.0, 0.0]) > 1.0);
    }
}
