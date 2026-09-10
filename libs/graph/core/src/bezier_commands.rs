//! Batched curve operations for runtime adapters.
use crate::bezier::{
    CubicBezier, CurveHandles, CurvePoint, CurveSample, HandleMode, automatic_path,
    constrain_handle,
};
/// A generic authored-curve operation.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "curve-serde", serde(tag = "kind", rename_all = "camelCase"))]
pub enum CurveCommand {
    /// Convert a legacy/automatic anchor chain.
    Automatic {
        /// Ordered anchors.
        points: Vec<CurvePoint>,
    },
    /// Fit a captured stroke within the batch tolerance at its samples.
    Fit {
        /// Captured XYZ samples.
        points: Vec<CurvePoint>,
    },
    /// Derive a ribbon from independent lateral offsets.
    Ribbon {
        /// Authored cubic.
        curve: CubicBezier,
        /// Left and right offsets.
        offsets: [f64; 2],
        /// Optional ending profile.
        #[cfg_attr(feature = "curve-serde", serde(default, rename = "endOffsets"))]
        end_offsets: Option<[f64; 2]>,
    },
    /// Evaluate several explicit segments.
    Sample {
        /// Ordered cubics.
        curves: Vec<CubicBezier>,
    },
    /// Insert an anchor exactly.
    Split {
        /// Authored segment.
        curve: CubicBezier,
        /// Insertion parameter.
        t: f64,
        /// Optional authored profile to subdivide together with the curve.
        #[cfg_attr(feature = "curve-serde", serde(default))]
        profile: Option<CurveHandles>,
    },
    /// Remove a shared anchor with a certified shape tolerance.
    Merge {
        /// First oriented cubic.
        curve: CubicBezier,
        /// Next oriented cubic.
        next: CubicBezier,
    },
    /// Manipulate an interior point.
    Pull {
        /// Authored segment.
        curve: CubicBezier,
        /// Parameter to pull.
        t: f64,
        /// Desired position.
        target: CurvePoint,
    },
    /// Move a handle, applying its paired continuity constraint.
    Handle {
        /// Authored segment.
        curve: CubicBezier,
        /// Index 1 or 2.
        index: usize,
        /// Desired control position.
        target: CurvePoint,
        /// Constraint for the opposite handle at this anchor.
        mode: HandleMode,
        /// Optional paired handle on another incident edge.
        opposite: Option<CurvePoint>,
    },
    /// Query a point against a segment.
    Nearest {
        /// Authored segment.
        curve: CubicBezier,
        /// Query position.
        point: CurvePoint,
    },
    /// Resolve graph-owned controls against updated anchors.
    Resolve {
        /// Relative controls.
        handles: CurveHandles,
        /// Start anchor.
        start: CurvePoint,
        /// End anchor.
        end: CurvePoint,
    },
}
/// A batch with one explicit approximation tolerance.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CurveBatch {
    /// World-space approximation tolerance.
    pub tolerance: f64,
    /// Ordered operations; errors reject the entire batch.
    pub commands: Vec<CurveCommand>,
}
/// One operation result.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CurveResult {
    /// Optional derived ribbon polygon.
    pub ribbon: Option<crate::bezier_surface::CurveRibbon>,
    /// Resulting authored cubics.
    pub curves: Vec<CubicBezier>,
    /// Relative controls suitable for durable graph edge payloads.
    pub handles: Vec<CurveHandles>,
    /// Samples grouped by cubic, including original parameters.
    pub samples: Vec<Vec<CurveSample>>,
    /// Ground-plane lengths.
    pub lengths: Vec<f64>,
    /// Optional nearest parameter.
    pub parameter: Option<f64>,
    /// Optional paired handle after applying the constraint.
    pub opposite: Option<CurvePoint>,
}
/// Validates and executes a bounded batch without changing caller state.
pub fn execute(batch: CurveBatch) -> Result<Vec<CurveResult>, String> {
    if !batch.tolerance.is_finite() || batch.tolerance <= 0. {
        return Err("curve tolerance must be positive and finite".into());
    }
    if batch.commands.len() > 4096 {
        return Err("curve command budget exceeded".into());
    }
    let mut out = Vec::new();
    for cmd in batch.commands {
        let mut nearest = None;
        let mut opposite_result = None;
        let mut ribbon = None;
        let mut authored = None;
        let curves = match cmd {
            CurveCommand::Automatic { points } => automatic_path(&points)?,
            CurveCommand::Fit { points } => crate::bezier::fit_path(&points, batch.tolerance)?,
            CurveCommand::Sample { curves } => curves,
            CurveCommand::Ribbon {
                curve,
                offsets,
                end_offsets,
            } => {
                ribbon = Some(crate::bezier_surface::ribbon_profile(
                    curve,
                    offsets,
                    end_offsets.unwrap_or(offsets),
                    batch.tolerance,
                )?);
                vec![curve]
            }
            CurveCommand::Split { curve, t, profile } => {
                let curves = curve.split(t)?;
                if let Some(profile) = profile {
                    let stations = [
                        profile.profile_at(0.)?,
                        profile.profile_at(t)?,
                        profile.profile_at(1.)?,
                    ];
                    authored = Some(
                        curves
                            .iter()
                            .enumerate()
                            .map(|(i, c)| {
                                let mut h =
                                    CurveHandles::from_curve(*c, profile.mode, stations[i].clone());
                                if stations[i] != stations[i + 1] {
                                    h.end_band_offsets = stations[i + 1].clone();
                                }
                                h
                            })
                            .collect::<Vec<_>>(),
                    );
                }
                curves.to_vec()
            }
            CurveCommand::Merge { curve, next } => vec![curve.merge(next, batch.tolerance)?],
            CurveCommand::Pull { curve, t, target } => vec![curve.pull(t, target)?],
            CurveCommand::Resolve {
                handles,
                start,
                end,
            } => vec![handles.resolve(start, end)],
            CurveCommand::Nearest { curve, point } => {
                nearest = Some(curve.nearest(point, batch.tolerance)?);
                vec![curve]
            }
            CurveCommand::Handle {
                mut curve,
                index,
                target,
                mode,
                opposite,
            } => {
                if index != 1 && index != 2 {
                    return Err("handle index must be 1 or 2".into());
                }
                if let Some(p) = opposite {
                    opposite_result = Some(constrain_handle(
                        curve.points[if index == 1 { 0 } else { 3 }],
                        target,
                        p,
                        mode,
                    )?);
                }
                curve.points[index] = target;
                curve.validate()?;
                vec![curve]
            }
        };
        if curves.len() > 4096 {
            return Err("curve count budget exceeded".into());
        }
        let samples = curves
            .iter()
            .map(|c| c.sample(batch.tolerance))
            .collect::<Result<Vec<_>, _>>()?;
        let lengths = curves
            .iter()
            .map(|c| c.length(batch.tolerance))
            .collect::<Result<Vec<_>, _>>()?;
        let handles = authored.unwrap_or_else(|| {
            curves
                .iter()
                .map(|c| CurveHandles::from_curve(*c, HandleMode::Free, Vec::new()))
                .collect()
        });
        out.push(CurveResult {
            ribbon,
            curves,
            handles,
            samples,
            lengths,
            parameter: nearest,
            opposite: opposite_result,
        });
    }
    Ok(out)
}
