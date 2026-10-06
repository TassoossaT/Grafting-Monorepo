//! A layer of earth laid on the ground, taken off it, or the ground levelled
//! -- the brush's everyday strokes -- as the ground's own surface moved, never
//! read again off a grid.
//!
//! ```text
//! faces under the stroke (+ the bare table it reaches, for a layer laid)
//!   -> lying flat in plan?  yes: the irregular grid laid in plan over them,
//!                                every corner lifted to the old surface
//!                                and moved by the stroke
//!                           no:  the surface itself moved by the stroke
//!                                (a cave's wall), then laid again on its
//!                                own chart (`regenerate_surface`)
//! ```
//!
//! The ring round the faces comes back as the very same vertices, and the
//! ground beyond it is never touched: a stroke laid over a hill adds to the
//! hill, a stroke laid beside one never reaches it. No signed distance, no
//! stitch, no remesh -- the grid the plane's ground is laid with, so the
//! cells come out the same.

use std::collections::{HashMap, HashSet};

use grafting_procgen_irregular_grid::constrained::ConstraintPoint;
use grafting_procgen_irregular_grid::ground::{GroundRefinement, ground_grid};
use grafting_procgen_irregular_grid::{RelaxOptions, Vec2};
use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::single::SingleFloatOverlay;

use crate::edit::Faces;
use crate::field::{Effect, Form, Shape};
use crate::mesh_distance::MeshDistance;
use crate::regenerate::{GivenPoint, Landing, Origin, RegeneratedSurface, Regeneration, regenerate_surface, triangles_of};
use crate::trimesh::border_loops;
use crate::vector::Vec3;

/// One stroke: layers raised or lowered (`Form::Profile`), or columns a level
/// is filled up to or cut down to (`Form::Column`).
#[derive(Debug, Clone)]
pub struct LayerEdit {
    pub shapes: Vec<Shape>,
    /// How far a level eases into the ground round it.
    pub blend: f64,
    /// How wide one finished face should be.
    pub face_side: f64,
    pub seed: u32,
    /// The table's height, where a layer laid past the ground rests new
    /// ground on the bare table. `None` never reaches past the ground.
    pub table: Option<f64>,
}

/// How much of the faces may lie turned over in plan, as a share of their
/// area there, for the plan still to be where they are laid.
const TURNED_SHARE_TOLERATED: f64 = 0.01;
/// Sides of the circle a layer's reach is drawn with on the bare table.
const REACH_SIDES: usize = 32;
/// The shortest side a corner the boolean made may leave, as a share of a face.
const SHORTEST_SIDE_SHARE: f64 = 0.15;
/// The relaxation's strength, as the plane's ground takes it.
const RELAX_STRENGTH: f64 = 0.7;
/// The coarsest face an edit lays, as a share of its narrowest shape: the
/// edit's own (`edit_surface`).
const SHAPE_FACE_SHARE: f64 = 0.6;

fn plan(point: Vec3) -> Vec2 {
    Vec2::new(point.x, point.z)
}

