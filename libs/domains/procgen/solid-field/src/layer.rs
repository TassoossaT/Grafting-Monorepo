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

use noise::{NoiseFn, Perlin};

use crate::bed::{Bed, BedIndex, Sheets, bedded, settled_under};
use crate::edit::{Faces, newell};
use crate::field::{Effect, Form, Shape};
use crate::mesh_distance::MeshDistance;
use crate::regenerate::{GivenPoint, Landing, Origin, RegeneratedSurface, Regeneration, regenerate_surface, triangles_of};
use crate::trimesh::{border_loops, face_border_loops};
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
    /// Structures the ground is brought to rest under, after the shapes.
    pub beds: Vec<Bed>,
}

/// How much of the faces may lie turned over in plan, as a share of their
/// area there, for the plan still to be where they are laid.
const TURNED_SHARE_TOLERATED: f64 = 0.05;
/// How much of a brush's patch may lie turned from it, as a share of its
/// area in plan, for it still to be laid as the brush sees it.
const SEEN_TURNED_SHARE_TOLERATED: f64 = 0.3;
/// How far up a brush's own way has to point for it to push straight up:
/// pointing less far up -- out of a cliff, ground steeper than 60° -- it
/// pushes the surface itself along that way, never the plan.
const UPRIGHT: f64 = 0.5;
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

fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// `point` with every shape applied in order, `up` the way a layer lifts it.
/// A layer is as deep as its profile at the point's distance across the
/// ground from the path; a level pulls the point's height to it within its
/// column, by the brush's strength and falloff; a smooth draws it toward
/// the mean height of the ground round it (`height_at`, the old surface in
/// plan -- `None` where the faces fold over in plan, and a smooth does
/// nothing there); noise lifts or sinks it by Perlin noise.
fn moved(point: Vec3, shapes: &[Shape], blend: f64, up: &dyn Fn(&Shape, Vec3) -> (Vec3, f64), height_at: Option<&dyn Fn(Vec2) -> Option<f64>>) -> Vec3 {
    shapes.iter().fold(point, |at, shape| match (shape.effect, shape.form) {
        (Effect::Raise | Effect::Lower, Form::Profile { height }) => {
            let (direction, across) = up(shape, at);
            let depth = height * shape.brush.weight(across / shape.radius.max(1e-9));
            at + direction * if shape.effect == Effect::Raise { depth } else { -depth }
        }
        (Effect::Smooth, _) => {
            let Some(height_at) = height_at else { return at };
            let (across, ..) = plan_to_path(plan(at), &shape.path);
            let weight = shape.brush.weight(across / shape.radius.max(1e-9)) * shape.brush.strength.clamp(0.0, 1.0);
            if weight <= 0.0 {
                return at;
            }
            // The mean over a disc of the filter's radius round the point: its
            // middle, and two rings of samples.
            let reach = (shape.brush.filter.max(0.05) * shape.radius).max(1e-3);
            let mut sum = 0.0;
            let mut count = 0.0;
            for (ring, r) in [(1usize, 0.0), (8, 0.5 * reach), (12, reach)] {
                for k in 0..ring {
                    let angle = std::f64::consts::TAU * k as f64 / ring as f64;
                    if let Some(y) = height_at(Vec2::new(at.x + r * angle.cos(), at.z + r * angle.sin())) {
                        sum += y;
                        count += 1.0;
                    }
                }
            }
            if count == 0.0 {
                return at;
            }
            Vec3::new(at.x, at.y + (sum / count - at.y) * weight, at.z)
        }
        (Effect::Noise, Form::Profile { height }) => {
            let (across, ..) = plan_to_path(plan(at), &shape.path);
            let weight = shape.brush.weight(across / shape.radius.max(1e-9)) * shape.brush.strength.clamp(0.0, 1.0);
            if weight <= 0.0 {
                return at;
            }
            let scale = shape.brush.noise_scale.max(0.1);
            let wave = Perlin::new(shape.brush.seed).get([at.x / scale, at.z / scale]);
            Vec3::new(at.x, at.y + height * wave * weight, at.z)
        }
        (effect, Form::Column { low, high }) => {
            let (across, ..) = plan_to_path(plan(at), &shape.path);
            // The rim eased over `blend` as ever, the brush's own falloff and
            // strength on top.
            let ease = blend.max(1e-6);
            let weight = (1.0 - smoothstep((across - (shape.radius - ease)) / (2.0 * ease)))
                * shape.brush.weight(across / shape.radius.max(1e-9))
                * shape.brush.strength.clamp(0.0, 1.0);
            match effect {
                Effect::Fill if at.y < high && at.y >= low => Vec3::new(at.x, at.y + (high - at.y) * weight, at.z),
                Effect::Carve if at.y > low && at.y <= high => Vec3::new(at.x, at.y - (at.y - low) * weight, at.z),
                _ => at,
            }
        }
        _ => at,
    })
}

