//! The table under the ground: solid below its height wherever no ground
//! stands over or under that point of the plane. A pile of earth laid on the
//! bare table rests on it, its foot the ground's new border; a pit dug below
//! the table's height where ground stands is never filled back by it.

use std::collections::HashMap;

use crate::vector::Vec3;

/// Where ground covers the plane, and the table's height.
#[derive(Debug, Clone)]
pub struct TableFloor {
    pub height: f64,
    vertices: Vec<Vec3>,
    triangles: Vec<[usize; 3]>,
    cell: f64,
    buckets: HashMap<(i64, i64), Vec<usize>>,
}

impl TableFloor {
    /// The table at `height`, with `triangles` the ground over it, by their plan.
    pub fn new(height: f64, vertices: Vec<Vec3>, triangles: Vec<[usize; 3]>, cell: f64) -> Self {
        let cell = cell.max(1e-3);
        let mut buckets: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (t, &[a, b, c]) in triangles.iter().enumerate() {
            let (p, q, r) = (vertices[a], vertices[b], vertices[c]);
            let (x0, x1) = ((p.x.min(q.x).min(r.x) / cell).floor() as i64, (p.x.max(q.x).max(r.x) / cell).floor() as i64);
            let (z0, z1) = ((p.z.min(q.z).min(r.z) / cell).floor() as i64, (p.z.max(q.z).max(r.z) / cell).floor() as i64);
            for x in x0..=x1 {
                for z in z0..=z1 {
                    buckets.entry((x, z)).or_default().push(t);
                }
            }
        }
        Self { height, vertices, triangles, cell, buckets }
    }

    /// Whether ground stands over or under `point` in plan.
    pub fn covered(&self, point: Vec3) -> bool {
        let key = ((point.x / self.cell).floor() as i64, (point.z / self.cell).floor() as i64);
        let side = |a: Vec3, b: Vec3| (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
        self.buckets.get(&key).is_some_and(|list| {
            list.iter().any(|&t| {
                let [a, b, c] = self.triangles[t];
                let (p, q, r) = (self.vertices[a], self.vertices[b], self.vertices[c]);
                let (d1, d2, d3) = (side(p, q), side(q, r), side(r, p));
                let negative = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
                let positive = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
                !(negative && positive)
            })
        })
    }

    /// The table's own signed distance at `point`, where it is the floor.
    pub fn distance(&self, point: Vec3) -> Option<f64> {
        (!self.covered(point)).then_some(point.y - self.height)
    }

    /// Whether `point` lies on the table where it is the floor, within `tolerance`.
    pub fn holds(&self, point: Vec3, tolerance: f64) -> bool {
        (point.y - self.height).abs() <= tolerance && !self.covered(point)
    }
}
