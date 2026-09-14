//! Curve-derived ribbon contours. No product materials or rendering policy.
use crate::bezier::{CubicBezier, CurvePoint};
use crate::curve_offset::{Polygon, union_polygons};
/// One span of a vertical ribbon sweep, oriented in chain order.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "curve-serde", serde(rename_all = "camelCase"))]
pub struct RibbonSegment {
    /// Authored cubic.
    pub curve: CubicBezier,
    /// Start cross-section offsets.
    pub offsets: [f64; 2],
    /// End cross-section offsets.
    pub end_offsets: [f64; 2],
}
/// Closed vertical sweep with shared indexed face boundaries.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RibbonExtrusion {
    /// Alternating base/top vertices, two pairs per station.
    pub vertices: Vec<CurvePoint>,
    /// Triangular faces, with consistent winding.
    pub faces: Vec<[usize; 3]>,
    /// Unique edges over vertex indices.
    pub edges: Vec<[usize; 2]>,
    /// Each face's edge indices and reversed flags in boundary order.
    pub boundaries: Vec<[(usize, bool); 3]>,
}

fn ground_triangles(ground: &[Vec<Vec<CurvePoint>>]) -> Result<Vec<[CurvePoint; 3]>, String> {
    let mut triangles = Vec::new();
    let mut count = 0;
    for polygon in ground {
        let mut points = Vec::new();
        let mut holes = Vec::new();
        for (i, ring) in polygon.iter().enumerate() {
            count += ring.len();
            if count > 100_000 || ring.len() < 3 || ring.iter().flatten().any(|x| !x.is_finite()) {
                return Err("invalid or oversized supporting polygon".into());
            }
            if i > 0 {
                holes.push(points.len() as u32);
            }
            points.extend(ring.iter().copied());
        }
        let flat: Vec<[f64; 2]> = points.iter().map(|p| [p[0], p[2]]).collect();
        let mut indices = Vec::new();
        earcut::Earcut::new().earcut(flat, &holes, &mut indices);
        for t in indices.chunks_exact(3) {
            triangles.push([
                points[t[0] as usize],
                points[t[1] as usize],
                points[t[2] as usize],
            ]);
        }
    }
    Ok(triangles)
}

fn support_height(p: CurvePoint, triangles: &[[CurvePoint; 3]]) -> f64 {
    let mut height: Option<f64> = None;
    for &[a, b, c] in triangles {
        let d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if d.abs() < 1e-12 {
            continue;
        }
        let u = ((b[2] - c[2]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[2] - c[2])) / d;
        let v = ((c[2] - a[2]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[2] - c[2])) / d;
        let w = 1. - u - v;
        if u >= -1e-9 && v >= -1e-9 && w >= -1e-9 {
            let y = u * a[1] + v * b[1] + w * c[1];
            height = Some(height.map_or(y, |old| old.max(y)));
        }
    }
    height.unwrap_or(p[1])
}

