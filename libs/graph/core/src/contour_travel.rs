//! Travelling along one contour edge: how far along it a parameter sits, and
//! which parameter sits a given distance along it, plus the sub-curve between
//! two parameters.
//!
//! The same questions a caller asks when it stamps something onto a curved
//! wall -- an opening this wide, this far along -- and the reason they live
//! here: a curve's shape is this crate's to answer, so nothing outside it
//! needs its own copy of the arithmetic to walk one.

use crate::contour::{ContourEdge, ContourGeometry, ContourPoint};

/// How finely a Bezier is walked when converting between distance and
/// parameter. A curve's own length is already sampled at this density, so a
/// finer walk here would claim a precision the length itself does not have.
const WALK_STEPS: usize = 64;

/// Distance along the edge from its start to parameter `t`.
pub fn distance_at_parameter(
    edge: &ContourEdge,
    from: ContourPoint,
    to: ContourPoint,
    t: f32,
) -> f32 {
    let t = t.clamp(0.0, 1.0);
    match edge.geometry() {
        ContourGeometry::Line | ContourGeometry::CircularArc { .. } => edge.length(from, to) * t,
        ContourGeometry::Bezier { .. } => {
            let mut walked = 0.0;
            let mut previous = from;
            let steps = (WALK_STEPS as f32 * t).ceil().max(1.0) as usize;
            for step in 1..=steps {
                let at = t * step as f32 / steps as f32;
                let point = edge.evaluate(from, to, at);
                walked += hypot(point, previous);
                previous = point;
            }
            walked
        }
    }
}

/// The parameter sitting `distance` along the edge from its start.
pub fn parameter_at_distance(
    edge: &ContourEdge,
    from: ContourPoint,
    to: ContourPoint,
    distance: f32,
) -> f32 {
    let length = edge.length(from, to);
    if length <= f32::EPSILON {
        return 0.0;
    }
    let target = distance.clamp(0.0, length);
    match edge.geometry() {
        ContourGeometry::Line | ContourGeometry::CircularArc { .. } => target / length,
        ContourGeometry::Bezier { .. } => {
            // Walked rather than solved: a cubic's arc length has no closed
            // form, and this is the same walk the length itself is measured by.
            let mut walked = 0.0;
            let mut previous = from;
            for step in 1..=WALK_STEPS {
                let at = step as f32 / WALK_STEPS as f32;
                let point = edge.evaluate(from, to, at);
                let piece = hypot(point, previous);
                if walked + piece >= target {
                    let within = if piece <= f32::EPSILON {
                        0.0
                    } else {
                        (target - walked) / piece
                    };
                    let previous_at = (step - 1) as f32 / WALK_STEPS as f32;
                    return previous_at + (at - previous_at) * within;
                }
                walked += piece;
                previous = point;
            }
            1.0
        }
    }
}

/// The edge's own geometry between parameters `t0` and `t1`, walked forward.
///
/// A line or an arc need no work: a chord is a chord end to end, and any two
/// points on a circle bound an arc of that same circle. A Bezier's handles are
/// anchored to its own endpoints, so a shorter span between two other points
/// needs its own freshly split handles or it traces a different curve.
pub fn sub_geometry(
    edge: &ContourEdge,
    from: ContourPoint,
    to: ContourPoint,
    t0: f32,
    t1: f32,
) -> ContourGeometry {
    let ContourGeometry::Bezier { handle1, handle2 } = *edge.geometry() else {
        return *edge.geometry();
    };
    if !(t1 > t0) || t0 < 0.0 || t1 > 1.0 {
        return *edge.geometry();
    }
    let (_, right) = subdivide(from, handle1, handle2, to, t0);
    let local = if t0 <= 1e-9 { t1 } else { (t1 - t0) / (1.0 - t0) };
    if local >= 1.0 - 1e-9 {
        return ContourGeometry::Bezier { handle1: right[1], handle2: right[2] };
    }
    let (left, _) = subdivide(right[0], right[1], right[2], right[3], local);
    ContourGeometry::Bezier { handle1: left[1], handle2: left[2] }
}