fn cross_2d(a: Vec2, b: Vec2, c: Vec2) -> f64 {
    (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
}

fn ring_area(ring: &[Vec2]) -> f64 {
    (0..ring.len()).map(|i| ring[i].x * ring[(i + 1) % ring.len()].y - ring[(i + 1) % ring.len()].x * ring[i].y).sum::<f64>() * 0.5
}

/// Distance in plan from `point` to the polyline `path`, and where along it the nearest point is: segment and share.
fn plan_to_path(point: Vec2, path: &[Vec3]) -> (f64, usize, f64) {
    if path.len() == 1 {
        let p = plan(path[0]);
        return ((point.x - p.x).hypot(point.y - p.y), 0, 0.0);
    }
    let mut best = (f64::INFINITY, 0, 0.0);
    for k in 0..path.len().saturating_sub(1) {
        let (a, b) = (plan(path[k]), plan(path[k + 1]));
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let length_squared = dx * dx + dy * dy;
        let t = if length_squared > 0.0 { (((point.x - a.x) * dx + (point.y - a.y) * dy) / length_squared).clamp(0.0, 1.0) } else { 0.0 };
        let d = (point.x - a.x - dx * t).hypot(point.y - a.y - dy * t);
        if d < best.0 {
            best = (d, k, t);
        }
    }
    best
}

/// A cosine from one at `0` to nothing at `1`.
fn cosine(along: f64) -> f64 {
    if along >= 1.0 { 0.0 } else { 0.5 * (1.0 + (std::f64::consts::PI * along.max(0.0)).cos()) }
}

fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// `point` with every shape applied in order, `up` the way a layer lifts it.
/// A layer is as deep as its profile at the point's distance across the
/// ground from the path; a level pulls the point's height to it within its
/// column, easing off over `blend` round its radius.
fn moved(point: Vec3, shapes: &[Shape], blend: f64, up: &dyn Fn(&Shape, Vec3) -> (Vec3, f64)) -> Vec3 {
    shapes.iter().fold(point, |at, shape| match (shape.effect, shape.form) {
        (Effect::Raise | Effect::Lower, Form::Profile { height }) => {
            let (direction, across) = up(shape, at);
            let depth = height * cosine(across / shape.radius.max(1e-9));
            at + direction * if shape.effect == Effect::Raise { depth } else { -depth }
        }
        (effect, Form::Column { low, high }) => {
            let (across, ..) = plan_to_path(plan(at), &shape.path);
            let ease = blend.max(1e-6);
            let weight = 1.0 - smoothstep((across - (shape.radius - ease)) / (2.0 * ease));
            match effect {
                Effect::Fill if at.y < high && at.y >= low => Vec3::new(at.x, at.y + (high - at.y) * weight, at.z),
                Effect::Carve if at.y > low && at.y <= high => Vec3::new(at.x, at.y - (at.y - low) * weight, at.z),
                _ => at,
            }
        }
        _ => at,
    })
}

/// The narrowest a shape is: what the faces laid on it must be finer than.
fn face_side_for(edit: &LayerEdit) -> f64 {
    let narrowest = edit.shapes.iter().map(Shape::thickness).fold(f64::INFINITY, f64::min);
    edit.face_side.max(0.25).min(narrowest * SHAPE_FACE_SHARE).max(0.25)
}

/// Lays `patch` again with `edit` applied to it. `context` is the ground
/// round it and `neighbours` the structures standing in it: a layer laid
/// out over the bare table never covers either.
pub fn layer_surface(patch: &Faces, context: &Faces, neighbours: &Faces, edit: &LayerEdit) -> Result<RegeneratedSurface, String> {
    let triangles = triangles_of(&patch.vertices, &patch.faces);
    let (positive, negative) = triangles.iter().fold((0.0, 0.0), |(p, n), &[a, b, c]| {
        let area = cross_2d(plan(patch.vertices[a]), plan(patch.vertices[b]), plan(patch.vertices[c])) * 0.5;
        if area > 0.0 { (p + area, n) } else { (p, n - area) }
    });
    let flat = positive.min(negative) <= (positive + negative) * TURNED_SHARE_TOLERATED;
    let laid = if triangles.is_empty() || flat {
        layer_in_plan(patch, &triangles, positive >= negative, context, neighbours, edit)?
    } else {
        layer_on_surface(patch, &triangles, context, edit)?
    };
    Ok(rim_unsplit(laid))
}

/// `laid` with every side of the ring whole again: a corner the grid put on
/// a side whose two ends both came back goes, and the cells round it become
/// one. The ground beyond the ring then meets the new ground on its own
/// sides, node for node -- never asked to split one, which a structure's
/// sealed side refuses and the graph's adoption of many does not survive.
fn rim_unsplit(laid: RegeneratedSurface) -> RegeneratedSurface {
    let back: HashSet<Origin> = laid.origin.iter().flatten().copied().collect();
    let dropped: HashSet<usize> = laid.landed.iter().filter(|l| back.contains(&l.from) && back.contains(&l.to)).map(|l| l.vertex).collect();
    if dropped.is_empty() {
        return laid;
    }
    let mut faces: Vec<Option<Vec<usize>>> = laid.faces.into_iter().map(Some).collect();
    for &x in &dropped {
        loop {
            let around: Vec<usize> = (0..faces.len()).filter(|&f| faces[f].as_ref().is_some_and(|face| face.contains(&x))).collect();
            // Two cells meeting on a side out of `x`: one cell.
            let pair = around.iter().find_map(|&f| {
                let face = faces[f].as_ref()?;
                let k = face.iter().position(|&v| v == x)?;
                let p = face[(k + 1) % face.len()];
                around.iter().copied().find(|&g| {
                    g != f && faces[g].as_ref().is_some_and(|other| (0..other.len()).any(|i| other[i] == p && other[(i + 1) % other.len()] == x))
                }).map(|g| (f, g, p))
            });
            let Some((f, g, p)) = pair else { break };
            let (first, second) = (faces[f].take().unwrap(), faces[g].take().unwrap());
            // `first` from `p` round to `x`, then `second` on from `x` to just short of `p`.
            let from_p = first.iter().position(|&v| v == p).unwrap();
            let mut merged: Vec<usize> = (0..first.len()).map(|i| first[(from_p + i) % first.len()]).collect();
            let from_x = second.iter().position(|&v| v == x).unwrap();
            merged.extend((1..second.len() - 1).map(|i| second[(from_x + i) % second.len()]));
            faces[f] = Some(without_slits(merged));
        }
        // One cell holds `x` now, lying straight on the side: it goes.
        for face in faces.iter_mut().flatten() {
            face.retain(|&v| v != x);
        }
    }
    // Compacted: the corners left, renumbered.
    let mut renumber = vec![usize::MAX; laid.vertices.len()];
    let mut vertices = Vec::new();
    let mut origin = Vec::new();
    for (v, &point) in laid.vertices.iter().enumerate() {
        if !dropped.contains(&v) {
            renumber[v] = vertices.len();
            vertices.push(point);
            origin.push(laid.origin[v]);
        }
    }
    let faces = faces.into_iter().flatten().filter(|face| face.len() >= 3).map(|face| face.into_iter().map(|v| renumber[v]).collect()).collect();
    let landed = laid.landed.into_iter().filter(|l| !dropped.contains(&l.vertex)).map(|l| Landing { vertex: renumber[l.vertex], ..l }).collect();
    RegeneratedSurface { vertices, faces, origin, landed, refinement_complete: laid.refinement_complete }
}

/// `face` less every slit: a corner it runs out to and straight back from,
/// where two cells merged along more than one side.
fn without_slits(mut face: Vec<usize>) -> Vec<usize> {
    loop {
        let n = face.len();
        if n < 3 {
            return face;
        }
        let Some(k) = (0..n).find(|&k| face[(k + n - 1) % n] == face[(k + 1) % n]) else { return face };
        // Out to `face[k]` and back: both the tip and one copy of its foot go.
        let (tip, foot) = (k, (k + 1) % n);
        let (high, low) = (tip.max(foot), tip.min(foot));
        face.remove(high);
        face.remove(low);
    }
}

/// The patch's faces as they lie in plan, found by a point under or over them.
struct PlanLocator<'a> {
    vertices: &'a [Vec3],
    triangles: Vec<[usize; 3]>,
    cell: f64,
    buckets: HashMap<(i64, i64), Vec<usize>>,
}

