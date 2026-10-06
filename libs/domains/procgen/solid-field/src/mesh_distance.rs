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
    buckets: HashMap<[i64; 3], Vec<usize>>,
    /// Bucket coordinates the triangles reach, low and high.
    reach: ([i64; 3], [i64; 3]),
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
        let mut buckets: HashMap<[i64; 3], Vec<usize>> = HashMap::new();
        let mut low = [i64::MAX; 3];
        let mut high = [i64::MIN; 3];
        for (t, &[a, b, c]) in triangles.iter().enumerate() {
            let min = vertices[a].min(vertices[b]).min(vertices[c]);
            let max = vertices[a].max(vertices[b]).max(vertices[c]);
            let (from, to) = (bucket_of(min, cell), bucket_of(max, cell));
            for i in 0..3 {
                low[i] = low[i].min(from[i]);
                high[i] = high[i].max(to[i]);
            }
            for x in from[0]..=to[0] {
                for y in from[1]..=to[1] {
                    for z in from[2]..=to[2] {
                        buckets.entry([x, y, z]).or_default().push(t);
                    }
                }
            }
        }
        Self { vertices, triangles, face_normals, vertex_normals, edge_normals, cell, buckets, reach: (low, high) }
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

    /// Unsigned distance from `point` to the surface.
    pub fn distance(&self, point: Vec3) -> f64 {
        self.nearest(point).map_or(f64::INFINITY, |(closest, _, _)| point.distance(closest))
    }

    fn nearest(&self, point: Vec3) -> Option<(Vec3, usize, Feature)> {
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
        let mut best: Option<(f64, Vec3, usize, Feature)> = None;
        for ring in 0..=farthest {
            for x in centre[0] - ring..=centre[0] + ring {
                for y in centre[1] - ring..=centre[1] + ring {
                    for z in centre[2] - ring..=centre[2] + ring {
                        let shell = (x - centre[0]).abs().max((y - centre[1]).abs()).max((z - centre[2]).abs());
                        if shell != ring {
                            continue;
                        }
                        let Some(list) = self.buckets.get(&[x, y, z]) else { continue };
                        for &t in list {
                            let [a, b, c] = self.triangles[t];
                            let (closest, feature) = closest_on_triangle(point, a, b, c, &self.vertices);
                            let d = point.distance(closest);
                            if best.is_none_or(|(current, ..)| d < current) {
                                best = Some((d, closest, t, feature));
                            }
                        }
                    }
                }
            }
            // Anything in a farther shell is at least this far away.
            if let Some((d, ..)) = best
                && d <= ring as f64 * self.cell
            {
                break;
            }
        }
        best.map(|(_, closest, t, feature)| (closest, t, feature))
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
