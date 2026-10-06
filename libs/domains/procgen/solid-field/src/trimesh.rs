//! A triangle mesh being shaped into the ground: its open borders, the strip
//! that stitches a new surface onto a ring of ground left standing, and the
//! isotropic remesh that evens its triangles out before the irregular grid's
//! own steps lay cells over it.
//!
//! The remesh follows Botsch and Kobbelt's *A Remeshing Approach to
//! Multiresolution Modeling* (2004): split long edges, collapse short ones,
//! flip toward even valence, smooth tangentially and settle back onto the
//! surface. Locked vertices and edges -- the ring of ground the new surface
//! meets -- are never moved, split, collapsed or flipped, so what stands
//! round the edit keeps its every node.

use std::collections::{HashMap, HashSet};

use crate::vector::Vec3;

fn key(a: usize, b: usize) -> (usize, usize) {
    (a.min(b), a.max(b))
}

/// Every open border of `triangles` -- an edge no other triangle walks the
/// other way -- chained into closed loops, each walked the way its triangles
/// walk it.
pub fn border_loops(triangles: &[[usize; 3]]) -> Vec<Vec<usize>> {
    let mut directed: HashSet<(usize, usize)> = HashSet::new();
    for &[a, b, c] in triangles {
        for edge in [(a, b), (b, c), (c, a)] {
            directed.insert(edge);
        }
    }
    let mut next: HashMap<usize, Vec<usize>> = HashMap::new();
    for &(a, b) in &directed {
        if !directed.contains(&(b, a)) {
            next.entry(a).or_default().push(b);
        }
    }
    for targets in next.values_mut() {
        targets.sort_unstable_by(|a, b| b.cmp(a));
    }
    let mut loops = Vec::new();
    let mut starts: Vec<usize> = next.keys().copied().collect();
    starts.sort_unstable();
    for start in starts {
        while let Some(first) = next.get_mut(&start).and_then(|targets| targets.pop()) {
            let mut walk = vec![start];
            let mut here = first;
            while here != start {
                walk.push(here);
                match next.get_mut(&here).and_then(|targets| targets.pop()) {
                    Some(onward) => here = onward,
                    None => break,
                }
            }
            if here == start && walk.len() >= 3 {
                loops.push(walk);
            }
        }
    }
    loops
}

/// Triangles stitching the ring `outer` -- walked the way the faces inside
/// it walked it -- to the border `inner` of a surface inside it, walked the
/// way that surface's triangles walk it. Both run round the same way; the
/// strip advances along whichever side keeps its new diagonal shorter.
pub fn zipper(outer: &[usize], inner: &[usize], vertices: &[Vec3]) -> Vec<[usize; 3]> {
    if outer.is_empty() || inner.is_empty() {
        return Vec::new();
    }
    let start = (0..inner.len())
        .min_by(|&a, &b| vertices[inner[a]].distance(vertices[outer[0]]).total_cmp(&vertices[inner[b]].distance(vertices[outer[0]])))
        .unwrap_or(0);
    let r = |i: usize| outer[i % outer.len()];
    let l = |j: usize| inner[(start + j) % inner.len()];
    let (mut i, mut j) = (0, 0);
    let mut triangles = Vec::with_capacity(outer.len() + inner.len());
    while i < outer.len() || j < inner.len() {
        let advance_outer = if i >= outer.len() {
            false
        } else if j >= inner.len() {
            true
        } else {
            vertices[r(i + 1)].distance(vertices[l(j)]) <= vertices[r(i)].distance(vertices[l(j + 1)])
        };
        if advance_outer {
            triangles.push([r(i), r(i + 1), l(j)]);
            i += 1;
        } else {
            triangles.push([r(i), l(j + 1), l(j)]);
            j += 1;
        }
    }
    triangles
}

