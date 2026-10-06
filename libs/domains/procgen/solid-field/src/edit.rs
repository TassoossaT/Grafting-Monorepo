//! Carving into the ground, or filling it in, as an edit of the ground's own
//! mesh.
//!
//! ```text
//! faces to lay again + ground round them
//!   -> where solid is after the edit      (their mesh, shapes carved or filled)
//!   -> the new surface, read on a grid    (Surface Nets, kept off the ring)
//!   -> stitched to the ring left standing (a strip, ring nodes untouched)
//!   -> even triangles                     (isotropic remesh, ring locked)
//!   -> the irregular grid's own cells     (pair, ortho, relax -- in 3D)
//! ```
//!
//! Nothing is kept beside the ground. The faces handed in are laid again; the
//! ring of nodes round them -- what the ground beyond still holds -- comes
//! back as the very same nodes, every edge of it unsplit, so the result goes
//! back into the graph as ground like any other, one mesh with the rest.

use std::collections::{HashMap, HashSet};

use grafting_procgen_irregular_grid::ortho::{ortho_along, weld_faces_tracked};
use grafting_procgen_irregular_grid::pair::pair_triangles;
use grafting_procgen_irregular_grid::{FaceMesh, Random, Vec2, regular_cell_targets};

use crate::field::Shape;
use crate::mesh_distance::MeshDistance;
use crate::trimesh::{Remesh, border_loops, zipper};
use crate::vector::Vec3;
use crate::volume::EditField;

/// Faces, as indices into their own vertices, in whatever winding the
/// caller's ground uses -- the same for every face.
#[derive(Debug, Clone, Default)]
pub struct Faces {
    pub vertices: Vec<Vec3>,
    pub faces: Vec<Vec<usize>>,
}

/// One edit: what to carve or fill, and the cells to lay the result in.
#[derive(Debug, Clone)]
pub struct SurfaceEdit {
    pub shapes: Vec<Shape>,
    /// Width over which a shape blends into the ground.
    pub blend: f64,
    /// How wide one finished face should be -- the ground's own size; laid
    /// finer where a shape is narrower than ten faces round.
    pub face_side: f64,
    pub seed: u32,
}

/// The faces laid in place of the ones handed in.
#[derive(Debug, Clone)]
pub struct EditedSurface {
    pub vertices: Vec<Vec3>,
    /// In the winding the faces handed in had.
    pub faces: Vec<Vec<usize>>,
    /// Index-aligned with `vertices`: the vertex of the faces handed in a
    /// corner is, for every corner of the ring left standing.
    pub source: Vec<Option<usize>>,
}

/// The coarsest face an edit lays, as a share of its narrowest shape's
/// radius: some ten faces round a tunnel.
const SHAPE_FACE_SHARE: f64 = 0.6;

/// Relaxation passes the finished cells take.
const RELAX_ROUNDS: usize = 12;
/// The longest hole in the read surface closed in place, in cells round.
const MOST_HOLE_CELLS: f64 = 16.0;

/// Remesh rounds.
const REMESH_ROUNDS: usize = 6;

