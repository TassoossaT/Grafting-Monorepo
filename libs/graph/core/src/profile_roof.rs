//! Roofs raised over any footprint by its weighted straight skeleton.
//!
//! Every side of the footprint -- its outline and the rims of its holes --
//! is a leaf that rises inward at its own slope, or a gable that does not
//! rise at all and stands upright. The wavefront each side sweeps inward, at
//! a speed of one over its slope, meets the others along the roof's hips,
//! valleys and ridges; the time it reaches a point is the roof's height
//! there. Any simple outline is covered this way, holes included, and two
//! roofs fused are one footprint.
//!
//! A dormer is a small block raised on one leaf: its eaves stand above the
//! leaf, so where its roof is higher the leaf is opened, and upright faces
//! close the gap between the two -- its front and its cheeks.
//!
//! The roof is only the volume a covering is placed on: how far its eaves
//! reach out and whether its leaves curve are the covering's business.
use crate::planar::{PlanarBoolean, planar_boolean};
use crate::profile_cap_patch::CapEdge;

/// The plan a roof covers: one outline and the holes through it.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RoofFootprint {
    /// Outline corners in XZ, in either winding.
    pub outer: Vec<[f64; 2]>,
    /// Holes' corners in XZ, in either winding.
    #[cfg_attr(feature = "curve-serde", serde(default))]
    pub holes: Vec<Vec<[f64; 2]>>,
}
/// A horizontal platform removes only roof surface above its walking plane.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RoofPlatformCut {
    /// Platform boundary and any internal voids in plan.
    pub footprint: RoofFootprint,
    /// Height of the platform's walking surface.
    pub elevation: f64,
}

/// A dormer raised on one leaf: a small roof of its own, over a front wall.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RoofDormer {
    /// The footprint side whose leaf carries it; it must be pitched.
    pub side: usize,
    /// Where its middle stands along that side, as a fraction of it.
    pub along: f64,
    /// How far in from that side its front stands.
    pub setback: f64,
    /// Its width along the side.
    pub width: f64,
    /// How high its front wall rises above the leaf.
    pub front: f64,
    /// Relative steepness of its front, right, back and left sides; zero
    /// makes a side a gable. Two waters pitch the right and left.
    pub slopes: [f64; 4],
    /// Its slopes are rises per unit run, its own, not shares of the
    /// roof's: a roof made steeper or flatter leaves it as it stands.
    #[cfg_attr(feature = "curve-serde", serde(default))]
    pub absolute: bool,
    /// Its front wall stops at its eaves, a plain upright rectangle; the
    /// gable over it is a face of its own, side [`GABLE_OVER_FRONT`].
    #[cfg_attr(feature = "curve-serde", serde(default, rename = "gableApart"))]
    pub gable_apart: bool,
}

/// The side a dormer's gable is given when it stands apart from its front wall.
pub const GABLE_OVER_FRONT: usize = 5;

/// A whole roof: its footprint, how each side rises, and its dormers.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RoofRequest {
    /// Elevation of every eave.
    pub elevation: f64,
    /// Rise of the roof's highest point above the eaves.
    pub height: f64,
    /// The plans it covers -- one, or several joined at a corner.
    pub footprints: Vec<RoofFootprint>,
    /// Relative steepness of every side -- footprint by footprint, its
    /// outline's then each hole's, side `i` running from corner `i` to
    /// corner `i + 1`; zero makes a gable.
    pub slopes: Vec<f64>,
    /// Dormers raised on its leaves.
    #[cfg_attr(feature = "curve-serde", serde(default))]
    pub dormers: Vec<RoofDormer>,
    /// Areas removed from the finished leaves, without changing the skeleton.
    #[cfg_attr(feature = "curve-serde", serde(default))]
    pub cutouts: Vec<RoofFootprint>,
    /// Horizontal platforms that trim higher roof faces while retaining lower slopes.
    #[cfg_attr(feature = "curve-serde", serde(default))]
    pub platform_cuts: Vec<RoofPlatformCut>,
    /// Smaller roofs joined into this roof's visible envelope.
    #[cfg_attr(feature = "curve-serde", serde(default))]
    pub subroofs: Vec<RoofRequest>,
}

/// One logical roof face over shared indexed edges.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RoofFace {
    /// The footprint side it rises from -- one past the last side for a flat
    /// top, where only gables were left to close it; for a dormer's face, the
    /// dormer's own side -- front, right, back, left -- or four where it
    /// meets its leaf.
    pub side: usize,
    /// The dormer it belongs to, if any.
    pub dormer: Option<usize>,
    /// Which directly owned subroof made this face, if any.
    #[cfg_attr(feature = "curve-serde", serde(default))]
    pub subroof: Option<usize>,
    /// Whether this is an upright face: under a gable, or a dormer's front
    /// and cheeks.
    pub upright: bool,
    /// `(edge index, reversed)` uses of the outer loop.
    pub boundary: Vec<(usize, bool)>,
    /// Inner loops, where a dormer climbs through this face.
    pub holes: Vec<Vec<(usize, bool)>>,
}

/// Transient roof description ready for a caller to assign graph identities.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RoofPatch {
    /// Unique XYZ nodes.
    pub nodes: Vec<[f64; 3]>,
    /// Shared straight edges.
    pub edges: Vec<CapEdge>,
    /// Leaves and upright faces.
    pub faces: Vec<RoofFace>,
    /// Transient XYZ segment endpoints of every edge, for a preview.
    pub preview: Vec<[f64; 6]>,
}

type Point = [f64; 2];

fn dot(a: Point, b: Point) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1]]
}

fn area(ring: &[Point]) -> f64 {
    (0..ring.len())
        .map(|i| {
            let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
            a[0] * b[1] - b[0] * a[1]
        })
        .sum::<f64>()
        * 0.5
}

// ---- The skeleton ----

/// One footprint side as its wavefront: the line `normal . x = line + speed * t`.
#[derive(Clone, Copy)]
struct Front {
    a: Point,
    b: Point,
    normal: Point,
    direction: Point,
    line: f64,
    speed: f64,
    /// The side as the caller numbered it.
    side: usize,
    /// Nodes at its two ends.
    nodes: [usize; 2],
}

/// A corner of the wavefront, between the fronts `left` (arriving) and `right` (leaving).
#[derive(Clone, Copy)]
struct Corner {
    origin: Point,
    since: f64,
    velocity: Point,
    left: usize,
    right: usize,
    node: usize,
    reflex: bool,
}

impl Corner {
    fn at(&self, t: f64) -> Point {
        [
            self.origin[0] + self.velocity[0] * (t - self.since),
            self.origin[1] + self.velocity[1] * (t - self.since),
        ]
    }
}

/** The front a flat top stands for, where only gables were left to close a pocket. */
const FLAT_TOP: usize = usize::MAX;

struct Skeleton {
    /// Flat tops, by their corners' nodes.
    tops: Vec<Vec<usize>>,
    fronts: Vec<Front>,
    /// Plan position and time of every node.
    nodes: Vec<(Point, f64)>,
    /// Skeleton arcs between nodes, with the two fronts they separate.
    arcs: Vec<(usize, usize, usize, usize)>,
}

impl Skeleton {
    fn corner(&self, at: Point, since: f64, left: usize, right: usize, node: usize) -> Corner {
        let (l, r) = (self.fronts[left], self.fronts[right]);
        let det = l.normal[0] * r.normal[1] - l.normal[1] * r.normal[0];
        let velocity = if det.abs() > 1e-9 {
            [
                (l.speed * r.normal[1] - r.speed * l.normal[1]) / det,
                (l.normal[0] * r.speed - r.normal[0] * l.speed) / det,
            ]
        } else if dot(l.normal, r.normal) > 0.0 {
            // One line running on: the corner moves with it.
            let speed = (l.speed + r.speed) * 0.5;
            [l.normal[0] * speed, l.normal[1] * speed]
        } else {
            // Opposite fronts meet here: nothing moves until they are gone.
            [0.0, 0.0]
        };
        let turn = l.direction[0] * r.direction[1] - l.direction[1] * r.direction[0];
        Corner {
            origin: at,
            since,
            velocity,
            left,
            right,
            node,
            reflex: turn < -1e-9,
        }
    }

    fn node(&mut self, at: Point, t: f64) -> usize {
        self.nodes.push((at, t));
        self.nodes.len() - 1
    }

    /// Ends a corner's path at `t`, joining its node to where it stands then.
    fn end(&mut self, corner: &Corner, t: f64) -> usize {
        let at = corner.at(t);
        let (start, _) = self.nodes[corner.node];
        if (at[0] - start[0]).hypot(at[1] - start[1]) < 1e-9 {
            return corner.node;
        }
        let node = self.node(at, t);
        self.arcs
            .push((corner.node, node, corner.left, corner.right));
        node
    }
}

enum Event {
    /// The front between corners `i` and `i + 1` of wavefront `lav` shrinks away.
    Edge { lav: usize, i: usize },
    /// Reflex corner `i` of wavefront `lav` runs into the front between corners
    /// `j` and `j + 1` of wavefront `other`.
    Split {
        lav: usize,
        i: usize,
        other: usize,
        j: usize,
    },
}

/// Why a skeleton gave up on events tied at one point and instant.
const TIED: &str = "the roof skeleton did not close";

/// The skeleton of `rings`, its ties broken: where events meet at one point
/// and instant and cannot be resolved in order, the slopes are nudged by a
/// part in a million -- far below where the weld tells corners apart.
fn skeleton_untied(
    rings: &[Vec<Point>],
    speeds: &[f64],
    sides: &[usize],
) -> Result<Skeleton, String> {
    let mut last = Err(TIED.to_string());
    for attempt in 0..4 {
        let nudged: Vec<f64> = speeds
            .iter()
            .enumerate()
            .map(|(k, s)| {
                if attempt == 0 {
                    return *s;
                }
                // A fixed, uneven nudge per side, different each attempt.
                let h = ((k * 2_654_435_761 + attempt * 40_503) % 1000) as f64 / 1000.0 - 0.5;
                s * (1.0 + 2e-6 * h * attempt as f64)
            })
            .collect();
        last = skeleton(rings, &nudged, sides);
        match &last {
            Err(e) if e == TIED => continue,
            _ => return last,
        }
    }
    last
}

