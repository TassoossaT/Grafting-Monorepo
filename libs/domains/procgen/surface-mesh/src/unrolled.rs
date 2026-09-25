//! Meshing in an upright face's unrolled flat: rings of `(travel, height)`
//! triangulated there and rolled back onto the face.

use earcut::Earcut;
use grafting_graph_core::PlanarShape;
use i_triangle::float::uniform::UniformTriangulatable;

use crate::frame::UnrollFrame;
use crate::math::{dot, winding_normal};
use crate::types::TriangulatedMesh;

/// The signed area of a flat ring -- positive when it winds counter-clockwise.
pub(crate) fn signed_area(ring: &[[f32; 2]]) -> f32 {
    ring.iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
        .map(|(current, next)| current[0] * next[1] - next[0] * current[1])
        .sum::<f32>()
        / 2.0
}

/// The ring wound the way the triangulator's non-zero fill rule reads it:
/// counter-clockwise for an outline, clockwise for a hole inside it.
pub(crate) fn wound(mut ring: Vec<[f32; 2]>, counter_clockwise: bool) -> Vec<[f32; 2]> {
    if (signed_area(&ring) > 0.0) != counter_clockwise {
        ring.reverse();
    }
    ring
}

/// The ring without repeated or closing duplicate points; `None` when it is
/// not finite or encloses nothing.
pub(crate) fn cleaned(ring: Vec<[f32; 2]>) -> Option<Vec<[f32; 2]>> {
    let mut out: Vec<[f32; 2]> = Vec::with_capacity(ring.len());
    for point in ring {
        if point.iter().any(|value| !value.is_finite()) {
            return None;
        }
        if out.last().is_none_or(|last| {
            (last[0] - point[0]).abs() > 1e-6 || (last[1] - point[1]).abs() > 1e-6
        }) {
            out.push(point);
        }
    }
    while out.len() > 1 && {
        let (first, last) = (out[0], out[out.len() - 1]);
        (first[0] - last[0]).abs() <= 1e-6 && (first[1] - last[1]).abs() <= 1e-6
    } {
        out.pop();
    }
    (out.len() >= 3 && signed_area(&out).abs() > f32::EPSILON).then_some(out)
}

/// An outline and its holes as one wound shape. `None` when the outline
/// encloses nothing; a hole that encloses nothing removes nothing and is
/// left out.
pub(crate) fn flat_shape(outer: Vec<[f32; 2]>, holes: Vec<Vec<[f32; 2]>>) -> Option<PlanarShape> {
    let mut shape = vec![wound(cleaned(outer)?, true)];
    shape.extend(
        holes
            .into_iter()
            .filter_map(cleaned)
            .map(|hole| wound(hole, false)),
    );
    Some(shape)
}

/// One flat shape triangulated, as `(points, indices)`: a uniform mesh at
/// the frame's lattice step where it curves, so every triangle stays a
/// local facet once rolled, and the outline's own vertices where it is flat.
fn triangulate_component(
    frame: &UnrollFrame,
    shape: &PlanarShape,
) -> Option<(Vec<[f32; 2]>, Vec<u32>)> {
    if let Some(edge_length) = frame.lattice_step() {
        let rings: Vec<Vec<[f32; 2]>> = shape
            .iter()
            .enumerate()
            .map(|(index, ring)| wound(ring.clone(), index == 0))
            .collect();
        let mesh = rings
            .uniform_triangulate(edge_length)
            .to_triangulation::<u32>();
        if !mesh.indices.is_empty() {
            return Some((mesh.points, mesh.indices));
        }
    }
    let mut points = Vec::new();
    let mut hole_indices = Vec::new();
    for (index, ring) in shape.iter().enumerate() {
        if index > 0 {
            hole_indices.push(points.len() as u32);
        }
        points.extend(ring.iter().copied());
    }
    let mut indices: Vec<u32> = Vec::new();
    Earcut::new().earcut(points.iter().copied(), &hole_indices, &mut indices);
    (!indices.is_empty()).then_some((points, indices))
}

/// Triangulates each shape in `frame`'s flat and rolls the result onto the
/// face, every triangle facing the frame's outward side. The flat points
/// are kept as the mesh's `uvs`.
pub(crate) fn rolled_mesh(frame: &UnrollFrame, shapes: &[PlanarShape]) -> TriangulatedMesh {
    let mut flat: Vec<[f32; 2]> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    for shape in shapes {
        let Some((points, component)) = triangulate_component(frame, shape) else {
            continue;
        };
        let offset = flat.len() as u32;
        for triangle in component.chunks_exact(3) {
            let [a, b, c] =
                [triangle[0], triangle[1], triangle[2]].map(|index| points[index as usize]);
            let ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0.0;
            let [i, j, k] = [triangle[0], triangle[1], triangle[2]].map(|index| index + offset);
            indices.extend_from_slice(&if ccw { [i, j, k] } else { [i, k, j] });
        }
        flat.extend(points);
    }

    let positions: Vec<[f32; 3]> = flat.iter().map(|point| frame.roll(*point)).collect();
    let normals: Vec<[f32; 3]> = positions
        .iter()
        .map(|point| frame.normal_at(*point))
        .collect();
    if !indices.is_empty()
        && let Some(reference) = winding_normal(&positions, &indices)
        && dot(reference, normals[indices[0] as usize]) < 0.0
    {
        for triangle in indices.chunks_exact_mut(3) {
            triangle.swap(1, 2);
        }
    }
    TriangulatedMesh {
        positions,
        normals,
        uvs: flat,
        indices,
    }
}