impl<'a> PlanLocator<'a> {
    fn new(vertices: &'a [Vec3], triangles: &[[usize; 3]], counter_clockwise: bool, cell: f64) -> Self {
        // Only the faces the right way round in plan: a sliver turned over is
        // no ground to stand a point on.
        let triangles: Vec<[usize; 3]> = triangles
            .iter()
            .copied()
            .filter(|&[a, b, c]| {
                let area = cross_2d(plan(vertices[a]), plan(vertices[b]), plan(vertices[c]));
                if counter_clockwise { area > 0.0 } else { area < 0.0 }
            })
            .collect();
        let mut buckets: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (t, &[a, b, c]) in triangles.iter().enumerate() {
            let (p, q, r) = (plan(vertices[a]), plan(vertices[b]), plan(vertices[c]));
            let (x0, x1) = ((p.x.min(q.x).min(r.x) / cell).floor() as i64, (p.x.max(q.x).max(r.x) / cell).floor() as i64);
            let (z0, z1) = ((p.y.min(q.y).min(r.y) / cell).floor() as i64, (p.y.max(q.y).max(r.y) / cell).floor() as i64);
            for x in x0..=x1 {
                for z in z0..=z1 {
                    buckets.entry((x, z)).or_default().push(t);
                }
            }
        }
        Self { vertices, triangles, cell, buckets }
    }

    /// The height of the faces over or under `point`; else, within `near`,
    /// of the nearest of them -- a point on their very rim.
    fn height(&self, point: Vec2, near: f64) -> Option<f64> {
        let key = ((point.x / self.cell).floor() as i64, (point.y / self.cell).floor() as i64);
        let mut nearest: Option<(f64, f64)> = None;
        for dx in -1..=1 {
            for dz in -1..=1 {
                for &t in self.buckets.get(&(key.0 + dx, key.1 + dz)).map_or(&[][..], Vec::as_slice) {
                    let [a, b, c] = self.triangles[t];
                    let (p, q, r) = (plan(self.vertices[a]), plan(self.vertices[b]), plan(self.vertices[c]));
                    let area = cross_2d(p, q, r);
                    let (wa, wb, wc) = (cross_2d(q, r, point) / area, cross_2d(r, p, point) / area, cross_2d(p, q, point) / area);
                    let y = |wa: f64, wb: f64, wc: f64| self.vertices[a].y * wa + self.vertices[b].y * wb + self.vertices[c].y * wc;
                    if wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9 {
                        return Some(y(wa, wb, wc));
                    }
                    // Clamped onto the triangle, for a point just past the rim.
                    let (ca, cb, cc) = (wa.max(0.0), wb.max(0.0), wc.max(0.0));
                    let sum = ca + cb + cc;
                    let (ca, cb, cc) = (ca / sum, cb / sum, cc / sum);
                    let on = Vec2::new(p.x * ca + q.x * cb + r.x * cc, p.y * ca + q.y * cb + r.y * cc);
                    let d = (on.x - point.x).hypot(on.y - point.y);
                    if d <= near && nearest.is_none_or(|(best, _)| d < best) {
                        nearest = Some((d, y(ca, cb, cc)));
                    }
                }
            }
        }
        nearest.map(|(_, y)| y)
    }
}

