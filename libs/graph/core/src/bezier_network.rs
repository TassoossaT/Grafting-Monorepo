//! Curve-aware graph insertion. Topology remains in caller-owned graph primitives.
use crate::bezier::{CubicBezier, CurveHandles, CurvePoint};
use std::collections::{BTreeMap, BTreeSet};
/// One graph anchor.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CurveNode {
    /// Stable identity.
    pub id: String,
    /// XYZ anchor.
    pub position: CurvePoint,
}
/// One graph edge with independent incident controls.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "curve-serde", serde(rename_all = "camelCase"))]
pub struct CurveEdge {
    /// Stable identity.
    pub edge_id: String,
    /// Start anchor.
    pub start_node_id: String,
    /// End anchor.
    pub end_node_id: String,
    /// Explicit authored controls.
    pub curve: CurveHandles,
}
/// Generic insertion into an existing curve graph.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "curve-serde", serde(rename_all = "camelCase"))]
pub struct NetworkRequest {
    /// Existing anchors.
    pub nodes: Vec<CurveNode>,
    /// Existing authored edges.
    pub edges: Vec<CurveEdge>,
    /// Proposed anchors.
    pub added_nodes: Vec<CurveNode>,
    /// Proposed edges.
    pub added_edges: Vec<CurveEdge>,
    /// Prefix for deterministic new junction identities.
    pub node_prefix: String,
    /// Planar snap reach.
    pub snap_tolerance: f64,
    /// Maximum allowed height difference for connection.
    pub height_tolerance: f64,
    /// Curve approximation tolerance.
    pub tolerance: f64,
}
/// Atomic graph replacement; original state is not mutated.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "curve-serde", serde(rename_all = "camelCase"))]
pub struct NetworkPatch {
    /// Newly introduced or snapped anchors.
    pub nodes: Vec<CurveNode>,
    /// Superseded edge identities.
    pub removed_edge_ids: Vec<String>,
    /// New intervals with exact controls.
    pub edges: Vec<CurveEdge>,
}
fn near(a: CurvePoint, b: CurvePoint, xy: f64, height: f64) -> bool {
    (a[0] - b[0]).hypot(a[2] - b[2]) <= xy && (a[1] - b[1]).abs() <= height
}
fn crossing(a: CurvePoint, b: CurvePoint, c: CurvePoint, d: CurvePoint) -> Option<(f64, f64)> {
    let x = b[0] - a[0];
    let z = b[2] - a[2];
    let u = d[0] - c[0];
    let v = d[2] - c[2];
    let det = x * v - z * u;
    if det.abs() < 1e-14 {
        return None;
    }
    let t = ((c[0] - a[0]) * v - (c[2] - a[2]) * u) / det;
    let s = ((c[0] - a[0]) * z - (c[2] - a[2]) * x) / det;
    if (-1e-9..=1. + 1e-9).contains(&t) && (-1e-9..=1. + 1e-9).contains(&s) {
        Some((t.clamp(0., 1.), s.clamp(0., 1.)))
    } else {
        None
    }
}
/// Finds same-level intersections using adaptive candidates and Newton refinement.
/// Nearly tangent/coincident spans do not manufacture arbitrary crossings.
pub fn intersections(
    a: CubicBezier,
    b: CubicBezier,
    tolerance: f64,
    height: f64,
) -> Result<Vec<[f64; 2]>, String> {
    if !height.is_finite() || height < 0. {
        return Err("height tolerance must be finite and nonnegative".into());
    }
    let sa = a.sample(tolerance / 4.)?;
    let sb = b.sample(tolerance / 4.)?;
    let mut out: Vec<[f64; 2]> = Vec::new();
    if sa.len().saturating_mul(sb.len()) > 2_000_000 {
        return Err("intersection budget exceeded".into());
    }
    for aa in sa.windows(2) {
        for bb in sb.windows(2) {
            if a == b && aa[1].t >= bb[0].t {
                continue;
            }
            let Some((x, y)) = crossing(
                aa[0].position,
                aa[1].position,
                bb[0].position,
                bb[1].position,
            ) else {
                continue;
            };
            let mut t = aa[0].t + (aa[1].t - aa[0].t) * x;
            let mut u = bb[0].t + (bb[1].t - bb[0].t) * y;
            for _ in 0..12 {
                let p = a.evaluate(t)?;
                let q = b.evaluate(u)?;
                let da = a.derivative(t)?;
                let db = b.derivative(u)?;
                let det = da[2] * db[0] - da[0] * db[2];
                if det.abs() < 1e-14 {
                    break;
                }
                let dx = q[0] - p[0];
                let dz = q[2] - p[2];
                t = (t + (-db[2] * dx + db[0] * dz) / det).clamp(0., 1.);
                u = (u + (da[0] * dz - da[2] * dx) / det).clamp(0., 1.);
            }
            if a == b && (t - u).abs() < 1e-6 {
                continue;
            }
            if near(a.evaluate(t)?, b.evaluate(u)?, tolerance, height)
                && !out
                    .iter()
                    .any(|p| (p[0] - t).abs() < 1e-7 && (p[1] - u).abs() < 1e-7)
            {
                out.push([t, u]);
            }
        }
    }
    out.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    Ok(out)
}
/// Largest direction change, in degrees, a weld still reads as one road
/// carrying on rather than two meeting at a corner.
///
/// Above ninety on purpose. Drawing an L as one gesture already comes back
/// rounded, because the fit runs a single smooth spline through its anchors;
/// drawing the same L as two gestures has to land in the same place or the
/// tool is answering the same intent two different ways depending on whether
/// the hand paused. What is left above the threshold is the switchback --
/// a run doubling back on itself, where a corner is the only honest reading.
const MAX_SMOOTHED_WELD_DEGREES: f64 = 120.;