/// Extrudes ordered curve spans, sampling their base on supporting polygons.
/// Missing support retains the authored curve's elevation. Top vertices are
/// always exactly `height` above their corresponding base. Terrain is read-only.
/// Stations are at most 0.25 units apart in control-polygon length; curved
/// spans also retain the curve sampler's accuracy bound. Disconnected spans,
/// nonpositive dimensions and excessive input are rejected before returning geometry.
pub fn extrude_ribbon(
    segments: &[RibbonSegment],
    height: f64,
    ground: &[Vec<Vec<CurvePoint>>],
    accuracy: f64,
) -> Result<RibbonExtrusion, String> {
    if segments.is_empty()
        || segments.len() > 4096
        || !height.is_finite()
        || height <= 0.
        || !accuracy.is_finite()
        || accuracy <= 0.
    {
        return Err("invalid extrusion dimensions or segment count".into());
    }
    let triangles = ground_triangles(ground)?;
    let mut stations: Vec<[CurvePoint; 2]> = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        let curve = segment.curve;
        if index > 0 && segments[index - 1].curve.points[3] != curve.points[0] {
            return Err("extrusion spans must form an ordered connected chain".into());
        }
        for offsets in [segment.offsets, segment.end_offsets] {
            if offsets.iter().any(|x| !x.is_finite()) || offsets[0] >= offsets[1] {
                return Err("extrusion offsets must be finite and ordered".into());
            }
        }
        let samples = curve.sample(accuracy)?;
        let length: f64 = curve
            .points
            .windows(2)
            .map(|p| (p[1][0] - p[0][0]).hypot(p[1][2] - p[0][2]))
            .sum();
        let steps = (length / 0.25).ceil().max(1.) as usize;
        if steps > 8192 || stations.len() + steps + samples.len() > 16384 {
            return Err("extrusion station budget exceeded".into());
        }
        let mut parameters: Vec<f64> = samples
            .iter()
            .map(|s| s.t)
            .chain((0..=steps).map(|i| i as f64 / steps as f64))
            .collect();
        parameters.sort_by(f64::total_cmp);
        parameters.dedup_by(|a, b| (*a - *b).abs() < 1e-10);
        for t in parameters {
            let p = curve.evaluate(t)?;
            let d = curve.derivative(t)?;
            let speed = d[0].hypot(d[2]);
            if speed < 1e-10 {
                return Err("stationary tangent prevents extrusion".into());
            }
            let pair = std::array::from_fn(|i| {
                let w = segment.offsets[i] + (segment.end_offsets[i] - segment.offsets[i]) * t;
                let mut q = [p[0] - d[2] / speed * w, p[1], p[2] + d[0] / speed * w];
                q[1] = support_height(q, &triangles);
                q
            });
            if stations.last().is_none_or(|last| {
                last.iter()
                    .flatten()
                    .zip(pair.iter().flatten())
                    .any(|(a, b)| (a - b).abs() > 1e-9)
            }) {
                stations.push(pair);
            }
        }
    }
    let closed = segments[0].curve.points[0] == segments.last().unwrap().curve.points[3];
    if closed && stations.first() == stations.last() {
        stations.pop();
    }
    if stations.len() < 2 {
        return Err("extrusion has no extent".into());
    }
    let vertices = stations
        .iter()
        .flat_map(|s| s.iter().flat_map(|p| [*p, [p[0], p[1] + height, p[2]]]))
        .collect();
    let mut faces = Vec::new();
    let mut quad = |a, b, c, d| {
        faces.push([a, c, b]);
        faces.push([a, d, c]);
    };
    let spans = if closed {
        stations.len()
    } else {
        stations.len() - 1
    };
    for i in 0..spans {
        let a = i * 4;
        let b = ((i + 1) % stations.len()) * 4;
        quad(a, b, b + 1, a + 1);
        quad(a + 2, a + 3, b + 3, b + 2);
        quad(a + 1, b + 1, b + 3, a + 3);
        quad(a, a + 2, b + 2, b);
    }
    if !closed {
        quad(0, 1, 3, 2);
        let a = (stations.len() - 1) * 4;
        quad(a, a + 2, a + 3, a + 1);
    }
    let mut edges = Vec::new();
    let mut edge_indices = std::collections::BTreeMap::new();
    let boundaries = faces
        .iter()
        .map(|face| {
            std::array::from_fn(|i| {
                let a = face[i];
                let b = face[(i + 1) % 3];
                let key = [a.min(b), a.max(b)];
                let index = *edge_indices.entry(key).or_insert_with(|| {
                    edges.push(key);
                    edges.len() - 1
                });
                (index, a > b)
            })
        })
        .collect();
    Ok(RibbonExtrusion {
        vertices,
        faces,
        edges,
        boundaries,
    })
}
/// A sampled ribbon with its source heights.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CurveRibbon {
    /// Closed polygon boundary, without a repeated closing vertex.
    pub outer: Vec<CurvePoint>,
}
/// Computes a ribbon from an explicit cubic and independently specified widths.
/// The raw offset may overlap at tight turns; normalize it with the planar union before meshing.
/// Stationary ground-plane tangents are rejected.
pub fn ribbon(curve: CubicBezier, offsets: [f64; 2], accuracy: f64) -> Result<CurveRibbon, String> {
    ribbon_profile(curve, offsets, offsets, accuracy)
}
/// Samples a ribbon with linearly varying start/end lateral offsets.
pub fn ribbon_profile(
    curve: CubicBezier,
    offsets: [f64; 2],
    end_offsets: [f64; 2],
    accuracy: f64,
) -> Result<CurveRibbon, String> {
    let parameters = curve
        .sample(accuracy)?
        .into_iter()
        .map(|sample| sample.t)
        .collect::<Vec<_>>();
    ribbon_profile_at(curve, offsets, end_offsets, &parameters)
}
/// [`ribbon_profile`] with its cross-sections taken at explicit, ordered
/// curve parameters instead of adaptive samples -- so a caller holding
/// vertices at known parameters can move them with the curve without
/// re-sampling it and changing how many there are.
pub fn ribbon_profile_at(
    curve: CubicBezier,
    offsets: [f64; 2],
    end_offsets: [f64; 2],
    parameters: &[f64],
) -> Result<CurveRibbon, String> {
    if !end_offsets.iter().all(|x| x.is_finite()) || end_offsets[0] >= end_offsets[1] {
        return Err("end offsets must be finite and ordered".into());
    }
    if !offsets.iter().all(|x| x.is_finite()) || offsets[0] >= offsets[1] {
        return Err("offsets must be finite and ordered".into());
    }
    if parameters.len() < 2
        || parameters.iter().any(|t| !t.is_finite() || !(0.0..=1.0).contains(t))
        || parameters.windows(2).any(|pair| pair[0] >= pair[1])
    {
        return Err("ribbon parameters must be at least two increasing values in [0, 1]".into());
    }
    let mut left = Vec::new();
    let mut right = Vec::new();
    for &t in parameters {
        let position = curve.evaluate(t)?;
        let d = curve.derivative(t)?;
        let speed = d[0].hypot(d[2]);
        if speed < 1e-10 {
            return Err("stationary tangent prevents a valid ribbon".into());
        }
        let offsets = std::array::from_fn::<_, 2, _>(|i| offsets[i] + (end_offsets[i] - offsets[i]) * t);
        let point = |w: f64| {
            [
                position[0] - d[2] / speed * w,
                position[1],
                position[2] + d[0] / speed * w,
            ]
        };
        left.push(point(offsets[0]));
        right.push(point(offsets[1]));
    }
    right.reverse();
    left.extend(right);
    Ok(CurveRibbon { outer: left })
}
/// Bevel join of incident ribbon cross-sections at one shared anchor.
/// Sections must be coplanar. Collinear sections need no additional surface.
/// The convex boundary fills the outside corner without a spike or a cut to the anchor.
pub fn ribbon_join(sections: &[[CurvePoint; 2]]) -> Result<CurveRibbon, String> {
    if sections.len() > 4096 {
        return Err("too many incident ribbon sections".into());
    }
    let mut points: Vec<_> = sections.iter().flatten().copied().collect();
    if points.iter().flatten().any(|v| !v.is_finite()) {
        return Err("join coordinates must be finite".into());
    }
    if let Some(first) = points.first()
        && points.iter().any(|p| (p[1] - first[1]).abs() > 1e-8)
    {
        return Err("join sections must be coplanar".into());
    }
    points.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[2].total_cmp(&b[2])));
    points.dedup_by(|a, b| a[0] == b[0] && a[2] == b[2]);
    if points.len() < 3 {
        return Ok(CurveRibbon { outer: Vec::new() });
    }
    let cross = |a: CurvePoint, b: CurvePoint, c: CurvePoint| {
        (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])
    };
    let mut hull = Vec::new();
    for &p in &points {
        while hull.len() >= 2 && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0. {
            hull.pop();
        }
        hull.push(p);
    }
    let lower = hull.len();
    for &p in points.iter().rev().skip(1) {
        while hull.len() > lower && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0. {
            hull.pop();
        }
        hull.push(p);
    }
    hull.pop();
    if hull.len() < 3 {
        hull.clear();
    }
    Ok(CurveRibbon { outer: hull })
}
/// Unions coplanar ribbon contours, retaining islands as holes.
/// The caller partitions grade-separated connections before this operation.
pub fn union_ribbons(ribbons: &[CurveRibbon]) -> Vec<Polygon> {
    let polygons: Vec<_> = ribbons
        .iter()
        .map(|r| Polygon {
            outer: r.outer.iter().map(|p| [p[0] as f32, p[2] as f32]).collect(),
            holes: Vec::new(),
        })
        .collect();
    union_polygons(&polygons)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extrusion_projects_rails_and_preserves_height_and_closed_edge_uses() {
        let curve = crate::bezier::automatic_path(&[[-2., 0., 0.], [2., 0., 0.]]).unwrap()[0];
        let segments = [RibbonSegment {
            curve,
            offsets: [-0.2, 0.2],
            end_offsets: [-0.4, 0.4],
        }];
        let ground = vec![vec![vec![
            [-5., 0., -5.],
            [5., 2., -5.],
            [5., 2., 5.],
            [-5., 0., 5.],
        ]]];
        let result = extrude_ribbon(&segments, 3., &ground, 0.025).unwrap();
        for pair in result.vertices.chunks_exact(2) {
            assert!((pair[0][1] - (1. + pair[0][0] * 0.2)).abs() < 1e-9);
            assert!((pair[1][1] - pair[0][1] - 3.).abs() < 1e-9);
            assert_eq!(pair[0][0], pair[1][0]);
            assert_eq!(pair[0][2], pair[1][2]);
        }
        let mut uses = vec![[0; 2]; result.edges.len()];
        for boundary in result.boundaries {
            for (edge, reversed) in boundary {
                uses[edge][usize::from(reversed)] += 1;
            }
        }
        assert!(uses.iter().all(|u| *u == [1, 1]));
        assert_eq!(result.vertices[0][2], -0.2);
        assert_eq!(result.vertices[result.vertices.len() - 4][2], -0.4);
        for bad in [0., -1., f64::NAN, f64::INFINITY] {
            assert!(extrude_ribbon(&segments, bad, &ground, 0.025).is_err());
        }
    }

    #[test]
    fn extrusion_support_holes_retain_authored_base_and_bends_stay_connected() {
        let curves =
            crate::bezier::automatic_path(&[[-2., 1., 0.], [0., 1., 2.], [2., 1., 0.]]).unwrap();
        let segments: Vec<_> = curves
            .into_iter()
            .map(|curve| RibbonSegment {
                curve,
                offsets: [-0.1, 0.1],
                end_offsets: [-0.1, 0.1],
            })
            .collect();
        let ground = vec![vec![
            vec![[-5., 4., -5.], [5., 4., -5.], [5., 4., 5.], [-5., 4., 5.]],
            vec![[-3., 4., -3.], [-3., 4., 3.], [3., 4., 3.], [3., 4., -3.]],
        ]];
        let result = extrude_ribbon(&segments, 2., &ground, 0.025).unwrap();
        assert!(
            result
                .vertices
                .chunks_exact(2)
                .all(|p| (p[0][1] - 1.).abs() < 1e-9 && (p[1][1] - 3.).abs() < 1e-9)
        );
        assert!(result.vertices.len() > 16);
        let mut disconnected = segments;
        disconnected[1].curve.points[0][0] += 1.;
        assert!(extrude_ribbon(&disconnected, 2., &ground, 0.025).is_err());
    }
    #[test]
    fn wide_tight_curve_normalizes_to_a_surface() {
        let c = CubicBezier {
            points: [[0., 0., 0.], [0., 0., 1.], [1., 0., 1.], [1., 0., 0.]],
        };
        let shapes = union_ribbons(&[ribbon(c, [-5., 5.], 0.001).unwrap()]);
        assert!(!shapes.is_empty());
        assert!(
            shapes
                .iter()
                .all(|s| s.outer.len() >= 3 && s.outer.iter().flatten().all(|v| v.is_finite()))
        );
    }
    #[test]
    fn crossing_ribbons_make_one_surface() {
        let a = crate::bezier::automatic_path(&[[-5., 0., 0.], [5., 0., 0.]]).unwrap()[0];
        let b = crate::bezier::automatic_path(&[[0., 0., -5.], [0., 0., 5.]]).unwrap()[0];
        let shapes = union_ribbons(&[
            ribbon(a, [-1., 1.], 0.01).unwrap(),
            ribbon(b, [-1., 1.], 0.01).unwrap(),
        ]);
        assert_eq!(shapes.len(), 1);
        assert!(shapes[0].holes.is_empty());
    }

    #[test]
    fn bevel_join_is_bounded_and_independent_of_section_direction() {
        let sections = [[[0., 2., -1.], [0., 2., 1.]], [[-2., 2., 0.], [2., 2., 0.]]];
        let joined = ribbon_join(&sections).unwrap();
        assert_eq!(joined.outer.len(), 4);
        assert!(!joined.outer.contains(&[0., 2., 0.]));
        assert_eq!(
            joined.outer,
            ribbon_join(&[sections[1], [sections[0][1], sections[0][0]]])
                .unwrap()
                .outer
        );
        assert!(
            ribbon_join(&[sections[0], sections[0]])
                .unwrap()
                .outer
                .is_empty()
        );
        assert!(ribbon_join(&[[[0., f64::NAN, 0.], [1., 0., 0.]]]).is_err());
        assert!(ribbon_join(&[[[0., 0., 0.], [1., 1., 0.]]]).is_err());
    }
}
