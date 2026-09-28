//! Curves that climb: a helix, and a plan curve graded between two heights.
//!
//! Both keep plan and height apart, the way ramp and stair tools do (a
//! plan run plus an elevation profile): the plan decides where the curve
//! goes, and the height is derived from it instead of being authored per
//! point. See `docs/research/ramps-and-spirals-creation-editing.md`.
use crate::bezier::{CubicBezier, CurveHandles, CurvePoint, HandleMode, SpanGeometry};
use std::f64::consts::{FRAC_PI_2, TAU};

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

/// One span of a shaped curve: the cubic it resolves to, and the handles
/// that keep its shape when its anchors move.
pub type ShapedSpan = (CubicBezier, CurveHandles);

/// The span `handles` shaped by `geometry` between `a` and `b`.
fn shaped(geometry: SpanGeometry, a: CurvePoint, b: CurvePoint) -> ShapedSpan {
    let mut handles = CurveHandles::from_curve(
        CubicBezier {
            points: [a, a, b, b],
        },
        HandleMode::Aligned,
        Vec::new(),
    );
    handles.geometry = Some(geometry);
    let curve = handles.resolve(a, b);
    let mut handles = CurveHandles::from_curve(curve, HandleMode::Aligned, Vec::new());
    handles.geometry = Some(geometry);
    (curve, handles)
}

/// An arc around `center` cut into spans of at most a quarter turn -- where
/// one cubic holds a circle to about 0.03% -- easing the radius and the
/// height linearly from start to end in the angle. `ends`, when given, are
/// taken as the first and last anchors exactly, so a span meant to land on a
/// clicked point lands on it rather than on its trigonometric neighbour.
fn arc_spans(
    center: [f64; 2],
    radii: [f64; 2],
    start_angle: f64,
    sweep: f64,
    heights: [f64; 2],
    ends: Option<[CurvePoint; 2]>,
) -> Vec<ShapedSpan> {
    let count = (sweep.abs() / FRAC_PI_2 - 1e-9).ceil().max(1.) as usize;
    let geometry = SpanGeometry::Arc {
        center,
        positive: sweep > 0.,
    };
    let anchor = |i: usize| {
        match ends {
            Some([first, _]) if i == 0 => return first,
            Some([_, last]) if i == count => return last,
            _ => {}
        }
        let f = i as f64 / count as f64;
        let (angle, radius) = (
            start_angle + sweep * f,
            radii[0] + (radii[1] - radii[0]) * f,
        );
        [
            center[0] + radius * angle.cos(),
            heights[0] + (heights[1] - heights[0]) * f,
            center[1] + radius * angle.sin(),
        ]
    };
    (0..count)
        .map(|i| shaped(geometry, anchor(i), anchor(i + 1)))
        .collect()
}

