//! Four-sheet caps with one shared base and maximum elevation.
use crate::profile_surface::{ProfileSheet, Section, closed_sheet_profiles};

/// Analytic base shape for a four-sheet cap.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "curve-serde", serde(tag = "kind", rename_all = "camelCase"))]
pub enum CapBase {
    /// Four authored boundary corners, with optional circular centers per edge.
    /// Recognizes axis-aligned rectangles and four cardinal circular quadrants;
    /// other contours are rejected rather than replaced by a bounding rectangle.
    Contour {
        /// Ordered XZ corners.
        points: [[f64; 2]; 4],
        /// One center per outgoing edge, absent for a straight segment.
        centers: [Option<[f64; 2]>; 4],
    },
    /// Axis-aligned rectangle in XZ. Coordinates must be strictly ordered.
    Rectangle {
        /// Minimum XZ corner.
        min: [f64; 2],
        /// Maximum XZ corner.
        max: [f64; 2],
    },
    /// Exact circular base, divided at the four cardinal angles.
    Circle {
        /// Center in XZ.
        center: [f64; 2],
        /// Positive radius.
        radius: f64,
    },
}

/// Resolves a supported authored contour without approximating its footprint.
pub fn resolve_cap_base(base: CapBase) -> Result<CapBase, String> {
    let CapBase::Contour { points, centers } = base else {
        return Ok(base);
    };
    if points.iter().flatten().any(|v| !v.is_finite()) {
        return Err("cap contour coordinates must be finite".into());
    }
    if centers.iter().all(Option::is_none) {
        let min = std::array::from_fn(|axis| {
            points.iter().map(|p| p[axis]).fold(f64::INFINITY, f64::min)
        });
        let max = std::array::from_fn(|axis| {
            points
                .iter()
                .map(|p| p[axis])
                .fold(f64::NEG_INFINITY, f64::max)
        });
        for i in 0..4 {
            let a = points[i];
            let b = points[(i + 1) % 4];
            if a == b
                || points[..i].contains(&a)
                || (a[0] != b[0] && a[1] != b[1])
                || (0..2).any(|axis| a[axis] != min[axis] && a[axis] != max[axis])
            {
                return Err("this cap requires a rectangular or circular contour".into());
            }
        }
        return Ok(CapBase::Rectangle { min, max });
    }
    if let Some(center) = centers[0] {
        if center.iter().all(|v| v.is_finite())
            && centers.iter().all(|value| *value == Some(center))
        {
            let radius = (points[0][0] - center[0]).hypot(points[0][1] - center[1]);
            if radius <= 0.0 || !radius.is_finite() {
                return Err("invalid circular cap contour".into());
            }
            let tolerance = radius * 1e-6;
            let mut direction = 0.0_f64;
            for i in 0..4 {
                let a = [points[i][0] - center[0], points[i][1] - center[1]];
                let b = [
                    points[(i + 1) % 4][0] - center[0],
                    points[(i + 1) % 4][1] - center[1],
                ];
                let cross = a[0] * b[1] - a[1] * b[0];
                if (a[0].hypot(a[1]) - radius).abs() > tolerance
                    || (a[0].abs() > tolerance && a[1].abs() > tolerance)
                    || (a[0] * b[0] + a[1] * b[1]).abs() > radius * tolerance
                    || cross == 0.0
                    || (i > 0 && cross.signum() != direction)
                {
                    return Err("circular cap requires four consecutive cardinal quadrants".into());
                }
                direction = cross.signum();
            }
            return Ok(CapBase::Circle { center, radius });
        }
    }
    Err("mixed curved contours require a compound cap generator".into())
}

