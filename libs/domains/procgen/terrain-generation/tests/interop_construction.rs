//! Proves this crate's generated output is a real, valid operand for
//! `grafting-graph-core`'s atomic `region_edit` vocabulary, mirroring
//! `grafting-procgen-structure-generation`'s own interop tests.

use grafting_graph_core::{
    ContourTopology, Edge, EdgeId, Graph, Node, NodeId, RegionId, SurfaceRegistry, SurfaceType,
    delete_region, move_vertex, straight_cycle_region,
};
use grafting_procgen_terrain_generation::{
    CornerHeightModule, TerrainCellGeneration, generate_terrain_cell_surface,
};

type SessionGraph = Graph<[f32; 3], ()>;

/// Registers one generated terrain cell the way a session does: graph records
/// first, then an analytic region over its own cycle, then the region's semantic surface.
fn apply(
    graph: &mut SessionGraph,
    topology: &mut ContourTopology,
    surfaces: &mut SurfaceRegistry,
    region_id: &str,
    generation: TerrainCellGeneration,
) -> RegionId {
    for node in generation.nodes {
        if graph.node(node.id()).is_none() {
            graph.add_node(node).unwrap();
        }
    }
    for edge in generation.edges {
        if graph.edge(edge.id()).is_none() {
            graph.add_edge(edge).unwrap();
        }
    }
    let id = RegionId::new(region_id).unwrap();
    straight_cycle_region(topology, graph, id.clone(), &generation.surface.cycle).unwrap();
    surfaces
        .add_region_surface(
            topology,
            id.clone(),
            generation.surface.surface_type,
            generation.surface.physical,
        )
        .unwrap();
    id
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

fn session() -> (SessionGraph, ContourTopology, SurfaceRegistry) {
    (
        Graph::try_from_parts(vec![], vec![]).unwrap(),
        ContourTopology::new(),
        SurfaceRegistry::new(),
    )
}

#[test]
fn a_generated_surface_is_reported_affected_by_move_vertex() {
    let mesh = mesh();
    let module = flat();
    let generation = generate_terrain_cell_surface(
        &mesh,
        0,
        &module,
        |slot| cell_node_id(0, slot),
        |slot| cell_edge_id(0, slot),
        SurfaceType::new("terrain"),
    )
    .unwrap();
    let moved_node = generation.nodes[0].id().clone();

    let (mut graph, mut topology, mut surfaces) = session();
    let region = apply(&mut graph, &mut topology, &mut surfaces, "cell-0", generation);

    let outcome = move_vertex(&mut graph, &topology, &moved_node, |position| position[2] += 1.0).unwrap();
    assert_eq!(outcome.affected_regions, vec![region]);
}

#[test]
fn two_adjacent_cells_sharing_a_node_id_are_both_affected_by_move_vertex() {
    let mesh = mesh();
    let module = flat();

    let shared_id = |cell: usize, slot: usize| -> NodeId {
        match (cell, slot) {
            (0, 1) => NodeId::new("shared-0").unwrap(),
            (0, 2) => NodeId::new("shared-1").unwrap(),
            (1, 0) => NodeId::new("shared-0").unwrap(),
            (1, 3) => NodeId::new("shared-1").unwrap(),
            _ => cell_node_id(cell, slot),
        }
    };

    let generation0 = generate_terrain_cell_surface(
        &mesh,
        0,
        &module,
        |slot| shared_id(0, slot),
        |slot| cell_edge_id(0, slot),
        SurfaceType::new("terrain"),
    )
    .unwrap();
    let generation1 = generate_terrain_cell_surface(
        &mesh,
        1,
        &module,
        |slot| shared_id(1, slot),
        |slot| cell_edge_id(1, slot),
        SurfaceType::new("terrain"),
    )
    .unwrap();

    let (mut graph, mut topology, mut surfaces) = session();
    let region0 = apply(&mut graph, &mut topology, &mut surfaces, "cell-0", generation0);
    let region1 = apply(&mut graph, &mut topology, &mut surfaces, "cell-1", generation1);

    let shared = NodeId::new("shared-0").unwrap();
    let outcome = move_vertex(&mut graph, &topology, &shared, |position| position[2] += 0.5).unwrap();

    assert_eq!(outcome.affected_regions.len(), 2);
    assert!(outcome.affected_regions.contains(&region0));
    assert!(outcome.affected_regions.contains(&region1));
}

#[test]
fn deleting_a_generated_terrain_region_cleans_up_unshared_nodes() {
    let mesh = mesh();
    let module = flat();
    let generation = generate_terrain_cell_surface(
        &mesh,
        0,
        &module,
        |slot| cell_node_id(0, slot),
        |slot| cell_edge_id(0, slot),
        SurfaceType::new("terrain"),
    )
    .unwrap();

    let (mut graph, mut topology, mut surfaces) = session();
    let region = apply(&mut graph, &mut topology, &mut surfaces, "cell-0", generation);

    let outcome = delete_region(&mut graph, &mut topology, &mut surfaces, &region).unwrap();
    assert_eq!(outcome.removed_regions, vec![region.clone()]);
    assert_eq!(outcome.removed_nodes.len(), 4);
    assert_eq!(graph.node_count(), 0);
    assert!(surfaces.region_surface(&region).is_none());
}
