//! Laying a patch of ground again on its own surface, its shape unchanged:
//! the repair round a structure, wherever the ground is -- a hillside, the
//! floor of a cave, the deck of an earth bridge.
//!
//! ```text
//! faces to lay again (a disk, holes allowed)
//!   -> holes capped                  (a membrane over each, its rim fixed)
//!   -> a chart of the surface        (projection where it is one-to-one,
//!                                     else a mean-value embedding)
//!   -> the structures' rings, charted (closest point on the surface)
//!   -> the irregular grid in the chart (the constrained generator, as in the plane)
//!   -> lifted back onto the surface  (through the chart's own triangles)
//! ```
//!
//! The cells are relaxed once, in the chart, by the generator itself. A second
//! relaxation over the surface was measured to leave them no squarer and to
//! fold a cell at a structure's corner, so there is none.
//!
//! The ring round the patch comes back as the very same vertices. A corner
//! the generator puts on a ring or a structure's side is reported with the
//! two corners of the side it landed on, so whoever owns that side can split
//! it there.

use std::collections::{HashMap, HashSet};

use grafting_procgen_irregular_grid::constrained::ConstraintPoint;
use grafting_procgen_irregular_grid::ground::{GroundRefinement, ground_grid};
use grafting_procgen_irregular_grid::{RelaxOptions, Vec2};
use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::single::SingleFloatOverlay;

use crate::edit::Faces;
use crate::mesh_distance::MeshDistance;
use crate::trimesh::border_loops;
use crate::vector::Vec3;

/// A point of a structure's ring the new ground goes round, with the caller's
/// own name for it.
#[derive(Debug, Clone, Copy)]
pub struct GivenPoint {
    pub position: Vec3,
    pub id: usize,
}

/// One repair: the rings to go round and the cells to lay.
#[derive(Debug, Clone)]
pub struct Regeneration {
    /// Closed rings where structures rest on the ground: no ground inside.
    pub holes: Vec<Vec<GivenPoint>>,
    /// How wide one finished face should be, measured on the surface.
    pub face_side: f64,
    pub seed: u32,
    /// The relaxation's strength in the chart, as the plane's generator takes it.
    pub relax_strength: f64,
}

/// What a corner of the result already is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Origin {
    /// A vertex of the patch handed in -- a corner of its ring.
    Patch(usize),
    /// A point of one of [`Regeneration::holes`], by its id.
    Given(usize),
}

/// A new corner lying on a side somebody already holds, between `from` and `to`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Landing {
    pub vertex: usize,
    pub from: Origin,
    pub to: Origin,
}

/// The faces laid in place of the patch.
#[derive(Debug, Clone)]
pub struct RegeneratedSurface {
    pub vertices: Vec<Vec3>,
    /// In the winding the patch's faces had.
    pub faces: Vec<Vec<usize>>,
    /// Index-aligned with `vertices`.
    pub origin: Vec<Option<Origin>>,
    pub landed: Vec<Landing>,
    /// `false` where the generator stopped at its vertex budget.
    pub refinement_complete: bool,
}

/// How much of the surface may turn over in its projection, as a share of
/// its area, for the projection still to be its chart.
const TURNED_SHARE_TOLERATED: f64 = 0.01;
/// How far off a side, as a share of a face, a corner the generator put on
/// it in the chart may lie on the surface and still be on that side.
const LANDING_REACH: f64 = 0.25;
/// Rounds of the membrane laid over a hole before the chart is made.
const MEMBRANE_ROUNDS: usize = 400;
/// Sweeps the mean-value embedding may take to settle, at most.
const EMBEDDING_SWEEPS: usize = 200_000;
/// Relaxation of the embedding's sweeps: plain Gauss-Seidel. Mean-value
/// weights are not symmetric, and over-relaxed sweeps of them were seen to
/// settle nowhere -- a chart turned inside out.
const EMBEDDING_OVERRELAX: f64 = 1.0;

/// Every face cut into triangles by ear clipping across the patch's own
/// normal -- the plane the chart projects onto, so a triangle is turned there
/// only where its face is: a cell the generator joined along a contour is a
/// concave polygon, and fanned from its first corner it gives triangles
/// turned over though the face is not. A face that does not lie simply on
/// that plane is clipped in its own.
pub(crate) fn triangles_of(vertices: &[Vec3], faces: &[Vec<usize>]) -> Vec<[usize; 3]> {
    let mut normal = Vec3::default();
    for face in faces {
        normal = normal + polygon_normal(vertices, face);
    }
    let triangles = faces
        .iter()
        .filter(|face| face.len() >= 3)
        .flat_map(|face| ears(vertices, face, normal).unwrap_or_else(|| ears(vertices, face, polygon_normal(vertices, face)).unwrap_or_else(|| fan(face))))
        .filter(|t| t[0] != t[1] && t[1] != t[2] && t[0] != t[2])
        .collect::<Vec<_>>();
    without_cancelling(triangles)
}

/// `triangles` without any laid both ways round: two faces sharing two sides
/// in a row, a corner between them only they hold, each clip the ear at that
/// corner -- one triangle twice, facing apart, which counts as no surface and
/// leaves the patch no disk.
fn without_cancelling(triangles: Vec<[usize; 3]>) -> Vec<[usize; 3]> {
    let key = |[a, b, c]: [usize; 3]| if a < b && a < c { [a, b, c] } else if b < c { [b, c, a] } else { [c, a, b] };
    let laid: HashSet<[usize; 3]> = triangles.iter().map(|&t| key(t)).collect();
    triangles.into_iter().filter(|&[a, b, c]| !laid.contains(&key([a, c, b]))).collect()
}

fn fan(face: &[usize]) -> Vec<[usize; 3]> {
    (1..face.len() - 1).map(|k| [face[0], face[k], face[k + 1]]).collect()
}

/// Newell's normal of a polygon, in its winding.
fn polygon_normal(vertices: &[Vec3], face: &[usize]) -> Vec3 {
    let mut normal = Vec3::default();
    for i in 0..face.len() {
        let (a, b) = (vertices[face[i]], vertices[face[(i + 1) % face.len()]]);
        normal = normal + Vec3::new((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y));
    }
    normal
}

