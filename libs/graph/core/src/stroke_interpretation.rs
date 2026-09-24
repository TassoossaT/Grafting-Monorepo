//! Brush-area interpretation extracted from the existing wall curve fitter.
use crate::bezier::{CubicBezier, CurvePoint};

fn distance(a: CurvePoint, b: CurvePoint) -> f64 {
    (a[0] - b[0]).hypot(a[2] - b[2])
}
fn line(a: CurvePoint, b: CurvePoint) -> CubicBezier {
    CubicBezier {
        points: [
            a,
            std::array::from_fn(|i| a[i] + (b[i] - a[i]) / 3.),
            std::array::from_fn(|i| a[i] + 2. * (b[i] - a[i]) / 3.),
            b,
        ],
    }
}
fn parameters(points: &[CurvePoint]) -> Vec<f64> {
    let mut lengths = vec![0.];
    for pair in points.windows(2) {
        lengths.push(lengths.last().unwrap() + distance(pair[0], pair[1]));
    }
    let total = *lengths.last().unwrap();
    if total > 1e-6 {
        for value in &mut lengths {
            *value /= total;
        }
    }
    lengths
}
fn direction(a: CurvePoint, b: CurvePoint) -> Option<[f64; 2]> {
    let length = distance(a, b);
    (length >= 1e-9).then(|| [(b[0] - a[0]) / length, (b[2] - a[2]) / length])
}
fn candidate(points: &[CurvePoint], parameters: &[f64]) -> CubicBezier {
    let a = points[0];
    let b = *points.last().unwrap();
    let fallback = line(a, b);
    let Some(t1) = direction(a, points[1]) else {
        return fallback;
    };
    let Some(t2) = direction(b, points[points.len() - 2]) else {
        return fallback;
    };
    let (mut a11, mut a12, mut a22, mut c1, mut c2) = (0., 0., 0., 0., 0.);
    for (point, &u) in points.iter().zip(parameters).skip(1).take(points.len() - 2) {
        let v = 1. - u;
        let b1 = 3. * u * v * v;
        let b2 = 3. * u * u * v;
        let rx = point[0] - ((v * v * v + b1) * a[0] + (b2 + u * u * u) * b[0]);
        let rz = point[2] - ((v * v * v + b1) * a[2] + (b2 + u * u * u) * b[2]);
        a11 += b1 * b1;
        a12 += b1 * b2 * (t1[0] * t2[0] + t1[1] * t2[1]);
        a22 += b2 * b2;
        c1 += b1 * (rx * t1[0] + rz * t1[1]);
        c2 += b2 * (rx * t2[0] + rz * t2[1]);
    }
    let determinant: f64 = a11 * a22 - a12 * a12;
    if determinant.abs() < 1e-9 {
        return fallback;
    }
    let alpha1 = (c1 * a22 - c2 * a12) / determinant;
    let alpha2 = (a11 * c2 - a12 * c1) / determinant;
    if !alpha1.is_finite()
        || !alpha2.is_finite()
        || alpha1 <= distance(a, b) * 1e-3
        || alpha2 <= distance(a, b) * 1e-3
    {
        return fallback;
    }
    CubicBezier {
        points: [
            a,
            [
                a[0] + t1[0] * alpha1,
                a[1] + (b[1] - a[1]) / 3.,
                a[2] + t1[1] * alpha1,
            ],
            [
                b[0] + t2[0] * alpha2,
                a[1] + 2. * (b[1] - a[1]) / 3.,
                b[2] + t2[1] * alpha2,
            ],
            b,
        ],
    }
}

// Elevation is independent of the lateral brush correction budget.
const HEIGHT_TOLERANCE: f64 = 0.025;

fn fit_height(curve: &mut CubicBezier, points: &[CurvePoint], parameters: &[f64]) {
    let (mut aa, mut ab, mut bb, mut ay, mut by) = (0., 0., 0., 0., 0.);
    for (point, &u) in points.iter().zip(parameters) {
        let v = 1. - u;
        let a = 3. * u * v * v;
        let b = 3. * u * u * v;
        let y = point[1] - v.powi(3) * curve.points[0][1] - u.powi(3) * curve.points[3][1];
        aa += a * a;
        ab += a * b;
        bb += b * b;
        ay += a * y;
        by += b * y;
    }
    let determinant: f64 = aa * bb - ab * ab;
    if determinant.abs() > 1e-9 {
        curve.points[1][1] = (ay * bb - by * ab) / determinant;
        curve.points[2][1] = (by * aa - ay * ab) / determinant;
    }
}

