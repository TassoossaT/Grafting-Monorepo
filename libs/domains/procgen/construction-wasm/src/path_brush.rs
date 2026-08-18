//! Thin JSON boundary for the Phase-B terrain-to-path transformer.
//!
//! Geometry, topology planning, and atomic graph mutation stay in the Rust
//! domain capability and graph core. This module only parses wire data,
//! forwards it, and translates the resulting identity delta back to JSON.

use serde::{Deserialize, Serialize};

use grafting_graph_core::{
    EdgeId, NodeId, SurfaceKey, SurfaceRegistry, SurfaceType, apply_surface_replacement_plan,
};
use grafting_procgen_surface_transformations::{
    BrushShape, PathBrushRequest, plan_path_brush, swept_brush_contains,
};

use crate::dto::surface_key_to_wire;
use crate::editing::SessionGraph;
use crate::mesh::{self, SurfaceMeshDto};

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum BrushShapeRequest {
    Circle { radius: f32 },
    Square { size: f32, rotation_radians: f32 },
    Hexagon { radius: f32, rotation_radians: f32 },
}

impl BrushShapeRequest {
    fn into_domain(self) -> BrushShape {
        match self {
            Self::Circle { radius } => BrushShape::Circle { radius },
            Self::Square {
                size,
                rotation_radians,
            } => BrushShape::Square {
                size,
                rotation_radians,
            },
            Self::Hexagon {
                radius,
                rotation_radians,
            } => BrushShape::Hexagon {
                radius,
                rotation_radians,
            },
        }
    }
}
/// JSON request accepted by `ConstructionSession.apply_path_brush_json`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPathBrushRequest {
    pub(crate) operation_id: String,
    samples: Vec<[f32; 2]>,
    brush_shape: BrushShapeRequest,
    depth: f32,
    source_surface_types: Vec<String>,
    target_surface_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveBrushCellsRequest {
    samples: Vec<[f32; 2]>,
    brush_shape: BrushShapeRequest,
    width: usize,
    height: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveBrushCellsResponse {
    cells: Vec<usize>,
}

/// Resolves grid cells through the same authoritative swept footprint as path clipping.
pub fn resolve_brush_cells(
    request: ResolveBrushCellsRequest,
) -> Result<ResolveBrushCellsResponse, String> {
    if request.samples.is_empty() || request.width == 0 || request.height == 0 {
        return Err("brush cell resolution requires samples and positive grid dimensions".into());
    }
    let shape = request.brush_shape.into_domain();
    let mut cells = Vec::new();
    for z in 0..request.height {
        for x in 0..request.width {
            if swept_brush_contains(&shape, &request.samples, [x as f32 + 0.5, z as f32 + 0.5]) {
                cells.push(z * request.width + x);
            }
        }
    }
    Ok(ResolveBrushCellsResponse { cells })
}
/// Wire-ready identity lifecycle delta.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityDeltaResponse {
    created: Vec<String>,
    preserved: Vec<String>,
    replaced: Vec<String>,
    removed: Vec<String>,
}

/// Wire-ready surface identity lifecycle delta.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceIdentityDeltaResponse {
    created: Vec<Vec<String>>,
    preserved: Vec<Vec<String>>,
    replaced: Vec<Vec<String>>,
    removed: Vec<Vec<String>>,
}

/// Local derived-state refresh scope emitted by the transformer.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvalidationResponse {
    changed_surfaces: Vec<Vec<String>>,
    topology_repair_neighbors: Vec<Vec<String>>,
    direct_dependencies: Vec<Vec<String>>,
}

/// Response from one accepted terrain-to-path semantic operation.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPathBrushResponse {
    node_ids: IdentityDeltaResponse,
    edge_ids: IdentityDeltaResponse,
    surface_ids: SurfaceIdentityDeltaResponse,
    invalidation: InvalidationResponse,
}

/// Plans and applies one path brush through the generic atomic executor.
pub fn apply_path_brush(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    request: ApplyPathBrushRequest,
) -> Result<ApplyPathBrushResponse, String> {
    let plan = plan_path_brush(
        graph,
        surfaces,
        &PathBrushRequest {
            operation_id: request.operation_id,
            samples: request.samples,
            shape: request.brush_shape.into_domain(),
            depth: request.depth,
            source_types: request
                .source_surface_types
                .into_iter()
                .map(SurfaceType::new)
                .collect(),
            target_type: SurfaceType::new(request.target_surface_type),
        },
    )
    .map_err(|error| error.to_string())?;
    let response = response_for(&plan.transformation);
    apply_surface_replacement_plan(graph, surfaces, plan).map_err(|error| error.to_string())?;
    Ok(response)
}