/// Lays `patch` again with `edit` carved into or filled onto it. `context`
/// is the ground round it -- never laid again, only asked where solid is.
pub fn edit_surface(patch: &Faces, context: &Faces, edit: &SurfaceEdit) -> Result<EditedSurface, String> {
    if patch.faces.is_empty() {
        return Err("no ground to edit".to_string());
    }
    // The ground's own face size, but never coarser than the shapes allow: a
    // tunnel narrower than two faces read on a grid of them is no tunnel.
    let narrowest = edit.shapes.iter().map(|shape| shape.radius).fold(f64::INFINITY, f64::min);
    let ground_side = edit.face_side.max(0.25);
    let side = ground_side.min(narrowest * SHAPE_FACE_SHARE).max(0.25);
    let cell = side;
    let length = side * 2.0;
    // Faces at the shape's size on and round it, easing back to the ground's
    // over a couple of the ground's faces: a tunnel needs ten faces round it,
    // the hillside it runs under does not.
    let shapes_ref = &edit.shapes;
    let blend = edit.blend;
    let size_at = move |point: Vec3| -> f64 {
        let near = shapes_ref.iter().map(|s| s.distance(point).abs()).fold(f64::INFINITY, f64::min);
        let t = ((near - blend) / (ground_side * 2.0)).clamp(0.0, 1.0);
        let eased = t * t * (3.0 - 2.0 * t);
        2.0 * (side + (ground_side - side) * eased)
    };

    // Which way the faces' winding points: the ground faces up, so the
    // winding whose normal mostly rises is out of the solid.
    let rising: f64 = [patch, context]
        .iter()
        .flat_map(|faces| faces.faces.iter().map(|face| newell(&faces.vertices, face).y))
        .sum();
    let flip = rising < 0.0;
    let outward = |face: &Vec<usize>| -> Vec<usize> { if flip { face.iter().rev().copied().collect() } else { face.clone() } };

    // Where solid is: the patch and the ground round it, as one mesh.
    let mut all_vertices = patch.vertices.clone();
    let mut all_faces: Vec<Vec<usize>> = patch.faces.iter().map(outward).collect();
    let offset = all_vertices.len();
    all_vertices.extend(context.vertices.iter().copied());
    all_faces.extend(context.faces.iter().map(|face| outward(face).into_iter().map(|v| v + offset).collect()));
    let ground = MeshDistance::new(all_vertices, &all_faces, length);
    let patch_only = MeshDistance::new(patch.vertices.clone(), &patch.faces.iter().map(outward).collect::<Vec<_>>(), length);
    let field = EditField { ground: &ground, shapes: &edit.shapes, blend: edit.blend };
    let step = cell * 0.25;
    let settle = |point: Vec3| field.project(point, step, cell);

    // The ring: the patch's open borders, walked as its faces walk them.
    let patch_triangles: Vec<[usize; 3]> = patch
        .faces
        .iter()
        .map(outward)
        .filter(|face| face.len() >= 3)
        .flat_map(|face| (1..face.len() - 1).map(move |k| [face[0], face[k], face[k + 1]]).collect::<Vec<_>>())
        .collect();
    let rings = border_loops(&patch_triangles);
    if rings.is_empty() {
        return Err("the ground to edit has no border".to_string());
    }
    let ring_segments: Vec<(Vec3, Vec3)> = rings
        .iter()
        .flat_map(|ring| (0..ring.len()).map(move |i| (ring[i], ring[(i + 1) % ring.len()])))
        .map(|(a, b)| (patch.vertices[a], patch.vertices[b]))
        .collect();
    let to_ring = |point: Vec3| ring_segments.iter().map(|&(a, b)| point.distance_to_segment(a, b)).fold(f64::INFINITY, f64::min);

    // The new surface, over the patch and the shapes' reach.
    let mut min = Vec3::splat(f64::INFINITY);
    let mut max = Vec3::splat(f64::NEG_INFINITY);
    for &v in &patch.vertices {
        min = min.min(v);
        max = max.max(v);
    }
    for shape in &edit.shapes {
        let (low, high) = shape.bounds(edit.blend);
        min = min.min(low);
        max = max.max(high);
    }
    let ring_points: Vec<Vec<Vec3>> = rings.iter().map(|ring| ring.iter().map(|&v| patch.vertices[v]).collect()).collect();
    // Read at the face size first, finer where that reads the surface
    // wrong: solid thinner than a cell -- a shallow roof -- comes back with
    // edges three faces hold, or two faces walking one edge the same way.
    let read = |grid: f64, mend: bool| -> Option<(Vec<Vec3>, Vec<[usize; 3]>)> {
        let pad = Vec3::splat(grid * 2.0);
        let (extracted, extracted_triangles) = field.extract(min - pad, max + pad, grid);
        // Kept: what lies over the patch or in a shape's reach, clear of the ring.
        let clearance = cell * 1.25;
        let reach = edit.blend + grid * 1.5;
        let kept: Vec<[usize; 3]> = extracted_triangles
            .iter()
            .copied()
            .filter(|&[a, b, c]| {
                let centre = (extracted[a] + extracted[b] + extracted[c]) * (1.0 / 3.0);
                let near = patch_only.distance(centre) < cell * 1.5 || edit.shapes.iter().any(|s| s.distance(centre) < reach);
                near && [a, b, c].iter().all(|&v| to_ring(extracted[v]) > clearance)
            })
            .collect();
        let whole = pruned(kept.clone()).len() == kept.len();
        if !whole && !mend {
            return None;
        }
        let kept = joined_to_rings(&pruned(kept), &ring_points, &extracted, cell * 3.0);
        // Every ring has a border of the new surface running along it, and a
        // clean read has no other.
        let borders = border_loops(&kept);
        let follows = |ring: &Vec<Vec3>| borders.iter().any(|border| mean_gap_to(ring, border, &extracted) < cell * 3.0);
        let clean = mend || borders.len() == rings.len();
        (clean && ring_points.iter().all(follows)).then_some((extracted, kept))
    };
    // A clean read at either size first; mended only where neither is.
    let (extracted, kept) = [(cell, false), (cell / 2.0, false), (cell, true), (cell / 2.0, true)]
        .into_iter()
        .find_map(|(grid, mend)| read(grid, mend))
        .ok_or("a superfície nova não encontra o terreno em volta")?;

    // One mesh: the ring's vertices first, locked, then the new surface's.
    let mut ring_index: HashMap<usize, usize> = HashMap::new();
    let mut vertices: Vec<Vec3> = Vec::new();
    let mut source: Vec<Option<usize>> = Vec::new();
    for ring in &rings {
        for &v in ring {
            ring_index.entry(v).or_insert_with(|| {
                vertices.push(patch.vertices[v]);
                source.push(Some(v));
                vertices.len() - 1
            });
        }
    }
    let ring_count = vertices.len();
    let mut new_index: HashMap<usize, usize> = HashMap::new();
    let mut triangles: Vec<[usize; 3]> = kept
        .iter()
        .map(|t| {
            t.map(|v| {
                *new_index.entry(v).or_insert_with(|| {
                    vertices.push(extracted[v]);
                    source.push(None);
                    vertices.len() - 1
                })
            })
        })
        .collect();

    // Stitch every ring to the border of the new surface nearest it.
    let inner_loops: Vec<Vec<usize>> = border_loops(&triangles);
    let mut used_inner: HashSet<usize> = HashSet::new();
    for ring in &rings {
        let outer: Vec<usize> = ring.iter().map(|v| ring_index[v]).collect();
        let nearest = (0..inner_loops.len()).filter(|i| !used_inner.contains(i)).min_by(|&a, &b| {
            mean_gap(&outer, &inner_loops[a], &vertices).total_cmp(&mean_gap(&outer, &inner_loops[b], &vertices))
        });
        match nearest {
            Some(i) => {
                used_inner.insert(i);
                triangles.extend(zipper(&outer, &inner_loops[i], &vertices));
            }
            None => {
                // The edit took everything inside this ring away from the
                // surface (or never reached it): close it with what it had.
                return Err("a borda do terreno em volta não encontra a superfície nova".to_string());
            }
        }
    }
    // What is left open is a hole the read left where it could not make the
    // surface out -- a cell the grid read two ways: closed by a fan round a
    // corner settled in its middle.
    for (i, hole) in inner_loops.iter().enumerate() {
        if used_inner.contains(&i) {
            continue;
        }
        let perimeter: f64 = (0..hole.len()).map(|k| vertices[hole[k]].distance(vertices[hole[(k + 1) % hole.len()]])).sum();
        if perimeter > cell * MOST_HOLE_CELLS {
            return Err("a superfície nova tem um buraco grande demais dentro da região".to_string());
        }
        let middle = hole.iter().fold(Vec3::default(), |sum, &v| sum + vertices[v]) * (1.0 / hole.len() as f64);
        vertices.push(settle(middle));
        source.push(None);
        let centre = vertices.len() - 1;
        for k in 0..hole.len() {
            triangles.push([hole[(k + 1) % hole.len()], hole[k], centre]);
        }
    }

    // Even triangles, the ring locked.
    let mut locked_edges: HashSet<(usize, usize)> = HashSet::new();
    for ring in &rings {
        for i in 0..ring.len() {
            let (a, b) = (ring_index[&ring[i]], ring_index[&ring[(i + 1) % ring.len()]]);
            locked_edges.insert((a.min(b), a.max(b)));
        }
    }
    let mut remesh = Remesh {
        vertices,
        triangles,
        locked: (0..source.len()).map(|v| v < ring_count).collect(),
        locked_edges: locked_edges.clone(),
        settle: &settle,
    };
    remesh.run(&size_at, REMESH_ROUNDS);
    let source: Vec<Option<usize>> = (0..remesh.vertices.len()).map(|v| if v < ring_count { source[v] } else { None }).collect();

    // The irregular grid's own steps, over the surface.
    let mut random = Random::new(edit.seed);
    let triangle_mesh = FaceMesh { vertices: remesh.vertices.clone(), faces: remesh.triangles.iter().map(|t| t.to_vec()).collect() };
    let paired = pair_triangles(&triangle_mesh, &mut random);
    let seams: HashMap<(usize, usize), Vec<usize>> = remesh.locked_edges.iter().map(|&edge| (edge, Vec::new())).collect();
    let cells = ortho_along(&paired, &seams);
    let (welded, remap) = weld_faces_tracked(&cells, 1e-9);
    let mut welded_source = vec![None; welded.vertices.len()];
    for (before, after) in remap.iter().enumerate() {
        if before < source.len()
            && let Some(s) = source[before]
        {
            welded_source[*after] = Some(s);
        }
    }
    let pinned: Vec<bool> = welded_source.iter().map(Option::is_some).collect();
    let vertices = relax_on_surface(&welded.vertices, &welded.faces, &pinned, &settle);

    let faces = welded.faces.iter().map(|face| if flip { face.iter().rev().copied().collect() } else { face.clone() }).collect();
    Ok(EditedSurface { vertices, faces, source: welded_source })
}

