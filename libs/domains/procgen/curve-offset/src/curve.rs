//! Catmull-Rom curve sampling.

use crate::types::{Point, Polyline};

/// Recursion cap on curve flattening, so a degenerate curve (near-zero
/// tolerance, or control points that never converge under the sagitta test)
/// cannot recurse without bound.
const MAX_DEPTH: u32 = 16;

fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1]]
}

fn add(a: Point, b: Point) -> Point {
    [a[0] + b[0], a[1] + b[1]]
}

fn scale(a: Point, factor: f32) -> Point {
    [a[0] * factor, a[1] * factor]
}

fn distance(a: Point, b: Point) -> f32 {
    let d = sub(a, b);
    (d[0] * d[0] + d[1] * d[1]).sqrt()
}

fn lerp(a: Point, b: Point, fraction: f32) -> Point {
    add(a, scale(sub(b, a), fraction))
}

/// `lerp(a, b, numerator / denominator)`, except a near-zero denominator
/// (two coincident control points -- `reflect` can produce one when the
/// original neighbours were already close together) returns `a` outright
/// instead of dividing by it. `a` and `b` are the same point in that case
/// anyway, so this changes nothing about the curve, only avoids a NaN.
fn safe_lerp(a: Point, b: Point, numerator: f32, denominator: f32) -> Point {
    if denominator.abs() < 1e-9 {
        a
    } else {
        lerp(a, b, numerator / denominator)
    }
}

/// One point on the **centripetal** Catmull-Rom curve running from `p1` to
/// `p2`, at `local_t` (`0` at `p1`, `1` at `p2`), shaped by the neighbours
/// `p0`/`p3` on either side.
///
/// **Why centripetal, not uniform.** The control points a real caller hands
/// this are not evenly spaced -- a road spine spaces them by how much the
/// curve actually needs, a long straight stretch far fewer than a tight
/// corner -- and *uniform* Catmull-Rom assumes every span takes the same
/// parameter distance regardless of how far apart its points actually are.
/// On an uneven spacing that assumption is wrong exactly where a long
/// straight run meets a tight corner, and the curve overshoots into a cusp
/// or a loop right at the transition.
///
/// The centripetal parametrization (`t` growing by the *square root* of the
/// distance between consecutive points, per Barry & Goldman 1988) does not
/// have that failure mode: a short span between close points gets a short
/// parameter interval, so the curve is not asked to travel through it at
/// the same "speed" a long span gets. Evaluated via Barry-Goldman's
/// repeated-lerp construction rather than a fixed matrix, since the matrix
/// form only exists for the uniform case.
fn catmull_rom_point(p0: Point, p1: Point, p2: Point, p3: Point, local_t: f32) -> Point {
    let t0 = 0.0_f32;
    let t1 = t0 + distance(p0, p1).sqrt();
    let t2 = t1 + distance(p1, p2).sqrt();
    let t3 = t2 + distance(p2, p3).sqrt();
    let t = t1 + local_t * (t2 - t1);

    let a1 = safe_lerp(p0, p1, t - t0, t1 - t0);
    let a2 = safe_lerp(p1, p2, t - t1, t2 - t1);
    let a3 = safe_lerp(p2, p3, t - t2, t3 - t2);
    let b1 = safe_lerp(a1, a2, t - t0, t2 - t0);
    let b2 = safe_lerp(a2, a3, t - t1, t3 - t1);
    safe_lerp(b1, b2, t - t1, t2 - t1)
}