/// Builds the exact target-surface preview on cloned state; confirmed state is untouched.
pub fn preview_path_brush(
    graph: &SessionGraph,
    surfaces: &SurfaceRegistry,
    request: ApplyPathBrushRequest,
) -> Result<Vec<SurfaceMeshDto>, String> {
    let target_type = request.target_surface_type.clone();
    let mut preview_graph = graph.clone();
    let mut preview_surfaces = surfaces.clone();
    let plan = plan_path_brush(
        &preview_graph,
        &preview_surfaces,
        &PathBrushRequest {
            operation_id: request.operation_id,
            samples: request.samples,
            shape: request.brush_shape.into_domain(),
            depth: request.depth,
            source_types: request
                .source_surface_types
                .into_iter()
                .map(SurfaceType::new)
                .collect(),
            target_type: SurfaceType::new(request.target_surface_type),
        },
    )
    .map_err(|error| error.to_string())?;
    let created = plan
        .transformation
        .surface_ids()
        .created()
        .iter()
        .cloned()
        .collect();
    apply_surface_replacement_plan(&mut preview_graph, &mut preview_surfaces, plan)
        .map_err(|error| error.to_string())?;
    Ok(
        mesh::all_surface_meshes(&preview_graph, &preview_surfaces, &created)
            .into_iter()
            .filter(|surface| surface.surface_type == target_type)
            .collect(),
    )
}
fn node_delta(delta: &grafting_graph_core::IdentityDelta<NodeId>) -> IdentityDeltaResponse {
    IdentityDeltaResponse {
        created: delta.created().iter().map(ToString::to_string).collect(),
        preserved: delta.preserved().iter().map(ToString::to_string).collect(),
        replaced: delta.replaced().iter().map(ToString::to_string).collect(),
        removed: delta.removed().iter().map(ToString::to_string).collect(),
    }
}

fn edge_delta(delta: &grafting_graph_core::IdentityDelta<EdgeId>) -> IdentityDeltaResponse {
    IdentityDeltaResponse {
        created: delta.created().iter().map(ToString::to_string).collect(),
        preserved: delta.preserved().iter().map(ToString::to_string).collect(),
        replaced: delta.replaced().iter().map(ToString::to_string).collect(),
        removed: delta.removed().iter().map(ToString::to_string).collect(),
    }
}

fn surface_delta(
    delta: &grafting_graph_core::IdentityDelta<SurfaceKey>,
) -> SurfaceIdentityDeltaResponse {
    SurfaceIdentityDeltaResponse {
        created: delta.created().iter().map(surface_key_to_wire).collect(),
        preserved: delta.preserved().iter().map(surface_key_to_wire).collect(),
        replaced: delta.replaced().iter().map(surface_key_to_wire).collect(),
        removed: delta.removed().iter().map(surface_key_to_wire).collect(),
    }
}

fn response_for(plan: &grafting_graph_core::TransformationPlan) -> ApplyPathBrushResponse {
    let invalidation = plan.invalidation();
    ApplyPathBrushResponse {
        node_ids: node_delta(plan.node_ids()),
        edge_ids: edge_delta(plan.edge_ids()),
        surface_ids: surface_delta(plan.surface_ids()),
        invalidation: InvalidationResponse {
            changed_surfaces: invalidation
                .changed_surfaces()
                .iter()
                .map(surface_key_to_wire)
                .collect(),
            topology_repair_neighbors: invalidation
                .topology_repair_neighbors()
                .iter()
                .map(surface_key_to_wire)
                .collect(),
            direct_dependencies: invalidation
                .direct_dependencies()
                .iter()
                .map(surface_key_to_wire)
                .collect(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terrain_cells_use_the_same_rotated_shape_and_continuous_sweep() {
        let resolved = resolve_brush_cells(ResolveBrushCellsRequest {
            samples: vec![[0.5, 0.5], [4.5, 0.5]],
            brush_shape: BrushShapeRequest::Square {
                size: 1.0,
                rotation_radians: 0.2,
            },
            width: 5,
            height: 2,
        })
        .unwrap();
        assert_eq!(resolved.cells, vec![0, 1, 2, 3, 4]);
    }
}