/// `triangles` without the ones on a malformed edge -- held by three, or
/// walked the same way by two -- until none is left: where the grid read
/// solid thinner than a cell, or a pinch of two surfaces in one cell. What
/// that leaves open is closed afterwards.
fn pruned(mut triangles: Vec<[usize; 3]>) -> Vec<[usize; 3]> {
    loop {
        let mut directed: HashMap<(usize, usize), usize> = HashMap::new();
        let mut undirected: HashMap<(usize, usize), usize> = HashMap::new();
        for &[a, b, c] in &triangles {
            for (p, q) in [(a, b), (b, c), (c, a)] {
                *directed.entry((p, q)).or_default() += 1;
                *undirected.entry((p.min(q), p.max(q))).or_default() += 1;
            }
        }
        let bad = |&[a, b, c]: &[usize; 3]| {
            [(a, b), (b, c), (c, a)].iter().any(|&(p, q)| directed[&(p, q)] > 1 || undirected[&(p.min(q), p.max(q))] > 2)
        };
        let before = triangles.len();
        triangles.retain(|t| !bad(t));
        if triangles.len() == before {
            return triangles;
        }
    }
}

/// How far, on average, the points of `ring` are from the nearest of `border`.
fn mean_gap_to(ring: &[Vec3], border: &[usize], vertices: &[Vec3]) -> f64 {
    ring.iter().map(|&r| border.iter().map(|&v| r.distance(vertices[v])).fold(f64::INFINITY, f64::min)).sum::<f64>() / ring.len() as f64
}

