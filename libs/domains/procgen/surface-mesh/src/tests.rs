//! Comprehensive test suite for surface mesh triangulation.

use std::collections::HashMap;

use grafting_graph_core::{
    ContourEdge, ContourEdgeId, ContourGeometry, ContourLoop, ContourTopology, Graph, Node, NodeId,
    OrientedEdgeUse, RegionId,
};

use crate::math::{cross, sub};
use crate::triangulate_region;
use crate::types::{TriangulatedMesh, ARC_TESSELLATION_TOLERANCE};

fn nid(name: &str) -> NodeId {
    NodeId::new(name).unwrap()
}

type PositionGraph = Graph<[f32; 3], ()>;

fn graph_with_positions(positions: &[(&str, [f32; 3])]) -> PositionGraph {
    Graph::try_from_parts(
        positions
            .iter()
            .map(|(id, position)| Node::new(nid(id), *position))
            .collect(),
        Vec::new(),
    )
    .unwrap()
}

fn line_loop(
    topology: &mut ContourTopology,
    graph: &PositionGraph,
    prefix: &str,
    nodes: &[&str],
) -> ContourLoop {
    nodes
        .iter()
        .enumerate()
        .map(|(index, start)| {
            let end = nodes[(index + 1) % nodes.len()];
            let edge_id = ContourEdgeId::new(format!("{prefix}-{index}")).unwrap();
            topology
                .add_edge(
                    graph,
                    ContourEdge::new(edge_id.clone(), nid(start), nid(end), ContourGeometry::Line),
                )
                .unwrap();
            OrientedEdgeUse::forward(edge_id)
        })
        .collect()
}

/// One upright wall panel, straight or curved, described the way a
/// generator declares it: a base run, a side rising, a run back along
/// the top, a side coming down. `curved` swaps the rails' geometry and
/// nothing else -- which is the whole point, since the construction is
/// the same either way.
fn upright_panel(
    topology: &mut ContourTopology,
    graph: &PositionGraph,
    prefix: &str,
    curved: Option<[f32; 2]>,
) -> ContourLoop {
    let rail = |clockwise: bool| match curved {
        Some(center) => ContourGeometry::CircularArc { center, clockwise },
        None => ContourGeometry::Line,
    };
    let spec: [(&str, &str, &str, ContourGeometry); 4] = [
        ("base", "bottom-start", "bottom-end", rail(false)),
        ("right", "bottom-end", "top-end", ContourGeometry::Line),
        ("top", "top-end", "top-start", rail(true)),
        ("left", "top-start", "bottom-start", ContourGeometry::Line),
    ];
    spec.iter()
        .map(|(name, start, end, geometry)| {
            let edge_id = ContourEdgeId::new(format!("{prefix}-{name}")).unwrap();
            topology
                .add_edge(
                    graph,
                    ContourEdge::new(edge_id.clone(), nid(start), nid(end), *geometry),
                )
                .unwrap();
            OrientedEdgeUse::forward(edge_id)
        })
        .collect()
}

/// A half-circle panel of radius 2, three units tall, standing on the origin.
fn curved_panel_graph() -> PositionGraph {
    graph_with_positions(&[
        ("bottom-start", [2.0, 0.0, 0.0]),
        ("bottom-end", [-2.0, 0.0, 0.0]),
        ("top-end", [-2.0, 3.0, 0.0]),
        ("top-start", [2.0, 3.0, 0.0]),
    ])
}

fn positions_of(graph: &PositionGraph) -> HashMap<String, [f32; 3]> {
    graph
        .snapshot()
        .nodes()
        .iter()
        .map(|node| (node.id().as_str().to_owned(), *node.data()))
        .collect()
}

fn mesh_of(
    topology: &ContourTopology,
    region_id: &RegionId,
    positions: &HashMap<String, [f32; 3]>,
) -> TriangulatedMesh {
    triangulate_region(topology, topology.region(region_id).unwrap(), |id| {
        positions.get(id.as_str()).copied()
    })
    .unwrap()
    .pop()
    .unwrap()
}

