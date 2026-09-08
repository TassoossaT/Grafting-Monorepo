//! Analytic booleans over line and circular-arc boundaries.
use crate::{ContourEdge, ContourEdgeId, ContourGeometry, NodeId, PlanarBoolean};
/// A directed span in a closed planar boundary.
#[derive(Clone, Debug, PartialEq)]
pub struct PlanarCurve {
    /// Start position in the plane.
    pub start: [f32; 2],
    /// End position in the plane.
    pub end: [f32; 2],
    /// Geometry walked from start to end.
    pub geometry: ContourGeometry,
}
/// An outer boundary followed by holes, each made of continuous closed spans.
pub type CurvedPlanarShape = Vec<Vec<PlanarCurve>>;
const EPS: f32 = 1e-5;
impl PlanarCurve {
    fn edge(&self) -> ContourEdge {
        ContourEdge::new(
            ContourEdgeId::new("query").unwrap(),
            NodeId::new("a").unwrap(),
            NodeId::new("b").unwrap(),
            self.geometry,
        )
    }
    fn reverse(&self) -> Self {
        Self {
            start: self.end,
            end: self.start,
            geometry: self.edge().reversed_geometry(),
        }
    }
    fn midpoint(&self) -> [f32; 2] {
        self.edge().evaluate(self.start, self.end, 0.5)
    }
}
fn distance(a: [f32; 2], b: [f32; 2]) -> f32 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}
fn near(a: [f32; 2], b: [f32; 2]) -> bool {
    distance(a, b) < EPS
}
fn spans(shapes: &[CurvedPlanarShape]) -> Vec<PlanarCurve> {
    shapes.iter().flatten().flatten().cloned().collect()
}
fn sweep(c: &PlanarCurve) -> f64 {
    let ContourGeometry::CircularArc { center, clockwise } = c.geometry else {
        return 0.0;
    };
    let a = ((c.start[1] - center[1]) as f64).atan2((c.start[0] - center[0]) as f64);
    let b = ((c.end[1] - center[1]) as f64).atan2((c.end[0] - center[0]) as f64);
    if clockwise {
        -(a - b).rem_euclid(std::f64::consts::TAU)
    } else {
        (b - a).rem_euclid(std::f64::consts::TAU)
    }
}
fn validate(shapes: &[CurvedPlanarShape]) -> Result<(), String> {
    for shape in shapes {
        if shape.is_empty() {
            return Err("a shape needs an outer boundary".into());
        }
        for ring in shape {
            if ring.len() < 2 {
                return Err("a boundary needs at least two spans".into());
            }
            for (i, c) in ring.iter().enumerate() {
                if c.start.iter().chain(&c.end).any(|v| !v.is_finite())
                    || near(c.start, c.end)
                    || !near(c.end, ring[(i + 1) % ring.len()].start)
                {
                    return Err("boundary spans must be finite, nonzero and continuous".into());
                }
                if !c.edge().length(c.start, c.end).is_finite() {
                    return Err("boundary length must be finite".into());
                }
                if let ContourGeometry::CircularArc { center, .. } = c.geometry {
                    let r = distance(center, c.start);
                    if center.iter().any(|v| !v.is_finite())
                        || !r.is_finite()
                        || r < EPS
                        || (r - distance(center, c.end)).abs() > EPS.max(r * 1e-5)
                    {
                        return Err("arc endpoints must lie on the same finite circle".into());
                    }
                }
            }
        }
    }
    Ok(())
}
fn split(curves: &[PlanarCurve], boundaries: &[PlanarCurve]) -> Vec<PlanarCurve> {
    let mut out = Vec::new();
    for c in curves {
        let edge = c.edge();
        let mut cuts = vec![(0.0, c.start), (1.0, c.end)];
        for other in boundaries {
            let mut points =
                edge.intersections(c.start, c.end, &other.edge(), other.start, other.end);
            points.extend([other.start, other.end]);
            for p in points {
                let (t, q) = edge.closest_point(c.start, c.end, p);
                if t > 1e-6 && t < 1.0 - 1e-6 && near(p, q) {
                    cuts.push((t, p));
                }
            }
        }
        cuts.sort_by(|a, b| a.0.total_cmp(&b.0));
        cuts.dedup_by(|a, b| near(a.1, b.1));
        for p in cuts.windows(2) {
            if !near(p[0].1, p[1].1) {
                out.push(PlanarCurve {
                    start: p[0].1,
                    end: p[1].1,
                    geometry: c.geometry,
                });
            }
        }
    }
    out
}
// Exact ray winding. Divide arcs conceptually at vertical extrema and use
// the same half-open crossing rule on each monotonic interval as on a line.
fn in_ring(ring: &[PlanarCurve], p: [f64; 2]) -> bool {
    let mut winding = 0;
    for c in ring {
        let a = c.start.map(|v| v as f64);
        let b = c.end.map(|v| v as f64);
        match c.geometry {
            ContourGeometry::Line => {
                if (a[1] <= p[1] && b[1] > p[1]) || (b[1] <= p[1] && a[1] > p[1]) {
                    let x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
                    if x > p[0] {
                        winding += if b[1] > a[1] { 1 } else { -1 };
                    }
                }
            }
            ContourGeometry::CircularArc { center, .. } => {
                let center = center.map(|v| v as f64);
                let radius = (a[0] - center[0]).hypot(a[1] - center[1]);
                let start = (a[1] - center[1]).atan2(a[0] - center[0]);
                let total = sweep(c);
                let mut times = vec![0.0, 1.0];
                for angle in [std::f64::consts::FRAC_PI_2, -std::f64::consts::FRAC_PI_2] {
                    let d = if total > 0.0 {
                        (angle - start).rem_euclid(std::f64::consts::TAU)
                    } else {
                        -(start - angle).rem_euclid(std::f64::consts::TAU)
                    };
                    let t = d / total;
                    if t > 0.0 && t < 1.0 {
                        times.push(t);
                    }
                }
                times.sort_by(f64::total_cmp);
                for ts in times.windows(2) {
                    let u = start + total * ts[0];
                    let v = start + total * ts[1];
                    let y0 = center[1] + radius * u.sin();
                    let y1 = center[1] + radius * v.sin();
                    if (y0 <= p[1] && y1 > p[1]) || (y1 <= p[1] && y0 > p[1]) {
                        let dx = (radius * radius - (p[1] - center[1]).powi(2))
                            .max(0.0)
                            .sqrt();
                        let x = center[0]
                            + if ((u + v) / 2.0).cos() >= 0.0 {
                                dx
                            } else {
                                -dx
                            };
                        if x > p[0] {
                            winding += if y1 > y0 { 1 } else { -1 };
                        }
                    }
                }
            }
        }
    }
    winding != 0
}
fn inside(shapes: &[CurvedPlanarShape], p: [f64; 2]) -> bool {
    shapes
        .iter()
        .any(|s| in_ring(&s[0], p) && !s.iter().skip(1).any(|r| in_ring(r, p)))
}
fn area(ring: &[PlanarCurve]) -> f64 {
    ring.iter()
        .map(|c| {
            let chord =
                (c.start[0] as f64 * c.end[1] as f64 - c.end[0] as f64 * c.start[1] as f64) / 2.0;
            if let ContourGeometry::CircularArc { center, .. } = c.geometry {
                let r = distance(center, c.start) as f64;
                let angle = sweep(c);
                chord + r * r * (angle - angle.sin()) / 2.0
            } else {
                chord
            }
        })
        .sum()
}
fn assemble(mut edges: Vec<PlanarCurve>) -> Result<Vec<CurvedPlanarShape>, String> {
    let mut rings = Vec::new();
    while let Some(first) = edges.pop() {
        let start = first.start;
        let mut ring = vec![first];
        while !near(ring.last().unwrap().end, start) {
            let last = ring.last().unwrap();
            let t = last.edge().tangent(last.start, last.end, 1.0);
            let reverse_angle = (-t[1]).atan2(-t[0]);
            let next = edges
                .iter()
                .enumerate()
                .filter(|(_, e)| near(e.start, last.end))
                .min_by(|(_, a), (_, b)| {
                    let angle = |e: &PlanarCurve| {
                        let t = e.edge().tangent(e.start, e.end, 0.0);
                        (reverse_angle - t[1].atan2(t[0])).rem_euclid(std::f32::consts::TAU)
                    };
                    angle(a).total_cmp(&angle(b))
                })
                .map(|(i, _)| i)
                .ok_or("boolean boundary did not close")?;
            let mut edge = edges.remove(next);
            edge.start = last.end;
            ring.push(edge);
        }
        ring.last_mut().unwrap().end = start;
        if area(&ring).abs() > (EPS * EPS) as f64 {
            rings.push(ring);
        }
    }
    let mut result: Vec<CurvedPlanarShape> = rings
        .iter()
        .filter(|r| area(r) > 0.0)
        .cloned()
        .map(|r| vec![r])
        .collect();
    for hole in rings.into_iter().filter(|r| area(r) < 0.0) {
        let p = hole[0].midpoint().map(|v| v as f64);
        let owner = result
            .iter()
            .enumerate()
            .filter(|(_, s)| in_ring(&s[0], p))
            .min_by(|(_, a), (_, b)| area(&a[0]).total_cmp(&area(&b[0])))
            .map(|(i, _)| i)
            .ok_or("boolean hole has no outer boundary")?;
        result[owner].push(hole);
    }
    Ok(result)
}
fn combine(
    subject: &[CurvedPlanarShape],
    clip: &[CurvedPlanarShape],
    difference: bool,
) -> Result<Vec<CurvedPlanarShape>, String> {
    let mut boundaries = spans(subject);
    boundaries.extend(spans(clip));
    let fragments = split(&boundaries, &boundaries);
    let mut kept: Vec<PlanarCurve> = Vec::new();
    for c in &fragments {
        let mid = c.midpoint();
        let t = c.edge().tangent(c.start, c.end, 0.5);
        let len = t[0].hypot(t[1]);
        let normal = [-(t[1] / len) as f64, (t[0] / len) as f64];
        let mut offset = (c.edge().length(c.start, c.end) as f64 * 1e-3).min(1e-3);
        for other in &fragments {
            let (_, q) = other.edge().closest_point(other.start, other.end, mid);
            let d = distance(q, mid) as f64;
            if d > EPS as f64 {
                offset = offset.min(d / 4.0);
            }
        }
        // f64 evaluation avoids classifying a rounded arc midpoint on the wrong side.
        let m = if let ContourGeometry::CircularArc { center, .. } = c.geometry {
            let a = ((c.start[1] - center[1]) as f64).atan2((c.start[0] - center[0]) as f64)
                + sweep(c) / 2.0;
            let r = ((c.start[0] - center[0]) as f64).hypot((c.start[1] - center[1]) as f64);
            [
                center[0] as f64 + r * a.cos(),
                center[1] as f64 + r * a.sin(),
            ]
        } else {
            [
                (c.start[0] as f64 + c.end[0] as f64) / 2.0,
                (c.start[1] as f64 + c.end[1] as f64) / 2.0,
            ]
        };
        let selected = |sign: f64| {
            let p = [
                m[0] + normal[0] * offset * sign,
                m[1] + normal[1] * offset * sign,
            ];
            if difference {
                inside(subject, p) && !inside(clip, p)
            } else {
                inside(subject, p) || inside(clip, p)
            }
        };
        let (left, right) = (selected(1.0), selected(-1.0));
        if left == right {
            continue;
        }
        let c = if left { c.clone() } else { c.reverse() };
        if !kept.iter().any(|e| {
            near(e.start, c.start) && near(e.end, c.end) && near(e.midpoint(), c.midpoint())
        }) {
            kept.push(c);
        }
    }
    assemble(kept)
}
/// Applies a boolean without converting circular arcs to polygonal chords.
///
/// Outer/hole winding may be supplied in either direction. Intersections are
/// analytic; original vertices and structural seams in `Extend` are retained.
/// Coincident spans are deduplicated. Malformed, nonfinite, discontinuous or
/// inconsistent-radius input returns an error before calculation.
/// Features below the positional tolerance of 1e-5 world units are not retained.
/// This pure query leaves atomic application of the result to the caller.
pub fn curved_planar_boolean(
    subject: &[CurvedPlanarShape],
    clip: &[CurvedPlanarShape],
    operation: PlanarBoolean,
) -> Result<Vec<CurvedPlanarShape>, String> {
    validate(subject)?;
    validate(clip)?;
    let mut result = match operation {
        PlanarBoolean::Union => combine(subject, clip, false)?,
        PlanarBoolean::Difference => {
            let mut result = Vec::new();
            for s in subject {
                result.extend(combine(std::slice::from_ref(s), clip, true)?);
            }
            result
        }
        PlanarBoolean::Extend => {
            let mut result = subject.to_vec();
            result.extend(combine(clip, subject, true)?);
            result
        }
    };
    let mut boundaries = spans(subject);
    boundaries.extend(spans(clip));
    boundaries.extend(spans(&result));
    for ring in result.iter_mut().flatten() {
        *ring = split(ring, &boundaries);
    }
    Ok(result)
}