/// Triangles stitching the open chain `outer` to the stretch `inner` of a
/// border running beside it, both walked the same way; the strip advances
/// along whichever side keeps its new diagonal shorter, end to end.
pub fn zipper_open(outer: &[usize], inner: &[usize], vertices: &[Vec3]) -> Vec<[usize; 3]> {
    if outer.len() < 2 && inner.len() < 2 {
        return Vec::new();
    }
    let (mut i, mut j) = (0, 0);
    let mut triangles = Vec::with_capacity(outer.len() + inner.len());
    while i + 1 < outer.len() || j + 1 < inner.len() {
        let advance_outer = if i + 1 >= outer.len() {
            false
        } else if j + 1 >= inner.len() {
            true
        } else {
            vertices[outer[i + 1]].distance(vertices[inner[j]]) <= vertices[outer[i]].distance(vertices[inner[j + 1]])
        };
        if advance_outer {
            triangles.push([outer[i], outer[i + 1], inner[j]]);
            i += 1;
        } else {
            triangles.push([outer[i], inner[j + 1], inner[j]]);
            j += 1;
        }
    }
    triangles
}

/// Whether triangle `[a, b, c]` faces out of the solid, the way `facing` says out is.
fn faces_out(vertices: &[Vec3], [a, b, c]: [usize; 3], facing: &dyn Fn(Vec3) -> Vec3) -> bool {
    let normal = (vertices[b] - vertices[a]).cross(vertices[c] - vertices[a]);
    normal.length() > 1e-12 && normal.dot(facing((vertices[a] + vertices[b] + vertices[c]) * (1.0 / 3.0))) > 0.0
}

/// Turns over the triangles facing into the solid where a flip of the edge
/// they share with a neighbour leaves both facing out: the strip stitched to
/// a ring folds where the ring and the new surface's border run unevenly
/// beside each other, and a flip undoes the fold. Locked edges never flip.
pub fn untangle(triangles: &mut [[usize; 3]], vertices: &[Vec3], locked: &HashSet<(usize, usize)>, facing: &dyn Fn(Vec3) -> Vec3) {
    let mut out: Vec<bool> = triangles.iter().map(|&t| faces_out(vertices, t, facing)).collect();
    untangle_known(triangles, vertices, locked, facing, &mut out);
}

/// [`untangle`] with which way each triangle faces already known -- asking
/// the solid is the dear part, so only the sides of triangles facing in are
/// tried, and only the triangles a flip makes are asked again.
fn untangle_known(triangles: &mut [[usize; 3]], vertices: &[Vec3], locked: &HashSet<(usize, usize)>, facing: &dyn Fn(Vec3) -> Vec3, out: &mut [bool]) {
    for _ in 0..4 {
        if out.iter().all(|&o| o) {
            return;
        }
        let mut by_edge: HashMap<(usize, usize), usize> = HashMap::with_capacity(triangles.len() * 3);
        for (t, &[a, b, c]) in triangles.iter().enumerate() {
            for edge in [(a, b), (b, c), (c, a)] {
                by_edge.insert(edge, t);
            }
        }
        let mut candidates: Vec<(usize, usize)> = triangles
            .iter()
            .enumerate()
            .filter(|&(t, _)| !out[t])
            .flat_map(|(_, &[a, b, c])| [(a, b), (b, c), (c, a)])
            .map(|(a, b)| (a.min(b), a.max(b)))
            .collect();
        candidates.sort_unstable();
        candidates.dedup();
        let mut touched: HashSet<usize> = HashSet::new();
        let mut flipped = 0;
        for (a, b) in candidates {
            if locked.contains(&(a, b)) {
                continue;
            }
            let (Some(&one), Some(&two)) = (by_edge.get(&(a, b)), by_edge.get(&(b, a))) else { continue };
            if touched.contains(&one) || touched.contains(&two) || (out[one] && out[two]) {
                continue;
            }
            // A triangle with no corner off the edge is degenerate: nothing to flip.
            let (Some(c), Some(d)) = (
                triangles[one].iter().copied().find(|&v| v != a && v != b),
                triangles[two].iter().copied().find(|&v| v != a && v != b),
            ) else {
                continue;
            };
            if c == d || by_edge.contains_key(&(c, d)) || by_edge.contains_key(&(d, c)) {
                continue;
            }
            // `one` walks a -> b -> c, `two` walks b -> a -> d; flipped they walk c -> d.
            let (first, second) = ([c, a, d], [d, b, c]);
            if faces_out(vertices, first, facing) && faces_out(vertices, second, facing) {
                triangles[one] = first;
                triangles[two] = second;
                out[one] = true;
                out[two] = true;
                touched.insert(one);
                touched.insert(two);
                flipped += 1;
            }
        }
        if flipped == 0 {
            return;
        }
    }
}

