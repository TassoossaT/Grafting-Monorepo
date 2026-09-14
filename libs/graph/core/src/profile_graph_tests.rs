use crate::profile_surface::{SheetProfile, resolve_region_sheet};
use crate::*;

#[test]
fn profile_uses_live_nodes_and_survives_duplication() {
    let mut graph: Graph<[f32; 3], ()> = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
    let ids: Vec<_> = ["a", "b", "c", "d"].map(|s| NodeId::new(s).unwrap()).into();
    for (id, position) in ids
        .iter()
        .zip([[0., 1., 0.], [4., 1., 0.], [3., 3., 2.], [1., 3., 2.]])
    {
        graph.add_node(Node::new(id.clone(), position)).unwrap();
    }
    let mut topology = ContourTopology::new();
    let mut surfaces = SurfaceRegistry::new();
    let region = RegionId::new("sheet").unwrap();
    straight_cycle_region(&mut topology, &graph, region.clone(), &ids).unwrap();
    let profile = SheetProfile {
        start: 0.,
        middle: 1.,
        end: 0.,
    };
    topology.set_region_profile(&region, Some(profile)).unwrap();
    surfaces
        .add_region_surface(&topology, region.clone(), SurfaceType::new("cap"), true)
        .unwrap();
    let before = resolve_region_sheet(&topology, topology.region(&region).unwrap(), |id| {
        graph.node(id).map(|n| *n.data())
    })
    .unwrap()
    .point(0.5, 0.5)
    .unwrap();
    move_region(&mut graph, &topology, &region, |p| {
        p[0] += 2.;
        p[1] += 5.;
    })
    .unwrap();
    let after = resolve_region_sheet(&topology, topology.region(&region).unwrap(), |id| {
        graph.node(id).map(|n| *n.data())
    })
    .unwrap()
    .point(0.5, 0.5)
    .unwrap();
    assert_eq!(after, [before[0] + 2., before[1] + 5., before[2]]);
    duplicate_region(
        &mut graph,
        &mut topology,
        &mut surfaces,
        &region,
        DuplicateRegionSpec {
            suffix: ":copy",
            clone_payload: &|p| *p,
            surface_type: SurfaceType::new("cap"),
            physical: true,
        },
    )
    .unwrap();
    assert_eq!(
        topology
            .region(&RegionId::new("sheet:copy").unwrap())
            .unwrap()
            .profile(),
        Some(profile)
    );
    let count = graph.snapshot().nodes().len();
    let edge = topology.region(&region).unwrap().outer_loops()[0][0]
        .edge()
        .clone();
    assert!(
        insert_vertex(
            &mut graph,
            &mut topology,
            &edge,
            Node::new(NodeId::new("extra").unwrap(), [0.; 3]),
            [0., 0.],
            [1., 0.],
            [0.5, 0.],
            ContourEdgeId::new("first").unwrap(),
            ContourEdgeId::new("second").unwrap()
        )
        .is_err()
    );
    assert_eq!(graph.snapshot().nodes().len(), count);
    assert!(
        topology
            .edge(&ContourEdgeId::new("first").unwrap())
            .is_none()
    );
    let previous = topology.region(&region).unwrap().clone();
    assert!(
        topology
            .set_region_profile(
                &region,
                Some(SheetProfile {
                    start: 0.,
                    middle: f64::NAN,
                    end: 0.
                })
            )
            .is_err()
    );
    assert_eq!(topology.region(&region).unwrap(), &previous);
}

#[test]
fn platform_contour_is_not_silently_replaced_by_its_bounding_box() {
    use crate::profile_cap::{CapBase, resolve_cap_base};
    assert!(matches!(
        resolve_cap_base(CapBase::Contour {
            points: [[0., 0.], [4., 0.], [4., 2.], [0., 2.]],
            centers: [None; 4]
        })
        .unwrap(),
        CapBase::Rectangle { .. }
    ));
    assert!(
        resolve_cap_base(CapBase::Contour {
            points: [[0., 0.], [4., 0.], [3., 2.], [0., 2.]],
            centers: [None; 4]
        })
        .is_err()
    );
    assert!(
        resolve_cap_base(CapBase::Contour {
            points: [[0., 0.], [4., 2.], [4., 0.], [0., 2.]],
            centers: [None; 4]
        })
        .is_err()
    );
    assert!(matches!(
        resolve_cap_base(CapBase::Contour {
            points: [[2., 0.], [0., 2.], [-2., 0.], [0., -2.]],
            centers: [Some([0., 0.]); 4]
        })
        .unwrap(),
        CapBase::Circle { .. }
    ));
}

#[test]
fn cap_preview_follows_curved_profiles_without_adding_graph_nodes() {
    use crate::profile_cap::CapBase;
    use crate::profile_cap_patch::{CapRequest, generate_cap_patch};
    let request = CapRequest {
        base: CapBase::Circle {
            center: [0., 0.],
            radius: 2.,
        },
        elevation: 3.,
        height: 4.,
        overhang: 0.,
        curvatures: [1.; 4],
    };
    let cap = generate_cap_patch(request.clone()).unwrap();
    assert_eq!(cap.nodes.len(), 5);
    assert_eq!(cap.faces.len(), 4);
    assert_eq!(cap.preview.len(), 4 * 3 * 32);
    let eave = cap.preview[3 * 15];
    assert!((eave[0].hypot(eave[2]) - 2.).abs() < 1e-12);
    let middle = cap.preview[3 * 16 + 2];
    assert!((middle[1] - 6.).abs() < 1e-12);
    assert!(
        generate_cap_patch(CapRequest {
            elevation: 1e10,
            height: 1.,
            ..request
        })
        .is_err()
    );
}
