//! Indexed, shared-boundary topology for analytic caps. No live graph mutation.
use crate::profile_cap::{CapBase, four_sheet_cap, resolve_cap_base};
use crate::profile_surface::{Section, SheetProfile};

/// Pure generation request with one common elevation and height.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CapRequest {
    /// Exact base shape.
    pub base: CapBase,
    /// Base elevation.
    pub elevation: f64,
    /// Maximum rise above the base.
    pub height: f64,
    /// Horizontal expansion of the base contour.
    pub overhang: f64,
    /// One curvature per leaf, in boundary order.
    pub curvatures: [f64; 4],
}

/// One indexed edge; arc geometry belongs to the edge rather than its faces.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CapEdge {
    /// Index of the first node.
    pub start: usize,
    /// Index of the second node.
    pub end: usize,
    /// Circle center in XZ, absent for a line. Generated arcs run CCW.
    pub center: Option<[f64; 2]>,
}

/// A logical face bounded by shared indexed edges, not by rendering triangles.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CapFace {
    /// `(edge index, reversed)` uses, starting with the lower section.
    pub boundary: Vec<(usize, bool)>,
    /// Intrinsic elevation profile; coordinates remain on graph nodes.
    pub profile: SheetProfile,
}

/// Transient cap description ready for a caller to assign graph identities.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CapPatch {
    /// Unique XYZ nodes.
    pub nodes: Vec<[f64; 3]>,
    /// Shared analytic edges.
    pub edges: Vec<CapEdge>,
    /// Four logical leaves.
    pub faces: Vec<CapFace>,
    /// Transient XYZ segment endpoints for an analytic-profile preview.
    pub preview: Vec<[f64; 6]>,
}

/// Generates a cap with shared seam identities and no degenerate apex edges.
pub fn generate_cap_patch(request: CapRequest) -> Result<CapPatch, String> {
    if (request.elevation + request.height) as f32 <= request.elevation as f32 {
        return Err("cap height collapsed at graph precision".into());
    }
    if !request.overhang.is_finite() || request.overhang < 0.0 {
        return Err("overhang must be finite and nonnegative".into());
    }
    // Validate the source before expansion, so overhang cannot rescue an invalid base.
    four_sheet_cap(
        request.base,
        request.elevation,
        request.height,
        request.curvatures,
    )?;
    let base = match resolve_cap_base(request.base)? {
        CapBase::Contour { .. } => return Err("unresolved cap contour".into()),
        CapBase::Circle { center, radius } => CapBase::Circle {
            center,
            radius: radius + request.overhang,
        },
        CapBase::Rectangle { min, max } => CapBase::Rectangle {
            min: min.map(|v| v - request.overhang),
            max: max.map(|v| v + request.overhang),
        },
    };
    let sheets = four_sheet_cap(base, request.elevation, request.height, request.curvatures)?;
    let mut patch = CapPatch {
        nodes: Vec::new(),
        edges: Vec::new(),
        faces: Vec::new(),
        preview: Vec::new(),
    };
    for sheet in sheets {
        // Include the curved eave, one shared side, and the interior rise profile.
        // These samples are presentation data, never authoritative graph nodes.
        for step in 0..32 {
            let a = f64::from(step) / 32.0;
            let b = f64::from(step + 1) / 32.0;
            for (start, end) in [
                (sheet.point(a, 0.0)?, sheet.point(b, 0.0)?),
                (sheet.point(0.0, a)?, sheet.point(0.0, b)?),
                (sheet.point(0.5, a)?, sheet.point(0.5, b)?),
            ] {
                patch
                    .preview
                    .push([start[0], start[1], start[2], end[0], end[1], end[2]]);
            }
        }
        let corners = [
            sheet.lower.point(0.0)?,
            sheet.lower.point(1.0)?,
            sheet.upper.point(1.0)?,
            sheet.upper.point(0.0)?,
        ];
        let mut ids = Vec::new();
        for point in corners {
            if point.iter().any(|v| !(*v as f32).is_finite()) {
                return Err("cap exceeds graph coordinate range".into());
            }
            if patch.nodes.iter().any(|other| {
                other.iter().zip(point).any(|(a, b)| (a - b).abs() >= 1e-9)
                    && other.iter().zip(point).all(|(a, b)| *a as f32 == b as f32)
            }) {
                return Err("cap face collapsed at graph precision".into());
            }
            let id = patch
                .nodes
                .iter()
                .position(|p| p.iter().zip(point).all(|(a, b)| (a - b).abs() < 1e-9))
                .unwrap_or_else(|| {
                    patch.nodes.push(point);
                    patch.nodes.len() - 1
                });
            if ids.last() != Some(&id) {
                ids.push(id);
            }
        }
        if ids.first() == ids.last() {
            ids.pop();
        }
        if ids.len() < 3 {
            return Err("cap face collapsed at graph precision".into());
        }
        let mut boundary = Vec::new();
        for i in 0..ids.len() {
            let start = ids[i];
            let end = ids[(i + 1) % ids.len()];
            let center = if i == 0 {
                match sheet.lower {
                    Section::Arc { center, .. } => Some([center[0], center[2]]),
                    _ => None,
                }
            } else {
                None
            };
            if let Some((index, edge)) = patch.edges.iter().enumerate().find(|(_, e)| {
                e.center == center
                    && ((e.start == start && e.end == end) || (e.start == end && e.end == start))
            }) {
                boundary.push((index, edge.start != start));
            } else {
                boundary.push((patch.edges.len(), false));
                patch.edges.push(CapEdge { start, end, center });
            }
        }
        patch.faces.push(CapFace {
            boundary,
            profile: sheet.profile,
        });
    }
    Ok(patch)
}
