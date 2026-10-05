//! The borders between pieces, laid once and shared by both sides.
//!
//! Two pieces meeting along a border have to meet on the same points, or the
//! surface cracks there. So a border is not each piece's own outline: it is
//! one chain of points, smoothed off the split's staircase, resampled at the
//! face size and settled onto the surface, which both pieces then take as a
//! contour -- the same contract a road's outline already has with the ground
//! laid against it.
//!
//! A border runs between junctions, where three pieces meet or a piece meets
//! the edge of the region. Junctions stay where the split put them, so every
//! border that ends there ends on the same point.

use std::collections::{HashMap, HashSet};

use crate::field::{HeightSource, SolidField};
use crate::pieces::Split;
use crate::vector::Vec3;

/// No piece: the edge of the region.
const OUTSIDE: usize = usize::MAX;

#[derive(Debug, Clone)]
pub struct Seams {
    /// Every border point, shared by every piece it borders.
    pub points: Vec<Vec3>,
    /// Per piece, its closed rings as indices into [`Self::points`], each
    /// walked with the piece on its left seen from outside the solid.
    pub rings: Vec<Vec<Vec<usize>>>,
}

#[derive(Debug, Clone, Copy)]
struct Run {
    /// Index into the runs' laid points.
    laid: usize,
}

/// Lays every border in `split` at `spacing`.
pub fn seams<H: HeightSource>(field: &SolidField<H>, split: &Split, spacing: f64, step: f64) -> Seams {
    // Directed border edges: a triangle side whose twin is in another piece,
    // or that has no twin at all.
    let mut owner: HashMap<(usize, usize), usize> = HashMap::new();
    for (triangle, &[a, b, c]) in split.triangles.iter().enumerate() {
        for edge in [(a, b), (b, c), (c, a)] {
            owner.insert(edge, triangle);
        }
    }
    let piece_across = |from: usize, to: usize| owner.get(&(to, from)).map_or(OUTSIDE, |&t| split.piece_of[t]);
    let mut border: Vec<(usize, usize, usize, usize)> = Vec::new(); // from, to, piece, across
    for (triangle, &[a, b, c]) in split.triangles.iter().enumerate() {
        let piece = split.piece_of[triangle];
        for (from, to) in [(a, b), (b, c), (c, a)] {
            let across = piece_across(from, to);
            if across != piece {
                border.push((from, to, piece, across));
            }
        }
    }

    // Undirected border edges, each labelled by the pair of pieces it parts.
    let pair = |p: usize, q: usize| (p.min(q), p.max(q));
    let mut label: HashMap<(usize, usize), (usize, usize)> = HashMap::new();
    let mut incident: HashMap<usize, Vec<usize>> = HashMap::new();
    for &(from, to, piece, across) in &border {
        let key = (from.min(to), from.max(to));
        if label.insert(key, pair(piece, across)).is_none() {
            incident.entry(from).or_default().push(to);
            incident.entry(to).or_default().push(from);
        }
    }
    let is_junction = |vertex: usize| {
        let around = &incident[&vertex];
        around.len() != 2 || {
            let first = label[&(vertex.min(around[0]), vertex.max(around[0]))];
            let second = label[&(vertex.min(around[1]), vertex.max(around[1]))];
            first != second
        }
    };

    // Walk runs junction to junction; whatever is left is closed loops with
    // no junction on them, each started anywhere.
    let mut point_of_vertex: HashMap<usize, usize> = HashMap::new();
    let mut points: Vec<Vec3> = Vec::new();
    let mut run_of_edge: HashMap<(usize, usize), (Run, bool)> = HashMap::new();
    let mut laid_runs: Vec<Vec<usize>> = Vec::new();
    let mut walked: HashSet<(usize, usize)> = HashSet::new();
    let mut starts: Vec<usize> = incident.keys().copied().filter(|&v| is_junction(v)).collect();
    starts.sort_unstable();
    let mut pseudo: HashSet<usize> = HashSet::new();
    let mut remaining: Vec<usize> = incident.keys().copied().collect();
    remaining.sort_unstable();

    let walk_from = |start: usize,
                         pseudo: &HashSet<usize>,
                         walked: &mut HashSet<(usize, usize)>,
                         point_of_vertex: &mut HashMap<usize, usize>,
                         points: &mut Vec<Vec3>,
                         run_of_edge: &mut HashMap<(usize, usize), (Run, bool)>,
                         laid_runs: &mut Vec<Vec<usize>>| {
        for &next in &incident[&start] {
            if walked.contains(&(start.min(next), start.max(next))) {
                continue;
            }
            let mut chain = vec![start, next];
            walked.insert((start.min(next), start.max(next)));
            while !(is_junction(*chain.last().unwrap()) || pseudo.contains(chain.last().unwrap())) {
                let here = *chain.last().unwrap();
                let behind = chain[chain.len() - 2];
                let Some(&onward) = incident[&here].iter().find(|&&v| v != behind && !walked.contains(&(here.min(v), here.max(v)))) else {
                    break;
                };
                walked.insert((here.min(onward), here.max(onward)));
                chain.push(onward);
            }
            let laid = lay_run(field, split, &chain, spacing, step, point_of_vertex, points);
            let run = Run { laid: laid_runs.len() };
            for pair in chain.windows(2) {
                run_of_edge.insert((pair[0], pair[1]), (run, true));
                run_of_edge.insert((pair[1], pair[0]), (run, false));
            }
            laid_runs.push(laid);
        }
    };

    for &start in &starts {
        walk_from(start, &pseudo, &mut walked, &mut point_of_vertex, &mut points, &mut run_of_edge, &mut laid_runs);
    }
    for &vertex in &remaining {
        let unwalked = incident[&vertex].iter().any(|&v| !walked.contains(&(vertex.min(v), vertex.max(v))));
        if unwalked {
            pseudo.insert(vertex);
            walk_from(vertex, &pseudo, &mut walked, &mut point_of_vertex, &mut points, &mut run_of_edge, &mut laid_runs);
        }
    }

    // Each piece's rings: walk its directed border edges into closed coarse
    // loops, start each at the end of a run, and take every run's laid
    // points once, in the direction walked.
    let ends: HashSet<usize> = starts.iter().chain(pseudo.iter()).copied().collect();
    let mut rings: Vec<Vec<Vec<usize>>> = vec![Vec::new(); split.pieces.len()];
    let mut next_of: Vec<HashMap<usize, Vec<usize>>> = vec![HashMap::new(); split.pieces.len()];
    for &(from, to, piece, _) in &border {
        next_of[piece].entry(from).or_default().push(to);
    }
    for (piece, next) in next_of.iter_mut().enumerate() {
        let mut keys: Vec<usize> = next.keys().copied().collect();
        keys.sort_unstable();
        for start in keys {
            while let Some(first) = next.get_mut(&start).and_then(|targets| targets.pop()) {
                let mut coarse = vec![start, first];
                while *coarse.last().unwrap() != start {
                    let Some(onward) = next.get_mut(coarse.last().unwrap()).and_then(|targets| targets.pop()) else {
                        break;
                    };
                    coarse.push(onward);
                }
                if *coarse.last().unwrap() != start {
                    continue;
                }
                coarse.pop();
                let Some(offset) = coarse.iter().position(|v| ends.contains(v)) else {
                    continue;
                };
                coarse.rotate_left(offset);
                let mut ring: Vec<usize> = Vec::new();
                let mut previous: Option<usize> = None;
                for i in 0..coarse.len() {
                    let (from, to) = (coarse[i], coarse[(i + 1) % coarse.len()]);
                    let (run, forward) = run_of_edge[&(from, to)];
                    if previous == Some(run.laid) && !ends.contains(&from) {
                        continue;
                    }
                    previous = Some(run.laid);
                    let laid = &laid_runs[run.laid];
                    if forward {
                        ring.extend_from_slice(&laid[..laid.len() - 1]);
                    } else {
                        ring.extend(laid.iter().rev().take(laid.len() - 1));
                    }
                }
                if ring.len() >= 3 {
                    rings[piece].push(ring);
                }
            }
        }
    }

    Seams { points, rings }
}

