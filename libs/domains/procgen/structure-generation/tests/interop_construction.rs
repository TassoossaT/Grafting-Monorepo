//! Proves this crate's generated output is a real, valid operand for
//! `grafting-graph-core`'s atomic `region_edit` vocabulary, mirroring
//! `grafting-procgen-terrain-generation`'s own interop tests.
//!
//! These used to exercise `ADR-0022`'s five node-set operations. Those are
//! retired: every surface a generator emits is registered as an analytic
//! `SurfaceRegion`, and the node-set operations had no way to see one --
//! see `docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.

use grafting_graph_core::{
    ContourEdgeId, ContourTopology, Graph, Node, NodeId, RegionId, SurfaceRegistry, SurfaceType,
    delete_region, insert_vertex, move_vertex, remove_vertex, straight_cycle_region,
};
use grafting_procgen_structure_generation::{
    EdgeCurvature, EdgeNotch, PathEdge, StructurePiece, extrude_path,
};

type SessionGraph = Graph<[f32; 3], ()>;

/// Registers one generated piece the way the live session does: graph
/// records first, then an analytic region over its own cycle, then the
/// region's semantic surface.
fn apply(
    graph: &mut SessionGraph,
    topology: &mut ContourTopology,
    surfaces: &mut SurfaceRegistry,
    region_id: &str,
    piece: StructurePiece,
) -> RegionId {
    for node in piece.nodes {
        if graph.node(node.id()).is_none() {
            graph.add_node(node).unwrap();
        }
    }
    for edge in piece.edges {
        if graph.edge(edge.id()).is_none() {
            graph.add_edge(edge).unwrap();
        }
    }
    let id = RegionId::new(region_id).unwrap();
    straight_cycle_region(topology, graph, id.clone(), &piece.surface.cycle).unwrap();
    surfaces
        .add_region_surface(
            topology,
            id.clone(),
            piece.surface.surface_type,
            piece.surface.physical,
        )
        .unwrap();
    id
}

fn wall_edge() -> [PathEdge; 1] {
    [PathEdge {
        start: [0.0, 0.0, 0.0],
        end: [4.0, 0.0, 0.0],
        curvature: EdgeCurvature::Straight,
    }]
}

fn session() -> (SessionGraph, ContourTopology, SurfaceRegistry) {
    (
        Graph::try_from_parts(vec![], vec![]).unwrap(),
        ContourTopology::new(),
        SurfaceRegistry::new(),
    )
}

#[test]
fn moving_a_shared_jamb_node_reports_both_sibling_regions_affected() {
    let notch = EdgeNotch {
        starts_at: 0.25,
        ends_at: 0.75,
        surface_type: SurfaceType::new("door"),
    };
    let pieces = extrude_path(
        &wall_edge(),
        3.0,
        Some(&notch),
        "interop-2",
        SurfaceType::new("wall"),
    )
    .unwrap();
    assert_eq!(pieces.len(), 3);

    let jamb = pieces[0].nodes[1].id().clone();

    let (mut graph, mut topology, mut surfaces) = session();
    let mut regions = Vec::new();
    for (index, piece) in pieces.into_iter().enumerate() {
        regions.push(apply(
            &mut graph,
            &mut topology,
            &mut surfaces,
            &format!("interop-2-{index}"),
            piece,
        ));
    }

    let outcome = move_vertex(&mut graph, &topology, &jamb, |position| position[1] += 0.1).unwrap();
    assert_eq!(outcome.affected_regions.len(), 2);
    assert!(outcome.affected_regions.contains(&regions[0]));
    assert!(outcome.affected_regions.contains(&regions[1]));
}

/// A door opening is a notch this crate already emits as its own piece. The
/// interesting interop property is that subdividing the wall remainder's own
/// boundary -- and welding it back -- leaves the generated geometry exactly
/// as it was, with nothing orphaned in between.
#[test]
fn a_generated_wall_panel_survives_an_insert_and_weld_round_trip() {
    let pieces = extrude_path(&wall_edge(), 3.0, None, "interop-1", SurfaceType::new("wall")).unwrap();
    assert_eq!(pieces.len(), 1);

    let (mut graph, mut topology, mut surfaces) = session();
    let region = apply(
        &mut graph,
        &mut topology,
        &mut surfaces,
        "interop-1-0",
        pieces.into_iter().next().unwrap(),
    );
    let original_loop = topology.region(&region).unwrap().outer_loops()[0].len();
    let first_edge = topology.region(&region).unwrap().outer_loops()[0][0]
        .edge()
        .clone();

    insert_vertex(
        &mut graph,
        &mut topology,
        &first_edge,
        Node::new(NodeId::new("interop-1:mid").unwrap(), [2.0, 0.0, 0.0]),
        ContourEdgeId::new("interop-1:mid-a").unwrap(),
        ContourEdgeId::new("interop-1:mid-b").unwrap(),
    )
    .unwrap();
    assert_eq!(
        topology.region(&region).unwrap().outer_loops()[0].len(),
        original_loop + 1
    );

    let outcome = remove_vertex(
        &mut graph,
        &mut topology,
        &NodeId::new("interop-1:mid").unwrap(),
        ContourEdgeId::new("interop-1:welded").unwrap(),
    )
    .unwrap();

    assert_eq!(
        topology.region(&region).unwrap().outer_loops()[0].len(),
        original_loop
    );
    assert_eq!(
        outcome.removed_nodes,
        vec![NodeId::new("interop-1:mid").unwrap()]
    );
    assert!(graph.node(&NodeId::new("interop-1:mid").unwrap()).is_none());
}

#[test]
fn deleting_a_generated_panel_reclaims_every_node_it_alone_owned() {
    let pieces = extrude_path(&wall_edge(), 3.0, None, "interop-3", SurfaceType::new("wall")).unwrap();
    assert_eq!(pieces.len(), 1);

    let (mut graph, mut topology, mut surfaces) = session();
    let region = apply(
        &mut graph,
        &mut topology,
        &mut surfaces,
        "interop-3-0",
        pieces.into_iter().next().unwrap(),
    );

    let outcome = delete_region(&mut graph, &mut topology, &mut surfaces, &region).unwrap();

    assert_eq!(outcome.removed_regions, vec![region.clone()]);
    assert_eq!(outcome.removed_nodes.len(), 4, "one wall panel is 4 corners");
    assert_eq!(graph.node_count(), 0);
    assert!(surfaces.region_surface(&region).is_none());
}
