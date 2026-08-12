//! Proves this crate's generated output is a real, valid operand for
//! `grafting-graph-core`'s `construction` operations -- the actual bar
//! `docs/architecture/vtt-roadmap.md`'s E3.3 sets ("feeding these
//! now-complete node operations rather than reinventing them"), not just
//! internal self-consistency.

use grafting_graph_core::{Edge, EdgeId, Graph, Node, NodeId, SurfaceRegistry, SurfaceType, merge_surfaces, move_node};
use grafting_procgen_terrain_generation::{CornerHeightModule, TerrainCellGeneration, generate_terrain_cell_surface};

/// First-time creation: the composition every generation crate leaves to
/// its caller (`grafting_graph_core::construction`'s 5 operations all
/// require pre-existing state, per that crate's own doc comments).
fn apply(
    graph: &mut Graph<[f32; 3], ()>,
    surfaces: &mut SurfaceRegistry,
    generation: TerrainCellGeneration,
) -> grafting_graph_core::SurfaceKey {
    for node in generation.nodes {
        graph.add_node(node).unwrap();
    }
    for edge in generation.edges {
        graph.add_edge(edge).unwrap();
    }
    surfaces
        .add_surface(graph, generation.surface.cycle, generation.surface.surface_type, generation.surface.physical)
        .unwrap()
}

fn mesh() -> grafting_graph_core::PrismGridMesh {
    grafting_graph_core::PrismGridMesh::new(2, 1, 1, grafting_graph_core::FormationInputs::default())
}

fn flat() -> CornerHeightModule {
    CornerHeightModule { name: "flat".into(), corner_heights: [1.0; 4] }
}

fn cell_node_id(cell: usize, slot: usize) -> NodeId {
    NodeId::new(format!("cell{cell}-{slot}")).unwrap()
}

fn cell_edge_id(cell: usize, slot: usize) -> EdgeId {
    EdgeId::new(format!("cell{cell}-e{slot}")).unwrap()
}

#[test]
fn a_generated_surface_is_reported_affected_by_move_node() {
    let mesh = mesh();
    let module = flat();
    let generation =
        generate_terrain_cell_surface(&mesh, 0, &module, |slot| cell_node_id(0, slot), |slot| cell_edge_id(0, slot), SurfaceType::new("terrain"))
            .unwrap();
    let moved_node = generation.nodes[0].id().clone();

    let mut graph = Graph::try_from_parts(vec![], vec![]).unwrap();
    let mut surfaces = SurfaceRegistry::new();
    let key = apply(&mut graph, &mut surfaces, generation);

    let affected = move_node(&mut graph, &surfaces, &moved_node, |position| position[2] += 1.0).unwrap();
    assert_eq!(affected, vec![key]);
}

#[test]
fn two_adjacent_cells_sharing_a_node_id_can_be_merged() {
    // A 2x1x1 mesh: cells 0 and 1 are adjacent along X, so cell 0's
    // East-side corners (slots 1, 2) share `PrismGridMesh` vertex indices
    // with cell 1's West-side corners (slots 0, 3). Mapping both to the
    // *same* NodeId at those slots is the seam-sharing case this test
    // exercises -- a caller opting into a seamless join.
    let mesh = mesh();
    let module = flat();

    let shared_id = |cell: usize, slot: usize| -> NodeId {
        // Cell 0 slots 1/2 and cell 1 slots 0/3 sit at the same physical
        // vertex column; give them one shared identity, everything else
        // its own per-cell identity.
        match (cell, slot) {
            (0, 1) => NodeId::new("shared-0").unwrap(),
            (0, 2) => NodeId::new("shared-1").unwrap(),
            (1, 0) => NodeId::new("shared-0").unwrap(),
            (1, 3) => NodeId::new("shared-1").unwrap(),
            _ => cell_node_id(cell, slot),
        }
    };

    let generation0 =
        generate_terrain_cell_surface(&mesh, 0, &module, |slot| shared_id(0, slot), |slot| cell_edge_id(0, slot), SurfaceType::new("terrain"))
            .unwrap();
    let generation1 =
        generate_terrain_cell_surface(&mesh, 1, &module, |slot| shared_id(1, slot), |slot| cell_edge_id(1, slot), SurfaceType::new("terrain"))
            .unwrap();

    let mut graph = Graph::try_from_parts(vec![], vec![]).unwrap();
    let mut surfaces = SurfaceRegistry::new();

    // Cell 0's nodes/edges include the two shared ids; cell 1 must not
    // re-add them.
    let cell0_nodes: Vec<Node<[f32; 3]>> = generation0.nodes;
    let cell0_edges: Vec<Edge<()>> = generation0.edges;
    for node in cell0_nodes {
        graph.add_node(node).unwrap();
    }
    for edge in cell0_edges {
        graph.add_edge(edge).unwrap();
    }
    let key0 = surfaces
        .add_surface(&graph, generation0.surface.cycle, generation0.surface.surface_type, generation0.surface.physical)
        .unwrap();

    for node in generation1.nodes {
        if graph.node(node.id()).is_none() {
            graph.add_node(node).unwrap();
        }
    }
    for edge in generation1.edges {
        if graph.edge(edge.id()).is_none() {
            graph.add_edge(edge).unwrap();
        }
    }
    let key1 = surfaces
        .add_surface(&graph, generation1.surface.cycle, generation1.surface.surface_type, generation1.surface.physical)
        .unwrap();

    let shared = NodeId::new("shared-0").unwrap();
    let referencing: Vec<_> = surfaces.surfaces_referencing(&shared).cloned().collect();
    assert!(referencing.contains(&key0));
    assert!(referencing.contains(&key1));

    let merged_cycle: Vec<NodeId> = vec![
        shared_id(0, 0),
        shared_id(0, 1),
        shared_id(1, 1),
        shared_id(1, 2),
        shared_id(1, 3),
        shared_id(0, 3),
    ];
    let merged = merge_surfaces(
        &graph,
        &mut surfaces,
        &key0,
        &key1,
        grafting_graph_core::SurfaceSpec { cycle: merged_cycle, surface_type: SurfaceType::new("terrain"), physical: true },
    )
    .unwrap();
    assert!(surfaces.surface(&merged).is_some());
    assert!(surfaces.surface(&key0).is_none());
    assert!(surfaces.surface(&key1).is_none());
}
