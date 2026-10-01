//! 3D spatial cutting and volumetric operations for [`SurfaceRegion`](crate::SurfaceRegion).
//!
//! Provides deterministic 3D volume projection onto planar surface regions,
//! boolean cutting (hole insertion, boundary notching, and region splitting via `i_overlay`),
//! and interior cavity/tunnel lining generation.
//!
//! Conforms to `ADR-0022` and DEC-051: core geometry and topological cuts belong
//! strictly to `grafting-graph-core`.

use std::f32::consts::PI;

use crate::{
    planar_boolean,
    region_edit::delete_region,
    ContourEdge, ContourEdgeId, ContourGeometry, ContourLoop, ContourTopology, Graph, Node,
    NodeId, OrientedEdgeUse, PlanarBoolean, PlanarShape, RegionId, SurfaceRegistry, SurfaceType,
};

/// A 3D geometric volume for spatial operations (excavation, tunnels, carving, destruction).
#[derive(Debug, Clone, PartialEq)]
pub enum VolumeShape {
    /// A 3D sphere defined by world-space center and radius.
    Sphere {
        /// World-space center point `[x, y, z]`.
        center: [f32; 3],
        /// Radius of the sphere in world units.
        radius: f32,
    },
    /// An axis-aligned 3D bounding box.
    Box {
        /// Minimum corner `[min_x, min_y, min_z]`.
        min: [f32; 3],
        /// Maximum corner `[max_x, max_y, max_z]`.
        max: [f32; 3],
    },
    /// A 3D cylinder or capsule, ideal for boring tunnels, paths through hills, and pipes.
    Cylinder {
        /// Start of the central axis in world space.
        start: [f32; 3],
        /// End of the central axis in world space.
        end: [f32; 3],
        /// Radius around the central axis.
        radius: f32,
    },
}

impl VolumeShape {
    /// Tests whether a 3D point lies inside or on the surface of the volume.
    pub fn contains_point(&self, point: [f32; 3]) -> bool {
        match self {
            Self::Sphere { center, radius } => {
                let dx = point[0] - center[0];
                let dy = point[1] - center[1];
                let dz = point[2] - center[2];
                dx * dx + dy * dy + dz * dz <= radius * radius + 1e-4
            }
            Self::Box { min, max } => {
                point[0] >= min[0] - 1e-4
                    && point[0] <= max[0] + 1e-4
                    && point[1] >= min[1] - 1e-4
                    && point[1] <= max[1] + 1e-4
                    && point[2] >= min[2] - 1e-4
                    && point[2] <= max[2] + 1e-4
            }
            Self::Cylinder { start, end, radius } => {
                let ab = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
                let ap = [
                    point[0] - start[0],
                    point[1] - start[1],
                    point[2] - start[2],
                ];
                let len_sq = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
                if len_sq <= 1e-6 {
                    return (ap[0] * ap[0] + ap[1] * ap[1] + ap[2] * ap[2]) <= radius * radius;
                }
                let t = ((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len_sq)
                    .clamp(0.0, 1.0);
                let closest = [
                    start[0] + t * ab[0],
                    start[1] + t * ab[1],
                    start[2] + t * ab[2],
                ];
                let dist_sq = (point[0] - closest[0]).powi(2)
                    + (point[1] - closest[1]).powi(2)
                    + (point[2] - closest[2]).powi(2);
                dist_sq <= radius * radius + 1e-4
            }
        }
    }
}

/// An orthonormal reference frame defining a 2D local plane embedded in 3D space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SurfacePlane {
    /// Origin point of the plane in 3D space.
    pub origin: [f32; 3],
    /// Unit normal vector perpendicular to the plane.
    pub normal: [f32; 3],
    /// Unit tangent vector (local 2D X-axis).
    pub tangent: [f32; 3],
    /// Unit bitangent vector (local 2D Y-axis).
    pub bitangent: [f32; 3],
}

