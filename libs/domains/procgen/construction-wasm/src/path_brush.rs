//! Thin JSON boundary for the path-brush tool. All the actual work --
//! building the contour, planning what it destroys, applying that
//! destroy-and-rebuild -- lives in `grafting_procgen_surface_transformations`
//! (`compact_analytic_brush_contour`, `plan_region_merge`) and this crate's
//! own `region_merge` (`apply_region_merge`), neither of which knows
//! anything about "path." This module only parses wire data, supplies the
//! path-specific parameters (which source types are eligible and what type
//! the new region gets), and translates the result back to JSON.

use serde::{Deserialize, Serialize};

use std::collections::{HashMap, HashSet};

use grafting_graph_core::{ContourTopology, RegionId, SurfaceRegistry, SurfaceType};
use grafting_procgen_surface_transformations::{
    BrushShape, PathBrushRequest, SweepFormationPlan, SweepFormationRequest,
    TransverseProfilePoint, compact_analytic_brush_contour, plan_region_merge,
    plan_sweep_formation, polygonal_contour, validate_request,
};

use crate::editing::SessionGraph;
use crate::mesh::{region_id_from_wire, region_id_to_wire};
use crate::region_editing::{
    AddPatchRequest, OrientedEdgeUseDto, PatchEdgeDto, PatchNodeDto, PatchRegionDto,
    apply_add_patch,
};
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
    #[serde(default)]
    formation: Option<PathFormationRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathFormationRequest {
    profile: Vec<PathProfilePointRequest>,
    max_segment_length: f32,
    miter_limit: f32,
}

/// Pure geometry request used by the TypeScript orchestrator to classify the
/// exact area that the eventual sweep will occupy before it chooses edits.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathFormationOutlineRequest {
    samples: Vec<[f32; 2]>,
    formation: PathFormationRequest,
}

/// Exact XZ rim of a planned formation, in contour order.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathFormationOutlineResponse {
    outline: Vec<[f32; 2]>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathProfilePointRequest {
    lateral_offset: f32,
    elevation: f32,
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
    let mut next_graph = graph.clone();
    let mut next_surfaces = surfaces.clone();
    let mut next_topology = topology.clone();
    let mut next_known_regions = known_regions.clone();
    let response = apply_path_brush_inner(
        &mut next_graph,
        &mut next_surfaces,
        &mut next_topology,
        &mut next_known_regions,
        request,
    )?;
    *graph = next_graph;
    *surfaces = next_surfaces;
    *topology = next_topology;
    *known_regions = next_known_regions;
    Ok(response)
}

fn apply_path_brush_inner(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    topology: &mut ContourTopology,
    known_regions: &mut HashSet<RegionId>,
    request: ApplyPathBrushRequest,
) -> Result<ApplyPathBrushResponse, String> {
    let domain_request = domain_request(&request);
    let sweep = sweep_formation(&domain_request, request.formation.as_ref())?;
    let plan =
        plan_path_brush_region_merge(graph, surfaces, topology, &domain_request, sweep.as_ref())?;
    let boundary_heights = sweep.as_ref().map(|formation| {
        formation
            .boundary()
            .iter()
            .map(|&index| {
                let vertex = formation.vertices()[index];
                ([vertex[0], vertex[2]], vertex[1])
            })
            .collect::<Vec<_>>()
    });
    let outcome = apply_region_merge(
        graph,
        surfaces,
        topology,
        known_regions,
        &domain_request.operation_id,
        domain_request.target_type.clone(),
        // A path is a flat world-space formation. Terrain is cut around its
        // shared rim; the path's own bed never inherits a negative offset
        // from whichever source surface happened to be nearest.
        move |_graph, point| {
            boundary_heights
                .as_ref()
                .and_then(|heights| {
                    heights.iter().find_map(|(position, height)| {
                        let dx = position[0] - point[0];
                        let dz = position[1] - point[1];
                        (dx * dx + dz * dz <= 0.000_001).then_some(*height)
                    })
                })
                .unwrap_or(0.0)
        },
        plan,
    )?;
    if let Some(sweep) = sweep {
        let patch = replace_target_with_sweep(
            graph,
            surfaces,
            topology,
            known_regions,
            &domain_request.operation_id,
            domain_request.target_type.as_str(),
            &sweep,
            &outcome,
        )?;
        return Ok(response_from_outcome(
            outcome,
            patch.created_nodes,
            patch.created_edges,
            patch.created_surfaces,
        ));
    }
    Ok(response_from_outcome(
        outcome,
        Vec::new(),
        Vec::new(),
        Vec::new(),
    ))
}