/// `face` cut into triangles by ear clipping on the plane across `normal`,
/// wound as it is; `None` where the face does not wind round that normal simply.
fn ears(vertices: &[Vec3], face: &[usize], normal: Vec3) -> Option<Vec<[usize; 3]>> {
    if normal.length() < 1e-12 {
        return None;
    }
    let (u, v) = frame(normal.normalized());
    let flat = |i: usize| Vec2::new(vertices[i].dot(u), vertices[i].dot(v));
    let points: Vec<Vec2> = face.iter().map(|&i| flat(i)).collect();
    let winding: f64 = (0..points.len()).map(|i| { let (p, q) = (points[i], points[(i + 1) % points.len()]); p.x * q.y - q.x * p.y }).sum();
    if winding <= 0.0 || !simple(&points) {
        return None;
    }
    if face.len() == 3 {
        return Some(vec![[face[0], face[1], face[2]]]);
    }
    let mut left: Vec<usize> = face.to_vec();
    let mut out = Vec::with_capacity(face.len() - 2);
    while left.len() > 3 {
        let n = left.len();
        let ear = (0..n).find(|&k| {
            let (a, b, c) = (left[(k + n - 1) % n], left[k], left[(k + 1) % n]);
            let (pa, pb, pc) = (flat(a), flat(b), flat(c));
            signed_area_2d(pa, pb, pc) > 1e-12
                && left.iter().all(|&q| {
                    if q == a || q == b || q == c {
                        return true;
                    }
                    let pq = flat(q);
                    !(signed_area_2d(pa, pb, pq) >= 0.0 && signed_area_2d(pb, pc, pq) >= 0.0 && signed_area_2d(pc, pa, pq) >= 0.0)
                })
        })?;
        out.push([left[(ear + n - 1) % n], left[ear], left[(ear + 1) % n]]);
        left.remove(ear);
    }
    out.push([left[0], left[1], left[2]]);
    Some(out)
}

fn perimeter(ring: &[usize], vertices: &[Vec3]) -> f64 {
    (0..ring.len()).map(|i| vertices[ring[i]].distance(vertices[ring[(i + 1) % ring.len()]])).sum()
}

fn area_normal(vertices: &[Vec3], [a, b, c]: [usize; 3]) -> Vec3 {
    (vertices[b] - vertices[a]).cross(vertices[c] - vertices[a])
}

/// Two axes across `normal`, `u x v = normal`.
fn frame(normal: Vec3) -> (Vec3, Vec3) {
    let helper = if normal.y.abs() < 0.9 { Vec3::new(0.0, 1.0, 0.0) } else { Vec3::new(1.0, 0.0, 0.0) };
    let u = helper.cross(normal).normalized();
    (u, normal.cross(u))
}

fn signed_area_2d(a: Vec2, b: Vec2, c: Vec2) -> f64 {
    ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5
}

/// Caps the hole `ring` walks (the way the patch's faces walk it) across
/// `normal` -- the patch's own -- by clipping ears off the rim itself: every
/// side of the rim kept, every triangle turned the patch's way on the plane
/// the chart projects onto, so the cap never folds where the patch does not.
/// Where the rim does not lie simply on that plane, the rings stepping in
/// from the rim ([`cap_by_rings`]) cap it instead.
fn cap(ring: &[usize], vertices: &mut Vec<Vec3>, triangles: &mut Vec<[usize; 3]>, face_side: f64, normal: Vec3) -> Result<(), String> {
    // The patch walks a hole's rim against its own winding; the cap walks it back.
    let reversed: Vec<usize> = ring.iter().rev().copied().collect();
    match ears(vertices, &reversed, normal) {
        Some(cut) => {
            triangles.extend(cut);
            Ok(())
        }
        None => {
            cap_by_rings(ring, vertices, triangles, face_side)
        }
    }
}

/// Whether the closed polygon `points` crosses itself nowhere.
fn simple(points: &[Vec2]) -> bool {
    let n = points.len();
    let cross = |a: Vec2, b: Vec2, c: Vec2| (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for i in 0..n {
        let (a, b) = (points[i], points[(i + 1) % n]);
        for j in i + 1..n {
            if j == i || (j + 1) % n == i || (i + 1) % n == j {
                continue;
            }
            let (c, d) = (points[j], points[(j + 1) % n]);
            let (d1, d2, d3, d4) = (cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b));
            if (d1 > 0.0) != (d2 > 0.0) && (d3 > 0.0) != (d4 > 0.0) && d1 != 0.0 && d2 != 0.0 && d3 != 0.0 && d4 != 0.0 {
                return false;
            }
        }
    }
    true
}

/// Caps the hole `ring` walks (the way the patch's faces walk it) with a
/// membrane: rings of corners stepping in from the rim to a centre, wound
/// like the patch, the inner corners settled to the mean of their neighbours
/// with the rim held. Never projected, so a rim winding through three
/// dimensions -- round a floor half sunk in a hill -- caps as well as a flat one.
fn cap_by_rings(ring: &[usize], vertices: &mut Vec<Vec3>, triangles: &mut Vec<[usize; 3]>, face_side: f64) -> Result<(), String> {
    let count = ring.len();
    if count < 3 {
        return Err("a hole in the ground has too few corners to cap".to_string());
    }
    let points: Vec<Vec3> = ring.iter().map(|&v| vertices[v]).collect();
    let centre = points.iter().fold(Vec3::default(), |s, &p| s + p) * (1.0 / count as f64);
    let reach = points.iter().map(|&p| p.distance(centre)).fold(0.0, f64::max);
    let levels = ((reach / face_side).ceil() as usize).clamp(1, 64);
    let first_new = vertices.len();
    let first_triangle = triangles.len();
    // `rings[0]` is the rim itself; each next one a step nearer the centre.
    let mut rings: Vec<Vec<usize>> = vec![ring.to_vec()];
    for level in 1..levels {
        let t = level as f64 / levels as f64;
        rings.push(
            points
                .iter()
                .map(|&p| {
                    vertices.push(p.lerp(centre, t));
                    vertices.len() - 1
                })
                .collect(),
        );
    }
    vertices.push(centre);
    let middle = vertices.len() - 1;
    // The patch walks the rim a -> b; the cap walks it b -> a.
    for pair in rings.windows(2) {
        let (outer, inner) = (&pair[0], &pair[1]);
        for k in 0..count {
            let (a, b) = (outer[k], outer[(k + 1) % count]);
            let (c, d) = (inner[k], inner[(k + 1) % count]);
            triangles.push([b, a, c]);
            triangles.push([b, c, d]);
        }
    }
    let last = rings.last().expect("the rim is a ring");
    for k in 0..count {
        triangles.push([last[(k + 1) % count], last[k], middle]);
    }
    // The membrane: every inner corner the mean of its neighbours.
    let mut neighbours: HashMap<usize, Vec<usize>> = HashMap::new();
    for &[a, b, c] in &triangles[first_triangle..] {
        for (p, q) in [(a, b), (b, c), (c, a), (b, a), (c, b), (a, c)] {
            if p >= first_new {
                let list = neighbours.entry(p).or_default();
                if !list.contains(&q) {
                    list.push(q);
                }
            }
        }
    }
    let mut inner: Vec<usize> = neighbours.keys().copied().collect();
    inner.sort_unstable();
    for _ in 0..MEMBRANE_ROUNDS {
        for &p in &inner {
            let around = &neighbours[&p];
            vertices[p] = around.iter().fold(Vec3::default(), |s, &q| s + vertices[q]) * (1.0 / around.len() as f64);
        }
    }
    Ok(())
}

