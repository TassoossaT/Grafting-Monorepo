use grafting_graph_core::NodeId;

const EPSILON: f32 = 0.000_01;

#[derive(Debug, Clone)]
pub(crate) struct ClipVertex {
    pub(crate) id: Option<NodeId>,
    pub(crate) position: [f32; 3],
}

pub(crate) fn partition_by_footprint(
    polygon: Vec<ClipVertex>,
    footprint: &[[f32; 2]],
) -> (Vec<Vec<ClipVertex>>, Option<Vec<ClipVertex>>) {
    let mut candidate = clean_polygon(polygon);
    let mut outside = Vec::new();

    for index in 0..footprint.len() {
        if candidate.len() < 3 {
            return (outside, None);
        }
        let start = footprint[index];
        let end = footprint[(index + 1) % footprint.len()];
        let (inside, rejected) = split_half_plane(candidate, start, end);
        if let Some(rejected) = valid_polygon(rejected) {
            outside.push(rejected);
        }
        candidate = inside;
    }

    (outside, valid_polygon(candidate))
}

#[cfg(test)]
fn partition_by_circle(
    polygon: Vec<ClipVertex>,
    center: [f32; 2],
    radius: f32,
    segments: usize,
) -> (Vec<Vec<ClipVertex>>, Option<Vec<ClipVertex>>) {
    let footprint = (0..segments)
        .map(|index| {
            let angle = std::f32::consts::TAU * index as f32 / segments as f32;
            [
                center[0] + radius * angle.cos(),
                center[1] + radius * angle.sin(),
            ]
        })
        .collect::<Vec<_>>();
    partition_by_footprint(polygon, &footprint)
}
fn split_half_plane(
    polygon: Vec<ClipVertex>,
    line_start: [f32; 2],
    line_end: [f32; 2],
) -> (Vec<ClipVertex>, Vec<ClipVertex>) {
    let mut inside = Vec::new();
    let mut outside = Vec::new();
    if polygon.is_empty() {
        return (inside, outside);
    }

    for index in 0..polygon.len() {
        let current = &polygon[index];
        let next = &polygon[(index + 1) % polygon.len()];
        let current_side = line_side(line_start, line_end, current.position);
        let next_side = line_side(line_start, line_end, next.position);
        let current_inside = current_side >= -EPSILON;
        let next_inside = next_side >= -EPSILON;

        if current_inside {
            push_distinct(&mut inside, current.clone());
        } else {
            push_distinct(&mut outside, current.clone());
        }

        if current_inside != next_inside {
            let denominator = current_side - next_side;
            if denominator.abs() > EPSILON {
                let t = (current_side / denominator).clamp(0.0, 1.0);
                let intersection = interpolate(current, next, t);
                push_distinct(&mut inside, intersection.clone());
                push_distinct(&mut outside, intersection);
            }
        }
    }

    (clean_polygon(inside), clean_polygon(outside))
}

fn line_side(start: [f32; 2], end: [f32; 2], point: [f32; 3]) -> f32 {
    (end[0] - start[0]) * (point[2] - start[1]) - (end[1] - start[1]) * (point[0] - start[0])
}

fn interpolate(start: &ClipVertex, end: &ClipVertex, t: f32) -> ClipVertex {
    if t <= EPSILON {
        return start.clone();
    }
    if t >= 1.0 - EPSILON {
        return end.clone();
    }
    ClipVertex {
        id: None,
        position: [
            start.position[0] + (end.position[0] - start.position[0]) * t,
            start.position[1] + (end.position[1] - start.position[1]) * t,
            start.position[2] + (end.position[2] - start.position[2]) * t,
        ],
    }
}

fn valid_polygon(polygon: Vec<ClipVertex>) -> Option<Vec<ClipVertex>> {
    let polygon = clean_polygon(polygon);
    (polygon.len() >= 3 && polygon_area_xz(&polygon).abs() > EPSILON).then_some(polygon)
}

fn clean_polygon(mut polygon: Vec<ClipVertex>) -> Vec<ClipVertex> {
    let mut cleaned = Vec::with_capacity(polygon.len());
    for vertex in polygon.drain(..) {
        push_distinct(&mut cleaned, vertex);
    }
    if cleaned.len() > 1
        && same_position(&cleaned[0].position, &cleaned[cleaned.len() - 1].position)
    {
        cleaned.pop();
    }
    cleaned
}

fn push_distinct(vertices: &mut Vec<ClipVertex>, vertex: ClipVertex) {
    if vertices
        .last()
        .is_none_or(|last| !same_position(&last.position, &vertex.position))
    {
        vertices.push(vertex);
    }
}

fn same_position(left: &[f32; 3], right: &[f32; 3]) -> bool {
    (left[0] - right[0]).abs() <= EPSILON
        && (left[1] - right[1]).abs() <= EPSILON
        && (left[2] - right[2]).abs() <= EPSILON
}

fn polygon_area_xz(polygon: &[ClipVertex]) -> f32 {
    polygon
        .iter()
        .zip(polygon.iter().cycle().skip(1))
        .take(polygon.len())
        .map(|(a, b)| a.position[0] * b.position[2] - b.position[0] * a.position[2])
        .sum::<f32>()
        * 0.5
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vertex(x: f32, z: f32) -> ClipVertex {
        ClipVertex {
            id: None,
            position: [x, 0.0, z],
        }
    }

    #[test]
    fn partitions_a_triangle_without_losing_area() {
        let triangle = vec![vertex(-2.0, -1.0), vertex(2.0, -1.0), vertex(0.0, 2.0)];
        let original_area = polygon_area_xz(&triangle).abs();
        let (outside, inside) = partition_by_circle(triangle, [0.0, 0.0], 0.75, 12);
        let inside = inside.expect("circle intersects triangle");
        let partitioned_area = outside
            .iter()
            .map(|polygon| polygon_area_xz(polygon).abs())
            .sum::<f32>()
            + polygon_area_xz(&inside).abs();
        assert!((partitioned_area - original_area).abs() < 0.001);
        assert!(outside.len() > 1);
    }
}
