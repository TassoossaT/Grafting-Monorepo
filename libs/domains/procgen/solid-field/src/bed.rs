//! The ground laid to rest under a structure: a road, a floor, a ramp.
//!
//! The ground is never cut where a structure stands on it. It is moved: up to
//! just under the structure's faces where it lay a little under them, down to
//! it where it rose through them, and eased back to where it was over a
//! shoulder round them -- a cutting through a hill, an embankment over a dip.
//! Where the structure stands far off the ground -- a bridge over a valley, a
//! floor over a cliff -- the ground is left as it is. One surface either way:
//! no hole, no side shared with the structure.

use std::collections::HashMap;

use crate::edit::Faces;
use crate::vector::Vec3;

/// What one structure asks of the ground under it.
#[derive(Debug, Clone)]
pub struct Bed {
    /// The structure's faces the ground rests under.
    pub faces: Faces,
    /// How far under the faces the ground comes to rest.
    pub sink: f64,
    /// How far under its rest the ground may lie and still be brought up to it.
    pub below: f64,
    /// How far over its rest the ground may rise and still be brought down to it.
    pub above: f64,
    /// How far past the faces' rim the ground still lies at rest, before the shoulder.
    pub margin: f64,
    /// The shoulder's width for every metre the ground is moved there.
    pub slope: f64,
    /// The narrowest a shoulder is.
    pub shoulder: f64,
}

/// `face` cut into triangles in plan, each ear the one closing the shortest
/// diagonal: a road is one long face, and an ear clipped anywhere else lays a
/// triangle from one end of it to the other, whose middle is metres off the
/// road's own height. Fanned where the face does not wind simply in plan.
pub(crate) fn short_ears(vertices: &[Vec3], face: &[usize]) -> Vec<[usize; 3]> {
    if face.len() < 3 {
        return Vec::new();
    }
    let area: f64 = (0..face.len())
        .map(|i| {
            let (p, q) = (vertices[face[i]], vertices[face[(i + 1) % face.len()]]);
            p.x * q.z - q.x * p.z
        })
        .sum();
    let mut left: Vec<usize> = if area >= 0.0 {
        face.to_vec()
    } else {
        face.iter().rev().copied().collect()
    };
    let mut out = Vec::with_capacity(face.len() - 2);
    while left.len() > 3 {
        let n = left.len();
        let ear = (0..n)
            .filter(|&k| {
                let (a, b, c) = (
                    vertices[left[(k + n - 1) % n]],
                    vertices[left[k]],
                    vertices[left[(k + 1) % n]],
                );
                cross(a, b, c) > 1e-12
                    && left.iter().enumerate().all(|(j, &q)| {
                        if j == (k + n - 1) % n || j == k || j == (k + 1) % n {
                            return true;
                        }
                        let p = vertices[q];
                        !(cross(a, b, p) >= 0.0 && cross(b, c, p) >= 0.0 && cross(c, a, p) >= 0.0)
                    })
            })
            .min_by(|&i, &j| {
                let diagonal = |k: usize| {
                    let (a, c) = (vertices[left[(k + n - 1) % n]], vertices[left[(k + 1) % n]]);
                    (a.x - c.x).hypot(a.z - c.z)
                };
                diagonal(i).total_cmp(&diagonal(j))
            });
        let Some(k) = ear else {
            out.extend((1..left.len() - 1).map(|k| [left[0], left[k], left[k + 1]]));
            return out;
        };
        out.push([left[(k + n - 1) % n], left[k], left[(k + 1) % n]]);
        left.remove(k);
    }
    out.push([left[0], left[1], left[2]]);
    out
}

/// A bed ready to be asked: its faces bucketed in plan, its rim in plan.
pub(crate) struct BedIndex<'a> {
    bed: &'a Bed,
    triangles: Vec<[usize; 3]>,
    rim: Vec<(usize, usize)>,
    cell: f64,
    buckets: HashMap<(i64, i64), Vec<usize>>,
}

fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// One as far as `reach`, easing to nothing a third past it: the ground's
/// pull fades off with how far it is moved, never stops dead -- and within
/// the reach it is always all the way.
fn fading(moved: f64, reach: f64) -> f64 {
    if reach <= 0.0 {
        return 0.0;
    }
    1.0 - smoothstep((moved - reach) / (reach / 3.0))
}

/// The plan's cross product of `b - a` and `c - a`.
fn cross(a: Vec3, b: Vec3, c: Vec3) -> f64 {
    (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)
}

impl<'a> BedIndex<'a> {
    pub(crate) fn new(bed: &'a Bed) -> Self {
        let vertices = &bed.faces.vertices;
        // Upright faces -- a wall's -- stand on a line: nothing to rest under.
        let triangles: Vec<[usize; 3]> = bed
            .faces
            .faces
            .iter()
            .flat_map(|face| short_ears(vertices, face))
            .filter(|&[a, b, c]| {
                let (p, q, r) = (vertices[a], vertices[b], vertices[c]);
                let full = (q - p).cross(r - p).length();
                full > 1e-12 && cross(p, q, r).abs() > 0.2 * full
            })
            .collect();
        let mut uses: HashMap<(usize, usize), usize> = HashMap::new();
        for &[a, b, c] in &triangles {
            for (p, q) in [(a, b), (b, c), (c, a)] {
                *uses.entry((p.min(q), p.max(q))).or_default() += 1;
            }
        }
        let rim: Vec<(usize, usize)> = uses
            .into_iter()
            .filter(|&(_, n)| n == 1)
            .map(|(edge, _)| edge)
            .collect();
        let longest = triangles
            .iter()
            .flat_map(|&[a, b, c]| [(a, b), (b, c), (c, a)])
            .map(|(p, q)| (vertices[p].x - vertices[q].x).hypot(vertices[p].z - vertices[q].z))
            .fold(0.0_f64, f64::max);
        let cell = longest.max(1.0);
        let mut buckets: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (t, &[a, b, c]) in triangles.iter().enumerate() {
            let (p, q, r) = (vertices[a], vertices[b], vertices[c]);
            let (x0, x1) = (
                (p.x.min(q.x).min(r.x) / cell).floor() as i64,
                (p.x.max(q.x).max(r.x) / cell).floor() as i64,
            );
            let (z0, z1) = (
                (p.z.min(q.z).min(r.z) / cell).floor() as i64,
                (p.z.max(q.z).max(r.z) / cell).floor() as i64,
            );
            for x in x0..=x1 {
                for z in z0..=z1 {
                    buckets.entry((x, z)).or_default().push(t);
                }
            }
        }
        Self {
            bed,
            triangles,
            rim,
            cell,
            buckets,
        }
    }

    /// How far the shoulder reaches past the rim at most.
    fn reach(&self) -> f64 {
        let bed = self.bed;
        bed.margin
            + bed
                .shoulder
                .max(bed.below.max(bed.above) * 4.0 / 3.0 * bed.slope)
    }

    /// The heights of the faces over or under `point` in plan.
    fn heights_at(&self, point: Vec3) -> Vec<f64> {
        let vertices = &self.bed.faces.vertices;
        let key = (
            (point.x / self.cell).floor() as i64,
            (point.z / self.cell).floor() as i64,
        );
        let mut heights = Vec::new();
        for &t in self.buckets.get(&key).map_or(&[][..], Vec::as_slice) {
            let [a, b, c] = self.triangles[t];
            let (p, q, r) = (vertices[a], vertices[b], vertices[c]);
            let area = cross(p, q, r);
            let (u, v, w) = (
                cross(point, q, r) / area,
                cross(p, point, r) / area,
                cross(p, q, point) / area,
            );
            let slack = -1e-9;
            if u >= slack && v >= slack && w >= slack {
                heights.push(p.y * u + q.y * v + r.y * w);
            }
        }
        heights
    }