/// The chart: every vertex of `triangles` on the plane, one to one.
fn chart(vertices: &[Vec3], triangles: &[[usize; 3]], outer: &[usize]) -> Vec<Vec2> {
    let normal = triangles.iter().fold(Vec3::default(), |s, &t| s + area_normal(vertices, t)).normalized();
    let (u, v) = frame(normal);
    let projected: Vec<Vec2> = vertices.iter().map(|&p| Vec2::new(p.dot(u), p.dot(v))).collect();
    // Projection is the chart wherever it keeps every triangle the right way round.
    // Projection is the chart wherever its rim stays a simple polygon and no
    // more than a sliver of the surface turns over in it -- a face left
    // nearly flat on edge by an earlier edit. Only lifting near that sliver
    // reads it, and the triangle under a point is the one it lies most inside.
    let surface: f64 = triangles.iter().map(|&t| area_normal(vertices, t).length()).sum();
    let turned: f64 = triangles
        .iter()
        .filter(|&&[a, b, c]| signed_area_2d(projected[a], projected[b], projected[c]) <= 1e-9 * area_normal(vertices, [a, b, c]).length().max(1e-12))
        .map(|&t| area_normal(vertices, t).length())
        .sum();
    let rim: Vec<Vec2> = outer.iter().map(|&v| projected[v]).collect();
    let rim_winding: f64 = (0..rim.len()).map(|i| rim[i].x * rim[(i + 1) % rim.len()].y - rim[(i + 1) % rim.len()].x * rim[i].y).sum();
    let one_to_one = turned <= surface * TURNED_SHARE_TOLERATED && rim_winding > 0.0 && simple(&rim);
    if one_to_one {
        return projected;
    }
    if rim_winding > 0.0
        && let Some(mended) = mended_projection(vertices, triangles, outer, &projected)
    {
        return mended;
    }
    embedding(vertices, triangles, outer, &rim)
}

/// Rounds the rim's crossings are smoothed out in, and the interior's folds.
const MENDING_ROUNDS: usize = 60;
/// Sweeps the corners round a fold are settled in, each round.
const MENDING_SWEEPS: usize = 200;
/// How much of the projection's extent a mended chart keeps, at least.
const MENDED_EXTENT_KEPT: f64 = 0.5;
/// The most a chart is scaled to match the surface it maps.
const CHART_SCALE_MOST: f64 = 20.0;

