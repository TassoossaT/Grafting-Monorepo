//! Thin JSON boundary for the Phase-B terrain-to-path transformer.
//!
//! Geometry, topology planning, and atomic graph mutation stay in the Rust
//! domain capability and graph core. This module only parses wire data,
//! forwards it, and translates the resulting identity delta back to JSON.

use serde::{Deserialize, Serialize};

use std::collections::HashSet;

use grafting_graph_core::{
    ContourEdge, ContourEdgeId, ContourTopology, Edge, EdgeId, Graph, Node, NodeId,
    OrientedEdgeUse, RegionId, SurfaceKey, SurfaceRegistry, SurfaceType,
};
use grafting_procgen_surface_transformations::{
    BrushShape, PathBrushRequest, plan_analytic_path_brush, swept_brush_contains,
};

use crate::dto::surface_key_to_wire;
use crate::editing::SessionGraph;
use crate::mesh::{self, SurfaceMeshDto, region_id_to_wire};

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
    topology: &mut ContourTopology,
    known_surfaces: &mut HashSet<SurfaceKey>,
    known_regions: &mut HashSet<RegionId>,
    request: ApplyPathBrushRequest,
) -> Result<ApplyPathBrushResponse, String> {
    let domain_request = domain_request(&request);
    let plan = plan_analytic_path_brush(graph, surfaces, &domain_request)
        .map_err(|error| error.to_string())?;
    apply_analytic_plan(
        graph,
        surfaces,
        topology,
        known_surfaces,
        known_regions,
        &domain_request,
        plan,
    )
}

