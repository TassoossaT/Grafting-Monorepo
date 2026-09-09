//! Planar boolean queries, with vendor types confined to this module.
use i_overlay::{
    core::{fill_rule::FillRule, overlay_rule::OverlayRule},
    float::single::SingleFloatOverlay,
};
/// One outer ring followed by its holes, without repeated closing points.
pub type PlanarShape = Vec<Vec<[f32; 2]>>;
/// Operation on closed planar shapes.
#[derive(Clone, Copy, Debug)]
pub enum PlanarBoolean {
    /// Preserve either operand.
    Union,
    /// Remove the clip operand from the subject.
    Difference,
    /// Keep subject faces and add only uncovered clip area, retaining structural seams.
    Extend,
}
/// Returns disconnected components separately; each component retains its holes.
/// Rejects malformed/nonfinite contours before invoking the geometry backend.
pub fn planar_boolean(
    subject: &[PlanarShape],
    clip: &[PlanarShape],
    operation: PlanarBoolean,
) -> Result<Vec<PlanarShape>, String> {
    for shape in subject.iter().chain(clip) {
        if shape.is_empty()
            || shape
                .iter()
                .any(|ring| ring.len() < 3 || ring.iter().flatten().any(|v| !v.is_finite()))
        {
            return Err("a planar contour needs at least three finite points".into());
        }
    }
    let subject = subject.to_vec();
    let clip = clip.to_vec();
    let mut output = match operation {
        PlanarBoolean::Union => subject.overlay(&clip, OverlayRule::Union, FillRule::NonZero),
        PlanarBoolean::Difference => subject
            .iter()
            .flat_map(|shape| shape.overlay(&clip, OverlayRule::Difference, FillRule::NonZero))
            .collect(),
        PlanarBoolean::Extend => {
            let mut result = subject.clone();
            result.extend(clip.overlay(&subject, OverlayRule::Difference, FillRule::NonZero));
            result
        }
    };
    // Preserve structural corners and split seams at new intersections.
    let points: Vec<[f32; 2]> = subject
        .iter()
        .chain(&clip)
        .chain(output.iter())
        .flatten()
        .flatten()
        .copied()
        .collect();
    for ring in output.iter_mut().flatten() {
        let original = ring.clone();
        ring.clear();
        for i in 0..original.len() {
            let a = original[i];
            let b = original[(i + 1) % original.len()];
            ring.push(a);
            let d = [b[0] - a[0], b[1] - a[1]];
            let length_sq = d[0] * d[0] + d[1] * d[1];
            if length_sq == 0.0 {
                continue;
            }
            let mut splits: Vec<(f32, [f32; 2])> = points
                .iter()
                .filter_map(|p| {
                    let t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / length_sq;
                    let error = (p[0] - a[0] - t * d[0])
                        .abs()
                        .max((p[1] - a[1] - t * d[1]).abs());
                    (t > 1e-6 && t < 1.0 - 1e-6 && error < 1e-5).then_some((t, *p))
                })
                .collect();
            splits.sort_by(|a, b| a.0.total_cmp(&b.0));
            splits.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-6);
            ring.extend(splits.into_iter().map(|(_, p)| p));
        }
    }
    Ok(output)
}