/// The projection with its folds mended where they are, and nowhere else:
/// a rim corner crossing its own rim drawn to the middle of its neighbours
/// on it, then every corner near a face turned over settled where its
/// mean-value weights put it, the rest left where the projection put them --
/// ring after ring outward until no more is turned than the projection
/// itself may leave ([`TURNED_SHARE_TOLERATED`]). The ground round a
/// road on a hillside is a projection but for the step at the road's edge,
/// which folds over in plan; the whole patch laid again on an embedding for
/// that one step comes back with faces metres long. `None` where it cannot
/// be mended.
fn mended_projection(vertices: &[Vec3], triangles: &[[usize; 3]], outer: &[usize], projected: &[Vec2]) -> Option<Vec<Vec2>> {
    let mut chart = projected.to_vec();
    let n = outer.len();
    let crossing = |chart: &[Vec2]| -> Vec<usize> {
        let mut found = Vec::new();
        for i in 0..n {
            let (a, b) = (chart[outer[i]], chart[outer[(i + 1) % n]]);
            for j in i + 2..n {
                if (j + 1) % n == i {
                    continue;
                }
                let (c, d) = (chart[outer[j]], chart[outer[(j + 1) % n]]);
                let (d1, d2, d3, d4) = (signed_area_2d(a, b, c), signed_area_2d(a, b, d), signed_area_2d(c, d, a), signed_area_2d(c, d, b));
                if (d1 > 0.0) != (d2 > 0.0) && (d3 > 0.0) != (d4 > 0.0) {
                    found.extend([i, (i + 1) % n, j, (j + 1) % n]);
                }
            }
        }
        found
    };
    let mut rounds = 0;
    loop {
        let found = crossing(&chart);
        if found.is_empty() {
            break;
        }
        rounds += 1;
        if rounds > MENDING_ROUNDS {
            return None;
        }
        for k in found {
            let (before, after) = (chart[outer[(k + n - 1) % n]], chart[outer[(k + 1) % n]]);
            chart[outer[k]] = Vec2::new((before.x + after.x) * 0.5, (before.y + after.y) * 0.5);
        }
    }
    // Mean-value weights, as the embedding takes them.
    let mut weights: HashMap<(usize, usize), f64> = HashMap::new();
    for &[a, b, c] in triangles {
        for (i, j, k) in [(a, b, c), (b, c, a), (c, a, b)] {
            let (to_j, to_k) = (vertices[j] - vertices[i], vertices[k] - vertices[i]);
            let angle = to_j.normalized().dot(to_k.normalized()).clamp(-1.0, 1.0).acos();
            let half = (angle * 0.5).tan();
            *weights.entry((i, j)).or_default() += half / to_j.length().max(1e-12);
            *weights.entry((i, k)).or_default() += half / to_k.length().max(1e-12);
        }
    }
    let mut around: Vec<Vec<(usize, f64)>> = vec![Vec::new(); vertices.len()];
    let mut keys: Vec<(usize, usize)> = weights.keys().copied().collect();
    keys.sort_unstable();
    for (i, j) in keys {
        around[i].push((j, weights[&(i, j)]));
    }
    let on_rim: HashSet<usize> = outer.iter().copied().collect();
    let rim_index: HashMap<usize, usize> = outer.iter().enumerate().map(|(k, &v)| (v, k)).collect();
    let turned = |chart: &[Vec2]| -> Vec<usize> {
        (0..triangles.len()).filter(|&t| { let [a, b, c] = triangles[t]; signed_area_2d(chart[a], chart[b], chart[c]) <= 0.0 }).collect()
    };
    // As the projection itself is taken: a sliver of the surface may stay
    // turned over -- a face standing on edge at a step -- and only lifting
    // near it reads it.
    let surface: f64 = triangles.iter().map(|&t| area_normal(vertices, t).length()).sum();
    // Mended, the chart keeps the patch's extent: drawn together into a
    // sliver, it would be scaled up past any grid's reach.
    let extent = |chart: &[Vec2]| triangles.iter().map(|&[a, b, c]| signed_area_2d(chart[a], chart[b], chart[c])).sum::<f64>();
    let projected_extent = extent(projected).max(1e-12);
    let settled = |folds: &[usize]| folds.iter().map(|&t| area_normal(vertices, triangles[t]).length()).sum::<f64>() <= surface * TURNED_SHARE_TOLERATED;
    // The corners free to move: round what is turned, a ring wider each round.
    let mut free: HashSet<usize> = HashSet::new();
    for round in 0..MENDING_ROUNDS {
        let folds = turned(&chart);
        if folds.is_empty() || (round > 0 && settled(&folds)) {
            return (extent(&chart) >= projected_extent * MENDED_EXTENT_KEPT).then_some(chart);
        }
        // A turned face the rim holds is the rim folded there: its corners on
        // the rim drawn along it, to the middle of their neighbours -- so long
        // as that leaves the rim crossing itself nowhere.
        for &t in &folds {
            for v in triangles[t] {
                if let Some(&k) = rim_index.get(&v) {
                    let (before, after) = (chart[outer[(k + n - 1) % n]], chart[outer[(k + 1) % n]]);
                    let was = chart[v];
                    chart[v] = Vec2::new((before.x + after.x) * 0.5, (before.y + after.y) * 0.5);
                    if !crossing(&chart).is_empty() {
                        chart[v] = was;
                    }
                }
            }
        }
        // Each ring outward once: a corner reached twice is one corner.
        let mut grown: HashSet<usize> = folds.iter().flat_map(|&t| triangles[t]).filter(|v| !on_rim.contains(v)).collect();
        let mut front: Vec<usize> = grown.iter().copied().collect();
        for _ in 0..=round.min(8) {
            let next: Vec<usize> = front.iter().flat_map(|&v| around[v].iter().map(|&(j, _)| j)).filter(|v| !on_rim.contains(v) && !grown.contains(v)).collect();
            front = next.into_iter().filter(|&v| grown.insert(v)).collect();
        }
        free.extend(grown);
        let mut order: Vec<usize> = free.iter().copied().collect();
        order.sort_unstable();
        for _ in 0..MENDING_SWEEPS {
            for &v in &order {
                let total: f64 = around[v].iter().map(|&(_, w)| w).sum();
                if total <= 0.0 {
                    continue;
                }
                let (x, y) = around[v].iter().fold((0.0, 0.0), |(x, y), &(j, w)| (x + chart[j].x * w, y + chart[j].y * w));
                chart[v] = Vec2::new(x / total, y / total);
            }
        }
    }
    None
}

/// How far apart two points of the plane are.
fn gap(a: Vec2, b: Vec2) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}

/// The convex hull of `points`, counter-clockwise.
fn convex_hull(points: &[Vec2]) -> Vec<Vec2> {
    let mut sorted: Vec<Vec2> = points.to_vec();
    sorted.sort_by(|a, b| a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y)));
    sorted.dedup_by(|a, b| (a.x - b.x).abs() < 1e-12 && (a.y - b.y).abs() < 1e-12);
    if sorted.len() < 3 {
        return sorted;
    }
    let mut hull: Vec<Vec2> = Vec::with_capacity(sorted.len() * 2);
    for pass in 0..2 {
        let start = hull.len();
        let walk: Box<dyn Iterator<Item = &Vec2>> = if pass == 0 { Box::new(sorted.iter()) } else { Box::new(sorted.iter().rev()) };
        for &p in walk {
            while hull.len() >= start + 2 && signed_area_2d(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0 {
                hull.pop();
            }
            hull.push(p);
        }
        hull.pop();
    }
    hull
}

