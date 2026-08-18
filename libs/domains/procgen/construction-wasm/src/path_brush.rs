//! Thin JSON boundary for the Phase-B terrain-to-path transformer.
//!
//! Geometry, topology planning, and atomic graph mutation stay in the Rust
//! domain capability and graph core. This module only parses wire data,
//! forwards it, and translates the resulting identity delta back to JSON.

use serde::{Deserialize, Serialize};

use grafting_graph_core::{
    EdgeId, NodeId, SurfaceKey, SurfaceRegistry, SurfaceType, apply_surface_replacement_plan,
};
use grafting_procgen_surface_transformations::{PathBrushRequest, plan_path_brush};

use crate::dto::surface_key_to_wire;
use crate::editing::SessionGraph;

/// JSON request accepted by `ConstructionSession.apply_path_brush_json`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPathBrushRequest {
    operation_id: String,
    center: [f32; 2],
    radius: f32,
    depth: f32,
    source_surface_type: String,
    target_surface_type: String,
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
            center: request.center,
            radius: request.radius,
            depth: request.depth,
            source_type: SurfaceType::new(request.source_surface_type),
            target_type: SurfaceType::new(request.target_surface_type),
        },
    )
    .map_err(|error| error.to_string())?;
    let response = response_for(&plan.transformation);
    apply_surface_replacement_plan(graph, surfaces, plan).map_err(|error| error.to_string())?;
    Ok(response)
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
