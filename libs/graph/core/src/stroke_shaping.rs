//! Shaping a drawn polyline into one a swept structure can be built along.
//!
//! What road-building games enforce on a stroke, whatever it sweeps: it never
//! crosses itself, it never turns tighter than its own width allows, and it
//! never climbs steeper than it can be driven. Here each is a repair, not a
//! refusal -- the caller gets the nearest stroke that holds, so what it
//! previews is what it builds. The two ends stay where they were put; only
//! the end height gives way, when the climb to it is too steep to make.
use crate::bezier::CurvePoint;

fn plan(a: CurvePoint, b: CurvePoint) -> f64 {
    (a[0] - b[0]).hypot(a[2] - b[2])
}

/// Where the plan segments `a`-`b` and `c`-`d` properly cross, as the
/// parameter along `a`-`b`; touching ends do not count.
fn crossing(a: CurvePoint, b: CurvePoint, c: CurvePoint, d: CurvePoint) -> Option<f64> {
    let r = [b[0] - a[0], b[2] - a[2]];
    let s = [d[0] - c[0], d[2] - c[2]];
    let denominator = r[0] * s[1] - r[1] * s[0];
    if denominator.abs() < 1e-12 {
        return None;
    }
    let q = [c[0] - a[0], c[2] - a[2]];
    let t = (q[0] * s[1] - q[1] * s[0]) / denominator;
    let u = (q[0] * r[1] - q[1] * r[0]) / denominator;
    const EDGE: f64 = 1e-9;
    (t > EDGE && t < 1. - EDGE && u > EDGE && u < 1. - EDGE).then_some(t)
}

/// `points` with every loop cut out: where the stroke crosses its own
/// earlier path, it goes straight on from the crossing and what it drew in
/// between is dropped. A road does not cross itself.
pub(crate) fn remove_loops(points: &[CurvePoint]) -> Vec<CurvePoint> {
    let mut path = points.to_vec();
    'scan: loop {
        for i in 0..path.len().saturating_sub(1) {
            for j in (i + 2)..path.len().saturating_sub(1) {
                if let Some(t) = crossing(path[i], path[i + 1], path[j], path[j + 1]) {
                    let at: CurvePoint =
                        std::array::from_fn(|k| path[i][k] + (path[i + 1][k] - path[i][k]) * t);
                    let mut next = path[..=i].to_vec();
                    next.push(at);
                    next.extend_from_slice(&path[j + 1..]);
                    path = next;
                    continue 'scan;
                }
            }
        }
        return path;
    }
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
        point[1] = point[1].clamp(low, high);
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