/// Where the rim goes in an embedding: round the convex hull of its own
/// projection, each corner as far round it as it is round the rim. A circle
/// takes a patch's shape away -- the long strip a road is laid again in,
/// mapped onto one, comes back with faces ten metres long and turned over at
/// its ends -- and the hull keeps it, convex as Floater's embedding needs.
/// The circle only where the projection has no extent.
fn rim_on_hull(vertices: &[Vec3], outer: &[usize], rim: &[Vec2]) -> Option<Vec<Vec2>> {
    let hull = convex_hull(rim);
    if hull.len() < 3 {
        return None;
    }
    let hull_length: f64 = (0..hull.len()).map(|k| gap(hull[k], hull[(k + 1) % hull.len()])).sum();
    if hull_length <= 1e-9 {
        return None;
    }
    // The rim's corner nearest the hull's first corner starts both walks.
    let first = (0..rim.len()).min_by(|&a, &b| gap(rim[a], hull[0]).total_cmp(&gap(rim[b], hull[0])))?;
    let rim_length = perimeter(outer, vertices).max(1e-12);
    let at_share = |share: f64| -> Vec2 {
        let mut left = share * hull_length;
        for k in 0..hull.len() {
            let (p, q) = (hull[k], hull[(k + 1) % hull.len()]);
            let side = gap(p, q);
            if left <= side || k == hull.len() - 1 {
                let t = if side > 0.0 { (left / side).clamp(0.0, 1.0) } else { 0.0 };
                return Vec2::new(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
            }
            left -= side;
        }
        hull[0]
    };
    let mut placed = vec![Vec2::new(0.0, 0.0); outer.len()];
    let mut walked = 0.0;
    for step in 0..outer.len() {
        let k = (first + step) % outer.len();
        placed[k] = at_share(walked / rim_length);
        walked += vertices[outer[k]].distance(vertices[outer[(k + 1) % outer.len()]]);
    }
    Some(placed)
}

/// Floater's mean-value embedding: the ring round the hull of its own
/// projection by arc length ([`rim_on_hull`]) -- else a circle -- every
/// other vertex where its mean-value weights put it. One to one for any disk.
fn embedding(vertices: &[Vec3], triangles: &[[usize; 3]], outer: &[usize], rim: &[Vec2]) -> Vec<Vec2> {
    let length = perimeter(outer, vertices);
    let radius = length / std::f64::consts::TAU;
    let mut chart = vec![Vec2::new(0.0, 0.0); vertices.len()];
    let mut fixed = vec![false; vertices.len()];
    let on_hull = rim_on_hull(vertices, outer, rim);
    let mut walked = 0.0;
    for (i, &v) in outer.iter().enumerate() {
        let angle = std::f64::consts::TAU * walked / length;
        chart[v] = on_hull.as_ref().map_or(Vec2::new(radius * angle.cos(), radius * angle.sin()), |placed| placed[i]);
        fixed[v] = true;
        walked += vertices[v].distance(vertices[outer[(i + 1) % outer.len()]]);
    }
    // w_ij = (tan(a/2) + tan(b/2)) / |x_i - x_j|, the angles at i either side of edge ij.
    let mut weights: HashMap<(usize, usize), f64> = HashMap::new();
    for &[a, b, c] in triangles {
        for (i, j, k) in [(a, b, c), (b, c, a), (c, a, b)] {
            let (to_j, to_k) = (vertices[j] - vertices[i], vertices[k] - vertices[i]);
            let angle = to_j.normalized().dot(to_k.normalized()).clamp(-1.0, 1.0).acos();
            let half = (angle * 0.5).tan();
            *weights.entry((i, j)).or_default() += half / to_j.length().max(1e-12);
            *weights.entry((i, k)).or_default() += half / to_k.length().max(1e-12);
        }
    }
    let mut around: Vec<Vec<(usize, f64)>> = vec![Vec::new(); vertices.len()];
    let mut keys: Vec<(usize, usize)> = weights.keys().copied().collect();
    keys.sort_unstable();
    for (i, j) in keys {
        around[i].push((j, weights[&(i, j)]));
    }
    let free: Vec<usize> = (0..vertices.len()).filter(|&v| !fixed[v] && !around[v].is_empty()).collect();
    for _ in 0..EMBEDDING_SWEEPS {
        let mut moved: f64 = 0.0;
        for &v in &free {
            let total: f64 = around[v].iter().map(|&(_, w)| w).sum();
            let (x, y) = around[v].iter().fold((0.0, 0.0), |(x, y), &(j, w)| (x + chart[j].x * w, y + chart[j].y * w));
            let target = Vec2::new(x / total, y / total);
            let next = Vec2::new(chart[v].x + EMBEDDING_OVERRELAX * (target.x - chart[v].x), chart[v].y + EMBEDDING_OVERRELAX * (target.y - chart[v].y));
            moved = moved.max((next.x - chart[v].x).abs().max((next.y - chart[v].y).abs()));
            chart[v] = next;
        }
        if moved < radius * 1e-10 {
            break;
        }
    }
    chart
}

/// Triangles of the chart bucketed by where they lie, to find the one under a point.
struct Locator<'a> {
    chart: &'a [Vec2],
    triangles: &'a [[usize; 3]],
    cell: f64,
    buckets: HashMap<(i64, i64), Vec<usize>>,
}

impl<'a> Locator<'a> {
    fn new(chart: &'a [Vec2], triangles: &'a [[usize; 3]], cell: f64) -> Self {
        let mut buckets: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (t, &[a, b, c]) in triangles.iter().enumerate() {
            let (p, q, r) = (chart[a], chart[b], chart[c]);
            let (x0, x1) = ((p.x.min(q.x).min(r.x) / cell).floor() as i64, (p.x.max(q.x).max(r.x) / cell).floor() as i64);
            let (y0, y1) = ((p.y.min(q.y).min(r.y) / cell).floor() as i64, (p.y.max(q.y).max(r.y) / cell).floor() as i64);
            for x in x0..=x1 {
                for y in y0..=y1 {
                    buckets.entry((x, y)).or_default().push(t);
                }
            }
        }
        Self { chart, triangles, cell, buckets }
    }

    /// The triangle under `point` and its barycentric weights; the nearest
    /// triangle, weights clamped onto it, for a point just off the chart.
    fn locate(&self, point: Vec2) -> ([usize; 3], [f64; 3]) {
        let key = ((point.x / self.cell).floor() as i64, (point.y / self.cell).floor() as i64);
        let weigh = |t: usize| {
            let [a, b, c] = self.triangles[t];
            let (p, q, r) = (self.chart[a], self.chart[b], self.chart[c]);
            let whole = signed_area_2d(p, q, r);
            let wa = signed_area_2d(point, q, r) / whole;
            let wb = signed_area_2d(p, point, r) / whole;
            [wa, wb, 1.0 - wa - wb]
        };
        let consider = |best: &mut Option<(f64, usize, [f64; 3])>, t: usize| {
            let w = weigh(t);
            // A triangle with no area in the chart -- a face standing on edge -- weighs nothing.
            if w.iter().any(|x| !x.is_finite()) {
                return;
            }
            let outside = -w.iter().copied().fold(0.0_f64, f64::min);
            if best.is_none_or(|(o, ..)| outside < o) {
                *best = Some((outside, t, w));
            }
        };
        let mut best: Option<(f64, usize, [f64; 3])> = None;
        for &t in self.buckets.get(&key).map_or(&[][..], Vec::as_slice) {
            consider(&mut best, t);
        }
        if best.is_none_or(|(o, ..)| o > 1e-9) {
            for t in 0..self.triangles.len() {
                consider(&mut best, t);
            }
        }
        let Some((_, t, w)) = best else { return (self.triangles[0], [1.0, 0.0, 0.0]) };
        let clamped = w.map(|x| x.max(0.0));
        let sum: f64 = clamped.iter().sum();
        if sum <= 0.0 {
            return (self.triangles[t], [1.0, 0.0, 0.0]);
        }
        (self.triangles[t], clamped.map(|x| x / sum))
    }
}

