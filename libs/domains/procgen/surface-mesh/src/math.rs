//! Geometric and vector math functions for surface triangulation.

pub fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// Flat face normal for shading: the first non-degenerate cross product
/// among triples anchored at `positions[0]`. `project3d_to_2d` already
/// proved the ring is not globally degenerate before this runs, so this is
/// just picking a representative triple, not re-deriving planarity.
pub fn face_normal(positions: &[[f32; 3]]) -> Option<[f32; 3]> {
    let origin = positions[0];
    for window in positions[1..].windows(2) {
        let cross_prod = cross(sub(window[0], origin), sub(window[1], origin));
        let length = (cross_prod[0] * cross_prod[0]
            + cross_prod[1] * cross_prod[1]
            + cross_prod[2] * cross_prod[2])
            .sqrt();
        if length > f32::EPSILON {
            return Some([
                cross_prod[0] / length,
                cross_prod[1] / length,
                cross_prod[2] / length,
            ]);
        }
    }
    None
}

/// The normal of the first triangle with real area -- what the winding says
/// the face is facing.
pub fn winding_normal(positions: &[[f32; 3]], indices: &[u32]) -> Option<[f32; 3]> {
    for triangle in indices.chunks_exact(3) {
        let [a, b, c] = [
            positions[triangle[0] as usize],
            positions[triangle[1] as usize],
            positions[triangle[2] as usize],
        ];
        let normal = cross(sub(b, a), sub(c, a));
        let length = (normal[0].powi(2) + normal[1].powi(2) + normal[2].powi(2)).sqrt();
        if length > f32::EPSILON {
            return Some([normal[0] / length, normal[1] / length, normal[2] / length]);
        }
    }
    None
}

pub fn distance_xz(a: [f32; 2], b: [f32; 2]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

pub fn angle_xz(center: [f32; 2], point: [f32; 2]) -> f32 {
    (point[1] - center[1]).atan2(point[0] - center[0])
}

/// Sweep from `from` to `to` in the given direction, always non-negative.
pub fn sweep(from: f32, to: f32, clockwise: bool) -> f32 {
    let raw = if clockwise { from - to } else { to - from };
    let full = std::f32::consts::TAU;
    let wrapped = raw % full;
    if wrapped < 0.0 {
        wrapped + full
    } else {
        wrapped
    }
}

pub fn point_in_loop_xz(point: [f32; 2], loop_: &[[f32; 3]]) -> bool {
    let mut inside = false;
    for (current, next) in loop_
        .iter()
        .zip(loop_.iter().cycle().skip(1))
        .take(loop_.len())
    {
        let current_z = current[2];
        let next_z = next[2];
        if (current_z > point[1]) == (next_z > point[1]) {
            continue;
        }
        let intersection_x =
            (next[0] - current[0]) * (point[1] - current_z) / (next_z - current_z) + current[0];
        if point[0] < intersection_x {
            inside = !inside;
        }
    }
    inside
}