/// A polygon in plan, counter-clockwise.
type Contour = Vec<[f64; 2]>;

/// The reach of a layer on the bare table: a circle round every point of
/// its path, swept along it.
fn reach_contours(shape: &Shape) -> Vec<Vec<Contour>> {
    let circle = |centre: Vec2| -> Contour {
        (0..REACH_SIDES)
            .map(|k| {
                let angle = std::f64::consts::TAU * k as f64 / REACH_SIDES as f64;
                [centre.x + shape.radius * angle.cos(), centre.y + shape.radius * angle.sin()]
            })
            .collect()
    };
    let mut shapes: Vec<Vec<Contour>> = shape.path.iter().map(|&p| vec![circle(plan(p))]).collect();
    for pair in shape.path.windows(2) {
        let (a, b) = (plan(pair[0]), plan(pair[1]));
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let length = dx.hypot(dy);
        if length < 1e-9 {
            continue;
        }
        let (nx, ny) = (-dy / length * shape.radius, dx / length * shape.radius);
        shapes.push(vec![vec![[a.x - nx, a.y - ny], [b.x - nx, b.y - ny], [b.x + nx, b.y + ny], [a.x + nx, a.y + ny]]]);
    }
    shapes
}

/// `faces` each as a counter-clockwise polygon in plan.
fn plan_polygons(faces: &Faces) -> Vec<Vec<Contour>> {
    faces
        .faces
        .iter()
        .filter(|face| face.len() >= 3)
        .map(|face| {
            let mut contour: Contour = face.iter().map(|&v| [faces.vertices[v].x, faces.vertices[v].z]).collect();
            let ring: Vec<Vec2> = contour.iter().map(|p| Vec2::new(p[0], p[1])).collect();
            if ring_area(&ring) < 0.0 {
                contour.reverse();
            }
            vec![contour]
        })
        .collect()
}

/// Rings out of a boolean, every corner named by the known point it stands
/// on, and every known point lying on a side of it put back in -- the
/// boolean drops corners lying straight between their neighbours.
fn named_rings(pieces: Vec<Vec<Contour>>, known: &[ConstraintPoint], near: f64, short: f64) -> (Vec<Vec<ConstraintPoint>>, Vec<Vec<ConstraintPoint>>) {
    let name = |[x, y]: [f64; 2]| -> ConstraintPoint {
        known
            .iter()
            .filter(|p| (p.position.x - x).hypot(p.position.y - y) <= near * 100.0)
            .min_by(|a, b| (a.position.x - x).hypot(a.position.y - y).total_cmp(&(b.position.x - x).hypot(b.position.y - y)))
            .copied()
            .unwrap_or(ConstraintPoint { position: Vec2::new(x, y), source: None })
    };
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
            let mut points: Vec<ConstraintPoint> = restored(contour).into_iter().map(name).collect();
            points.dedup_by(|p, q| p.source.is_some() && p.source == q.source);
            if points.len() > 1 && points[0].source.is_some() && points[0].source == points[points.len() - 1].source {
                points.pop();
            }
            let points = without_spikes(points, near, short);
            if points.len() < 3 {
                continue;
            }
            if k == 0 { outer.push(points) } else { inner.push(points) }
        }
    }
    (outer, inner)
}

/// `ring` less every corner it runs out to and straight back from -- the
/// sliver a boolean leaves where two outlines meet along a side but for a
/// rounding, which no ground can be laid in.
/// A corner the boolean made right beside another -- closer than `short` --
/// goes too: a side that short is a cell too small to lay.
fn without_spikes(mut ring: Vec<ConstraintPoint>, near: f64, short: f64) -> Vec<ConstraintPoint> {
    loop {
        let n = ring.len();
        if n < 3 {
            return ring;
        }
        let spike = (0..n).find(|&k| {
            let (prev, at, next) = (ring[(k + n - 1) % n].position, ring[k].position, ring[(k + 1) % n].position);
            let (ux, uy, vx, vy) = (at.x - prev.x, at.y - prev.y, next.x - at.x, next.y - at.y);
            let (lu, lv) = (ux.hypot(uy), vx.hypot(vy));
            let made = ring[k].source.is_none();
            lu <= near || lv <= near || ((ux * vy - uy * vx).abs() <= 1e-6 * lu * lv && ux * vx + uy * vy < 0.0) || (made && lu.min(lv) < short)
        });
        match spike {
            Some(k) => {
                ring.remove(k);
            }
            None => return ring,
        }
    }
}

