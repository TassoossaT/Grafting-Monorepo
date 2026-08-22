//! Thin JSON boundary for the path-brush tool. All the actual work --
//! building the contour, planning what it destroys, applying that
//! destroy-and-rebuild -- lives in `grafting_procgen_surface_transformations`
//! (`compact_analytic_brush_contour`, `plan_region_merge`) and this crate's
//! own `region_merge` (`apply_region_merge`), neither of which knows
//! anything about "path." This module only parses wire data, supplies the
//! path-specific parameters (which source types are eligible, what type the
//! new region gets, how deep it carves), and translates the result back to
//! JSON.

use serde::{Deserialize, Serialize};

use std::collections::HashSet;

use grafting_graph_core::{ContourTopology, NodeId, RegionId, SurfaceRegistry, SurfaceType};
use grafting_procgen_surface_transformations::{
    BrushShape, PathBrushRequest, compact_analytic_brush_contour, plan_region_merge,
    validate_request,
};

use crate::editing::SessionGraph;
use crate::mesh::region_id_to_wire;
use crate::region_merge::{RegionMergeOutcome, apply_region_merge};

// `rename_all` on an internally-tagged enum (`tag = "kind"`) only renames
// the variant names themselves, not each variant's own field names --
// serde does not apply it recursively into struct-variant fields. Without
// the per-field `rename` below, this deserializer demanded literal
// `rotation_radians` while every real caller (`BrushShape` on the TS side,
// unchanged since it's a plain `rotationRadians: number` field) sends
// `rotationRadians` -- meaning every square or hexagon path-brush stroke
// failed to even parse.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum BrushShapeRequest {
    Circle {
        radius: f32,
    },
    Square {
        size: f32,
        #[serde(rename = "rotationRadians")]
        rotation_radians: f32,
    },
    Hexagon {
        radius: f32,
        #[serde(rename = "rotationRadians")]
        rotation_radians: f32,
    },
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

/// Plans and applies one path brush through the generic region-merge planner/applier.
pub fn apply_path_brush(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    topology: &mut ContourTopology,
    known_regions: &mut HashSet<RegionId>,
    request: ApplyPathBrushRequest,
) -> Result<ApplyPathBrushResponse, String> {
    let domain_request = domain_request(&request);
    let plan = plan_path_brush_region_merge(graph, surfaces, topology, &domain_request)?;
    let consumed = consumed_nodes(topology, &plan);
    let depth = domain_request.depth;
    let outcome = apply_region_merge(
        graph,
        surfaces,
        topology,
        known_regions,
        &domain_request.operation_id,
        domain_request.target_type.clone(),
        move |graph, point| nearest_source_height(graph, &consumed, point) - depth,
        plan,
    )?;
    Ok(response_from_outcome(outcome))
}

/// Path-brush's own contribution to the generic region-merge pipeline: its
/// scalar validation, the contour it draws, and which existing surface
/// types it's allowed to consume. Everything past this point (what gets
/// destroyed, what gets rebuilt) is the generic planner/applier's job, not
/// path-brush's own.
fn plan_path_brush_region_merge(
    graph: &grafting_graph_core::Graph<[f32; 3], ()>,
    surfaces: &SurfaceRegistry,
    topology: &ContourTopology,
    request: &PathBrushRequest,
) -> Result<grafting_procgen_surface_transformations::RegionMergePlan, String> {
    validate_request(request).map_err(|error| error.to_string())?;
    let contour = compact_analytic_brush_contour(request).map_err(|error| error.to_string())?;
    // A path stroke cuts whatever it geometrically covers -- terrain,
    // another path, or anything else -- so eligibility here is not a type
    // filter at all, unlike a tool that genuinely needs one.
    plan_region_merge(graph, surfaces, topology, contour, |_surface_type| true)
        .map_err(|error| error.to_string())
}

fn domain_request(request: &ApplyPathBrushRequest) -> PathBrushRequest {
    PathBrushRequest {
        operation_id: request.operation_id.clone(),
        samples: request.samples.clone(),
        shape: request.brush_shape.clone().into_domain(),
        depth: request.depth,
        source_types: request
            .source_surface_types
            .iter()
            .cloned()
            .map(SurfaceType::new)
            .collect(),
        target_type: SurfaceType::new(request.target_surface_type.clone()),
    }
}