/// Returns cubic spans and their straight/curved classification. The correction
/// budget measures captured XZ samples, not tessellation density or mesh validity.
pub(crate) fn interpret(
    points: &[CurvePoint],
    correction: f64,
    curved: bool,
) -> Result<Vec<(CubicBezier, bool)>, String> {
    if !correction.is_finite() || correction < 0. {
        return Err("stroke correction must be finite and non-negative".into());
    }
    if points.len() > 4096 {
        return Err("stroke sample budget exceeded".into());
    }
    if points.iter().flatten().any(|v| !v.is_finite()) {
        return Err("stroke coordinates must be finite".into());
    }
    let mut clean = Vec::new();
    for &point in points {
        if clean.last() != Some(&point) {
            clean.push(point);
        }
    }
    if clean.len() < 2 {
        return Ok(Vec::new());
    }
    let mut pending = vec![(0, clean.len() - 1)];
    let mut result = Vec::new();
    while let Some((start, end)) = pending.pop() {
        let span = &clean[start..=end];
        let a = span[0];
        let b = *span.last().unwrap();
        let chord = distance(a, b);
        let mut straight = 0.;
        let mut split = 1;
        let mut height_error = 0.;
        let mut height_split = 1;
        for (i, &point) in span.iter().enumerate().skip(1).take(span.len() - 2) {
            // Clamp to the segment so collinear backtracking is not erased.
            let t = if chord < 1e-6 {
                0.
            } else {
                (((point[0] - a[0]) * (b[0] - a[0]) + (point[2] - a[2]) * (b[2] - a[2]))
                    / (chord * chord))
                    .clamp(0., 1.)
            };
            let deviation =
                (point[0] - a[0] - t * (b[0] - a[0])).hypot(point[2] - a[2] - t * (b[2] - a[2]));
            let height_deviation = (point[1] - a[1] - t * (b[1] - a[1])).abs();
            if height_deviation > height_error {
                height_error = height_deviation;
                height_split = i;
            }
            if deviation > straight {
                straight = deviation;
                split = i;
            }
        }
        let cubic = if curved && span.len() >= 4 && chord >= 1e-6 {
            let parameters = parameters(span);
            let mut curve = candidate(span, &parameters);
            fit_height(&mut curve, span, &parameters);
            Some(curve)
        } else {
            None
        };
        let mut residual = f64::INFINITY;
        let mut height_residual = f64::INFINITY;
        if let Some(c) = cubic {
            residual = 0.;
            height_residual = 0.;
            for (&point, u) in span.iter().zip(parameters(span)) {
                let fitted = c.evaluate(u)?;
                residual = residual.max(distance(point, fitted));
                height_residual = height_residual.max((point[1] - fitted[1]).abs());
            }
        }
        let line_fits = straight <= correction && height_error <= HEIGHT_TOLERANCE;
        let curve_fits = residual <= correction && height_residual <= HEIGHT_TOLERANCE;
        if !line_fits && !curve_fits && span.len() > 2 {
            if height_error > HEIGHT_TOLERANCE {
                split = height_split;
            }
            pending.push((start + split, end));
            pending.push((start, start + split));
            continue;
        }
        let choose_curve =
            curve_fits && (!line_fits || (residual < chord * 0.3 && residual < straight * 0.6));
        let selected = if choose_curve {
            cubic.unwrap()
        } else {
            line(a, b)
        };
        selected.validate()?;
        if chord > 1e-9 || (a[1] - b[1]).abs() > 1e-9 {
            result.push((selected, !choose_curve));
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn brush_budget_reduces_noise_and_keeps_endpoints() {
        let points: Vec<_> = (0..=160)
            .map(|i| {
                let t = i as f64 / 160.;
                [
                    20. * t,
                    0.,
                    4. * (std::f64::consts::PI * t).sin()
                        + 0.15 * (32. * std::f64::consts::PI * t).sin(),
                ]
            })
            .collect();
        let spans = interpret(&points, 1., true).unwrap();
        assert!(spans.len() < 10, "{} spans", spans.len());
        assert_eq!(spans[0].0.points[0], points[0]);
        assert_eq!(spans.last().unwrap().0.points[3], *points.last().unwrap());
    }
    #[test]
    fn zero_budget_preserves_corners_and_backtracking() {
        let points = [[0., 0., 0.], [4., 0., 0.], [2., 0., 0.], [2., 0., 3.]];
        let spans = interpret(&points, 0., true).unwrap();
        assert_eq!(spans.len(), 3);
        assert!(spans.iter().all(|s| s.1));
    }
    #[test]
    fn terrain_hill_is_not_flattened_by_a_wide_brush() {
        let points: Vec<_> = (0..=40)
            .map(|i| {
                let t = i as f64 / 40.;
                [20. * t, 12. * t * (1. - t), 0.]
            })
            .collect();
        let spans = interpret(&points, 10., true).unwrap();
        assert_eq!(spans.len(), 1);
        assert!(!spans[0].1);
        for (i, point) in points.iter().enumerate() {
            assert!((spans[0].0.evaluate(i as f64 / 40.).unwrap()[1] - point[1]).abs() < 1e-8);
        }
    }

    #[test]
    fn invalid_and_duplicate_samples_are_explicit() {
        assert!(interpret(&[[f64::NAN, 0., 0.]], 1., true).is_err());
        assert!(interpret(&[], -1., true).is_err());
        assert!(interpret(&[[1., 0., 2.]; 3], 0., true).unwrap().is_empty());
    }
}