/// The plan's way: the patch, and the bare table a layer reaches past it,
/// laid in plan and lifted.
fn layer_in_plan(patch: &Faces, triangles: &[[usize; 3]], patch_counter_clockwise: bool, context: &Faces, neighbours: &Faces, edit: &LayerEdit) -> Result<RegeneratedSurface, String> {
    let face_side = face_side_for(edit);
    // With no faces to say, the ground round them does; with none at all, the
    // tabletop's own winding -- counter-clockwise in plan.
    let counter_clockwise = if !triangles.is_empty() {
        patch_counter_clockwise
    } else {
        let context_triangles = triangles_of(&context.vertices, &context.faces);
        context_triangles.iter().map(|&[a, b, c]| cross_2d(plan(context.vertices[a]), plan(context.vertices[b]), plan(context.vertices[c]))).sum::<f64>() >= 0.0
    };

    // The patch's own rings in plan: its rim and the holes structures make in it.
    let loops = border_loops(triangles);
    // Every corner the new ground may come to stand on, by one numbering: the
    // patch's own, then the ground's round it, then the structures'. A layer
    // run on out over the table meets the ground and structures beside it on
    // their own corners -- never on new ones lying on top of them.
    let (patch_count, context_count) = (patch.vertices.len(), context.vertices.len());
    let corner = |source: u32| -> (Origin, Vec3) {
        let s = source as usize;
        if s < patch_count {
            (Origin::Patch(s), patch.vertices[s])
        } else if s < patch_count + context_count {
            (Origin::Given(s - patch_count), context.vertices[s - patch_count])
        } else {
            (Origin::Given(s - patch_count), neighbours.vertices[s - patch_count - context_count])
        }
    };
    let (low, high) = edit.shapes.iter().fold((Vec2::new(f64::INFINITY, f64::INFINITY), Vec2::new(f64::NEG_INFINITY, f64::NEG_INFINITY)), |(low, high), shape| {
        shape.path.iter().fold((low, high), |(low, high), p| {
            (Vec2::new(low.x.min(p.x - shape.radius), low.y.min(p.z - shape.radius)), Vec2::new(high.x.max(p.x + shape.radius), high.y.max(p.z + shape.radius)))
        })
    });
    let reached = |p: Vec3| p.x >= low.x - face_side && p.x <= high.x + face_side && p.z >= low.y - face_side && p.z <= high.y + face_side;
    let known: Vec<ConstraintPoint> = loops
        .iter()
        .flatten()
        .map(|&v| ConstraintPoint { position: plan(patch.vertices[v]), source: Some(v as u32) })
        .chain(context.vertices.iter().enumerate().filter(|&(_, &p)| reached(p)).map(|(i, &p)| ConstraintPoint { position: plan(p), source: Some((patch_count + i) as u32) }))
        .chain(neighbours.vertices.iter().enumerate().filter(|&(_, &p)| reached(p)).map(|(i, &p)| ConstraintPoint { position: plan(p), source: Some((patch_count + context_count + i) as u32) }))
        .collect();
    let as_ring = |ring: &Vec<usize>| -> Vec<ConstraintPoint> { ring.iter().map(|&v| ConstraintPoint { position: plan(patch.vertices[v]), source: Some(v as u32) }).collect() };
    let outward = |ring: &Vec<usize>| {
        let area = ring_area(&ring.iter().map(|&v| plan(patch.vertices[v])).collect::<Vec<_>>());
        if counter_clockwise { area > 0.0 } else { area < 0.0 }
    };

    // Past the patch, a layer laid rests on the table wherever no ground or
    // structure already stands.
    let raised: Vec<&Shape> = edit.shapes.iter().filter(|s| s.effect == Effect::Raise).collect();
    // One boolean, never two: the patch and the reach together, less what
    // else stands -- a second boolean over the first's rounded corners
    // leaves slivers along the patch's rim.
    let own: Vec<Vec<Contour>> = plan_polygons(&Faces { vertices: patch.vertices.clone(), faces: triangles.iter().map(|t| t.to_vec()).collect() });
    let own_area: f64 = own.iter().map(|piece| ring_area(&piece[0].iter().map(|p| Vec2::new(p[0], p[1])).collect::<Vec<_>>())).sum();
    let joined: Vec<Vec<Contour>> = match edit.table {
        Some(_) if !raised.is_empty() => {
            let mut subject = own.clone();
            subject.extend(raised.iter().flat_map(|shape| reach_contours(shape)));
            let others: Vec<Vec<Contour>> = [context, neighbours].into_iter().flat_map(plan_polygons).collect();
            subject.overlay(&others, OverlayRule::Difference, FillRule::NonZero)
        }
        _ => Vec::new(),
    };
    let joined_area: f64 = joined
        .iter()
        .flat_map(|piece| piece.iter().map(|c| ring_area(&c.iter().map(|p| Vec2::new(p[0], p[1])).collect::<Vec<_>>())))
        .sum();
    let bare_area = joined_area - own_area;
    let extent = known.iter().map(|p| p.position.x.abs().max(p.position.y.abs())).chain(edit.shapes.iter().flat_map(|s| s.path.iter().map(|p| p.x.abs().max(p.z.abs()) + s.radius))).fold(1.0_f64, f64::max);
    let near = extent * 1e-7;
    let (boundary, holes) = if bare_area <= face_side * face_side * 0.05 {
        if triangles.is_empty() {
            return Err("nada onde a camada assentar".to_string());
        }
        let (outer, inner): (Vec<&Vec<usize>>, Vec<&Vec<usize>>) = loops.iter().partition(|ring| outward(ring));
        (outer.into_iter().map(as_ring).collect::<Vec<_>>(), inner.into_iter().map(as_ring).collect::<Vec<_>>())
    } else {
        // The patch and the table it runs on onto, as one piece of ground.
        named_rings(joined, &known, near, face_side * SHORTEST_SIDE_SHARE)
    };
    if boundary.is_empty() {
        return Err("nada onde a camada assentar".to_string());
    }

    let relax = RelaxOptions { iterations: RelaxOptions::standard().iterations, strength: RELAX_STRENGTH, pin_boundary: false, pinned_targets: Default::default() };
    let rings: Vec<Vec<ConstraintPoint>> = boundary.iter().chain(&holes).cloned().collect();
    let boundary_count = boundary.len();
    let grid = ground_grid(boundary, holes, face_side, edit.seed, &GroundRefinement::default(), &relax)?;

    // Lifted: to the old surface, or the table where it is bare, and moved.
    let locator = PlanLocator::new(&patch.vertices, triangles, counter_clockwise, face_side.max(1.0));
    let vertical = |shape: &Shape, at: Vec3| (Vec3::new(0.0, 1.0, 0.0), plan_to_path(plan(at), &shape.path).0);
    let rim: HashSet<(usize, usize)> = loops.iter().flat_map(|ring| (0..ring.len()).map(move |k| (ring[k].min(ring[(k + 1) % ring.len()]), ring[k].max(ring[(k + 1) % ring.len()])))).collect();
    let on_segment = |point: Vec2, from: Vec2, to: Vec2| {
        let (dx, dy) = (to.x - from.x, to.y - from.y);
        let length_squared = dx * dx + dy * dy;
        let t = if length_squared > 0.0 { (((point.x - from.x) * dx + (point.y - from.y) * dy) / length_squared).clamp(0.0, 1.0) } else { 0.0 };
        ((point.x - from.x - dx * t).hypot(point.y - from.y - dy * t) <= near * 100.0, t)
    };
    // The corners the relaxation folded back, smoothed out in plan first.
    let mut fixed: Vec<bool> = grid.sources.iter().map(Option::is_some).collect();
    for node in &grid.on_contour {
        fixed[node.vertex] = true;
    }
    let flat_points = unfolded_in_plan(&grid.mesh.vertices, &grid.mesh.faces, &fixed);
    let mut origin: Vec<Option<Origin>> = vec![None; grid.mesh.vertices.len()];
    let mut vertices: Vec<Vec3> = Vec::with_capacity(grid.mesh.vertices.len());
    for (index, &point) in flat_points.iter().enumerate() {
        if let Some(source) = grid.sources[index] {
            let (named, at) = corner(source);
            origin[index] = Some(named);
            vertices.push(at);
            continue;
        }
        let base = locator.height(point, face_side * 0.5).or(edit.table).unwrap_or(0.0);
        vertices.push(moved(Vec3::new(point.x, base, point.y), &edit.shapes, edit.blend, &vertical));
    }
    // A corner on a side somebody holds -- the patch's rim, the ground or a
    // structure beside it -- lies on that side, named with its two ends.
    let mut landed = Vec::new();
    for node in &grid.on_contour {
        let ring = &rings[if node.location.in_holes { boundary_count + node.location.ring } else { node.location.ring }];
        let (p, q) = (ring[node.location.segment], ring[(node.location.segment + 1) % ring.len()]);
        let side = match (p.source, q.source) {
            (Some(a), Some(b)) => Some((a, b)),
            _ => [p, q].iter().filter(|e| e.source.is_none()).find_map(|_| {
                // A corner the boolean made: the rim's side it stands on.
                rim.iter().copied().find(|&(a, b)| {
                    let (from, to) = (plan(patch.vertices[a]), plan(patch.vertices[b]));
                    on_segment(p.position, from, to).0 && on_segment(q.position, from, to).0
                }).map(|(a, b)| (a as u32, b as u32))
            }),
        };
        let Some((a, b)) = side else { continue };
        let ((from, at_a), (to, at_b)) = (corner(a), corner(b));
        let (_, t) = on_segment(grid.mesh.vertices[node.vertex], plan(at_a), plan(at_b));
        vertices[node.vertex] = at_a.lerp(at_b, t);
        landed.push(Landing { vertex: node.vertex, from, to });
    }
    // The grid winds counter-clockwise in plan; the patch's own winding back.
    let faces = grid.mesh.faces.iter().map(|face| if counter_clockwise { face.clone() } else { face.iter().rev().copied().collect() }).collect();
    Ok(RegeneratedSurface { vertices, faces, origin, landed, refinement_complete: grid.refinement_complete })
}