/// The weighted straight skeleton of `rings` -- the outline wound
/// counter-clockwise, holes clockwise -- each side with its speed and the
/// number the caller knows it by.
fn skeleton(rings: &[Vec<Point>], speeds: &[f64], sides: &[usize]) -> Result<Skeleton, String> {
    let mut sk = Skeleton {
        tops: Vec::new(),
        fronts: Vec::new(),
        nodes: Vec::new(),
        arcs: Vec::new(),
    };
    let mut lavs: Vec<Vec<Corner>> = Vec::new();
    let mut k = 0;
    for ring in rings {
        let first = sk.nodes.len();
        for p in ring {
            sk.node(*p, 0.0);
        }
        let base = sk.fronts.len();
        for i in 0..ring.len() {
            let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
            let d = sub(b, a);
            let length = d[0].hypot(d[1]);
            if length < 1e-9 {
                return Err("a roof footprint has a zero-length side".into());
            }
            let direction = [d[0] / length, d[1] / length];
            let normal = [-direction[1], direction[0]];
            sk.fronts.push(Front {
                a,
                b,
                normal,
                direction,
                line: dot(normal, a),
                speed: speeds[k],
                side: sides[k],
                nodes: [first + i, first + (i + 1) % ring.len()],
            });
            k += 1;
        }
        let m = ring.len();
        let lav = (0..m)
            .map(|i| sk.corner(ring[i], 0.0, base + (i + m - 1) % m, base + i, first + i))
            .collect();
        lavs.push(lav);
    }
    let total: usize = rings.iter().map(Vec::len).sum();
    let mut now = 0.0_f64;
    // Splits made at `split_at`, by the reflex corner's fronts and the front it split.
    let (mut splits, mut split_at): (Vec<(usize, usize, usize)>, f64) = (Vec::new(), f64::NAN);
    for _ in 0..(40 * total + 200) {
        pass_over_gables(&mut sk, &mut lavs, now);
        // A wavefront down to two corners is a ridge, or a point.
        let mut open = Vec::new();
        for lav in lavs.drain(..) {
            if lav.len() >= 3 {
                open.push(lav);
                continue;
            }
            let ends: Vec<usize> = lav.iter().map(|corner| sk.end(corner, now)).collect();
            if let [x, y] = ends[..] {
                // Even where they meet, the link keeps both faces' walks joined.
                if x != y {
                    sk.arcs.push((x, y, lav[0].left, lav[0].right));
                }
            }
        }
        lavs = open;
        if lavs.is_empty() {
            return Ok(sk);
        }
        // The earliest event anywhere on the wavefront.
        let mut best: Option<(f64, Event)> = None;
        let mut consider = |t: f64, event: Event| {
            if t >= now - 1e-9 && best.as_ref().is_none_or(|(b, _)| t < *b - 1e-12) {
                best = Some((t.max(now), event));
            }
        };
        for (l, lav) in lavs.iter().enumerate() {
            let m = lav.len();
            for i in 0..m {
                let (u, v) = (lav[i], lav[(i + 1) % m]);
                let d = sk.fronts[u.right].direction;
                let gap = dot(d, sub(v.at(now), u.at(now)));
                let closing = dot(d, sub(v.velocity, u.velocity));
                if gap <= 1e-9 {
                    consider(now, Event::Edge { lav: l, i });
                } else if closing < -1e-12 {
                    consider(now - gap / closing, Event::Edge { lav: l, i });
                }
            }
        }
        for (l, lav) in lavs.iter().enumerate() {
            for (i, r) in lav.iter().enumerate().filter(|(_, r)| r.reflex) {
                for (o, other) in lavs.iter().enumerate() {
                    let m = other.len();
                    for j in 0..m {
                        let (a, b) = (other[j], other[(j + 1) % m]);
                        let e = sk.fronts[a.right];
                        if a.right == r.left
                            || a.right == r.right
                            || (o == l && (j == i || (j + 1) % m == i))
                        {
                            continue;
                        }
                        let gap = dot(e.normal, r.at(now)) - e.line - e.speed * now;
                        let closing = dot(e.normal, r.velocity) - e.speed;
                        if gap < -1e-9 || closing >= -1e-12 {
                            continue;
                        }
                        let t = now + gap.max(0.0) / -closing;
                        let hit = r.at(t);
                        let (pa, pb) = (a.at(t), b.at(t));
                        let span = dot(e.direction, sub(pb, pa));
                        let s = dot(e.direction, sub(hit, pa));
                        let slack = 1e-7 * (1.0 + span.abs());
                        if span >= -slack && s >= -slack && s <= span + slack {
                            consider(
                                t,
                                Event::Split {
                                    lav: l,
                                    i,
                                    other: o,
                                    j,
                                },
                            );
                        }
                    }
                }
            }
        }
        let Some((t, event)) = best else {
            // Nothing left moves -- a pocket only gables close: it is roofed flat
            // where the leaves stopped rising.
            for lav in lavs.drain(..) {
                // Level at the time everything stopped: each gable runs straight up to it.
                let ends: Vec<usize> = lav
                    .iter()
                    .map(|corner| {
                        let at = corner.at(now);
                        let node = sk.node(at, now);
                        sk.arcs.push((corner.node, node, corner.left, corner.right));
                        node
                    })
                    .collect();
                for (k, corner) in lav.iter().enumerate() {
                    let next = ends[(k + 1) % ends.len()];
                    if ends[k] != next {
                        sk.arcs.push((ends[k], next, corner.right, FLAT_TOP));
                    }
                }
                sk.tops.push(ends);
            }
            return Ok(sk);
        };
        now = t;
        match event {
            Event::Edge { lav: l, i } => {
                let lav = &mut lavs[l];
                let m = lav.len();
                let (u, v) = (lav[i], lav[(i + 1) % m]);
                let (pu, pv) = (u.at(now), v.at(now));
                let at = [(pu[0] + pv[0]) * 0.5, (pu[1] + pv[1]) * 0.5];
                let node = sk.node(at, now);
                sk.arcs.push((u.node, node, u.left, u.right));
                sk.arcs.push((v.node, node, v.left, v.right));
                let merged = sk.corner(at, now, u.left, v.right, node);
                if i + 1 < m {
                    lav.splice(i..i + 2, [merged]);
                } else {
                    lav.remove(i);
                    lav[0] = merged;
                }
            }
            Event::Split {
                lav: l,
                i,
                other: o,
                j,
            } => {
                let r = lavs[l][i];
                let m = lavs[o].len();
                let e = lavs[o][j].right;
                // The same corner splitting the same front again at the same
                // instant only parts and rejoins the wavefront: a tie the
                // caller breaks by nudging the slopes.
                if !((now - split_at).abs() < 1e-9) {
                    splits.clear();
                    split_at = now;
                }
                if splits.contains(&(r.left, r.right, e)) {
                    return Err(TIED.into());
                }
                splits.push((r.left, r.right, e));
                let at = r.at(now);
                let node = sk.node(at, now);
                sk.arcs.push((r.node, node, r.left, r.right));
                let w1 = sk.corner(at, now, r.left, e, node);
                let w2 = sk.corner(at, now, e, r.right, node);
                // The wavefront, from just after `r` round to just before it.
                let around = |lav: &Vec<Corner>, from: usize| -> Vec<Corner> {
                    (1..lav.len())
                        .map(|k| lav[(from + k) % lav.len()])
                        .collect()
                };
                if o == l {
                    let seq = around(&lavs[l], i);
                    // `a` sits at index ja in seq, `b` right after it.
                    let ja = seq
                        .iter()
                        .position(|c| c.right == e)
                        .ok_or("the roof skeleton lost a side")?;
                    let mut first = vec![w1];
                    first.extend_from_slice(&seq[ja + 1..]);
                    let mut second = vec![w2];
                    second.extend_from_slice(&seq[..=ja]);
                    lavs[l] = first;
                    lavs.push(second);
                } else {
                    let mine = around(&lavs[l], i);
                    let theirs: Vec<Corner> = (0..m).map(|k| lavs[o][(j + 1 + k) % m]).collect();
                    let mut joined = vec![w1];
                    joined.extend(theirs);
                    joined.push(w2);
                    joined.extend(mine);
                    let (keep, drop) = (l.min(o), l.max(o));
                    lavs[keep] = joined;
                    lavs.remove(drop);
                }
            }
        }
    }
    Err(TIED.into())
}

/// Of two fronts side by side on one line, the faster -- the shallower
/// water -- is the lower surface from there on: it rises on over the slower
/// one, a steeper water or a gable, which stops there -- its top is its line
/// at that moment -- and leaves the wavefront, the faster front taking its
/// place up to its far corner. Moving their shared corner at their mean
/// speed instead would draw it off both lines.
fn pass_over_gables(sk: &mut Skeleton, lavs: &mut [Vec<Corner>], now: f64) {
    for lav in lavs.iter_mut() {
        while lav.len() >= 3 {
            let m = lav.len();
            let found = (0..m).find_map(|i| {
                let c = lav[i];
                let (l, r) = (sk.fronts[c.left], sk.fronts[c.right]);
                let level = |f: &Front| f.line + f.speed * now;
                let together =
                    dot(l.normal, r.normal) > 1.0 - 1e-9 && (level(&l) - level(&r)).abs() < 1e-7;
                if !together || (l.speed - r.speed).abs() < 1e-12 {
                    return None;
                }
                Some((i, r.speed < l.speed))
            });
            let Some((i, gable_right)) = found else {
                break;
            };
            // The gable runs from `c` to `n`; the pitched front keeps `c`'s other side.
            let (ci, ni) = if gable_right {
                (i, (i + 1) % m)
            } else {
                ((i + m - 1) % m, i)
            };
            let (c, n) = (lav[ci], lav[ni]);
            let gable = c.right;
            let (c_end, n_end) = (sk.end(&c, now), sk.end(&n, now));
            let pitched = if gable_right { c.left } else { n.right };
            if c_end != n_end {
                sk.arcs.push((c_end, n_end, gable, pitched));
            }
            let (at, left, right, node) = if gable_right {
                (n.at(now), c.left, n.right, n_end)
            } else {
                (c.at(now), c.left, n.right, c_end)
            };
            let merged = sk.corner(at, now, left, right, node);
            if ni == (ci + 1) % m && ni > ci {
                lav.splice(ci..=ni, [merged]);
            } else {
                // `n` wrapped round to the start.
                lav.remove(ci);
                lav[0] = merged;
            }
        }
    }
}

/// Each side's face: its own side, then the skeleton arcs round to its start.
fn skeleton_faces(sk: &Skeleton) -> Result<Vec<Vec<usize>>, String> {
    let mut faces = Vec::with_capacity(sk.fronts.len());
    for (f, front) in sk.fronts.iter().enumerate() {
        let mut links: Vec<(usize, usize)> = sk
            .arcs
            .iter()
            .filter(|(_, _, l, r)| *l == f || *r == f)
            .map(|(a, b, _, _)| (*a, *b))
            .filter(|(a, b)| a != b)
            .collect();
        let [start, end] = front.nodes;
        let mut ring = vec![start, end];
        let mut at = end;
        while at != start {
            let Some(k) = links.iter().position(|(a, b)| *a == at || *b == at) else {
                return Err("a roof face did not close".into());
            };
            let (a, b) = links.swap_remove(k);
            at = if a == at { b } else { a };
            if at != start {
                ring.push(at);
            }
        }
        faces.push(ring);
    }
    Ok(faces)
}

// ---- Dormers ----

/// A plane `grad . x + base`, and whether it rises at all.
#[derive(Clone, Copy)]
struct Plane {
    grad: Point,
    base: f64,
}

impl Plane {
    fn z(&self, x: Point) -> f64 {
        dot(self.grad, x) + self.base
    }
}

/// Where `low` stays at or below `high`: `a . x <= b`, or everywhere, or nowhere.
enum HalfPlane {
    Line(Point, f64),
    Everywhere,
    Nowhere,
    Tie,
}

fn half_plane(low: &Plane, high: &Plane) -> HalfPlane {
    let a = [low.grad[0] - high.grad[0], low.grad[1] - high.grad[1]];
    let b = high.base - low.base;
    if a[0].hypot(a[1]) > 1e-12 {
        HalfPlane::Line(a, b)
    } else if b > 1e-9 {
        HalfPlane::Everywhere
    } else if b < -1e-9 {
        HalfPlane::Nowhere
    } else {
        HalfPlane::Tie
    }
}

/// Keeps the part of a polygon where `a . x <= b`.
fn clip(polygon: &[Point], a: Point, b: f64) -> Vec<Point> {
    let mut out = Vec::with_capacity(polygon.len() + 1);
    for i in 0..polygon.len() {
        let (p, q) = (polygon[i], polygon[(i + 1) % polygon.len()]);
        let (dp, dq) = (dot(a, p) - b, dot(a, q) - b);
        if dp <= 0.0 {
            out.push(p);
        }
        if (dp < 0.0 && dq > 0.0) || (dp > 0.0 && dq < 0.0) {
            let t = dp / (dp - dq);
            out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
        }
    }
    out
}

/// The part of `polygon` where `low` is at or below `high`.
fn at_or_below(polygon: &[Point], low: &Plane, high: &Plane, wins_ties: bool) -> Vec<Point> {
    match half_plane(low, high) {
        HalfPlane::Line(a, b) => clip(polygon, a, b),
        HalfPlane::Everywhere => polygon.to_vec(),
        HalfPlane::Tie if wins_ties => polygon.to_vec(),
        _ => Vec::new(),
    }
}

/// One leaf of the main roof: its face in plan and its plane.
struct MainLeaf {
    plan: Vec<Point>,
    plane: Plane,
}

/// A dormer: a convex block raised on the roof, one plane per side.
struct Dormer {
    contour: Vec<Point>,
    planes: Vec<Plane>,
    pitched: Vec<bool>,
    normals: Vec<Point>,
    /// Which of its four sides each side is; four where it meets its leaf.
    roles: Vec<usize>,
    elevation: f64,
}

impl Dormer {
    fn z(&self, x: Point) -> f64 {
        self.planes
            .iter()
            .zip(&self.pitched)
            .filter(|(_, p)| **p)
            .map(|(plane, _)| plane.z(x))
            .fold(f64::INFINITY, f64::min)
    }

    /// The part of its plan its side `side` is the roof of.
    fn own(&self, side: usize) -> Vec<Point> {
        let mut own = self.contour.clone();
        for j in (0..self.planes.len()).filter(|j| *j != side && self.pitched[*j]) {
            own = match half_plane(&self.planes[side], &self.planes[j]) {
                HalfPlane::Line(a, b) => clip(&own, a, b),
                HalfPlane::Everywhere => own,
                HalfPlane::Tie if j > side => own,
                _ => return Vec::new(),
            };
            if own.len() < 3 {
                return Vec::new();
            }
        }
        if area(&own).abs() < 1e-9 {
            Vec::new()
        } else {
            own
        }
    }

    /// The part of its plan where its roof reaches at least `other`.
    fn above(&self, other: &Plane, wins_ties: bool) -> Vec<Point> {
        let mut region = self.contour.clone();
        for j in (0..self.planes.len()).filter(|j| self.pitched[*j]) {
            region = at_or_below(&region, other, &self.planes[j], wins_ties);
            if region.len() < 3 {
                return Vec::new();
            }
        }
        region
    }
}

