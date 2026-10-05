//! The surface a shape made, as one quad mesh.
//!
//! Read straight off the split's own Surface Nets mesh, at a cell as wide as
//! the faces should be: the quads the shape's pieces and their collar hold,
//! relaxed over the surface and settled back onto it. One connected mesh --
//! no border inside it to lay twice and stitch, so none of the strips and
//! slivers that laying every piece apart leaves along its seams, and faces
//! the size of the ground's round it.
//!
//! The open ground beyond the collar is left out: it is the ground's, laid as
//! a height over the plane by whoever owns it. The collar's far edge -- the
//! mesh's boundary -- is smoothed along itself, so what meets it there meets
//! a line, not the grid's staircase.

use std::collections::{HashMap, HashSet};

use crate::field::{HeightSource, SolidField};
use crate::pieces::{Region, SplitOptions, split};
use crate::vector::Vec3;

/// The shape's surface, laid.
#[derive(Debug, Clone)]
pub struct ShapedSurface {
    pub vertices: Vec<Vec3>,
    /// Quads, and a triangle where only half a grid quad is the shape's;
    /// counter-clockwise seen from outside the solid.
    pub faces: Vec<Vec<usize>>,
}

/// How many rounds the mesh is relaxed over the surface.
const RELAX_ROUNDS: usize = 10;

/// The surface the shapes in `field` made inside `region`, plus `options`'
/// collar of open ground round it, at `region.cell`.
pub fn shaped_surface<H: HeightSource>(field: &SolidField<H>, region: &Region, options: &SplitOptions) -> ShapedSurface {
    let split = split(field, region, options);
    let keep = |t: usize| !split.pieces[split.piece_of[t]].key.is_open_ground();

    // Surface Nets hands its quads over as two triangles each, in order; a
    // pair both kept is the quad again.
    let mut faces: Vec<Vec<usize>> = Vec::new();
    let mut t = 0;
    while t < split.triangles.len() {
        let pair = t + 1 < split.triangles.len() && shares_edge(split.triangles[t], split.triangles[t + 1]);
        if pair && keep(t) && keep(t + 1) {
            faces.push(quad_of(split.triangles[t], split.triangles[t + 1]));
        } else {
            if keep(t) {
                faces.push(split.triangles[t].to_vec());
            }
            if pair && keep(t + 1) {
                faces.push(split.triangles[t + 1].to_vec());
            }
        }
        t += if pair { 2 } else { 1 };
    }

    // Only the corners the kept faces use, renumbered.
    let mut index: HashMap<usize, usize> = HashMap::new();
    let mut vertices: Vec<Vec3> = Vec::new();
    for face in faces.iter_mut() {
        for corner in face.iter_mut() {
            *corner = *index.entry(*corner).or_insert_with(|| {
                vertices.push(split.positions[*corner]);
                vertices.len() - 1
            });
        }
    }

    relax(field, region, &mut vertices, &faces);
    ShapedSurface { vertices, faces }
}

fn shares_edge(a: [usize; 3], b: [usize; 3]) -> bool {
    a.iter().filter(|v| b.contains(v)).count() == 2
}

/// Two triangles sharing an edge, as the quad round both, keeping their turn.
fn quad_of(a: [usize; 3], b: [usize; 3]) -> Vec<usize> {
    // Rotate `a` so its corner not in `b` comes first: a0, then the shared
    // edge a1 -> a2. `b` walks that edge the other way, a2 -> a1, so its own
    // corner goes between a2 and back round to a0.
    let lone = (0..3).find(|&i| !b.contains(&a[i])).unwrap_or(0);
    let (a0, a1, a2) = (a[lone], a[(lone + 1) % 3], a[(lone + 2) % 3]);
    let other = b.iter().copied().find(|v| *v != a1 && *v != a2).unwrap_or(a0);
    vec![a0, a1, other, a2]
}

/// Pulls every corner toward the middle of its neighbours and settles it back
/// on the surface; a corner on the mesh's edge only along the edge, so the
/// collar's far side comes out a smooth line.
fn relax<H: HeightSource>(field: &SolidField<H>, region: &Region, vertices: &mut [Vec3], faces: &[Vec<usize>]) {
    let mut uses: HashMap<(usize, usize), usize> = HashMap::new();
    let mut neighbours: Vec<HashSet<usize>> = vec![HashSet::new(); vertices.len()];
    for face in faces {
        for i in 0..face.len() {
            let (a, b) = (face[i], face[(i + 1) % face.len()]);
            *uses.entry((a.min(b), a.max(b))).or_default() += 1;
            neighbours[a].insert(b);
            neighbours[b].insert(a);
        }
    }
    let mut along_edge: Vec<Vec<usize>> = vec![Vec::new(); vertices.len()];
    for (&(a, b), &count) in &uses {
        if count == 1 {
            along_edge[a].push(b);
            along_edge[b].push(a);
        }
    }
    let step = region.cell * 0.25;
    // The edge lies on open ground -- a height over the plane -- so it is
    // smoothed in plan and set down straight below: settled along the
    // surface's slope instead, a point smoothed off the grid's staircase on a
    // hillside slides sideways back onto it.
    let settle_edge = |point: Vec3| {
        let top = Vec3::new(point.x, region.max.y, point.z);
        field
            .crossing(top, Vec3::new(0.0, -1.0, 0.0), region.max.y - region.min.y, step, 0)
            .unwrap_or_else(|| field.project(point, step))
    };
    for round in 0..EDGE_ROUNDS {
        let before = vertices.to_vec();
        for (v, vertex) in vertices.iter_mut().enumerate() {
            if along_edge[v].len() != 2 {
                continue;
            }
            let [a, b] = [before[along_edge[v][0]], before[along_edge[v][1]]];
            let mean = (a + b) * 0.5;
            let moved = before[v].lerp(mean, 0.5);
            *vertex = if round + 1 == EDGE_ROUNDS { settle_edge(moved) } else { Vec3::new(moved.x, before[v].y, moved.z) };
        }
    }
    for _ in 0..RELAX_ROUNDS {
        let before = vertices.to_vec();
        for (v, vertex) in vertices.iter_mut().enumerate() {
            if !along_edge[v].is_empty() {
                continue;
            }
            let pull: Vec<usize> = neighbours[v].iter().copied().collect();
            if pull.is_empty() {
                continue;
            }
            let mean = pull.iter().fold(Vec3::default(), |sum, &n| sum + before[n]) * (1.0 / pull.len() as f64);
            *vertex = field.project(before[v].lerp(mean, 0.5), step);
        }
    }
}

/// How many rounds the mesh's edge is smoothed along itself.
const EDGE_ROUNDS: usize = 30;