/// How many rounds a fold the relaxation left is smoothed out for, at most.
const UNFOLD_ROUNDS: usize = 20;

/// `points` with every cell the relaxation turned over in plan -- an inner
/// corner pushed out past the contour at a sharp corner of it -- smoothed
/// out: its free corners drawn to the middle of their neighbours until every
/// cell winds counter-clockwise again. Corners on a contour never move.
fn unfolded_in_plan(points: &[Vec2], faces: &[Vec<usize>], fixed: &[bool]) -> Vec<Vec2> {
    let mut points = points.to_vec();
    let mut neighbours: Vec<Vec<usize>> = vec![Vec::new(); points.len()];
    for face in faces {
        for i in 0..face.len() {
            let (a, b) = (face[i], face[(i + 1) % face.len()]);
            if !neighbours[a].contains(&b) {
                neighbours[a].push(b);
            }
            if !neighbours[b].contains(&a) {
                neighbours[b].push(a);
            }
        }
    }
    // Turned over, or a corner of it folded back: some corner turns clockwise.
    let folded = |points: &[Vec2], face: &Vec<usize>| {
        let n = face.len();
        (0..n).any(|i| cross_2d(points[face[(i + n - 1) % n]], points[face[i]], points[face[(i + 1) % n]]) <= 0.0)
            && ring_area(&face.iter().map(|&v| points[v]).collect::<Vec<_>>()) <= 0.0
            || (0..n).any(|i| {
                let (p, q, r) = (points[face[(i + n - 1) % n]], points[face[i]], points[face[(i + 1) % n]]);
                // Out to a corner and straight back: a spike with no area.
                let (ux, uy, vx, vy) = (q.x - p.x, q.y - p.y, r.x - q.x, r.y - q.y);
                (ux * vy - uy * vx).abs() <= 1e-9 * (ux.hypot(uy) * vx.hypot(vy)).max(1e-18) && ux * vx + uy * vy < 0.0
            })
    };
    for _ in 0..UNFOLD_ROUNDS {
        let moving: HashSet<usize> = faces.iter().filter(|face| folded(&points, face)).flatten().copied().filter(|&v| !fixed[v] && !neighbours[v].is_empty()).collect();
        if moving.is_empty() {
            break;
        }
        for v in moving {
            let around = &neighbours[v];
            let (x, y) = around.iter().fold((0.0, 0.0), |(x, y), &n| (x + points[n].x, y + points[n].y));
            points[v] = Vec2::new(x / around.len() as f64, y / around.len() as f64);
        }
    }
    points
}