fn inside(polygon: &[Point], x: Point) -> bool {
    let mut inside = false;
    for i in 0..polygon.len() {
        let (a, b) = (polygon[i], polygon[(i + 1) % polygon.len()]);
        if (a[1] > x[1]) != (b[1] > x[1])
            && x[0] < a[0] + (x[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
        {
            inside = !inside;
        }
    }
    inside
}

/// The part of the upright ring `ring` below height `y` -- or above it, `above`.
fn level_part(ring: &[[f64; 3]], y: f64, above: bool) -> Vec<[f64; 3]> {
    let keeps = |p: &[f64; 3]| {
        if above {
            p[1] >= y - 1e-9
        } else {
            p[1] <= y + 1e-9
        }
    };
    let mut out = Vec::with_capacity(ring.len() + 2);
    for i in 0..ring.len() {
        let (p, q) = (ring[i], ring[(i + 1) % ring.len()]);
        if keeps(&p) {
            out.push(p);
        }
        if (p[1] - y) * (q[1] - y) < 0.0 {
            let t = (y - p[1]) / (q[1] - p[1]);
            out.push([p[0] + (q[0] - p[0]) * t, y, p[2] + (q[2] - p[2]) * t]);
        }
    }
    out
}

/// How far inside its leaf's rim every corner of a dormer stays.
const DORMER_CLEARANCE: f64 = 0.01;

/// A dormer set on the leaf of side `front.side`, raised `front` above it.
fn dormer_block(
    host: &Front,
    leaf: &MainLeaf,
    dormer: &RoofDormer,
    scale: f64,
) -> Result<Dormer, String> {
    if host.speed <= 0.0 {
        return Err("a dormer stands only on a pitched leaf".into());
    }
    if ![dormer.along, dormer.setback, dormer.width, dormer.front]
        .iter()
        .chain(&dormer.slopes)
        .all(|v| v.is_finite() && *v >= 0.0)
        || dormer.width <= 0.0
        || dormer.along > 1.0
        || dormer.slopes.iter().all(|s| *s == 0.0)
    {
        return Err(
            "a dormer needs a positive width, a pitched side and finite, nonnegative measures"
                .into(),
        );
    }
    let (u, n) = (host.direction, host.normal);
    let middle = [
        host.a[0] + dormer.along * (host.b[0] - host.a[0]),
        host.a[1] + dormer.along * (host.b[1] - host.a[1]),
    ];
    let front = [
        middle[0] + n[0] * dormer.setback,
        middle[1] + n[1] * dormer.setback,
    ];
    let half = dormer.width * 0.5;
    let at = |s: f64, t: f64| {
        [
            front[0] + u[0] * s + n[0] * t,
            front[1] + u[1] * s + n[1] * t,
        ]
    };
    // It stands on its leaf, front and cheeks, as deep as its cheeks stay on it.
    let edges = leaf.plan.len();
    let exit = |p: Point| {
        (0..edges)
            .filter_map(|i| {
                crossing(
                    p,
                    [p[0] + n[0] * 1e6, p[1] + n[1] * 1e6],
                    leaf.plan[i],
                    leaf.plan[(i + 1) % edges],
                )
            })
            .map(|t| t * 1e6)
            .filter(|t| *t > 1e-9)
            .fold(f64::INFINITY, f64::min)
    };
    // Every corner well inside the leaf -- clear of its rim, so nothing of it
    // lies along a hip or in a gable.
    let clear = |p: Point| {
        inside(&leaf.plan, p)
            && (0..edges).all(|i| {
                let (a, b) = (leaf.plan[i], leaf.plan[(i + 1) % edges]);
                let d = sub(b, a);
                let t = (dot(sub(p, a), d) / dot(d, d).max(1e-18)).clamp(0.0, 1.0);
                let q = [a[0] + d[0] * t, a[1] + d[1] * t];
                (p[0] - q[0]).hypot(p[1] - q[1]) >= DORMER_CLEARANCE
            })
    };
    let corners = [at(-half, 0.0), front, at(half, 0.0)];
    if !corners.iter().all(|c| clear(*c)) {
        return Err("a dormer must stand on its leaf".into());
    }
    // All of it on the leaf: a concave leaf may reach round between its corners.
    let fits = |depth: f64| {
        let rectangle = [
            at(-half, 0.0),
            at(half, 0.0),
            at(half, depth),
            at(-half, depth),
        ];
        rectangle.iter().all(|c| clear(*c))
            && !leaf.plan.iter().any(|q| {
                let w = sub(*q, front);
                let (s, t) = (dot(w, u), dot(w, n));
                s.abs() < half + DORMER_CLEARANCE
                    && t > -DORMER_CLEARANCE
                    && t < depth + DORMER_CLEARANCE
            })
    };
    // As deep as the leaf runs behind it, stopped clear of the rim; shorter
    // only where a concave leaf reaches round in between.
    let mut depth = corners
        .iter()
        .map(|c| exit(*c))
        .fold(f64::INFINITY, f64::min)
        - 2.0 * DORMER_CLEARANCE;
    while depth.is_finite() && depth > DORMER_CLEARANCE && !fits(depth) {
        depth -= DORMER_CLEARANCE.max(depth * 0.05);
    }
    if !depth.is_finite() || depth <= DORMER_CLEARANCE {
        return Err("a dormer must stand on its leaf".into());
    }
    let contour = vec![
        at(-half, 0.0),
        at(half, 0.0),
        at(half, depth),
        at(-half, depth),
    ];
    let elevation = leaf.plane.z(front) + dormer.front;
    let mut planes = Vec::new();
    let mut normals = Vec::new();
    for i in 0..4 {
        let (a, b) = (contour[i], contour[(i + 1) % 4]);
        let d = sub(b, a);
        let length = d[0].hypot(d[1]);
        let normal = [-d[1] / length, d[0] / length];
        let slope = if dormer.absolute {
            dormer.slopes[i]
        } else {
            dormer.slopes[i] * scale
        };
        planes.push(Plane {
            grad: [slope * normal[0], slope * normal[1]],
            base: elevation - slope * dot(normal, a),
        });
        normals.push(normal);
    }
    Ok(Dormer {
        contour,
        planes,
        pitched: dormer.slopes.iter().map(|s| *s > 0.0).collect(),
        normals,
        roles: vec![0, 1, 2, 3],
        elevation,
    })
}

/// Rings of one face in plan: outer first, then holes.
type PlanFace = Vec<Vec<Point>>;

/// `subject` less `covers`, as faces with their holes.
fn minus(subject: &[Point], covers: &[PlanFace]) -> Result<Vec<PlanFace>, String> {
    let covers: Vec<&PlanFace> = covers
        .iter()
        .filter(|c| {
            c.first()
                .is_some_and(|ring| ring.len() >= 3 && area(ring).abs() > 1e-9)
        })
        .collect();
    if covers.is_empty() {
        return Ok(vec![vec![subject.to_vec()]]);
    }
    let to32 = |ring: &[Point], hole: bool| {
        let mut oriented = ring.to_vec();
        if (area(ring) < 0.0) != hole {
            oriented.reverse();
        }
        oriented
            .iter()
            .map(|p| [p[0] as f32, p[1] as f32])
            .collect::<Vec<_>>()
    };
    let shapes = planar_boolean(
        &[vec![to32(subject, false)]],
        &covers
            .iter()
            .map(|polygon| {
                polygon
                    .iter()
                    .enumerate()
                    .map(|(r, ring)| to32(ring, r > 0))
                    .collect()
            })
            .collect::<Vec<_>>(),
        PlanarBoolean::Difference,
    )?;
    let mut faces = Vec::new();
    for shape in shapes {
        let mut rings = shape.into_iter().map(|ring| {
            ring.into_iter()
                .map(|p| [f64::from(p[0]), f64::from(p[1])])
                .collect::<Vec<Point>>()
        });
        let Some(outer) = rings.next() else {
            continue;
        };
        let sign = area(&outer).signum();
        // An outline pinched through one corner is as many outlines; a loop
        // turning the other way inside it is a hole.
        let (mut outers, mut holes): (Vec<Vec<Point>>, Vec<Vec<Point>>) = (Vec::new(), Vec::new());
        for part in loops(outer) {
            if area(&part).signum() == sign {
                outers.push(part);
            } else {
                holes.push(part);
            }
        }
        holes.extend(rings.flat_map(loops));
        for outer in outers.into_iter().filter(|ring| area(ring).abs() > 1e-6) {
            let mine = holes
                .iter()
                .filter(|hole| inside(&outer, hole[0]) || inside(&outer, centroid(hole)))
                .cloned();
            faces.push(
                std::iter::once(outer.clone())
                    .chain(mine)
                    .collect::<PlanFace>(),
            );
        }
    }
    Ok(faces)
}

fn centroid(ring: &[Point]) -> Point {
    let n = ring.len().max(1) as f64;
    ring.iter()
        .fold([0.0, 0.0], |s, p| [s[0] + p[0] / n, s[1] + p[1] / n])
}

/// A ring's simple loops: split wherever it passes a corner twice, each loop
/// rid of spikes, and loops with no area -- a side walked there and back -- dropped.
fn loops(ring: Vec<Point>) -> Vec<Vec<Point>> {
    let ring = without_spikes(ring);
    let extent = ring
        .iter()
        .flat_map(|p| p.iter().map(|v| v.abs()))
        .fold(1.0_f64, f64::max);
    let same = |a: Point, b: Point| {
        (a[0] - b[0]).abs() < 5e-6 * extent && (a[1] - b[1]).abs() < 5e-6 * extent
    };
    let mut found = Vec::new();
    let mut path: Vec<Point> = Vec::new();
    for p in ring {
        if let Some(k) = path.iter().position(|q| same(*q, p)) {
            found.push(path.split_off(k));
        }
        path.push(p);
    }
    found.push(path);
    found
        .into_iter()
        .map(without_spikes)
        .filter(|part| part.len() >= 3 && area(part).abs() > 1e-9)
        .collect()
}

/// A ring without repeated corners, nor spikes that run out along a side and
/// back: where two cut lines coincide, the boolean can walk one both ways,
/// which would use that side twice from the same face.
fn without_spikes(mut ring: Vec<Point>) -> Vec<Point> {
    // As close as `weld` later makes one corner of two: nearer, a spike would come back.
    let extent = ring
        .iter()
        .flat_map(|p| p.iter().map(|v| v.abs()))
        .fold(1.0_f64, f64::max);
    let same = |a: Point, b: Point| {
        (a[0] - b[0]).abs() < 5e-6 * extent && (a[1] - b[1]).abs() < 5e-6 * extent
    };
    loop {
        let n = ring.len();
        if n < 3 {
            return ring;
        }
        let Some(i) = (0..n).find(|&i| {
            let (prev, here, next) = (ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n]);
            same(here, next) || same(prev, next)
        }) else {
            return ring;
        };
        let (here, next) = (ring[i], ring[(i + 1) % n]);
        if same(here, next) {
            ring.remove(i);
        } else {
            // prev, here, prev: the spike's tip and its way back both go.
            let back = (i + 1) % n;
            let (first, second) = if back > i { (back, i) } else { (i, back) };
            ring.remove(first);
            ring.remove(second);
        }
    }
}

/// Where segment `a`-`c` crosses segment `p`-`q`, as a fraction along `a`-`c`.
fn crossing(a: Point, c: Point, p: Point, q: Point) -> Option<f64> {
    let d = sub(c, a);
    let e = sub(q, p);
    let det = d[0] * e[1] - d[1] * e[0];
    if det.abs() < 1e-12 {
        return None;
    }
    let w = sub(p, a);
    let t = (w[0] * e[1] - w[1] * e[0]) / det;
    let s = (w[0] * d[1] - w[1] * d[0]) / det;
    ((-1e-9..=1.0 + 1e-9).contains(&s) && (0.0..=1.0).contains(&t)).then_some(t)
}

/// The upright faces along side `side` of dormer `k`: between whatever roof
/// lies under it and its own roof's edge, wherever that edge stands higher.
fn dormer_uprights(
    leaves: &[MainLeaf],
    dormers: &[Dormer],
    k: usize,
    side: usize,
) -> Vec<Vec<[f64; 3]>> {
    let dormer = &dormers[k];
    let n = dormer.contour.len();
    let (a, c) = (dormer.contour[side], dormer.contour[(side + 1) % n]);
    let at = |t: f64| [a[0] + t * (c[0] - a[0]), a[1] + t * (c[1] - a[1])];
    let mut ts = vec![0.0, 1.0];
    let mut outlines: Vec<Vec<Point>> = leaves.iter().map(|leaf| leaf.plan.clone()).collect();
    for (o, other) in dormers.iter().enumerate() {
        outlines.extend(
            (0..other.planes.len())
                .filter(|j| other.pitched[*j])
                .map(|j| other.own(j)),
        );
        if o != k {
            outlines.push(other.contour.clone());
        }
    }
    for outline in outlines.iter().filter(|outline| outline.len() >= 3) {
        for i in 0..outline.len() {
            ts.extend(crossing(a, c, outline[i], outline[(i + 1) % outline.len()]));
        }
    }
    ts.sort_by(f64::total_cmp);
    ts.dedup_by(|x, y| (*x - *y).abs() < 1e-9);
    let top = |t: f64| dormer.z(at(t));
    let point = |t: f64, y: f64| {
        let x = at(t);
        [x[0], y, x[1]]
    };
    const GAP: f64 = 1e-6;
    let mut faces = Vec::new();
    let (mut upper, mut lower): (Vec<[f64; 3]>, Vec<[f64; 3]>) = (Vec::new(), Vec::new());
    let mut close = |upper: &mut Vec<[f64; 3]>, lower: &mut Vec<[f64; 3]>| {
        let mut ring = std::mem::take(upper);
        ring.extend(std::mem::take(lower).into_iter().rev());
        ring.dedup_by(|p, q| (0..3).all(|k| (p[k] - q[k]).abs() < 1e-9));
        if ring.len() >= 3 {
            faces.push(ring);
        }
    };
    for pair in ts.windows(2) {
        let (t0, t1) = (pair[0], pair[1]);
        if t1 - t0 < 1e-12 {
            continue;
        }
        let middle = at((t0 + t1) * 0.5);
        let under_main = leaves.iter().find(|leaf| inside(&leaf.plan, middle));
        let under: Vec<&Dormer> = dormers
            .iter()
            .enumerate()
            .filter(|(o, other)| *o != k && inside(&other.contour, middle))
            .map(|(_, other)| other)
            .collect();
        let bottom = |t: f64| {
            let x = at(t);
            let main = under_main.map(|leaf| leaf.plane.z(x));
            let raised = under
                .iter()
                .map(|other| other.z(x))
                .fold(f64::NEG_INFINITY, f64::max);
            match main {
                Some(z) => z.max(raised),
                None if under.is_empty() => dormer.elevation,
                None => raised,
            }
        };
        let (g0, g1) = (top(t0) - bottom(t0), top(t1) - bottom(t1));
        let (open0, open1) = (g0 > GAP, g1 > GAP);
        let tc = || t0 + (t1 - t0) * (g0 / (g0 - g1)).clamp(0.0, 1.0);
        if open0 {
            if upper.is_empty() {
                upper.push(point(t0, top(t0)));
            }
            // Continuing, the roof under it may step here.
            lower.push(point(t0, bottom(t0)));
        } else if open1 {
            close(&mut upper, &mut lower);
            upper.push(point(tc(), top(tc())));
        }
        if open1 {
            upper.push(point(t1, top(t1)));
            lower.push(point(t1, bottom(t1)));
        } else {
            if open0 {
                upper.push(point(tc(), top(tc())));
            }
            close(&mut upper, &mut lower);
        }
    }
    close(&mut upper, &mut lower);
    faces
}

/// Newell normal of a 3D ring.
fn normal(ring: &[[f64; 3]]) -> [f64; 3] {
    let mut n = [0.0; 3];
    for i in 0..ring.len() {
        let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    n
}

#[derive(Clone)]
struct Face3 {
    side: usize,
    dormer: Option<usize>,
    subroof: Option<usize>,
    /// For an upright face, the way out of the roof in plan.
    outward: Option<Point>,
    rings: Vec<Vec<[f64; 3]>>,
}
/// Close the vertical cut between a platform rim and the surviving roof.
fn platform_uprights(cut: &RoofPlatformCut, leaves: &[MainLeaf]) -> Vec<Face3> {
    let mut faces = Vec::new();
    for (ring_index, ring) in std::iter::once(&cut.footprint.outer)
        .chain(&cut.footprint.holes)
        .enumerate()
    {
        let toward_cut = if (area(ring) > 0.0) == (ring_index == 0) {
            1.0
        } else {
            -1.0
        };
        for i in 0..ring.len() {
            let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
            let d = sub(b, a);
            let outward = [-d[1] * toward_cut, d[0] * toward_cut];
            let at = |t: f64| [a[0] + d[0] * t, a[1] + d[1] * t];
            for leaf in leaves {
                let mut stops = vec![0.0, 1.0];
                for j in 0..leaf.plan.len() {
                    if let Some(t) =
                        crossing(a, b, leaf.plan[j], leaf.plan[(j + 1) % leaf.plan.len()])
                    {
                        stops.push(t);
                    }
                }
                let (ha, hb) = (
                    leaf.plane.z(a) - cut.elevation,
                    leaf.plane.z(b) - cut.elevation,
                );
                if (ha - hb).abs() > 1e-12 {
                    let t = ha / (ha - hb);
                    if t > 0.0 && t < 1.0 {
                        stops.push(t);
                    }
                }
                stops.sort_by(f64::total_cmp);
                stops.dedup_by(|x, y| (*x - *y).abs() < 1e-9);
                for pair in stops.windows(2) {
                    let (t0, t1) = (pair[0], pair[1]);
                    if t1 - t0 < 1e-9
                        || !inside(&leaf.plan, at((t0 + t1) / 2.0))
                        || leaf.plane.z(at((t0 + t1) / 2.0)) <= cut.elevation + 1e-9
                    {
                        continue;
                    }
                    let (p, q) = (at(t0), at(t1));
                    faces.push(Face3 {
                        side: 0,
                        dormer: None,
                        subroof: None,
                        outward: Some(outward),
                        rings: vec![vec![
                            [p[0], cut.elevation, p[1]],
                            [q[0], cut.elevation, q[1]],
                            [q[0], leaf.plane.z(q), q[1]],
                            [p[0], leaf.plane.z(p), p[1]],
                        ]],
                    });
                }
            }
        }
    }
    faces
}

/// Whether any two sides of the footprints cross or touch, other than
/// neighbours meeting at their shared corner and rings sharing a corner.
fn crosses_itself(rings: &[&Vec<[f64; 2]>]) -> bool {
    let sides: Vec<(usize, usize, Point, Point)> = rings
        .iter()
        .enumerate()
        .flat_map(|(r, ring)| {
            (0..ring.len()).map(move |i| (r, i, ring[i], ring[(i + 1) % ring.len()]))
        })
        .collect();
    let orient = |a: Point, b: Point, c: Point| {
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    };
    sides.iter().enumerate().any(|(k, &(r, i, a, b))| {
        sides[k + 1..].iter().any(|&(q, j, c, d)| {
            let m = rings[r].len();
            let neighbours = r == q && (j == (i + 1) % m || i == (j + 1) % m);
            if neighbours {
                return false;
            }
            let (d1, d2) = (orient(a, b, c), orient(a, b, d));
            let (d3, d4) = (orient(c, d, a), orient(c, d, b));
            // Two rings may share a corner: footprints joined there, a hole touching its outline.
            let same =
                |p: Point, q: Point| (p[0] - q[0]).abs() < 1e-9 && (p[1] - q[1]).abs() < 1e-9;
            let cornered = r != q && (same(a, c) || same(a, d) || same(b, c) || same(b, d));
            if cornered && !(d1 == 0.0 && d2 == 0.0) {
                return false;
            }
            d1 * d2 <= 0.0 && d3 * d4 <= 0.0 && !(d1 == 0.0 && d2 == 0.0)
        })
    })
}

/// Generates one roof before its visible envelope is joined to any subroofs.
fn generate_single_roof_patch(request: RoofRequest) -> Result<RoofPatch, String> {
    if !request.elevation.is_finite() || !request.height.is_finite() || request.height <= 0.0 {
        return Err("a roof needs a finite elevation and a positive height".into());
    }
    // Every ring, footprint by footprint: its outline, then its holes.
    let authored: Vec<(usize, bool, &Vec<[f64; 2]>)> = request
        .footprints
        .iter()
        .enumerate()
        .flat_map(|(f, footprint)| {
            std::iter::once((f, false, &footprint.outer))
                .chain(footprint.holes.iter().map(move |hole| (f, true, hole)))
        })
        .collect();
    let count: usize = authored.iter().map(|(_, _, ring)| ring.len()).sum();
    if authored.is_empty()
        || authored.iter().any(|(_, _, ring)| ring.len() < 3)
        || request.slopes.len() != count
    {
        return Err(
            "a roof footprint needs rings of three or more corners and a slope per side".into(),
        );
    }
    if authored
        .iter()
        .flat_map(|(_, _, ring)| ring.iter())
        .flatten()
        .any(|v| !v.is_finite())
        || request.slopes.iter().any(|s| !s.is_finite() || *s < 0.0)
    {
        return Err("roof coordinates and slopes must be finite and nonnegative".into());
    }
    if request.slopes.iter().all(|s| *s == 0.0) {
        return Err("a roof needs at least one pitched side".into());
    }
    if request.cutouts.iter().any(|cutout| {
        std::iter::once(&cutout.outer)
            .chain(&cutout.holes)
            .any(|ring| {
                ring.len() < 3
                    || ring.iter().flatten().any(|value| !value.is_finite())
                    || area(ring).abs() < 1e-9
            })
    }) {
        return Err("a roof cutout needs three finite corners and a nonzero area".into());
    }
    if request.platform_cuts.iter().any(|cut| {
        !cut.elevation.is_finite()
            || cut.elevation <= request.elevation
            || cut.footprint.outer.len() < 3
            || area(&cut.footprint.outer).abs() < 1e-9
            || std::iter::once(&cut.footprint.outer)
                .chain(&cut.footprint.holes)
                .flatten()
                .flatten()
                .any(|value| !value.is_finite())
    }) {
        return Err("a platform cut needs a finite elevation and footprint above the eaves".into());
    }
    if crosses_itself(
        &authored
            .iter()
            .map(|(_, _, ring)| *ring)
            .collect::<Vec<_>>(),
    ) {
        return Err("a roof footprint must not cross itself".into());
    }
    // Each footprint's own skeleton -- footprints only touching at a corner
    // never meet inward -- its rings wound the way the skeleton walks, each
    // side keeping the number the caller gave it.
    let mut skeletons = Vec::new();
    let mut first = 0;
    for f in 0..request.footprints.len() {
        let (mut rings, mut speeds, mut sides) = (Vec::new(), Vec::new(), Vec::new());
        for (_, hole, ring) in authored.iter().filter(|(g, _, _)| *g == f) {
            let m = ring.len();
            if area(ring).abs() < 1e-9 {
                return Err("a roof footprint ring has no area".into());
            }
            let turned = area(ring).signum() != if *hole { -1.0 } else { 1.0 };
            for i in 0..m {
                let side = first + if turned { (2 * m - 2 - i) % m } else { i };
                let slope = request.slopes[side];
                speeds.push(if slope > 0.0 { 1.0 / slope } else { 0.0 });
                sides.push(side);
            }
            rings.push(if turned {
                ring.iter().rev().copied().collect()
            } else {
                ring.to_vec()
            });
            first += m;
        }
        if speeds.iter().all(|s| *s == 0.0) {
            return Err("every footprint of a roof needs a pitched side".into());
        }
        skeletons.push(skeleton_untied(&rings, &speeds, &sides)?);
    }
    let peak = skeletons
        .iter()
        .flat_map(|sk| sk.nodes.iter().map(|(_, t)| *t))
        .fold(0.0_f64, f64::max);
    if peak.is_nan() || peak <= 1e-9 {
        return Err("the roof does not rise".into());
    }
    let scale = request.height / peak;
    // Main leaves, with their planes, for dormers to stand on.
    let mut leaves: Vec<(Option<Front>, MainLeaf)> = Vec::new();
    let mut faces = Vec::new();
    for sk in &skeletons {
        let lift = |node: usize| {
            let (p, t) = sk.nodes[node];
            [p[0], request.elevation + scale * t, p[1]]
        };
        for (f, ring) in skeleton_faces(sk)?.iter().enumerate() {
            let front = sk.fronts[f];
            if front.speed > 0.0 {
                let slope = scale / front.speed;
                let plane = Plane {
                    grad: [slope * front.normal[0], slope * front.normal[1]],
                    base: request.elevation - slope * front.line,
                };
                leaves.push((
                    Some(front),
                    MainLeaf {
                        plan: ring.iter().map(|n| sk.nodes[*n].0).collect(),
                        plane,
                    },
                ));
            } else {
                faces.push(Face3 {
                    side: front.side,
                    dormer: None,
                    subroof: None,
                    outward: Some([-front.normal[0], -front.normal[1]]),
                    rings: vec![ring.iter().map(|n| lift(*n)).collect()],
                });
            }
        }
        // Flat tops: leaves of no side, level where the roof stopped rising.
        for top in &sk.tops {
            let ring: Vec<[f64; 3]> = top.iter().map(|n| lift(*n)).collect();
            let plan: Vec<Point> = top.iter().map(|n| sk.nodes[*n].0).collect();
            if plan.len() >= 3 && area(&plan).abs() > 1e-9 {
                leaves.push((
                    None,
                    MainLeaf {
                        plan,
                        plane: Plane {
                            grad: [0.0; 2],
                            base: ring[0][1],
                        },
                    },
                ));
            }
        }
    }
    let main: Vec<MainLeaf> = leaves
        .iter()
        .map(|(_, leaf)| MainLeaf {
            plan: leaf.plan.clone(),
            plane: leaf.plane,
        })
        .collect();
    // Where each side starts, as the caller drew it: a ring the skeleton
    // walks the other way round runs each of its fronts backwards.
    let side_starts: Vec<Point> = authored
        .iter()
        .flat_map(|(_, _, ring)| ring.iter().copied())
        .collect();
    let mut dormers = Vec::new();
    for dormer in &request.dormers {
        let (front, leaf) = leaves
            .iter()
            .find_map(|(front, leaf)| {
                front
                    .filter(|front| front.side == dormer.side)
                    .map(|front| (front, leaf))
            })
            .ok_or("a dormer stands only on a pitched leaf of the roof")?;
        // `along` runs the way the caller drew the side.
        let start = side_starts.get(dormer.side).copied().unwrap_or(front.a);
        let turned = (front.a[0] - start[0]).hypot(front.a[1] - start[1]) > 1e-9;
        let placed = RoofDormer {
            along: if turned {
                1.0 - dormer.along
            } else {
                dormer.along
            },
            ..dormer.clone()
        };
        dormers.push(dormer_block(&front, leaf, &placed, scale)?);
    }
    // Main leaves, opened where a dormer stands higher.
    for (front, leaf) in &leaves {
        let side = front.map_or(count, |front| front.side);
        if dormers.is_empty() && request.cutouts.is_empty() && request.platform_cuts.is_empty() {
            faces.push(Face3 {
                side,
                dormer: None,
                subroof: None,
                outward: None,
                rings: vec![
                    leaf.plan
                        .iter()
                        .map(|p| [p[0], leaf.plane.z(*p), p[1]])
                        .collect(),
                ],
            });
            continue;
        }
        let mut covers: Vec<PlanFace> = dormers
            .iter()
            .map(|d| vec![d.above(&leaf.plane, true)])
            .collect();
        covers.extend(request.cutouts.iter().map(|cutout| {
            std::iter::once(cutout.outer.clone())
                .chain(cutout.holes.iter().cloned())
                .collect()
        }));
        covers.extend(request.platform_cuts.iter().map(|cut| {
            let level = Plane {
                grad: [0.0; 2],
                base: cut.elevation,
            };
            std::iter::once(&cut.footprint.outer)
                .chain(&cut.footprint.holes)
                .map(|ring| at_or_below(ring, &level, &leaf.plane, false))
                .collect::<PlanFace>()
        }));
        for face in minus(&leaf.plan, &covers)? {
            faces.push(Face3 {
                side,
                dormer: None,
                subroof: None,
                outward: None,
                rings: face
                    .iter()
                    .map(|ring| {
                        ring.iter()
                            .map(|p| [p[0], leaf.plane.z(*p), p[1]])
                            .collect()
                    })
                    .collect(),
            });
        }
    }
    // Dormers' own leaves, where they stand above the roof and each other.
    for (k, dormer) in dormers.iter().enumerate() {
        for j in (0..dormer.planes.len()).filter(|j| dormer.pitched[*j]) {
            let own = dormer.own(j);
            if own.is_empty() {
                continue;
            }
            let plane = dormer.planes[j];
            let mut covers: Vec<PlanFace> = main
                .iter()
                .map(|leaf| vec![at_or_below(&leaf.plan, &plane, &leaf.plane, false)])
                .collect();
            covers.extend(
                dormers
                    .iter()
                    .enumerate()
                    .filter(|(o, _)| *o != k)
                    .map(|(o, other)| vec![other.above(&plane, o > k)]),
            );
            covers.extend(request.cutouts.iter().map(|cutout| {
                std::iter::once(cutout.outer.clone())
                    .chain(cutout.holes.iter().cloned())
                    .collect()
            }));
            covers.extend(request.platform_cuts.iter().map(|cut| {
                let level = Plane {
                    grad: [0.0; 2],
                    base: cut.elevation,
                };
                std::iter::once(&cut.footprint.outer)
                    .chain(&cut.footprint.holes)
                    .map(|ring| at_or_below(ring, &level, &plane, false))
                    .collect::<PlanFace>()
            }));
            for face in minus(&own, &covers)? {
                faces.push(Face3 {
                    side: dormer.roles[j],
                    dormer: Some(k),
                    subroof: None,
                    outward: None,
                    rings: face
                        .iter()
                        .map(|ring| ring.iter().map(|p| [p[0], plane.z(*p), p[1]]).collect())
                        .collect(),
                });
            }
        }
        for side in 0..dormer.contour.len() {
            let inward = dormer.normals[side];
            for ring in dormer_uprights(&main, &dormers, k, side) {
                // A front set apart from its gable: the wall up to the eaves, the gable over them.
                let parts = if request.dormers[k].gable_apart && dormer.roles[side] == 0 {
                    vec![
                        (
                            dormer.roles[side],
                            level_part(&ring, dormer.elevation, false),
                        ),
                        (GABLE_OVER_FRONT, level_part(&ring, dormer.elevation, true)),
                    ]
                } else {
                    vec![(dormer.roles[side], ring)]
                };
                for (role, part) in parts {
                    let span = part.iter().map(|p| p[1]).fold(f64::NEG_INFINITY, f64::max)
                        - part.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
                    if part.len() < 3 || span < 1e-9 {
                        continue;
                    }
                    faces.push(Face3 {
                        side: role,
                        dormer: Some(k),
                        subroof: None,
                        outward: Some([-inward[0], -inward[1]]),
                        rings: vec![part],
                    });
                }
            }
        }
    }
    for cut in &request.platform_cuts {
        faces.extend(platform_uprights(cut, &main));
    }
    weld(faces)
}

/// A generated face back in geometric form, so several roof profiles can be
/// intersected before their shared seams receive graph identities.
fn patch_faces(patch: &RoofPatch, subroof: Option<usize>) -> Vec<Face3> {
    let ring = |uses: &[(usize, bool)]| {
        uses.iter()
            .map(|(edge, reversed)| {
                let edge = &patch.edges[*edge];
                patch.nodes[if *reversed { edge.end } else { edge.start }]
            })
            .collect::<Vec<_>>()
    };
    patch
        .faces
        .iter()
        .map(|face| {
            let rings = std::iter::once(ring(&face.boundary))
                .chain(face.holes.iter().map(|hole| ring(hole)))
                .collect::<Vec<_>>();
            let n = normal(&rings[0]);
            Face3 {
                side: face.side,
                dormer: face.dormer,
                subroof: subroof.or(face.subroof),
                outward: face.upright.then_some([-n[0], -n[2]]),
                rings,
            }
        })
        .collect()
}

fn face_plane(face: &Face3) -> Option<Plane> {
    if face.outward.is_some() {
        return None;
    }
    let n = normal(&face.rings[0]);
    if n[1].abs() < 1e-9 {
        return None;
    }
    let p = face.rings[0][0];
    Some(Plane {
        grad: [-n[0] / n[1], -n[2] / n[1]],
        base: (n[0] * p[0] + n[1] * p[1] + n[2] * p[2]) / n[1],
    })
}

/// Keep only the upper visible surface where independent roof profiles overlap.
fn visible_roof_faces(groups: &[Vec<Face3>]) -> Result<Vec<Face3>, String> {
    let mut visible = Vec::new();
    for (owner, faces) in groups.iter().enumerate() {
        for face in faces {
            let Some(plane) = face_plane(face) else {
                visible.extend(visible_upright(face, groups, owner)?);
                continue;
            };
            let mut covers: Vec<PlanFace> = face
                .rings
                .iter()
                .skip(1)
                .map(|ring| vec![ring.iter().map(|p| [p[0], p[2]]).collect()])
                .collect();
            for (other_owner, others) in groups
                .iter()
                .enumerate()
                .filter(|(index, _)| *index != owner)
            {
                for other in others {
                    let Some(higher) = face_plane(other) else {
                        continue;
                    };
                    let rings = other
                        .rings
                        .iter()
                        .map(|ring| {
                            at_or_below(
                                &ring.iter().map(|p| [p[0], p[2]]).collect::<Vec<_>>(),
                                &plane,
                                &higher,
                                other_owner > owner,
                            )
                        })
                        .enumerate()
                        .filter_map(|(index, ring)| (index == 0 || ring.len() >= 3).then_some(ring))
                        .collect::<PlanFace>();
                    if rings.first().is_some_and(|ring| ring.len() >= 3) {
                        covers.push(rings);
                    }
                }
            }
            let subject = face.rings[0]
                .iter()
                .map(|p| [p[0], p[2]])
                .collect::<Vec<_>>();
            for shape in minus(&subject, &covers)? {
                visible.push(Face3 {
                    side: face.side,
                    dormer: face.dormer,
                    subroof: face.subroof,
                    outward: None,
                    rings: shape
                        .into_iter()
                        .map(|ring| ring.into_iter().map(|p| [p[0], plane.z(p), p[1]]).collect())
                        .collect(),
                });
            }
        }
    }
    Ok(visible)
}

/// The part of upright face `face` of roof `owner` standing above the other
/// roofs' surfaces: a gable or a closure is hidden where it runs inside them.
/// Worked in the face's own plane -- along its line in plan, and up.
fn visible_upright(
    face: &Face3,
    groups: &[Vec<Face3>],
    owner: usize,
) -> Result<Vec<Face3>, String> {
    let ring = &face.rings[0];
    let plan = ring.iter().map(|p| [p[0], p[2]]).collect::<Vec<_>>();
    let origin = plan[0];
    let Some(far) = plan.iter().copied().max_by(|a, b| {
        sub(*a, origin)
            .map(f64::abs)
            .iter()
            .sum::<f64>()
            .total_cmp(&sub(*b, origin).map(f64::abs).iter().sum::<f64>())
    }) else {
        return Ok(vec![face.clone()]);
    };
    let length = (far[0] - origin[0]).hypot(far[1] - origin[1]);
    if length < 1e-9 {
        return Ok(vec![face.clone()]);
    }
    let dir = [(far[0] - origin[0]) / length, (far[1] - origin[1]) / length];
    let along = |p: Point| dot(sub(p, origin), dir);
    let at = |s: f64| [origin[0] + dir[0] * s, origin[1] + dir[1] * s];
    let subject = ring
        .iter()
        .map(|p| [along([p[0], p[2]]), p[1]])
        .collect::<Vec<_>>();
    let (lo, hi) = subject
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
            (lo.min(p[0]), hi.max(p[0]))
        });
    let floor = subject.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min) - 1.0;
    let (a, c) = (at(lo), at(hi));
    // Under every other roof's leaf the face crosses: from below the face up to that leaf.
    let mut covers: Vec<PlanFace> = Vec::new();
    // An earlier roof's upright face in the same plane, facing the same way,
    // is that face already: two gables on one wall are one gable.
    let on_line = |p: &[f64; 3]| {
        let d = sub([p[0], p[2]], origin);
        (d[0] * dir[1] - d[1] * dir[0]).abs() < 1e-6
    };
    for other in groups.iter().take(owner).flatten() {
        let (Some(mine), Some(theirs)) = (face.outward, other.outward) else {
            continue;
        };
        if face_plane(other).is_some()
            || dot(mine, theirs) <= 0.0
            || !other.rings[0].iter().all(on_line)
        {
            continue;
        }
        covers.push(
            other
                .rings
                .iter()
                .map(|r| r.iter().map(|p| [along([p[0], p[2]]), p[1]]).collect())
                .collect(),
        );
    }
    for other in groups
        .iter()
        .enumerate()
        .filter(|(index, _)| *index != owner)
        .flat_map(|(_, faces)| faces)
    {
        let Some(plane) = face_plane(other) else {
            continue;
        };
        let rings = other
            .rings
            .iter()
            .map(|r| r.iter().map(|q| [q[0], q[2]]).collect::<Vec<_>>())
            .collect::<Vec<_>>();
        let mut stops = vec![0.0, 1.0];
        for r in &rings {
            for j in 0..r.len() {
                stops.extend(crossing(a, c, r[j], r[(j + 1) % r.len()]));
            }
        }
        stops.sort_by(f64::total_cmp);
        stops.dedup_by(|x, y| (*x - *y).abs() < 1e-9);
        for pair in stops.windows(2) {
            let (s0, s1) = (lo + (hi - lo) * pair[0], lo + (hi - lo) * pair[1]);
            if s1 - s0 < 1e-9 {
                continue;
            }
            // Looked at from the side it faces: a leaf whose rim runs along
            // the face -- one the face holds up -- does not hide it.
            let out = face.outward.map_or([0.0, 0.0], |o| {
                let l = o[0].hypot(o[1]).max(1e-12);
                [o[0] / l * 1e-4, o[1] / l * 1e-4]
            });
            let middle = {
                let m = at((s0 + s1) / 2.0);
                [m[0] + out[0], m[1] + out[1]]
            };
            if !inside(&rings[0], middle) || rings.iter().skip(1).any(|hole| inside(hole, middle)) {
                continue;
            }
            covers.push(vec![vec![
                [s0, floor],
                [s1, floor],
                [s1, plane.z(at(s1))],
                [s0, plane.z(at(s0))],
            ]]);
        }
    }
    if covers.is_empty() {
        return Ok(vec![face.clone()]);
    }
    Ok(minus(&subject, &covers)?
        .into_iter()
        .map(|shape| Face3 {
            side: face.side,
            dormer: face.dormer,
            subroof: face.subroof,
            outward: face.outward,
            rings: shape
                .into_iter()
                .map(|r| {
                    r.into_iter()
                        .map(|[s, y]| {
                            let p = at(s);
                            [p[0], y, p[1]]
                        })
                        .collect()
                })
                .collect(),
        })
        .collect())
}

