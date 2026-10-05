//! Splitting the surface into pieces a planar mesher can lay.
//!
//! A planar mesher -- the irregular quad grid -- lays ground over a plane and
//! lifts it. That works for any stretch of surface that is a height over
//! *some* plane: the hill is a height over the ground plane, a tunnel ceiling
//! a height seen from below, its walls a height seen from the side. So the
//! surface is split into pieces that each are one.
//!
//! Two keys make a piece, after Koca and Gudukbay (2014), who build terrain
//! with caves from axis-aligned surface patches displaced by height:
//!
//! - **Facing**: which of six axes the surface looks along. Up takes every
//!   slope short of a cliff, so ordinary hills stay one piece, the way ground
//!   was laid before there was anything else.
//! - **Layers in front and behind**: how many times the surface is crossed
//!   walking out along that axis, and back in against it. Two stretches with
//!   the same facing and the same counts can never sit over the same point of
//!   their plane -- the cave floor under a hill and the hilltop above it are
//!   told apart by the crossings between them -- so every piece is a height.
//!
//! The coarse surface the split is read from comes from Surface Nets over a
//! grid sampled only for this. It decides *which* piece a stretch belongs to
//! and nothing else: the faces that end up on the table are laid by the
//! mesher, at its own size, never at this grid's.

use std::collections::HashMap;

use fast_surface_nets::ndshape::{RuntimeShape, Shape as _};
use fast_surface_nets::{SurfaceNetsBuffer, surface_nets};

use crate::field::{HeightSource, SolidField};
use crate::vector::Vec3;

/// The axis a piece is a height along.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Facing {
    Up,
    Down,
    East,
    West,
    North,
    South,
}

impl Facing {
    /// The direction the piece looks: out of the solid.
    pub fn axis(self) -> Vec3 {
        match self {
            Facing::Up => Vec3::new(0.0, 1.0, 0.0),
            Facing::Down => Vec3::new(0.0, -1.0, 0.0),
            Facing::East => Vec3::new(1.0, 0.0, 0.0),
            Facing::West => Vec3::new(-1.0, 0.0, 0.0),
            Facing::North => Vec3::new(0.0, 0.0, 1.0),
            Facing::South => Vec3::new(0.0, 0.0, -1.0),
        }
    }

    /// The plane the piece is laid in, as `(u, v)` with `u x v = axis`: a
    /// ring counter-clockwise in `(u, v)` is counter-clockwise seen from
    /// outside the solid, so faces laid there need no flipping when lifted.
    pub fn plane(self) -> (Vec3, Vec3) {
        let (x, y, z) = (Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 0.0, 1.0));
        match self {
            Facing::Up => (x, -z),
            Facing::Down => (x, z),
            Facing::East => (-z, y),
            Facing::West => (z, y),
            Facing::North => (x, y),
            Facing::South => (-x, y),
        }
    }

    /// The facing of a surface with outward `normal`. Anything whose normal
    /// rises more than `steepest_up` (its y component, normalised) is Up.
    pub fn of(normal: Vec3, steepest_up: f64) -> Self {
        let n = normal.normalized();
        if n.y > steepest_up {
            Facing::Up
        } else if n.y < -steepest_up {
            Facing::Down
        } else if n.x.abs() >= n.z.abs() {
            if n.x >= 0.0 { Facing::East } else { Facing::West }
        } else if n.z >= 0.0 {
            Facing::North
        } else {
            Facing::South
        }
    }
}

/// The box the surface is read in, and how finely.
#[derive(Debug, Clone, Copy)]
pub struct Region {
    pub min: Vec3,
    pub max: Vec3,
    /// Spacing of the grid the split is read from. Coarser than a cave is
    /// thin and the cave is not seen.
    pub cell: f64,
}