/// A helix around `center` (its `y` is the starting height), `radius` out,
/// starting at `start_angle` and turning `sweep` radians -- positive from
/// +X towards +Z in plan, negative the other way -- while climbing `rise`
/// linearly in the angle.
///
/// Every span is a circular arc of at most a quarter turn and carries that
/// shape in its handles, so the radius holds everywhere, and keeps holding
/// after an anchor is moved.
pub fn helix(
    center: CurvePoint,
    radius: f64,
    start_angle: f64,
    sweep: f64,
    rise: f64,
) -> Result<Vec<ShapedSpan>, String> {
    finite(&[
        center[0],
        center[1],
        center[2],
        radius,
        start_angle,
        sweep,
        rise,
    ])?;
    if radius <= 0. {
        return Err("helix radius must be positive".into());
    }
    if sweep == 0. || sweep.abs() > MAX_TURNS * TAU {
        return Err("helix sweep must be non-zero and bounded".into());
    }
    Ok(arc_spans(
        [center[0], center[2]],
        [radius, radius],
        start_angle,
        sweep,
        [center[1], center[1] + rise],
        None,
    ))
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

/// The spans from `start` through `through` to `end`: the circular arc
/// through the three in plan, cut into quarter turns, or one straight span
/// when they are in line. Heights climb linearly from `start` to `end`. What
/// a two-point arc tool draws, and what a straight or circular span's
/// midpoint drag makes of it -- pulling its bulge.
pub fn arc_through(
    start: CurvePoint,
    through: CurvePoint,
    end: CurvePoint,
) -> Result<Vec<ShapedSpan>, String> {
    finite(&[
        start[0], start[1], start[2], through[0], through[1], through[2], end[0], end[1], end[2],
    ])?;
    let (ax, az, bx, bz, cx, cz) = (start[0], start[2], through[0], through[2], end[0], end[2]);
    let d = 2. * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
    let extent = (cx - ax).hypot(cz - az).max((bx - ax).hypot(bz - az));
    if extent < 1e-9 {
        return Err("an arc needs distinct points".into());
    }
    if d.abs() < 1e-9 * extent * extent {
        return Ok(vec![shaped(SpanGeometry::Line, start, end)]);
    }
    let (a2, b2, c2) = (ax * ax + az * az, bx * bx + bz * bz, cx * cx + cz * cz);
    let center = [
        (a2 * (bz - cz) + b2 * (cz - az) + c2 * (az - bz)) / d,
        (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d,
    ];
    // Visiting start, through, end in order is the positive turn when the
    // three wind positively.
    let positive = (bx - ax) * (cz - az) - (bz - az) * (cx - ax) > 0.;
    let (ta, tc) = (
        (az - center[1]).atan2(ax - center[0]),
        (cz - center[1]).atan2(cx - center[0]),
    );
    let mut sweep = tc - ta;
    if positive {
        while sweep <= 0. {
            sweep += TAU;
        }
    } else {
        while sweep >= 0. {
            sweep -= TAU;
        }
    }
    let radius = (ax - center[0]).hypot(az - center[1]);
    Ok(arc_spans(
        center,
        [radius, radius],
        ta,
        sweep,
        [start[1], end[1]],
        Some([start, end]),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_helix_keeps_its_radius_and_climbs_linearly() {
        let spans: Vec<_> = helix([1., 2., -1.], 3., 0., 2. * TAU, 6.)
            .unwrap()
            .into_iter()
            .map(|(c, _)| c)
            .collect();
        assert_eq!(spans.len(), 8, "one span per quarter turn");
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
        let spans = helix([0., 0., 0.], 1., 0., -FRAC_PI_2, 1.).unwrap();
        let end = spans.last().unwrap().0.points[3];
        assert!(end[0].abs() < 1e-9 && (end[2] + 1.).abs() < 1e-9, "{end:?}");
    }

    #[test]
    fn invalid_helices_are_refused() {
        assert!(helix([0., 0., 0.], 0., 0., 1., 1.).is_err());
        assert!(helix([0., 0., 0.], 1., 0., 0., 1.).is_err());
        assert!(helix([0., 0., 0.], 1., 0., f64::NAN, 1.).is_err());
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
    fn three_points_give_the_arc_through_them_in_quarter_turns() {
        let spans = arc_through([1., 0., 0.], [0., 1., 1.], [-1., 2., 0.]).unwrap();
        assert_eq!(spans.len(), 2, "a half turn is two quarter turns");
        for (curve, handles) in &spans {
            let Some(SpanGeometry::Arc { center, positive }) = handles.geometry else {
                panic!("{handles:?}")
            };
            assert!(center[0].abs() < 1e-9 && center[1].abs() < 1e-9 && positive);
            for i in 0..=10 {
                let p = curve.evaluate(i as f64 / 10.).unwrap();
                assert!((p[0].hypot(p[2]) - 1.).abs() < 5e-4, "on the circle: {p:?}");
            }
        }
        assert!(
            (spans[0].0.points[3][1] - 1.).abs() < 1e-9,
            "climbs linearly"
        );
        assert_eq!(spans[1].0.points[3], [-1., 2., 0.]);
        let flipped = arc_through([1., 0., 0.], [0., 0., -1.], [-1., 0., 0.]).unwrap();
        assert!(matches!(
            flipped[0].1.geometry,
            Some(SpanGeometry::Arc {
                positive: false,
                ..
            })
        ));
    }

    #[test]
    fn three_points_in_line_give_a_straight_span() {
        let spans = arc_through([0., 0., 0.], [1., 5., 1.], [2., 1., 2.]).unwrap();
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].1.geometry, Some(SpanGeometry::Line));
        assert!(arc_through([1., 0., 1.], [1., 0., 1.], [1., 3., 1.]).is_err());
    }

    #[test]
    fn a_shaped_span_keeps_its_shape_when_an_anchor_moves() {
        let (_, mut h) =
            arc_through([1., 0., 0.], [0.7071, 0., 0.7071], [0., 0., 1.]).unwrap()[0].clone();
        // The end anchor slides further round the same circle: still a clean arc.
        let end = [-0.5, 4., 0.8660254037844386];
        let curve = h.resolve([1., 0., 0.], end);
        for i in 0..=10 {
            let p = curve.evaluate(i as f64 / 10.).unwrap();
            assert!((p[0].hypot(p[2]) - 1.).abs() < 2e-3, "{p:?}");
        }
        h.geometry = Some(SpanGeometry::Line);
        let line = h.resolve([0., 0., 0.], [3., 3., 0.]);
        assert_eq!(line.points[1], [1., 1., 0.]);
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
