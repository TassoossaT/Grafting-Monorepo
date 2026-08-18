//! Pure inner function for `generate_and_apply_terrain_cell`: calls
//! `grafting-procgen-terrain-generation`'s pure generator, then applies the
//! result to the session's own live `Graph`/`SurfaceRegistry` in one call,
//! pre-validating every new id is free first -- mirroring
//! `duplicate_surface`'s own atomicity, since no single
//! `grafting-graph-core` primitive already provides that for a
//! multi-node/multi-edge/multi-surface generation result.

use serde::Deserialize;

use grafting_graph_core::{EdgeId, NodeId, PrismGridMesh, SurfaceRegistry, SurfaceType};
use grafting_procgen_terrain_generation::{CornerHeightModule, generate_terrain_cell_surface};

use crate::dto::surface_key_to_wire;
use crate::editing::{SessionGraph, SurfaceKeyResponse};

const CORNER_COUNT: usize = 4;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CornerHeightModuleDto {
    pub name: String,
    pub corner_heights: Vec<f32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAndApplyTerrainCellRequest {
    pub cell: usize,
    pub module: CornerHeightModuleDto,
    pub surface_type: String,
    /// One id per corner slot, in `PrismGridMesh::cell_corners`' cyclic
    /// order -- explicit, not a scheme this crate invents.
    pub node_ids: Vec<String>,
    pub edge_ids: Vec<String>,
}

fn fixed_ids<T>(
    ids: Vec<String>,
    what: &str,
    parse: impl Fn(String) -> Result<T, String>,
) -> Result<Vec<T>, String> {
    if ids.len() != CORNER_COUNT {
        return Err(format!(
            "{what}: expected {CORNER_COUNT} ids, got {}",
            ids.len()
        ));
    }
    ids.into_iter().map(parse).collect()
}

/// Generates one terrain cell's surface and applies it to the session's
/// live state. Errors, leaving nothing added, if `mesh` is absent (caller
/// must call `set_terrain_mesh` first), the module doesn't have exactly 4
/// corner heights, or any supplied node/edge id already exists in `graph`.
pub fn generate_and_apply_terrain_cell(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    mesh: Option<&PrismGridMesh>,
    request: GenerateAndApplyTerrainCellRequest,
) -> Result<SurfaceKeyResponse, String> {
    let mesh =
        mesh.ok_or_else(|| "no terrain mesh set -- call set_terrain_mesh first".to_string())?;

    let corner_heights: [f32; CORNER_COUNT] = request
        .module
        .corner_heights
        .clone()
        .try_into()
        .map_err(|heights: Vec<f32>| {
            format!(
                "module.cornerHeights: expected {CORNER_COUNT} entries, got {}",
                heights.len()
            )
        })?;
    let module = CornerHeightModule {
        name: request.module.name,
        corner_heights,
    };

    let node_ids = fixed_ids(request.node_ids, "nodeIds", |id| {
        NodeId::new(id).map_err(|error| error.to_string())
    })?;
    let edge_ids = fixed_ids(request.edge_ids, "edgeIds", |id| {
        EdgeId::new(id).map_err(|error| error.to_string())
    })?;

    let generation = generate_terrain_cell_surface(
        mesh,
        request.cell,
        &module,
        |slot| node_ids[slot].clone(),
        |slot| edge_ids[slot].clone(),
        SurfaceType::new(request.surface_type),
    )
    .map_err(|error| error.to_string())?;

    // Validate before mutating anything, mirroring duplicate_surface's own
    // atomicity: a rejected call must leave nothing behind.
    for node in &generation.nodes {
        if graph.node(node.id()).is_some() {
            return Err(format!("node id already exists: {}", node.id()));
        }
    }
    for edge in &generation.edges {
        if graph.edge(edge.id()).is_some() {
            return Err(format!("edge id already exists: {}", edge.id()));
        }
    }

    for node in generation.nodes {
        graph.add_node(node).expect("checked above: id is free");
    }
    for edge in generation.edges {
        graph
            .add_edge(edge)
            .expect("checked above: id is free, endpoints were just added");
    }
    let key = surfaces
        .add_surface(
            graph,
            generation.surface.cycle,
            generation.surface.surface_type,
            generation.surface.physical,
        )
        .expect("pre-validated: nodes exist (just added)");

    Ok(SurfaceKeyResponse {
        surface_key: surface_key_to_wire(&key),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::{FormationInputs, Graph};

    fn empty_graph() -> SessionGraph {
        Graph::try_from_parts(Vec::new(), Vec::new()).unwrap()
    }

    fn flat_module() -> CornerHeightModuleDto {
        CornerHeightModuleDto {
            name: "flat".into(),
            corner_heights: vec![1.0, 1.0, 1.0, 1.0],
        }
    }

    fn ids(cell: usize) -> (Vec<String>, Vec<String>) {
        (
            (0..4).map(|slot| format!("cell{cell}-{slot}")).collect(),
            (0..4).map(|slot| format!("cell{cell}-e{slot}")).collect(),
        )
    }

    #[test]
    fn generates_and_applies_a_flat_cell() {
        let mesh = PrismGridMesh::new(2, 2, 1, FormationInputs::default());
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();
        let (node_ids, edge_ids) = ids(0);

        let response = generate_and_apply_terrain_cell(
            &mut graph,
            &mut surfaces,
            Some(&mesh),
            GenerateAndApplyTerrainCellRequest {
                cell: 0,
                module: flat_module(),
                surface_type: "terrain".into(),
                node_ids,
                edge_ids,
            },
        )
        .unwrap();

        assert_eq!(response.surface_key.len(), 4);
        assert_eq!(graph.node_count(), 4);
        assert_eq!(graph.edge_count(), 4);
    }

    #[test]
    fn errors_without_mutating_when_no_mesh_is_set() {
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();
        let (node_ids, edge_ids) = ids(0);

        let error = generate_and_apply_terrain_cell(
            &mut graph,
            &mut surfaces,
            None,
            GenerateAndApplyTerrainCellRequest {
                cell: 0,
                module: flat_module(),
                surface_type: "terrain".into(),
                node_ids,
                edge_ids,
            },
        )
        .unwrap_err();
        assert!(error.contains("set_terrain_mesh"));
        assert_eq!(graph.node_count(), 0);
    }

    #[test]
    fn errors_without_mutating_when_a_node_id_collides() {
        let mesh = PrismGridMesh::new(2, 2, 1, FormationInputs::default());
        let mut graph = empty_graph();
        graph
            .add_node(grafting_graph_core::Node::new(
                NodeId::new("cell0-2").unwrap(),
                [0.0; 3],
            ))
            .unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let (node_ids, edge_ids) = ids(0);

        let error = generate_and_apply_terrain_cell(
            &mut graph,
            &mut surfaces,
            Some(&mesh),
            GenerateAndApplyTerrainCellRequest {
                cell: 0,
                module: flat_module(),
                surface_type: "terrain".into(),
                node_ids,
                edge_ids,
            },
        )
        .unwrap_err();
        assert!(error.contains("cell0-2"));
        // Nothing else was added -- the collision was caught before any commit.
        assert_eq!(graph.node_count(), 1);
        assert_eq!(graph.edge_count(), 0);
        assert!(
            surfaces
                .surfaces_referencing(&NodeId::new("cell0-0").unwrap())
                .next()
                .is_none()
        );
    }

    #[test]
    fn errors_on_a_module_with_the_wrong_corner_count() {
        let mesh = PrismGridMesh::new(2, 2, 1, FormationInputs::default());
        let mut graph = empty_graph();
        let mut surfaces = SurfaceRegistry::new();
        let (node_ids, edge_ids) = ids(0);
        let bad_module = CornerHeightModuleDto {
            name: "bad".into(),
            corner_heights: vec![1.0, 1.0],
        };

        let error = generate_and_apply_terrain_cell(
            &mut graph,
            &mut surfaces,
            Some(&mesh),
            GenerateAndApplyTerrainCellRequest {
                cell: 0,
                module: bad_module,
                surface_type: "terrain".into(),
                node_ids,
                edge_ids,
            },
        )
        .unwrap_err();
        assert!(error.contains("cornerHeights"));
    }
}