impl Region {
    /// How far `from` is from the region's face along `direction`, an axis.
    fn reach(&self, from: Vec3, direction: Vec3) -> f64 {
        let along = |position: f64, low: f64, high: f64, d: f64| {
            if d > 0.0 { (high - position) / d } else if d < 0.0 { (low - position) / d } else { f64::INFINITY }
        };
        along(from.x, self.min.x, self.max.x, direction.x)
            .min(along(from.y, self.min.y, self.max.y, direction.y))
            .min(along(from.z, self.min.z, self.max.z, direction.z))
            .max(0.0)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SplitOptions {
    /// See [`Facing::of`]. `0.5` keeps slopes up to 60 degrees Up: steeper
    /// and a border climbing it folds over in the piece's plane, and the
    /// faces against it come out as slivers.
    pub steepest_up: f64,
    /// A piece smaller than this, in surface area, joins the neighbour it
    /// shares the most border with: the split's grid makes slivers where a
    /// facing changes, and no mesher lays a sliver well.
    pub smallest_piece: f64,
}

/// What a piece is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PieceKey {
    pub facing: Facing,
    /// Crossings walking out along the facing.
    pub in_front: usize,
    /// Crossings walking in against it.
    pub behind: usize,
}

#[derive(Debug, Clone)]
pub struct Piece {
    pub key: PieceKey,
    pub triangles: Vec<usize>,
    pub area: f64,
}

/// The coarse surface, and which piece each of its triangles went to.
#[derive(Debug, Clone)]
pub struct Split {
    pub positions: Vec<Vec3>,
    /// Wound counter-clockwise seen from outside the solid.
    pub triangles: Vec<[usize; 3]>,
    pub piece_of: Vec<usize>,
    pub pieces: Vec<Piece>,
}

fn triangle_area(positions: &[Vec3], [a, b, c]: [usize; 3]) -> f64 {
    (positions[b] - positions[a]).cross(positions[c] - positions[a]).length() * 0.5
}

/// Reads the surface in `region` and splits it into pieces.
pub fn split<H: HeightSource>(field: &SolidField<H>, region: &Region, options: &SplitOptions) -> Split {
    let cell = region.cell;
    let count = |low: f64, high: f64| ((high - low) / cell).ceil() as u32 + 1;
    let size = [count(region.min.x, region.max.x), count(region.min.y, region.max.y), count(region.min.z, region.max.z)];
    let shape = RuntimeShape::<u32, 3>::new(size);
    let mut samples = vec![0f32; shape.size() as usize];
    for index in 0..shape.size() {
        let [x, y, z] = shape.delinearize(index);
        let point = region.min + Vec3::new(x as f64, y as f64, z as f64) * cell;
        samples[index as usize] = field.distance(point) as f32;
    }
    let mut buffer = SurfaceNetsBuffer::default();
    surface_nets(&samples, &shape, [0; 3], [size[0] - 1, size[1] - 1, size[2] - 1], &mut buffer);

    let positions: Vec<Vec3> = buffer
        .positions
        .iter()
        .map(|p| region.min + Vec3::new(p[0] as f64, p[1] as f64, p[2] as f64) * cell)
        .collect();
    let step = cell * 0.25;
    let triangles: Vec<[usize; 3]> = buffer
        .indices
        .chunks_exact(3)
        .map(|t| {
            let [a, b, c] = [t[0] as usize, t[1] as usize, t[2] as usize];
            let centre = (positions[a] + positions[b] + positions[c]) * (1.0 / 3.0);
            let normal = (positions[b] - positions[a]).cross(positions[c] - positions[a]);
            if normal.dot(field.gradient(centre, step)) < 0.0 { [a, c, b] } else { [a, b, c] }
        })
        .collect();

    // Keys, read at each triangle's centre. The walk starts a cell and a half
    // off the surface so the surface it starts on is not counted.
    let keys: Vec<PieceKey> = triangles
        .iter()
        .map(|&[a, b, c]| {
            let centre = (positions[a] + positions[b] + positions[c]) * (1.0 / 3.0);
            let facing = Facing::of(field.gradient(centre, step), options.steepest_up);
            let axis = facing.axis();
            let skip = cell * 1.5;
            let count_from = |direction: Vec3| {
                let start = centre + direction * skip;
                field.crossings(start, direction, region.reach(start, direction), cell * 0.5)
            };
            PieceKey { facing, in_front: count_from(axis), behind: count_from(-axis) }
        })
        .collect();

    let mut beside: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    for (index, &[a, b, c]) in triangles.iter().enumerate() {
        for (from, to) in [(a, b), (b, c), (c, a)] {
            beside.entry((from.min(to), from.max(to))).or_default().push(index);
        }
    }

    // Connected stretches of one key.
    let mut piece_of = vec![usize::MAX; triangles.len()];
    let mut pieces: Vec<Piece> = Vec::new();
    for seed in 0..triangles.len() {
        if piece_of[seed] != usize::MAX {
            continue;
        }
        let id = pieces.len();
        let mut piece = Piece { key: keys[seed], triangles: Vec::new(), area: 0.0 };
        let mut stack = vec![seed];
        piece_of[seed] = id;
        while let Some(current) = stack.pop() {
            piece.triangles.push(current);
            piece.area += triangle_area(&positions, triangles[current]);
            let [a, b, c] = triangles[current];
            for (from, to) in [(a, b), (b, c), (c, a)] {
                for &other in &beside[&(from.min(to), from.max(to))] {
                    if piece_of[other] == usize::MAX && keys[other] == piece.key {
                        piece_of[other] = id;
                        stack.push(other);
                    }
                }
            }
        }
        pieces.push(piece);
    }

    merge_small_pieces(&positions, &triangles, &beside, &mut piece_of, &mut pieces, options.smallest_piece);
    Split { positions, triangles, piece_of, pieces }
}

/// Folds every piece under `smallest` into the neighbour it shares the most
/// border with, smallest first, then renumbers.
fn merge_small_pieces(
    positions: &[Vec3],
    triangles: &[[usize; 3]],
    beside: &HashMap<(usize, usize), Vec<usize>>,
    piece_of: &mut [usize],
    pieces: &mut Vec<Piece>,
    smallest: f64,
) {
    while let Some(small) = (0..pieces.len())
        .filter(|&p| !pieces[p].triangles.is_empty() && pieces[p].area < smallest)
        .min_by(|&a, &b| pieces[a].area.total_cmp(&pieces[b].area))
    {
        let mut shared: HashMap<usize, f64> = HashMap::new();
        for &triangle in &pieces[small].triangles {
            let [a, b, c] = triangles[triangle];
            for (from, to) in [(a, b), (b, c), (c, a)] {
                for &other in &beside[&(from.min(to), from.max(to))] {
                    let neighbour = piece_of[other];
                    if neighbour != small {
                        *shared.entry(neighbour).or_default() += positions[from].distance(positions[to]);
                    }
                }
            }
        }
        let Some((&into, _)) = shared.iter().max_by(|a, b| a.1.total_cmp(b.1)) else {
            // Alone: nothing to join, keep it as it is.
            pieces[small].area = f64::INFINITY;
            continue;
        };
        let moved = std::mem::take(&mut pieces[small].triangles);
        for &triangle in &moved {
            piece_of[triangle] = into;
        }
        pieces[into].area += pieces[small].area;
        pieces[small].area = 0.0;
        pieces[into].triangles.extend(moved);
    }

    let mut renumber = vec![usize::MAX; pieces.len()];
    let mut kept = Vec::new();
    for (index, piece) in pieces.drain(..).enumerate() {
        if !piece.triangles.is_empty() {
            renumber[index] = kept.len();
            kept.push(piece);
        }
    }
    for piece in piece_of.iter_mut() {
        *piece = renumber[*piece];
    }
    for piece in &mut kept {
        if piece.area.is_infinite() {
            piece.area = piece.triangles.iter().map(|&t| triangle_area(positions, triangles[t])).sum();
        }
    }
    *pieces = kept;
}