/// Unfolds what flips alone cannot: every free corner of a triangle facing
/// into the solid moved to the middle of its neighbours and settled back on
/// the surface, flips tried again after each round, until none faces in or
/// the rounds run out. Each triangle is asked which way it faces once, then
/// again only when a corner of it moved.
pub fn unfold(
    vertices: &mut [Vec3],
    triangles: &mut [[usize; 3]],
    locked: &[bool],
    locked_edges: &HashSet<(usize, usize)>,
    facing: &dyn Fn(Vec3) -> Vec3,
    settle: &dyn Fn(Vec3) -> Vec3,
) {
    let mut out: Vec<bool> = triangles.iter().map(|&t| faces_out(vertices, t, facing)).collect();
    for _ in 0..UNFOLD_ROUNDS {
        untangle_known(triangles, vertices, locked_edges, facing, &mut out);
        let mut moving: Vec<usize> = (0..triangles.len()).filter(|&t| !out[t]).flat_map(|t| triangles[t]).filter(|&v| !locked[v]).collect();
        moving.sort_unstable();
        moving.dedup();
        if moving.is_empty() {
            return;
        }
        let mut is_moving = vec![false; vertices.len()];
        for &v in &moving {
            is_moving[v] = true;
        }
        let mut neighbours: HashMap<usize, Vec<usize>> = HashMap::with_capacity(moving.len());
        for &[a, b, c] in triangles.iter() {
            for (p, q) in [(a, b), (b, c), (c, a), (b, a), (c, b), (a, c)] {
                if is_moving[p] {
                    neighbours.entry(p).or_default().push(q);
                }
            }
        }
        // One corner after another, each to where its neighbours stand now --
        // those already moved this round included.
        for v in moving {
            let around = &neighbours[&v];
            let middle = around.iter().fold(Vec3::default(), |sum, &n| sum + vertices[n]) * (1.0 / around.len() as f64);
            vertices[v] = settle(middle);
        }
        for (t, &triangle) in triangles.iter().enumerate() {
            if triangle.iter().any(|&v| is_moving[v]) {
                out[t] = faces_out(vertices, triangle, facing);
            }
        }
    }
    untangle_known(triangles, vertices, locked_edges, facing, &mut out);
}

/// Rounds [`unfold`] takes at most.
const UNFOLD_ROUNDS: usize = 8;

/// A triangle mesh with locked vertices and edges, being remeshed.
pub struct Remesh<'a> {
    pub vertices: Vec<Vec3>,
    pub triangles: Vec<[usize; 3]>,
    pub locked: Vec<bool>,
    pub locked_edges: HashSet<(usize, usize)>,
    /// Puts a point back on the surface.
    pub settle: &'a dyn Fn(Vec3) -> Vec3,
}