/// The centroid of one triangle, in world coordinates.
fn centroid_of(mesh: &TriangulatedMesh, triangle: &[u32]) -> [f32; 3] {
    let mut sum = [0.0_f32; 3];
    for index in triangle {
        let point = mesh.positions[*index as usize];
        for axis in 0..3 {
            sum[axis] += point[axis];
        }
    }
    [sum[0] / 3.0, sum[1] / 3.0, sum[2] / 3.0]
}

fn assert_every_triangle_has_area(mesh: &TriangulatedMesh) {
    for triangle in mesh.indices.chunks_exact(3) {
        let [a, b, c] = [
            triangle[0] as usize,
            triangle[1] as usize,
            triangle[2] as usize,
        ];
        let area = cross(
            sub(mesh.positions[b], mesh.positions[a]),
            sub(mesh.positions[c], mesh.positions[a]),
        );
        let length = (area[0].powi(2) + area[1].powi(2) + area[2].powi(2)).sqrt();
        assert!(length > 1e-6, "degenerate triangle at indices {a},{b},{c}");
    }
}

fn assert_one_uv_per_vertex(mesh: &TriangulatedMesh) {
    assert_eq!(
        mesh.uvs.len(),
        mesh.positions.len(),
        "uvs and positions must stay index-aligned"
    );
}

#[test]
fn analytic_arc_region_tessellates_only_in_the_mesh() {
    let graph = graph_with_positions(&[
        ("east", [2.0, 0.0, 0.0]),
        ("north", [0.0, 0.0, 2.0]),
        ("west", [-2.0, 0.0, 0.0]),
        ("south", [0.0, 0.0, -2.0]),
    ]);
    let mut topology = ContourTopology::new();
    let nodes = ["east", "north", "west", "south"];
    let loop_ = nodes
        .iter()
        .enumerate()
        .map(|(index, start)| {
            let end = nodes[(index + 1) % nodes.len()];
            let edge_id = ContourEdgeId::new(format!("arc-{index}")).unwrap();
            topology
                .add_edge(
                    &graph,
                    ContourEdge::new(
                        edge_id.clone(),
                        nid(start),
                        nid(end),
                        ContourGeometry::CircularArc {
                            center: [0.0, 0.0],
                            clockwise: false,
                        },
                    ),
                )
                .unwrap();
            OrientedEdgeUse::forward(edge_id)
        })
        .collect();
    let region_id = RegionId::new("circle").unwrap();
    topology
        .add_region(region_id.clone(), vec![loop_], Vec::new())
        .unwrap();
    let positions = graph
        .snapshot()
        .nodes()
        .iter()
        .map(|node| (node.id().as_str().to_owned(), *node.data()))
        .collect::<HashMap<_, _>>();

    let meshes = triangulate_region(&topology, topology.region(&region_id).unwrap(), |id| {
        positions.get(id.as_str()).copied()
    })
    .unwrap();

    assert_eq!(
        topology.region(&region_id).unwrap().outer_loops()[0].len(),
        4
    );
    assert_eq!(meshes.len(), 1);
    assert!(
        meshes[0].positions.len() > 4,
        "the renderer may facet the arc"
    );
    assert!(!meshes[0].indices.is_empty());
}

#[test]
fn a_curved_upright_panel_meshes_on_its_own_true_cylinder() {
    let graph = curved_panel_graph();
    let mut topology = ContourTopology::new();
    let loop_ = upright_panel(&mut topology, &graph, "panel", Some([0.0, 0.0]));
    let region_id = RegionId::new("panel").unwrap();
    topology
        .add_region(region_id.clone(), vec![loop_], Vec::new())
        .unwrap();

    let mesh = mesh_of(&topology, &region_id, &positions_of(&graph));

    for point in &mesh.positions {
        let radius = (point[0].powi(2) + point[2].powi(2)).sqrt();
        assert!(
            (radius - 2.0).abs() < 1e-2,
            "point left the cylinder: {point:?}"
        );
        assert!(point[1] == 0.0 || point[1] == 3.0);
    }
    assert_every_triangle_has_area(&mesh);
    assert!(
        mesh.normals.iter().any(|normal| {
            let first = mesh.normals[0];
            (normal[0] - first[0]).abs() > 1e-3 || (normal[2] - first[2]).abs() > 1e-3
        }),
        "a curved panel must not shade as one flat face"
    );
    for normal in &mesh.normals {
        assert!(
            normal[1].abs() < 1e-3,
            "an upright panel's normals stay horizontal, got {normal:?}"
        );
    }
}

