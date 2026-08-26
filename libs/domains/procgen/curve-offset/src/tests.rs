use crate::{offset_bands, sample_catmull_rom, union_and_triangulate, Point, Polygon, Polyline, TriangulatedMesh};

fn distance(a: Point, b: Point) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

fn mesh_area(mesh: &TriangulatedMesh) -> f32 {
    mesh.indices
        .chunks(3)
        .map(|triangle| {
            let a = mesh.positions[triangle[0] as usize];
            let b = mesh.positions[triangle[1] as usize];
            let c = mesh.positions[triangle[2] as usize];
            0.5 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])).abs()
        })
        .sum()
}

/// A rectangle polygon spanning `[min_x, max_x] x [min_y, max_y]`.
fn rect(min_x: f32, max_x: f32, min_y: f32, max_y: f32) -> Polygon {
    Polygon {
        outer: vec![[min_x, min_y], [max_x, min_y], [max_x, max_y], [min_x, max_y]],
        holes: Vec::new(),
    }
}

#[test]
fn collinear_but_unevenly_spaced_control_points_still_flatten_straight() {
    // Centripetal parametrization moves at different "speeds" depending on
    // spacing, but collinear is collinear under any parametrization -- a
    // straight stretch subdivided for uneven spacing alone would be the
    // exact regression this guards.
    let control = vec![[0.0, 0.0], [1.0, 0.0], [10.0, 0.0]];
    let sampled = sample_catmull_rom(&control, 0.01);
    assert_eq!(sampled.points, control);
}

#[test]
fn a_long_straight_run_into_a_tight_corner_does_not_loop_or_overshoot() {
    // Exactly the shape a real spine produces: a long, sparse straight
    // stretch (A -> B, 50 apart) followed by a short, tight corner (B -> C,
    // about 2.8 apart, turning roughly 45 degrees) into a continuing leg
    // (C -> D). Uniform Catmull-Rom's tangent at B is shaped by the *long*
    // neighbouring span while the curve has to travel the *short* B->C span
    // in the same unit parameter interval -- that mismatch is exactly what
    // overshoots into a cusp or a loop right at the corner.
    let a = [0.0, 0.0];
    let b = [50.0, 0.0];
    let c = [52.0, 2.0];
    let d = [52.0, 10.0];
    let control = vec![a, b, c, d];

    let sampled = sample_catmull_rom(&control, 0.02);

    let min_x = control.iter().map(|p| p[0]).fold(f32::INFINITY, f32::min);
    let max_x = control.iter().map(|p| p[0]).fold(f32::NEG_INFINITY, f32::max);
    let min_y = control.iter().map(|p| p[1]).fold(f32::INFINITY, f32::min);
    let max_y = control.iter().map(|p| p[1]).fold(f32::NEG_INFINITY, f32::max);
    let margin = 3.0 * distance(b, c);

    for point in &sampled.points {
        assert!(
            point[0] >= min_x - margin && point[0] <= max_x + margin,
            "x overshoot: {point:?}"
        );
        assert!(
            point[1] >= min_y - margin && point[1] <= max_y + margin,
            "y overshoot: {point:?}"
        );
    }
    assert_eq!(sampled.points[0], a);
    assert_eq!(*sampled.points.last().unwrap(), d);
}

