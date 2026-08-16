//! Shared 2D (XZ-plane) point-in-polygon geometry, used wherever "does this
//! candidate belong to this room's own boundary" must be a true
//! point-in-polygon test rather than a bounding-box one -- a bounding box
//! drawn around a concave or curved room is strictly bigger than the room
//! itself, and can wrongly claim a different, nearby room's own geometry.
//! Extracted from `room_removal`'s own original implementation once
//! `wall_path` needed the identical test to scope a closed loop's own
//! prior geometry for diffing.

/// True if `point` lies on (within `EPS`) one of `polygon`'s own edges, or
/// strictly inside it (standard ray-casting, which handles a concave --
/// non-convex -- simple polygon correctly). The on-edge check is checked
/// first and separately because ray-casting alone is unreliable exactly
/// on a boundary.
pub(crate) fn point_in_or_on_polygon(point: (f32, f32), polygon: &[(f32, f32)]) -> bool {
    const EPS: f32 = 1e-3;
    let n = polygon.len();
    if n < 3 {
        return false;
    }
    for i in 0..n {
        if on_segment(point, polygon[i], polygon[(i + 1) % n], EPS) {
            return true;
        }
    }
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, zi) = polygon[i];
        let (xj, zj) = polygon[j];
        if (zi > point.1) != (zj > point.1) {
            let x_intersect = xi + (point.1 - zi) * (xj - xi) / (zj - zi);
            if point.0 < x_intersect {
                inside = !inside;
            }
        }
        j = i;
    }
    inside
}

fn on_segment(point: (f32, f32), a: (f32, f32), b: (f32, f32), eps: f32) -> bool {
    let cross = (point.0 - a.0) * (b.1 - a.1) - (point.1 - a.1) * (b.0 - a.0);
    if cross.abs() > eps {
        return false;
    }
    let dot = (point.0 - a.0) * (b.0 - a.0) + (point.1 - a.1) * (b.1 - a.1);
    let len_sq = (b.0 - a.0).powi(2) + (b.1 - a.1).powi(2);
    dot >= -eps && dot <= len_sq + eps
}