#[test]
fn a_straight_upright_panel_takes_the_same_path_and_stays_four_corners() {
    let graph = graph_with_positions(&[
        ("bottom-start", [0.0, 0.0, 0.0]),
        ("bottom-end", [4.0, 0.0, 0.0]),
        ("top-end", [4.0, 3.0, 0.0]),
        ("top-start", [0.0, 3.0, 0.0]),
    ]);
    let mut topology = ContourTopology::new();
    let loop_ = upright_panel(&mut topology, &graph, "flat", None);
    let region_id = RegionId::new("flat").unwrap();
    topology
        .add_region(region_id.clone(), vec![loop_], Vec::new())
        .unwrap();

    let mesh = mesh_of(&topology, &region_id, &positions_of(&graph));

    assert_eq!(mesh.positions.len(), 4);
    assert_eq!(mesh.indices.len(), 6);
    assert_every_triangle_has_area(&mesh);
    let first = mesh.normals[0];
    for normal in &mesh.normals {
        assert!(normal[1].abs() < 1e-3);
        assert!(
            (normal[0] - first[0]).abs() < 1e-4 && (normal[2] - first[2]).abs() < 1e-4,
            "a flat panel shades as one face"
        );
    }
}

#[test]
fn a_curved_upright_panel_carries_an_opening() {
    let mut nodes = vec![
        ("bottom-start", [2.0, 0.0, 0.0]),
        ("bottom-end", [-2.0, 0.0, 0.0]),
        ("top-end", [-2.0, 3.0, 0.0]),
        ("top-start", [2.0, 3.0, 0.0]),
    ];
    let rim: Vec<(String, [f32; 3])> = [(0.6_f32, 1.0_f32), (1.1, 1.0), (1.1, 2.0), (0.6, 2.0)]
        .iter()
        .enumerate()
        .map(|(index, (angle, height))| {
            (
                format!("rim{index}"),
                [2.0 * angle.cos(), *height, 2.0 * angle.sin()],
            )
        })
        .collect();
    let owned: Vec<(&str, [f32; 3])> = rim
        .iter()
        .map(|(id, position)| (id.as_str(), *position))
        .collect();
    nodes.extend(owned);
    let graph = graph_with_positions(&nodes);

    let mut topology = ContourTopology::new();
    let outer = upright_panel(&mut topology, &graph, "panel", Some([0.0, 0.0]));
    let hole = line_loop(
        &mut topology,
        &graph,
        "rim",
        &["rim0", "rim1", "rim2", "rim3"],
    );
    let region_id = RegionId::new("panel").unwrap();
    topology
        .add_region(region_id.clone(), vec![outer], vec![hole])
        .unwrap();

    let mesh = mesh_of(&topology, &region_id, &positions_of(&graph));

    assert_every_triangle_has_area(&mesh);
    for triangle in mesh.indices.chunks_exact(3) {
        let centroid = centroid_of(&mesh, triangle);
        let angle = centroid[2].atan2(centroid[0]);
        assert!(
            !(0.6..=1.1).contains(&angle) || !(1.0..=2.0).contains(&centroid[1]),
            "a triangle covered the opening: {centroid:?}"
        );
    }
}

