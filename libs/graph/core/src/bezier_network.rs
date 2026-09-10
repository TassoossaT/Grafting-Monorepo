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
