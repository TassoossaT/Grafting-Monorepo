//! Shaping a drawn polyline into one a swept structure can be built along.
//!
//! What road-building games enforce on a stroke, whatever it sweeps: it never
//! crosses itself, it never turns tighter than its own width allows, and it
//! never climbs steeper than it can be driven. Here each is a repair, not a
//! refusal -- the caller gets the nearest stroke that holds, so what it
//! previews is what it builds. The two ends stay where they were put; only
//! the end height gives way, when the climb to it is too steep to make.
use crate::bezier::CurvePoint;

/// Plan distance between two points -- heights ignored.
pub(crate) fn plan(a: CurvePoint, b: CurvePoint) -> f64 {
    (a[0] - b[0]).hypot(a[2] - b[2])
}

/// Where the plan segments `a`-`b` and `c`-`d` properly cross, as the
/// parameter along `a`-`b`; touching ends do not count.
fn crossing(a: CurvePoint, b: CurvePoint, c: CurvePoint, d: CurvePoint) -> Option<f64> {
    const EDGE: f64 = 1e-9;
    let (t, u) = crate::bezier_network::segment_crossing(a, b, c, d)?;
    (t > EDGE && t < 1. - EDGE && u > EDGE && u < 1. - EDGE).then_some(t)
}

/// `points` with every loop cut out: where the stroke crosses its own
/// earlier path, it goes straight on from the crossing and what it drew in
/// between is dropped. A road does not cross itself.
pub(crate) fn remove_loops(points: &[CurvePoint]) -> Vec<CurvePoint> {
    let mut path = points.to_vec();
    // Segments before `i` were already checked against all that follows, and
    // a cut only drops what came after them: the scan resumes where it cut.
    let mut i = 0;
    while i + 1 < path.len() {
        let cut = ((i + 2)..path.len().saturating_sub(1)).find_map(|j| crossing(path[i], path[i + 1], path[j], path[j + 1]).map(|t| (j, t)));
        match cut {
            Some((j, t)) => {
                let at: CurvePoint = std::array::from_fn(|k| path[i][k] + (path[i + 1][k] - path[i][k]) * t);
                path.splice(i + 1..=j, [at]);
            }
            None => i += 1,
        }
    }
    path
}

/// The radius of the circle through three points, in plan; infinite when in line.
fn turning_radius(a: CurvePoint, b: CurvePoint, c: CurvePoint) -> f64 {
    let area2 = ((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])).abs();
    if area2 < 1e-12 {
        return f64::INFINITY;
    }
    plan(a, b) * plan(b, c) * plan(a, c) / (2. * area2)
}

/// `points` resampled in plan every `step`, ends kept, heights carried along.
fn resample(points: &[CurvePoint], step: f64) -> Vec<CurvePoint> {
    let total: f64 = points.windows(2).map(|w| plan(w[0], w[1])).sum();
    let count = (total / step).ceil().max(1.) as usize;
    let spacing = total / count as f64;
    let mut out = vec![points[0]];
    let (mut segment, mut walked) = (0, 0.);
    for k in 1..count {
        let target = spacing * k as f64;
        while segment + 1 < points.len() - 1
            && walked + plan(points[segment], points[segment + 1]) < target
        {
            walked += plan(points[segment], points[segment + 1]);
            segment += 1;
        }
        let length = plan(points[segment], points[segment + 1]);
        let t = if length < 1e-12 {
            0.
        } else {
            ((target - walked) / length).clamp(0., 1.)
        };
        out.push(std::array::from_fn(|i| {
            points[segment][i] + (points[segment + 1][i] - points[segment][i]) * t
        }));
    }
    out.push(*points.last().unwrap());
    out
}

/// `points` eased, in plan, until it nowhere turns tighter than `min_radius`;
/// the ends stay put and heights are untouched. A turn too tight to sweep
/// the structure's width around folds its inner edge over itself.
pub(crate) fn limit_curvature(points: &[CurvePoint], min_radius: f64) -> Vec<CurvePoint> {
    if points.len() < 3 || min_radius.is_nan() || min_radius <= 0. {
        return points.to_vec();
    }
    let mut path = resample(points, min_radius * 0.5);
    for _ in 0..400 {
        let mut eased = false;
        for i in 1..path.len() - 1 {
            if turning_radius(path[i - 1], path[i], path[i + 1]) < min_radius {
                let (a, c) = (path[i - 1], path[i + 1]);
                path[i][0] = 0.5 * path[i][0] + 0.25 * (a[0] + c[0]);
                path[i][2] = 0.5 * path[i][2] + 0.25 * (a[2] + c[2]);
                eased = true;
            }
        }
        if !eased {
            break;
        }
    }
    path
}