fn in_footprint(footprint: &RoofFootprint, point: Point) -> bool {
    inside(&footprint.outer, point) && !footprint.holes.iter().any(|hole| inside(hole, point))
}

/// Close the gap from a subroof's eaves down to the parent roof or a platform
/// that has already cut it. The roof planes themselves meet through clipping.
fn subroof_uprights(
    child: &RoofRequest,
    parent: &RoofRequest,
    parent_faces: &[Face3],
    index: usize,
) -> Vec<Face3> {
    let surfaces = parent_faces
        .iter()
        .filter_map(|face| face_plane(face).map(|plane| (face, plane)))
        .collect::<Vec<_>>();
    let mut result = Vec::new();
    let mut side = 0;
    for footprint in &child.footprints {
        for (ring_index, ring) in std::iter::once(&footprint.outer)
            .chain(&footprint.holes)
            .enumerate()
        {
            let toward_inside = if (area(ring) > 0.0) == (ring_index == 0) {
                1.0
            } else {
                -1.0
            };
            for i in 0..ring.len() {
                let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
                let d = sub(b, a);
                let at = |t: f64| [a[0] + d[0] * t, a[1] + d[1] * t];
                let mut stops = vec![0.0, 1.0];
                for (face, _) in &surfaces {
                    for boundary in &face.rings {
                        let plan = boundary.iter().map(|p| [p[0], p[2]]).collect::<Vec<_>>();
                        for j in 0..plan.len() {
                            stops.extend(crossing(a, b, plan[j], plan[(j + 1) % plan.len()]));
                        }
                    }
                }
                for cut in &parent.platform_cuts {
                    for boundary in
                        std::iter::once(&cut.footprint.outer).chain(&cut.footprint.holes)
                    {
                        for j in 0..boundary.len() {
                            stops.extend(crossing(
                                a,
                                b,
                                boundary[j],
                                boundary[(j + 1) % boundary.len()],
                            ));
                        }
                    }
                }
                stops.sort_by(f64::total_cmp);
                stops.dedup_by(|x, y| (*x - *y).abs() < 1e-9);
                for pair in stops.windows(2) {
                    let (t0, t1) = (pair[0], pair[1]);
                    if t1 - t0 < 1e-9 {
                        continue;
                    }
                    let middle = at((t0 + t1) / 2.0);
                    let under = surfaces
                        .iter()
                        .filter(|(face, _)| {
                            let outer = face.rings[0]
                                .iter()
                                .map(|p| [p[0], p[2]])
                                .collect::<Vec<_>>();
                            inside(&outer, middle)
                                && !face.rings.iter().skip(1).any(|hole| {
                                    inside(
                                        &hole.iter().map(|p| [p[0], p[2]]).collect::<Vec<_>>(),
                                        middle,
                                    )
                                })
                        })
                        .map(|(_, plane)| *plane)
                        .max_by(|left, right| left.z(middle).total_cmp(&right.z(middle)));
                    let floor = parent
                        .platform_cuts
                        .iter()
                        .filter(|cut| in_footprint(&cut.footprint, middle))
                        .map(|cut| cut.elevation)
                        .fold(f64::NEG_INFINITY, f64::max);
                    let bottom = |t: f64| {
                        under
                            .map_or(parent.elevation, |plane| plane.z(at(t)))
                            .max(floor)
                    };
                    let (mut lo, mut hi) = (t0, t1);
                    let (g0, g1) = (child.elevation - bottom(t0), child.elevation - bottom(t1));
                    if g0 <= 1e-7 && g1 <= 1e-7 {
                        continue;
                    }
                    if g0 * g1 < 0.0 {
                        let crossing = t0 + (t1 - t0) * g0 / (g0 - g1);
                        if g0 > 0.0 {
                            hi = crossing;
                        } else {
                            lo = crossing;
                        }
                    }
                    if hi - lo < 1e-9 {
                        continue;
                    }
                    let (p, q) = (at(lo), at(hi));
                    result.push(Face3 {
                        side,
                        dormer: None,
                        subroof: Some(index),
                        outward: Some([d[1] * toward_inside, -d[0] * toward_inside]),
                        rings: vec![vec![
                            [p[0], bottom(lo), p[1]],
                            [q[0], bottom(hi), q[1]],
                            [q[0], child.elevation, q[1]],
                            [p[0], child.elevation, p[1]],
                        ]],
                    });
                }
                side += 1;
            }
        }
    }
    result
}