#[test]
fn a_panel_with_a_welded_base_is_still_an_upright_face() {
    let graph = graph_with_positions(&[
        ("bottom-start", [2.0, 0.0, 0.0]),
        ("mid", [0.0, 0.0, 2.0]),
        ("bottom-end", [-2.0, 0.0, 0.0]),
        ("top-end", [-2.0, 3.0, 0.0]),
        ("top-start", [2.0, 3.0, 0.0]),
    ]);
    let mut topology = ContourTopology::new();
    let arc = |clockwise: bool| ContourGeometry::CircularArc {
        center: [0.0, 0.0],
        clockwise,
    };
    let spec: [(&str, &str, &str, ContourGeometry); 5] = [
        ("base-a", "bottom-start", "mid", arc(false)),
        ("base-b", "mid", "bottom-end", arc(false)),
        ("right", "bottom-end", "top-end", ContourGeometry::Line),
        ("top", "top-end", "top-start", arc(true)),
        ("left", "top-start", "bottom-start", ContourGeometry::Line),
    ];
    let loop_: ContourLoop = spec
        .iter()
        .map(|(name, start, end, geometry)| {
            let edge_id = ContourEdgeId::new(*name).unwrap();
            topology
                .add_edge(
                    &graph,
                    ContourEdge::new(edge_id.clone(), nid(start), nid(end), *geometry),
                )
                .unwrap();
            OrientedEdgeUse::forward(edge_id)
        })
        .collect();
    let region_id = RegionId::new("welded").unwrap();
    topology
        .add_region(region_id.clone(), vec![loop_], Vec::new())
        .unwrap();

    let mesh = mesh_of(&topology, &region_id, &positions_of(&graph));

    assert_every_triangle_has_area(&mesh);
    for point in &mesh.positions {
        let radius = (point[0].powi(2) + point[2].powi(2)).sqrt();
        assert!(
            (radius - 2.0).abs() < 1e-2,
            "a welded panel still meshes on its own cylinder: {point:?}"
        );
    }
}

#[test]
fn a_vertical_face_keeps_the_hole_punched_in_it() {
    let graph = graph_with_positions(&[
        ("o0", [0.0, 0.0, 0.0]),
        ("o1", [4.0, 0.0, 0.0]),
        ("o2", [4.0, 3.0, 0.0]),
        ("o3", [0.0, 3.0, 0.0]),
        ("h0", [1.0, 1.0, 0.0]),
        ("h1", [1.0, 2.0, 0.0]),
        ("h2", [3.0, 2.0, 0.0]),
        ("h3", [3.0, 1.0, 0.0]),
    ]);
    let mut topology = ContourTopology::new();
    let outer = line_loop(&mut topology, &graph, "outer", &["o0", "o1", "o2", "o3"]);
    let hole = line_loop(&mut topology, &graph, "hole", &["h0", "h1", "h2", "h3"]);
    let region_id = RegionId::new("panel").unwrap();
    topology
        .add_region(region_id.clone(), vec![outer], vec![hole])
        .unwrap();
    let positions = graph
        .snapshot()
        .nodes()
        .iter()
        .map(|node| (node.id().as_str().to_owned(), *node.data()))
        .collect::<HashMap<_, _>>();

    let mesh = triangulate_region(&topology, topology.region(&region_id).unwrap(), |id| {
        positions.get(id.as_str()).copied()
    })
    .unwrap()
    .pop()
    .unwrap();

    for triangle in mesh.indices.chunks_exact(3) {
        let centroid = triangle.iter().fold([0.0; 3], |sum, index| {
            let point = mesh.positions[*index as usize];
            [
                sum[0] + point[0] / 3.0,
                sum[1] + point[1] / 3.0,
                sum[2] + point[2] / 3.0,
            ]
        });
        assert!(
            centroid[0] <= 1.0 || centroid[0] >= 3.0 || centroid[1] <= 1.0 || centroid[1] >= 2.0,
            "a triangle covered the opening: {centroid:?}"
        );
    }
}

