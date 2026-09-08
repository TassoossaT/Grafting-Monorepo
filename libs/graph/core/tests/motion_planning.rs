use grafting_graph_core::{
    ContourTopology, Graph, MotionError, MotionInfluence, Node, NodeId, NodeMotion, PlanarBoolean,
    RequestedMotion, move_vertices, plan_motion, planar_boolean,
};
fn id(n: usize) -> NodeId {
    NodeId::new(format!("node-{n:05}")).unwrap()
}
fn graph(count: usize) -> Graph<[f32; 3], ()> {
    Graph::try_from_parts(
        (0..count)
            .map(|n| Node::new(id(n), [0.0, n as f32 * 3.0, 0.0]))
            .collect(),
        vec![],
    )
    .unwrap()
}
fn seed(n: usize, y: f32) -> RequestedMotion {
    RequestedMotion {
        node_id: id(n),
        delta: [0.0, y, 0.0],
    }
}
fn link(a: usize, b: usize) -> MotionInfluence {
    MotionInfluence {
        from: id(a),
        to: id(b),
        axes: [true, true, true],
    }
}

#[test]
fn converging_cycles_are_order_independent_and_visit_each_axis_once() {
    let graph = graph(4);
    let mut links = vec![link(0, 1), link(0, 2), link(1, 3), link(2, 3), link(3, 0)];
    let a = plan_motion(&graph, &[seed(0, 1.0)], &links).unwrap();
    links.reverse();
    let b = plan_motion(&graph, &[seed(0, 1.0)], &links).unwrap();
    assert_eq!(a.moves, b.moves);
    assert_eq!(a.resolved_axes, 4);
    assert_eq!(a.visited_influences, 5);
    assert_eq!(a.moves[3].position[1], 10.0);
}
#[test]
fn conflicts_fail_in_either_seed_order_and_nonfinite_values_are_rejected() {
    let graph = graph(2);
    let links = [link(0, 1), link(1, 0)];
    for seeds in [[seed(0, 1.0), seed(1, 2.0)], [seed(1, 2.0), seed(0, 1.0)]] {
        assert!(matches!(
            plan_motion(&graph, &seeds, &links),
            Err(MotionError::Conflict(_))
        ));
    }
    assert!(matches!(
        plan_motion(&graph, &[seed(0, f32::NAN)], &[]),
        Err(MotionError::NonFinite(_))
    ));
    assert!(matches!(
        plan_motion(&graph, &[seed(4, 1.0)], &[]),
        Err(MotionError::UnknownNode(_))
    ));
}
#[test]
fn validation_is_atomic_including_late_failure_and_duplicate_conflicts() {
    let mut graph = graph(2);
    let mut topology = ContourTopology::new();
    for invalid in [
        NodeMotion {
            node_id: id(8),
            position: [0.0; 3],
        },
        NodeMotion {
            node_id: id(1),
            position: [f32::INFINITY; 3],
        },
        NodeMotion {
            node_id: id(0),
            position: [5.0; 3],
        },
    ] {
        let moves = [
            NodeMotion {
                node_id: id(0),
                position: [1.0; 3],
            },
            invalid,
        ];
        assert!(move_vertices(&mut graph, &mut topology, &moves).is_err());
        assert_eq!(graph.node(&id(0)).unwrap().data(), &[0.0; 3]);
    }
}
#[test]
fn ten_thousand_nodes_with_converging_paths_have_linear_work_counts() {
    let graph = graph(10_000);
    let mut links = Vec::new();
    for n in 0..9999 {
        links.push(link(n, n + 1));
        if n + 2 < 10000 {
            links.push(link(n, n + 2));
        }
    }
    let plan = plan_motion(&graph, &[seed(0, 1.0)], &links).unwrap();
    assert_eq!(plan.moves.len(), 10000);
    assert_eq!(plan.resolved_axes, 10000);
    assert_eq!(plan.visited_influences, links.len());
}
#[test]
fn axis_masks_allow_generic_types_beyond_rigid_wall_responses() {
    let graph = graph(3);
    let links = [
        MotionInfluence {
            from: id(0),
            to: id(1),
            axes: [false, true, false],
        },
        link(1, 2),
    ];
    let plan = plan_motion(
        &graph,
        &[RequestedMotion {
            node_id: id(0),
            delta: [2.0, 1.0, 3.0],
        }],
        &links,
    )
    .unwrap();
    assert_eq!(plan.moves[0].position, [2.0, 1.0, 3.0]);
    assert_eq!(plan.moves[1].position, [0.0, 4.0, 0.0]);
    assert_eq!(plan.moves[2].position, [0.0, 7.0, 0.0]);
}
#[test]
fn planar_extension_retains_inner_structural_seams_and_cut_splits_components() {
    let square = vec![vec![[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0]]];
    let larger = vec![vec![[-1.0, -1.0], [5.0, -1.0], [5.0, 5.0], [-1.0, 5.0]]];
    let extension = planar_boolean(&[square.clone()], &[larger], PlanarBoolean::Extend).unwrap();
    assert_eq!(extension.len(), 2);
    assert_eq!(extension[0], square);
    assert_eq!(extension[1].len(), 2);
    let strip = vec![vec![[1.0, -1.0], [2.0, -1.0], [2.0, 5.0], [1.0, 5.0]]];
    let cut = planar_boolean(&[square], &[strip], PlanarBoolean::Difference).unwrap();
    assert_eq!(cut.len(), 2);
}

#[test]
fn rigid_batch_translates_arc_centers_and_undo_restores_them() {
    use grafting_graph_core::{ContourEdgeId, ContourGeometry, RegionId, straight_cycle_region};
    let mut graph: Graph<[f32; 3], ()> = Graph::try_from_parts(
        vec![
            Node::new(id(0), [1.0, 0.0, 0.0]),
            Node::new(id(1), [0.0, 0.0, 1.0]),
            Node::new(id(2), [0.0, 0.0, 0.0]),
        ],
        vec![],
    )
    .unwrap();
    let mut topology = ContourTopology::new();
    straight_cycle_region(
        &mut topology,
        &graph,
        RegionId::new("sector").unwrap(),
        &[id(0), id(1), id(2)],
    )
    .unwrap();
    let edge = ContourEdgeId::new("sector-0").unwrap();
    topology
        .set_edge_geometry(
            &edge,
            ContourGeometry::CircularArc {
                center: [0.0, 0.0],
                clockwise: false,
            },
        )
        .unwrap();
    let original: Vec<NodeMotion> = (0..3)
        .map(|n| NodeMotion {
            node_id: id(n),
            position: *graph.node(&id(n)).unwrap().data(),
        })
        .collect();
    let translated: Vec<NodeMotion> = original
        .iter()
        .map(|m| NodeMotion {
            node_id: m.node_id.clone(),
            position: [m.position[0] + 2.0, 1.0, m.position[2] + 4.0],
        })
        .collect();
    let outcome = move_vertices(&mut graph, &mut topology, &translated).unwrap();
    assert_eq!(outcome.affected_regions.len(), 1);
    assert_eq!(
        topology.edge(&edge).unwrap().geometry(),
        &ContourGeometry::CircularArc {
            center: [2.0, 4.0],
            clockwise: false
        }
    );
    move_vertices(&mut graph, &mut topology, &original).unwrap();
    assert_eq!(
        topology.edge(&edge).unwrap().geometry(),
        &ContourGeometry::CircularArc {
            center: [0.0, 0.0],
            clockwise: false
        }
    );
}
