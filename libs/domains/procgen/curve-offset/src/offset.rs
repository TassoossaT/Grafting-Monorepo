//! Offsets a flattened polyline into a set of banded ribbon polygons.

use crate::types::{Point, Polygon, Polyline};

fn edge_normal(from: Point, to: Point) -> Point {
    let d = [to[0] - from[0], to[1] - from[1]];
    let len = (d[0] * d[0] + d[1] * d[1]).sqrt().max(1e-9);
    [-d[1] / len, d[0] / len]
}

/// The offset direction and mitre scale at every point of `points` -- the
/// same "how far outward does one station's own frame reach" question
/// `apps/vtt`'s `sweep-formation.ts` (`stationFrame`) answers in TS, here as
/// the Rust-side equivalent. An interior corner's mitre length is clamped to
/// `miter_limit` rather than left to grow without bound as the corner
/// sharpens, exactly as a station frame does today.
fn station_frames(points: &[Point], miter_limit: f32) -> Vec<(Point, f32)> {
    let last = points.len() - 1;
    (0..points.len())
        .map(|index| {
            if index == 0 {
                (edge_normal(points[0], points[1]), 1.0)
            } else if index == last {
                (edge_normal(points[last - 1], points[last]), 1.0)
            } else {
                let incoming = edge_normal(points[index - 1], points[index]);
                let outgoing = edge_normal(points[index], points[index + 1]);
                let sum = [incoming[0] + outgoing[0], incoming[1] + outgoing[1]];
                let sum_len = (sum[0] * sum[0] + sum[1] * sum[1]).sqrt();
                if sum_len < 1e-6 {
                    // A reversal (the run doubles back on itself) has no
                    // meaningful mitre direction; fall back to the outgoing
                    // edge's own normal rather than divide by zero.
                    (outgoing, 1.0)
                } else {
                    let mitre = [sum[0] / sum_len, sum[1] / sum_len];
                    let cos_half = (mitre[0] * incoming[0] + mitre[1] * incoming[1]).max(1e-6);
                    (mitre, (1.0 / cos_half).min(miter_limit))
                }
            }
        })
        .collect()
}

/// One offset copy of `points`, pushed outward by `offset` along each
/// point's own mitred frame.
fn offset_curve(points: &[Point], frames: &[(Point, f32)], offset: f32) -> Vec<Point> {
    points
        .iter()
        .zip(frames)
        .map(|(point, (normal, scale))| {
            [point[0] + normal[0] * scale * offset, point[1] + normal[1] * scale * offset]
        })
        .collect()
}

/// One ribbon polygon per consecutive pair of `band_offsets` -- the band
/// between offset `k` and offset `k + 1`, following `polyline`'s own shape.
/// `band_offsets` need not be sorted by sign, only ordered the way the
/// caller wants its bands to read (mirrors a cross-section profile's list of
/// lateral offsets, left-to-right across the run).
///
/// Returns no bands for a polyline with fewer than two points or a profile
/// with fewer than two offsets -- there is no span to sweep along, or no gap
/// between offsets to call a band.
pub fn offset_bands(polyline: &Polyline, band_offsets: &[f32], miter_limit: f32) -> Vec<Polygon> {
    let points = &polyline.points;
    if points.len() < 2 || band_offsets.len() < 2 {
        return Vec::new();
    }
    let frames = station_frames(points, miter_limit.max(1.0));
    let curves: Vec<Vec<Point>> =
        band_offsets.iter().map(|&offset| offset_curve(points, &frames, offset)).collect();
    curves
        .windows(2)
        .map(|pair| {
            let mut outer = pair[0].clone();
            outer.extend(pair[1].iter().rev().copied());
            Polygon { outer, holes: Vec::new() }
        })
        .collect()
}
