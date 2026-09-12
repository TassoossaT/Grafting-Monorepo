//! Curved sheets between two analytic cross-sections.
//!
//! The source sections and profile are authoritative; tessellation is only a
//! derived approximation. Adjacent sheets share endpoint profile values, so
//! independently authored interiors do not open cracks along their seam.

/// An analytic horizontal cross-section, in XYZ coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Section {
    /// A straight segment, including a collapsed segment at an apex.
    Line {
        /// First endpoint.
        start: [f64; 3],
        /// Second endpoint.
        end: [f64; 3],
    },
    /// A circular arc preserving its exact radius and angular interval.
    Arc {
        /// Circle center, including its elevation.
        center: [f64; 3],
        /// Positive radius.
        radius: f64,
        /// Starting angle in radians in XZ.
        start_angle: f64,
        /// Signed angular sweep in radians, at most one revolution.
        sweep: f64,
    },
}

impl Section {
    /// Validates finite coordinates and a nonempty circular arc.
    pub fn validate(&self) -> Result<(), String> {
        let valid = match self {
            Self::Line { start, end } => {
                start.iter().chain(end).all(|x| x.is_finite()) && (start[1] - end[1]).abs() <= 1e-9
            }
            Self::Arc {
                center,
                radius,
                start_angle,
                sweep,
            } => {
                center.iter().all(|x| x.is_finite())
                    && radius.is_finite()
                    && *radius > 0.0
                    && start_angle.is_finite()
                    && sweep.is_finite()
                    && sweep.abs() > 0.0
                    && sweep.abs() <= std::f64::consts::TAU
            }
        };
        if valid {
            Ok(())
        } else {
            Err("invalid horizontal section".into())
        }
    }

    /// Evaluates the exact cross-section at a parameter in `[0, 1]`.
    pub fn point(&self, u: f64) -> Result<[f64; 3], String> {
        self.validate()?;
        unit(u)?;
        let point = self.point_unchecked(u);
        if point.iter().any(|v| !v.is_finite()) {
            return Err("section evaluation exceeds coordinate range".into());
        }
        Ok(point)
    }

    fn point_unchecked(&self, u: f64) -> [f64; 3] {
        match *self {
            Self::Line { start, end } => {
                std::array::from_fn(|i| start[i] + u * (end[i] - start[i]))
            }
            Self::Arc {
                center,
                radius,
                start_angle,
                sweep,
            } => {
                let angle = start_angle + u * sweep;
                [
                    center[0] + radius * angle.cos(),
                    center[1],
                    center[2] + radius * angle.sin(),
                ]
            }
        }
    }
}

fn unit(t: f64) -> Result<(), String> {
    if t.is_finite() && (0.0..=1.0).contains(&t) {
        Ok(())
    } else {
        Err("surface parameter must be finite and in [0, 1]".into())
    }
}

/// A monotone elevation profile with independent interior and seam controls.
/// Values in `[-1, 1]` bend the sheet without moving either cross-section or
/// overshooting their elevations. Zero describes a straight profile.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SheetProfile {
    /// Curvature at the first shared side.
    pub start: f64,
    /// Curvature in the middle of this sheet.
    pub middle: f64,
    /// Curvature at the second shared side.
    pub end: f64,
}

impl SheetProfile {
    /// Validates the profile without clamping malformed input.
    pub fn validate(&self) -> Result<(), String> {
        if [self.start, self.middle, self.end]
            .iter()
            .all(|c| c.is_finite() && (-1.0..=1.0).contains(c))
        {
            Ok(())
        } else {
            Err("sheet curvature must be finite and in [-1, 1]".into())
        }
    }

    /// Returns normalized elevation at cross-section parameter `u` and rise `v`.
    /// A smooth interpolation reaches the authored middle value exactly.
    pub fn elevation(&self, u: f64, v: f64) -> Result<f64, String> {
        self.validate()?;
        unit(u)?;
        unit(v)?;
        let (a, b, t) = if u <= 0.5 {
            (self.start, self.middle, 2.0 * u)
        } else {
            (self.middle, self.end, 2.0 * u - 1.0)
        };
        let blend = t * t * (3.0 - 2.0 * t);
        let curvature = a + (b - a) * blend;
        Ok(v + curvature * v * (1.0 - v))
    }
}

/// A sheet whose lateral boundaries can be shared by neighboring sheets.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProfileSheet {
    /// Lower analytic section.
    pub lower: Section,
    /// Upper analytic section; may collapse to an apex.
    pub upper: Section,
    /// Independent interior and shared side profile values.
    pub profile: SheetProfile,
}