impl SurfacePlane {
    /// Fits a local plane from a collection of 3D points.
    pub fn from_points(points: &[[f32; 3]]) -> Option<Self> {
        if points.len() < 3 {
            return None;
        }
        let origin = points[0];
        // Calculate Newell's method for arbitrary polygon normal to be robust against non-planar polygons.
        let mut normal = [0.0; 3];
        for i in 0..points.len() {
            let current = points[i];
            let next = points[(i + 1) % points.len()];
            normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
            normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
            normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
        }
        let len = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
        if len <= 1e-6 {
            return None;
        }
        let normal = [normal[0] / len, normal[1] / len, normal[2] / len];

        // Choose a robust tangent perpendicular to normal.
        let up = if normal[1].abs() < 0.9 {
            [0.0, 1.0, 0.0]
        } else {
            [1.0, 0.0, 0.0]
        };
        // Tangent = normal x up
        let mut tangent = [
            normal[1] * up[2] - normal[2] * up[1],
            normal[2] * up[0] - normal[0] * up[2],
            normal[0] * up[1] - normal[1] * up[0],
        ];
        let t_len =
            (tangent[0] * tangent[0] + tangent[1] * tangent[1] + tangent[2] * tangent[2]).sqrt();
        if t_len <= 1e-6 {
            return None;
        }
        tangent = [tangent[0] / t_len, tangent[1] / t_len, tangent[2] / t_len];

        // Bitangent = normal x tangent
        let bitangent = [
            normal[1] * tangent[2] - normal[2] * tangent[1],
            normal[2] * tangent[0] - normal[0] * tangent[2],
            normal[0] * tangent[1] - normal[1] * tangent[0],
        ];

        Some(Self {
            origin,
            normal,
            tangent,
            bitangent,
        })
    }

    /// Projects a 3D point onto the 2D local plane coordinates `[u, v]`.
    pub fn project_to_2d(&self, p: [f32; 3]) -> [f32; 2] {
        let d = [
            p[0] - self.origin[0],
            p[1] - self.origin[1],
            p[2] - self.origin[2],
        ];
        [
            d[0] * self.tangent[0] + d[1] * self.tangent[1] + d[2] * self.tangent[2],
            d[0] * self.bitangent[0] + d[1] * self.bitangent[1] + d[2] * self.bitangent[2],
        ]
    }

    /// Lifts a 2D local plane coordinate `[u, v]` back into 3D world space.
    pub fn unproject_to_3d(&self, uv: [f32; 2]) -> [f32; 3] {
        [
            self.origin[0] + uv[0] * self.tangent[0] + uv[1] * self.bitangent[0],
            self.origin[1] + uv[0] * self.tangent[1] + uv[1] * self.bitangent[1],
            self.origin[2] + uv[0] * self.tangent[2] + uv[1] * self.bitangent[2],
        ]
    }