/// One run, smoothed off the staircase, resampled at `spacing` and settled
/// onto the surface. Its two ends are the junction points every run ending
/// there shares.
fn lay_run<H: HeightSource>(
    field: &SolidField<H>,
    split: &Split,
    chain: &[usize],
    spacing: f64,
    step: f64,
    point_of_vertex: &mut HashMap<usize, usize>,
    points: &mut Vec<Vec3>,
) -> Vec<usize> {
    let mut path: Vec<Vec3> = chain.iter().map(|&v| split.positions[v]).collect();
    let closed = chain.first() == chain.last();
    for _ in 0..12 {
        let before = path.clone();
        for i in 1..path.len() - 1 {
            path[i] = (before[i - 1] + before[i] * 2.0 + before[i + 1]) * 0.25;
        }
        if closed && path.len() > 3 {
            let n = path.len() - 1;
            path[0] = (before[n - 1] + before[0] * 2.0 + before[1]) * 0.25;
            path[n] = path[0];
        }
    }

    let mut lengths = vec![0.0];
    for pair in path.windows(2) {
        lengths.push(lengths.last().unwrap() + pair[0].distance(pair[1]));
    }
    let total = *lengths.last().unwrap();
    // Never longer than `spacing`: a border segment the grid finds too long
    // it cuts, and the corner it puts there is one the piece across lacks.
    let segments = ((total / spacing).ceil() as usize).max(1);

    let mut end_point = |vertex: usize, position: Vec3, points: &mut Vec<Vec3>| {
        *point_of_vertex.entry(vertex).or_insert_with(|| {
            points.push(field.project(position, step));
            points.len() - 1
        })
    };
    let first = end_point(chain[0], path[0], points);
    let mut laid = vec![first];
    let mut cursor = 0;
    for s in 1..segments {
        let target = total * s as f64 / segments as f64;
        while lengths[cursor + 1] < target {
            cursor += 1;
        }
        let t = (target - lengths[cursor]) / (lengths[cursor + 1] - lengths[cursor]).max(1e-12);
        points.push(field.project(path[cursor].lerp(path[cursor + 1], t), step));
        laid.push(points.len() - 1);
    }
    let last = if closed { first } else { end_point(*chain.last().unwrap(), *path.last().unwrap(), points) };
    laid.push(last);
    laid
}