/// `points` with heights held to within `max_grade` rise per plan length,
/// the start at its own height. The end keeps its own where the climb to it
/// can be made at that grade, and stops as near as it can where it cannot;
/// in between, each point keeps the height it was drawn at wherever the
/// grade allows.
pub(crate) fn limit_grade(points: &[CurvePoint], max_grade: f64) -> Vec<CurvePoint> {
    if points.len() < 2 || max_grade.is_nan() || max_grade <= 0. {
        return points.to_vec();
    }
    let mut along = vec![0.];
    for w in points.windows(2) {
        along.push(along.last().unwrap() + plan(w[0], w[1]));
    }
    let total = *along.last().unwrap();
    let start = points[0][1];
    let end = points.last().unwrap()[1].clamp(start - max_grade * total, start + max_grade * total);
    let mut out = points.to_vec();
    // Within reach of both ends at the grade, then no step steeper than it.
    for (i, point) in out.iter_mut().enumerate() {
        let low = (start - max_grade * along[i]).max(end - max_grade * (total - along[i]));
        let high = (start + max_grade * along[i]).min(end + max_grade * (total - along[i]));
        // At a steepest-possible end the two bounds meet, and rounding can cross them.
        point[1] = point[1].clamp(low.min(high), high.max(low));
    }
    for i in 1..out.len() {
        let step = max_grade * (along[i] - along[i - 1]);
        out[i][1] = out[i][1].clamp(out[i - 1][1] - step, out[i - 1][1] + step);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_loop_is_cut_at_its_crossing() {
        let points = [
            [0., 0., 0.],
            [4., 0., 0.],
            [4., 0., 2.],
            [2., 0., 2.],
            [2., 0., -2.],
            [2., 0., -6.],
        ];
        let path = remove_loops(&points);
        assert_eq!(path.len(), 4, "{path:?}");
        assert!((path[1][0] - 2.).abs() < 1e-9 && path[1][2].abs() < 1e-9);
        assert_eq!(*path.last().unwrap(), [2., 0., -6.]);
    }

    #[test]
    fn a_tight_zigzag_is_eased_to_the_minimum_radius_with_its_ends_kept() {
        let points: Vec<_> = (0..=40)
            .map(|i| [i as f64 * 0.5, 0., if i % 2 == 0 { 0. } else { 1. }])
            .collect();
        let path = limit_curvature(&points, 3.);
        assert_eq!(path[0], points[0]);
        assert_eq!(*path.last().unwrap(), *points.last().unwrap());
        for w in path.windows(3) {
            assert!(turning_radius(w[0], w[1], w[2]) >= 3. - 1e-6);
        }
    }

    #[test]
    fn a_climb_too_steep_stops_short_and_a_gentle_one_is_kept() {
        let steep = limit_grade(&[[0., 0., 0.], [3., 4., 0.]], 0.2);
        assert!((steep[1][1] - 0.6).abs() < 1e-9);
        let gentle = limit_grade(&[[0., 0., 0.], [10., 1., 0.]], 0.2);
        assert_eq!(gentle[1][1], 1.);
    }

    #[test]
    fn an_end_at_exactly_the_steepest_reach_never_crosses_its_bounds() {
        let points: Vec<_> = (0..=97)
            .map(|i| {
                [
                    i as f64 * 0.137,
                    3.2082262 * (i as f64 / 97.),
                    0.3 * i as f64,
                ]
            })
            .collect();
        for grade in [0.2, 0.1, 0.05, 0.333] {
            let path = limit_grade(&points, grade);
            assert!(path.iter().all(|p| p[1].is_finite()));
        }
    }

    #[test]
    fn ground_between_the_ends_is_kept_where_the_grade_allows() {
        let points: Vec<_> = (0..=20)
            .map(|i| [i as f64, if i == 10 { 5. } else { 0. }, 0.])
            .collect();
        let path = limit_grade(&points, 0.2);
        assert_eq!(path.last().unwrap()[1], 0.);
        assert!(
            (path[10][1] - 0.2).abs() < 1e-9,
            "a spike is cut to one step: {}",
            path[10][1]
        );
        for w in path.windows(2) {
            assert!((w[1][1] - w[0][1]).abs() <= 0.2 + 1e-9);
        }
    }
}