/// Plans only the generic sweep and returns its exact outer rim. This is a
/// read-only query: product policy remains with the TypeScript caller.
pub fn path_formation_outline(
    request: PathFormationOutlineRequest,
) -> Result<PathFormationOutlineResponse, String> {
    let sweep = plan_sweep(&request.samples, &request.formation)?;
    Ok(PathFormationOutlineResponse {
        outline: sweep
            .boundary()
            .iter()
            .map(|&index| {
                let vertex = sweep.vertices()[index];
                [vertex[0], vertex[2]]
            })
            .collect(),
    })
}

fn sweep_formation(
    request: &PathBrushRequest,
    formation: Option<&PathFormationRequest>,
) -> Result<Option<SweepFormationPlan>, String> {
    let Some(formation) = formation else {
        return Ok(None);
    };
    if request.samples.len() < 2 {
        return Ok(None);
    }
    plan_sweep(&request.samples, formation).map(Some)
}

fn plan_sweep(
    samples: &[[f32; 2]],
    formation: &PathFormationRequest,
) -> Result<SweepFormationPlan, String> {
    plan_sweep_formation(&SweepFormationRequest {
        reference_line: samples.to_vec(),
        profile: formation
            .profile
            .iter()
            .map(|point| TransverseProfilePoint {
                lateral_offset: point.lateral_offset,
                elevation: point.elevation,
            })
            .collect(),
        max_segment_length: formation.max_segment_length,
        miter_limit: formation.miter_limit,
    })
    .map_err(|error| error.to_string())
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
    formation: Option<&SweepFormationPlan>,
) -> Result<grafting_procgen_surface_transformations::RegionMergePlan, String> {
    validate_request(request).map_err(|error| error.to_string())?;
    let contour = formation.map_or_else(
        || compact_analytic_brush_contour(request).map_err(|error| error.to_string()),
        |formation| {
            let boundary = formation
                .boundary()
                .iter()
                .map(|&index| {
                    let vertex = formation.vertices()[index];
                    [vertex[0], vertex[2]]
                })
                .collect();
            polygonal_contour(boundary).map_err(|error| error.to_string())
        },
    )?;
    // The TypeScript orchestrator has already resolved creation policy for
    // the exact sweep rim. Rust only executes the source-type set it chose.
    plan_region_merge(graph, surfaces, topology, contour, |surface_type| {
        request.source_types.contains(surface_type)
    })
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

struct SweepPatchOutcome {
    created_nodes: Vec<String>,
    created_edges: Vec<String>,
    created_surfaces: Vec<Vec<String>>,
}

#[derive(Clone)]
struct SweepEdge {
    id: String,
    start: usize,
    end: usize,
}

fn edge_key(left: usize, right: usize) -> (usize, usize) {
    if left < right {
        (left, right)
    } else {
        (right, left)
    }
}

fn replace_target_with_sweep(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    topology: &mut ContourTopology,
    known_regions: &mut HashSet<RegionId>,
    operation_id: &str,
    target_type: &str,
    sweep: &SweepFormationPlan,
    outcome: &RegionMergeOutcome,
) -> Result<SweepPatchOutcome, String> {
    topology
        .remove_region(&outcome.new_region)
        .map_err(|error| error.to_string())?;
    surfaces
        .remove_region_surface(&outcome.new_region)
        .map_err(|error| error.to_string())?;
    known_regions.remove(&outcome.new_region);

    let boundary_positions: HashMap<usize, usize> = sweep
        .boundary()
        .iter()
        .copied()
        .enumerate()
        .map(|(position, vertex)| (vertex, position))
        .collect();
    let node_ids: Vec<String> = (0..sweep.vertices().len())
        .map(|index| {
            boundary_positions.get(&index).map_or_else(
                || format!("path-sweep-{operation_id}-node-{index}"),
                |position| format!("region-merge-{operation_id}-node-{position}"),
            )
        })
        .collect();
    let nodes = sweep
        .vertices()
        .iter()
        .enumerate()
        .map(|(index, position)| PatchNodeDto {
            id: node_ids[index].clone(),
            position: *position,
        })
        .collect();

    let mut edge_map = HashMap::<(usize, usize), SweepEdge>::new();
    let mut edges = Vec::<PatchEdgeDto>::new();
    for (position, &start) in sweep.boundary().iter().enumerate() {
        let end = sweep.boundary()[(position + 1) % sweep.boundary().len()];
        let edge = SweepEdge {
            id: format!("region-merge-{operation_id}-new-contour-{position}"),
            start,
            end,
        };
        edge_map.insert(edge_key(start, end), edge.clone());
        edges.push(PatchEdgeDto {
            edge_id: edge.id,
            start_node_id: node_ids[start].clone(),
            end_node_id: node_ids[end].clone(),
            geometry: None,
        });
    }

    let mut created_edges = Vec::new();
    let mut regions = Vec::with_capacity(sweep.quads().len());
    for (quad_index, quad) in sweep.quads().iter().enumerate() {
        let mut boundary = Vec::with_capacity(4);
        for position in 0..4 {
            let start = quad[position];
            let end = quad[(position + 1) % 4];
            let key = edge_key(start, end);
            let edge = if let Some(edge) = edge_map.get(&key) {
                edge.clone()
            } else {
                let id = format!("path-sweep-{operation_id}-edge-{}", edge_map.len());
                let edge = SweepEdge {
                    id: id.clone(),
                    start,
                    end,
                };
                edges.push(PatchEdgeDto {
                    edge_id: id.clone(),
                    start_node_id: node_ids[start].clone(),
                    end_node_id: node_ids[end].clone(),
                    geometry: None,
                });
                created_edges.push(id);
                edge_map.insert(key, edge.clone());
                edge
            };
            boundary.push(OrientedEdgeUseDto {
                edge_id: edge.id,
                reversed: edge.start != start || edge.end != end,
            });
        }
        regions.push(PatchRegionDto {
            region_id: format!("path-sweep-{operation_id}-quad-{quad_index}"),
            boundary,
            holes: Vec::new(),
            surface_type: target_type.to_owned(),
            physical: true,
        });
    }

    let patch = apply_add_patch(
        graph,
        topology,
        surfaces,
        AddPatchRequest {
            nodes,
            edges,
            regions,
        },
    )?;
    if !patch.skipped_region_ids.is_empty() {
        return Err(format!(
            "sweep patch regions were refused: {}",
            patch.skipped_region_ids.join(", ")
        ));
    }
    for key in &patch.outcome.created_surface_keys {
        known_regions.insert(region_id_from_wire(key)?);
    }
    Ok(SweepPatchOutcome {
        created_nodes: patch.outcome.created_node_ids,
        created_edges,
        created_surfaces: patch.outcome.created_surface_keys,
    })
}

fn response_from_outcome(
    outcome: RegionMergeOutcome,
    additional_nodes: Vec<String>,
    additional_edges: Vec<String>,
    sweep_surfaces: Vec<Vec<String>>,
) -> ApplyPathBrushResponse {
    let mut created_surfaces = Vec::new();
    if let Some(remainder) = &outcome.remainder_region {
        created_surfaces.push(region_id_to_wire(remainder));
    }
    if sweep_surfaces.is_empty() {
        created_surfaces.push(region_id_to_wire(&outcome.new_region));
    } else {
        created_surfaces.extend(sweep_surfaces);
    }

    ApplyPathBrushResponse {
        node_ids: IdentityDeltaResponse {
            created: outcome
                .created_node_ids
                .iter()
                .map(ToString::to_string)
                .chain(additional_nodes)
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
                .chain(additional_edges)
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