#[test]
fn analytic_region_hole_receives_no_mesh_triangles() {
    let graph = graph_with_positions(&[
        ("o0", [-2.0, 0.0, -2.0]),
        ("o1", [2.0, 0.0, -2.0]),
        ("o2", [2.0, 0.0, 2.0]),
        ("o3", [-2.0, 0.0, 2.0]),
        ("h0", [-0.5, 0.0, -0.5]),
        ("h1", [-0.5, 0.0, 0.5]),
        ("h2", [0.5, 0.0, 0.5]),
        ("h3", [0.5, 0.0, -0.5]),
    ]);
    let mut topology = ContourTopology::new();
    let outer = line_loop(&mut topology, &graph, "outer", &["o0", "o1", "o2", "o3"]);
    let hole = line_loop(&mut topology, &graph, "hole", &["h0", "h1", "h2", "h3"]);
    let region_id = RegionId::new("with-hole").unwrap();
    topology
        .add_region(region_id.clone(), vec![outer], vec![hole])
        .unwrap();
    let positions = graph
        .snapshot()
        .nodes()
        .iter()
        .map(|node| (node.id().as_str().to_owned(), *node.data()))
        .collect::<HashMap<_, _>>();

    let mesh = triangulate_region(&topology, topology.region(&region_id).unwrap(), |id| {
        positions.get(id.as_str()).copied()
    })
    .unwrap()
    .pop()
    .unwrap();

    for triangle in mesh.indices.chunks_exact(3) {
        let centroid = triangle.iter().fold([0.0; 3], |sum, index| {
            let point = mesh.positions[*index as usize];
            [
                sum[0] + point[0] / 3.0,
                sum[1] + point[1] / 3.0,
                sum[2] + point[2] / 3.0,
            ]
        });
        assert!(
            centroid[0] <= -0.5 || centroid[0] >= 0.5 || centroid[2] <= -0.5 || centroid[2] >= 0.5,
            "triangle centroid entered the analytic hole: {centroid:?}"
        );
    }
}

#[test]
fn an_upright_panel_measures_its_uvs_in_metres() {
    let graph = graph_with_positions(&[
        ("bottom-start", [0.0, 0.0, 0.0]),
        ("bottom-end", [4.0, 0.0, 0.0]),
        ("top-end", [4.0, 3.0, 0.0]),
        ("top-start", [0.0, 3.0, 0.0]),
    ]);
    let mut topology = ContourTopology::new();
    let loop_ = upright_panel(&mut topology, &graph, "flat", None);
    let region_id = RegionId::new("flat").unwrap();
    topology
        .add_region(region_id.clone(), vec![loop_], Vec::new())
        .unwrap();

    let mesh = mesh_of(&topology, &region_id, &positions_of(&graph));

    assert_one_uv_per_vertex(&mesh);
    for (point, uv) in mesh.positions.iter().zip(mesh.uvs.iter()) {
        assert!(
            (uv[0] - point[0]).abs() < 1e-4 && (uv[1] - point[1]).abs() < 1e-4,
            "expected {point:?} to measure as itself, got {uv:?}"
        );
    }
    let widest = mesh.uvs.iter().fold(0.0_f32, |max, uv| max.max(uv[0]));
    let tallest = mesh.uvs.iter().fold(0.0_f32, |max, uv| max.max(uv[1]));
    assert!((widest - 4.0).abs() < 1e-4, "4 m panel measured {widest}");
    assert!((tallest - 3.0).abs() < 1e-4, "3 m panel measured {tallest}");
}

#[test]
fn a_curved_panel_measures_along_the_arc_not_the_chord() {
    let graph = curved_panel_graph();
    let mut topology = ContourTopology::new();
    let loop_ = upright_panel(&mut topology, &graph, "panel", Some([0.0, 0.0]));
    let region_id = RegionId::new("panel").unwrap();
    topology
        .add_region(region_id.clone(), vec![loop_], Vec::new())
        .unwrap();

    let mesh = mesh_of(&topology, &region_id, &positions_of(&graph));

    assert_one_uv_per_vertex(&mesh);
    let arc_length = 2.0 * std::f32::consts::PI;
    let furthest = mesh.uvs.iter().fold(0.0_f32, |max, uv| max.max(uv[0]));
    assert!(
        (furthest - arc_length).abs() < 1e-2,
        "expected {arc_length} m of arc, measured {furthest}"
    );
    assert!(furthest > 5.0, "measured the 4 m chord, not the arc");
    for (point, uv) in mesh.positions.iter().zip(mesh.uvs.iter()) {
        assert!((uv[1] - point[1]).abs() < 1e-4, "height moved: {uv:?}");
    }
}