    /// Intersects a 3D volume shape with this plane, producing a 2D closed polygon contour
    /// in local plane coordinates, if an intersection exists.
    pub fn intersect_volume(&self, volume: &VolumeShape, segments: usize) -> Option<Vec<[f32; 2]>> {
        let segments = segments.max(8);
        match volume {
            VolumeShape::Sphere { center, radius } => {
                // Signed distance from center to plane: (center - origin) . normal
                let d_vec = [
                    center[0] - self.origin[0],
                    center[1] - self.origin[1],
                    center[2] - self.origin[2],
                ];
                let dist = d_vec[0] * self.normal[0]
                    + d_vec[1] * self.normal[1]
                    + d_vec[2] * self.normal[2];
                if dist.abs() >= *radius {
                    return None;
                }
                let circle_r = (radius * radius - dist * dist).sqrt();
                // 3D center of the circle on the plane
                let circle_center_3d = [
                    center[0] - dist * self.normal[0],
                    center[1] - dist * self.normal[1],
                    center[2] - dist * self.normal[2],
                ];
                let center_2d = self.project_to_2d(circle_center_3d);

                let mut contour = Vec::with_capacity(segments);
                for i in 0..segments {
                    let theta = 2.0 * PI * (i as f32) / (segments as f32);
                    contour.push([
                        center_2d[0] + circle_r * theta.cos(),
                        center_2d[1] + circle_r * theta.sin(),
                    ]);
                }
                Some(contour)
            }
            VolumeShape::Cylinder { start, end, radius } => {
                // Project cylinder axis onto plane
                let d_start = [
                    start[0] - self.origin[0],
                    start[1] - self.origin[1],
                    start[2] - self.origin[2],
                ];
                let dist_s = d_start[0] * self.normal[0]
                    + d_start[1] * self.normal[1]
                    + d_start[2] * self.normal[2];

                let d_end = [
                    end[0] - self.origin[0],
                    end[1] - self.origin[1],
                    end[2] - self.origin[2],
                ];
                let dist_e = d_end[0] * self.normal[0]
                    + d_end[1] * self.normal[1]
                    + d_end[2] * self.normal[2];

                // If both ends are on the same side and further than radius, no intersection
                if (dist_s > *radius && dist_e > *radius)
                    || (dist_s < -*radius && dist_e < -*radius)
                {
                    return None;
                }

                // Sample points along the axis and take convex envelope / hull of circle slices
                let steps = 6;
                let mut ring_pts = Vec::new();
                for step in 0..=steps {
                    let alpha = step as f32 / steps as f32;
                    let pt_3d = [
                        start[0] + alpha * (end[0] - start[0]),
                        start[1] + alpha * (end[1] - start[1]),
                        start[2] + alpha * (end[2] - start[2]),
                    ];
                    let d = (pt_3d[0] - self.origin[0]) * self.normal[0]
                        + (pt_3d[1] - self.origin[1]) * self.normal[1]
                        + (pt_3d[2] - self.origin[2]) * self.normal[2];
                    if d.abs() < *radius {
                        let slice_r = (radius * radius - d * d).sqrt();
                        let slice_center_3d = [
                            pt_3d[0] - d * self.normal[0],
                            pt_3d[1] - d * self.normal[1],
                            pt_3d[2] - d * self.normal[2],
                        ];
                        let c_2d = self.project_to_2d(slice_center_3d);
                        for i in 0..8 {
                            let th = 2.0 * PI * (i as f32) / 8.0;
                            ring_pts.push([c_2d[0] + slice_r * th.cos(), c_2d[1] + slice_r * th.sin()]);
                        }
                    }
                }
                if ring_pts.len() < 3 {
                    return None;
                }
                Some(convex_hull_2d(&ring_pts))
            }
            VolumeShape::Box { min, max } => {
                // 8 corners of the box
                let corners = [
                    [min[0], min[1], min[2]],
                    [max[0], min[1], min[2]],
                    [max[0], max[1], min[2]],
                    [min[0], max[1], min[2]],
                    [min[0], min[1], max[2]],
                    [max[0], min[1], max[2]],
                    [max[0], max[1], max[2]],
                    [min[0], max[1], max[2]],
                ];
                let edges = [
                    (0, 1), (1, 2), (2, 3), (3, 0),
                    (4, 5), (5, 6), (6, 7), (7, 4),
                    (0, 4), (1, 5), (2, 6), (3, 7),
                ];
                let mut intersections_2d = Vec::new();
                for (a_idx, b_idx) in edges {
                    let a = corners[a_idx];
                    let b = corners[b_idx];
                    let da = (a[0] - self.origin[0]) * self.normal[0]
                        + (a[1] - self.origin[1]) * self.normal[1]
                        + (a[2] - self.origin[2]) * self.normal[2];
                    let db = (b[0] - self.origin[0]) * self.normal[0]
                        + (b[1] - self.origin[1]) * self.normal[1]
                        + (b[2] - self.origin[2]) * self.normal[2];
                    if (da > 0.0 && db < 0.0) || (da < 0.0 && db > 0.0) {
                        let t = da / (da - db);
                        let p = [
                            a[0] + t * (b[0] - a[0]),
                            a[1] + t * (b[1] - a[1]),
                            a[2] + t * (b[2] - a[2]),
                        ];
                        intersections_2d.push(self.project_to_2d(p));
                    }
                }
                if intersections_2d.len() < 3 {
                    return None;
                }
                Some(convex_hull_2d(&intersections_2d))
            }
        }
    }
}

/// Computes the 2D convex hull of a set of 2D points using Monotone Chain algorithm.
fn convex_hull_2d(points: &[[f32; 2]]) -> Vec<[f32; 2]> {
    let mut pts = points.to_vec();
    pts.sort_by(|a, b| {
        a[0].partial_cmp(&b[0])
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a[1].partial_cmp(&b[1]).unwrap_or(std::cmp::Ordering::Equal))
    });
    pts.dedup_by(|a, b| (a[0] - b[0]).abs() < 1e-5 && (a[1] - b[1]).abs() < 1e-5);
    if pts.len() <= 2 {
        return pts;
    }

    let cross = |o: [f32; 2], a: [f32; 2], b: [f32; 2]| -> f32 {
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    };

    let mut lower = Vec::new();
    for &p in &pts {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], p) <= 0.0 {
            lower.pop();
        }
        lower.push(p);
    }

    let mut upper = Vec::new();
    for &p in pts.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], p) <= 0.0 {
            upper.pop();
        }
        upper.push(p);
    }

    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

/// The result of a spatial boolean cut operation on a surface region.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SpatialCutOutcome {
    /// Regions whose boundaries or holes were altered.
    pub affected_regions: Vec<RegionId>,
    /// Sibling regions created when a cut partitioned a region into disjoint parts.
    pub created_regions: Vec<RegionId>,
    /// Regions completely covered and deleted by the cut volume.
    pub removed_regions: Vec<RegionId>,
    /// Number of topological holes inserted directly inside regions.
    pub holes_inserted: usize,
}