    /// The nearest point of the rim in plan: how far off it is, and its height.
    fn nearest_rim(&self, point: Vec3) -> Option<(f64, Vec3)> {
        let vertices = &self.bed.faces.vertices;
        let mut best: Option<(f64, Vec3)> = None;
        for &(a, b) in &self.rim {
            let (p, q) = (vertices[a], vertices[b]);
            let (dx, dz) = (q.x - p.x, q.z - p.z);
            let length_squared = dx * dx + dz * dz;
            let t = if length_squared > 0.0 {
                (((point.x - p.x) * dx + (point.z - p.z) * dz) / length_squared).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let d = (point.x - p.x - dx * t).hypot(point.z - p.z - dz * t);
            if best.is_none_or(|(nearest, _)| d < nearest) {
                best = Some((d, p.lerp(q, t)));
            }
        }
        best
    }

    /// How far `point` is moved up (or down, negative) to come to rest, how
    /// much of that it takes, and -- on the shoulder -- the point of the rim
    /// it eases off from: `None` where the bed is no concern of it.
    fn pull(&self, point: Vec3) -> Option<(f64, f64, Option<Vec3>)> {
        let bed = self.bed;
        let fade = |d: f64| {
            if d >= 0.0 {
                fading(d, bed.below)
            } else {
                fading(-d, bed.above)
            }
        };
        let over = self.heights_at(point);
        if !over.is_empty() {
            // Under the faces: of every face over or under it, the one it
            // rests under -- a deck's span over its own ramp is another.
            return over
                .into_iter()
                .map(|h| {
                    let d = h - bed.sink - point.y;
                    (d, fade(d), None)
                })
                .max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.abs().total_cmp(&a.0.abs())));
        }
        let (off, rim) = self.nearest_rim(point)?;
        if off > self.reach() {
            return None;
        }
        let d = rim.y - bed.sink - point.y;
        let width = bed.shoulder.max(d.abs() * bed.slope);
        let weight = (1.0 - smoothstep((off - bed.margin).max(0.0) / width)) * fade(d);
        Some((d, weight, Some(rim)))
    }
}

impl BedIndex<'_> {
    /// The height the ground at `point` rests under, where a face of the bed
    /// over it is near enough to take it: the one it rests under, as
    /// [`BedIndex::pull`] picks it.
    fn rest_over(&self, point: Vec3) -> Option<f64> {
        let bed = self.bed;
        self.heights_at(point)
            .into_iter()
            .map(|h| {
                let d = h - bed.sink - point.y;
                (
                    h - bed.sink,
                    if d >= 0.0 {
                        fading(d, bed.below)
                    } else {
                        fading(-d, bed.above)
                    },
                )
            })
            .filter(|&(_, fade)| fade > 0.5)
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(rest, _)| rest)
    }
}

/// How many rounds the faces are settled under the beds for, at most.
const SETTLE_ROUNDS: usize = 4;
/// How far a corner is ever lowered to settle a face: a face held up by a
/// corner nobody may move -- the ground's own edge beside a floor -- is left
/// rising a little through it, never dug a pit beside it.
const SETTLE_DEEPEST: f64 = 0.3;