/// Closed rings of the plane, each corner with its source.
type Rings = Vec<Vec<ConstraintPoint>>;

/// `rim` less every one of `holes`, on the plane: the boundary rings and hole
/// rings of what is left, each corner carrying the source of the point of
/// `known` it stands on, or none where the boolean made it.
fn ground_less_holes(
    rim: &[ConstraintPoint],
    holes: &[Vec<ConstraintPoint>],
    known: &[ConstraintPoint],
    near: f64,
) -> Result<(Rings, Rings), String> {
    let ring = |points: &[ConstraintPoint]| points.iter().map(|p| [p.position.x, p.position.y]).collect::<Vec<[f64; 2]>>();
    let subject: Vec<Vec<[f64; 2]>> = vec![ring(rim)];
    let clip: Vec<Vec<Vec<[f64; 2]>>> = holes.iter().filter(|h| h.len() >= 3).map(|h| vec![ring(h)]).collect();
    let pieces = subject.overlay(&clip, OverlayRule::Difference, FillRule::NonZero);
    let named = |[x, y]: [f64; 2]| -> ConstraintPoint {
        let source = known
            .iter()
            .filter(|p| (p.position.x - x).hypot(p.position.y - y) <= near * 100.0)
            .min_by(|a, b| (a.position.x - x).hypot(a.position.y - y).total_cmp(&(b.position.x - x).hypot(b.position.y - y)))
            .and_then(|p| p.source);
        let at = source.and_then(|s| known.iter().find(|p| p.source == Some(s))).map_or(Vec2::new(x, y), |p| p.position);
        ConstraintPoint { position: at, source }
    };
    // The boolean drops corners lying straight between their neighbours; the
    // rim's own corners go back in wherever they stand on a side of the result.
    let restored = |contour: Vec<[f64; 2]>| -> Vec<[f64; 2]> {
        let mut out = Vec::with_capacity(contour.len());
        for k in 0..contour.len() {
            let (a, b) = (contour[k], contour[(k + 1) % contour.len()]);
            out.push(a);
            let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
            let length_squared = dx * dx + dy * dy;
            if length_squared <= 0.0 {
                continue;
            }
            let mut between: Vec<(f64, [f64; 2])> = known
                .iter()
                .filter_map(|p| {
                    let (x, y) = (p.position.x, p.position.y);
                    let t = ((x - a[0]) * dx + (y - a[1]) * dy) / length_squared;
                    let off = (x - a[0] - dx * t).hypot(y - a[1] - dy * t);
                    (t > 1e-9 && t < 1.0 - 1e-9 && off <= near * 100.0).then_some((t, [x, y]))
                })
                .collect();
            between.sort_by(|p, q| p.0.total_cmp(&q.0));
            out.extend(between.into_iter().map(|(_, point)| point));
        }
        out.dedup_by(|p, q| (p[0] - q[0]).hypot(p[1] - q[1]) <= near);
        out
    };
    let (mut outer, mut inner) = (Vec::new(), Vec::new());
    for piece in pieces {
        for (k, contour) in piece.into_iter().enumerate() {
            let points: Vec<ConstraintPoint> = restored(contour).into_iter().map(named).collect();
            if points.len() < 3 {
                continue;
            }
            if k == 0 { outer.push(points) } else { inner.push(points) }
        }
    }
    if outer.is_empty() {
        return Err("os buracos tomam toda a terra a refazer".to_string());
    }
    Ok((outer, inner))
}

/// Barycentric weights of `point` (on the triangle's plane) in `a b c`.
fn barycentric(point: Vec3, a: Vec3, b: Vec3, c: Vec3) -> [f64; 3] {
    let (v0, v1, v2) = (b - a, c - a, point - a);
    let (d00, d01, d11, d20, d21) = (v0.dot(v0), v0.dot(v1), v1.dot(v1), v2.dot(v0), v2.dot(v1));
    let denominator = d00 * d11 - d01 * d01;
    if denominator.abs() < 1e-18 {
        return [1.0, 0.0, 0.0];
    }
    let wb = (d11 * d20 - d01 * d21) / denominator;
    let wc = (d00 * d21 - d01 * d20) / denominator;
    [1.0 - wb - wc, wb, wc]
}

/// Lays `patch` again on its own surface, going round `regeneration.holes`.
///
/// A rim touching itself at a corner -- ground gone round a road's end and
/// meeting itself again at its corner -- is cut open there: the corner taken
/// once for each fan of faces round it, so the patch is a disk the chart can
/// lay out, and every copy comes back as the corner it is.
pub fn regenerate_surface(patch: &Faces, regeneration: &Regeneration) -> Result<RegeneratedSurface, String> {
    let (open, alias) = unpinched(patch);
    let mut laid = regenerate_disk(&open, regeneration)?;
    let named = |origin: Origin| match origin {
        Origin::Patch(v) => Origin::Patch(alias[v]),
        given => given,
    };
    for origin in laid.origin.iter_mut().flatten() {
        *origin = named(*origin);
    }
    for landing in laid.landed.iter_mut() {
        landing.from = named(landing.from);
        landing.to = named(landing.to);
    }
    Ok(laid)
}