/// The narrowest a shape is: what the faces laid on it must be finer than --
/// never finer than [`FINEST_FACE_SHARE`] of the face asked for. Laid as fine
/// as a narrow stroke wanted (a quarter metre for a small, tall one), the
/// ground grew denser with every small stroke, and every stroke after it
/// over that ground read and laid hundreds of faces again.
fn face_side_for(edit: &LayerEdit) -> f64 {
    let narrowest = edit.shapes.iter().map(Shape::thickness).fold(f64::INFINITY, f64::min);
    edit.face_side.max(0.25).min(narrowest * SHAPE_FACE_SHARE).max(edit.face_side * FINEST_FACE_SHARE).max(0.25)
}

/// The finest face a layer lays, as a share of the face asked for.
const FINEST_FACE_SHARE: f64 = 0.4;

/// Lays `patch` again with `edit` applied to it. `context` is the ground
/// round it and `neighbours` the structures standing in it: a layer laid
/// out over the bare table never covers either.
pub fn layer_surface(patch: &Faces, context: &Faces, neighbours: &Faces, edit: &LayerEdit) -> Result<RegeneratedSurface, String> {
    // A brush pushed out of a wall: the same edit, in a frame turned so its
    // way is up -- the wall is ground there, laid by the plan's own way.
    if let Some(way) = edit.shapes.iter().find(|shape| shape.up.len() == shape.path.len()).and_then(|shape| shape.up.first().copied()).filter(|up| up.y < UPRIGHT) {
        // The surface's own vertices pushed along the way and the faces laid
        // again on its own chart, which never crosses itself however the
        // ground folds as the brush sees it; seen along the way where that
        // refuses.
        let triangles = triangles_of(&patch.vertices, &patch.faces);
        let on_surface = layer_on_surface(patch, &triangles, context, edit).map(rim_unsplit).ok().filter(|laid| rim_kept(patch, context, edit.table, laid));
        return whole(patch, context, edit.table, match on_surface {
            Some(laid) => laid,
            None => layer_turned(patch, context, neighbours, edit, way)?,
        });
    }
    whole(patch, context, edit.table, layer_laid(patch, context, neighbours, edit, false)?)
}

/// `laid`, refused where its rim is not the patch's own whole: the ground
/// beside would touch the new at a point, and every stroke over it after
/// was refused.
fn whole(patch: &Faces, context: &Faces, table: Option<f64>, laid: RegeneratedSurface) -> Result<RegeneratedSurface, String> {
    if rim_kept(patch, context, table, &laid) { Ok(laid) } else { Err("a borda da terra refeita não volta inteira".to_string()) }
}

/// [`layer_surface`] with the brush pushing up. `seen` is a brush's patch
/// turned so its way is up: a sheet of it over another is laid as the one
/// the brush sees -- the fold taken flat into it -- and a patch turned over
/// is refused, never laid on the surface's own chart.
fn layer_laid(patch: &Faces, context: &Faces, neighbours: &Faces, edit: &LayerEdit, seen: bool) -> Result<RegeneratedSurface, String> {
    let triangles = triangles_of(&patch.vertices, &patch.faces);
    let (positive, negative) = triangles.iter().fold((0.0, 0.0), |(p, n), &[a, b, c]| {
        let area = cross_2d(plan(patch.vertices[a]), plan(patch.vertices[b]), plan(patch.vertices[c])) * 0.5;
        if area > 0.0 { (p + area, n) } else { (p, n - area) }
    });
    // Flat in plan: next to nothing turned over, and nothing lying over
    // anything else -- a tunnel's floor under the hill over it both face up.
    let flat = positive.min(negative) <= (positive + negative) * TURNED_SHARE_TOLERATED
        && (seen || overlapping_area(&patch.vertices, &triangles) <= positive.max(negative) * TURNED_SHARE_TOLERATED);
    // A brush pushed out of a wall, its patch turned so its way is up, lays
    // the sheet it sees though the patch folds in plan, short of most of it
    // turned away; a stroke from above over ground folding in plan is laid
    // on the surface's own chart, as ever.
    let turned_over = positive.min(negative) > (positive + negative) * SEEN_TURNED_SHARE_TOLERATED;
    let laid = if triangles.is_empty() || flat || (seen && !turned_over) {
        // Seen by a brush on a wall, faces may lie over others though none
        // is turned: the rim is asked whether it crosses itself all the same.
        let in_plan = layer_in_plan(patch, &triangles, positive >= negative, context, neighbours, edit, !flat || seen)?;
        // A rim nearly folded in plan -- within what flat allows -- had cells
        // laid past it, and corners of it left under them: the ground beside
        // touched the new at a point. On the surface's own chart instead.
        if triangles.is_empty() || rim_kept(patch, context, edit.table, &in_plan) { in_plan } else { layer_on_surface(patch, &triangles, context, edit)? }
    } else if seen {
        return Err("o pincel não vê a terra dali: ela se vira para longe dele".to_string());
    } else {
        layer_on_surface(patch, &triangles, context, edit)?
    };
    Ok(rim_unsplit(laid))
}