/// Builds the exact target-surface preview on cloned state; confirmed state is untouched.
pub fn preview_path_brush(
    graph: &SessionGraph,
    surfaces: &SurfaceRegistry,
    topology: &ContourTopology,
    known_surfaces: &HashSet<SurfaceKey>,
    known_regions: &HashSet<RegionId>,
    request: ApplyPathBrushRequest,
) -> Result<Vec<SurfaceMeshDto>, String> {
    let target_type = request.target_surface_type.clone();
    let mut preview_graph = graph.clone();
    let mut preview_surfaces = surfaces.clone();
    let mut preview_topology = topology.clone();
    let mut preview_known_surfaces = known_surfaces.clone();
    let mut preview_known_regions = known_regions.clone();
    let domain_request = domain_request(&request);
    let plan = plan_analytic_path_brush(&preview_graph, &preview_surfaces, &domain_request)
        .map_err(|error| error.to_string())?;
    apply_analytic_plan(
        &mut preview_graph,
        &mut preview_surfaces,
        &mut preview_topology,
        &mut preview_known_surfaces,
        &mut preview_known_regions,
        &domain_request,
        plan,
    )?;
    Ok(mesh::all_surface_meshes(
        &preview_graph,
        &preview_surfaces,
        &preview_known_surfaces,
        &preview_topology,
        &preview_known_regions,
    )
    .into_iter()
    .filter(|surface| surface.surface_type == target_type)
    .collect())
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

fn apply_analytic_plan(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    topology: &mut ContourTopology,
    known_surfaces: &mut HashSet<SurfaceKey>,
    known_regions: &mut HashSet<RegionId>,
    request: &PathBrushRequest,
    plan: grafting_procgen_surface_transformations::AnalyticPathBrushPlan,
) -> Result<ApplyPathBrushResponse, String> {
    let source_region = RegionId::new(format!("path-{}-terrain", request.operation_id))
        .map_err(|error| error.to_string())?;
    let target_region = RegionId::new(format!("path-{}-target", request.operation_id))
        .map_err(|error| error.to_string())?;
    let source_type = plan
        .source_surface_keys()
        .first()
        .and_then(|key| surfaces.surface(key))
        .ok_or("analytic path brush has no source surface")?
        .surface_type()
        .clone();

    let mut source_loops = Vec::new();
    for (loop_index, boundary) in plan.source_boundaries().iter().enumerate() {
        let mut loop_ = Vec::new();
        for (edge_index, (start, end)) in boundary
            .iter()
            .cloned()
            .zip(boundary.iter().cloned().cycle().skip(1))
            .take(boundary.len())
            .enumerate()
        {
            let id = ContourEdgeId::new(format!(
                "path-{}-source-contour-{loop_index}-{edge_index}",
                request.operation_id
            ))
            .map_err(|error| error.to_string())?;
            topology
                .add_edge(
                    graph,
                    ContourEdge::new(
                        id.clone(),
                        start,
                        end,
                        grafting_graph_core::ContourGeometry::Line,
                    ),
                )
                .map_err(|error| error.to_string())?;
            loop_.push(OrientedEdgeUse::forward(id));
        }
        source_loops.push(loop_);
    }

    let contour = plan.target_contour();
    let mut target_nodes = Vec::new();
    let mut created_node_ids = Vec::new();
    for (index, point) in contour.vertices().iter().enumerate() {
        let id = NodeId::new(format!("path-{}-region-node-{index}", request.operation_id))
            .map_err(|error| error.to_string())?;
        let y = nearest_source_height(graph, plan.source_surface_keys(), *point) - request.depth;
        graph
            .add_node(Node::new(id.clone(), [point[0], y, point[1]]))
            .map_err(|error| error.to_string())?;
        created_node_ids.push(id.clone());
        target_nodes.push(id);
    }
    let mut target_loop = Vec::new();
    let mut created_edge_ids = Vec::new();
    for (index, geometry) in contour.edge_geometries().iter().copied().enumerate() {
        let start = target_nodes[index].clone();
        let end = target_nodes[(index + 1) % target_nodes.len()].clone();
        let generic_id = EdgeId::new(format!("path-{}-region-edge-{index}", request.operation_id))
            .map_err(|error| error.to_string())?;
        graph
            .add_edge(Edge::new(
                generic_id.clone(),
                start.clone(),
                end.clone(),
                (),
            ))
            .map_err(|error| error.to_string())?;
        created_edge_ids.push(generic_id);
        let contour_id = ContourEdgeId::new(format!(
            "path-{}-target-contour-{index}",
            request.operation_id
        ))
        .map_err(|error| error.to_string())?;
        topology
            .add_edge(
                graph,
                ContourEdge::new(contour_id.clone(), start, end, geometry),
            )
            .map_err(|error| error.to_string())?;
        target_loop.push(OrientedEdgeUse::forward(contour_id));
    }
    let source_hole = target_loop
        .iter()
        .rev()
        .map(|use_| OrientedEdgeUse::reversed(use_.edge().clone()))
        .collect();
    topology
        .add_region(source_region.clone(), source_loops, vec![source_hole])
        .map_err(|error| error.to_string())?;
    topology
        .add_region(target_region.clone(), vec![target_loop], Vec::new())
        .map_err(|error| error.to_string())?;
    surfaces
        .add_region_surface(topology, source_region.clone(), source_type, true)
        .map_err(|error| error.to_string())?;
    surfaces
        .add_region_surface(
            topology,
            target_region.clone(),
            request.target_type.clone(),
            true,
        )
        .map_err(|error| error.to_string())?;
    for key in plan.source_surface_keys() {
        known_surfaces.remove(key);
    }
    known_regions.insert(source_region.clone());
    known_regions.insert(target_region.clone());

    Ok(ApplyPathBrushResponse {
        node_ids: IdentityDeltaResponse {
            created: created_node_ids.iter().map(ToString::to_string).collect(),
            preserved: Vec::new(),
            replaced: Vec::new(),
            removed: Vec::new(),
        },
        edge_ids: IdentityDeltaResponse {
            created: created_edge_ids.iter().map(ToString::to_string).collect(),
            preserved: Vec::new(),
            replaced: Vec::new(),
            removed: Vec::new(),
        },
        surface_ids: SurfaceIdentityDeltaResponse {
            created: vec![
                region_id_to_wire(&source_region),
                region_id_to_wire(&target_region),
            ],
            preserved: Vec::new(),
            replaced: Vec::new(),
            removed: plan
                .source_surface_keys()
                .iter()
                .map(surface_key_to_wire)
                .collect(),
        },
        invalidation: InvalidationResponse {
            changed_surfaces: Vec::new(),
            topology_repair_neighbors: Vec::new(),
            direct_dependencies: Vec::new(),
        },
    })
}

fn nearest_source_height(graph: &SessionGraph, keys: &[SurfaceKey], point: [f32; 2]) -> f32 {
    keys.iter()
        .flat_map(|key| key.nodes())
        .filter_map(|id| graph.node(id).map(|node| *node.data()))
        .min_by(|left, right| {
            let left_distance = (left[0] - point[0]).powi(2) + (left[2] - point[1]).powi(2);
            let right_distance = (right[0] - point[0]).powi(2) + (right[2] - point[1]).powi(2);
            left_distance.total_cmp(&right_distance)
        })
        .map_or(0.0, |position| position[1])
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
