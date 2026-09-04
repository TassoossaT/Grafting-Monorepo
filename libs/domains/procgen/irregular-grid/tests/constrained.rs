//! Ground generated against contours another cloud already committed to.
//!
//! Every test here names a failure the generated-fill approach this replaces
//! actually produced in a live session, so a regression reads as the symptom
//! rather than as a geometry assertion.

use grafting_procgen_irregular_grid::constrained::{
    ConstrainedOptions, ConstraintPoint, triangulate_constrained,
};
use grafting_procgen_irregular_grid::mesh::Vec2;

/// A 10x10 field of ground.
fn field() -> Vec<ConstraintPoint> {
    [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
        .iter()
        .enumerate()
        .map(|(index, &(x, y))| ConstraintPoint {
            position: Vec2::new(x, y),
            source: Some(index as u32),
        })
        .collect()
}

/// A road two units wide running clean across the field and out both sides,
/// the case a single winding rule gets wrong.
fn road_across() -> Vec<ConstraintPoint> {
    [(-2.0, 4.0), (12.0, 4.0), (12.0, 6.0), (-2.0, 6.0)]
        .iter()
        .enumerate()
        .map(|(index, &(x, y))| ConstraintPoint {
            position: Vec2::new(x, y),
            source: Some(100 + index as u32),
        })
        .collect()
}

/// A road that stops inside the field, reaching none of its borders.
fn road_island() -> Vec<ConstraintPoint> {
    [(3.0, 4.0), (7.0, 4.0), (7.0, 6.0), (3.0, 6.0)]
        .iter()
        .enumerate()
        .map(|(index, &(x, y))| ConstraintPoint {
            position: Vec2::new(x, y),
            source: Some(200 + index as u32),
        })
        .collect()
}

/// The equilateral lattice the unconstrained stage would have laid, offered
/// as seeds so the interior keeps the spacing the rest of the world has.
fn lattice(step: f64) -> Vec<Vec2> {
    let mut points = Vec::new();
    let mut row = 0;
    let mut y = -1.0;
    while y < 11.0 {
        let offset = if row % 2 == 0 { 0.0 } else { step / 2.0 };
        let mut x = -1.0 + offset;
        while x < 11.0 {
            points.push(Vec2::new(x, y));
            x += step;
        }
        y += step * 0.866_025_403_784_438_6;
        row += 1;
    }
    points
}

fn options(holes: Vec<Vec<ConstraintPoint>>) -> ConstrainedOptions {
    ConstrainedOptions {
        boundary: vec![field()],
        holes,
        seeds: lattice(1.0),
        seed_clearance: 0.25,
        max_area: 0.75,
        min_area: 0.0,
        min_angle_degrees: 30.0,
        max_additional_vertices: 20_000,
    }
}

fn centroid(points: [Vec2; 3]) -> Vec2 {
    Vec2::new(
        points.iter().map(|point| point.x).sum::<f64>() / 3.0,
        points.iter().map(|point| point.y).sum::<f64>() / 3.0,
    )
}

fn triangle_area(points: [Vec2; 3]) -> f64 {
    ((points[1].x - points[0].x) * (points[2].y - points[0].y)
        - (points[2].x - points[0].x) * (points[1].y - points[0].y))
        .abs()
        / 2.0
}

#[test]
fn no_ground_is_generated_on_top_of_the_road() {
    // "está sendo gerado terreno entre as faces cortadas" -- the mend laying
    // ground straight over the road instead of stopping at its contour.
    let result = triangulate_constrained(&options(vec![road_across()])).expect("a triangulation");

    for face in &result.mesh.faces {
        let corners = [
            result.mesh.vertices[face[0]],
            result.mesh.vertices[face[1]],
            result.mesh.vertices[face[2]],
        ];
        let middle = centroid(corners);
        assert!(
            !(middle.y > 4.0 && middle.y < 6.0),
            "a triangle centred at ({}, {}) sits inside the road",
            middle.x,
            middle.y
        );
    }
}

#[test]
fn a_road_that_stops_inside_the_field_is_opened_around_rather_than_paved_over() {
    // The engine reports a gap outer rim and never a face standing alone in
    // the middle of it, so the previous mend joined the two banks over the
    // top of the road. A hole is a hole wherever it sits.
    let result = triangulate_constrained(&options(vec![road_island()])).expect("a triangulation");

    for face in &result.mesh.faces {
        let middle = centroid([
            result.mesh.vertices[face[0]],
            result.mesh.vertices[face[1]],
            result.mesh.vertices[face[2]],
        ]);
        assert!(
            !(middle.x > 3.0 && middle.x < 7.0 && middle.y > 4.0 && middle.y < 6.0),
            "ground was laid over the island road at ({}, {})",
            middle.x,
            middle.y
        );
    }

    // And the ground really does surround it, rather than the hole having
    // swallowed the field.
    assert!(result.mesh.faces.len() > 50, "the field around the road is still ground");
}

#[test]
fn the_ground_the_road_overshoots_is_not_invented() {
    // The failure a single odd-winding rule produces: the part of the road
    // outside the field winds once, reads as inside, and comes back as
    // ground that never existed.
    let result = triangulate_constrained(&options(vec![road_across()])).expect("a triangulation");

    for vertex in &result.mesh.vertices {
        assert!(
            vertex.x >= -1e-9 && vertex.x <= 10.0 + 1e-9,
            "a vertex at x={} is outside the field the caller asked to fill",
            vertex.x
        );
    }
}

#[test]
fn every_contour_node_comes_back_carrying_the_id_it_arrived_with() {
    // The whole reason a triangulation is used instead of a polygon
    // difference: no position is ever matched back to a node by proximity.
    let result = triangulate_constrained(&options(vec![road_island()])).expect("a triangulation");

    let mut found: Vec<(u32, Vec2)> = result
        .sources
        .iter()
        .enumerate()
        .filter_map(|(index, source)| source.map(|id| (id, result.mesh.vertices[index])))
        .collect();
    found.sort_by_key(|&(id, _)| id);

    for corner in field().iter().chain(road_island().iter()) {
        let id = corner.source.expect("the fixture names every corner");
        let (_, position) = found
            .iter()
            .find(|&&(candidate, _)| candidate == id)
            .unwrap_or_else(|| panic!("constraint node {id} vanished from the triangulation"));
        assert_eq!(
            (position.x, position.y),
            (corner.position.x, corner.position.y),
            "constraint node {id} came back at a different position"
        );
    }

    let mut ids: Vec<u32> = found.iter().map(|&(id, _)| id).collect();
    ids.dedup();
    assert_eq!(ids.len(), found.len(), "no source id may appear on two vertices");
}

#[test]
fn the_mesh_is_cut_to_the_cell_scale_rather_than_spanning_the_gap() {
    // The earcut failure this replaces, stated directly: ear clipping adds no
    // interior vertex, so the band between the field edge and the road could
    // only ever be long triangles reaching from one boundary to the other.
    let options = options(vec![road_across()]);
    let result = triangulate_constrained(&options).expect("a triangulation");

    assert!(result.refinement_complete, "the refinement finished within its budget");

    for face in &result.mesh.faces {
        let corners = [
            result.mesh.vertices[face[0]],
            result.mesh.vertices[face[1]],
            result.mesh.vertices[face[2]],
        ];
        let area = triangle_area(corners);
        assert!(
            area <= options.max_area + 1e-9,
            "a triangle of area {area} survived a max_area of {}",
            options.max_area
        );
        assert!(area > 1e-12, "no triangle is degenerate");
    }
}

#[test]
fn the_mesh_has_interior_vertices_and_not_only_boundary_ones() {
    // "todas as arestas estão no mesmo ponto" -- every corner sitting on one
    // of the two contours, because nothing ever generated a point between
    // them. A vertex with no source is one the refinement invented.
    let result = triangulate_constrained(&options(vec![road_across()])).expect("a triangulation");

    let invented = result.sources.iter().filter(|source| source.is_none()).count();
    assert!(
        invented > result.mesh.vertices.len() / 2,
        "only {invented} of {} vertices are interior; the mesh is still spanning its own rim",
        result.mesh.vertices.len()
    );
}

#[test]
fn two_crossing_contours_meet_at_a_real_shared_vertex() {
    // One road over another. The crossing has to become a vertex both
    // constraints run through, or the second constraint is simply refused.
    let mut options = options(vec![road_across()]);
    options.holes.push(
        [(4.0, -2.0), (6.0, -2.0), (6.0, 12.0), (4.0, 12.0)]
            .iter()
            .enumerate()
            .map(|(index, &(x, y))| ConstraintPoint {
                position: Vec2::new(x, y),
                source: Some(300 + index as u32),
            })
            .collect(),
    );

    let result = triangulate_constrained(&options).expect("a triangulation");

    // The crossroads itself is road, from both directions.
    for face in &result.mesh.faces {
        let middle = centroid([
            result.mesh.vertices[face[0]],
            result.mesh.vertices[face[1]],
            result.mesh.vertices[face[2]],
        ]);
        let on_horizontal = middle.y > 4.0 && middle.y < 6.0;
        let on_vertical = middle.x > 4.0 && middle.x < 6.0;
        assert!(
            !on_horizontal && !on_vertical,
            "ground at ({}, {}) sits on a road",
            middle.x,
            middle.y
        );
    }

    // Four quadrants of ground, none of them joined to another.
    assert!(result.mesh.faces.len() > 40, "all four quadrants came back");
}

#[test]
fn ground_with_no_holes_at_all_is_still_ground() {
    // The creation case: a stroke on empty ground names its own outline and
    // nothing else. Same call, one list left empty.
    let result = triangulate_constrained(&options(vec![])).expect("a triangulation");
    let covered: f64 = result
        .mesh
        .faces
        .iter()
        .map(|face| {
            triangle_area([
                result.mesh.vertices[face[0]],
                result.mesh.vertices[face[1]],
                result.mesh.vertices[face[2]],
            ])
        })
        .sum();
    assert!(
        (covered - 100.0).abs() < 1e-6,
        "the triangles should tile the whole 10x10 field; they cover {covered}"
    );
}

#[test]
fn a_hole_removes_exactly_its_own_area_and_no_more() {
    let result = triangulate_constrained(&options(vec![road_island()])).expect("a triangulation");
    let covered: f64 = result
        .mesh
        .faces
        .iter()
        .map(|face| {
            triangle_area([
                result.mesh.vertices[face[0]],
                result.mesh.vertices[face[1]],
                result.mesh.vertices[face[2]],
            ])
        })
        .sum();
    // 10x10 field less the 4x2 road standing in it.
    assert!(
        (covered - 92.0).abs() < 1e-6,
        "ground should be the field minus exactly the road; it covers {covered}"
    );
}

#[test]
fn constraints_that_cannot_form_a_triangulation_are_refused_rather_than_approximated() {
    let mut degenerate = options(vec![]);
    degenerate.boundary = vec![vec![ConstraintPoint { position: Vec2::new(0.0, 0.0), source: None }]];
    degenerate.seeds = Vec::new();
    assert!(triangulate_constrained(&degenerate).is_none());
}

// ------------------------------------------- the whole pipeline, constrained

fn quad_centre(grid: &grafting_procgen_irregular_grid::ConstrainedQuadGrid, quad: [usize; 4]) -> Vec2 {
    Vec2::new(
        quad.iter().map(|&index| grid.mesh.vertices[index].x).sum::<f64>() / 4.0,
        quad.iter().map(|&index| grid.mesh.vertices[index].y).sum::<f64>() / 4.0,
    )
}

#[test]
fn the_finished_grid_still_stops_at_the_road_after_relaxing() {
    let options = options(vec![road_island()]);
    let grid = grafting_procgen_irregular_grid::build_constrained_quad_grid(
        &options,
        7,
        &grafting_procgen_irregular_grid::RelaxOptions::standard(),
    )
    .expect("a grid");

    assert!(!grid.mesh.quads.is_empty());
    for &quad in &grid.mesh.quads {
        let centre = quad_centre(&grid, quad);
        assert!(
            !(centre.x > 3.0 && centre.x < 7.0 && centre.y > 4.0 && centre.y < 6.0),
            "a cell centred at ({}, {}) drifted onto the road during relaxation",
            centre.x,
            centre.y
        );
    }
}

#[test]
fn every_corner_that_meets_the_road_stays_exactly_on_it() {
    // Pinning is the whole reason this is one call rather than "generate,
    // then move it back". A corner relaxed off the contour by a hair is a
    // crack that renders, and one that no longer looks like a bug in a fill.
    let options = options(vec![road_island()]);
    let grid = grafting_procgen_irregular_grid::build_constrained_quad_grid(
        &options,
        7,
        &grafting_procgen_irregular_grid::RelaxOptions::standard(),
    )
    .expect("a grid");

    let named: Vec<usize> = (0..grid.mesh.vertices.len())
        .filter(|&index| grid.sources[index].is_some())
        .collect();
    assert!(!named.is_empty(), "the contour corners survived into the finished grid");

    for index in named.iter().copied().chain(grid.on_contour.iter().map(|node| node.vertex)) {
        assert!(
            grafting_procgen_irregular_grid::constrained::locate_on_contour(
                &options,
                grid.mesh.vertices[index],
                1e-9,
            )
            .is_some(),
            "corner {index} at ({}, {}) left the contour it was pinned to",
            grid.mesh.vertices[index].x,
            grid.mesh.vertices[index].y
        );
    }
}

#[test]
fn the_nodes_the_road_has_to_adopt_are_reported_rather_than_left_implicit() {
    // The decision this rests on: the refinement and `ortho` both put points
    // along a contour, and the cloud owning it has to take them. Silence here
    // would be a terrain corner touching the middle of a road edge without
    // sharing it.
    let options = options(vec![road_island()]);
    let grid = grafting_procgen_irregular_grid::build_constrained_quad_grid(
        &options,
        7,
        &grafting_procgen_irregular_grid::RelaxOptions::standard(),
    )
    .expect("a grid");

    assert!(
        !grid.on_contour.is_empty(),
        "quadrangulating a contour edge puts a midpoint on it; that node has to be reported"
    );
    for node in &grid.on_contour {
        assert!(grid.sources[node.vertex].is_none(), "a reported node is one nobody already owned");
    }
}

#[test]
fn a_reported_node_names_the_segment_it_landed_on() {
    // The whole reason this is a location and not a boolean: adopting the
    // node means splitting the exact edge under it, and the caller must not
    // have to find that edge by position.
    let options = options(vec![road_island()]);
    let grid = grafting_procgen_irregular_grid::build_constrained_quad_grid(
        &options,
        7,
        &grafting_procgen_irregular_grid::RelaxOptions::standard(),
    )
    .expect("a grid");

    let mut on_the_road = 0;
    for node in &grid.on_contour {
        let rings = if node.location.in_holes { &options.holes } else { &options.boundary };
        let ring = &rings[node.location.ring];
        let from = ring[node.location.segment].position;
        let to = ring[(node.location.segment + 1) % ring.len()].position;

        // The named segment really is the one the node sits on.
        let point = grid.mesh.vertices[node.vertex];
        let along = ((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y))
            / ((to.x - from.x).powi(2) + (to.y - from.y).powi(2));
        assert!(
            (-1e-9..=1.0 + 1e-9).contains(&along),
            "node {} is not between the ends of the segment it named",
            node.vertex
        );
        let cross = (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
        let length = ((to.x - from.x).powi(2) + (to.y - from.y).powi(2)).sqrt();
        assert!(
            (cross / length).abs() < 1e-9,
            "node {} is not on the segment it named",
            node.vertex
        );

        if node.location.in_holes {
            on_the_road += 1;
        }
    }
    assert!(
        on_the_road > 0,
        "quadrangulating the road contour puts nodes on it; the road has to be told which edges"
    );
}