/// Normal of a face by Newell's method, unnormalised.
fn newell(vertices: &[Vec3], face: &[usize]) -> Vec3 {
    let mut n = Vec3::default();
    for i in 0..face.len() {
        let (a, b) = (vertices[face[i]], vertices[face[(i + 1) % face.len()]]);
        n = n + Vec3::new((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y));
    }
    n
}

/// How far, on average, the points of `outer` are from the nearest of `inner`.
fn mean_gap(outer: &[usize], inner: &[usize], vertices: &[Vec3]) -> f64 {
    outer.iter().map(|&o| inner.iter().map(|&i| vertices[o].distance(vertices[i])).fold(f64::INFINITY, f64::min)).sum::<f64>() / outer.len() as f64
}

/// Keeps only the connected stretches of `triangles` one of whose open
/// borders runs along a ring -- within `near` of it on average. A cave
/// sealed inside solid has no border, and stray surface the grid read where
/// the patch says nothing runs along no ring: no ground would ever join
/// either.
fn joined_to_rings(triangles: &[[usize; 3]], rings: &[Vec<Vec3>], vertices: &[Vec3], near: f64) -> Vec<[usize; 3]> {
    let mut by_vertex: HashMap<usize, Vec<usize>> = HashMap::new();
    for (t, tri) in triangles.iter().enumerate() {
        for &v in tri {
            by_vertex.entry(v).or_default().push(t);
        }
    }
    let mut seen = vec![false; triangles.len()];
    let mut kept = Vec::new();
    for seed in 0..triangles.len() {
        if seen[seed] {
            continue;
        }
        let mut component = Vec::new();
        let mut stack = vec![seed];
        seen[seed] = true;
        while let Some(t) = stack.pop() {
            component.push(triangles[t]);
            for &v in &triangles[t] {
                for &other in &by_vertex[&v] {
                    if !seen[other] {
                        seen[other] = true;
                        stack.push(other);
                    }
                }
            }
        }
        let borders = border_loops(&component);
        let follows_a_ring = borders.iter().any(|border| {
            rings.iter().any(|ring| {
                let gap = ring.iter().map(|&r| border.iter().map(|&v| r.distance(vertices[v])).fold(f64::INFINITY, f64::min)).sum::<f64>() / ring.len() as f64;
                gap < near
            })
        });
        if follows_a_ring {
            kept.extend(component);
        }
    }
    kept
}