/// `patch` with every corner its rim runs through twice taken once per fan
/// of faces round it, and for every vertex the one of `patch` it is.
fn unpinched(patch: &Faces) -> (Faces, Vec<usize>) {
    let mut directed: HashSet<(usize, usize)> = HashSet::new();
    for face in &patch.faces {
        for k in 0..face.len() {
            directed.insert((face[k], face[(k + 1) % face.len()]));
        }
    }
    let mut leaving: HashMap<usize, usize> = HashMap::new();
    for &(a, b) in &directed {
        if !directed.contains(&(b, a)) {
            *leaving.entry(a).or_default() += 1;
        }
    }
    let mut pinched: Vec<usize> = leaving.into_iter().filter(|&(_, n)| n > 1).map(|(v, _)| v).collect();
    pinched.sort_unstable();
    let mut vertices = patch.vertices.clone();
    let mut alias: Vec<usize> = (0..vertices.len()).collect();
    let mut faces = patch.faces.clone();
    for v in pinched {
        // The faces round `v`, joined where two share a side running out of it.
        let around: Vec<usize> = (0..faces.len()).filter(|&f| faces[f].contains(&v)).collect();
        let neighbours_of = |f: usize| -> Vec<usize> {
            let face = &faces[f];
            let k = face.iter().position(|&x| x == v).unwrap();
            vec![face[(k + 1) % face.len()], face[(k + face.len() - 1) % face.len()]]
        };
        let mut fan = vec![usize::MAX; around.len()];
        let mut fans = 0;
        for start in 0..around.len() {
            if fan[start] != usize::MAX {
                continue;
            }
            fan[start] = fans;
            let mut stack = vec![start];
            while let Some(i) = stack.pop() {
                let sides = neighbours_of(around[i]);
                for j in 0..around.len() {
                    if fan[j] == usize::MAX && neighbours_of(around[j]).iter().any(|u| sides.contains(u)) {
                        fan[j] = fans;
                        stack.push(j);
                    }
                }
            }
            fans += 1;
        }
        for copy in 1..fans {
            vertices.push(vertices[v]);
            alias.push(alias[v]);
            let id = vertices.len() - 1;
            for (i, &f) in around.iter().enumerate() {
                if fan[i] == copy {
                    for corner in faces[f].iter_mut() {
                        if *corner == v {
                            *corner = id;
                        }
                    }
                }
            }
        }
    }
    (Faces { vertices, faces }, alias)
}