/// The signed sweep an arc turns through, positive counter-clockwise.
pub fn arc_sweep(edge: &ContourEdge, from: ContourPoint, to: ContourPoint) -> f32 {
    let ContourGeometry::CircularArc { center, clockwise } = *edge.geometry() else {
        return 0.0;
    };
    let radius = hypot(center, from);
    if radius <= f32::EPSILON {
        return 0.0;
    }
    let turned = edge.length(from, to) / radius;
    if clockwise {
        -turned
    } else {
        turned
    }
}

fn hypot(a: ContourPoint, b: ContourPoint) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

/// De Casteljau at `t`: the control polygons of the two halves.
fn subdivide(
    p0: ContourPoint,
    p1: ContourPoint,
    p2: ContourPoint,
    p3: ContourPoint,
    t: f32,
) -> ([ContourPoint; 4], [ContourPoint; 4]) {
    let mix = |a: ContourPoint, b: ContourPoint| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    let a = mix(p0, p1);
    let b = mix(p1, p2);
    let c = mix(p2, p3);
    let d = mix(a, b);
    let e = mix(b, c);
    let f = mix(d, e);
    ([p0, a, d, f], [f, e, c, p3])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contour::ContourEdgeId;
    use crate::model::NodeId;

    fn bezier(handle1: ContourPoint, handle2: ContourPoint) -> ContourEdge {
        ContourEdge::new(
            ContourEdgeId::new("e").unwrap(),
            NodeId::new("a".to_owned()).unwrap(),
            NodeId::new("b".to_owned()).unwrap(),
            ContourGeometry::Bezier { handle1, handle2 },
        )
    }

    fn line() -> ContourEdge {
        ContourEdge::new(
            ContourEdgeId::new("l").unwrap(),
            NodeId::new("a".to_owned()).unwrap(),
            NodeId::new("b".to_owned()).unwrap(),
            ContourGeometry::Line,
        )
    }

    #[test]
    fn distance_and_parameter_are_inverses_along_a_curve() {
        let edge = bezier([1.0, -2.0], [3.0, 1.0]);
        let (from, to) = ([0.0, 0.0], [4.0, 0.0]);
        for step in 0..=10 {
            let t = step as f32 / 10.0;
            let distance = distance_at_parameter(&edge, from, to, t);
            let back = parameter_at_distance(&edge, from, to, distance);
            assert!((back - t).abs() < 0.02, "t {t} came back as {back}");
        }
    }

    #[test]
    fn a_straight_run_is_travelled_in_proportion() {
        let edge = line();
        let (from, to) = ([0.0, 0.0], [10.0, 0.0]);
        assert!((distance_at_parameter(&edge, from, to, 0.25) - 2.5).abs() < 1e-4);
        assert!((parameter_at_distance(&edge, from, to, 7.5) - 0.75).abs() < 1e-4);
        assert_eq!(parameter_at_distance(&edge, from, to, 99.0), 1.0);
    }

    #[test]
    fn a_sub_curve_traces_the_same_shape_as_the_whole() {
        let edge = bezier([1.0, -2.0], [3.0, 1.0]);
        let (from, to) = ([0.0, 0.0], [4.0, 0.0]);
        let start = edge.evaluate(from, to, 0.25);
        let end = edge.evaluate(from, to, 0.75);
        let piece = ContourEdge::new(
            ContourEdgeId::new("piece").unwrap(),
            NodeId::new("a".to_owned()).unwrap(),
            NodeId::new("b".to_owned()).unwrap(),
            sub_geometry(&edge, from, to, 0.25, 0.75),
        );

        for step in 0..=8 {
            let local = step as f32 / 8.0;
            let on_piece = piece.evaluate(start, end, local);
            let on_whole = edge.evaluate(from, to, 0.25 + 0.5 * local);
            assert!(
                hypot(on_piece, on_whole) < 1e-3,
                "piece left the curve at {local}: {on_piece:?} vs {on_whole:?}"
            );
        }
    }

    #[test]
    fn a_line_and_an_arc_keep_their_own_geometry_for_any_span() {
        let edge = line();
        assert_eq!(sub_geometry(&edge, [0.0, 0.0], [4.0, 0.0], 0.2, 0.6), ContourGeometry::Line);
    }
}
