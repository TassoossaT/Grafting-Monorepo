//! Volumetric 3D spatial cutting and cavity lining for `ConstructionSession`.
//!
//! Provides `apply_volumetric_cut`, executing 3D volume cuts against session
//! surface regions and generating interior excavation / tunnel lining faces.

use std::collections::HashSet;

use grafting_graph_core::{
    ContourTopology, RegionId, SurfacePlane, SurfaceRegistry, SurfaceType, VolumeShape,
    cut_surface_region, generate_cavity_lining,
};
use serde::{Deserialize, Serialize};

use crate::editing::SessionGraph;
use crate::spatial_index::{RegionBounds, UniformGridIndex};

/// Shape representation received over wire JSON.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum VolumetricShapeDto {
    /// 3D sphere.
    Sphere {
        /// Center `[x, y, z]`.
        center: [f32; 3],
        /// Radius in world units.
        radius: f32,
    },
    /// Axis-aligned box.
    Box {
        /// Minimum corner `[min_x, min_y, min_z]`.
        min: [f32; 3],
        /// Maximum corner `[max_x, max_y, max_z]`.
        max: [f32; 3],
    },
    /// 3D Cylinder / capsule.
    Cylinder {
        /// Start of central axis `[x, y, z]`.
        start: [f32; 3],
        /// End of central axis `[x, y, z]`.
        end: [f32; 3],
        /// Radius around axis.
        radius: f32,
    },
}

impl From<VolumetricShapeDto> for VolumeShape {
    fn from(dto: VolumetricShapeDto) -> Self {
        match dto {
            VolumetricShapeDto::Sphere { center, radius } => Self::Sphere { center, radius },
            VolumetricShapeDto::Box { min, max } => Self::Box { min, max },
            VolumetricShapeDto::Cylinder { start, end, radius } => {
                Self::Cylinder { start, end, radius }
            }
        }
    }
}

/// Request parameters for volumetric cut.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumetricCutRequest {
    /// 3D shape defining the volume of space to cut.
    pub volume: VolumetricShapeDto,
    /// Surface type applied to newly created cavity / tunnel lining faces.
    /// Defaults to `"stone"` if omitted.
    pub lining_surface_type: Option<String>,
    /// Optional explicit candidate region IDs to test. If omitted or empty,
    /// regions within the volume's bounds are queried from the spatial index.
    pub candidate_regions: Option<Vec<String>>,
    /// Whether to generate cavity / tunnel lining faces (default: true).
    pub generate_lining: Option<bool>,
}

/// Response returned to caller after applying a volumetric cut.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumetricCutResponse {
    /// IDs of existing regions modified (notched or punctured with holes).
    pub affected_regions: Vec<String>,
    /// IDs of new sibling regions created when a cut bisected a surface.
    pub created_regions: Vec<String>,
    /// IDs of regions entirely encompassed and destroyed by the volume.
    pub removed_regions: Vec<String>,
    /// IDs of interior cavity/tunnel lining regions generated.
    pub lining_regions: Vec<String>,
    /// Total count of interior holes pierced into surfaces.
    pub holes_inserted: usize,
}

/// Computes a 2D ground-plane AABB for candidate querying in the spatial index.
fn volume_ground_bounds(volume: &VolumeShape) -> RegionBounds {
    match volume {
        VolumeShape::Sphere { center, radius } => RegionBounds::new(
            center[0] - radius,
            center[2] - radius,
            center[0] + radius,
            center[2] + radius,
        ),
        VolumeShape::Box { min, max } => RegionBounds::new(
            min[0].min(max[0]),
            min[2].min(max[2]),
            max[0].max(min[0]),
            max[2].max(min[2]),
        ),
        VolumeShape::Cylinder { start, end, radius } => {
            let min_x = start[0].min(end[0]) - radius;
            let max_x = start[0].max(end[0]) + radius;
            let min_z = start[2].min(end[2]) - radius;
            let max_z = start[2].max(end[2]) + radius;
            RegionBounds::new(min_x, min_z, max_x, max_z)
        }
    }
}