impl Remesh<'_> {
    /// Evens the mesh out toward edges `length(at)` long round each point:
    /// finer where the surface turns tight, the ground's own size where it
    /// lies as it always did.
    pub fn run(&mut self, length: &dyn Fn(Vec3) -> f64, rounds: usize) {
        for _ in 0..rounds {
            self.split_long(length);
            self.collapse_short(length);
            self.flip_toward_valence();
            self.smooth(0.5);
            self.smooth(0.5);
        }
        self.drop_unused();
    }

    fn middle(&self, a: usize, b: usize) -> Vec3 {
        (self.vertices[a] + self.vertices[b]) * 0.5
    }

    fn normal(&self, [a, b, c]: [usize; 3]) -> Vec3 {
        (self.vertices[b] - self.vertices[a]).cross(self.vertices[c] - self.vertices[a])
    }

    fn edge_free(&self, a: usize, b: usize) -> bool {
        !self.locked_edges.contains(&key(a, b))
    }

    fn directed(&self) -> HashMap<(usize, usize), usize> {
        let mut map = HashMap::new();
        for (t, &[a, b, c]) in self.triangles.iter().enumerate() {
            for edge in [(a, b), (b, c), (c, a)] {
                map.insert(edge, t);
            }
        }
        map
    }

    fn split_long(&mut self, length: &dyn Fn(Vec3) -> f64) {
        for _ in 0..8 {
            let directed = self.directed();
            let mut edges: Vec<((usize, usize), f64)> = directed
                .keys()
                .filter(|&&(a, b)| a < b && self.edge_free(a, b))
                .map(|&(a, b)| ((a, b), self.vertices[a].distance(self.vertices[b]) / length(self.middle(a, b))))
                .filter(|&(_, l)| l > 4.0 / 3.0)
                .collect();
            if edges.is_empty() {
                return;
            }
            edges.sort_by(|x, y| y.1.total_cmp(&x.1).then(x.0.cmp(&y.0)));
            let mut touched: HashSet<usize> = HashSet::new();
            for ((a, b), _) in edges {
                let one = directed.get(&(a, b)).copied();
                let two = directed.get(&(b, a)).copied();
                if one.is_some_and(|t| touched.contains(&t)) || two.is_some_and(|t| touched.contains(&t)) {
                    continue;
                }
                let middle = (self.settle)((self.vertices[a] + self.vertices[b]) * 0.5);
                self.vertices.push(middle);
                self.locked.push(false);
                let m = self.vertices.len() - 1;
                for (t, from, to) in [(one, a, b), (two, b, a)].into_iter().filter_map(|(t, f, to)| t.map(|t| (t, f, to))) {
                    let tri = self.triangles[t];
                    let apex = tri.iter().copied().find(|&v| v != from && v != to).unwrap_or(from);
                    self.triangles[t] = [from, m, apex];
                    self.triangles.push([m, to, apex]);
                    touched.insert(t);
                    touched.insert(self.triangles.len() - 1);
                }
            }
        }
    }

    fn collapse_short(&mut self, length: &dyn Fn(Vec3) -> f64) {
        for _ in 0..8 {
            let mut changed = false;
            let directed = self.directed();
            let mut neighbours: Vec<HashSet<usize>> = vec![HashSet::new(); self.vertices.len()];
            for &[a, b, c] in &self.triangles {
                for (p, q) in [(a, b), (b, c), (c, a)] {
                    neighbours[p].insert(q);
                    neighbours[q].insert(p);
                }
            }
            let mut edges: Vec<(usize, usize)> = directed
                .keys()
                .filter(|&&(a, b)| a < b && self.edge_free(a, b))
                .filter(|&&(a, b)| self.vertices[a].distance(self.vertices[b]) < length(self.middle(a, b)) * 4.0 / 5.0)
                .copied()
                .collect();
            edges.sort_by(|x, y| self.vertices[x.0].distance(self.vertices[x.1]).total_cmp(&self.vertices[y.0].distance(self.vertices[y.1])).then(x.cmp(y)));
            // A corner of an open border -- the new ground's foot, a hole the
            // read left -- is never lost into the inside: collapsed, the border
            // would creep inward round after round and take the ground with it.
            let mut on_border = vec![false; self.vertices.len()];
            for &(p, q) in directed.keys() {
                if !directed.contains_key(&(q, p)) {
                    on_border[p] = true;
                    on_border[q] = true;
                }
            }
            let mut gone: HashSet<usize> = HashSet::new();
            let mut dirty: HashSet<usize> = HashSet::new();
            for (a, b) in edges {
                if gone.contains(&a) || gone.contains(&b) || dirty.contains(&a) || dirty.contains(&b) {
                    continue;
                }
                // Into whichever end is locked; never both.
                let (fixed_a, fixed_b) = (self.locked[a] || on_border[a], self.locked[b] || on_border[b]);
                let (keep, lose) = match (fixed_a, fixed_b) {
                    (true, true) => continue,
                    (true, false) => (a, b),
                    (false, true) => (b, a),
                    (false, false) => (a, b),
                };
                let keep_fixed = fixed_a || fixed_b;
                // Interior only, and the link condition: exactly the two apexes shared.
                let (Some(&one), Some(&two)) = (directed.get(&(a, b)), directed.get(&(b, a))) else { continue };
                let shared = neighbours[a].intersection(&neighbours[b]).count();
                if shared != 2 {
                    continue;
                }
                // Nor one made by the collapse: the kept end meeting another
                // locked vertex it was not already joined to.
                if self.locked[keep] && neighbours[lose].iter().any(|&n| n != keep && self.locked[n] && !neighbours[keep].contains(&n)) {
                    continue;
                }
                let target = if keep_fixed { self.vertices[keep] } else { (self.settle)((self.vertices[a] + self.vertices[b]) * 0.5) };
                if neighbours[lose].iter().any(|&n| n != keep && target.distance(self.vertices[n]) > length((target + self.vertices[n]) * 0.5) * 4.0 / 3.0) {
                    continue;
                }
                // No triangle round the lost end may turn over.
                let around: Vec<usize> = (0..self.triangles.len()).filter(|&t| t != one && t != two && self.triangles[t].contains(&lose)).collect();
                let turns = around.iter().any(|&t| {
                    let before = self.normal(self.triangles[t]);
                    let moved = self.triangles[t].map(|v| if v == lose { usize::MAX } else { v });
                    let positions = moved.map(|v| if v == usize::MAX { target } else { self.vertices[v] });
                    let after = (positions[1] - positions[0]).cross(positions[2] - positions[0]);
                    after.dot(before) <= 0.2 * before.length() * after.length()
                });
                if turns {
                    continue;
                }
                self.vertices[keep] = target;
                for &t in &around {
                    self.triangles[t] = self.triangles[t].map(|v| if v == lose { keep } else { v });
                }
                self.triangles[one] = [usize::MAX; 3];
                self.triangles[two] = [usize::MAX; 3];
                gone.insert(lose);
                dirty.insert(keep);
                for &n in &neighbours[lose] {
                    dirty.insert(n);
                }
                changed = true;
            }
            self.triangles.retain(|t| t[0] != usize::MAX);
            if !changed {
                return;
            }
        }
    }

    fn flip_toward_valence(&mut self) {
        let directed = self.directed();
        let mut valence = vec![0i32; self.vertices.len()];
        let mut edges: HashSet<(usize, usize)> = HashSet::new();
        for &[a, b, c] in &self.triangles {
            for (p, q) in [(a, b), (b, c), (c, a)] {
                edges.insert(key(p, q));
            }
        }
        for &(a, b) in &edges {
            valence[a] += 1;
            valence[b] += 1;
        }
        let target = |v: usize, locked: &[bool]| if locked[v] { 4 } else { 6 };
        let mut touched: HashSet<usize> = HashSet::new();
        let mut candidates: Vec<(usize, usize)> = edges.iter().copied().filter(|&(a, b)| self.edge_free(a, b)).collect();
        candidates.sort_unstable();
        for (a, b) in candidates {
            let (Some(&one), Some(&two)) = (directed.get(&(a, b)), directed.get(&(b, a))) else { continue };
            if touched.contains(&one) || touched.contains(&two) {
                continue;
            }
            let (Some(c), Some(d)) = (
                self.triangles[one].iter().copied().find(|&v| v != a && v != b),
                self.triangles[two].iter().copied().find(|&v| v != a && v != b),
            ) else {
                continue;
            };
            // Never a new edge between two locked vertices: the ground beyond
            // may already hold one there, and a third face on it tears it.
            if c == d || edges.contains(&key(c, d)) || (self.locked[c] && self.locked[d]) {
                continue;
            }
            let deviation = |va: i32, vb: i32, vc: i32, vd: i32| {
                (va - target(a, &self.locked)).abs() + (vb - target(b, &self.locked)).abs() + (vc - target(c, &self.locked)).abs() + (vd - target(d, &self.locked)).abs()
            };
            let before = deviation(valence[a], valence[b], valence[c], valence[d]);
            let after = deviation(valence[a] - 1, valence[b] - 1, valence[c] + 1, valence[d] + 1);
            if after >= before {
                continue;
            }
            let new_one = [a, d, c];
            let new_two = [d, b, c];
            let old = self.normal(self.triangles[one]) + self.normal(self.triangles[two]);
            let (n1, n2) = (self.normal(new_one), self.normal(new_two));
            if n1.dot(old) <= 0.3 * n1.length() * old.length() || n2.dot(old) <= 0.3 * n2.length() * old.length() {
                continue;
            }
            self.triangles[one] = new_one;
            self.triangles[two] = new_two;
            valence[a] -= 1;
            valence[b] -= 1;
            valence[c] += 1;
            valence[d] += 1;
            edges.remove(&key(a, b));
            edges.insert(key(c, d));
            touched.insert(one);
            touched.insert(two);
        }
    }

    fn smooth(&mut self, strength: f64) {
        let mut neighbours: Vec<HashSet<usize>> = vec![HashSet::new(); self.vertices.len()];
        let mut normals = vec![Vec3::default(); self.vertices.len()];
        for &t in &self.triangles {
            let n = self.normal(t);
            for i in 0..3 {
                neighbours[t[i]].insert(t[(i + 1) % 3]);
                neighbours[t[i]].insert(t[(i + 2) % 3]);
                normals[t[i]] = normals[t[i]] + n;
            }
        }
        // A corner of an open border is drawn only by its neighbours along
        // the border: drawn by the inside too, the border shrinks inward.
        let directed = self.directed();
        let mut along_border: Vec<HashSet<usize>> = vec![HashSet::new(); self.vertices.len()];
        for &(p, q) in directed.keys() {
            if !directed.contains_key(&(q, p)) {
                along_border[p].insert(q);
                along_border[q].insert(p);
            }
        }
        for v in 0..self.vertices.len() {
            if !along_border[v].is_empty() {
                neighbours[v] = std::mem::take(&mut along_border[v]);
            }
        }
        let before = self.vertices.clone();
        for v in 0..self.vertices.len() {
            if self.locked[v] || neighbours[v].is_empty() {
                continue;
            }
            let mut around: Vec<usize> = neighbours[v].iter().copied().collect();
            around.sort_unstable();
            let centre = around.iter().fold(Vec3::default(), |sum, &n| sum + before[n]) * (1.0 / around.len() as f64);
            let n = normals[v].normalized();
            let along = centre - before[v];
            let tangent = along - n * along.dot(n);
            self.vertices[v] = (self.settle)(before[v] + tangent * strength);
        }
    }

    /// Renumbers away vertices no triangle uses any more. Locked vertices come
    /// first and are always used, so they keep their indices.
    fn drop_unused(&mut self) {
        let mut used = vec![false; self.vertices.len()];
        for t in &self.triangles {
            for &v in t {
                used[v] = true;
            }
        }
        let mut remap = vec![usize::MAX; self.vertices.len()];
        let mut vertices = Vec::new();
        let mut locked = Vec::new();
        for v in 0..self.vertices.len() {
            if used[v] {
                remap[v] = vertices.len();
                vertices.push(self.vertices[v]);
                locked.push(self.locked[v]);
            }
        }
        self.triangles = self.triangles.iter().map(|t| t.map(|v| remap[v])).collect();
        self.locked_edges = self.locked_edges.iter().filter(|&&(a, b)| used[a] && used[b]).map(|&(a, b)| key(remap[a], remap[b])).collect();
        self.vertices = vertices;
        self.locked = locked;
    }
}