fn norm(v: CurvePoint) -> Option<CurvePoint> {
    let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    (length > 1e-12).then(|| std::array::from_fn(|i| v[i] / length))
}

fn length_of(v: CurvePoint) -> f64 {
    (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt()
}

/// Gives the two curves meeting at a freshly welded anchor a shared tangent.
///
/// **Why the tool needs this.** Snapping a new stroke onto a standing anchor
/// joins the two runs in position and stops there: each edge keeps whatever
/// controls its own fit produced, so the pair meets at whatever angle the
/// hand happened to leave and the road has a crease in it. The machinery to
/// avoid that already existed for dragging a handle by hand
/// ([`crate::bezier::constrain_handle`]) and was simply never reached at the
/// moment the weld is made.
///
/// Both sides give way, half each, so the join is symmetric: the standing run
/// bends as much toward the new one as the new one bends toward it. That does
/// alter a run already committed, which is the deliberate trade -- a weld the
/// user asked for is a change to both roads, and a join that only the newer
/// road respects still looks like a crease from the older one's side.
///
/// Only welds this call actually made are touched, and only where exactly two
/// curves meet. A junction of three or more has no continuation to be
/// continuous with, and an anchor whose curves were both already standing was
/// accepted in its current shape long ago.
///
/// Idempotent: a joint already sharing a tangent averages to the direction it
/// is already pointing, so regenerating a cloud over and over cannot make it
/// drift.
fn smooth_welds(
    output: &mut Vec<CurveEdge>,
    all_edges: &[CurveEdge],
    old_ids: &BTreeSet<String>,
) {
    let emitted: BTreeSet<String> = output.iter().map(|e| e.edge_id.clone()).collect();
    // The originals the patch would otherwise leave untouched, carried along
    // so a weld onto one can still be smoothed. Each is re-emitted only if
    // this pass actually changes it.
    let carried: Vec<CurveEdge> = all_edges
        .iter()
        .filter(|e| old_ids.contains(&e.edge_id) && !emitted.contains(&e.edge_id))
        .cloned()
        .collect();
    let emitted_count = output.len();
    let mut work: Vec<CurveEdge> = std::mem::take(output);
    work.extend(carried);

    let mut incident: BTreeMap<&str, Vec<(usize, bool)>> = BTreeMap::new();
    for (index, e) in work.iter().enumerate() {
        if e.start_node_id == e.end_node_id {
            continue; // a closed loop meets itself; there is no other curve to agree with.
        }
        incident
            .entry(e.start_node_id.as_str())
            .or_default()
            .push((index, true));
        incident
            .entry(e.end_node_id.as_str())
            .or_default()
            .push((index, false));
    }

    let limit = MAX_SMOOTHED_WELD_DEGREES.to_radians().cos();
    let mut touched = vec![false; work.len()];
    let mut alignments: Vec<(usize, bool, CurvePoint)> = Vec::new();
    for uses in incident.values() {
        let [(first, first_start), (second, second_start)] = uses[..] else {
            continue; // not a two-curve joint.
        };
        if first >= emitted_count && second >= emitted_count {
            continue; // nothing here was welded by this call.
        }
        let near = |index: usize, is_start: bool| {
            let handles = &work[index].curve;
            if is_start { handles.start } else { handles.end }
        };
        let (u, v) = (near(first, first_start), near(second, second_start));
        let (Some(u_hat), Some(v_hat)) = (norm(u), norm(v)) else {
            continue;
        };
        // The two near controls should sit on opposite sides of the anchor,
        // so `u` is compared against the reverse of `v`.
        let opposed: CurvePoint = std::array::from_fn(|i| -v_hat[i]);
        let deviation = u_hat[0] * opposed[0] + u_hat[1] * opposed[1] + u_hat[2] * opposed[2];
        if deviation < limit {
            continue; // a corner, not a continuation.
        }
        let Some(shared) = norm(std::array::from_fn(|i| u_hat[i] + opposed[i])) else {
            continue;
        };
        alignments.push((
            first,
            first_start,
            std::array::from_fn(|i| shared[i] * length_of(u)),
        ));
        alignments.push((
            second,
            second_start,
            std::array::from_fn(|i| -shared[i] * length_of(v)),
        ));
        touched[first] = true;
        touched[second] = true;
    }

    for (index, is_start, handle) in alignments {
        let handles = &mut work[index].curve;
        if is_start {
            handles.start = handle;
        } else {
            handles.end = handle;
        }
    }

    for (index, edge) in work.into_iter().enumerate() {
        if index < emitted_count || touched[index] {
            output.push(edge);
        }
    }
}

/// Inserts and splits curves transactionally, enforcing independent height tolerance.
pub fn plan(request: NetworkRequest) -> Result<NetworkPatch, String> {
    if !request.tolerance.is_finite() || request.tolerance <= 0. {
        return Err("network tolerance must be positive and finite".into());
    }
    let mut node_ids = BTreeSet::new();
    for n in request.nodes.iter().chain(&request.added_nodes) {
        if n.id.is_empty()
            || !node_ids.insert(&n.id)
            || n.position.iter().any(|v| !v.is_finite() || v.abs() > 1e12)
        {
            return Err("invalid or duplicate network anchor".into());
        }
    }
    let mut edge_ids = BTreeSet::new();
    for e in request.edges.iter().chain(&request.added_edges) {
        if e.edge_id.is_empty() || !edge_ids.insert(&e.edge_id) {
            return Err("invalid or duplicate curve identity".into());
        }
        e.curve.profile_at(0.)?;
    }
    if request
        .added_edges
        .len()
        .saturating_mul(request.edges.len() + request.added_edges.len())
        > 250_000
    {
        return Err("network candidate budget exceeded".into());
    }
    if request.node_prefix.is_empty()
        || !request.snap_tolerance.is_finite()
        || request.snap_tolerance < 0.
        || !request.height_tolerance.is_finite()
        || request.height_tolerance < 0.
    {
        return Err("invalid network tolerances or identity".into());
    }
    if request.edges.len() + request.added_edges.len() > 4096 {
        return Err("network edge budget exceeded".into());
    }
    let mut nodes: BTreeMap<String, CurvePoint> = request
        .nodes
        .iter()
        .map(|n| (n.id.clone(), n.position))
        .collect();
    let original_nodes: BTreeSet<_> = nodes.keys().cloned().collect();
    let mut changed = BTreeSet::new();
    let mut remap = BTreeMap::new();
    for n in request.added_nodes {
        let found = nodes
            .iter()
            .filter(|(id, p)| {
                near(
                    **p,
                    n.position,
                    if original_nodes.contains(*id) {
                        request.snap_tolerance
                    } else {
                        request.tolerance
                    },
                    request.height_tolerance,
                )
            })
            .min_by(|(ia, a), (ib, b)| {
                ((a[0] - n.position[0]).hypot(a[2] - n.position[2]))
                    .total_cmp(&((b[0] - n.position[0]).hypot(b[2] - n.position[2])))
                    .then(ia.cmp(ib))
            })
            .map(|(id, _)| id.clone());
        if let Some(id) = found {
            remap.insert(n.id, id);
        } else {
            changed.insert(n.id.clone());
            nodes.insert(n.id, n.position);
        }
    }
    let old_ids: BTreeSet<_> = request.edges.iter().map(|e| e.edge_id.clone()).collect();
    let mut edges = request.edges;
    for mut e in request.added_edges {
        if let Some(id) = remap.get(&e.start_node_id) {
            e.start_node_id = id.clone();
        }
        if let Some(id) = remap.get(&e.end_node_id) {
            e.end_node_id = id.clone();
        }
        if e.start_node_id == e.end_node_id {
            continue;
        }
        edges.push(e);
    }
    let mut curves = Vec::new();
    for e in &edges {
        let a = *nodes.get(&e.start_node_id).ok_or("missing curve start")?;
        let b = *nodes.get(&e.end_node_id).ok_or("missing curve end")?;
        let c = e.curve.resolve(a, b);
        c.validate()?;
        curves.push(c);
    }
    let mut cuts: Vec<Vec<(f64, String)>> = edges
        .iter()
        .map(|e| vec![(0., e.start_node_id.clone()), (1., e.end_node_id.clone())])
        .collect();
    let mut counter = 0;
    for (index, curve) in curves.iter().enumerate() {
        if old_ids.contains(&edges[index].edge_id) {
            continue;
        }
        for [t, u] in intersections(*curve, *curve, request.tolerance, request.height_tolerance)? {
            let id = loop {
                let id = format!("{}{}", request.node_prefix, counter);
                counter += 1;
                if !nodes.contains_key(&id) {
                    break id;
                }
            };
            nodes.insert(id.clone(), curve.evaluate(t)?);
            changed.insert(id.clone());
            cuts[index].push((t, id.clone()));
            cuts[index].push((u, id));
        }
    }
    for i in 0..edges.len() {
        for j in i + 1..edges.len() {
            if old_ids.contains(&edges[i].edge_id) && old_ids.contains(&edges[j].edge_id) {
                continue;
            }
            let mut hits = intersections(
                curves[i],
                curves[j],
                request.tolerance,
                request.height_tolerance,
            )?;
            // Endpoint-on-curve snapping also covers T junctions where there is no proper crossing.
            for (a, b, reverse) in [(i, j, false), (j, i, true)] {
                for t in [0., 1.] {
                    let p = curves[a].evaluate(t)?;
                    let u = curves[b].nearest(p, request.tolerance)?;
                    if near(
                        p,
                        curves[b].evaluate(u)?,
                        request.snap_tolerance,
                        request.height_tolerance,
                    ) {
                        hits.push(if reverse { [u, t] } else { [t, u] });
                    }
                }
            }
            for [t, u] in hits {
                if !(1e-7..=1. - 1e-7).contains(&t) && !(1e-7..=1. - 1e-7).contains(&u) {
                    let ai = if t < 0.5 {
                        &edges[i].start_node_id
                    } else {
                        &edges[i].end_node_id
                    };
                    let bi = if u < 0.5 {
                        &edges[j].start_node_id
                    } else {
                        &edges[j].end_node_id
                    };
                    if ai == bi {
                        continue;
                    }
                }
                let p = curves[i].evaluate(t)?;
                let q = curves[j].evaluate(u)?;
                let position = if old_ids.contains(&edges[i].edge_id) {
                    p
                } else {
                    q
                };
                let existing = nodes
                    .iter()
                    .find(|(_, x)| near(**x, position, request.tolerance, request.height_tolerance))
                    .map(|(id, _)| id.clone());
                let id = if let Some(id) = existing {
                    id
                } else {
                    let id = loop {
                        let id = format!("{}{}", request.node_prefix, counter);
                        counter += 1;
                        if !nodes.contains_key(&id) {
                            break id;
                        }
                    };
                    nodes.insert(id.clone(), position);
                    changed.insert(id.clone());
                    id
                };
                for (index, v) in [(i, t), (j, u)] {
                    if let Some(c) = cuts[index].iter_mut().find(|c| (c.0 - v).abs() < 1e-7) {
                        c.1 = id.clone();
                    } else {
                        cuts[index].push((v, id.clone()));
                    }
                }
            }
        }
    }
    let mut output = Vec::new();
    let mut removed = Vec::new();
    for (index, e) in edges.iter().enumerate() {
        let cut = &mut cuts[index];
        cut.sort_by(|a, b| a.0.total_cmp(&b.0));
        cut.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-7);
        let loop_intervals: Vec<_> = cut
            .windows(2)
            .filter(|w| w[0].1 == w[1].1 && w[1].0 - w[0].0 > 1e-8)
            .map(|w| (w[0].0 + w[1].0) / 2.)
            .collect();
        for t in loop_intervals {
            let id = loop {
                let id = format!("{}{}", request.node_prefix, counter);
                counter += 1;
                if !nodes.contains_key(&id) {
                    break id;
                }
            };
            nodes.insert(id.clone(), curves[index].evaluate(t)?);
            changed.insert(id.clone());
            cut.push((t, id));
        }
        cut.sort_by(|a, b| a.0.total_cmp(&b.0));
        if old_ids.contains(&e.edge_id)
            && cut.len() == 2
            && cut[0].1 == e.start_node_id
            && cut[1].1 == e.end_node_id
        {
            continue;
        }
        if old_ids.contains(&e.edge_id) {
            removed.push(e.edge_id.clone());
        }
        for (part, w) in cut.windows(2).enumerate() {
            if w[0].1 == w[1].1 {
                continue;
            }
            let left = curves[index].split(w[1].0)?[0];
            let curve = if w[0].0 == 0. {
                left
            } else {
                left.split(w[0].0 / w[1].0)?[1]
            };
            let mut handles =
                CurveHandles::from_curve(curve, e.curve.mode, e.curve.profile_at(w[0].0)?);
            let end_profile = e.curve.profile_at(w[1].0)?;
            if end_profile != handles.band_offsets {
                handles.end_band_offsets = end_profile;
            }
            // Shared junction positions can differ by tolerance; keep absolute controls.
            let start = nodes[&w[0].1];
            let end = nodes[&w[1].1];
            handles.start = std::array::from_fn(|k| curve.points[1][k] - start[k]);
            handles.end = std::array::from_fn(|k| curve.points[2][k] - end[k]);
            output.push(CurveEdge {
                edge_id: if part == 0 {
                    e.edge_id.clone()
                } else {
                    format!("{}:split:{}:{}", e.edge_id, request.node_prefix, part)
                },
                start_node_id: w[0].1.clone(),
                end_node_id: w[1].1.clone(),
                curve: handles,
            });
            changed.insert(w[0].1.clone());
            changed.insert(w[1].1.clone());
        }
    }
    smooth_welds(&mut output, &edges, &old_ids);
    Ok(NetworkPatch {
        nodes: changed
            .into_iter()
            .map(|id| CurveNode {
                position: nodes[&id],
                id,
            })
            .collect(),
        removed_edge_ids: removed,
        edges: output,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn line(a: CurvePoint, b: CurvePoint) -> CubicBezier {
        crate::bezier::automatic_path(&[a, b]).unwrap()[0]
    }
    fn node(id: &str, position: CurvePoint) -> CurveNode {
        CurveNode { id: id.into(), position }
    }

    fn edge(id: &str, from: &str, to: &str, a: CurvePoint, b: CurvePoint) -> CurveEdge {
        CurveEdge {
            edge_id: id.into(),
            start_node_id: from.into(),
            end_node_id: to.into(),
            curve: CurveHandles::from_curve(line(a, b), crate::bezier::HandleMode::Aligned, vec![-2., 2.]),
        }
    }

    fn request(added_nodes: Vec<CurveNode>, added_edges: Vec<CurveEdge>) -> NetworkRequest {
        NetworkRequest {
            nodes: vec![node("a", [0., 0., 0.]), node("b", [10., 0., 0.])],
            edges: vec![edge("first", "a", "b", [0., 0., 0.], [10., 0., 0.])],
            added_nodes,
            added_edges,
            node_prefix: "j:".into(),
            snap_tolerance: 1.,
            height_tolerance: 0.5,
            tolerance: 0.01,
        }
    }

    /// The near control of `edge` at the anchor it shares, as a unit vector.
    fn near_direction(patch: &NetworkPatch, edge_id: &str, at_start: bool) -> CurvePoint {
        let e = patch.edges.iter().find(|e| e.edge_id == edge_id).expect("edge in patch");
        let v = if at_start { e.curve.start } else { e.curve.end };
        norm(v).expect("a handle with length")
    }

    #[test]
    fn an_l_drawn_as_two_strokes_welds_into_one_shared_tangent() {
        // The standing run travels +x and stops at `b`; the new stroke leaves
        // `b` travelling +z. Drawn as one gesture this corner comes back
        // rounded, and drawing it as two must not answer differently.
        let patch = plan(request(
            vec![node("c", [10., 0., 0.]), node("d", [10., 0., 10.])],
            vec![edge("second", "c", "d", [10., 0., 0.], [10., 0., 10.])],
        ))
        .expect("the weld plans");

        let standing = near_direction(&patch, "first", false);
        let fresh = near_direction(&patch, "second", true);
        // Opposite sides of the shared anchor is what makes the join smooth.
        let dot = standing[0] * fresh[0] + standing[1] * fresh[1] + standing[2] * fresh[2];
        assert!(dot < -0.999, "controls are not collinear through the anchor: {dot}");
        // Half each: the standing run gave way as much as the new one did, so
        // the shared tangent bisects the corner rather than adopting a side.
        assert!((fresh[0] - fresh[2]).abs() < 1e-6, "the tangent did not bisect: {fresh:?}");
    }

    #[test]
    fn a_switchback_keeps_its_corner() {
        // The new stroke leaves almost back the way the standing run came.
        // There is no continuation to be continuous with here, and forcing one
        // would swing the road through a curve nobody drew.
        let patch = plan(request(
            vec![node("c", [10., 0., 0.]), node("d", [1., 0., 2.])],
            vec![edge("second", "c", "d", [10., 0., 0.], [1., 0., 2.])],
        ))
        .expect("the weld plans");
        let fresh = near_direction(&patch, "second", true);
        assert!(fresh[0] < -0.9, "the stroke was bent away from where it was drawn: {fresh:?}");
    }

    #[test]
    fn a_straight_continuation_is_left_exactly_where_it_was() {
        // Already collinear, so the average is the direction it already had.
        // Regenerating a cloud repeatedly must not creep.
        let patch = plan(request(
            vec![node("c", [10., 0., 0.]), node("d", [20., 0., 0.])],
            vec![edge("second", "c", "d", [10., 0., 0.], [20., 0., 0.])],
        ))
        .expect("the weld plans");
        let fresh = near_direction(&patch, "second", true);
        assert!((fresh[0] - 1.).abs() < 1e-6, "a straight run was bent: {fresh:?}");
    }

    #[test]
    fn self_crossing_has_two_distinct_parameters() {
        let c = CubicBezier {
            points: [[-1., 0., 0.], [2., 0., 3.], [-2., 0., 3.], [1., 0., 0.]],
        };
        let hits = intersections(c, c, 0.001, 0.01).unwrap();
        assert_eq!(hits.len(), 1);
        assert!((hits[0][0] - hits[0][1]).abs() > 0.1);
    }
    #[test]
    fn bridge_does_not_connect() {
        let a = line([-5., 0., 0.], [5., 0., 0.]);
        let b = line([0., 3., -5.], [0., 3., 5.]);
        assert!(intersections(a, b, 0.001, 0.15).unwrap().is_empty());
        assert_eq!(
            intersections(a, line([0., 0., -5.], [0., 0., 5.]), 0.001, 0.15)
                .unwrap()
                .len(),
            1
        );
    }
}