/// Pure function executing a volumetric spatial cut across a session graph and topology.
pub fn apply_volumetric_cut(
    graph: &mut SessionGraph,
    topology: &mut ContourTopology,
    surfaces: &mut SurfaceRegistry,
    spatial_index: &mut UniformGridIndex,
    known_regions: &mut HashSet<RegionId>,
    request: VolumetricCutRequest,
    mut next_id: impl FnMut(&str) -> String,
) -> Result<VolumetricCutResponse, String> {
    let volume_shape: VolumeShape = request.volume.into();
    let generate_lining = request.generate_lining.unwrap_or(true);
    let lining_surface_type = request
        .lining_surface_type
        .unwrap_or_else(|| "stone".to_string());

    // 1. Gather candidate regions
    let candidate_ids: Vec<RegionId> = if let Some(explicit) = request.candidate_regions {
        if !explicit.is_empty() {
            explicit
                .into_iter()
                .map(|s| RegionId::new(s).map_err(|e| e.to_string()))
                .collect::<Result<Vec<_>, _>>()?
        } else {
            let ground_bounds = volume_ground_bounds(&volume_shape);
            spatial_index.query_bounds(&ground_bounds)
        }
    } else {
        let ground_bounds = volume_ground_bounds(&volume_shape);
        spatial_index.query_bounds(&ground_bounds)
    };

    let mut response = VolumetricCutResponse {
        affected_regions: Vec::new(),
        created_regions: Vec::new(),
        removed_regions: Vec::new(),
        lining_regions: Vec::new(),
        holes_inserted: 0,
    };

    // 2. Perform boolean cuts on candidate regions
    for r_id in candidate_ids {
        if topology.region(&r_id).is_none() {
            continue;
        }

        let region = match topology.region(&r_id) {
            Some(r) => r,
            None => continue,
        };
        let outer_loops = region.outer_loops();
        if outer_loops.is_empty() {
            continue;
        }

        let mut points_3d = Vec::new();
        for edge_use in outer_loops[0].iter() {
            if let Some(edge) = topology.edge(edge_use.edge()) {
                let nid = if edge_use.is_reversed() {
                    edge.end_node()
                } else {
                    edge.start_node()
                };
                if let Some(node) = graph.node(nid) {
                    points_3d.push(*node.data());
                }
            }
        }
        if points_3d.len() < 3 {
            continue;
        }

        let plane = match SurfacePlane::from_points(&points_3d) {
            Some(p) => p,
            None => continue,
        };

        let cut_contour_2d = match plane.intersect_volume(&volume_shape, 16) {
            Some(c) if c.len() >= 3 => c,
            _ => continue,
        };

        // Cut region
        match cut_surface_region(
            graph,
            topology,
            surfaces,
            &r_id,
            &plane,
            &cut_contour_2d,
            &mut next_id,
        ) {
            Ok(outcome) => {
                for aff in outcome.affected_regions {
                    if let Some(bounds) = RegionBounds::of_region(graph, topology, &aff) {
                        spatial_index.insert(aff.clone(), bounds);
                    }
                    response.affected_regions.push(aff.as_str().to_string());
                }
                for cre in outcome.created_regions {
                    if let Some(bounds) = RegionBounds::of_region(graph, topology, &cre) {
                        spatial_index.insert(cre.clone(), bounds);
                    }
                    known_regions.insert(cre.clone());
                    response.created_regions.push(cre.as_str().to_string());
                }
                for rem in outcome.removed_regions {
                    spatial_index.remove(&rem);
                    known_regions.remove(&rem);
                    response.removed_regions.push(rem.as_str().to_string());
                }
                response.holes_inserted += outcome.holes_inserted;
            }
            Err(err) => {
                return Err(format!("cut_surface_region failed for {r_id}: {err}"));
            }
        }
    }

    // 3. Generate cavity lining if requested and if cutting occurred
    if generate_lining
        && (!response.affected_regions.is_empty()
            || !response.removed_regions.is_empty()
            || !response.created_regions.is_empty())
    {
        let lining_type = SurfaceType::new(lining_surface_type);
        if let Ok(lining_ids) = generate_cavity_lining(
            graph,
            topology,
            surfaces,
            &volume_shape,
            lining_type,
            &mut next_id,
        ) {
            for lid in lining_ids {
                if let Some(bounds) = RegionBounds::of_region(graph, topology, &lid) {
                    spatial_index.insert(lid.clone(), bounds);
                }
                known_regions.insert(lid.clone());
                response.lining_regions.push(lid.as_str().to_string());
            }
        }
    }

    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::{
        ContourEdge, ContourEdgeId, ContourGeometry, ContourLoop, Graph, Node, NodeId,
        OrientedEdgeUse,
    };

    #[test]
    fn test_apply_volumetric_cut_inserts_hole_and_lines_cavity() {
        let mut graph: SessionGraph = Graph::try_from_parts(vec![], vec![]).unwrap();
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();
        let mut spatial_index = UniformGridIndex::new(4.0);
        let mut known_regions = HashSet::new();

        // Create 10x10 quad
        let n0 = NodeId::new("n0").unwrap();
        let n1 = NodeId::new("n1").unwrap();
        let n2 = NodeId::new("n2").unwrap();
        let n3 = NodeId::new("n3").unwrap();

        graph.add_node(Node::new(n0.clone(), [0.0, 0.0, 0.0])).unwrap();
        graph.add_node(Node::new(n1.clone(), [10.0, 0.0, 0.0])).unwrap();
        graph.add_node(Node::new(n2.clone(), [10.0, 0.0, 10.0])).unwrap();
        graph.add_node(Node::new(n3.clone(), [0.0, 0.0, 10.0])).unwrap();

        let e0 = ContourEdgeId::new("e0").unwrap();
        let e1 = ContourEdgeId::new("e1").unwrap();
        let e2 = ContourEdgeId::new("e2").unwrap();
        let e3 = ContourEdgeId::new("e3").unwrap();

        topology.add_edge(&graph, ContourEdge::new(e0.clone(), n0.clone(), n1.clone(), ContourGeometry::Line)).unwrap();
        topology.add_edge(&graph, ContourEdge::new(e1.clone(), n1, n2.clone(), ContourGeometry::Line)).unwrap();
        topology.add_edge(&graph, ContourEdge::new(e2.clone(), n2, n3.clone(), ContourGeometry::Line)).unwrap();
        topology.add_edge(&graph, ContourEdge::new(e3.clone(), n3, n0, ContourGeometry::Line)).unwrap();

        let region_id = RegionId::new("reg_ground").unwrap();
        let outer: ContourLoop = vec![
            OrientedEdgeUse::forward(e0),
            OrientedEdgeUse::forward(e1),
            OrientedEdgeUse::forward(e2),
            OrientedEdgeUse::forward(e3),
        ];

        topology.add_region(region_id.clone(), vec![outer], vec![]).unwrap();
        surfaces.add_region_surface(&topology, region_id.clone(), SurfaceType::new("terrain"), true).unwrap();
        spatial_index.insert(region_id.clone(), RegionBounds::new(0.0, 0.0, 10.0, 10.0));
        known_regions.insert(region_id.clone());

        let mut id_counter = 0;
        let next_id = |prefix: &str| {
            id_counter += 1;
            format!("{prefix}_{id_counter}")
        };

        let request = VolumetricCutRequest {
            volume: VolumetricShapeDto::Sphere {
                center: [5.0, 0.0, 5.0],
                radius: 2.0,
            },
            lining_surface_type: Some("cave_rock".into()),
            candidate_regions: None,
            generate_lining: Some(true),
        };

        let res = apply_volumetric_cut(
            &mut graph,
            &mut topology,
            &mut surfaces,
            &mut spatial_index,
            &mut known_regions,
            request,
            next_id,
        ).expect("cut succeeds");

        assert_eq!(res.affected_regions.len(), 1);
        assert_eq!(res.holes_inserted, 1);
        assert!(!res.lining_regions.is_empty());

        let mut id_counter2 = 1000;
        let next_id2 = |prefix: &str| {
            id_counter2 += 1;
            format!("{prefix}_{id_counter2}")
        };

        let request2 = VolumetricCutRequest {
            volume: VolumetricShapeDto::Sphere {
                center: [2.0, 0.0, 2.0],
                radius: 1.0,
            },
            lining_surface_type: Some("cave_rock".into()),
            candidate_regions: None,
            generate_lining: Some(true),
        };

        let res2 = apply_volumetric_cut(
            &mut graph,
            &mut topology,
            &mut surfaces,
            &mut spatial_index,
            &mut known_regions,
            request2,
            next_id2,
        ).expect("second cut succeeds");

        assert_eq!(res2.affected_regions.len(), 1);
        assert_eq!(res2.holes_inserted, 1);
    }
}