/// The faces' corners lowered wherever a face rises through a bed between
/// them: a road warped finer than the ground's cells -- a crossfall twisting
/// at a junction -- dips under the line between two corners resting under it.
/// Read at the middle of every side and of the face, against the lowest bed
/// over each; only the corners `movable` says may move.
pub(crate) fn settled_under(
    vertices: &mut [Vec3],
    faces: &[Vec<usize>],
    movable: &[bool],
    beds: &[BedIndex],
    sheets: &Sheets,
) {
    if beds.is_empty() {
        return;
    }
    let laid: Vec<f64> = vertices.iter().map(|v| v.y).collect();
    // Only a corner at rest under a bed -- under it or along its margin -- is
    // lowered: the ground out of its reach stays where it was laid.
    let at_rest: Vec<bool> = vertices
        .iter()
        .zip(movable)
        .map(|(&v, &free)| {
            free && beds
                .iter()
                .any(|bed| bed.pull(v).is_some_and(|(_, weight, _)| weight > 0.99))
        })
        .collect();
    for _ in 0..SETTLE_ROUNDS {
        let mut lowered = false;
        for face in faces {
            let corners: Vec<Vec3> = face.iter().map(|&v| vertices[v]).collect();
            // Each sample with the share of it the corners at rest carry: a
            // side's middle by its two ends, the face's by all of them. Only
            // a sample all at rest says anything: one held up by a corner out
            // of reach -- the ground's own edge beside a floor -- is that
            // corner's, and lowering the rest would dig a pit beside it.
            let free: Vec<f64> = face
                .iter()
                .map(|&v| if at_rest[v] { 1.0 } else { 0.0 })
                .collect();
            let n = corners.len() as f64;
            let middle = corners.iter().fold(Vec3::default(), |sum, &p| sum + p) * (1.0 / n);
            let middle_free = free.iter().sum::<f64>() / n;
            let samples = (0..corners.len())
                .map(|k| {
                    (
                        corners[k].lerp(corners[(k + 1) % corners.len()], 0.5),
                        (free[k] + free[(k + 1) % corners.len()]) * 0.5,
                    )
                })
                .chain(
                    (0..corners.len())
                        .map(|k| (corners[k].lerp(middle, 0.5), (free[k] + middle_free) * 0.5)),
                )
                .chain(std::iter::once((middle, middle_free)));
            // How far the movable corners go down for every sample to lie under its bed.
            let excess = samples
                .filter(|&(_, share)| share > 1.0 - 1e-9)
                .filter_map(|(at, share)| {
                    let rest = beds
                        .iter()
                        .filter_map(|bed| bed.rest_over(at))
                        .filter(|&rest| !sheets.between(at, at.y, rest, None))
                        .fold(None, |low: Option<f64>, rest| {
                            Some(low.map_or(rest, |l| l.min(rest)))
                        })?;
                    Some((at.y - rest) / share)
                })
                .fold(0.0_f64, f64::max);
            if excess <= 1e-3 {
                continue;
            }
            for &v in face {
                let lowest = laid[v] - SETTLE_DEEPEST;
                if at_rest[v] && vertices[v].y > lowest + 1e-9 {
                    vertices[v].y = (vertices[v].y - excess).max(lowest);
                    lowered = true;
                }
            }
        }
        if !lowered {
            break;
        }
    }
}

/// How far off both heights another sheet of ground has to lie to stand between them.
const BETWEEN_SLACK: f64 = 0.1;

/// The ground as it stood, in plan: what lies between a point of it and the
/// structure it would be brought to -- a tunnel's ceiling between the hill
/// over it and a floor laid inside, a bridge's deck between a road over it
/// and the valley under it.
pub(crate) struct Sheets {
    vertices: Vec<Vec3>,
    triangles: Vec<[usize; 3]>,
    /// The sign of a triangle's area in plan where it faces up: the ground's
    /// own, which mostly faces up.
    up: f64,
    cell: f64,
    buckets: HashMap<(i64, i64), Vec<usize>>,
}