fn response_from_outcome(outcome: RegionMergeOutcome) -> ApplyPathBrushResponse {
    let mut created_surfaces = Vec::new();
    if let Some(remainder) = &outcome.remainder_region {
        created_surfaces.push(region_id_to_wire(remainder));
    }
    created_surfaces.push(region_id_to_wire(&outcome.new_region));

    ApplyPathBrushResponse {
        node_ids: IdentityDeltaResponse {
            created: outcome
                .created_node_ids
                .iter()
                .map(ToString::to_string)
                .collect(),
            preserved: Vec::new(),
            replaced: Vec::new(),
            removed: outcome
                .removed_node_ids
                .iter()
                .map(ToString::to_string)
                .collect(),
        },
        edge_ids: IdentityDeltaResponse {
            created: outcome
                .created_edge_ids
                .iter()
                .map(ToString::to_string)
                .collect(),
            preserved: Vec::new(),
            replaced: Vec::new(),
            removed: outcome
                .removed_edge_ids
                .iter()
                .map(ToString::to_string)
                .collect(),
        },
        surface_ids: SurfaceIdentityDeltaResponse {
            created: created_surfaces,
            preserved: Vec::new(),
            replaced: Vec::new(),
            removed: outcome
                .consumed_region_ids
                .iter()
                .map(region_id_to_wire)
                .collect(),
        },
        invalidation: InvalidationResponse {
            changed_surfaces: Vec::new(),
            topology_repair_neighbors: Vec::new(),
            direct_dependencies: Vec::new(),
        },
    }
}

/// Path-brush's own height rule: each new node sits `depth` below whatever
/// consumed region's own node happens to be nearest it -- a generic region
/// merge has no opinion of its own about height, this is exactly the kind
/// of thing `apply_region_merge`'s `height_for` parameter exists for.
/// Every node on the boundary of a region this stroke is about to destroy,
/// collected *before* the merge removes them -- the ground the new surface
/// has to sit under.
fn consumed_nodes(
    topology: &ContourTopology,
    plan: &grafting_procgen_surface_transformations::RegionMergePlan,
) -> Vec<NodeId> {
    plan.consumed_region_ids()
        .iter()
        .filter_map(|id| topology.region_nodes(id).ok())
        .flatten()
        .collect()
}

fn nearest_source_height(graph: &SessionGraph, nodes: &[NodeId], point: [f32; 2]) -> f32 {
    nodes
        .iter()
        .filter_map(|id| graph.node(id).map(|node| *node.data()))
        .min_by(|left, right| {
            let left_distance = (left[0] - point[0]).powi(2) + (left[2] - point[1]).powi(2);
            let right_distance = (right[0] - point[0]).powi(2) + (right[2] - point[1]).powi(2);
            left_distance.total_cmp(&right_distance)
        })
        .map_or(0.0, |position| position[1])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The wire format every real caller sends (`BrushShape` on the TS
    /// side never changed) is camelCase throughout, including
    /// `rotationRadians` -- this must deserialize, not demand the Rust
    /// field's own snake_case spelling.
    #[test]
    fn square_and_hexagon_shapes_parse_camel_case_rotation_from_the_wire() {
        let square: BrushShapeRequest =
            serde_json::from_str(r#"{"kind":"square","size":1.0,"rotationRadians":0.2}"#)
                .expect("camelCase rotationRadians must parse for a square brush");
        assert!(matches!(
            square,
            BrushShapeRequest::Square { rotation_radians, .. } if rotation_radians == 0.2
        ));

        let hexagon: BrushShapeRequest =
            serde_json::from_str(r#"{"kind":"hexagon","radius":1.0,"rotationRadians":0.3}"#)
                .expect("camelCase rotationRadians must parse for a hexagon brush");
        assert!(matches!(
            hexagon,
            BrushShapeRequest::Hexagon { rotation_radians, .. } if rotation_radians == 0.3
        ));
    }
}
