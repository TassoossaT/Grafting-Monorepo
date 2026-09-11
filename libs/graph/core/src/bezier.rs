//! Generic cubic authoring. XYZ coordinates; distance queries use XZ.
//! Vendor types stay private. Approximation requires explicit tolerances.
use kurbo::{CubicBez, ParamCurve, ParamCurveArclen, ParamCurveDeriv, ParamCurveNearest, Point};
/// An XYZ coordinate.
pub type CurvePoint = [f64; 3];
/// Anchor, outgoing handle, incoming handle, anchor in absolute coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CubicBezier {
    /// The four authored coordinates.
    pub points: [CurvePoint; 4],
}
/// An adaptive sample with its original parameter.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CurveSample {
    /// Original parameter.
    pub t: f64,
    /// XYZ position.
    pub position: CurvePoint,
}
/// Handle continuity policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "curve-serde", serde(rename_all = "camelCase"))]
pub enum HandleMode {
    /// Derived from neighboring anchors.
    Automatic,
    /// Opposite direction, independent length.
    Aligned,
    /// Opposite direction and equal length.
    Mirrored,
    /// Independent control.
    Free,
}
/// Relative controls stored on a graph edge, independent of generated vertices.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "curve-serde", serde(rename_all = "camelCase"))]
pub struct CurveHandles {
    /// Outgoing vector relative to the start anchor.
    pub start: CurvePoint,
    /// Incoming vector relative to the end anchor.
    pub end: CurvePoint,
    /// Constraint used when editing paired handles.
    pub mode: HandleMode,
    /// Independent cross-section offsets; empty means caller default.
    pub band_offsets: Vec<f64>,
    /// Optional cross-section at the end; empty keeps a constant profile.
    #[cfg_attr(
        feature = "curve-serde",
        serde(default, skip_serializing_if = "Vec::is_empty")
    )]
    pub end_band_offsets: Vec<f64>,
}
impl CurveHandles {
    /// Interpolates an independently authored width profile.
    pub fn profile_at(&self, t: f64) -> Result<Vec<f64>, String> {
        if !t.is_finite() || !(0.0..=1.0).contains(&t) {
            return Err("invalid profile parameter".into());
        }
        let end = if self.end_band_offsets.is_empty() {
            &self.band_offsets
        } else {
            &self.end_band_offsets
        };
        if end.len() != self.band_offsets.len()
            || end.iter().chain(&self.band_offsets).any(|v| !v.is_finite())
        {
            return Err("invalid width profile".into());
        }
        Ok(self
            .band_offsets
            .iter()
            .zip(end)
            .map(|(a, b)| a + (b - a) * t)
            .collect())
    }
    /// Resolves authored relative controls against current graph anchors.
    pub fn resolve(&self, start: CurvePoint, end: CurvePoint) -> CubicBezier {
        CubicBezier {
            points: [
                start,
                std::array::from_fn(|i| start[i] + self.start[i]),
                std::array::from_fn(|i| end[i] + self.end[i]),
                end,
            ],
        }
    }
    /// Captures a cubic without duplicating its anchor positions.
    pub fn from_curve(curve: CubicBezier, mode: HandleMode, band_offsets: Vec<f64>) -> Self {
        Self {
            start: std::array::from_fn(|i| curve.points[1][i] - curve.points[0][i]),
            end: std::array::from_fn(|i| curve.points[2][i] - curve.points[3][i]),
            mode,
            band_offsets,
            end_band_offsets: Vec::new(),
        }
    }
}
fn tolerance(v: f64) -> Result<(), String> {
    if v.is_finite() && v > 0. {
        Ok(())
    } else {
        Err("tolerance must be finite and positive".into())
    }
}
fn parameter(v: f64) -> Result<(), String> {
    if v.is_finite() && (0.0..=1.0).contains(&v) {
        Ok(())
    } else {
        Err("parameter must be in [0,1]".into())
    }
}
fn lerp(a: CurvePoint, b: CurvePoint, t: f64) -> CurvePoint {
    std::array::from_fn(|i| a[i] + (b[i] - a[i]) * t)
}
fn distance(a: CurvePoint, b: CurvePoint) -> f64 {
    (0..3).map(|i| (a[i] - b[i]).powi(2)).sum::<f64>().sqrt()
}
fn distance_segment(p: CurvePoint, a: CurvePoint, b: CurvePoint) -> f64 {
    let d: CurvePoint = std::array::from_fn(|i| b[i] - a[i]);
    let len = d.iter().map(|x| x * x).sum::<f64>();
    let t = if len == 0. {
        0.
    } else {
        ((0..3).map(|i| (p[i] - a[i]) * d[i]).sum::<f64>() / len).clamp(0., 1.)
    };
    distance(p, lerp(a, b, t))
}
impl CubicBezier {
    /// Validates finite, bounded coordinates before calculation.
    pub fn validate(&self) -> Result<(), String> {
        if self
            .points
            .iter()
            .flatten()
            .all(|v| v.is_finite() && v.abs() <= 1e12)
        {
            Ok(())
        } else {
            Err("coordinates must be finite and within 1e12".into())
        }
    }
    fn projected(&self, axis: usize) -> CubicBez {
        let p = self.points.map(|p| Point::new(p[0], p[axis]));
        CubicBez::new(p[0], p[1], p[2], p[3])
    }
    /// Evaluates a validated parameter.
    pub fn evaluate(&self, t: f64) -> Result<CurvePoint, String> {
        self.validate()?;
        parameter(t)?;
        let a = self.projected(2).eval(t);
        let b = self.projected(1).eval(t);
        Ok([a.x, b.y, a.y])
    }
    /// Returns the XYZ parameter derivative; stationary points return zero.
    pub fn derivative(&self, t: f64) -> Result<CurvePoint, String> {
        self.validate()?;
        parameter(t)?;
        let a = self.projected(2).deriv().eval(t);
        let b = self.projected(1).deriv().eval(t);
        Ok([a.x, b.y, a.y])
    }
    /// Exact de Casteljau subdivision preserving the locus.
    pub fn split(&self, t: f64) -> Result<[Self; 2], String> {
        self.validate()?;
        parameter(t)?;
        let p = self.points;
        let a = lerp(p[0], p[1], t);
        let b = lerp(p[1], p[2], t);
        let c = lerp(p[2], p[3], t);
        let d = lerp(a, b, t);
        let e = lerp(b, c, t);
        let f = lerp(d, e, t);
        Ok([
            Self {
                points: [p[0], a, d, f],
            },
            Self {
                points: [f, e, c, p[3]],
            },
        ])
    }
    /// Reverses traversal, preserving shape.
    pub fn reversed(&self) -> Self {
        Self {
            points: [
                self.points[3],
                self.points[2],
                self.points[1],
                self.points[0],
            ],
        }
    }
    /// Adaptive XYZ sampling using the control-hull distance bound.
    /// Budget exhaustion returns an error, never an inaccurate success.
    pub fn sample(&self, accuracy: f64) -> Result<Vec<CurveSample>, String> {
        self.validate()?;
        tolerance(accuracy)?;
        let mut out = vec![CurveSample {
            t: 0.,
            position: self.points[0],
        }];
        let mut stack = vec![(*self, 0., 1., 0)];
        while let Some((c, a, b, depth)) = stack.pop() {
            let p = c.points;
            if distance_segment(p[1], p[0], p[3]).max(distance_segment(p[2], p[0], p[3]))
                <= accuracy
            {
                out.push(CurveSample {
                    t: b,
                    position: p[3],
                });
            } else {
                if depth >= 24 || out.len() + stack.len() > 65536 {
                    return Err("sampling budget exceeded".into());
                }
                let [left, right] = c.split(0.5)?;
                let mid = (a + b) * 0.5;
                stack.push((right, mid, b, depth + 1));
                stack.push((left, a, mid, depth + 1));
            }
        }
        Ok(out)
    }
    /// Ground-plane arc length.
    pub fn length(&self, accuracy: f64) -> Result<f64, String> {
        self.validate()?;
        tolerance(accuracy)?;
        Ok(self.projected(2).arclen(accuracy))
    }
    /// Ground-plane parameter at a clamped distance.
    pub fn parameter_at_distance(&self, distance: f64, accuracy: f64) -> Result<f64, String> {
        self.validate()?;
        tolerance(accuracy)?;
        if !distance.is_finite() {
            return Err("distance must be finite".into());
        }
        let c = self.projected(2);
        Ok(c.inv_arclen(distance.clamp(0., c.arclen(accuracy)), accuracy))
    }
    /// Nearest ground-plane parameter.
    pub fn nearest(&self, p: CurvePoint, accuracy: f64) -> Result<f64, String> {
        self.validate()?;
        tolerance(accuracy)?;
        if !p.iter().all(|v| v.is_finite()) {
            return Err("query must be finite".into());
        }
        Ok(self
            .projected(2)
            .nearest(Point::new(p[0], p[2]), accuracy)
            .t)
    }
    /// Signed XZ curvature, undefined at stationary points.
    pub fn curvature(&self, t: f64) -> Result<Option<f64>, String> {
        self.validate()?;
        parameter(t)?;
        let d = self.projected(2).deriv();
        let a = d.eval(t);
        let b = d.deriv().eval(t);
        let speed = a.x * a.x + a.y * a.y;
        Ok(if speed <= 1e-24 {
            None
        } else {
            Some((a.x * b.y - a.y * b.x) / speed.powf(1.5))
        })
    }
    /// Removes a shared anchor only when a control-hull error certificate fits the tolerance.
    pub fn merge(&self, next: Self, accuracy: f64) -> Result<Self, String> {
        tolerance(accuracy)?;
        self.validate()?;
        next.validate()?;
        if distance(self.points[3], next.points[0]) > 1e-9 {
            return Err("curves do not share an anchor".into());
        }
        let a = distance(self.points[2], self.points[3]);
        let b = distance(next.points[0], next.points[1]);
        let t = if a + b > 1e-12 { a / (a + b) } else { 0.5 };
        if !(1e-6..1. - 1e-6).contains(&t) {
            return Err("degenerate join cannot be removed".into());
        }
        let candidate = Self {
            points: [
                self.points[0],
                std::array::from_fn(|i| {
                    self.points[0][i] + (self.points[1][i] - self.points[0][i]) / t
                }),
                std::array::from_fn(|i| {
                    next.points[3][i] + (next.points[2][i] - next.points[3][i]) / (1. - t)
                }),
                next.points[3],
            ],
        };
        let halves = candidate.split(t)?;
        for (expected, actual) in [(*self, halves[0]), (next, halves[1])] {
            if expected
                .points
                .iter()
                .zip(actual.points)
                .any(|(a, b)| distance(*a, b) > accuracy)
            {
                return Err("removing this anchor exceeds the shape tolerance".into());
            }
        }
        Ok(candidate)
    }
    /// Pulls an interior point with fixed anchors and minimum squared handle displacement.
    pub fn pull(&self, t: f64, target: CurvePoint) -> Result<Self, String> {
        let current = self.evaluate(t)?;
        if t <= 1e-6 || t >= 1. - 1e-6 {
            return Err("pull requires an interior parameter".into());
        }
        let a = 3. * (1. - t).powi(2) * t;
        let b = 3. * (1. - t) * t * t;
        let den = a * a + b * b;
        let mut c = *self;
        for i in 0..3 {
            let delta = target[i] - current[i];
            c.points[1][i] += delta * a / den;
            c.points[2][i] += delta * b / den;
        }
        c.validate()?;
        Ok(c)
    }
}
/// Constrains the paired opposite handle.
pub fn constrain_handle(
    anchor: CurvePoint,
    moved: CurvePoint,
    opposite: CurvePoint,
    mode: HandleMode,
) -> Result<CurvePoint, String> {
    CubicBezier {
        points: [anchor, moved, opposite, anchor],
    }
    .validate()?;
    let len = distance(anchor, moved);
    match mode {
        HandleMode::Automatic => Err("automatic mode requires neighboring anchors".into()),
        HandleMode::Free => Ok(opposite),
        _ if len <= 1e-12 => Ok(anchor),
        HandleMode::Mirrored => Ok(std::array::from_fn(|i| 2. * anchor[i] - moved[i])),
        HandleMode::Aligned => Ok(std::array::from_fn(|i| {
            anchor[i] - (moved[i] - anchor[i]) * distance(anchor, opposite) / len
        })),
    }
}
/// Converts a legacy centripetal chain to explicit cubics using XZ knot spacing.
/// Endpoint reflection matches legacy evaluation; duplicate anchors are rejected.
pub fn automatic_path(points: &[CurvePoint]) -> Result<Vec<CubicBezier>, String> {
    if points.len() < 2 {
        return Err("a path needs two anchors".into());
    }
    let closed = points.len() > 3 && distance(points[0], points[points.len() - 1]) < 1e-9;
    let mut out = Vec::new();
    for i in 0..points.len() - 1 {
        let p1 = points[i];
        let p2 = points[i + 1];
        let p0 = if i == 0 && closed {
            points[points.len() - 2]
        } else if i == 0 {
            std::array::from_fn(|j| 2. * p1[j] - p2[j])
        } else {
            points[i - 1]
        };
        let p3 = if i + 2 == points.len() && closed {
            points[1]
        } else if i + 2 == points.len() {
            std::array::from_fn(|j| 2. * p2[j] - p1[j])
        } else {
            points[i + 2]
        };
        let knot = |a: CurvePoint, b: CurvePoint| {
            ((a[0] - b[0]).powi(2) + (a[2] - b[2]).powi(2))
                .sqrt()
                .sqrt()
        };
        let a = knot(p0, p1);
        let b = knot(p1, p2);
        let c = knot(p2, p3);
        if a.min(b).min(c) <= 1e-9 {
            return Err("adjacent anchors coincide in XZ".into());
        }
        let h1 = std::array::from_fn(|j| {
            p1[j] + b * ((p1[j] - p0[j]) / a - (p2[j] - p0[j]) / (a + b) + (p2[j] - p1[j]) / b) / 3.
        });
        let h2 = std::array::from_fn(|j| {
            p2[j] - b * ((p2[j] - p1[j]) / b - (p3[j] - p1[j]) / (b + c) + (p3[j] - p2[j]) / c) / 3.
        });
        let curve = CubicBezier {
            points: [p1, h1, h2, p2],
        };
        curve.validate()?;
        out.push(curve);
    }
    Ok(out)
}
/// Fits captured samples with a deterministic error bound at each captured point.
/// Original anchors are retained whenever a cubic cannot meet that bound.
pub fn fit_path(points: &[CurvePoint], accuracy: f64) -> Result<Vec<CubicBezier>, String> {
    tolerance(accuracy)?;
    if points.len() > 4096 {
        return Err("stroke sample budget exceeded".into());
    }
    // Distinct **in XZ**, which is the metric `automatic_path` measures its
    // knots with -- not 3D distance. Two samples sharing a ground position
    // and differing only in height are one station of the path, however far
    // apart they sit vertically, and keeping both leaves `automatic_path`
    // with a zero knot and nothing to do but refuse the whole stroke.
    //
    // A pointer produces that pair readily: snap the ground position to a
    // grid and every sample inside one cell lands on the same XZ while the
    // height under the cursor goes on varying with the surface. Deduplicating
    // in 3D let every one of those through.
    let mut clean: Vec<CurvePoint> = Vec::new();
    for p in points {
        if clean
            .last()
            .is_none_or(|q| ((p[0] - q[0]).powi(2) + (p[2] - q[2]).powi(2)).sqrt() > 1e-8)
        {
            clean.push(*p);
        }
    }
    if clean.len() < 2 {
        return Err("stroke needs distinct samples".into());
    }
    let mut indices = if clean.len() > 3 && distance(clean[0], clean[clean.len() - 1]) < 1e-9 {
        vec![0, clean.len() / 3, 2 * clean.len() / 3, clean.len() - 1]
    } else {
        vec![0, clean.len() - 1]
    };
    loop {
        let anchors: Vec<_> = indices.iter().map(|i| clean[*i]).collect();
        let curves = automatic_path(&anchors)?;
        let mut additions = Vec::new();
        for (span, c) in curves.iter().enumerate() {
            let mut worst = (accuracy, 0);
            for (i, p) in clean
                .iter()
                .enumerate()
                .take(indices[span + 1])
                .skip(indices[span] + 1)
            {
                let t = c.nearest(*p, accuracy * 0.01)?;
                let error = distance(*p, c.evaluate(t)?);
                if error > worst.0 {
                    worst = (error, i);
                }
            }
            if worst.0 > accuracy {
                additions.push(worst.1);
            }
        }
        if additions.is_empty() {
            return Ok(curves);
        }
        indices.extend(additions);
        indices.sort_unstable();
        indices.dedup();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn s() -> CubicBezier {
        CubicBezier {
            points: [[0., 0., 0.], [2., 1., 8.], [8., 2., -8.], [10., 3., 0.]],
        }
    }
    #[test]
    fn inflection_is_not_flat() {
        assert!(s().sample(0.01).unwrap().len() > 10);
    }
    #[test]
    fn insertion_preserves_shape() {
        for cut in [0.01, 0.25, 0.5, 0.93] {
            let [a, b] = s().split(cut).unwrap();
            for i in 0..=100 {
                let t = i as f64 / 100.;
                let p = if t <= cut {
                    a.evaluate(t / cut)
                } else {
                    b.evaluate((t - cut) / (1. - cut))
                }
                .unwrap();
                assert!(distance(p, s().evaluate(t).unwrap()) < 1e-10);
            }
        }
    }
    #[test]
    fn pull_hits_target() {
        let target = [4., 2., 3.];
        let c = s().pull(0.4, target).unwrap();
        assert_eq!(c.points[0], s().points[0]);
        assert_eq!(c.points[3], s().points[3]);
        assert!(distance(c.evaluate(0.4).unwrap(), target) < 1e-10);
    }
    #[test]
    fn distance_round_trip() {
        let c = s();
        let length = c.length(1e-6).unwrap();
        assert!(length > 10.);
        assert!((c.parameter_at_distance(length / 2., 1e-6).unwrap() - 0.5).abs() < 1e-5);
    }
    #[test]
    fn rejects_invalid() {
        assert!(s().sample(0.).is_err());
        assert!(s().split(f64::NAN).is_err());
        assert!(
            CubicBezier {
                points: [[f64::INFINITY; 3]; 4]
            }
            .evaluate(0.5)
            .is_err()
        );
    }
    #[test]
    fn removal_reverses_unequal_split_and_certifies_error() {
        let curve = s();
        let parts = curve.split(0.27).unwrap();
        let merged = parts[0].merge(parts[1], 1e-9).unwrap();
        for i in 0..=100 {
            assert!(
                distance(
                    curve.evaluate(i as f64 / 100.).unwrap(),
                    merged.evaluate(i as f64 / 100.).unwrap()
                ) < 1e-9
            );
        }
        let mut deformed = parts[1];
        deformed.points[1][2] += 1.;
        assert!(parts[0].merge(deformed, 0.001).is_err());
    }
    #[test]
    fn a_stroke_that_paused_over_a_slope_still_fits() {
        // A snapped pointer holding still inside one grid cell: the ground
        // position repeats exactly while the height under the cursor keeps
        // moving. Deduplicated in 3D these all survive, and `automatic_path`
        // then refuses the whole stroke over a zero knot -- which reached the
        // user as "adjacent anchors coincide in XZ" and lost the road.
        let stroke = [
            [0., 0., 0.],
            [4., 0.3, 0.],
            [4., 0.9, 0.],
            [4., 1.4, 0.],
            [8., 2., 0.],
        ];
        let curves = fit_path(&stroke, 0.05).expect("a paused stroke is still one path");
        assert!(!curves.is_empty());
    }

    #[test]
    fn a_stroke_with_no_ground_extent_is_still_refused() {
        // Collapsing every repeated station must not collapse the refusal
        // too: a stroke that never travelled is not a path.
        let stroke = [[3., 0., 7.], [3., 1., 7.], [3., 2., 7.]];
        assert!(fit_path(&stroke, 0.05).is_err());
    }

    #[test]
    fn closed_automatic_path_has_a_shared_tangent() {
        let curves = automatic_path(&[
            [-10., 0., 0.],
            [0., 0., -10.],
            [10., 0., 0.],
            [0., 0., 10.],
            [-10., 0., 0.],
        ])
        .unwrap();
        assert!(
            distance(
                curves[0].derivative(0.).unwrap(),
                curves[3].derivative(1.).unwrap()
            ) < 1e-9
        );
    }
    #[test]
    fn handle_modes_have_distinct_length_contracts() {
        let a = [0., 0., 0.];
        let p = [2., 0., 0.];
        let other = [0., 0., 3.];
        assert_eq!(
            constrain_handle(a, p, other, HandleMode::Free).unwrap(),
            other
        );
        assert_eq!(
            constrain_handle(a, p, other, HandleMode::Mirrored).unwrap(),
            [-2., 0., 0.]
        );
        assert_eq!(
            constrain_handle(a, p, other, HandleMode::Aligned).unwrap(),
            [-3., 0., 0.]
        );
        assert!(constrain_handle(a, p, other, HandleMode::Automatic).is_err());
    }
    #[test]
    fn two_anchors_are_straight() {
        let c = automatic_path(&[[0., 0., 0.], [9., 0., 0.]]).unwrap()[0];
        assert_eq!(c.points[1], [3., 0., 0.]);
        assert_eq!(c.points[2], [6., 0., 0.]);
    }
}
