//! Curve-derived ribbon contours. No product materials or rendering policy.
use crate::bezier::{CubicBezier, CurvePoint};
use crate::curve_offset::{Polygon, union_polygons};
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
    if !end_offsets.iter().all(|x| x.is_finite()) || end_offsets[0] >= end_offsets[1] {
        return Err("end offsets must be finite and ordered".into());
    }
    if !offsets.iter().all(|x| x.is_finite()) || offsets[0] >= offsets[1] {
        return Err("offsets must be finite and ordered".into());
    }
    let samples = curve.sample(accuracy)?;
    let mut left = Vec::new();
    let mut right = Vec::new();
    for sample in samples {
        let d = curve.derivative(sample.t)?;
        let speed = d[0].hypot(d[2]);
        if speed < 1e-10 {
            return Err("stationary tangent prevents a valid ribbon".into());
        }
        let offsets = std::array::from_fn::<_, 2, _>(|i| {
            offsets[i] + (end_offsets[i] - offsets[i]) * sample.t
        });
        let point = |w: f64| {
            [
                sample.position[0] - d[2] / speed * w,
                sample.position[1],
                sample.position[2] + d[0] / speed * w,
            ]
        };
        left.push(point(offsets[0]));
        right.push(point(offsets[1]));
    }
    right.reverse();
    left.extend(right);
    Ok(CurveRibbon { outer: left })
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
}
