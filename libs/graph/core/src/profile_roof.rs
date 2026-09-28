//! Roofs raised over convex footprints, one leaf per footprint side.
//!
//! Every side of a block either rises inward at its own slope -- a pitched
//! leaf -- or does not rise at all -- a gable, closed by a vertical face. A
//! block's roof is the lower envelope of its leaf planes, which is exactly the
//! weighted straight skeleton of a convex footprint. Overlapping blocks join
//! as the upper envelope of their roofs: an L, T or cross plan gets its
//! valleys from where one block's roof climbs out of another's.
//!
//! One water, two waters and four waters are only which sides are pitched.
use crate::planar::{PlanarBoolean, planar_boolean};
use crate::profile_cap_patch::CapEdge;

/// One convex footprint and the role of each of its sides.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RoofBlock {
    /// Footprint corners in XZ, in either winding. Side `i` runs from corner
    /// `i` to corner `i + 1`.
    pub contour: Vec<[f64; 2]>,
    /// Relative steepness of each side's leaf; zero makes that side a gable.
    pub slopes: Vec<f64>,
    /// How far each side's eave reaches out past the footprint.
    pub overhangs: Vec<f64>,
}

/// A whole roof: its blocks, where they stand and how high the roof rises.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RoofRequest {
    /// Elevation of every eave.
    pub elevation: f64,
    /// Rise of the highest point of the roof above the eaves.
    pub height: f64,
    /// Convex blocks joined into one roof.
    pub blocks: Vec<RoofBlock>,
}

/// One logical roof face over shared indexed edges.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "curve-serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RoofFace {
    /// Index of the block this face belongs to.
    pub block: usize,
    /// Index of the footprint side this face rises from.
    pub side: usize,
    /// Whether this is the vertical face closing a gable side.
    pub gable: bool,
    /// `(edge index, reversed)` uses of the outer loop.
    pub boundary: Vec<(usize, bool)>,
    /// Inner loops, where another block's roof climbs through this face.
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
    /// Pitched leaves and gable faces.
    pub faces: Vec<RoofFace>,
    /// Transient XYZ segment endpoints of every edge, for a preview.
    pub preview: Vec<[f64; 6]>,
}

type Point = [f64; 2];

/// The plane a side's leaf lies in: `slope * (normal . x - offset)` above the eave.
#[derive(Clone, Copy)]
struct Leaf {
    normal: Point,
    offset: f64,
    slope: f64,
}

impl Leaf {
    fn rise(&self, x: Point) -> f64 {
        self.slope * (dot(self.normal, x) - self.offset)
    }
}

struct Block {
    contour: Vec<Point>,
    leaves: Vec<Leaf>,
}

impl Block {
    fn pitched(&self) -> impl Iterator<Item = (usize, &Leaf)> {
        self.leaves
            .iter()
            .enumerate()
            .filter(|(_, leaf)| leaf.slope > 0.0)
    }

    /// The part of this block where its roof reaches at least `other`'s plane,
    /// ties going to the later of the two by `wins_ties`.
    fn above(&self, other: &Leaf, wins_ties: bool) -> Vec<Point> {
        let mut region = self.contour.clone();
        for (_, leaf) in self.pitched() {
            match half_plane(other, leaf) {
                HalfPlane::Line(a, b) => region = clip(&region, a, b),
                HalfPlane::Nowhere => return Vec::new(),
                HalfPlane::Everywhere => {}
                HalfPlane::Tie if wins_ties => {}
                HalfPlane::Tie => return Vec::new(),
            }
            if region.len() < 3 {
                return Vec::new();
            }
        }
        region
    }
}

enum HalfPlane {
    Line(Point, f64),
    Everywhere,
    Nowhere,
    Tie,
}