fn build_planar_loop<E: Clone + Default>(
    ring: &[[f32; 2]],
    plane: &SurfacePlane,
    graph: &mut Graph<[f32; 3], E>,
    topology: &mut ContourTopology,
    next_id: &mut impl FnMut(&str) -> String,
) -> Result<ContourLoop, String> {
    let mut node_ids = Vec::with_capacity(ring.len());
    for &uv in ring {
        let pos_3d = plane.unproject_to_3d(uv);
        let n_id = NodeId::new(next_id("node")).map_err(|e| format!("{e}"))?;
        graph
            .add_node(Node::new(n_id.clone(), pos_3d))
            .map_err(|e| format!("{e}"))?;
        node_ids.push(n_id);
    }

    let mut edges = Vec::with_capacity(ring.len());
    for i in 0..node_ids.len() {
        let start = node_ids[i].clone();
        let end = node_ids[(i + 1) % node_ids.len()].clone();
        let edge_id = ContourEdgeId::new(next_id("edge")).map_err(|e| format!("{e}"))?;
        topology
            .add_edge(
                graph,
                ContourEdge::new(
                    edge_id.clone(),
                    start,
                    end,
                    ContourGeometry::Line,
                ),
            )
            .map_err(|e| format!("{e}"))?;
        edges.push(OrientedEdgeUse::forward(edge_id));
    }
    Ok(edges)
}

/// Executes a deterministic boolean cut on a single [`SurfaceRegion`](crate::SurfaceRegion).
///
/// Cuts the region with `cut_contour` (defined in the surface's local 2D plane).
/// - If the cut is entirely within the region: inserts a new hole in `region.holes()`.
/// - If the cut crosses boundary edges: notches the outer loop and trims boundary edges.
/// - If the cut splits the region into disconnected parts: creates sibling regions inheriting `SurfaceType`.
/// - If the cut completely covers the region: deletes the region via [`delete_region`].
pub fn cut_surface_region<E: Clone + Default>(
    graph: &mut Graph<[f32; 3], E>,
    topology: &mut ContourTopology,
    surfaces: &mut SurfaceRegistry,
    region_id: &RegionId,
    plane: &SurfacePlane,
    cut_contour: &[[f32; 2]],
    mut next_id: impl FnMut(&str) -> String,
) -> Result<SpatialCutOutcome, String> {
    let region = topology
        .region(region_id)
        .ok_or_else(|| format!("unknown region {region_id}"))?;

    let surface = surfaces
        .region_surface(region_id)
        .ok_or_else(|| format!("unregistered surface {region_id}"))?;
    let surface_type = surface.surface_type().clone();
    let physical = surface.physical();

    // 1. Reconstruct current region polygon in local plane coordinates
    let mut subject_shape: PlanarShape = Vec::new();
    for loop_use in region.outer_loops() {
        let mut ring = Vec::new();
        for edge_use in loop_use.iter() {
            let edge = topology
                .edge(edge_use.edge())
                .ok_or_else(|| format!("missing edge {}", edge_use.edge()))?;
            let node_id = if edge_use.is_reversed() {
                edge.end_node()
            } else {
                edge.start_node()
            };
            let pos_3d = *graph
                .node(node_id)
                .ok_or_else(|| format!("missing node {node_id}"))?
                .data();
            ring.push(plane.project_to_2d(pos_3d));
        }
        if ring.len() >= 3 {
            subject_shape.push(ring);
        }
    }

    for hole_loop in region.holes() {
        let mut hole_ring = Vec::new();
        for edge_use in hole_loop.iter() {
            let edge = topology
                .edge(edge_use.edge())
                .ok_or_else(|| format!("missing edge {}", edge_use.edge()))?;
            let node_id = if edge_use.is_reversed() {
                edge.end_node()
            } else {
                edge.start_node()
            };
            let pos_3d = *graph
                .node(node_id)
                .ok_or_else(|| format!("missing node {node_id}"))?
                .data();
            hole_ring.push(plane.project_to_2d(pos_3d));
        }
        if hole_ring.len() >= 3 {
            subject_shape.push(hole_ring);
        }
    }

    if subject_shape.is_empty() {
        return Err("region has no valid outer loop".into());
    }

    // 2. Perform planar boolean difference
    let clip_shape: PlanarShape = vec![cut_contour.to_vec()];
    let diff_result = planar_boolean(&[subject_shape.clone()], &[clip_shape], PlanarBoolean::Difference)?;

    // 3. Classify outcome
    if diff_result.is_empty() {
        // Encompassed: entire region was carved away
        delete_region(graph, topology, surfaces, region_id)
            .map_err(|e| format!("failed to delete encompassed region: {e}"))?;
        return Ok(SpatialCutOutcome {
            removed_regions: vec![region_id.clone()],
            ..Default::default()
        });
    }

    // Check if the difference preserved the original outer boundary count and area, but added an inner hole
    // We check if diff_result has 1 outer ring with the same vertex count or topology plus one new hole
    let mut outcome = SpatialCutOutcome::default();

    // Replace first component in the original region
    let first_shape = &diff_result[0];
    let new_outer_loop = build_planar_loop(&first_shape[0], plane, graph, topology, &mut next_id)?;
    let mut new_holes = Vec::new();
    for hole_ring in &first_shape[1..] {
        new_holes.push(build_planar_loop(hole_ring, plane, graph, topology, &mut next_id)?);
    }

    topology
        .replace_region_loops(region_id, vec![new_outer_loop], new_holes)
        .map_err(|e| format!("failed to update region loops: {e}"))?;
    outcome.affected_regions.push(region_id.clone());

    if first_shape.len() > subject_shape.len() {
        outcome.holes_inserted += first_shape.len() - subject_shape.len();
    }

    // Additional disjoint components become sibling regions with identical SurfaceType
    for (idx, sibling_shape) in diff_result.iter().enumerate().skip(1) {
        let sib_outer = build_planar_loop(&sibling_shape[0], plane, graph, topology, &mut next_id)?;
        let mut sib_holes = Vec::new();
        for hole_ring in &sibling_shape[1..] {
            sib_holes.push(build_planar_loop(hole_ring, plane, graph, topology, &mut next_id)?);
        }
        let sib_id = RegionId::new(next_id(&format!("sibling_{idx}"))).map_err(|e| format!("{e}"))?;
        topology
            .add_region(sib_id.clone(), vec![sib_outer], sib_holes)
            .map_err(|e| format!("{e}"))?;
        surfaces
            .add_region_surface(topology, sib_id.clone(), surface_type.clone(), physical)
            .map_err(|e| format!("{e}"))?;
        outcome.created_regions.push(sib_id);
    }

    Ok(outcome)
}