/// Splits every inner side longer than `longest`, never a side of the rim,
/// until none is or `rounds` are spent.
fn refined(vertices: &mut Vec<Vec3>, mut triangles: Vec<[usize; 3]>, longest: f64, rounds: usize) -> Vec<[usize; 3]> {
    let key = |a: usize, b: usize| (a.min(b), a.max(b));
    for _ in 0..rounds {
        let mut uses: HashMap<(usize, usize), u32> = HashMap::new();
        for &[a, b, c] in &triangles {
            for (p, q) in [(a, b), (b, c), (c, a)] {
                *uses.entry(key(p, q)).or_default() += 1;
            }
        }
        let mut middle: HashMap<(usize, usize), usize> = HashMap::new();
        for &[a, b, c] in &triangles {
            for (p, q) in [(a, b), (b, c), (c, a)] {
                if uses[&key(p, q)] >= 2 && vertices[p].distance(vertices[q]) > longest && !middle.contains_key(&key(p, q)) {
                    vertices.push((vertices[p] + vertices[q]) * 0.5);
                    middle.insert(key(p, q), vertices.len() - 1);
                }
            }
        }
        if middle.is_empty() {
            break;
        }
        let mut out = Vec::with_capacity(triangles.len() * 4);
        for &[a, b, c] in &triangles {
            let m = |p: usize, q: usize| middle.get(&key(p, q)).copied();
            // Turned so the split sides come first.
            let turns = [[a, b, c], [b, c, a], [c, a, b]];
            let split: Vec<bool> = turns.iter().map(|&[p, q, _]| m(p, q).is_some()).collect();
            match split.iter().filter(|&&s| s).count() {
                0 => out.push([a, b, c]),
                3 => {
                    let (ab, bc, ca) = (m(a, b).unwrap(), m(b, c).unwrap(), m(c, a).unwrap());
                    out.extend([[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]);
                }
                1 => {
                    let k = (0..3).find(|&k| split[k]).unwrap();
                    let [p, q, r] = turns[k];
                    let pq = m(p, q).unwrap();
                    out.extend([[p, pq, r], [pq, q, r]]);
                }
                _ => {
                    // Two split: the one left whole is `r p`.
                    let k = (0..3).find(|&k| split[k] && split[(k + 1) % 3]).unwrap();
                    let [p, q, r] = turns[k];
                    let (pq, qr) = (m(p, q).unwrap(), m(q, r).unwrap());
                    out.extend([[pq, q, qr], [p, pq, qr], [p, qr, r]]);
                }
            }
        }
        triangles = out;
    }
    triangles
}

/// The surface's way, for faces that fold over in plan -- a cave's wall:
/// the surface itself moved by the stroke, out of the solid where the stroke
/// ran, and laid again on its own chart.
fn layer_on_surface(patch: &Faces, triangles: &[[usize; 3]], context: &Faces, edit: &LayerEdit) -> Result<RegeneratedSurface, String> {
    let face_side = face_side_for(edit);
    // Out of the solid: the ground faces up, so the winding whose normal
    // mostly rises is out of it.
    let context_triangles = triangles_of(&context.vertices, &context.faces);
    let normal = |vertices: &[Vec3], [a, b, c]: [usize; 3]| (vertices[b] - vertices[a]).cross(vertices[c] - vertices[a]);
    let rising: f64 = triangles.iter().map(|&t| normal(&patch.vertices, t).y).sum::<f64>() + context_triangles.iter().map(|&t| normal(&context.vertices, t).y).sum::<f64>();
    let out = if rising < 0.0 { -1.0 } else { 1.0 };

    let mut support = patch.vertices.clone();
    let rim: HashSet<usize> = border_loops(triangles).into_iter().flatten().collect();
    let fine = refined(&mut support, triangles.to_vec(), face_side * 0.5, 3);
    // The ground's normal under every point of each path.
    let surface = MeshDistance::new(support.clone(), &fine.iter().map(|t| t.to_vec()).collect::<Vec<_>>(), face_side);
    let ups: Vec<Vec<Vec3>> = edit
        .shapes
        .iter()
        .map(|shape| {
            shape
                .path
                .iter()
                .map(|&at| match surface.closest(at) {
                    Some((_, t)) => (normal(&support, t) * out).normalized(),
                    None => Vec3::new(0.0, 1.0, 0.0),
                })
                .collect()
        })
        .collect();
    let across = |shape: &Shape, at: Vec3| -> (Vec3, f64) {
        let index = edit.shapes.iter().position(|s| std::ptr::eq(s, shape)).unwrap_or(0);
        let up = &ups[index];
        let mut best = (f64::INFINITY, Vec3::new(0.0, 1.0, 0.0), 0.0);
        let mut consider = |on: Vec3, direction: Vec3| {
            let offset = at - on;
            let d = offset.length();
            if d < best.0 {
                let along = offset.dot(direction);
                best = (d, direction, (offset - direction * along).length());
            }
        };
        if shape.path.len() == 1 {
            consider(shape.path[0], up[0]);
        }
        for k in 0..shape.path.len().saturating_sub(1) {
            let (a, b) = (shape.path[k], shape.path[k + 1]);
            let along = b - a;
            let length_squared = along.dot(along);
            let t = if length_squared > 0.0 { ((at - a).dot(along) / length_squared).clamp(0.0, 1.0) } else { 0.0 };
            consider(a.lerp(b, t), up[k].lerp(up[k + 1], t).normalized());
        }
        (best.1, best.2)
    };
    let displaced: Vec<Vec3> = support.iter().enumerate().map(|(v, &p)| if rim.contains(&v) { p } else { moved(p, &edit.shapes, edit.blend, &across) }).collect();

    // The holes in the patch -- structures standing in it -- gone round,
    // never capped: the ground goes round them as they are.
    let loops = border_loops(&fine);
    let perimeter = |ring: &Vec<usize>| (0..ring.len()).map(|k| displaced[ring[k]].distance(displaced[ring[(k + 1) % ring.len()]])).sum::<f64>();
    let outer = (0..loops.len()).max_by(|&a, &b| perimeter(&loops[a]).total_cmp(&perimeter(&loops[b]))).ok_or("a terra a refazer não tem borda")?;
    let holes: Vec<Vec<GivenPoint>> = loops
        .iter()
        .enumerate()
        .filter(|&(i, _)| i != outer)
        .map(|(_, ring)| ring.iter().map(|&v| GivenPoint { position: displaced[v], id: v }).collect())
        .collect();
    let laid = regenerate_surface(
        &Faces { vertices: displaced, faces: fine.iter().map(|t| t.to_vec()).collect() },
        &Regeneration { holes, face_side, seed: edit.seed, relax_strength: RELAX_STRENGTH },
    )?;
    // Corners of the rim and of the holes alike are the patch's own vertices.
    let as_patch = |origin: Origin| match origin {
        Origin::Patch(v) | Origin::Given(v) => Origin::Patch(v),
    };
    Ok(RegeneratedSurface {
        origin: laid.origin.into_iter().map(|o| o.map(as_patch)).collect(),
        landed: laid.landed.into_iter().map(|l| Landing { vertex: l.vertex, from: as_patch(l.from), to: as_patch(l.to) }).collect(),
        ..laid
    })
}
