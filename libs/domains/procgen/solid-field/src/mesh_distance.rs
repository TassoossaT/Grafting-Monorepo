//! Signed distance to a surface given as faces -- the ground itself.
//!
//! The distance is to the nearest point of any triangle of the faces; its
//! sign comes from the angle-weighted pseudo-normal of the feature that point
//! lies on (Baerentzen and Aanaes), outward meaning air. That is what makes
//! "inside the hill" a question the ground's own mesh answers, with no height
//! map beside it: a tunnel under faces nobody is laying again still knows it
//! is in solid.
//!
//! A uniform grid of triangle buckets keeps a query to the triangles near it.

use std::collections::HashMap;

use crate::vector::Vec3;

#[derive(Debug, Clone, Copy)]
enum Feature {
    Face,
    Edge(usize, usize),
    Vertex(usize),
}

/// The ground as triangles, ready to be asked how far a point is from it.
#[derive(Debug, Clone)]
pub struct MeshDistance {
    vertices: Vec<Vec3>,
    triangles: Vec<[usize; 3]>,
    face_normals: Vec<Vec3>,
    vertex_normals: Vec<Vec3>,
    edge_normals: HashMap<(usize, usize), Vec3>,
    cell: f64,
    /// Triangles by bucket, a dense grid over `reach`: indexed, never hashed
    /// -- the search asks hundreds of buckets for every point it measures.
    buckets: Vec<Vec<usize>>,
    /// Bucket coordinates the triangles reach, low and high.
    reach: ([i64; 3], [i64; 3]),
    /// Each triangle's middle, for the cheap search past a measuring reach.
    centres: Vec<Vec3>,
    /// The open border: edges one triangle holds, and their vertices.
    border_edges: std::collections::HashSet<(usize, usize)>,
    border_vertices: std::collections::HashSet<usize>,
}

fn key(a: usize, b: usize) -> (usize, usize) {
    (a.min(b), a.max(b))
}

impl MeshDistance {
    /// `faces` wound so their normal by the right-hand rule points out of the
    /// solid, fanned into triangles. `cell` sizes the search buckets: about
    /// the length of a face.
    pub fn new(vertices: Vec<Vec3>, faces: &[Vec<usize>], cell: f64) -> Self {
        let triangles: Vec<[usize; 3]> = faces
            .iter()
            .filter(|face| face.len() >= 3)
            .flat_map(|face| (1..face.len() - 1).map(move |k| [face[0], face[k], face[k + 1]]))
            .filter(|t| t[0] != t[1] && t[1] != t[2] && t[0] != t[2])
            .collect();
        let face_normals: Vec<Vec3> = triangles
            .iter()
            .map(|&[a, b, c]| (vertices[b] - vertices[a]).cross(vertices[c] - vertices[a]).normalized())
            .collect();
        let mut vertex_normals = vec![Vec3::default(); vertices.len()];
        let mut edge_normals: HashMap<(usize, usize), Vec3> = HashMap::new();
        for (t, &[a, b, c]) in triangles.iter().enumerate() {
            let n = face_normals[t];
            for (corner, before, after) in [(a, c, b), (b, a, c), (c, b, a)] {
                let u = (vertices[before] - vertices[corner]).normalized();
                let v = (vertices[after] - vertices[corner]).normalized();
                let angle = u.dot(v).clamp(-1.0, 1.0).acos();
                vertex_normals[corner] = vertex_normals[corner] + n * angle;
            }
            for (p, q) in [(a, b), (b, c), (c, a)] {
                let entry = edge_normals.entry(key(p, q)).or_default();
                *entry = *entry + n;
            }
        }

        let cell = cell.max(1e-3);
        let mut low = [i64::MAX; 3];
        let mut high = [i64::MIN; 3];
        let spans: Vec<([i64; 3], [i64; 3])> = triangles
            .iter()
            .map(|&[a, b, c]| {
                let (from, to) = (bucket_of(vertices[a].min(vertices[b]).min(vertices[c]), cell), bucket_of(vertices[a].max(vertices[b]).max(vertices[c]), cell));
                for i in 0..3 {
                    low[i] = low[i].min(from[i]);
                    high[i] = high[i].max(to[i]);
                }
                (from, to)
            })
            .collect();
        if triangles.is_empty() {
            low = [0; 3];
            high = [0; 3];
        }
        let size = [(high[0] - low[0] + 1) as usize, (high[1] - low[1] + 1) as usize, (high[2] - low[2] + 1) as usize];
        let mut buckets: Vec<Vec<usize>> = vec![Vec::new(); size[0] * size[1] * size[2]];
        for (t, &(from, to)) in spans.iter().enumerate() {
            for x in from[0]..=to[0] {
                for y in from[1]..=to[1] {
                    for z in from[2]..=to[2] {
                        let index = (((x - low[0]) as usize) * size[1] + (y - low[1]) as usize) * size[2] + (z - low[2]) as usize;
                        buckets[index].push(t);
                    }
                }
            }
        }
        let centres = triangles.iter().map(|&[a, b, c]| (vertices[a] + vertices[b] + vertices[c]) * (1.0 / 3.0)).collect();
        let mut uses: HashMap<(usize, usize), u32> = HashMap::new();
        for &[a, b, c] in &triangles {
            for (p, q) in [(a, b), (b, c), (c, a)] {
                *uses.entry(key(p, q)).or_default() += 1;
            }
        }
        let border_edges: std::collections::HashSet<(usize, usize)> = uses.into_iter().filter(|&(_, n)| n == 1).map(|(e, _)| e).collect();
        let border_vertices = border_edges.iter().flat_map(|&(a, b)| [a, b]).collect();
        Self { vertices, triangles, face_normals, vertex_normals, edge_normals, cell, buckets, reach: (low, high), centres, border_edges, border_vertices }
    }