/// Generates a 3D polygonal lining representing the internal cavity or tunnel wall
/// carved by a [`VolumeShape::Sphere`] or [`VolumeShape::Cylinder`].
///
/// Creates the floor and walls of the excavation inside `graph` and registers
/// them in `topology` and `surfaces` under `lining_surface_type`.
pub fn generate_cavity_lining<E: Clone + Default>(
    graph: &mut Graph<[f32; 3], E>,
    topology: &mut ContourTopology,
    surfaces: &mut SurfaceRegistry,
    volume: &VolumeShape,
    lining_surface_type: SurfaceType,
    mut next_id: impl FnMut(&str) -> String,
) -> Result<Vec<RegionId>, String> {
    let mut created_regions = Vec::new();

    match volume {
        VolumeShape::Sphere { center, radius } => {
            // Generate a lower dome / bowl (excavation cavity floor and walls)
            let lat_bands = 4;
            let lon_bands = 8;
            let mut grid = Vec::with_capacity((lat_bands + 1) * lon_bands);

            for lat in 0..=lat_bands {
                // From bottom pole (-PI/2) up to equator (0.0)
                let theta = -PI / 2.0 + (PI / 2.0) * (lat as f32) / (lat_bands as f32);
                let y = center[1] + radius * theta.sin();
                let r_cos = radius * theta.cos();
                for lon in 0..lon_bands {
                    let phi = 2.0 * PI * (lon as f32) / (lon_bands as f32);
                    let x = center[0] + r_cos * phi.cos();
                    let z = center[2] + r_cos * phi.sin();
                    let n_id = NodeId::new(next_id("cavity_node")).map_err(|e| format!("{e}"))?;
                    graph
                        .add_node(Node::new(n_id.clone(), [x, y, z]))
                        .map_err(|e| format!("{e}"))?;
                    grid.push(n_id);
                }
            }

            // Create quad surface regions across the cavity bowl
            for lat in 0..lat_bands {
                for lon in 0..lon_bands {
                    let next_lon = (lon + 1) % lon_bands;
                    let p0 = grid[lat * lon_bands + lon].clone();
                    let p1 = grid[lat * lon_bands + next_lon].clone();
                    let p2 = grid[(lat + 1) * lon_bands + next_lon].clone();
                    let p3 = grid[(lat + 1) * lon_bands + lon].clone();

                    let e0 = ContourEdgeId::new(next_id("cav_edge")).map_err(|e| format!("{e}"))?;
                    let e1 = ContourEdgeId::new(next_id("cav_edge")).map_err(|e| format!("{e}"))?;
                    let e2 = ContourEdgeId::new(next_id("cav_edge")).map_err(|e| format!("{e}"))?;
                    let e3 = ContourEdgeId::new(next_id("cav_edge")).map_err(|e| format!("{e}"))?;

                    topology
                        .add_edge(graph, ContourEdge::new(e0.clone(), p0.clone(), p1.clone(), ContourGeometry::Line))
                        .map_err(|e| format!("{e}"))?;
                    topology
                        .add_edge(graph, ContourEdge::new(e1.clone(), p1, p2.clone(), ContourGeometry::Line))
                        .map_err(|e| format!("{e}"))?;
                    topology
                        .add_edge(graph, ContourEdge::new(e2.clone(), p2, p3.clone(), ContourGeometry::Line))
                        .map_err(|e| format!("{e}"))?;
                    topology
                        .add_edge(graph, ContourEdge::new(e3.clone(), p3, p0, ContourGeometry::Line))
                        .map_err(|e| format!("{e}"))?;

                    let r_loop: ContourLoop = vec![
                        OrientedEdgeUse::forward(e0),
                        OrientedEdgeUse::forward(e1),
                        OrientedEdgeUse::forward(e2),
                        OrientedEdgeUse::forward(e3),
                    ];

                    let r_id = RegionId::new(next_id("cavity_region")).map_err(|e| format!("{e}"))?;
                    topology
                        .add_region(r_id.clone(), vec![r_loop], vec![])
                        .map_err(|e| format!("{e}"))?;
                    surfaces
                        .add_region_surface(topology, r_id.clone(), lining_surface_type.clone(), true)
                        .map_err(|e| format!("{e}"))?;
                    created_regions.push(r_id);
                }
            }
        }
        VolumeShape::Cylinder { start, end, radius } => {
            // Generate a tubular sleeve along the cylinder (tunnel passage)
            let length_steps = 4;
            let radial_steps = 8;
            let mut ring_nodes = Vec::with_capacity((length_steps + 1) * radial_steps);

            let axis = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
            let axis_len = (axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]).sqrt();
            let axis_norm = if axis_len > 1e-6 {
                [axis[0] / axis_len, axis[1] / axis_len, axis[2] / axis_len]
            } else {
                [0.0, 1.0, 0.0]
            };

            let up = if axis_norm[1].abs() < 0.9 {
                [0.0, 1.0, 0.0]
            } else {
                [1.0, 0.0, 0.0]
            };
            let mut rad_x = [
                axis_norm[1] * up[2] - axis_norm[2] * up[1],
                axis_norm[2] * up[0] - axis_norm[0] * up[2],
                axis_norm[0] * up[1] - axis_norm[1] * up[0],
            ];
            let rx_len = (rad_x[0] * rad_x[0] + rad_x[1] * rad_x[1] + rad_x[2] * rad_x[2]).sqrt();
            rad_x = [rad_x[0] / rx_len, rad_x[1] / rx_len, rad_x[2] / rx_len];
            let rad_y = [
                axis_norm[1] * rad_x[2] - axis_norm[2] * rad_x[1],
                axis_norm[2] * rad_x[0] - axis_norm[0] * rad_x[2],
                axis_norm[0] * rad_x[1] - axis_norm[1] * rad_x[0],
            ];

            for step in 0..=length_steps {
                let alpha = step as f32 / length_steps as f32;
                let c = [
                    start[0] + alpha * axis[0],
                    start[1] + alpha * axis[1],
                    start[2] + alpha * axis[2],
                ];
                for r in 0..radial_steps {
                    let th = 2.0 * PI * (r as f32) / (radial_steps as f32);
                    let p = [
                        c[0] + radius * (th.cos() * rad_x[0] + th.sin() * rad_y[0]),
                        c[1] + radius * (th.cos() * rad_x[1] + th.sin() * rad_y[1]),
                        c[2] + radius * (th.cos() * rad_x[2] + th.sin() * rad_y[2]),
                    ];
                    let n_id = NodeId::new(next_id("tunnel_node")).map_err(|e| format!("{e}"))?;
                    graph
                        .add_node(Node::new(n_id.clone(), p))
                        .map_err(|e| format!("{e}"))?;
                    ring_nodes.push(n_id);
                }
            }

            for step in 0..length_steps {
                for r in 0..radial_steps {
                    let next_r = (r + 1) % radial_steps;
                    let p0 = ring_nodes[step * radial_steps + r].clone();
                    let p1 = ring_nodes[step * radial_steps + next_r].clone();
                    let p2 = ring_nodes[(step + 1) * radial_steps + next_r].clone();
                    let p3 = ring_nodes[(step + 1) * radial_steps + r].clone();

                    let e0 = ContourEdgeId::new(next_id("tun_edge")).map_err(|e| format!("{e}"))?;
                    let e1 = ContourEdgeId::new(next_id("tun_edge")).map_err(|e| format!("{e}"))?;
                    let e2 = ContourEdgeId::new(next_id("tun_edge")).map_err(|e| format!("{e}"))?;
                    let e3 = ContourEdgeId::new(next_id("tun_edge")).map_err(|e| format!("{e}"))?;

                    topology
                        .add_edge(graph, ContourEdge::new(e0.clone(), p0.clone(), p1.clone(), ContourGeometry::Line))
                        .map_err(|e| format!("{e}"))?;
                    topology
                        .add_edge(graph, ContourEdge::new(e1.clone(), p1, p2.clone(), ContourGeometry::Line))
                        .map_err(|e| format!("{e}"))?;
                    topology
                        .add_edge(graph, ContourEdge::new(e2.clone(), p2, p3.clone(), ContourGeometry::Line))
                        .map_err(|e| format!("{e}"))?;
                    topology
                        .add_edge(graph, ContourEdge::new(e3.clone(), p3, p0, ContourGeometry::Line))
                        .map_err(|e| format!("{e}"))?;

                    let r_loop: ContourLoop = vec![
                        OrientedEdgeUse::forward(e0),
                        OrientedEdgeUse::forward(e1),
                        OrientedEdgeUse::forward(e2),
                        OrientedEdgeUse::forward(e3),
                    ];

                    let r_id = RegionId::new(next_id("tunnel_region")).map_err(|e| format!("{e}"))?;
                    topology
                        .add_region(r_id.clone(), vec![r_loop], vec![])
                        .map_err(|e| format!("{e}"))?;
                    surfaces
                        .add_region_surface(topology, r_id.clone(), lining_surface_type.clone(), true)
                        .map_err(|e| format!("{e}"))?;
                    created_regions.push(r_id);
                }
            }
        }
        VolumeShape::Box { .. } => {
            // Box cavities can be implemented similarly if needed for basement/excavation pits
        }
    }

    Ok(created_regions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_surface_plane_fitting_and_sphere_intersection() {
        let corners = vec![
            [0.0, 0.0, 0.0],
            [10.0, 0.0, 0.0],
            [10.0, 0.0, 10.0],
            [0.0, 0.0, 10.0],
        ];
        let plane = SurfacePlane::from_points(&corners).expect("valid plane");
        assert!((plane.normal[1].abs() - 1.0).abs() < 1e-4);

        let sphere = VolumeShape::Sphere {
            center: [5.0, 0.0, 5.0],
            radius: 2.0,
        };
        let circle_2d = plane.intersect_volume(&sphere, 16).expect("circle intersection");
        assert_eq!(circle_2d.len(), 16);
    }

    #[test]
    fn test_cylinder_contains_point() {
        let cyl = VolumeShape::Cylinder {
            start: [0.0, 0.0, 0.0],
            end: [0.0, 10.0, 0.0],
            radius: 2.0,
        };
        assert!(cyl.contains_point([0.0, 5.0, 0.0]));
        assert!(cyl.contains_point([1.5, 5.0, 0.0]));
        assert!(!cyl.contains_point([3.0, 5.0, 0.0]));
    }

    #[test]
    fn test_cut_surface_region_inserts_hole() {
        let mut graph: Graph<[f32; 3], ()> = Graph::try_from_parts(vec![], vec![]).unwrap();
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();

        let mut id_counter = 0;
        let mut next_id = |prefix: &str| {
            id_counter += 1;
            format!("{prefix}_{id_counter}")
        };

        // Create a 10x10 quad in XZ plane
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

        let region_id = RegionId::new("reg_terrain").unwrap();
        let outer: ContourLoop = vec![
            OrientedEdgeUse::forward(e0),
            OrientedEdgeUse::forward(e1),
            OrientedEdgeUse::forward(e2),
            OrientedEdgeUse::forward(e3),
        ];

        topology.add_region(region_id.clone(), vec![outer], vec![]).unwrap();
        surfaces.add_region_surface(&topology, region_id.clone(), SurfaceType::new("terrain"), true).unwrap();

        let corners = vec![
            [0.0, 0.0, 0.0],
            [10.0, 0.0, 0.0],
            [10.0, 0.0, 10.0],
            [0.0, 0.0, 10.0],
        ];
        let plane = SurfacePlane::from_points(&corners).unwrap();

        // Sphere in the center cutting an internal hole
        let sphere = VolumeShape::Sphere {
            center: [5.0, 0.0, 5.0],
            radius: 2.0,
        };
        let cut_circle = plane.intersect_volume(&sphere, 12).unwrap();

        let outcome = cut_surface_region(
            &mut graph,
            &mut topology,
            &mut surfaces,
            &region_id,
            &plane,
            &cut_circle,
            &mut next_id,
        ).expect("cut success");

        assert_eq!(outcome.affected_regions.len(), 1);
        let updated_reg = topology.region(&region_id).unwrap();
        assert_eq!(updated_reg.holes().len(), 1);
    }

    #[test]
    fn test_generate_cavity_lining_sphere() {
        let mut graph: Graph<[f32; 3], ()> = Graph::try_from_parts(vec![], vec![]).unwrap();
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();

        let mut id_counter = 0;
        let mut next_id = |prefix: &str| {
            id_counter += 1;
            format!("{prefix}_{id_counter}")
        };

        let sphere = VolumeShape::Sphere {
            center: [0.0, 0.0, 0.0],
            radius: 5.0,
        };

        let lining_regions = generate_cavity_lining(
            &mut graph,
            &mut topology,
            &mut surfaces,
            &sphere,
            SurfaceType::new("stone"),
            &mut next_id,
        ).expect("lining generation succeeds");

        assert!(!lining_regions.is_empty());
        for r_id in &lining_regions {
            assert!(topology.region(r_id).is_some());
            assert_eq!(surfaces.region_surface(r_id).unwrap().surface_type().as_str(), "stone");
        }
    }

    #[test]
    fn test_generate_cavity_lining_cylinder() {
        let mut graph: Graph<[f32; 3], ()> = Graph::try_from_parts(vec![], vec![]).unwrap();
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();

        let mut id_counter = 0;
        let mut next_id = |prefix: &str| {
            id_counter += 1;
            format!("{prefix}_{id_counter}")
        };

        let cyl = VolumeShape::Cylinder {
            start: [0.0, 0.0, 0.0],
            end: [10.0, 0.0, 0.0],
            radius: 2.0,
        };

        let tunnel_regions = generate_cavity_lining(
            &mut graph,
            &mut topology,
            &mut surfaces,
            &cyl,
            SurfaceType::new("tunnel_rock"),
            &mut next_id,
        ).expect("tunnel lining succeeds");

        assert!(!tunnel_regions.is_empty());
        for r_id in &tunnel_regions {
            assert!(topology.region(r_id).is_some());
            assert_eq!(surfaces.region_surface(r_id).unwrap().surface_type().as_str(), "tunnel_rock");
        }
    }

    #[test]
    fn test_cut_surface_region_splits_into_siblings() {
        let mut graph: Graph<[f32; 3], ()> = Graph::try_from_parts(vec![], vec![]).unwrap();
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();

        let mut id_counter = 0;
        let mut next_id = |prefix: &str| {
            id_counter += 1;
            format!("{prefix}_{id_counter}")
        };

        // Create a 10x10 quad in XZ plane
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

        let region_id = RegionId::new("reg_terrain").unwrap();
        let outer: ContourLoop = vec![
            OrientedEdgeUse::forward(e0),
            OrientedEdgeUse::forward(e1),
            OrientedEdgeUse::forward(e2),
            OrientedEdgeUse::forward(e3),
        ];

        topology.add_region(region_id.clone(), vec![outer], vec![]).unwrap();
        surfaces.add_region_surface(&topology, region_id.clone(), SurfaceType::new("terrain"), true).unwrap();

        let corners = vec![
            [0.0, 0.0, 0.0],
            [10.0, 0.0, 0.0],
            [10.0, 0.0, 10.0],
            [0.0, 0.0, 10.0],
        ];
        let plane = SurfacePlane::from_points(&corners).unwrap();

        // Cut a vertical trench straight through x in [4.0, 6.0], z in [-2.0, 12.0]
        let box_cutter = VolumeShape::Box {
            min: [4.0, -2.0, -2.0],
            max: [6.0, 2.0, 12.0],
        };
        let trench = plane.intersect_volume(&box_cutter, 4).expect("box intersection");

        let outcome = cut_surface_region(
            &mut graph,
            &mut topology,
            &mut surfaces,
            &region_id,
            &plane,
            &trench,
            &mut next_id,
        ).expect("bisect cut success");

        assert_eq!(outcome.affected_regions.len(), 1);
        assert_eq!(outcome.created_regions.len(), 1);
        let sibling_id = &outcome.created_regions[0];
        assert_eq!(surfaces.region_surface(sibling_id).unwrap().surface_type().as_str(), "terrain");
    }
}