#[test]
fn welding_a_node_into_the_base_leaves_the_uvs_where_they_were() {
    let plain = {
        let graph = curved_panel_graph();
        let mut topology = ContourTopology::new();
        let loop_ = upright_panel(&mut topology, &graph, "panel", Some([0.0, 0.0]));
        let region_id = RegionId::new("panel").unwrap();
        topology
            .add_region(region_id.clone(), vec![loop_], Vec::new())
            .unwrap();
        mesh_of(&topology, &region_id, &positions_of(&graph))
    };

    let welded = {
        let graph = graph_with_positions(&[
            ("bottom-start", [2.0, 0.0, 0.0]),
            ("mid", [0.0, 0.0, 2.0]),
            ("bottom-end", [-2.0, 0.0, 0.0]),
            ("top-end", [-2.0, 3.0, 0.0]),
            ("top-start", [2.0, 3.0, 0.0]),
        ]);
        let mut topology = ContourTopology::new();
        let arc = |clockwise: bool| ContourGeometry::CircularArc {
            center: [0.0, 0.0],
            clockwise,
        };
        let spec: [(&str, &str, &str, ContourGeometry); 5] = [
            ("base-a", "bottom-start", "mid", arc(false)),
            ("base-b", "mid", "bottom-end", arc(false)),
            ("right", "bottom-end", "top-end", ContourGeometry::Line),
            ("top", "top-end", "top-start", arc(true)),
            ("left", "top-start", "bottom-start", ContourGeometry::Line),
        ];
        let loop_: ContourLoop = spec
            .iter()
            .map(|(name, start, end, geometry)| {
                let edge_id = ContourEdgeId::new(*name).unwrap();
                topology
                    .add_edge(
                        &graph,
                        ContourEdge::new(edge_id.clone(), nid(start), nid(end), *geometry),
                    )
                    .unwrap();
                OrientedEdgeUse::forward(edge_id)
            })
            .collect();
        let region_id = RegionId::new("welded").unwrap();
        topology
            .add_region(region_id.clone(), vec![loop_], Vec::new())
            .unwrap();
        mesh_of(&topology, &region_id, &positions_of(&graph))
    };

    let mut compared = 0;
    for (point, uv) in welded.positions.iter().zip(welded.uvs.iter()) {
        let Some(before) = plain
            .positions
            .iter()
            .zip(plain.uvs.iter())
            .find(|(other, _)| {
                (other[0] - point[0]).abs() < 1e-3
                    && (other[1] - point[1]).abs() < 1e-3
                    && (other[2] - point[2]).abs() < 1e-3
            })
            .map(|(_, other_uv)| *other_uv)
        else {
            continue;
        };
        assert!(
            (before[0] - uv[0]).abs() < 1e-3 && (before[1] - uv[1]).abs() < 1e-3,
            "welding moved {point:?} from {before:?} to {uv:?}"
        );
        compared += 1;
    }
    assert!(
        compared >= 4,
        "expected the shared corners to be compared, matched only {compared}"
    );
}

#[test]
fn an_opening_is_measured_in_the_walls_own_coordinates() {
    let graph = graph_with_positions(&[
        ("o0", [0.0, 0.0, 0.0]),
        ("o1", [4.0, 0.0, 0.0]),
        ("o2", [4.0, 3.0, 0.0]),
        ("o3", [0.0, 3.0, 0.0]),
        ("h0", [1.0, 1.0, 0.0]),
        ("h1", [1.0, 2.0, 0.0]),
        ("h2", [3.0, 2.0, 0.0]),
        ("h3", [3.0, 1.0, 0.0]),
    ]);
    let mut topology = ContourTopology::new();
    let outer = line_loop(&mut topology, &graph, "outer", &["o0", "o1", "o2", "o3"]);
    let hole = line_loop(&mut topology, &graph, "hole", &["h0", "h1", "h2", "h3"]);
    let region_id = RegionId::new("panel").unwrap();
    topology
        .add_region(region_id.clone(), vec![outer], vec![hole])
        .unwrap();

    let mesh = mesh_of(&topology, &region_id, &positions_of(&graph));

    assert_one_uv_per_vertex(&mesh);
    let rim: Vec<[f32; 2]> = mesh
        .positions
        .iter()
        .zip(mesh.uvs.iter())
        .filter(|(point, _)| (0.9..=3.1).contains(&point[0]) && (0.9..=2.1).contains(&point[1]))
        .map(|(_, uv)| *uv)
        .collect();
    assert_eq!(rim.len(), 4, "the four rim corners");
    for uv in &rim {
        assert!(
            (1.0..=3.0).contains(&uv[0]) && (1.0..=2.0).contains(&uv[1]),
            "the opening left the wall's own measurements: {uv:?}"
        );
    }
}