/// Where `low` stays at or below `high`: `a . x <= b`.
fn half_plane(low: &Leaf, high: &Leaf) -> HalfPlane {
    let a = [
        low.slope * low.normal[0] - high.slope * high.normal[0],
        low.slope * low.normal[1] - high.slope * high.normal[1],
    ];
    let b = low.slope * low.offset - high.slope * high.offset;
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

fn dot(a: Point, b: Point) -> f64 {
    a[0] * b[0] + a[1] * b[1]
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

/// Keeps the part of a convex polygon where `a . x <= b`.
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

fn prepare(block: &RoofBlock) -> Result<Block, String> {
    let n = block.contour.len();
    if n < 3 || block.slopes.len() != n || block.overhangs.len() != n {
        return Err(
            "a roof block needs three or more sides, each with a slope and an overhang".into(),
        );
    }
    if block.contour.iter().flatten().any(|v| !v.is_finite())
        || block.slopes.iter().any(|s| !s.is_finite() || *s < 0.0)
        || block.overhangs.iter().any(|o| !o.is_finite() || *o < 0.0)
    {
        return Err("roof coordinates, slopes and overhangs must be finite and nonnegative".into());
    }
    if block.slopes.iter().all(|s| *s == 0.0) {
        return Err("a roof block needs at least one pitched side".into());
    }
    let winding = area(&block.contour).signum();
    if winding == 0.0 || area(&block.contour).abs() < 1e-9 {
        return Err("a roof block footprint has no area".into());
    }
    let mut leaves = Vec::with_capacity(n);
    for i in 0..n {
        let (a, b) = (block.contour[i], block.contour[(i + 1) % n]);
        let d = [b[0] - a[0], b[1] - a[1]];
        let length = d[0].hypot(d[1]);
        if length < 1e-9 {
            return Err("a roof block has a zero-length side".into());
        }
        let normal = [-d[1] * winding / length, d[0] * winding / length];
        leaves.push(Leaf {
            normal,
            offset: dot(normal, a) - block.overhangs[i],
            slope: block.slopes[i],
        });
        let next = block.contour[(i + 2) % n];
        let e = [next[0] - b[0], next[1] - b[1]];
        let turn = (d[0] * e[1] - d[1] * e[0]) * winding;
        if turn < -1e-9 * length * e[0].hypot(e[1]) {
            return Err(
                "a roof block footprint must be convex; join convex blocks for other plans".into(),
            );
        }
    }
    // Eave corners: where neighbouring sides meet once pushed out by their overhangs.
    let mut contour = Vec::with_capacity(n);
    for j in 0..n {
        let (p, q) = (leaves[(j + n - 1) % n], leaves[j]);
        let det = p.normal[0] * q.normal[1] - p.normal[1] * q.normal[0];
        if det.abs() < 1e-12 {
            if (block.overhangs[(j + n - 1) % n] - block.overhangs[j]).abs() > 1e-9 {
                return Err("aligned roof sides need the same overhang".into());
            }
            let c = block.contour[j];
            contour.push([
                c[0] - q.normal[0] * block.overhangs[j],
                c[1] - q.normal[1] * block.overhangs[j],
            ]);
        } else {
            contour.push([
                (p.offset * q.normal[1] - q.offset * p.normal[1]) / det,
                (p.normal[0] * q.offset - q.normal[0] * p.offset) / det,
            ]);
        }
    }
    Ok(Block { contour, leaves })
}

/// Rings of one face in plan: outer first, then holes.
type PlanFace = Vec<Vec<Point>>;

/// The part of side `side` of block `b` that is its roof and nobody else's.
fn visible_leaf(blocks: &[Block], b: usize, side: usize) -> Result<Vec<PlanFace>, String> {
    let block = &blocks[b];
    let leaf = block.leaves[side];
    let mut own = block.contour.clone();
    for (j, other) in block.pitched() {
        if j == side {
            continue;
        }
        match half_plane(&leaf, other) {
            HalfPlane::Line(a, c) => own = clip(&own, a, c),
            HalfPlane::Nowhere => return Ok(Vec::new()),
            HalfPlane::Everywhere => {}
            HalfPlane::Tie if j > side => {}
            HalfPlane::Tie => return Ok(Vec::new()),
        }
        if own.len() < 3 {
            return Ok(Vec::new());
        }
    }
    if area(&own).abs() < 1e-9 {
        return Ok(Vec::new());
    }
    let covers: Vec<Vec<Point>> = blocks
        .iter()
        .enumerate()
        .filter(|(c, _)| *c != b)
        .map(|(c, other)| other.above(&leaf, c > b))
        .filter(|region| region.len() >= 3 && area(region).abs() > 1e-9)
        .collect();
    if covers.is_empty() {
        return Ok(vec![vec![own]]);
    }
    let to32 = |ring: &Vec<Point>| {
        ring.iter()
            .map(|p| [p[0] as f32, p[1] as f32])
            .collect::<Vec<_>>()
    };
    let shapes = planar_boolean(
        &[vec![to32(&own)]],
        &covers
            .iter()
            .map(|ring| vec![to32(ring)])
            .collect::<Vec<_>>(),
        PlanarBoolean::Difference,
    )?;
    Ok(shapes
        .into_iter()
        .map(|shape| {
            shape
                .into_iter()
                .map(|ring| {
                    ring.into_iter()
                        .map(|p| [f64::from(p[0]), f64::from(p[1])])
                        .collect()
                })
                .collect::<PlanFace>()
        })
        .filter(|face: &PlanFace| area(&face[0]).abs() > 1e-6)
        .collect())
}

fn inside_convex(polygon: &[Point], x: Point) -> bool {
    let winding = area(polygon).signum();
    (0..polygon.len()).all(|i| {
        let (a, b) = (polygon[i], polygon[(i + 1) % polygon.len()]);
        ((b[0] - a[0]) * (x[1] - a[1]) - (b[1] - a[1]) * (x[0] - a[0])) * winding > 1e-6
    })
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

struct Face3 {
    block: usize,
    side: usize,
    gable: bool,
    rings: Vec<Vec<[f64; 3]>>,
}

fn inside_polygon(polygon: &[Point], x: Point) -> bool {
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

/// Distinct values of one coordinate, in order.
fn cuts(values: impl Iterator<Item = f64>, eps: f64) -> Vec<f64> {
    let mut values: Vec<f64> = values.collect();
    values.sort_by(f64::total_cmp);
    values.dedup_by(|a, b| (*a - *b).abs() < eps);
    values
}

/// Splits a footprint into the convex blocks a roof is raised over.
///
/// A convex footprint is its own block. An orthogonal one -- every corner
/// square, as an L, T, U or cross plan is -- becomes its maximal rectangles,
/// which overlap where its arms meet so the joined roof gets its valleys
/// there. Other concave footprints are refused.
pub fn footprint_blocks(contour: &[[f64; 2]]) -> Result<Vec<Vec<[f64; 2]>>, String> {
    if contour.iter().flatten().any(|v| !v.is_finite()) {
        return Err("footprint coordinates must be finite".into());
    }
    // Drop repeated and straight-through corners.
    let mut points = contour.to_vec();
    loop {
        let n = points.len();
        if n < 3 {
            return Err("a footprint needs three or more corners".into());
        }
        let redundant = (0..n).find(|&i| {
            let (a, b, c) = (points[(i + n - 1) % n], points[i], points[(i + 1) % n]);
            let cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
            let scale = (b[0] - a[0]).hypot(b[1] - a[1]) * (c[0] - b[0]).hypot(c[1] - b[1]);
            scale < 1e-18 || cross.abs() < 1e-9 * scale
        });
        match redundant {
            Some(i) => {
                points.remove(i);
            }
            None => break,
        }
    }
    let n = points.len();
    let winding = area(&points).signum();
    let convex = (0..n).all(|i| {
        let (a, b, c) = (points[i], points[(i + 1) % n], points[(i + 2) % n]);
        ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) * winding > 0.0
    });
    if convex {
        return Ok(vec![points]);
    }
    // Work in the frame of the first side, where an orthogonal plan is axis-aligned.
    let d = [points[1][0] - points[0][0], points[1][1] - points[0][1]];
    let length = d[0].hypot(d[1]);
    let (cos, sin) = (d[0] / length, d[1] / length);
    let local: Vec<Point> = points
        .iter()
        .map(|p| [p[0] * cos + p[1] * sin, -p[0] * sin + p[1] * cos])
        .collect();
    let extent = local.iter().flatten().fold(1.0_f64, |m, v| m.max(v.abs()));
    let eps = 1e-7 * extent;
    let orthogonal = (0..n).all(|i| {
        let (a, b) = (local[i], local[(i + 1) % n]);
        (a[0] - b[0]).abs() < eps || (a[1] - b[1]).abs() < eps
    });
    if !orthogonal {
        return Err(
            "a concave footprint must have square corners, or be drawn as joined convex blocks"
                .into(),
        );
    }
    let xs = cuts(local.iter().map(|p| p[0]), eps);
    let zs = cuts(local.iter().map(|p| p[1]), eps);
    let (nx, nz) = (xs.len() - 1, zs.len() - 1);
    // Prefix sums of the grid cells lying inside, to test any rectangle at once.
    let mut filled = vec![vec![0usize; nz + 1]; nx + 1];
    for i in 0..nx {
        for j in 0..nz {
            let centre = [(xs[i] + xs[i + 1]) * 0.5, (zs[j] + zs[j + 1]) * 0.5];
            filled[i + 1][j + 1] =
                usize::from(inside_polygon(&local, centre)) + filled[i][j + 1] + filled[i + 1][j]
                    - filled[i][j];
        }
    }
    let full = |i0: usize, i1: usize, j0: usize, j1: usize| {
        filled[i1][j1] + filled[i0][j0] - filled[i0][j1] - filled[i1][j0] == (i1 - i0) * (j1 - j0)
    };
    let mut blocks = Vec::new();
    for i0 in 0..nx {
        for i1 in i0 + 1..=nx {
            for j0 in 0..nz {
                for j1 in j0 + 1..=nz {
                    let maximal = full(i0, i1, j0, j1)
                        && !(i0 > 0 && full(i0 - 1, i1, j0, j1))
                        && !(i1 < nx && full(i0, i1 + 1, j0, j1))
                        && !(j0 > 0 && full(i0, i1, j0 - 1, j1))
                        && !(j1 < nz && full(i0, i1, j0, j1 + 1));
                    if maximal {
                        let world = |x: f64, z: f64| [x * cos - z * sin, x * sin + z * cos];
                        blocks.push(vec![
                            world(xs[i0], zs[j0]),
                            world(xs[i1], zs[j0]),
                            world(xs[i1], zs[j1]),
                            world(xs[i0], zs[j1]),
                        ]);
                    }
                }
            }
        }
    }
    Ok(blocks)
}

/// Generates a roof with shared seam identities between all its faces.
pub fn generate_roof_patch(request: RoofRequest) -> Result<RoofPatch, String> {
    if !request.elevation.is_finite() || !request.height.is_finite() || request.height <= 0.0 {
        return Err("a roof needs a finite elevation and a positive height".into());
    }
    if request.blocks.is_empty() {
        return Err("a roof needs at least one block".into());
    }
    let blocks = request
        .blocks
        .iter()
        .map(prepare)
        .collect::<Result<Vec<_>, _>>()?;
    let mut leaves = Vec::new();
    for (b, block) in blocks.iter().enumerate() {
        for (side, _) in block.pitched() {
            for face in visible_leaf(&blocks, b, side)? {
                leaves.push((b, side, face));
            }
        }
    }
    let peak = leaves
        .iter()
        .flat_map(|(b, side, face)| face[0].iter().map(|p| blocks[*b].leaves[*side].rise(*p)))
        .fold(0.0_f64, f64::max);
    if peak.is_nan() || peak <= 1e-9 {
        return Err("the roof does not rise".into());
    }
    let scale = request.height / peak;
    let lift = |b: usize, side: usize, p: Point| {
        [
            p[0],
            request.elevation + scale * blocks[b].leaves[side].rise(p),
            p[1],
        ]
    };
    let mut faces: Vec<Face3> = leaves
        .iter()
        .map(|(b, side, face)| Face3 {
            block: *b,
            side: *side,
            gable: false,
            rings: face
                .iter()
                .map(|ring| ring.iter().map(|p| lift(*b, *side, *p)).collect())
                .collect(),
        })
        .collect();
    // Gables: the vertical face under the leaves' edge along each gable side.
    for (b, block) in blocks.iter().enumerate() {
        let n = block.contour.len();
        for side in (0..n).filter(|side| block.leaves[*side].slope == 0.0) {
            let (a, c) = (block.contour[side], block.contour[(side + 1) % n]);
            let middle = [(a[0] + c[0]) * 0.5, (a[1] + c[1]) * 0.5];
            if blocks
                .iter()
                .enumerate()
                .any(|(o, other)| o != b && inside_convex(&other.contour, middle))
            {
                continue;
            }
            let d = [c[0] - a[0], c[1] - a[1]];
            let length_sq = dot(d, d);
            let mut rim: Vec<(f64, [f64; 3])> = faces
                .iter()
                .filter(|face| face.block == b)
                .flat_map(|face| face.rings.iter().flatten())
                .filter_map(|p| {
                    let x = [p[0], p[2]];
                    let t = dot([x[0] - a[0], x[1] - a[1]], d) / length_sq;
                    let off = (x[0] - a[0]) * d[1] - (x[1] - a[1]) * d[0];
                    (off.abs() < 1e-4 * length_sq.sqrt()
                        && (-1e-6..=1.0 + 1e-6).contains(&t)
                        && p[1] > request.elevation + 1e-6)
                        .then_some((t, *p))
                })
                .collect();
            if rim.is_empty() {
                continue;
            }
            rim.sort_by(|x, y| y.0.total_cmp(&x.0));
            rim.dedup_by(|x, y| (x.0 - y.0).abs() < 1e-6 && (x.1[1] - y.1[1]).abs() < 1e-6);
            let mut ring = vec![
                [a[0], request.elevation, a[1]],
                [c[0], request.elevation, c[1]],
            ];
            ring.extend(rim.into_iter().map(|(_, p)| p));
            faces.push(Face3 {
                block: b,
                side,
                gable: true,
                rings: vec![ring],
            });
        }
    }
    weld(faces, &blocks)
}

/// Shares nodes and edges between faces, splitting any edge another face's
/// corner lies on, and winds every face the same way round.
fn weld(faces: Vec<Face3>, blocks: &[Block]) -> Result<RoofPatch, String> {
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
    let mut edges: Vec<CapEdge> = Vec::new();
    let mut result = Vec::new();
    for (face, mut rings) in indexed {
        let points = |ring: &[usize]| ring.iter().map(|k| nodes[*k]).collect::<Vec<_>>();
        let n = normal(&points(&rings[0]));
        // Leaves wind with their normal down, as generated caps do; a gable's
        // points into the block, which is the same way round across a seam.
        let flipped = if face.gable {
            let leaf = blocks[face.block].leaves[face.side];
            n[0] * leaf.normal[0] + n[2] * leaf.normal[1] < 0.0
        } else {
            n[1] > 0.0
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
            block: face.block,
            side: face.side,
            gable: face.gable,
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

    fn rectangle(slopes: [f64; 4]) -> RoofRequest {
        RoofRequest {
            elevation: 3.0,
            height: 2.0,
            blocks: vec![RoofBlock {
                contour: vec![[0.0, 0.0], [8.0, 0.0], [8.0, 4.0], [0.0, 4.0]],
                slopes: slopes.to_vec(),
                overhangs: vec![0.0; 4],
            }],
        }
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

    #[test]
    fn four_waters_make_a_hip_roof_with_a_ridge() {
        let patch = generate_roof_patch(rectangle([1.0; 4])).unwrap();
        assert_eq!(patch.faces.len(), 4);
        assert!(patch.faces.iter().all(|f| !f.gable));
        let top: Vec<_> = patch
            .nodes
            .iter()
            .filter(|p| (p[1] - 5.0).abs() < 1e-9)
            .collect();
        assert_eq!(top.len(), 2, "a ridge, not an apex");
        assert!(top.iter().all(|p| (p[2] - 2.0).abs() < 1e-9));
        assert!(edge_uses(&patch).iter().all(|n| (1..=2).contains(n)));
        // The eave is used once; every seam twice.
        assert_eq!(edge_uses(&patch).iter().filter(|n| **n == 1).count(), 4);
    }

    #[test]
    fn two_waters_close_their_ends_with_gables() {
        let patch = generate_roof_patch(rectangle([1.0, 0.0, 1.0, 0.0])).unwrap();
        assert_eq!(patch.faces.iter().filter(|f| !f.gable).count(), 2);
        assert_eq!(patch.faces.iter().filter(|f| f.gable).count(), 2);
        let top: Vec<_> = patch
            .nodes
            .iter()
            .filter(|p| (p[1] - 5.0).abs() < 1e-9)
            .collect();
        assert_eq!(top.len(), 2);
        assert!(
            top.iter().any(|p| p[0].abs() < 1e-9) && top.iter().any(|p| (p[0] - 8.0).abs() < 1e-9)
        );
        assert!(edge_uses(&patch).iter().all(|n| (1..=2).contains(n)));
    }

    #[test]
    fn one_water_rises_to_the_far_side() {
        let patch = generate_roof_patch(rectangle([1.0, 0.0, 0.0, 0.0])).unwrap();
        assert_eq!(patch.faces.iter().filter(|f| !f.gable).count(), 1);
        let high: Vec<_> = patch
            .nodes
            .iter()
            .filter(|p| (p[1] - 5.0).abs() < 1e-9)
            .collect();
        assert!(high.len() == 2 && high.iter().all(|p| (p[2] - 4.0).abs() < 1e-9));
        // The far side is a gable closed up to the high eave.
        assert_eq!(patch.faces.iter().filter(|f| f.gable).count(), 3);
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
    fn overhang_pushes_eaves_out_at_the_same_elevation() {
        let mut request = rectangle([1.0; 4]);
        request.blocks[0].overhangs = vec![0.5, 0.0, 0.0, 0.0];
        let patch = generate_roof_patch(request).unwrap();
        assert!(
            patch
                .nodes
                .iter()
                .any(|p| (p[2] + 0.5).abs() < 1e-9 && (p[1] - 3.0).abs() < 1e-9)
        );
    }

    #[test]
    fn crossing_blocks_join_with_valleys_and_no_open_seams() {
        let request = RoofRequest {
            elevation: 0.0,
            height: 2.0,
            blocks: vec![
                RoofBlock {
                    contour: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 4.0], [0.0, 4.0]],
                    slopes: vec![1.0; 4],
                    overhangs: vec![0.0; 4],
                },
                RoofBlock {
                    contour: vec![[3.0, -4.0], [7.0, -4.0], [7.0, 2.0], [3.0, 2.0]],
                    slopes: vec![1.0, 0.0, 1.0, 0.0],
                    overhangs: vec![0.0; 4],
                },
            ],
        };
        let patch = generate_roof_patch(request).unwrap();
        assert!(patch.faces.iter().any(|f| f.block == 1));
        // Nothing but eaves and the free gable end is used once.
        assert!(edge_uses(&patch).iter().all(|n| (1..=2).contains(n)));
    }

    #[test]
    fn footprints_split_into_convex_blocks() {
        let square = [[0.0, 0.0], [4.0, 0.0], [4.0, 2.0], [4.0, 4.0], [0.0, 4.0]];
        assert_eq!(
            footprint_blocks(&square).unwrap().len(),
            1,
            "a straight-through corner is dropped"
        );
        let l = [
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 4.0],
            [4.0, 4.0],
            [4.0, 10.0],
            [0.0, 10.0],
        ];
        let blocks = footprint_blocks(&l).unwrap();
        assert_eq!(blocks.len(), 2, "the two arms, overlapping at the corner");
        let cross = [
            [4.0, 0.0],
            [6.0, 0.0],
            [6.0, 4.0],
            [10.0, 4.0],
            [10.0, 6.0],
            [6.0, 6.0],
            [6.0, 10.0],
            [4.0, 10.0],
            [4.0, 6.0],
            [0.0, 6.0],
            [0.0, 4.0],
            [4.0, 4.0],
        ];
        assert_eq!(footprint_blocks(&cross).unwrap().len(), 2);
        // A rotated L is still orthogonal in its own frame.
        let (c, s) = (0.6_f64, 0.8_f64);
        let turned: Vec<_> = l
            .iter()
            .map(|p| [p[0] * c - p[1] * s, p[0] * s + p[1] * c])
            .collect();
        assert_eq!(footprint_blocks(&turned).unwrap().len(), 2);
        let arrow = [[0.0, 0.0], [4.0, 0.0], [2.0, 1.0], [4.0, 4.0], [0.0, 4.0]];
        assert!(footprint_blocks(&arrow).is_err());
    }

    #[test]
    fn an_l_plan_roofs_over_without_open_seams() {
        let l = [
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 4.0],
            [4.0, 4.0],
            [4.0, 10.0],
            [0.0, 10.0],
        ];
        let blocks = footprint_blocks(&l)
            .unwrap()
            .into_iter()
            .map(|contour| RoofBlock {
                slopes: vec![1.0; 4],
                overhangs: vec![0.0; 4],
                contour,
            })
            .collect();
        let patch = generate_roof_patch(RoofRequest {
            elevation: 0.0,
            height: 2.0,
            blocks,
        })
        .unwrap();
        assert!(edge_uses(&patch).iter().all(|n| (1..=2).contains(n)));
        // The eave runs round the L's six sides and nowhere else.
        let eave: f64 = patch
            .edges
            .iter()
            .zip(edge_uses(&patch))
            .filter(|(_, uses)| *uses == 1)
            .map(|(e, _)| {
                let (a, b) = (patch.nodes[e.start], patch.nodes[e.end]);
                assert!(
                    a[1].abs() < 1e-6 && b[1].abs() < 1e-6,
                    "a free edge off the eave"
                );
                (a[0] - b[0]).hypot(a[2] - b[2])
            })
            .sum();
        assert!((eave - 40.0).abs() < 1e-3, "{eave}");
    }

    #[test]
    fn malformed_roofs_are_rejected() {
        assert!(generate_roof_patch(rectangle([0.0; 4])).is_err());
        let mut request = rectangle([1.0; 4]);
        request.blocks[0].contour = vec![[0.0, 0.0], [4.0, 0.0], [1.0, 1.0], [0.0, 4.0]];
        assert!(
            generate_roof_patch(request).is_err(),
            "concave footprints are joined blocks, not one"
        );
        let mut request = rectangle([1.0; 4]);
        request.height = 0.0;
        assert!(generate_roof_patch(request).is_err());
    }
}