/// The perpendicular distance from `point` to the infinite line through
/// `a`/`b` -- the true sagitta, and not the same thing as `point`'s
/// distance to `a`/`b`'s arithmetic midpoint.
///
/// Those two coincide only when the parameter halfway between `from` and
/// `to` also lands the curve halfway between `a` and `b` in space -- true
/// for a *uniform* parametrization, false for the centripetal one this
/// module uses on purpose: a straight but unevenly spaced stretch has its
/// midpoint parameter land closer to whichever neighbour is spaced
/// tighter, off-centre from `a`/`b` even though the curve itself never
/// leaves the line. Measuring against the arithmetic midpoint reads that as
/// curvature and subdivides a perfectly straight stretch down to its
/// individual control points for nothing; measuring perpendicular distance
/// from the line reads it for what it is -- zero.
fn perpendicular_distance(point: Point, a: Point, b: Point) -> f32 {
    let length = distance(a, b);
    if length < 1e-9 {
        return distance(point, a);
    }
    let cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
    cross.abs() / length
}

/// How far the true curve strays from the chord `from..to`, measured at the
/// curve's own midpoint -- the same sagitta test
/// `grafting-procgen-surface-mesh` already uses to decide arc flattening,
/// generalised here to a curve with no fixed radius.
fn sagitta(p0: Point, p1: Point, p2: Point, p3: Point, from: f32, to: f32) -> f32 {
    let mid_t = (from + to) / 2.0;
    let mid = catmull_rom_point(p0, p1, p2, p3, mid_t);
    let a = catmull_rom_point(p0, p1, p2, p3, from);
    let b = catmull_rom_point(p0, p1, p2, p3, to);
    perpendicular_distance(mid, a, b)
}

fn flatten(
    p0: Point,
    p1: Point,
    p2: Point,
    p3: Point,
    from: f32,
    to: f32,
    tolerance: f32,
    depth: u32,
    out: &mut Vec<Point>,
) {
    if depth < MAX_DEPTH && sagitta(p0, p1, p2, p3, from, to) > tolerance {
        let mid = (from + to) / 2.0;
        flatten(p0, p1, p2, p3, from, mid, tolerance, depth + 1, out);
        flatten(p0, p1, p2, p3, mid, to, tolerance, depth + 1, out);
    } else {
        out.push(catmull_rom_point(p0, p1, p2, p3, to));
    }
}

/// The point that would sit before `p1` if the run continued the way it
/// arrived at `p1` from `p2` -- a linear reflection, not a duplicate.
/// Duplicating an end's own control point as its neighbour is the common
/// shortcut, but it is wrong: it changes the tangent the curve leaves that
/// end on, which curves a perfectly straight, evenly spaced run right at
/// its own two ends. Reflecting instead keeps an end's tangent equal to the
/// chord into it, which is what a straight run needs to flatten straight
/// all the way to its own endpoint.
fn reflect(known: Point, neighbour: Point) -> Point {
    [2.0 * known[0] - neighbour[0], 2.0 * known[1] - neighbour[1]]
}

/// Samples a centripetal Catmull-Rom curve through `control_points`,
/// flattened so no chord strays from the true curve by more than
/// `tolerance`. The curve passes through every control point in order; the
/// phantom point beyond either end is a reflection of that end's own last
/// chord (see [`reflect`]), not a loop and not a duplicate, so the curve
/// does not overshoot past either end.
///
/// Collinear control points flatten to their own straight chords, however
/// unevenly they are spaced -- collinear is collinear under any
/// parametrization -- so the result is exactly `control_points` back.
pub fn sample_catmull_rom(control_points: &[Point], tolerance: f32) -> Polyline {
    if control_points.len() < 2 {
        return Polyline { points: control_points.to_vec() };
    }
    let last = control_points.len() - 1;
    let clamped_tolerance = tolerance.max(1e-6);
    let mut points = vec![control_points[0]];
    for index in 0..last {
        let p1 = control_points[index];
        let p2 = control_points[index + 1];
        let p0 = if index == 0 { reflect(p1, p2) } else { control_points[index - 1] };
        let p3 = if index + 1 == last { reflect(p2, p1) } else { control_points[index + 2] };
        flatten(p0, p1, p2, p3, 0.0, 1.0, clamped_tolerance, 0, &mut points);
    }
    Polyline { points }
}
