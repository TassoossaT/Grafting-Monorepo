//! Laying one piece with the irregular quad grid, and lifting it back onto
//! the surface.
//!
//! The grid never learns it is not on the ground plane. It is handed the
//! piece's rings in the piece's own plane, lays its quads exactly as it lays
//! any ground, and each corner it made is lifted along the piece's axis to the
//! crossing the piece is: the one with as many crossings in front of it as the
//! piece was split with. Corners it was handed come back as the border points
//! they were, so two pieces meet on the very same points.

use grafting_procgen_irregular_grid::constrained::{ConstrainedOptions, ConstraintPoint};
use grafting_procgen_irregular_grid::hex::{lattice_covering, lattice_triangle_area};
use grafting_procgen_irregular_grid::mesh::Vec2;
use grafting_procgen_irregular_grid::{RelaxOptions, build_constrained_quad_grid};

use crate::field::{HeightSource, SolidField};
use crate::pieces::{Region, Split};
use crate::seams::Seams;
use crate::vector::Vec3;

/// How much wider the lattice triangle is than the face that descends from
/// it -- the measured constant the ground's own bridge uses.
const FACE_SIDE_TO_LATTICE_SIDE: f64 = 3.0;

/// One piece, laid.
#[derive(Debug, Clone)]
pub struct LaidPiece {
    pub vertices: Vec<Vec3>,
    /// Counter-clockwise seen from outside the solid. Mostly quads; a face
    /// the grid joined across a short border segment has more corners and
    /// need not be convex.
    pub faces: Vec<Vec<usize>>,
    /// Every face cut into triangles, in the piece's plane where the face is
    /// flat and simple -- never fanned in 3D, which leaves holes in a
    /// concave face.
    pub triangles: Vec<[usize; 3]>,
    /// Index-aligned with `vertices`: the border point a corner is, where it
    /// is one.
    pub border_point: Vec<Option<usize>>,
    /// Corners the lift found no crossing for and settled by projection.
    pub settled_by_projection: usize,
    /// Corners the grid put on a border that the piece across it does not
    /// have: each one a crack. Zero when the borders were laid fine enough.
    pub added_on_border: usize,
    /// `false` where the grid could not keep the borders as handed over.
    pub seams_kept: bool,
    /// Crossings left in the rings after untangling.
    pub tangled: usize,
    /// Corners the grid put partway along a border segment, which the piece
    /// across has to take too: see [`lay_ground`].
    pub border_splits: Vec<BorderSplit>,
}

/// A corner the grid put partway along one of a piece's border segments.
#[derive(Debug, Clone, Copy)]
pub struct BorderSplit {
    /// Index into the piece's rings in [`Seams::rings`].
    pub ring: usize,
    /// The segment from point `segment` of that ring to the next.
    pub segment: usize,
    pub position: Vec3,
}