/// Generates four analytic sheets with independently authored curvature.
///
/// Rectangular caps use a ridge along the longer axis, with equal horizontal
/// run on all sides. Circular caps retain four quarter-circle lower sections
/// meeting at one apex. No mesh vertices are introduced by this operation.
pub fn four_sheet_cap(
    base: CapBase,
    elevation: f64,
    height: f64,
    curvatures: [f64; 4],
) -> Result<[ProfileSheet; 4], String> {
    if !elevation.is_finite()
        || !height.is_finite()
        || height <= 0.0
        || !(elevation + height).is_finite()
        || elevation + height <= elevation
    {
        return Err("cap requires a finite base and a representable positive height".into());
    }
    let base = resolve_cap_base(base)?;
    let profiles = closed_sheet_profiles(&curvatures)?;
    let top = elevation + height;
    let sections: [(Section, Section); 4] = match base {
        CapBase::Contour { .. } => return Err("unresolved cap contour".into()),
        CapBase::Circle { center, radius } => {
            if center.iter().any(|v| !v.is_finite())
                || !radius.is_finite()
                || radius <= 0.0
                || center
                    .iter()
                    .any(|v| !(v + radius).is_finite() || !(v - radius).is_finite())
            {
                return Err("cap circle requires a finite center and positive radius".into());
            }
            let apex = [center[0], top, center[1]];
            std::array::from_fn(|i| {
                (
                    Section::Arc {
                        center: [center[0], elevation, center[1]],
                        radius,
                        start_angle: i as f64 * std::f64::consts::FRAC_PI_2,
                        sweep: std::f64::consts::FRAC_PI_2,
                    },
                    Section::Line {
                        start: apex,
                        end: apex,
                    },
                )
            })
        }
        CapBase::Rectangle { min, max } => {
            if min.iter().chain(&max).any(|v| !v.is_finite())
                || max[0] <= min[0]
                || max[1] <= min[1]
            {
                return Err("cap rectangle requires finite, ordered corners".into());
            }
            let width = max[0] - min[0];
            let depth = max[1] - min[1];
            if !width.is_finite() || !depth.is_finite() {
                return Err("cap rectangle extent is too large".into());
            }
            let inset = width.min(depth) * 0.5;
            let bottom = [
                [min[0], elevation, min[1]],
                [max[0], elevation, min[1]],
                [max[0], elevation, max[1]],
                [min[0], elevation, max[1]],
            ];
            let upper = [
                [min[0] + inset, top, min[1] + inset],
                [max[0] - inset, top, min[1] + inset],
                [max[0] - inset, top, max[1] - inset],
                [min[0] + inset, top, max[1] - inset],
            ];
            std::array::from_fn(|i| {
                (
                    Section::Line {
                        start: bottom[i],
                        end: bottom[(i + 1) % 4],
                    },
                    Section::Line {
                        start: upper[i],
                        end: upper[(i + 1) % 4],
                    },
                )
            })
        }
    };
    Ok(std::array::from_fn(|i| ProfileSheet {
        lower: sections[i].0,
        upper: sections[i].1,
        profile: profiles[i],
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rectangular_cap_has_a_ridge_and_four_connected_sheets() {
        let cap = four_sheet_cap(
            CapBase::Rectangle {
                min: [0.0, 0.0],
                max: [10.0, 4.0],
            },
            3.0,
            5.0,
            [-1.0, 0.5, 1.0, 0.0],
        )
        .unwrap();
        assert_eq!(cap[0].point(0.0, 1.0).unwrap(), [2.0, 8.0, 2.0]);
        assert_eq!(cap[0].point(1.0, 1.0).unwrap(), [8.0, 8.0, 2.0]);
        for i in 0..4 {
            for j in 0..=16 {
                let t = f64::from(j) / 16.0;
                let a = cap[i].point(1.0, t).unwrap();
                let b = cap[(i + 1) % 4].point(0.0, t).unwrap();
                assert_eq!(a, b);
                assert_eq!(cap[i].point(t, 0.0).unwrap()[1], 3.0);
                assert_eq!(cap[i].point(t, 1.0).unwrap()[1], 8.0);
            }
        }
    }

    #[test]
    fn footprint_resize_preserves_authored_height() {
        for radius in [0.2, 2.0, 20.0] {
            let cap = four_sheet_cap(
                CapBase::Circle {
                    center: [1.0, -3.0],
                    radius,
                },
                4.0,
                6.0,
                [0.0; 4],
            )
            .unwrap();
            assert_eq!(cap.len(), 4);
            for sheet in cap {
                assert_eq!(sheet.point(0.5, 1.0).unwrap(), [1.0, 10.0, -3.0]);
            }
        }
    }

    #[test]
    fn invalid_cap_never_produces_geometry() {
        let base = CapBase::Circle {
            center: [0.0; 2],
            radius: 2.0,
        };
        for height in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(four_sheet_cap(base, 0.0, height, [0.0; 4]).is_err());
        }
        assert!(four_sheet_cap(base, f64::INFINITY, 1.0, [0.0; 4]).is_err());
        assert!(
            four_sheet_cap(
                CapBase::Rectangle {
                    min: [0.0; 2],
                    max: [0.0, 2.0]
                },
                0.0,
                1.0,
                [0.0; 4]
            )
            .is_err()
        );
    }
}