#[test]
fn a_flat_region_measures_its_uvs_in_world_xz() {
    let graph = graph_with_positions(&[
        ("o0", [-2.0, 0.0, -2.0]),
        ("o1", [2.0, 0.0, -2.0]),
        ("o2", [2.0, 0.0, 2.0]),
        ("o3", [-2.0, 0.0, 2.0]),
    ]);
    let mut topology = ContourTopology::new();
    let outer = line_loop(&mut topology, &graph, "outer", &["o0", "o1", "o2", "o3"]);
    let region_id = RegionId::new("floor").unwrap();
    topology
        .add_region(region_id.clone(), vec![outer], Vec::new())
        .unwrap();

    let mesh = mesh_of(&topology, &region_id, &positions_of(&graph));

    assert_one_uv_per_vertex(&mesh);
    for (point, uv) in mesh.positions.iter().zip(mesh.uvs.iter()) {
        assert!(
            (uv[0] - point[0]).abs() < 1e-4 && (uv[1] - point[2]).abs() < 1e-4,
            "expected world xz for {point:?}, got {uv:?}"
        );
    }
}

#[test]
fn a_four_panel_circular_tower_meshes_all_four_quarters_cleanly() {
    let radius = 2.0_f32;
    let height = 3.0_f32;
    let corners = [
        ("c0", [radius, 0.0, 0.0], [radius, height, 0.0]),
        ("c1", [0.0, 0.0, radius], [0.0, height, radius]),
        ("c2", [-radius, 0.0, 0.0], [-radius, height, 0.0]),
        ("c3", [0.0, 0.0, -radius], [0.0, height, -radius]),
    ];

    let mut node_positions = Vec::new();
    for (id, bot, top) in &corners {
        node_positions.push((format!("{id}-bot"), *bot));
        node_positions.push((format!("{id}-top"), *top));
    }
    let pos_refs: Vec<(&str, [f32; 3])> = node_positions
        .iter()
        .map(|(id, pos)| (id.as_str(), *pos))
        .collect();
    let graph = graph_with_positions(&pos_refs);
    let mut topology = ContourTopology::new();

    let arc = |clockwise: bool| ContourGeometry::CircularArc {
        center: [0.0, 0.0],
        clockwise,
    };

    for step in 0..4 {
        let next = (step + 1) % 4;
        let (from_id, _, _) = corners[step];
        let (to_id, _, _) = corners[next];

        let spec = [
            (
                format!("base-{step}"),
                format!("{from_id}-bot"),
                format!("{to_id}-bot"),
                arc(false),
            ),
            (
                format!("right-{step}"),
                format!("{to_id}-bot"),
                format!("{to_id}-top"),
                ContourGeometry::Line,
            ),
            (
                format!("top-{step}"),
                format!("{to_id}-top"),
                format!("{from_id}-top"),
                arc(true),
            ),
            (
                format!("left-{step}"),
                format!("{from_id}-top"),
                format!("{from_id}-bot"),
                ContourGeometry::Line,
            ),
        ];

        let loop_: ContourLoop = spec
            .iter()
            .map(|(name, start, end, geometry)| {
                let edge_id = ContourEdgeId::new(name.clone()).unwrap();
                topology
                    .add_edge(
                        &graph,
                        ContourEdge::new(edge_id.clone(), nid(start), nid(end), *geometry),
                    )
                    .unwrap();
                OrientedEdgeUse::forward(edge_id)
            })
            .collect();

        let region_id = RegionId::new(format!("panel-{step}")).unwrap();
        topology
            .add_region(region_id.clone(), vec![loop_], Vec::new())
            .unwrap();

        let mesh = mesh_of(&topology, &region_id, &positions_of(&graph));
        assert_every_triangle_has_area(&mesh);
        assert_one_uv_per_vertex(&mesh);

        for point in &mesh.positions {
            let r = (point[0].powi(2) + point[2].powi(2)).sqrt();
            assert!(
                (r - radius).abs() < 1e-2,
                "point on panel {step} left cylinder: {point:?}"
            );
        }

        // Normals must point outward (XZ distance from origin grows)
        for (pos, normal) in mesh.positions.iter().zip(mesh.normals.iter()) {
            let dot_radial = pos[0] * normal[0] + pos[2] * normal[2];
            assert!(
                dot_radial > 0.0,
                "panel {step} normal points inward: pos {pos:?}, normal {normal:?}"
            );
        }

        // Every triangle must be a local vertical facet along the cylinder,
        // never a diagonal chord cutting across the 90° arc.
        for triangle in mesh.indices.chunks_exact(3) {
            let p0 = mesh.positions[triangle[0] as usize];
            let p1 = mesh.positions[triangle[1] as usize];
            let p2 = mesh.positions[triangle[2] as usize];
            let a0 = p0[2].atan2(p0[0]);
            let a1 = p1[2].atan2(p1[0]);
            let a2 = p2[2].atan2(p2[0]);
            let mut span = (a0 - a1).abs().max((a1 - a2).abs()).max((a2 - a0).abs());
            if span > std::f32::consts::PI {
                span = std::f32::consts::TAU - span;
            }
            assert!(
                span < 0.4,
                "triangle cut diagonally across cylinder: angular span = {span}"
            );
        }
    }
}

