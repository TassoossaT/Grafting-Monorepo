//! Four-sheet caps with one shared base and maximum elevation.
use crate::profile_surface::{ProfileSheet, Section, closed_sheet_profiles};

/// Analytic base shape for a four-sheet cap.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CapBase {
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
    let profiles = closed_sheet_profiles(&curvatures)?;
    let top = elevation + height;
    let sections: [(Section, Section); 4] = match base {
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