impl ProfileSheet {
    /// Evaluates the surface without replacing its analytic source by vertices.
    /// XZ follows the ruled section; elevation follows the bounded profile.
    pub fn point(&self, u: f64, v: f64) -> Result<[f64; 3], String> {
        let lower = self.lower.point(u)?;
        let upper = self.upper.point(u)?;
        let rise = self.profile.elevation(u, v)?;
        let point = [
            lower[0] + v * (upper[0] - lower[0]),
            lower[1] + rise * (upper[1] - lower[1]),
            lower[2] + v * (upper[2] - lower[2]),
        ];
        if point.iter().any(|v| !v.is_finite()) {
            return Err("sheet evaluation exceeds coordinate range".into());
        }
        Ok(point)
    }
}

/// Resolves a closed ring of independently authored sheet curvatures.
/// Each shared side receives the mean of its two incident sheets. This gives
/// both sheets identical boundary profiles while preserving their middle values.
pub fn closed_sheet_profiles(curvatures: &[f64]) -> Result<Vec<SheetProfile>, String> {
    if curvatures.len() < 2 || curvatures.len() > 4096 {
        return Err("a sheet ring requires between 2 and 4096 entries".into());
    }
    if curvatures
        .iter()
        .any(|c| !c.is_finite() || !(-1.0..=1.0).contains(c))
    {
        return Err("sheet curvature must be finite and in [-1, 1]".into());
    }
    Ok(curvatures
        .iter()
        .enumerate()
        .map(|(i, &middle)| SheetProfile {
            start: (curvatures[(i + curvatures.len() - 1) % curvatures.len()] + middle) * 0.5,
            middle,
            end: (middle + curvatures[(i + 1) % curvatures.len()]) * 0.5,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profiles_preserve_height_and_remain_monotone() {
        for c in [-1.0, -0.3, 0.0, 0.7, 1.0] {
            let profile = SheetProfile {
                start: -c,
                middle: c,
                end: 0.0,
            };
            for u in [0.0, 0.2, 0.5, 0.9, 1.0] {
                assert_eq!(profile.elevation(u, 0.0).unwrap(), 0.0);
                assert_eq!(profile.elevation(u, 1.0).unwrap(), 1.0);
                let mut previous = 0.0;
                for i in 0..=100 {
                    let y = profile.elevation(u, f64::from(i) / 100.0).unwrap();
                    assert!((previous..=1.0).contains(&y));
                    previous = y;
                }
            }
        }
    }

    #[test]
    fn four_curved_leaves_share_seams_and_apex() {
        let profiles = closed_sheet_profiles(&[-1.0, 0.0, 1.0, 0.4]).unwrap();
        let apex = [7.0, 8.0, -2.0];
        let sheets: Vec<_> = profiles
            .into_iter()
            .enumerate()
            .map(|(i, profile)| ProfileSheet {
                lower: Section::Arc {
                    center: [7.0, 3.0, -2.0],
                    radius: 4.0,
                    start_angle: i as f64 * std::f64::consts::FRAC_PI_2,
                    sweep: std::f64::consts::FRAC_PI_2,
                },
                upper: Section::Line {
                    start: apex,
                    end: apex,
                },
                profile,
            })
            .collect();
        assert_eq!(sheets.len(), 4);
        for i in 0..4 {
            for j in 0..=20 {
                let v = f64::from(j) / 20.0;
                let a = sheets[i].point(1.0, v).unwrap();
                let b = sheets[(i + 1) % 4].point(0.0, v).unwrap();
                for k in 0..3 {
                    assert!((a[k] - b[k]).abs() < 1e-12);
                }
                let top = sheets[i].point(v, 1.0).unwrap();
                for k in 0..3 {
                    assert!((top[k] - apex[k]).abs() < 1e-12);
                }
                let base = sheets[i].point(v, 0.0).unwrap();
                assert!(((base[0] - 7.0).hypot(base[2] + 2.0) - 4.0).abs() < 1e-12);
                assert_eq!(base[1], 3.0);
            }
        }
        assert_ne!(
            sheets[0].point(0.5, 0.5).unwrap()[1],
            sheets[2].point(0.5, 0.5).unwrap()[1]
        );
    }

    #[test]
    fn malformed_inputs_are_rejected() {
        assert!(closed_sheet_profiles(&[0.0, f64::NAN]).is_err());
        assert!(closed_sheet_profiles(&[0.0, 1.01]).is_err());
        assert!(closed_sheet_profiles(&[]).is_err());
        let line = Section::Line {
            start: [0.0; 3],
            end: [1.0, 2.0, 1.0],
        };
        assert!(line.point(0.5).is_err());
        let arc = Section::Arc {
            center: [0.0; 3],
            radius: 0.0,
            start_angle: 0.0,
            sweep: 1.0,
        };
        assert!(arc.point(0.5).is_err());
        let profile = SheetProfile {
            start: 0.0,
            middle: 0.0,
            end: 0.0,
        };
        assert!(profile.elevation(f64::NAN, 0.5).is_err());
        assert!(profile.elevation(0.5, 1.01).is_err());
    }
}