#[test]
fn collinear_control_points_flatten_to_a_straight_polyline() {
    let control = vec![[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [3.0, 0.0]];
    let sampled = sample_catmull_rom(&control, 0.01);
    // A straight run has zero sagitta everywhere, so nothing is subdivided
    // and the curve passes through exactly its own control points.
    assert_eq!(sampled.points, control);
}

#[test]
fn a_finer_tolerance_samples_an_s_curve_more_densely() {
    let control = vec![[0.0, 0.0], [1.0, 2.0], [2.0, -2.0], [3.0, 0.0]];
    let coarse = sample_catmull_rom(&control, 0.2);
    let fine = sample_catmull_rom(&control, 0.01);
    assert!(
        fine.points.len() > coarse.points.len(),
        "a tighter tolerance should need more chords to stay within it"
    );
    // The curve still runs from the first control point to the last.
    assert_eq!(fine.points.first(), Some(&control[0]));
    assert_eq!(fine.points.last(), Some(&control[control.len() - 1]));
}

#[test]
fn two_parallel_bands_stay_a_constant_width_apart() {
    let polyline = Polyline { points: vec![[0.0, 0.0], [10.0, 0.0]] };
    let bands = offset_bands(&polyline, &[-1.0, 0.0, 1.0], 4.0);
    assert_eq!(bands.len(), 2);
    // Endpoints of the run: the offset curve at -1 and at +1 should sit
    // exactly 2 units apart everywhere along a straight run.
    let left = &bands[0].outer;
    let right = &bands[1].outer;
    // band 0 outer = curve(-1) forward ++ curve(0) reversed
    // band 1 outer = curve(0) forward ++ curve(1) reversed
    let left_start = left[0];
    let right_end = right[right.len() - 1]; // curve(1) reversed's last point is curve(1)[0]
    assert!((distance(left_start, right_end) - 2.0).abs() < 1e-4);
}

#[test]
fn a_sharp_corner_is_mitred_within_the_miter_limit() {
    let polyline = Polyline { points: vec![[0.0, 0.0], [5.0, 0.0], [5.0, 5.0]] };
    let miter_limit = 2.0;
    let bands = offset_bands(&polyline, &[-1.0, 1.0], miter_limit);
    assert_eq!(bands.len(), 1);
    // outer = curve(-1) forward (3 points) ++ curve(1) reversed (3 points);
    // index 1 of curve(-1) is the corner's own offset point.
    let corner = polyline.points[1];
    let offset_corner = bands[0].outer[1];
    let reach = distance(corner, offset_corner);
    assert!(
        reach <= miter_limit + 1e-3,
        "mitred corner reached {reach}, past the miter limit {miter_limit}"
    );
}

#[test]
fn offset_bands_needs_at_least_two_points_and_two_offsets() {
    let single_point = Polyline { points: vec![[0.0, 0.0]] };
    assert!(offset_bands(&single_point, &[-1.0, 1.0], 4.0).is_empty());

    let line = Polyline { points: vec![[0.0, 0.0], [1.0, 0.0]] };
    assert!(offset_bands(&line, &[0.0], 4.0).is_empty());
}

#[test]
fn a_t_junction_of_two_bands_unions_into_one_covered_area_without_double_counting() {
    // A horizontal run crossed by a vertical run that stops inside it -- the
    // shape a T-shaped road junction reduces to once both runs are offset
    // into rectangles.
    let horizontal = rect(0.0, 10.0, -1.0, 1.0); // area 20
    let vertical = rect(4.0, 6.0, -4.0, 1.0); // area 10, overlaps the horizontal band by 2x2 = 4
    let mesh = union_and_triangulate(&[horizontal, vertical]);
    let expected_area = 20.0 + 10.0 - 4.0;
    let area = mesh_area(&mesh);
    assert!(
        (area - expected_area).abs() < 1e-2,
        "union area {area} did not match the expected T footprint {expected_area}"
    );
}

#[test]
fn an_x_crossing_of_two_bands_unions_into_one_covered_area() {
    let horizontal = rect(-5.0, 5.0, -1.0, 1.0); // area 20
    let vertical = rect(-1.0, 1.0, -5.0, 5.0); // area 20, overlaps by 2x2 = 4
    let mesh = union_and_triangulate(&[horizontal, vertical]);
    let expected_area = 20.0 + 20.0 - 4.0;
    let area = mesh_area(&mesh);
    assert!(
        (area - expected_area).abs() < 1e-2,
        "union area {area} did not match the expected X footprint {expected_area}"
    );
}

#[test]
fn union_and_triangulate_of_nothing_is_an_empty_mesh() {
    let mesh = union_and_triangulate(&[]);
    assert!(mesh.positions.is_empty());
    assert!(mesh.indices.is_empty());
}

#[test]
fn union_indices_always_come_in_complete_triangles() {
    let horizontal = rect(0.0, 10.0, -1.0, 1.0);
    let vertical = rect(4.0, 6.0, -4.0, 1.0);
    let mesh = union_and_triangulate(&[horizontal, vertical]);
    assert_eq!(mesh.indices.len() % 3, 0);
    assert!(mesh.indices.iter().all(|&index| (index as usize) < mesh.positions.len()));
}
