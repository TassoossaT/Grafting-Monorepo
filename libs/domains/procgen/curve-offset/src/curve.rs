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

/// One point on the uniform Catmull-Rom curve running from `p1` to `p2`,
/// shaped by the neighbours `p0`/`p3` on either side.
fn catmull_rom_point(p0: Point, p1: Point, p2: Point, p3: Point, t: f32) -> Point {
    let t2 = t * t;
    let t3 = t2 * t;
    let a = scale(p1, 2.0);
    let b = scale(sub(p2, p0), t);
    let c = scale(
        add(scale(p0, 2.0), add(scale(p1, -5.0), add(scale(p2, 4.0), scale(p3, -1.0)))),
        t2,
    );
    let d = scale(
        add(scale(p0, -1.0), add(scale(p1, 3.0), add(scale(p2, -3.0), p3))),
        t3,
    );
    scale(add(add(a, b), add(c, d)), 0.5)
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
    let chord_mid = scale(add(a, b), 0.5);
    distance(mid, chord_mid)
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

/// Samples a uniform Catmull-Rom curve through `control_points`, flattened
/// so no chord strays from the true curve by more than `tolerance`. The
/// curve passes through every control point in order; the phantom point
/// beyond either end is a reflection of that end's own last chord (see
/// [`reflect`]), not a loop and not a duplicate, so the curve does not
/// overshoot past either end.
///
/// Collinear, evenly spaced control points flatten to their own straight
/// chords: the sagitta is zero everywhere, so nothing ever gets subdivided,
/// and the result is exactly `control_points` back.
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