/// Whether any two sides of `rings` cross, short of meeting at a corner.
fn rings_cross(rings: &[Vec<ConstraintPoint>]) -> bool {
    let sides: Vec<(Vec2, Vec2)> = rings.iter().flat_map(|ring| (0..ring.len()).map(move |k| (ring[k].position, ring[(k + 1) % ring.len()].position))).collect();
    let crosses = |(a, b): (Vec2, Vec2), (c, d): (Vec2, Vec2)| {
        let shared = |p: Vec2, q: Vec2| (p.x - q.x).abs() < 1e-9 && (p.y - q.y).abs() < 1e-9;
        if shared(a, c) || shared(a, d) || shared(b, c) || shared(b, d) {
            return false;
        }
        let (d1, d2) = (cross_2d(c, d, a), cross_2d(c, d, b));
        let (d3, d4) = (cross_2d(a, b, c), cross_2d(a, b, d));
        d1 * d2 < 0.0 && d3 * d4 < 0.0
    };
    (0..sides.len()).any(|i| (i + 1..sides.len()).any(|j| crosses(sides[i], sides[j])))
}

/// `edit` laid with its brushes pushing along `way` -- out of a wall, a
/// cliff, the underside of a ledge -- as a sculptor's draw brush does: the
/// patch, the ground round it and the strokes turned so `way` is up, laid as
/// ground facing up is, and turned back. The patch faces `way` (the tabletop
/// takes no face turned from it), so turned it lies flat in plan, and the
/// plan's own grid lays it: the surface moved straight along `way`, never
/// folded. The table and the beds are no part of a brush on a wall.
fn layer_turned(patch: &Faces, context: &Faces, neighbours: &Faces, edit: &LayerEdit, way: Vec3) -> Result<RegeneratedSurface, String> {
    // A frame turning as the world's does -- `a`, `way`, `b` like x, y, z --
    // so a face's winding, and with it the side it faces, is kept.
    let up = way.normalized();
    let seed = if up.x.abs() < 0.9 { Vec3::new(1.0, 0.0, 0.0) } else { Vec3::new(0.0, 0.0, 1.0) };
    let a = (seed - up * seed.dot(up)).normalized();
    let b = a.cross(up);
    let into = |p: Vec3| Vec3::new(p.dot(a), p.dot(up), p.dot(b));
    let back = |p: Vec3| a * p.x + up * p.y + b * p.z;
    let turned = |faces: &Faces| Faces { vertices: faces.vertices.iter().map(|&p| into(p)).collect(), faces: faces.faces.clone() };
    let shapes = edit.shapes.iter().map(|shape| Shape { path: shape.path.iter().map(|&p| into(p)).collect(), up: Vec::new(), ..shape.clone() }).collect();
    // Laid in plan only, as the brush sees it: never on the surface's own
    // chart, which spread a patch folding along the way into tens of
    // thousands of faces.
    let laid = layer_laid(&turned(patch), &turned(context), &turned(neighbours), &LayerEdit { shapes, table: None, beds: Vec::new(), ..edit.clone() }, true)?;
    Ok(RegeneratedSurface { vertices: laid.vertices.into_iter().map(back).collect(), ..laid })
}

/// Whether every corner of `patch`'s rim -- its holes' too -- the ground
/// round it (`context`) also holds stands on the rim of `laid`: a corner with
/// faces laid all round it lies under ground laid past the rim. With a
/// `table` to run on over, a corner on the ground's own free edge may go
/// under the ground run on; with none, every corner of the rim stays on it.
fn rim_kept(patch: &Faces, context: &Faces, table: Option<f64>, laid: &RegeneratedSurface) -> bool {
    let key = |p: Vec3| ((p.x * 1e4).round() as i64, (p.y * 1e4).round() as i64, (p.z * 1e4).round() as i64);
    let shared: HashSet<(i64, i64, i64)> = context.faces.iter().flatten().map(|&v| key(context.vertices[v])).collect();
    let mut sides: HashMap<(usize, usize), usize> = HashMap::new();
    for face in &laid.faces {
        for k in 0..face.len() {
            let (a, b) = (face[k], face[(k + 1) % face.len()]);
            *sides.entry((a.min(b), a.max(b))).or_default() += 1;
        }
    }
    let on_rim: HashSet<usize> = sides
        .into_iter()
        .filter(|&(_, n)| n == 1)
        .flat_map(|((a, b), _)| [a, b])
        .filter_map(|v| match laid.origin[v] {
            Some(Origin::Patch(p)) => Some(p),
            _ => None,
        })
        .collect();
    face_border_loops(&patch.faces).iter().flatten().filter(|&&v| table.is_none() || shared.contains(&key(patch.vertices[v]))).all(|v| on_rim.contains(v))
}