/// Generates the connected visible envelope of a roof and its owned subroofs.
pub fn generate_roof_patch(mut request: RoofRequest) -> Result<RoofPatch, String> {
    let subroofs = std::mem::take(&mut request.subroofs);
    let main = generate_single_roof_patch(request.clone())?;
    if subroofs.is_empty() {
        return Ok(main);
    }
    let mut groups = vec![patch_faces(&main, None)];
    for (index, mut child) in subroofs.into_iter().enumerate() {
        if !child.subroofs.is_empty() {
            return Err("a subroof cannot contain another subroof".into());
        }
        child.subroofs.clear();
        let patch = generate_single_roof_patch(child.clone())?;
        let mut faces = patch_faces(&patch, Some(index));
        faces.extend(subroof_uprights(&child, &request, &groups[0], index));
        groups.push(faces);
    }
    weld(visible_roof_faces(&groups)?)
}

/// Shares nodes and edges between faces, splitting any edge another face's
/// corner lies on, and winds every face the same way round.
fn weld(faces: Vec<Face3>) -> Result<RoofPatch, String> {
    let extent = faces
        .iter()
        .flat_map(|face| face.rings.iter().flatten())
        .flat_map(|p| p.iter().map(|v| v.abs()))
        .fold(1.0_f64, f64::max);
    // Coordinates may have been through the f32 planar boolean.
    let eps = 5e-6 * extent;
    let mut nodes: Vec<[f64; 3]> = Vec::new();
    let mut node = |p: [f64; 3]| {
        nodes
            .iter()
            .position(|q| (0..3).all(|k| (p[k] - q[k]).abs() < eps))
            .unwrap_or_else(|| {
                nodes.push(p);
                nodes.len() - 1
            })
    };
    let mut indexed: Vec<(&Face3, Vec<Vec<usize>>)> = Vec::new();
    for face in &faces {
        let mut rings = Vec::new();
        for ring in &face.rings {
            let mut ids: Vec<usize> = ring.iter().map(|p| node(*p)).collect();
            ids.dedup();
            while ids.len() > 1 && ids.first() == ids.last() {
                ids.pop();
            }
            if ids.len() >= 3 {
                rings.push(ids);
            } else if rings.is_empty() {
                break;
            }
        }
        if !rings.is_empty() {
            indexed.push((face, rings));
        }
    }
    // Split each side at every corner lying on it: seams become shared edges.
    for (_, rings) in &mut indexed {
        for ring in rings.iter_mut() {
            let mut split = Vec::with_capacity(ring.len());
            for i in 0..ring.len() {
                let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
                split.push(a);
                let (pa, pb) = (nodes[a], nodes[b]);
                let d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
                let length_sq = d.iter().map(|v| v * v).sum::<f64>();
                let mut on: Vec<(f64, usize)> = nodes
                    .iter()
                    .enumerate()
                    .filter(|(k, _)| *k != a && *k != b)
                    .filter_map(|(k, p)| {
                        let w = [p[0] - pa[0], p[1] - pa[1], p[2] - pa[2]];
                        let t = (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / length_sq;
                        let off = (0..3)
                            .map(|j| (w[j] - t * d[j]).powi(2))
                            .sum::<f64>()
                            .sqrt();
                        (t > 1e-9 && t < 1.0 - 1e-9 && off < eps).then_some((t, k))
                    })
                    .collect();
                on.sort_by(|x, y| x.0.total_cmp(&y.0));
                split.extend(on.into_iter().map(|(_, k)| k));
            }
            *ring = split;
        }
    }
    // A strip with no width -- a side walked out and straight back, where two
    // events met at one instant -- is no part of its face.
    for (_, rings) in &mut indexed {
        for ring in rings.iter_mut() {
            loop {
                let n = ring.len();
                if n < 3 {
                    break;
                }
                let Some(i) = (0..n).find(|&i| {
                    ring[i] == ring[(i + 1) % n] || ring[(i + n - 1) % n] == ring[(i + 1) % n]
                }) else {
                    break;
                };
                if ring[i] == ring[(i + 1) % n] {
                    ring.remove(i);
                } else {
                    let back = (i + 1) % n;
                    let (first, second) = if back > i { (back, i) } else { (i, back) };
                    ring.remove(first);
                    ring.remove(second);
                }
            }
        }
        let outer_kept = rings.first().is_some_and(|ring| ring.len() >= 3);
        rings.retain(|ring| ring.len() >= 3);
        if !outer_kept {
            rings.clear();
        }
    }
    indexed.retain(|(_, rings)| !rings.is_empty());
    let mut edges: Vec<CapEdge> = Vec::new();
    let mut result = Vec::new();
    for (face, mut rings) in indexed {
        let points = |ring: &[usize]| ring.iter().map(|k| nodes[*k]).collect::<Vec<_>>();
        let n = normal(&points(&rings[0]));
        // Leaves wind with their normal down, as generated caps do; an upright
        // face's points into the roof, which is the same way round across a seam.
        let flipped = match face.outward {
            Some(out) => n[0] * out[0] + n[2] * out[1] > 0.0,
            None => n[1] > 0.0,
        };
        if flipped {
            rings[0].reverse();
        }
        // Holes wind against their face.
        let outer = if flipped { n.map(|v| -v) } else { n };
        for hole in rings.iter_mut().skip(1) {
            let hn = normal(&points(hole));
            if hn[0] * outer[0] + hn[1] * outer[1] + hn[2] * outer[2] > 0.0 {
                hole.reverse();
            }
        }
        let mut uses = |ring: &[usize]| {
            (0..ring.len())
                .map(|i| {
                    let (start, end) = (ring[i], ring[(i + 1) % ring.len()]);
                    match edges.iter().position(|e| {
                        (e.start == start && e.end == end) || (e.start == end && e.end == start)
                    }) {
                        Some(index) => (index, edges[index].start != start),
                        None => {
                            edges.push(CapEdge {
                                start,
                                end,
                                center: None,
                            });
                            (edges.len() - 1, false)
                        }
                    }
                })
                .collect::<Vec<_>>()
        };
        let boundary = uses(&rings[0]);
        let holes = rings[1..].iter().map(|ring| uses(ring)).collect();
        result.push(RoofFace {
            side: face.side,
            dormer: face.dormer,
            subroof: face.subroof,
            upright: face.outward.is_some(),
            boundary,
            holes,
        });
    }
    if result.is_empty() {
        return Err("the roof has no faces".into());
    }
    let preview = edges
        .iter()
        .map(|e| {
            let (a, b) = (nodes[e.start], nodes[e.end]);
            [a[0], a[1], a[2], b[0], b[1], b[2]]
        })
        .collect();
    Ok(RoofPatch {
        nodes,
        edges,
        faces: result,
        preview,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `along` runs the way the caller drew the side, whichever way round the
    /// ring winds: a clockwise outline once mirrored its dormers.
    #[test]
    fn a_dormer_stands_along_its_side_as_drawn_whichever_way_the_ring_winds() {
        for outer in [
            vec![[0.0, 0.0], [8.0, 0.0], [8.0, 4.0], [0.0, 4.0]],
            vec![[0.0, 0.0], [0.0, 4.0], [8.0, 4.0], [8.0, 0.0]],
        ] {
            // The side from (0,0) running along x is side 0 in the first ring, side 3 -- drawn from (8,0) -- in the second.
            let (side, along) = if outer[1][0] > 0.0 {
                (0, 0.25)
            } else {
                (3, 0.75)
            };
            let mut slopes = vec![0.0; 4];
            slopes[side] = 1.0;
            slopes[(side + 2) % 4] = 1.0;
            let mut request = roof(outer.clone(), vec![], slopes);
            request.dormers = vec![RoofDormer {
                side,
                along,
                setback: 1.0,
                width: 1.0,
                front: 0.5,
                slopes: [0.0, 1.0, 0.0, 1.0],
                absolute: false,
                gable_apart: false,
            }];
            let patch = generate_roof_patch(request).unwrap_or_else(|e| panic!("{outer:?}: {e}"));
            let front = patch
                .faces
                .iter()
                .find(|f| f.dormer == Some(0) && f.upright && f.side == 0)
                .expect("a front");
            let xs: Vec<f64> = front
                .boundary
                .iter()
                .map(|(e, _)| patch.nodes[patch.edges[*e].start][0])
                .collect();
            let middle = (xs.iter().copied().fold(f64::INFINITY, f64::min)
                + xs.iter().copied().fold(f64::NEG_INFINITY, f64::max))
                / 2.0;
            assert!(
                (middle - 2.0).abs() < 1e-6,
                "{outer:?}: its front's middle at x = {middle}, not 2"
            );
        }
    }

    /// A reflex corner landing exactly on another front's corner once parted
    /// and rejoined the wavefront forever at that instant.
    #[test]
    fn a_reflex_corner_landing_on_a_corner_closes_the_skeleton() {
        let cases: Vec<(Vec<[f64; 2]>, Vec<f64>)> = vec![
            (
                vec![
                    [4., 0.],
                    [5., 2.],
                    [1., 2.],
                    [0., 3.],
                    [-1., 2.],
                    [-2., 2.],
                    [-3., 1.],
                    [-3., -1.],
                    [-3., -2.],
                    [-3., -5.],
                    [1., -5.],
                    [1., -2.],
                    [3., -2.],
                ],
                vec![
                    0.9367653311230242,
                    1.,
                    2.1598419638350608,
                    0.,
                    0.,
                    1.0612861400470137,
                    1.,
                    0.,
                    0.9891455749049782,
                    1.,
                    2.0597839414142074,
                    2.1776038066484036,
                    0.3200293707661331,
                ],
            ),
            (
                vec![
                    [3., 0.],
                    [2.5, 1.],
                    [3., 4.5],
                    [1., 5.],
                    [-1., 5.5],
                    [-3., 3.],
                    [-4., 2.],
                    [-2.5, 0.],
                    [-5., -2.],
                    [-3.5, -4.],
                    [-1., -5.],
                    [1., -6.],
                    [2., -2.],
                    [2., -1.],
                ],
                vec![
                    1.6112339597195386,
                    1.,
                    0.304359517339617,
                    1.1410708020441234,
                    0.,
                    0.8817245054990053,
                    1.2556521965190768,
                    1.5376726023852825,
                    1.8549506234005093,
                    1.,
                    1.,
                    0.,
                    1.4373796277679503,
                    1.3197040225379169,
                ],
            ),
            (
                vec![
                    [2., 0.],
                    [5., 2.],
                    [2., 2.],
                    [1., 5.],
                    [0., 5.],
                    [-2., 4.],
                    [-4., 3.],
                    [-5., 1.],
                    [-6., -1.],
                    [-4., -3.],
                    [-2., -3.],
                    [0., -3.],
                    [2., -5.],
                    [4., -4.],
                    [5., -2.],
                ],
                vec![
                    1.,
                    1.7528951520100235,
                    1.0216088656336069,
                    1.,
                    1.6503604979254305,
                    2.077596903126687,
                    0.4171107758767903,
                    1.,
                    0.7263207470998168,
                    0.,
                    1.,
                    1.8246315846219658,
                    0.,
                    2.1540795772336425,
                    1.,
                ],
            ),
        ];
        for (outer, slopes) in cases {
            let patch = generate_roof_patch(roof(outer.clone(), vec![], slopes))
                .unwrap_or_else(|e| panic!("{outer:?}: {e}"));
            assert!(closed(&patch, 3.0), "{outer:?}");
        }
    }

    fn roof(outer: Vec<[f64; 2]>, holes: Vec<Vec<[f64; 2]>>, slopes: Vec<f64>) -> RoofRequest {
        RoofRequest {
            elevation: 3.0,
            height: 2.0,
            footprints: vec![RoofFootprint { outer, holes }],
            slopes,
            dormers: Vec::new(),
            cutouts: Vec::new(),
            platform_cuts: Vec::new(),
            subroofs: Vec::new(),
        }
    }

    fn rectangle(slopes: [f64; 4]) -> RoofRequest {
        roof(
            vec![[0.0, 0.0], [8.0, 0.0], [8.0, 4.0], [0.0, 4.0]],
            Vec::new(),
            slopes.to_vec(),
        )
    }

    fn edge_uses(patch: &RoofPatch) -> Vec<usize> {
        let mut count = vec![0; patch.edges.len()];
        for face in &patch.faces {
            for (edge, _) in face.boundary.iter().chain(face.holes.iter().flatten()) {
                count[*edge] += 1;
            }
        }
        count
    }

    /// Every edge shared by two faces, but the eaves and the gables' feet at `elevation`.
    fn closed(patch: &RoofPatch, elevation: f64) -> bool {
        edge_uses(patch).iter().zip(&patch.edges).all(|(n, e)| {
            *n == 2
                || (*n == 1
                    && (patch.nodes[e.start][1] - elevation).abs() < 1e-4
                    && (patch.nodes[e.end][1] - elevation).abs() < 1e-4)
        })
    }

    #[test]
    fn four_waters_make_a_hip_roof_with_a_ridge() {
        let patch = generate_roof_patch(rectangle([1.0; 4])).unwrap();
        assert_eq!(patch.faces.len(), 4);
        let top: Vec<_> = patch
            .nodes
            .iter()
            .filter(|p| (p[1] - 5.0).abs() < 1e-9)
            .collect();
        assert_eq!(top.len(), 2, "a ridge, not an apex");
        assert!(top.iter().all(|p| (p[2] - 2.0).abs() < 1e-9));
        assert!(closed(&patch, 3.0));
    }

    #[test]
    fn a_subroof_in_the_middle_replaces_hidden_parent_leaves_and_closes_its_eaves() {
        let mut parent = roof(
            vec![[0.0, 0.0], [8.0, 0.0], [8.0, 6.0], [0.0, 6.0]],
            Vec::new(),
            vec![1.0; 4],
        );
        parent.elevation = 0.0;
        parent.height = 2.0;
        let mut child = roof(
            vec![[2.0, 2.0], [6.0, 2.0], [6.0, 4.0], [2.0, 4.0]],
            Vec::new(),
            vec![1.0; 4],
        );
        child.elevation = 1.5;
        child.height = 2.0;
        parent.subroofs.push(child);
        let patch = generate_roof_patch(parent).unwrap();
        let faces = patch_faces(&patch, None);
        let at_center = |face: &Face3| {
            let plan = face.rings[0]
                .iter()
                .map(|p| [p[0], p[2]])
                .collect::<Vec<_>>();
            inside(&plan, [3.5, 2.5])
                && !face.rings.iter().skip(1).any(|ring| {
                    inside(
                        &ring.iter().map(|p| [p[0], p[2]]).collect::<Vec<_>>(),
                        [3.5, 2.5],
                    )
                })
        };
        assert!(
            faces
                .iter()
                .any(|face| face.subroof == Some(0) && face.outward.is_none() && at_center(face))
        );
        assert!(
            !faces
                .iter()
                .any(|face| face.subroof.is_none() && face.outward.is_none() && at_center(face))
        );
        assert!(
            faces
                .iter()
                .any(|face| face.subroof == Some(0) && face.outward.is_some())
        );
    }

    #[test]
    fn a_square_rises_to_one_apex() {
        let patch = generate_roof_patch(roof(
            vec![[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0]],
            Vec::new(),
            vec![1.0; 4],
        ))
        .unwrap();
        assert_eq!(patch.faces.len(), 4);
        assert_eq!(
            patch
                .nodes
                .iter()
                .filter(|p| (p[1] - 5.0).abs() < 1e-9)
                .count(),
            1
        );
        assert!(closed(&patch, 3.0));
    }

    #[test]
    fn two_waters_close_their_ends_with_upright_gables() {
        let patch = generate_roof_patch(rectangle([1.0, 0.0, 1.0, 0.0])).unwrap();
        assert_eq!(patch.faces.iter().filter(|f| !f.upright).count(), 2);
        assert_eq!(patch.faces.iter().filter(|f| f.upright).count(), 2);
        let top: Vec<_> = patch
            .nodes
            .iter()
            .filter(|p| (p[1] - 5.0).abs() < 1e-9)
            .collect();
        assert!(
            top.iter().any(|p| p[0].abs() < 1e-9) && top.iter().any(|p| (p[0] - 8.0).abs() < 1e-9)
        );
        assert!(closed(&patch, 3.0));
    }

    #[test]
    fn one_water_rises_to_the_far_side() {
        let patch = generate_roof_patch(rectangle([1.0, 0.0, 0.0, 0.0])).unwrap();
        assert_eq!(patch.faces.iter().filter(|f| !f.upright).count(), 1);
        let high: Vec<_> = patch
            .nodes
            .iter()
            .filter(|p| (p[1] - 5.0).abs() < 1e-9)
            .collect();
        assert!(high.len() == 2 && high.iter().all(|p| (p[2] - 4.0).abs() < 1e-9));
        assert!(closed(&patch, 3.0));
    }

    #[test]
    fn a_steeper_leaf_moves_the_ridge_toward_it() {
        let patch = generate_roof_patch(rectangle([2.0, 0.0, 1.0, 0.0])).unwrap();
        let ridge = patch
            .nodes
            .iter()
            .find(|p| (p[1] - 5.0).abs() < 1e-9)
            .unwrap();
        assert!(ridge[2] < 2.0 - 1e-6);
    }

    #[test]
    fn any_outline_is_covered_an_l_a_notched_shape_and_a_slanted_one() {
        let shapes = [
            vec![
                [0.0, 0.0],
                [10.0, 0.0],
                [10.0, 4.0],
                [4.0, 4.0],
                [4.0, 10.0],
                [0.0, 10.0],
            ],
            vec![
                [0.0, 0.0],
                [8.0, 0.0],
                [8.0, 6.0],
                [5.0, 6.0],
                [4.0, 3.0],
                [3.0, 6.0],
                [0.0, 6.0],
            ],
            vec![[0.0, 0.0], [7.0, 1.0], [9.0, 5.0], [5.0, 4.0], [2.0, 7.0]],
            vec![
                [0.0, 0.0],
                [6.0, -1.0],
                [9.0, 2.0],
                [6.5, 3.0],
                [8.0, 6.0],
                [1.0, 5.0],
                [2.5, 2.5],
            ],
        ];
        for outer in shapes {
            let n = outer.len();
            let patch = generate_roof_patch(roof(outer.clone(), Vec::new(), vec![1.0; n]))
                .unwrap_or_else(|e| panic!("{outer:?}: {e}"));
            assert!(closed(&patch, 3.0), "{outer:?}");
            assert!(
                patch.nodes.iter().any(|p| (p[1] - 5.0).abs() < 1e-6),
                "{outer:?} reaches its height"
            );
            // The eave runs round the outline and nowhere else.
            let perimeter: f64 = (0..n)
                .map(|i| {
                    let (a, b) = (outer[i], outer[(i + 1) % n]);
                    (a[0] - b[0]).hypot(a[1] - b[1])
                })
                .sum();
            let eave: f64 = patch
                .edges
                .iter()
                .zip(edge_uses(&patch))
                .filter(|(_, u)| *u == 1)
                .map(|(e, _)| {
                    let (a, b) = (patch.nodes[e.start], patch.nodes[e.end]);
                    (a[0] - b[0]).hypot(a[2] - b[2])
                })
                .sum();
            assert!(
                (eave - perimeter).abs() < 1e-4,
                "{outer:?}: {eave} vs {perimeter}"
            );
        }
    }

    #[test]
    fn a_courtyard_roof_falls_toward_its_hole_too() {
        let hole = vec![[3.0, 3.0], [3.0, 7.0], [7.0, 7.0], [7.0, 3.0]];
        let patch = generate_roof_patch(roof(
            vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]],
            vec![hole],
            vec![1.0; 8],
        ))
        .unwrap();
        assert_eq!(patch.faces.len(), 8);
        assert!(closed(&patch, 3.0));
    }

    #[test]
    fn a_cutout_opens_a_leaf_without_moving_the_ridge() {
        let original = generate_roof_patch(rectangle([1.0, 0.0, 1.0, 0.0])).unwrap();
        let mut request = rectangle([1.0, 0.0, 1.0, 0.0]);
        request.cutouts.push(RoofFootprint {
            outer: vec![[2.0, 0.5], [4.0, 0.5], [4.0, 1.5], [2.0, 1.5]],
            holes: Vec::new(),
        });
        let cut = generate_roof_patch(request).unwrap();
        assert!(cut.faces.iter().any(|face| !face.holes.is_empty()));
        let peak = |patch: &RoofPatch| {
            patch
                .nodes
                .iter()
                .map(|p| p[1])
                .fold(f64::NEG_INFINITY, f64::max)
        };
        assert!((peak(&cut) - peak(&original)).abs() < 1e-9);
        assert!(cut.faces.iter().all(|face| face.side < 4));
    }

    #[test]
    fn a_cutout_crossing_a_ridge_opens_both_leaves() {
        let mut request = rectangle([1.0, 0.0, 1.0, 0.0]);
        request.cutouts.push(RoofFootprint {
            outer: vec![[2.0, 1.5], [4.0, 1.5], [4.0, 2.5], [2.0, 2.5]],
            holes: Vec::new(),
        });
        let cut = generate_roof_patch(request).unwrap();
        // At the ridge the cut becomes a notch in both leaves, rather than
        // an inner loop in either one.
        for x in [2.0, 4.0] {
            assert!(cut.nodes.iter().any(|p| (p[0] - x).abs() < 1e-5
                && (p[1] - 5.0).abs() < 1e-5
                && (p[2] - 2.0).abs() < 1e-5));
        }
    }

    #[test]
    fn an_invalid_cutout_is_refused() {
        let mut request = rectangle([1.0; 4]);
        request.cutouts.push(RoofFootprint {
            outer: vec![[0.0, 0.0], [1.0, 0.0]],
            holes: Vec::new(),
        });
        assert!(generate_roof_patch(request).is_err());
    }

    #[test]
    fn a_cutout_respects_its_own_hole() {
        let mut request = rectangle([1.0, 0.0, 1.0, 0.0]);
        request.cutouts.push(RoofFootprint {
            outer: vec![[1.0, 0.4], [5.0, 0.4], [5.0, 1.6], [1.0, 1.6]],
            holes: vec![vec![[2.0, 0.8], [4.0, 0.8], [4.0, 1.2], [2.0, 1.2]]],
        });
        let patch = generate_roof_patch(request).unwrap();
        assert!(
            patch
                .faces
                .iter()
                .filter(|face| face.side == 0 && !face.upright)
                .count()
                > 1,
            "{:?}",
            patch.faces
        );
    }

    #[test]
    fn platform_cut_keeps_lower_slope_and_closes_its_rim() {
        let mut request = rectangle([1.0, 0.0, 1.0, 0.0]);
        request.platform_cuts.push(RoofPlatformCut {
            footprint: RoofFootprint {
                outer: vec![[2.0, 0.5], [4.0, 0.5], [4.0, 1.5], [2.0, 1.5]],
                holes: Vec::new(),
            },
            elevation: 4.2,
        });
        let patch = generate_roof_patch(request).unwrap();
        assert!(patch.nodes.iter().any(|p| (p[0] - 2.0).abs() < 1e-5
            && (p[1] - 4.2).abs() < 1e-5
            && (p[2] - 1.2).abs() < 1e-5));
        let upright = patch.faces.iter().find(|face| {
            face.upright
                && face.boundary.iter().any(|(edge, _)| {
                    let edge = &patch.edges[*edge];
                    [edge.start, edge.end].iter().any(|node| {
                        let p = patch.nodes[*node];
                        (p[0] - 2.0).abs() < 1e-5
                            && (p[1] - 4.2).abs() < 1e-5
                            && (p[2] - 1.5).abs() < 1e-5
                    })
                })
        });
        assert!(
            upright.is_some(),
            "the cut must meet the platform at its rim"
        );
        assert!(patch.nodes.iter().any(|p| (p[0] - 2.0).abs() < 1e-5
            && (p[1] - 4.5).abs() < 1e-5
            && (p[2] - 1.5).abs() < 1e-5));
    }

    #[test]
    fn sides_keep_their_numbers_whichever_way_a_ring_winds() {
        let mut request = rectangle([1.0, 0.0, 1.0, 0.0]);
        request.footprints[0].outer.reverse();
        // Reversed, side i runs from corner i to i + 1 of the new order: the gables are now sides 0 and 2.
        request.slopes = vec![0.0, 1.0, 0.0, 1.0];
        let patch = generate_roof_patch(request).unwrap();
        assert!(
            patch
                .faces
                .iter()
                .filter(|f| f.upright)
                .all(|f| f.side == 0 || f.side == 2)
        );
        assert!(
            patch
                .faces
                .iter()
                .filter(|f| !f.upright)
                .all(|f| f.side == 1 || f.side == 3)
        );
    }

    #[test]
    fn random_outlines_close_with_their_eave_round_the_outline() {
        // A fixed stream of star-shaped outlines: random angles and reaches round a centre.
        let mut seed = 0x2545_f491_4f6c_dd1d_u64;
        let mut next = || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            (seed >> 11) as f64 / (1u64 << 53) as f64
        };
        let (mut ran, mut raised) = (0, 0);
        for case in 0..600 {
            let n = 4 + (next() * 11.0) as usize;
            let mut angles: Vec<f64> = (0..n).map(|_| next() * std::f64::consts::TAU).collect();
            angles.sort_by(f64::total_cmp);
            // Simple only while the centre stays inside: no gap between angles of half a turn or more.
            let wrap = angles[0] + std::f64::consts::TAU - angles[n - 1];
            let spaced = |gap: f64| (0.05..3.0).contains(&gap);
            if !angles.windows(2).all(|w| spaced(w[1] - w[0])) || !spaced(wrap) {
                continue;
            }
            let outer: Vec<[f64; 2]> = angles
                .iter()
                .map(|a| {
                    let r = 2.0 + next() * 6.0;
                    [r * a.cos(), r * a.sin()]
                })
                .collect();
            let slopes: Vec<f64> = (0..n)
                .map(|_| {
                    if next() < 0.15 {
                        0.0
                    } else {
                        0.5 + next() * 1.5
                    }
                })
                .collect();
            if slopes.iter().all(|s| *s == 0.0) {
                continue;
            }
            let patch = generate_roof_patch(roof(outer.clone(), Vec::new(), slopes.clone()))
                .unwrap_or_else(|e| {
                    panic!(
                        "case {case}: {e}
{outer:?}
{slopes:?}"
                    )
                });
            assert!(
                closed(&patch, 3.0),
                "case {case}: open
{outer:?}
{slopes:?}"
            );
            assert!(
                patch
                    .nodes
                    .iter()
                    .all(|p| p[1] >= 3.0 - 1e-6 && p[1] <= 5.0 + 1e-6),
                "case {case}: out of range"
            );
            ran += 1;
            // A dormer on the longest pitched side, where one fits.
            let longest = (0..n).filter(|i| slopes[*i] > 0.0).max_by(|a, b| {
                let len = |i: usize| {
                    let (p, q) = (outer[i], outer[(i + 1) % n]);
                    (p[0] - q[0]).hypot(p[1] - q[1])
                };
                len(*a).total_cmp(&len(*b))
            });
            if let Some(side) = longest {
                let mut request = roof(outer.clone(), Vec::new(), slopes.clone());
                request.height = 4.0;
                request.dormers.push(RoofDormer {
                    side,
                    along: 0.5,
                    setback: 0.4,
                    width: 1.0,
                    front: 0.6,
                    slopes: [0.0, 1.0, 0.0, 1.0],
                    absolute: false,
                    gable_apart: false,
                });
                if let Ok(patch) = generate_roof_patch(request) {
                    raised += 1;
                    assert!(
                        closed(&patch, 3.0),
                        "case {case}: dormer left it open
{outer:?}
{slopes:?}"
                    );
                }
            }
        }
        assert!(ran > 250, "only {ran} outlines were simple");
        assert!(raised > 100, "only {raised} dormers fitted");
    }

    fn dormer(slopes: [f64; 4]) -> RoofDormer {
        RoofDormer {
            side: 0,
            along: 0.5,
            setback: 0.5,
            width: 2.0,
            front: 1.0,
            slopes,
            absolute: false,
            gable_apart: false,
        }
    }

    #[test]
    fn a_dormer_front_set_apart_from_its_gable_is_a_plain_wall_to_its_eaves() {
        let mut request = rectangle([1.0, 0.0, 1.0, 0.0]);
        request.height = 4.0;
        request.dormers.push(RoofDormer {
            gable_apart: true,
            ..dormer([0.0, 1.0, 0.0, 1.0])
        });
        let patch = generate_roof_patch(request).unwrap();
        let ring = |f: &RoofFace| {
            f.boundary
                .iter()
                .map(|(e, rev)| {
                    patch.nodes[if *rev {
                        patch.edges[*e].end
                    } else {
                        patch.edges[*e].start
                    }]
                })
                .collect::<Vec<_>>()
        };
        let front = patch
            .faces
            .iter()
            .find(|f| f.dormer == Some(0) && f.upright && f.side == 0)
            .expect("a front");
        let gable = patch
            .faces
            .iter()
            .find(|f| f.dormer == Some(0) && f.upright && f.side == GABLE_OVER_FRONT)
            .expect("a gable apart");
        let ys = ring(front).iter().map(|p| p[1]).collect::<Vec<_>>();
        let (low, high) = (
            ys.iter().copied().fold(f64::INFINITY, f64::min),
            ys.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        );
        // Its foot may be split where the leaf's cut meets it; it stands only at its foot and its eaves.
        assert!(
            ring(front)
                .iter()
                .all(|p| (p[1] - low).abs() < 1e-6 || (p[1] - high).abs() < 1e-6),
            "the front is a rectangle: {:?}",
            ring(front)
        );
        assert!(
            (high - low - 1.0).abs() < 1e-6,
            "as high as the dormer's front: {low}..{high}"
        );
        assert!(
            ring(gable).iter().all(|p| p[1] >= high - 1e-6),
            "the gable stands over it"
        );
        assert!(closed(&patch, 3.0));
    }

    #[test]
    fn a_gable_dormer_opens_its_leaf_and_closes_the_gap_with_a_front_and_cheeks() {
        let mut request = rectangle([1.0, 0.0, 1.0, 0.0]);
        request.height = 4.0;
        request.dormers.push(dormer([0.0, 1.0, 0.0, 1.0]));
        let patch = generate_roof_patch(request).unwrap();
        let own: Vec<_> = patch.faces.iter().filter(|f| f.dormer == Some(0)).collect();
        assert_eq!(own.iter().filter(|f| !f.upright).count(), 2);
        assert!(own.iter().any(|f| f.upright && f.side == 0), "a front");
        assert!(
            own.iter().any(|f| f.upright && f.side == 1)
                && own.iter().any(|f| f.upright && f.side == 3),
            "two cheeks"
        );
        assert!(closed(&patch, 3.0));
    }

    #[test]
    fn shed_and_hip_dormers_raise_as_well_on_any_outline() {
        let outer = vec![
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 4.0],
            [4.0, 4.0],
            [4.0, 10.0],
            [0.0, 10.0],
        ];
        for slopes in [[0.5, 0.0, 0.0, 0.0], [1.0, 1.0, 0.0, 1.0]] {
            let mut request = roof(outer.clone(), Vec::new(), vec![1.0; 6]);
            request.height = 5.0;
            request.dormers.push(RoofDormer {
                along: 0.3,
                ..dormer(slopes)
            });
            let patch = generate_roof_patch(request).unwrap();
            assert!(
                patch
                    .faces
                    .iter()
                    .any(|f| f.dormer == Some(0) && !f.upright),
                "{slopes:?}"
            );
            assert!(closed(&patch, 3.0), "{slopes:?}");
        }
    }

    #[test]
    fn footprints_joined_at_a_corner_are_one_roof_meeting_there() {
        let mut request = roof(
            vec![[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0]],
            Vec::new(),
            vec![1.0; 8],
        );
        request.footprints.push(RoofFootprint {
            outer: vec![[4.0, 4.0], [8.0, 4.0], [8.0, 8.0], [4.0, 8.0]],
            holes: Vec::new(),
        });
        let patch = generate_roof_patch(request).unwrap();
        assert_eq!(patch.faces.len(), 8);
        assert!(closed(&patch, 3.0));
        // The corner they share is one node of both.
        let shared = patch
            .nodes
            .iter()
            .position(|p| {
                (p[0] - 4.0).abs() < 1e-9 && (p[2] - 4.0).abs() < 1e-9 && (p[1] - 3.0).abs() < 1e-9
            })
            .unwrap();
        let faces_at = patch
            .faces
            .iter()
            .filter(|f| {
                f.boundary
                    .iter()
                    .any(|(e, _)| patch.edges[*e].start == shared || patch.edges[*e].end == shared)
            })
            .count();
        assert_eq!(faces_at, 4, "two leaves of each roof meet at it");
    }

    #[test]
    fn a_footprint_crossing_itself_is_refused() {
        let bow = roof(
            vec![[0.0, 0.0], [4.0, 4.0], [4.0, 0.0], [0.0, 4.0]],
            Vec::new(),
            vec![1.0; 4],
        );
        assert!(generate_roof_patch(bow).is_err());
    }

    #[test]
    fn malformed_roofs_are_rejected() {
        assert!(generate_roof_patch(rectangle([0.0; 4])).is_err());
        let mut request = rectangle([1.0; 4]);
        request.height = 0.0;
        assert!(generate_roof_patch(request).is_err());
        let mut request = rectangle([1.0, 0.0, 1.0, 0.0]);
        request.dormers.push(RoofDormer {
            side: 1,
            ..dormer([0.0, 1.0, 0.0, 1.0])
        });
        assert!(
            generate_roof_patch(request).is_err(),
            "a dormer needs a pitched leaf"
        );
    }
}
