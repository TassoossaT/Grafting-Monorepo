//! Proves this crate's generated output is a real, valid operand for
//! `grafting-graph-core`'s `construction` operations, mirroring
//! `grafting-procgen-terrain-generation`'s own interop tests. The
//! `merge_surfaces` case here is literally `ADR-0022`'s own worked example
//! ("a door's nodes and an adjoining wall's nodes becoming one thing").

use grafting_graph_core::{Graph, SurfaceKey, SurfaceRegistry, SurfaceSpec, SurfaceType, delete_node, merge_surfaces, move_node};
use grafting_procgen_structure_generation::{DoorOpening, StructurePiece, WallSegment, generate_wall};

fn apply(graph: &mut Graph<[f32; 3], ()>, surfaces: &mut SurfaceRegistry, piece: StructurePiece) -> SurfaceKey {
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
    surfaces.add_surface(graph, piece.surface.cycle, piece.surface.surface_type, piece.surface.physical).unwrap()
}

fn wall() -> WallSegment {
    WallSegment { start: [0.0, 0.0, 0.0], end: [4.0, 0.0, 0.0], height: 3.0 }
}

#[test]
fn a_door_and_its_adjoining_wall_remainder_can_be_merged() {
    let door = DoorOpening { opens_at: 0.5, closes_at: 1.0 };
    let generation = generate_wall(&wall(), Some(&door), |role| grafting_graph_core::NodeId::new(format!("{role:?}")).unwrap(), |a, b| grafting_graph_core::EdgeId::new(format!("{a:?}-{b:?}")).unwrap(), SurfaceType::new("wall"), SurfaceType::new("door")).unwrap();
    assert_eq!(generation.pieces.len(), 2);

    let mut graph = Graph::try_from_parts(vec![], vec![]).unwrap();
    let mut surfaces = SurfaceRegistry::new();
    let mut pieces = generation.pieces.into_iter();
    let wall_key = apply(&mut graph, &mut surfaces, pieces.next().unwrap());
    let door_key = apply(&mut graph, &mut surfaces, pieces.next().unwrap());

    // ADR-0022's own worked Merge example: a door's nodes and an adjoining
    // wall's nodes becoming one thing.
    let merged_cycle = vec![
        grafting_graph_core::NodeId::new("StartBottom").unwrap(),
        grafting_graph_core::NodeId::new("DoorStartBottom").unwrap(),
        grafting_graph_core::NodeId::new("EndBottom").unwrap(),
        grafting_graph_core::NodeId::new("EndTop").unwrap(),
        grafting_graph_core::NodeId::new("DoorStartTop").unwrap(),
        grafting_graph_core::NodeId::new("StartTop").unwrap(),
    ];
    let merged = merge_surfaces(
        &graph,
        &mut surfaces,
        &wall_key,
        &door_key,
        SurfaceSpec { cycle: merged_cycle, surface_type: SurfaceType::new("wall"), physical: true },
    )
    .unwrap();

    assert!(surfaces.surface(&merged).is_some());
    assert!(surfaces.surface(&wall_key).is_none());
    assert!(surfaces.surface(&door_key).is_none());
}

#[test]
fn moving_a_shared_jamb_node_reports_both_sibling_surfaces_affected() {
    let door = DoorOpening { opens_at: 0.25, closes_at: 0.75 };
    let generation = generate_wall(&wall(), Some(&door), |role| grafting_graph_core::NodeId::new(format!("{role:?}")).unwrap(), |a, b| grafting_graph_core::EdgeId::new(format!("{a:?}-{b:?}")).unwrap(), SurfaceType::new("wall"), SurfaceType::new("door")).unwrap();
    assert_eq!(generation.pieces.len(), 3);

    let mut graph = Graph::try_from_parts(vec![], vec![]).unwrap();
    let mut surfaces = SurfaceRegistry::new();
    let mut keys = Vec::new();
    for piece in generation.pieces {
        keys.push(apply(&mut graph, &mut surfaces, piece));
    }

    let jamb = grafting_graph_core::NodeId::new("DoorStartBottom").unwrap();
    let affected = move_node(&mut graph, &surfaces, &jamb, |position| position[1] += 0.1).unwrap();
    assert_eq!(affected.len(), 2);
    assert!(affected.contains(&keys[0]));
    assert!(affected.contains(&keys[1]));
}

#[test]
fn deleting_a_non_shared_corner_leaves_an_accepted_hole() {
    let generation = generate_wall(&wall(), None, |role| grafting_graph_core::NodeId::new(format!("{role:?}")).unwrap(), |a, b| grafting_graph_core::EdgeId::new(format!("{a:?}-{b:?}")).unwrap(), SurfaceType::new("wall"), SurfaceType::new("door")).unwrap();
    assert_eq!(generation.pieces.len(), 1);

    let mut graph = Graph::try_from_parts(vec![], vec![]).unwrap();
    let mut surfaces = SurfaceRegistry::new();
    let key = apply(&mut graph, &mut surfaces, generation.pieces.into_iter().next().unwrap());

    let corner = grafting_graph_core::NodeId::new("StartBottom").unwrap();
    let outcome = delete_node(&mut graph, &mut surfaces, &corner, |_cycle| (SurfaceType::new("wall"), true)).unwrap();

    // The wall's own surface (which included the deleted corner) is gone;
    // `StartBottom`'s two graph neighbors (`EndBottom`, `StartTop`) are not
    // directly adjacent to each other, so the induced subgraph on them is
    // two isolated nodes, not a clean cycle -- no capping surface is
    // generated, an accepted hole rather than an error.
    assert_eq!(outcome.removed_surfaces, vec![key]);
    assert!(outcome.capping_surfaces.is_empty());
}
