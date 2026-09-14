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

/// Position on the cubic Bézier `p0 p1 p2 p3` at parameter `t` -- the same
/// closed-form cubic `grafting_graph_core::contour` uses, duplicated here
/// per this crate's own convention for small pure geometry math (see
/// `angle_xz`/`sweep` above) rather than exposed as new public API on that
/// crate's own analytic edge type.
pub fn cubic_bezier_eval(p0: [f32; 2], p1: [f32; 2], p2: [f32; 2], p3: [f32; 2], t: f32) -> [f32; 2] {
    let u = 1.0 - t;
    let a = u * u * u;
    let b = 3.0 * u * u * t;
    let c = 3.0 * u * t * t;
    let d = t * t * t;
    [
        a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
        a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ]
}

/// Unit tangent of the cubic Bézier `p0 p1 p2 p3` at parameter `t`.
pub fn cubic_bezier_tangent(p0: [f32; 2], p1: [f32; 2], p2: [f32; 2], p3: [f32; 2], t: f32) -> [f32; 2] {
    let u = 1.0 - t;
    let a = 3.0 * u * u;
    let b = 6.0 * u * t;
    let c = 3.0 * t * t;
    let dx = a * (p1[0] - p0[0]) + b * (p2[0] - p1[0]) + c * (p3[0] - p2[0]);
    let dz = a * (p1[1] - p0[1]) + b * (p2[1] - p1[1]) + c * (p3[1] - p2[1]);
    let len = (dx * dx + dz * dz).sqrt().max(f32::EPSILON);
    [dx / len, dz / len]
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
