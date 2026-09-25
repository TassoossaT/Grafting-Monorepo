//! Curves that climb: a helix, and a plan curve graded between two heights.
//!
//! Both keep plan and height apart, the way ramp and stair tools do (a
//! plan run plus an elevation profile): the plan decides where the curve
//! goes, and the height is derived from it instead of being authored per
//! point. See `docs/research/ramps-and-spirals-creation-editing.md`.
use crate::bezier::{CubicBezier, CurvePoint};
use kurbo::{Arc, Point, Vec2};

/// Largest sweep one helix may cover, in turns; a guard, not a design limit.
const MAX_TURNS: f64 = 64.;

fn finite(values: &[f64]) -> Result<(), String> {
    if values.iter().all(|v| v.is_finite() && v.abs() <= 1e12) {
        Ok(())
    } else {
        Err("helix values must be finite".into())
    }
}

/// Heights along one span, climbing linearly in its parameter: the control
/// points take the thirds, so `y(t)` is exactly linear between the anchors.
fn climb(curve: &mut CubicBezier, from: f64, to: f64) {
    for (i, p) in curve.points.iter_mut().enumerate() {
        p[1] = from + (to - from) * i as f64 / 3.;
    }
}

/// A helix around `center` (its `y` is the starting height), `radius` out,
/// starting at `start_angle` and turning `sweep` radians -- positive from
/// +X towards +Z in plan, negative the other way -- while climbing `rise`
/// linearly in the angle.
///
/// The plan is an exact circular arc cut into cubics by `kurbo::Arc` within
/// `accuracy`, so the radius holds everywhere instead of wobbling between
/// interpolated points.
pub fn helix(
    center: CurvePoint,
    radius: f64,
    start_angle: f64,
    sweep: f64,
    rise: f64,
    accuracy: f64,
) -> Result<Vec<CubicBezier>, String> {
    finite(&[
        center[0],
        center[1],
        center[2],
        radius,
        start_angle,
        sweep,
        rise,
    ])?;
    if !accuracy.is_finite() || accuracy <= 0. {
        return Err("helix accuracy must be positive".into());
    }
    if radius <= 0. {
        return Err("helix radius must be positive".into());
    }
    if sweep == 0. || sweep.abs() > MAX_TURNS * std::f64::consts::TAU {
        return Err("helix sweep must be non-zero and bounded".into());
    }
    let arc = Arc::new(
        Point::new(center[0], center[2]),
        Vec2::new(radius, radius),
        start_angle,
        sweep,
        0.,
    );
    let mut plan = Vec::new();
    let mut from = Point::new(
        center[0] + radius * start_angle.cos(),
        center[2] + radius * start_angle.sin(),
    );
    arc.to_cubic_beziers(accuracy, |p1, p2, p3| {
        plan.push([from, p1, p2, p3]);
        from = p3;
    });
    // `kurbo` cuts the arc into equal angles, so each span's share of the
    // climb is its share of the sweep.
    let count = plan.len() as f64;
    Ok(plan
        .into_iter()
        .enumerate()
        .map(|(i, points)| {
            let mut curve = CubicBezier {
                points: points.map(|p| [p.x, 0., p.y]),
            };
            climb(
                &mut curve,
                center[1] + rise * i as f64 / count,
                center[1] + rise * (i + 1) as f64 / count,
            );
            curve
        })
        .collect())
}

/// `curves`, a chain in order, with its heights redistributed from `start`
/// to `end` in proportion to plan length, so the whole chain climbs at one
/// constant grade whatever its plan does. Plan positions are untouched.
pub fn grade(
    curves: &[CubicBezier],
    start: f64,
    end: f64,
    accuracy: f64,
) -> Result<Vec<CubicBezier>, String> {
    finite(&[start, end])?;
    if curves.is_empty() {
        return Err("a graded chain needs at least one curve".into());
    }
    let lengths = curves
        .iter()
        .map(|c| c.length(accuracy))
        .collect::<Result<Vec<_>, _>>()?;
    let total: f64 = lengths.iter().sum();
    if total <= 1e-9 {
        return Err("a graded chain needs plan length".into());
    }
    let mut run = 0.;
    Ok(curves
        .iter()
        .zip(&lengths)
        .map(|(curve, length)| {
            let mut graded = *curve;
            let from = start + (end - start) * run / total;
            run += length;
            climb(&mut graded, from, start + (end - start) * run / total);
            graded
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::{FRAC_PI_2, TAU};

    #[test]
    fn a_helix_keeps_its_radius_and_climbs_linearly() {
        let spans = helix([1., 2., -1.], 3., 0., 2. * TAU, 6., 1e-3).unwrap();
        assert!(spans.len() >= 8, "at least one span per quarter turn");
        for span in &spans {
            for i in 0..=20 {
                let p = span.evaluate(i as f64 / 20.).unwrap();
                let r = ((p[0] - 1.).powi(2) + (p[2] + 1.).powi(2)).sqrt();
                assert!((r - 3.).abs() < 2e-3, "radius drifted to {r}");
            }
        }
        assert_eq!(spans[0].points[0], [4., 2., -1.]);
        let last = spans.last().unwrap().points[3];
        assert!(
            (last[1] - 8.).abs() < 1e-9
                && (last[0] - 4.).abs() < 1e-6
                && (last[2] + 1.).abs() < 1e-6
        );
        for pair in spans.windows(2) {
            assert_eq!(pair[0].points[3], pair[1].points[0], "spans are continuous");
        }
    }

    #[test]
    fn a_negative_sweep_turns_clockwise() {
        let spans = helix([0., 0., 0.], 1., 0., -FRAC_PI_2, 1., 1e-3).unwrap();
        let end = spans.last().unwrap().points[3];
        assert!(end[0].abs() < 1e-9 && (end[2] + 1.).abs() < 1e-9, "{end:?}");
    }

    #[test]
    fn invalid_helices_are_refused() {
        assert!(helix([0., 0., 0.], 0., 0., 1., 1., 1e-3).is_err());
        assert!(helix([0., 0., 0.], 1., 0., 0., 1., 1e-3).is_err());
        assert!(helix([0., 0., 0.], 1., 0., f64::NAN, 1., 1e-3).is_err());
    }

    #[test]
    fn grading_spreads_the_climb_by_plan_length_and_keeps_the_plan() {
        let short = CubicBezier {
            points: [[0., 5., 0.], [1., 5., 0.], [2., 5., 0.], [3., 5., 0.]],
        };
        let long = CubicBezier {
            points: [[3., 0., 0.], [5., 0., 0.], [7., 0., 0.], [9., 9., 0.]],
        };
        let graded = grade(&[short, long], 0., 9., 1e-4).unwrap();
        assert!(
            (graded[0].points[3][1] - 3.).abs() < 1e-6,
            "a third of the plan length takes a third of the climb"
        );
        assert!((graded[1].points[3][1] - 9.).abs() < 1e-9);
        for (before, after) in [short, long].iter().zip(&graded) {
            for (b, a) in before.points.iter().zip(&after.points) {
                assert_eq!((b[0], b[2]), (a[0], a[2]), "plan untouched");
            }
        }
        assert!((graded[1].length(1e-6).unwrap() - 6.).abs() < 1e-6);
    }

    #[test]
    fn a_chain_without_plan_length_cannot_be_graded() {
        let point = CubicBezier {
            points: [[1., 0., 1.]; 4],
        };
        assert!(grade(&[point], 0., 1., 1e-4).is_err());
        assert!(grade(&[], 0., 1., 1e-4).is_err());
    }
}