#[test]
fn an_opening_leaves_the_curved_panel_on_its_cylinder() {
    let radius = 2.0_f32;
    let mut nodes = vec![
        ("bottom-start", [radius, 0.0, 0.0]),
        ("bottom-end", [-radius, 0.0, 0.0]),
        ("top-end", [-radius, 3.0, 0.0]),
        ("top-start", [radius, 3.0, 0.0]),
    ];
    let rim: Vec<(String, [f32; 3])> = [(0.6_f32, 1.0_f32), (1.1, 1.0), (1.1, 2.0), (0.6, 2.0)]
        .iter()
        .enumerate()
        .map(|(index, (angle, height))| {
            (
                format!("rim{index}"),
                [radius * angle.cos(), *height, radius * angle.sin()],
            )
        })
        .collect();
    let owned: Vec<(&str, [f32; 3])> = rim
        .iter()
        .map(|(id, position)| (id.as_str(), *position))
        .collect();
    nodes.extend(owned);
    let graph = graph_with_positions(&nodes);

    let mut topology = ContourTopology::new();
    let outer = upright_panel(&mut topology, &graph, "panel", Some([0.0, 0.0]));
    let hole = line_loop(
        &mut topology,
        &graph,
        "rim",
        &["rim0", "rim1", "rim2", "rim3"],
    );
    let region_id = RegionId::new("panel").unwrap();
    topology
        .add_region(region_id.clone(), vec![outer], vec![hole])
        .unwrap();

    let mesh = mesh_of(&topology, &region_id, &positions_of(&graph));

    for point in &mesh.positions {
        let r = (point[0].powi(2) + point[2].powi(2)).sqrt();
        assert!((r - radius).abs() < 1e-2, "vertex left the cylinder: {point:?}");
    }
    for triangle in mesh.indices.chunks_exact(3) {
        let angles: Vec<f32> = triangle
            .iter()
            .map(|index| {
                let point = mesh.positions[*index as usize];
                point[2].atan2(point[0])
            })
            .collect();
        let mut span = (angles[0] - angles[1])
            .abs()
            .max((angles[1] - angles[2]).abs())
            .max((angles[2] - angles[0]).abs());
        // The panel ends on the -x axis, where `atan2` wraps.
        if span > std::f32::consts::PI {
            span = std::f32::consts::TAU - span;
        }
        assert!(span < 0.4, "triangle cut diagonally across cylinder: span = {span}");

        // What a diagonal chord actually looks like on screen: the facet
        // sinking inside the tower. It may not sink further than the
        // tolerance the outline itself is drawn to.
        let centroid = centroid_of(&mesh, triangle);
        let sunk = radius - (centroid[0].powi(2) + centroid[2].powi(2)).sqrt();
        assert!(
            sunk < ARC_TESSELLATION_TOLERANCE,
            "triangle sank into the tower by {sunk} m"
        );
    }
}