/// `laid` with every side of the ring whole again: a corner the grid put on
/// a side whose two ends both came back goes, and the cells round it become
/// one. The ground beyond the ring then meets the new ground on its own
/// sides, node for node -- never asked to split one, which a structure's
/// sealed side refuses and the graph's adoption of many does not survive.
/// The most corners a cell [`rim_unsplit`] joins may have.
const UNSPLIT_CORNERS_MOST: usize = 10;

fn rim_unsplit(laid: RegeneratedSurface) -> RegeneratedSurface {
    let back: HashSet<Origin> = laid.origin.iter().flatten().copied().collect();
    let dropped: HashSet<usize> = laid.landed.iter().filter(|l| back.contains(&l.from) && back.contains(&l.to)).map(|l| l.vertex).collect();
    if dropped.is_empty() {
        return laid;
    }
    let mut faces: Vec<Option<Vec<usize>>> = laid.faces.into_iter().map(Some).collect();
    // Corners kept on their side after all: joining the cells round them
    // would have made one past `UNSPLIT_CORNERS_MOST` -- a strip of cells
    // along a long side joined into one of a hundred corners, laid over
    // another, which no stroke after could lay again.
    let mut kept: HashSet<usize> = HashSet::new();
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
            if faces[f].as_ref().map_or(0, Vec::len) + faces[g].as_ref().map_or(0, Vec::len) - 2 > UNSPLIT_CORNERS_MOST {
                kept.insert(x);
                break;
            }
            let (first, second) = (faces[f].take().unwrap(), faces[g].take().unwrap());
            let facing = newell(&laid.vertices, &first) + newell(&laid.vertices, &second);
            // `first` from `p` round to `x`, then `second` on from `x` to just short of `p`.
            let from_p = first.iter().position(|&v| v == p).unwrap();
            let mut merged: Vec<usize> = (0..first.len()).map(|i| first[(from_p + i) % first.len()]).collect();
            let from_x = second.iter().position(|&v| v == x).unwrap();
            merged.extend((1..second.len() - 1).map(|i| second[(from_x + i) % second.len()]));
            // Two cells touching at a corner besides their side walk round it
            // twice: the one cell wraps the cells it closes round, which go
            // into it -- a cell with a hole is no cell.
            let (outer, inner): (Vec<Vec<usize>>, Vec<Vec<usize>>) =
                lobes(without_slits(merged)).into_iter().partition(|lobe| newell(&laid.vertices, lobe).dot(facing) >= 0.0);
            for lobe in &inner {
                for enclosed in enclosed_by(&faces, lobe) {
                    faces[enclosed] = None;
                }
            }
            let mut outer = outer.into_iter();
            faces[f] = outer.next();
            faces.extend(outer.map(Some));
        }
        if kept.contains(&x) {
            continue;
        }
        // One cell holds `x` now, lying straight on the side: it goes.
        for face in faces.iter_mut().flatten() {
            face.retain(|&v| v != x);
        }
    }
    // Compacted: the corners left, renumbered -- a new one no cell holds
    // any more, inside a cell that closed round it, goes too.
    let used: HashSet<usize> = faces.iter().flatten().flatten().copied().collect();
    let mut renumber = vec![usize::MAX; laid.vertices.len()];
    let mut vertices = Vec::new();
    let mut origin = Vec::new();
    for (v, &point) in laid.vertices.iter().enumerate() {
        if (!dropped.contains(&v) || kept.contains(&v)) && (used.contains(&v) || laid.origin[v].is_some()) {
            renumber[v] = vertices.len();
            vertices.push(point);
            origin.push(laid.origin[v]);
        }
    }
    let faces = faces.into_iter().flatten().filter(|face| face.len() >= 3).map(|face| face.into_iter().map(|v| renumber[v]).collect()).collect();
    let landed = laid.landed.into_iter().filter(|l| renumber[l.vertex] != usize::MAX).map(|l| Landing { vertex: renumber[l.vertex], ..l }).collect();
    RegeneratedSurface { vertices, faces, origin, landed, refinement_complete: laid.refinement_complete }
}