/// Every pair of ring segments that cross, as `(ring, segment)` pairs.
fn crossings(rings: &[Vec<ConstraintPoint>]) -> Vec<((usize, usize), (usize, usize))> {
    let segments: Vec<(Vec2, Vec2, usize, usize)> = rings
        .iter()
        .enumerate()
        .flat_map(|(r, ring)| (0..ring.len()).map(move |i| (ring[i].position, ring[(i + 1) % ring.len()].position, r, i)))
        .collect();
    let side = |p: Vec2, q: Vec2, r: Vec2| (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    let mut found = Vec::new();
    for i in 0..segments.len() {
        let (a, b, ri, ii) = segments[i];
        for &(c, d, rj, jj) in &segments[i + 1..] {
            if ri == rj {
                let n = rings[ri].len();
                if (ii + 1) % n == jj || (jj + 1) % n == ii {
                    continue;
                }
            }
            let (d1, d2, d3, d4) = (side(a, b, c), side(a, b, d), side(c, d, a), side(c, d, b));
            if (d1 > 0.0) != (d2 > 0.0) && (d3 > 0.0) != (d4 > 0.0) {
                found.push(((ri, ii), (rj, jj)));
            }
        }
    }
    found
}

/// Undoes the folds a border makes where it climbs nearly along the piece's
/// axis and its projection doubles back on itself.
///
/// Only the plane positions move. The plane is where the grid works, not
/// where the ground is: every border corner is lifted back to its own point,
/// so moving its shadow a little changes the shape of the faces beside it and
/// nothing about where they meet. Returns the crossings it could not undo.
fn untangle(rings: &mut [Vec<ConstraintPoint>]) -> usize {
    for _ in 0..200 {
        let found = crossings(rings);
        if found.is_empty() {
            return 0;
        }
        for ((ra, ia), (rb, ib)) in found {
            for (r, i) in [(ra, ia), (ra, ia + 1), (rb, ib), (rb, ib + 1)] {
                let ring = &mut rings[r];
                let n = ring.len();
                let i = i % n;
                let (before, after) = (ring[(i + n - 1) % n].position, ring[(i + 1) % n].position);
                let here = ring[i].position;
                ring[i].position = Vec2::new(
                    here.x * 0.5 + (before.x + after.x) * 0.25,
                    here.y * 0.5 + (before.y + after.y) * 0.25,
                );
            }
        }
    }
    crossings(rings).len()
}

fn signed_area(ring: &[Vec2]) -> f64 {
    let mut twice = 0.0;
    for i in 0..ring.len() {
        let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
        twice += a.x * b.y - b.x * a.y;
    }
    twice * 0.5
}

/// Lays piece `index` of `split` with faces `face_side` wide.
pub fn lay_piece<H: HeightSource>(
    field: &SolidField<H>,
    region: &Region,
    split: &Split,
    seams: &Seams,
    index: usize,
    face_side: f64,
    seed: u32,
) -> Result<LaidPiece, String> {
    let key = split.pieces[index].key;
    let (u, v) = key.facing.plane();
    let axis = key.facing.axis();
    let flat = |point: Vec3| Vec2::new(point.dot(u), point.dot(v));

    let mut rings: Vec<Vec<ConstraintPoint>> = seams.rings[index]
        .iter()
        .map(|ring| ring.iter().map(|&p| ConstraintPoint { position: flat(seams.points[p]), source: Some(p as u32) }).collect())
        .collect();
    if rings.is_empty() {
        // A sliver shorter than one face along its border: its neighbours
        // already meet each other edge to edge across it, so there is nothing
        // here to lay.
        return Ok(LaidPiece {
            vertices: Vec::new(),
            faces: Vec::new(),
            triangles: Vec::new(),
            border_point: Vec::new(),
            settled_by_projection: 0,
            added_on_border: 0,
            seams_kept: true,
            tangled: 0,
            border_splits: Vec::new(),
        });
    }
    let tangled = untangle(&mut rings);
    let outer = (0..rings.len())
        .max_by(|&a, &b| {
            let area = |r: &Vec<ConstraintPoint>| signed_area(&r.iter().map(|p| p.position).collect::<Vec<_>>()).abs();
            area(&rings[a]).total_cmp(&area(&rings[b]))
        })
        .unwrap();
    // Where each ring went: the outer one first, the holes after it in the
    // order `swap_remove` leaves them.
    let mut order: Vec<usize> = (0..rings.len()).collect();
    order.swap_remove(outer);
    let boundary = vec![rings.swap_remove(outer)];
    let holes = rings;

    let triangle_side = face_side * FACE_SIDE_TO_LATTICE_SIDE;
    let (mut min, mut max) = (Vec2::new(f64::INFINITY, f64::INFINITY), Vec2::new(f64::NEG_INFINITY, f64::NEG_INFINITY));
    for point in &boundary[0] {
        min = Vec2::new(min.x.min(point.position.x), min.y.min(point.position.y));
        max = Vec2::new(max.x.max(point.position.x), max.y.max(point.position.y));
    }
    let options = ConstrainedOptions {
        seeds: lattice_covering(min, max, triangle_side),
        boundary,
        holes,
        seed_clearance: triangle_side * 0.25,
        max_area: lattice_triangle_area(triangle_side),
        min_area: lattice_triangle_area(triangle_side) * 0.25,
        min_angle_degrees: 20.5,
        max_additional_vertices: 2_500,
    };
    let relax = RelaxOptions { pin_boundary: false, ..RelaxOptions::standard() };
    let grid = build_constrained_quad_grid(&options, seed, &relax)
        .ok_or_else(|| format!("piece {index} ({key:?}): its rings describe no ground"))?;
    if !grid.seams_kept {
        // The grid could not keep the borders as given -- two of them cross
        // in the plane -- and would put a corner on every segment, each one a
        // crack. The piece is laid from its own border points instead.
        return Ok(laid_from_rings(&options, seams, tangled));
    }

    // The lift: from the region's face in front of the piece, back along the
    // axis, to the crossing with `in_front` crossings before it.
    let step = region.cell * 0.25;
    let mut settled_by_projection = 0;
    let vertices: Vec<Vec3> = grid
        .mesh
        .vertices
        .iter()
        .enumerate()
        .map(|(vertex, position)| {
            if let Some(source) = grid.sources[vertex] {
                return seams.points[source as usize];
            }
            let on_plane = u * position.x + v * position.y;
            let front = [region.min, region.max]
                .iter()
                .map(|corner| corner.dot(axis))
                .fold(f64::NEG_INFINITY, f64::max);
            let start = on_plane + axis * (front - on_plane.dot(axis));
            let depth = [region.min, region.max].iter().map(|c| c.dot(axis)).fold(f64::INFINITY, f64::min);
            let length = front - depth;
            match field.crossing(start, -axis, length, region.cell * 0.25, key.in_front) {
                Some(point) => point,
                None => {
                    settled_by_projection += 1;
                    let nearest = split.pieces[index]
                        .triangles
                        .iter()
                        .flat_map(|&t| split.triangles[t])
                        .map(|p| split.positions[p])
                        .min_by(|a, b| flat(*a).distance_squared(on_plane, u, v).total_cmp(&flat(*b).distance_squared(on_plane, u, v)))
                        .unwrap_or(on_plane);
                    field.project(on_plane + axis * nearest.dot(axis), step)
                }
            }
        })
        .collect();

    let mut triangles = Vec::new();
    let mut local: Vec<u32> = Vec::new();
    for face in &grid.mesh.faces {
        if face.len() == 3 {
            triangles.push([face[0], face[1], face[2]]);
            continue;
        }
        local.clear();
        earcut::Earcut::new().earcut(face.iter().map(|&i| [grid.mesh.vertices[i].x, grid.mesh.vertices[i].y]), &[], &mut local);
        if local.len() / 3 == face.len() - 2 {
            triangles.extend(local.chunks_exact(3).map(|t| [face[t[0] as usize], face[t[1] as usize], face[t[2] as usize]]));
        } else {
            // A face touching itself in the plane, which earcut leaves partly
            // bare: a fan at least covers it.
            triangles.extend((1..face.len() - 1).map(|k| [face[0], face[k], face[k + 1]]));
        }
    }

    let border_splits = grid
        .on_contour
        .iter()
        .map(|node| BorderSplit {
            ring: if node.location.in_holes { order[node.location.ring] } else { outer },
            segment: node.location.segment,
            position: vertices[node.vertex],
        })
        .collect();

    Ok(LaidPiece {
        vertices,
        triangles,
        faces: grid.mesh.faces,
        border_point: grid.sources.iter().map(|s| s.map(|s| s as usize)).collect(),
        settled_by_projection,
        added_on_border: grid.on_contour.len(),
        tangled,
        seams_kept: grid.seams_kept,
        border_splits,
    })
}

/// A piece laid from its border points alone, cut into triangles in its
/// plane: no corner of its own, so nothing the pieces round it lack.
fn laid_from_rings(options: &ConstrainedOptions, seams: &Seams, tangled: usize) -> LaidPiece {
    let mut flat: Vec<[f64; 2]> = Vec::new();
    let mut ids: Vec<usize> = Vec::new();
    let mut holes: Vec<u32> = Vec::new();
    for (index, ring) in options.boundary.iter().chain(options.holes.iter()).enumerate() {
        if index > 0 {
            holes.push(flat.len() as u32);
        }
        for point in ring {
            flat.push([point.position.x, point.position.y]);
            ids.push(point.source.expect("every ring point is a border point") as usize);
        }
    }
    let mut local: Vec<u32> = Vec::new();
    earcut::Earcut::new().earcut(flat.iter().copied(), &holes, &mut local);
    let triangles: Vec<[usize; 3]> = local
        .chunks_exact(3)
        .map(|t| {
            let [a, b, c] = [t[0] as usize, t[1] as usize, t[2] as usize];
            let turn = (flat[b][0] - flat[a][0]) * (flat[c][1] - flat[a][1]) - (flat[b][1] - flat[a][1]) * (flat[c][0] - flat[a][0]);
            if turn < 0.0 { [a, c, b] } else { [a, b, c] }
        })
        .collect();
    LaidPiece {
        vertices: ids.iter().map(|&id| seams.points[id]).collect(),
        faces: triangles.iter().map(|t| t.to_vec()).collect(),
        triangles,
        border_point: ids.into_iter().map(Some).collect(),
        settled_by_projection: 0,
        added_on_border: 0,
        seams_kept: false,
        tangled,
        border_splits: Vec::new(),
    }
}

trait PlaneDistance {
    fn distance_squared(self, point: Vec3, u: Vec3, v: Vec3) -> f64;
}

impl PlaneDistance for Vec2 {
    fn distance_squared(self, point: Vec3, u: Vec3, v: Vec3) -> f64 {
        let (dx, dy) = (self.x - point.dot(u), self.y - point.dot(v));
        dx * dx + dy * dy
    }
}

/// Every piece of the surface in `region`, split, bordered and laid.
#[derive(Debug, Clone)]
pub struct LaidGround {
    /// The border points every piece shares.
    pub border_points: Vec<Vec3>,
    pub pieces: Vec<(crate::pieces::PieceKey, Result<LaidPiece, String>)>,
}

/// The whole pipeline, end to end: split, borders laid, each piece laid.
///
/// Open ground -- the piece facing up with nothing over or under it -- is
/// laid at `face_side`, the size ground has everywhere else. Every other
/// piece is what a shape made, and is laid at `shape_face_side`: a cave three
/// metres across laid in two-metre faces is a box. Borders are laid at the
/// finer of the two, so both sides of each one meet on its points.
///
/// Where the grid still puts a corner partway along a border, the border
/// takes it -- both pieces' rings -- and the pieces are laid again: the same
/// adoption the tabletop's ground already does for a road it meets.
pub fn lay_ground<H: HeightSource>(
    field: &SolidField<H>,
    region: &Region,
    options: &crate::pieces::SplitOptions,
    face_side: f64,
    shape_face_side: f64,
    seed: u32,
) -> LaidGround {
    let split = crate::pieces::split(field, region, options);
    let mut seams = crate::seams::seams(field, &split, region, face_side.min(shape_face_side), region.cell * 0.25);
    let lay_all = |seams: &Seams| -> Vec<Result<LaidPiece, String>> {
        (0..split.pieces.len())
            .map(|index| {
                let side = if split.pieces[index].key.is_open_ground() { face_side } else { shape_face_side };
                lay_piece(field, region, &split, seams, index, side, seed)
            })
            .collect()
    };
    let mut laid = lay_all(&seams);
    for _ in 0..ADOPTION_ROUNDS {
        if !adopt_border_splits(&mut seams, &laid) {
            break;
        }
        laid = lay_all(&seams);
    }
    LaidGround {
        border_points: seams.points,
        pieces: split.pieces.iter().map(|piece| piece.key).zip(laid).collect(),
    }
}

/// How many times the pieces are laid again to take the corners the grid put
/// on the borders between them.
const ADOPTION_ROUNDS: usize = 4;

/// Puts every corner the grid laid partway along a border into that border,
/// in every ring that walks it. `false` when there was none.
fn adopt_border_splits(seams: &mut Seams, laid: &[Result<LaidPiece, String>]) -> bool {
    use std::collections::HashMap;
    // Per segment, keyed low point first, the positions to put on it.
    let mut wanted: HashMap<(usize, usize), Vec<Vec3>> = HashMap::new();
    for (index, piece) in laid.iter().enumerate() {
        let Ok(piece) = piece else { continue };
        for split in &piece.border_splits {
            let ring = &seams.rings[index][split.ring];
            let (a, b) = (ring[split.segment], ring[(split.segment + 1) % ring.len()]);
            wanted.entry((a.min(b), a.max(b))).or_default().push(split.position);
        }
    }
    if wanted.is_empty() {
        return false;
    }
    let mut inserted: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    for ((low, high), mut positions) in wanted {
        let (a, b) = (seams.points[low], seams.points[high]);
        let along = b - a;
        let t = |p: &Vec3| (*p - a).dot(along) / along.dot(along).max(1e-12);
        positions.sort_by(|p, q| t(p).total_cmp(&t(q)));
        positions.dedup_by(|p, q| p.distance(*q) < 1e-6);
        let ids: Vec<usize> = positions
            .into_iter()
            .map(|position| {
                seams.points.push(position);
                seams.points.len() - 1
            })
            .collect();
        inserted.insert((high, low), ids.iter().rev().copied().collect());
        inserted.insert((low, high), ids);
    }
    for rings in seams.rings.iter_mut() {
        for ring in rings.iter_mut() {
            let n = ring.len();
            let mut grown = Vec::with_capacity(n);
            for i in 0..n {
                grown.push(ring[i]);
                if let Some(ids) = inserted.get(&(ring[i], ring[(i + 1) % n])) {
                    grown.extend_from_slice(ids);
                }
            }
            *ring = grown;
        }
    }
    true
}