/// [`regenerate_surface`] for a patch whose rim touches itself nowhere.
fn regenerate_disk(patch: &Faces, regeneration: &Regeneration) -> Result<RegeneratedSurface, String> {
    let face_side = regeneration.face_side.max(0.05);
    let patch_triangles = triangles_of(&patch.vertices, &patch.faces);
    if patch_triangles.is_empty() {
        return Err("no ground to lay again".to_string());
    }
    let loops = border_loops(&patch_triangles);
    let outer_index = (0..loops.len())
        .max_by(|&a, &b| perimeter(&loops[a], &patch.vertices).total_cmp(&perimeter(&loops[b], &patch.vertices)))
        .ok_or("the ground to lay again has no border")?;
    let outer = loops[outer_index].clone();

    // A hole touching the rim is the rim pinched at a corner, not a hole:
    // capping it would cover ground outside the patch.
    let on_outer: HashSet<usize> = outer.iter().copied().collect();
    if loops.iter().enumerate().any(|(i, ring)| i != outer_index && ring.iter().any(|v| on_outer.contains(v))) {
        return Err("a borda da terra a refazer encosta nela mesma".to_string());
    }

    // The surface the new ground lies on: the patch, its holes capped.
    let mut support = patch.vertices.clone();
    let mut triangles = patch_triangles;
    let patch_normal = triangles.iter().fold(Vec3::default(), |sum, &t| sum + area_normal(&support, t)).normalized();
    for (i, ring) in loops.iter().enumerate() {
        if i != outer_index {
            cap(ring, &mut support, &mut triangles, face_side, patch_normal)?;
        }
    }
    let used: HashSet<usize> = triangles.iter().flatten().copied().collect();
    let edges: HashSet<(usize, usize)> = triangles.iter().flat_map(|&[a, b, c]| [(a, b), (b, c), (c, a)]).map(|(a, b)| (a.min(b), a.max(b))).collect();
    if used.len() as i64 - edges.len() as i64 + triangles.len() as i64 != 1 || border_loops(&triangles).len() != 1 {
        return Err("a terra a refazer não é um disco".to_string());
    }

    let mut flat = chart(&support, &triangles, &outer);
    // Scaled so a face of the chart is a face of the surface, on the whole.
    let surface_area: f64 = triangles.iter().map(|&t| area_normal(&support, t).length() * 0.5).sum();
    let chart_area: f64 = triangles.iter().map(|&[a, b, c]| signed_area_2d(flat[a], flat[b], flat[c])).sum();
    if chart_area.is_nan() || chart_area <= 0.0 {
        return Err("o mapa da terra a refazer saiu do avesso".to_string());
    }
    let scale = (surface_area / chart_area).sqrt();
    if !scale.is_finite() || scale > CHART_SCALE_MOST {
        return Err("o mapa da terra a refazer saiu desproporcional".to_string());
    }
    for point in flat.iter_mut() {
        *point = Vec2::new(point.x * scale, point.y * scale);
    }
    let locator = Locator::new(&flat, &triangles, face_side);
    let on_support = MeshDistance::new(support.clone(), &triangles.iter().map(|t| t.to_vec()).collect::<Vec<_>>(), face_side);
    // A point on the surface goes through the triangle under it; one past the
    // rim -- a structure's ring running on beyond the ground being laid --
    // goes past the chart's rim as far as it lies past the surface's, so a
    // side crossing the rim crosses it in the chart where it does on the ground.
    let to_chart = |point: Vec3| -> Vec2 {
        let Some((closest, [a, b, c])) = on_support.closest(point) else { return Vec2::new(0.0, 0.0) };
        let w = barycentric(closest, support[a], support[b], support[c]);
        let on = Vec2::new(w[0] * flat[a].x + w[1] * flat[b].x + w[2] * flat[c].x, w[0] * flat[a].y + w[1] * flat[b].y + w[2] * flat[c].y);
        let off = point.distance(closest);
        if off < 1e-6 {
            return on;
        }
        let (mut best, mut best_k, mut best_t) = (f64::INFINITY, 0, 0.0);
        for k in 0..outer.len() {
            let (p, q) = (support[outer[k]], support[outer[(k + 1) % outer.len()]]);
            let along = q - p;
            let t = if along.dot(along) > 0.0 { ((point - p).dot(along) / along.dot(along)).clamp(0.0, 1.0) } else { 0.0 };
            let d = point.distance(p.lerp(q, t));
            if d < best {
                (best, best_k, best_t) = (d, k, t);
            }
        }
        // Over or under the surface's inside, not past its rim: the triangle under it.
        if best > off * (1.0 + 1e-6) + 1e-9 {
            return on;
        }
        let (p, q) = (flat[outer[best_k]], flat[outer[(best_k + 1) % outer.len()]]);
        let (dx, dy) = (q.x - p.x, q.y - p.y);
        let length = dx.hypot(dy).max(1e-12);
        // The rim runs counter-clockwise, so outward is to its right.
        Vec2::new(p.x + dx * best_t + dy / length * best, p.y + dy * best_t - dx / length * best)
    };

    // One numbering for the generator: patch vertices first, then the given points.
    let patch_count = patch.vertices.len();
    let given: Vec<GivenPoint> = regeneration.holes.iter().flatten().copied().collect();
    let origin_of = |source: u32| -> (Origin, Vec3) {
        let s = source as usize;
        if s < patch_count { (Origin::Patch(s), patch.vertices[s]) } else { (Origin::Given(given[s - patch_count].id), given[s - patch_count].position) }
    };
    let boundary = vec![outer.iter().map(|&v| ConstraintPoint { position: flat[v], source: Some(v as u32) }).collect::<Vec<_>>()];
    let mut slot = patch_count;
    let holes: Vec<Vec<ConstraintPoint>> = regeneration
        .holes
        .iter()
        .map(|ring| {
            ring.iter()
                .map(|point| {
                    let source = slot as u32;
                    slot += 1;
                    ConstraintPoint { position: to_chart(point.position), source: Some(source) }
                })
                .collect()
        })
        .collect();
    // **The ground to lay, in the chart: the rim less the holes**, by a planar
    // boolean. Handed to the triangulation raw, a hole's side running along
    // the rim, or past it, is a constraint over another -- which the
    // triangulation does not survive, and its failure is the session's. Every
    // corner of the result is matched back to the point it is; a corner the
    // boolean made, where a hole crosses the rim, is new.
    let known: Vec<ConstraintPoint> = boundary[0].iter().chain(holes.iter().flatten()).copied().collect();
    let extent = known.iter().fold(1.0_f64, |m, p| m.max(p.position.x.abs()).max(p.position.y.abs()));
    let near = extent * 1e-7;
    let sides: Vec<(Vec2, Vec2, u32, u32, bool)> = std::iter::once((&boundary[0], false))
        .chain(holes.iter().map(|ring| (ring, true)))
        .flat_map(|(ring, hole)| (0..ring.len()).map(move |k| {
            let (p, q) = (ring[k], ring[(k + 1) % ring.len()]);
            (p.position, q.position, p.source.unwrap(), q.source.unwrap(), hole)
        }))
        .collect();
    let (ground_boundary, ground_holes) = if holes.is_empty() {
        (boundary, Vec::new())
    } else {
        ground_less_holes(&boundary[0], &holes, &known, near)?
    };
    let relax = RelaxOptions { iterations: RelaxOptions::standard().iterations, strength: regeneration.relax_strength, pin_boundary: false, pinned_targets: Default::default() };
    let rings: Vec<Vec<ConstraintPoint>> = ground_boundary.iter().chain(&ground_holes).cloned().collect();
    let boundary_count = ground_boundary.len();
    let grid = ground_grid(ground_boundary, ground_holes, face_side, regeneration.seed, &GroundRefinement::default(), &relax)?;

    // Lifted back onto the surface.
    let mut origin: Vec<Option<Origin>> = vec![None; grid.mesh.vertices.len()];
    let mut vertices: Vec<Vec3> = Vec::with_capacity(grid.mesh.vertices.len());
    for (index, &point) in grid.mesh.vertices.iter().enumerate() {
        if let Some(source) = grid.sources[index] {
            let (named, position) = origin_of(source);
            origin[index] = Some(named);
            vertices.push(position);
            continue;
        }
        let (corners, w) = locator.locate(point);
        vertices.push(support[corners[0]] * w[0] + support[corners[1]] * w[1] + support[corners[2]] * w[2]);
    }
    let on_segment = |point: Vec2, from: Vec2, to: Vec2| {
        let (dx, dy) = (to.x - from.x, to.y - from.y);
        let length_squared = dx * dx + dy * dy;
        let t = if length_squared > 0.0 { (((point.x - from.x) * dx + (point.y - from.y) * dy) / length_squared).clamp(0.0, 1.0) } else { 0.0 };
        (point.x - from.x - dx * t).hypot(point.y - from.y - dy * t) <= near * 100.0
    };
    let mut landed = Vec::new();
    for node in &grid.on_contour {
        let ring = &rings[if node.location.in_holes { boundary_count + node.location.ring } else { node.location.ring }];
        let (p, q) = (ring[node.location.segment].position, ring[(node.location.segment + 1) % ring.len()].position);
        // The side somebody holds this piece of the contour runs along: a
        // structure's before the rim, where the two meet.
        let Some(&(_, _, from, to, _)) = sides
            .iter()
            .filter(|side| on_segment(p, side.0, side.1) && on_segment(q, side.0, side.1))
            .max_by_key(|side| side.4)
        else {
            continue;
        };
        let (from_origin, a) = origin_of(from);
        let (to_origin, b) = origin_of(to);
        // Where the chart puts it on the surface, brought onto the side itself:
        // a side's share measured in the chart is no share of it in 3D once
        // the side runs on past the rim.
        let lifted = vertices[node.vertex];
        let along = b - a;
        let t = if along.dot(along) > 0.0 { ((lifted - a).dot(along) / along.dot(along)).clamp(0.0, 1.0) } else { 0.0 };
        let on_side = a.lerp(b, t);
        // A side met only past the surface's rim lies elsewhere on the ground
        // than the chart says: the corner stays where the chart put it, the
        // ground's own, rather than be dragged across to it. So too a side
        // standing over the corner: in plan the foot of a step lies on the
        // side along its top, a metre over it, and taken for a corner on that
        // side the ground there would split it under a face running the whole of it.
        if on_side.distance(lifted) > face_side * LANDING_REACH {
            continue;
        }
        vertices[node.vertex] = on_side;
        landed.push(Landing { vertex: node.vertex, from: from_origin, to: to_origin });
    }

    // The chart's frame has the patch's own normal, so counter-clockwise there
    // is the patch's own winding.
    Ok(RegeneratedSurface { vertices, faces: grid.mesh.faces, origin, landed, refinement_complete: grid.refinement_complete })
}