    /// Signed distance from `point` to the surface: negative inside solid.
    pub fn signed_distance(&self, point: Vec3) -> f64 {
        let Some((closest, t, feature)) = self.nearest(point) else {
            return f64::INFINITY;
        };
        let normal = match feature {
            Feature::Face => self.face_normals[t],
            Feature::Edge(a, b) => self.edge_normals.get(&key(a, b)).copied().unwrap_or(self.face_normals[t]),
            Feature::Vertex(v) => self.vertex_normals[v],
        };
        let offset = point - closest;
        let distance = offset.length();
        if offset.dot(normal) < 0.0 { -distance } else { distance }
    }

    /// Signed distance, and whether the nearest point of the surface lies on
    /// its open border -- where the sign says nothing: past the edge of an
    /// open sheet of ground, inside and outside are undefined.
    pub fn signed_distance_at_border(&self, point: Vec3) -> (f64, bool) {
        self.signed_distance_at_border_within(point, f64::INFINITY)
    }

    /// [`Self::signed_distance_at_border`], exact only within `reach`: past it
    /// the size is a stand-in and only the sign is to be read.
    pub fn signed_distance_at_border_within(&self, point: Vec3, reach: f64) -> (f64, bool) {
        let Some((closest, t, feature)) = self.nearest_within(point, reach) else {
            return (f64::INFINITY, true);
        };
        let (normal, on_border) = match feature {
            Feature::Face => (self.face_normals[t], false),
            Feature::Edge(a, b) => (self.edge_normals.get(&key(a, b)).copied().unwrap_or(self.face_normals[t]), self.border_edges.contains(&key(a, b))),
            Feature::Vertex(v) => (self.vertex_normals[v], self.border_vertices.contains(&v)),
        };
        let offset = point - closest;
        let distance = offset.length();
        (if offset.dot(normal) < 0.0 { -distance } else { distance }, on_border)
    }

    /// Unsigned distance from `point` to the surface.
    pub fn distance(&self, point: Vec3) -> f64 {
        self.nearest(point).map_or(f64::INFINITY, |(closest, _, _)| point.distance(closest))
    }

    /// The nearest point of the surface to `point`, and the corners of the
    /// triangle it lies on, as indices into the vertices handed in.
    pub fn closest(&self, point: Vec3) -> Option<(Vec3, [usize; 3])> {
        self.nearest(point).map(|(closest, t, _)| (closest, self.triangles[t]))
    }

    fn nearest(&self, point: Vec3) -> Option<(Vec3, usize, Feature)> {
        self.nearest_within(point, f64::INFINITY)
    }

    /// The triangles in bucket `[x, y, z]`, none outside the grid.
    fn bucket(&self, [x, y, z]: [i64; 3]) -> &[usize] {
        let (low, high) = self.reach;
        if x < low[0] || y < low[1] || z < low[2] || x > high[0] || y > high[1] || z > high[2] {
            return &[];
        }
        let size = [(high[0] - low[0] + 1) as usize, (high[1] - low[1] + 1) as usize, (high[2] - low[2] + 1) as usize];
        &self.buckets[(((x - low[0]) as usize) * size[1] + (y - low[1]) as usize) * size[2] + (z - low[2]) as usize]
    }