impl Sheets {
    pub(crate) fn new(faces: &[&Faces], cell: f64) -> Self {
        let mut vertices = Vec::new();
        let mut triangles = Vec::new();
        for faces in faces {
            let offset = vertices.len();
            vertices.extend_from_slice(&faces.vertices);
            for face in faces.faces.iter().filter(|face| face.len() >= 3) {
                triangles.extend(
                    (1..face.len() - 1)
                        .map(|k| [face[0] + offset, face[k] + offset, face[k + 1] + offset]),
                );
            }
        }
        let cell = cell.max(0.5);
        let up = if triangles
            .iter()
            .map(|&[a, b, c]| cross(vertices[a], vertices[b], vertices[c]))
            .sum::<f64>()
            >= 0.0
        {
            1.0
        } else {
            -1.0
        };
        let mut buckets: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (t, &[a, b, c]) in triangles.iter().enumerate() {
            let (p, q, r) = (vertices[a], vertices[b], vertices[c]);
            let (x0, x1) = (
                (p.x.min(q.x).min(r.x) / cell).floor() as i64,
                (p.x.max(q.x).max(r.x) / cell).floor() as i64,
            );
            let (z0, z1) = (
                (p.z.min(q.z).min(r.z) / cell).floor() as i64,
                (p.z.max(q.z).max(r.z) / cell).floor() as i64,
            );
            for x in x0..=x1 {
                for z in z0..=z1 {
                    buckets.entry((x, z)).or_default().push(t);
                }
            }
        }
        Self {
            vertices,
            triangles,
            up,
            cell,
            buckets,
        }
    }

    /// Whether a sheet of the ground lies strictly between heights `a` and
    /// `b` over `point` -- with `facing`, only one facing that way: `1` up,
    /// `-1` down.
    fn between(&self, point: Vec3, a: f64, b: f64, facing: Option<f64>) -> bool {
        let (low, high) = (a.min(b) + BETWEEN_SLACK, a.max(b) - BETWEEN_SLACK);
        if low >= high {
            return false;
        }
        let key = (
            (point.x / self.cell).floor() as i64,
            (point.z / self.cell).floor() as i64,
        );
        self.buckets.get(&key).is_some_and(|list| {
            list.iter().any(|&t| {
                let [a, b, c] = self.triangles[t];
                let (p, q, r) = (self.vertices[a], self.vertices[b], self.vertices[c]);
                let area = cross(p, q, r);
                if area.abs() < 1e-12
                    || facing.is_some_and(|facing| (area * self.up).signum() != facing)
                {
                    return false;
                }
                let (u, v, w) = (
                    cross(point, q, r) / area,
                    cross(p, point, r) / area,
                    cross(p, q, point) / area,
                );
                if u < -1e-9 || v < -1e-9 || w < -1e-9 {
                    return false;
                }
                let y = p.y * u + q.y * v + r.y * w;
                y > low && y < high
            })
        })
    }
}

/// `point` brought to rest under every bed that reaches it. Where beds want
/// it at different heights -- a road passing under another -- the lowest
/// has its way: each is eased in from the highest down, so the road below
/// gets its cutting and the one over it stands across it as a bridge.
/// Never through another sheet of the ground (`sheets`): a structure under a
/// tunnel's ceiling never pulls the hill over it down.
pub(crate) fn bedded(point: Vec3, beds: &[BedIndex], sheets: &Sheets) -> Vec3 {
    let mut pulls: Vec<(f64, f64)> = beds
        .iter()
        .filter_map(|bed| bed.pull(point))
        .filter(|&(d, weight, rim)| {
            let target = point.y + d;
            // On the shoulder, never where a sheet facing down -- a tunnel's
            // ceiling, a deck's underside -- parts the structure's rim from
            // it: a floor in a tunnel never cuts the hill beside it down. The
            // slope the shoulder runs along faces up, and parts nothing.
            weight > 0.0
                && !sheets.between(point, point.y, target, None)
                && rim.is_none_or(|rim| {
                    !sheets.between(Vec3::new(rim.x, target, rim.z), target, point.y, Some(-1.0))
                })
        })
        .map(|(d, weight, _)| (point.y + d, weight))
        .collect();
    if pulls.is_empty() {
        return point;
    }
    pulls.sort_by(|a, b| b.0.total_cmp(&a.0));
    let y = pulls.iter().fold(point.y, |y, &(target, weight)| {
        y + (target - y) * weight.min(1.0)
    });
    Vec3::new(point.x, y, point.z)
}