/// `face` less every slit: a corner it runs out to and straight back from,
/// where two cells merged along more than one side.
/// `face` cut where it walks through one corner twice: the loops it walks,
/// each a face of its own.
fn lobes(face: Vec<usize>) -> Vec<Vec<usize>> {
    let mut done = Vec::new();
    let mut open = vec![face];
    while let Some(face) = open.pop() {
        let twice = (0..face.len()).find_map(|i| (i + 1..face.len()).find(|&j| face[j] == face[i]).map(|j| (i, j)));
        match twice {
            Some((i, j)) => {
                open.push(face[i..j].to_vec());
                open.push(face[j..].iter().chain(&face[..i]).copied().collect());
            }
            None if face.len() >= 3 => done.push(face),
            None => {}
        }
    }
    done
}

/// The faces inside `lobe`, a loop a cell walks round them the other way:
/// those holding one of its sides from the inside, and every face reached
/// from them without crossing it. None when that reaches the ground's open
/// border -- then the loop closes round nothing.
fn enclosed_by(faces: &[Option<Vec<usize>>], lobe: &[usize]) -> Vec<usize> {
    let mut holding: HashMap<(usize, usize), usize> = HashMap::new();
    for (f, face) in faces.iter().enumerate() {
        if let Some(face) = face {
            for i in 0..face.len() {
                holding.insert((face[i], face[(i + 1) % face.len()]), f);
            }
        }
    }
    let walls: HashSet<(usize, usize)> = (0..lobe.len()).map(|i| (lobe[(i + 1) % lobe.len()], lobe[i])).collect();
    let mut inside: Vec<usize> = walls.iter().filter_map(|side| holding.get(side).copied()).collect();
    inside.sort_unstable();
    inside.dedup();
    let mut seen: HashSet<usize> = inside.iter().copied().collect();
    let mut stack = inside.clone();
    while let Some(f) = stack.pop() {
        let face = faces[f].as_ref().unwrap();
        for i in 0..face.len() {
            let (a, b) = (face[i], face[(i + 1) % face.len()]);
            if walls.contains(&(a, b)) {
                continue;
            }
            let Some(&g) = holding.get(&(b, a)) else { return Vec::new() };
            if seen.insert(g) {
                inside.push(g);
                stack.push(g);
            }
        }
    }
    inside
}

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
        // Over a point two sheets cover, the highest: the one a brush pushing
        // up sees. Ground laid flat in plan has one only.
        let mut highest: Option<f64> = None;
        for dx in -1..=1 {
            for dz in -1..=1 {
                for &t in self.buckets.get(&(key.0 + dx, key.1 + dz)).map_or(&[][..], Vec::as_slice) {
                    let [a, b, c] = self.triangles[t];
                    let (p, q, r) = (plan(self.vertices[a]), plan(self.vertices[b]), plan(self.vertices[c]));
                    let area = cross_2d(p, q, r);
                    let (wa, wb, wc) = (cross_2d(q, r, point) / area, cross_2d(r, p, point) / area, cross_2d(p, q, point) / area);
                    let y = |wa: f64, wb: f64, wc: f64| self.vertices[a].y * wa + self.vertices[b].y * wb + self.vertices[c].y * wc;
                    if wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9 {
                        let here = y(wa, wb, wc);
                        highest = Some(highest.map_or(here, |h: f64| h.max(here)));
                        continue;
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
        highest.or(nearest.map(|(_, y)| y))
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

/// How much of `triangles`' area in plan lies over or under another of them:
/// each triangle whose middle another covers, by its area. A bucket grid
/// finds the others near, so it costs next to nothing a stroke -- the union
/// of the triangles it replaced took seconds on a patch of a thousand faces.
fn overlapping_area(vertices: &[Vec3], triangles: &[[usize; 3]]) -> f64 {
    if triangles.is_empty() {
        return 0.0;
    }
    let corners = |t: &[usize; 3]| [plan(vertices[t[0]]), plan(vertices[t[1]]), plan(vertices[t[2]])];
    let side = triangles.iter().map(|t| { let [a, b, c] = corners(t); (b.x - a.x).hypot(b.y - a.y).max((c.x - a.x).hypot(c.y - a.y)) }).sum::<f64>() / triangles.len() as f64;
    let cell = side.max(1e-6);
    let key = |p: Vec2| ((p.x / cell).floor() as i64, (p.y / cell).floor() as i64);
    let mut buckets: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for (index, t) in triangles.iter().enumerate() {
        let [a, b, c] = corners(t);
        let (low, high) = (key(Vec2::new(a.x.min(b.x).min(c.x), a.y.min(b.y).min(c.y))), key(Vec2::new(a.x.max(b.x).max(c.x), a.y.max(b.y).max(c.y))));
        for x in low.0..=high.0 {
            for z in low.1..=high.1 {
                buckets.entry((x, z)).or_default().push(index);
            }
        }
    }
    triangles
        .iter()
        .enumerate()
        .filter_map(|(index, t)| {
            let [a, b, c] = corners(t);
            let area = cross_2d(a, b, c) * 0.5;
            if area.abs() < 1e-12 {
                return None;
            }
            let middle = Vec2::new((a.x + b.x + c.x) / 3.0, (a.y + b.y + c.y) / 3.0);
            let covered = buckets.get(&key(middle)).is_some_and(|near| near.iter().any(|&other| {
                if other == index {
                    return false;
                }
                let [p, q, r] = corners(&triangles[other]);
                let (d1, d2, d3) = (cross_2d(p, q, middle), cross_2d(q, r, middle), cross_2d(r, p, middle));
                (d1 > 0.0 && d2 > 0.0 && d3 > 0.0) || (d1 < 0.0 && d2 < 0.0 && d3 < 0.0)
            }));
            covered.then_some(area.abs())
        })
        .sum()
}

/// The patch's outline in plan: its border loops, the rim counter-clockwise
/// and its holes clockwise -- what the union of its faces in plan is,
/// wherever no sheet of it lies over another, and where one does, the
/// union of these rings by their winding still covers each place once.
/// The union of its triangles one by one took seconds on a patch of a
/// thousand faces, twice a stroke.
fn plan_outline(patch: &Faces, counter_clockwise: bool) -> Vec<Contour> {
    face_border_loops(&patch.faces)
        .into_iter()
        .map(|ring| {
            let mut contour: Contour = ring.iter().map(|&v| [patch.vertices[v].x, patch.vertices[v].z]).collect();
            if !counter_clockwise {
                contour.reverse();
            }
            contour
        })
        .collect()
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

/// The faces of `ground` a layer run on over the table meets: those facing
/// up with no face of it turned down under them -- the ground resting on the
/// table. A ledge overhanging the table, and the ground over it, the layer
/// runs on under: cut out of it, the layer's rim went round the ledge's
/// shadow, met the ledge at its corners in the air, and left two sheets
/// touching there. `counter_clockwise` is the ground's way up in plan.
fn resting(ground: &Faces, counter_clockwise: bool) -> Faces {
    let up = if counter_clockwise { 1.0 } else { -1.0 };
    let area = |face: &Vec<usize>| (0..face.len()).map(|k| cross_2d(Vec2::new(0.0, 0.0), plan(ground.vertices[face[k]]), plan(ground.vertices[face[(k + 1) % face.len()]]))).sum::<f64>() * 0.5 * up;
    let turned_down: Vec<&Vec<usize>> = ground.faces.iter().filter(|face| face.len() >= 3 && area(face) < 0.0).collect();
    let inside = |point: Vec2, face: &Vec<usize>| {
        let mut crossings = false;
        for k in 0..face.len() {
            let (a, b) = (plan(ground.vertices[face[k]]), plan(ground.vertices[face[(k + 1) % face.len()]]));
            if (a.y > point.y) != (b.y > point.y) && point.x < a.x + (point.y - a.y) / (b.y - a.y) * (b.x - a.x) {
                crossings = !crossings;
            }
        }
        crossings
    };
    let faces = ground
        .faces
        .iter()
        .filter(|face| {
            if face.len() < 3 || area(face) <= 0.0 {
                return false;
            }
            let centre = face.iter().fold(Vec3::default(), |sum, &v| sum + ground.vertices[v]) * (1.0 / face.len() as f64);
            !turned_down.iter().any(|down| down.iter().map(|&v| ground.vertices[v].y).fold(f64::INFINITY, f64::min) < centre.y && inside(plan(centre), down))
        })
        .cloned()
        .collect();
    Faces { vertices: ground.vertices.clone(), faces }
}

/// The plan's way: the patch, and the bare table a layer reaches past it,
/// laid in plan and lifted.
fn layer_in_plan(patch: &Faces, triangles: &[[usize; 3]], patch_counter_clockwise: bool, context: &Faces, neighbours: &Faces, edit: &LayerEdit, folds: bool) -> Result<RegeneratedSurface, String> {
    let face_side = face_side_for(edit);
    // With no faces to say, the ground round them does; with none at all, the
    // tabletop's own winding -- counter-clockwise in plan.
    let counter_clockwise = if !triangles.is_empty() {
        patch_counter_clockwise
    } else {
        let context_triangles = triangles_of(&context.vertices, &context.faces);
        context_triangles.iter().map(|&[a, b, c]| cross_2d(plan(context.vertices[a]), plan(context.vertices[b]), plan(context.vertices[c]))).sum::<f64>() >= 0.0
    };

    // The patch's own rings in plan: its rim and the holes structures make in
    // it -- read off its faces, never off their triangles: a face folded on
    // itself clips to nothing, and its place would read as a hole.
    let loops = face_border_loops(&patch.faces);
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

    let locator = PlanLocator::new(&patch.vertices, triangles, counter_clockwise, face_side.max(1.0));
    let beds: Vec<BedIndex> = edit.beds.iter().map(BedIndex::new).collect();
    let sheets = Sheets::new(&[patch, context], face_side);
    // Past the patch, a layer laid rests on the table wherever no ground or
    // structure already stands.
    let raised: Vec<&Shape> = edit.shapes.iter().filter(|s| s.effect == Effect::Raise).collect();
    // One boolean, never two: the patch and the reach together, less what
    // else stands -- a second boolean over the first's rounded corners
    // leaves slivers along the patch's rim.
    let outline = plan_outline(patch, counter_clockwise);
    let own_area: f64 = outline.iter().map(|ring| ring_area(&ring.iter().map(|p| Vec2::new(p[0], p[1])).collect::<Vec<_>>())).sum();
    let own: Vec<Vec<Contour>> = if outline.is_empty() { Vec::new() } else { vec![outline] };
    let joined: Vec<Vec<Contour>> = match edit.table {
        Some(_) if !raised.is_empty() => {
            let mut subject = own.clone();
            subject.extend(raised.iter().flat_map(|shape| reach_contours(shape)));
            // Only what stands beside the patch: ground over or under it in
            // plan -- a bridge's deck over the hill it rises from -- is another
            // layer, and taken away it would cut the patch itself.
            let beside = |faces: &Faces| -> Faces {
                let over_patch = |face: &Vec<usize>| {
                    let centre = face.iter().fold(Vec3::default(), |sum, &v| sum + faces.vertices[v]) * (1.0 / face.len() as f64);
                    locator.height(plan(centre), 0.0).is_some()
                };
                Faces { vertices: faces.vertices.clone(), faces: faces.faces.iter().filter(|face| face.len() >= 3 && !over_patch(face)).cloned().collect() }
            };
            let others: Vec<Vec<Contour>> = [resting(&beside(context), counter_clockwise), beside(neighbours)].iter().flat_map(plan_polygons).collect();
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
    // A patch folding in plan whose rim crosses itself -- the fold at its
    // edge -- has no inside to lay a grid in: laid anyway, the cells along
    // the crossing came out turned against the ground beside them.
    if folds && rings_cross(&boundary.iter().chain(&holes).cloned().collect::<Vec<_>>()) {
        return Err("a borda da terra a refazer se cruza vista pelo pincel".to_string());
    }

    let relax = RelaxOptions { iterations: RelaxOptions::standard().iterations, strength: RELAX_STRENGTH, pin_boundary: false, pinned_targets: Default::default() };
    let rings: Vec<Vec<ConstraintPoint>> = boundary.iter().chain(&holes).cloned().collect();
    let boundary_count = boundary.len();
    let grid = ground_grid(boundary, holes, face_side, edit.seed, &GroundRefinement::default(), &relax)?;

    // Lifted: to the old surface, or the table where it is bare, and moved.
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
        let height_at = |at: Vec2| locator.height(at, face_side * 0.5);
        vertices.push(bedded(moved(Vec3::new(point.x, base, point.y), &edit.shapes, edit.blend, &vertical, Some(&height_at)), &beds, &sheets));
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
    // Never through a structure between the corners resting under it.
    let mut movable: Vec<bool> = origin.iter().map(Option::is_none).collect();
    for landing in &landed {
        movable[landing.vertex] = false;
    }
    settled_under(&mut vertices, &grid.mesh.faces, &movable, &beds, &sheets);
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
    let rim: HashSet<usize> = face_border_loops(&patch.faces).into_iter().flatten().collect();
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
                .enumerate()
                .map(|(k, &at)| match (shape.up.get(k), surface.closest(at)) {
                    // The brush's own way where it says one.
                    (Some(&up), _) if shape.up.len() == shape.path.len() => up,
                    (_, Some((_, t))) => (normal(&support, t) * out).normalized(),
                    _ => Vec3::new(0.0, 1.0, 0.0),
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
    let beds: Vec<BedIndex> = edit.beds.iter().map(BedIndex::new).collect();
    let sheets = Sheets::new(&[patch, context], face_side);
    let displaced: Vec<Vec3> = support.iter().enumerate().map(|(v, &p)| if rim.contains(&v) { p } else { bedded(moved(p, &edit.shapes, edit.blend, &across, None), &beds, &sheets) }).collect();

    // The holes in the patch -- structures standing in it -- gone round,
    // never capped: the ground goes round them as they are.
    // Pieces of the patch apart from one another -- two hills one stroke
    // joins -- are each a disk of their own, laid on their own.
    let mut laid = RegeneratedSurface { vertices: Vec::new(), faces: Vec::new(), origin: Vec::new(), landed: Vec::new(), refinement_complete: true };
    for piece in pieces_of(&fine) {
        let one = lay_piece(&displaced, &piece, face_side, edit.seed)?;
        let offset = laid.vertices.len();
        laid.vertices.extend(one.vertices);
        laid.faces.extend(one.faces.into_iter().map(|face| face.into_iter().map(|v| v + offset).collect()));
        laid.origin.extend(one.origin);
        laid.landed.extend(one.landed.into_iter().map(|l| Landing { vertex: l.vertex + offset, ..l }));
        laid.refinement_complete &= one.refinement_complete;
    }
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

/// `triangles` split into the pieces whose triangles share sides.
fn pieces_of(triangles: &[[usize; 3]]) -> Vec<Vec<[usize; 3]>> {
    let mut by_side: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    for (t, &[a, b, c]) in triangles.iter().enumerate() {
        for (p, q) in [(a, b), (b, c), (c, a)] {
            by_side.entry((p.min(q), p.max(q))).or_default().push(t);
        }
    }
    let mut piece = vec![usize::MAX; triangles.len()];
    let mut pieces: Vec<Vec<[usize; 3]>> = Vec::new();
    for start in 0..triangles.len() {
        if piece[start] != usize::MAX {
            continue;
        }
        let id = pieces.len();
        piece[start] = id;
        let mut stack = vec![start];
        let mut members = Vec::new();
        while let Some(t) = stack.pop() {
            members.push(triangles[t]);
            let [a, b, c] = triangles[t];
            for (p, q) in [(a, b), (b, c), (c, a)] {
                for &u in &by_side[&(p.min(q), p.max(q))] {
                    if piece[u] == usize::MAX {
                        piece[u] = id;
                        stack.push(u);
                    }
                }
            }
        }
        pieces.push(members);
    }
    pieces
}

/// One piece of a patch, its corners already moved (`displaced`), laid
/// again on its own chart: its holes -- structures standing in it -- gone
/// round, never capped.
fn lay_piece(displaced: &[Vec3], fine: &[[usize; 3]], face_side: f64, seed: u32) -> Result<RegeneratedSurface, String> {
    let loops = border_loops(fine);
    let perimeter = |ring: &Vec<usize>| (0..ring.len()).map(|k| displaced[ring[k]].distance(displaced[ring[(k + 1) % ring.len()]])).sum::<f64>();
    let outer = (0..loops.len()).max_by(|&a, &b| perimeter(&loops[a]).total_cmp(&perimeter(&loops[b]))).ok_or("a terra a refazer não tem borda")?;
    // A loop meeting the rim at a corner and wound as the rim is -- the rim
    // touching itself -- is the rim, not a hole: taken out as one, the
    // corners of the rim round it went. A hole meeting it, wound the other
    // way, stays a hole.
    let facing = fine.iter().fold(Vec3::default(), |sum, &[a, b, c]| sum + (displaced[b] - displaced[a]).cross(displaced[c] - displaced[a]));
    let winding = |ring: &Vec<usize>| (0..ring.len()).fold(Vec3::default(), |sum, k| sum + displaced[ring[k]].cross(displaced[ring[(k + 1) % ring.len()]])).dot(facing);
    let rim_way = winding(&loops[outer]).signum();
    let mut rim_loops: HashSet<usize> = HashSet::from([outer]);
    loop {
        let on_rim: HashSet<usize> = rim_loops.iter().flat_map(|&i| loops[i].iter().copied()).collect();
        let more: Vec<usize> = (0..loops.len()).filter(|i| !rim_loops.contains(i) && winding(&loops[*i]).signum() == rim_way && loops[*i].iter().any(|v| on_rim.contains(v))).collect();
        if more.is_empty() {
            break;
        }
        rim_loops.extend(more);
    }
    let holes: Vec<Vec<GivenPoint>> = loops
        .iter()
        .enumerate()
        .filter(|&(i, _)| !rim_loops.contains(&i))
        .map(|(_, ring)| ring.iter().map(|&v| GivenPoint { position: displaced[v], id: v }).collect())
        .collect();
    regenerate_surface(
        &Faces { vertices: displaced.to_vec(), faces: fine.iter().map(|t| t.to_vec()).collect() },
        &Regeneration { holes, face_side, seed, relax_strength: RELAX_STRENGTH },
    )
}