/// The irregular grid's relaxation over a surface: each cell laid flat in its
/// own plane, pulled toward the regular polygon it is nearest there, and
/// every corner settled back onto the surface. Pinned corners never move.
fn relax_on_surface(vertices: &[Vec3], faces: &[Vec<usize>], pinned: &[bool], settle: &dyn Fn(Vec3) -> Vec3) -> Vec<Vec3> {
    let mut current = vertices.to_vec();
    for _ in 0..RELAX_ROUNDS {
        let mut sum = vec![Vec3::default(); current.len()];
        let mut count = vec![0u32; current.len()];
        for face in faces {
            if face.len() < 3 {
                continue;
            }
            let corners: Vec<Vec3> = face.iter().map(|&v| current[v]).collect();
            let centre = corners.iter().fold(Vec3::default(), |s, &p| s + p) * (1.0 / corners.len() as f64);
            let normal = newell(&current, face).normalized();
            let first = corners[0] - centre;
            let u = (first - normal * first.dot(normal)).normalized();
            let v = normal.cross(u);
            let flat: Vec<Vec2> = corners.iter().map(|&p| Vec2::new((p - centre).dot(u), (p - centre).dot(v))).collect();
            for (&index, target) in face.iter().zip(regular_cell_targets(&flat)) {
                sum[index] = sum[index] + centre + u * target.x + v * target.y;
                count[index] += 1;
            }
        }
        current = current
            .iter()
            .enumerate()
            .map(|(i, &p)| {
                if pinned[i] || count[i] == 0 {
                    return p;
                }
                let target = sum[i] * (1.0 / f64::from(count[i]));
                settle(p.lerp(target, 0.5))
            })
            .collect();
    }
    current
}