    /// The buckets of ring `ring` round `centre`: the shell of the cube, never its inside.
    fn for_shell(&self, centre: [i64; 3], ring: i64, mut visit: impl FnMut(&[usize])) {
        if ring == 0 {
            visit(self.bucket(centre));
            return;
        }
        for x in centre[0] - ring..=centre[0] + ring {
            for y in centre[1] - ring..=centre[1] + ring {
                let on_side = (x - centre[0]).abs() == ring || (y - centre[1]).abs() == ring;
                if on_side {
                    for z in centre[2] - ring..=centre[2] + ring {
                        visit(self.bucket([x, y, z]));
                    }
                } else {
                    visit(self.bucket([x, y, centre[2] - ring]));
                    visit(self.bucket([x, y, centre[2] + ring]));
                }
            }
        }
    }

    /// The nearest point exactly where it lies within `reach`; past it, the
    /// triangle whose middle is nearest stands in -- right in sign, wrong
    /// perhaps in size, which past the reach nobody reads.
    fn nearest_within(&self, point: Vec3, reach: f64) -> Option<(Vec3, usize, Feature)> {
        if self.triangles.is_empty() {
            return None;
        }
        let centre = bucket_of(point, self.cell);
        let (low, high) = self.reach;
        // How far out shells can still find a triangle.
        let farthest = (0..3)
            .map(|i| (centre[i] - low[i]).abs().max((high[i] - centre[i]).abs()))
            .max()
            .unwrap_or(0);
        let measured = if reach.is_finite() { ((reach / self.cell).ceil() as i64 + 1).min(farthest) } else { farthest };
        let mut best: Option<(f64, Vec3, usize, Feature)> = None;
        for ring in 0..=measured {
            self.for_shell(centre, ring, |list| {
                for &t in list {
                    let [a, b, c] = self.triangles[t];
                    let (closest, feature) = closest_on_triangle(point, a, b, c, &self.vertices);
                    let d = point.distance(closest);
                    if best.is_none_or(|(current, ..)| d < current) {
                        best = Some((d, closest, t, feature));
                    }
                }
            });
            // Anything in a farther shell is at least this far away.
            if let Some((d, ..)) = best
                && d <= ring as f64 * self.cell
            {
                return best.map(|(_, closest, t, feature)| (closest, t, feature));
            }
        }
        if best.is_some() || measured >= farthest {
            return best.map(|(_, closest, t, feature)| (closest, t, feature));
        }
        // Past the reach: the nearest middle, measured exactly on its own triangle.
        let mut nearest_middle: Option<(f64, usize)> = None;
        for ring in measured + 1..=farthest {
            self.for_shell(centre, ring, |list| {
                for &t in list {
                    let d = point.distance(self.centres[t]);
                    if nearest_middle.is_none_or(|(current, _)| d < current) {
                        nearest_middle = Some((d, t));
                    }
                }
            });
            if nearest_middle.is_some() {
                break;
            }
        }
        nearest_middle.map(|(_, t)| {
            let [a, b, c] = self.triangles[t];
            let (closest, feature) = closest_on_triangle(point, a, b, c, &self.vertices);
            (closest, t, feature)
        })
    }
}

fn bucket_of(point: Vec3, cell: f64) -> [i64; 3] {
    [(point.x / cell).floor() as i64, (point.y / cell).floor() as i64, (point.z / cell).floor() as i64]
}

/// The point of triangle `a b c` nearest `p`, and which feature it lies on
/// (Ericson, *Real-Time Collision Detection*, 5.1.5).
fn closest_on_triangle(p: Vec3, a: usize, b: usize, c: usize, vertices: &[Vec3]) -> (Vec3, Feature) {
    let (pa, pb, pc) = (vertices[a], vertices[b], vertices[c]);
    let ab = pb - pa;
    let ac = pc - pa;
    let ap = p - pa;
    let d1 = ab.dot(ap);
    let d2 = ac.dot(ap);
    if d1 <= 0.0 && d2 <= 0.0 {
        return (pa, Feature::Vertex(a));
    }
    let bp = p - pb;
    let d3 = ab.dot(bp);
    let d4 = ac.dot(bp);
    if d3 >= 0.0 && d4 <= d3 {
        return (pb, Feature::Vertex(b));
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        let v = d1 / (d1 - d3);
        return (pa + ab * v, Feature::Edge(a, b));
    }
    let cp = p - pc;
    let d5 = ab.dot(cp);
    let d6 = ac.dot(cp);
    if d6 >= 0.0 && d5 <= d6 {
        return (pc, Feature::Vertex(c));
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        let w = d2 / (d2 - d6);
        return (pa + ac * w, Feature::Edge(a, c));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return (pb + (pc - pb) * w, Feature::Edge(b, c));
    }
    let denominator = 1.0 / (va + vb + vc);
    let v = vb * denominator;
    let w = vc * denominator;
    (pa + ab * v + ac * w, Feature::Face)
}
