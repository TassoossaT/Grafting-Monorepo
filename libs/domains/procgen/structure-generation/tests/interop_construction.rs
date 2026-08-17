//! Proves this crate's generated output is a real, valid operand for
//! `grafting-graph-core`'s `construction` operations, mirroring
//! `grafting-procgen-terrain-generation`'s own interop tests. The
//! `merge_surfaces` case here is literally `ADR-0022`'s own worked example
//! ("a door's nodes and an adjoining wall's nodes becoming one thing").

use grafting_graph_core::{Graph, SurfaceKey, SurfaceRegistry, SurfaceSpec, SurfaceType, delete_node, merge_surfaces, move_node};
use grafting_procgen_structure_generation::{EdgeCurvature, EdgeNotch, PathEdge, StructurePiece, extrude_path};

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

fn wall_edge() -> [PathEdge; 1] {
    [PathEdge { start: [0.0, 0.0, 0.0], end: [4.0, 0.0, 0.0], curvature: EdgeCurvature::Straight }]
}

#[test]
fn a_door_and_its_adjoining_wall_remainder_can_be_merged() {
    let notch = EdgeNotch { starts_at: 0.5, ends_at: 1.0, surface_type: SurfaceType::new("door") };
    let pieces = extrude_path(&wall_edge(), 3.0, Some(&notch), 8, "interop-1", SurfaceType::new("wall")).unwrap();
    assert_eq!(pieces.len(), 2);

    let mut graph = Graph::try_from_parts(vec![], vec![]).unwrap();
    let mut surfaces = SurfaceRegistry::new();
    let mut pieces = pieces.into_iter();
    let wall_piece = pieces.next().unwrap();
    let door_piece = pieces.next().unwrap();

    // ADR-0022's own worked Merge example: a door's nodes and an adjoining
    // wall's nodes becoming one thing. The shared jamb (wall's nodes[1]/[2]
    // == door's nodes[0]/[3]) collapses into the outer hexagon boundary.
    let merged_cycle = vec![
        wall_piece.nodes[0].id().clone(),
        wall_piece.nodes[1].id().clone(),
        door_piece.nodes[1].id().clone(),
        door_piece.nodes[2].id().clone(),
        wall_piece.nodes[2].id().clone(),
        wall_piece.nodes[3].id().clone(),
    ];

    let wall_key = apply(&mut graph, &mut surfaces, wall_piece);
    let door_key = apply(&mut graph, &mut surfaces, door_piece);

    let merged = merge_surfaces(
        &graph,
        &mut surfaces,
        &wall_key,
        &door_key,
        SurfaceSpec { cycle: merged_cycle, surface_type: SurfaceType::new("wall"), physical: true, curvature: None },
    )
    .unwrap();

    assert!(surfaces.surface(&merged).is_some());
    assert!(surfaces.surface(&wall_key).is_none());
    assert!(surfaces.surface(&door_key).is_none());
}

#[test]
fn moving_a_shared_jamb_node_reports_both_sibling_surfaces_affected() {
    let notch = EdgeNotch { starts_at: 0.25, ends_at: 0.75, surface_type: SurfaceType::new("door") };
    let pieces = extrude_path(&wall_edge(), 3.0, Some(&notch), 8, "interop-2", SurfaceType::new("wall")).unwrap();
    assert_eq!(pieces.len(), 3);

    let jamb = pieces[0].nodes[1].id().clone();

    let mut graph = Graph::try_from_parts(vec![], vec![]).unwrap();
    let mut surfaces = SurfaceRegistry::new();
    let mut keys = Vec::new();
    for piece in pieces {
        keys.push(apply(&mut graph, &mut surfaces, piece));
    }

    let affected = move_node(&mut graph, &surfaces, &jamb, |position| position[1] += 0.1).unwrap();
    assert_eq!(affected.len(), 2);
    assert!(affected.contains(&keys[0]));
    assert!(affected.contains(&keys[1]));
}

#[test]
fn deleting_a_non_shared_corner_leaves_an_accepted_hole() {
    let pieces = extrude_path(&wall_edge(), 3.0, None, 8, "interop-3", SurfaceType::new("wall")).unwrap();
    assert_eq!(pieces.len(), 1);

    let corner = pieces[0].nodes[0].id().clone();

    let mut graph = Graph::try_from_parts(vec![], vec![]).unwrap();
    let mut surfaces = SurfaceRegistry::new();
    let key = apply(&mut graph, &mut surfaces, pieces.into_iter().next().unwrap());

    let outcome = delete_node(&mut graph, &mut surfaces, &corner, |_cycle| (SurfaceType::new("wall"), true)).unwrap();

    // The wall's own surface (which included the deleted corner) is gone;
    // the corner's two graph neighbors are not directly adjacent to each
    // other, so the induced subgraph on them is two isolated nodes, not a
    // clean cycle -- no capping surface is generated, an accepted hole
    // rather than an error.
    assert_eq!(outcome.removed_surfaces, vec![key]);
    assert!(outcome.capping_surfaces.is_empty());
}
