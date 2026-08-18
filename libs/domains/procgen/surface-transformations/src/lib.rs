//! Deterministic planning for local construction-surface transformations.
//!
//! This crate owns authoritative brush/surface intersection, topology rebuilding,
//! and path formation. It never mutates a graph: callers receive one atomic
//! [`SurfaceReplacementPlan`] for the whole confirmed stroke.

#![deny(missing_docs)]
#![deny(rustdoc::broken_intra_doc_links)]

mod clip;

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt;

use clip::{ClipVertex, partition_by_footprint};
use grafting_graph_core::{
    Edge, EdgeId, Graph, IdentityDelta, LocalInvalidationScope, Node, NodeId, PlanIdentityKind,
    SurfaceKey, SurfaceRegistry, SurfaceReplacementPlan, SurfaceSpec, SurfaceType,
    TransformationPlan, TransformationPlanFailure,
};
use grafting_procgen_surface_mesh::triangulate_surface;

const CIRCLE_SEGMENTS: usize = 16;
const POSITION_SCALE: f32 = 10_000.0;
const MIN_FRAGMENT_AREA_FACTOR: f32 = 0.0025;

/// Renderer-neutral convex brush footprint shared by surface and terrain tools.
#[derive(Debug, Clone, PartialEq)]
pub enum BrushShape {
    /// A circular footprint approximated deterministically for graph clipping.
    Circle {
        /// World-space radius.
        radius: f32,
    },
    /// A rotated square footprint.
    Square {
        /// Full world-space side length.
        size: f32,
        /// Rotation around world Y in radians.
        rotation_radians: f32,
    },
    /// A rotated regular hexagonal footprint.
    Hexagon {
        /// World-space circumradius.
        radius: f32,
        /// Rotation around world Y in radians.
        rotation_radians: f32,
    },
}

impl BrushShape {
    fn valid(&self) -> bool {
        match self {
            Self::Circle { radius } => radius.is_finite() && *radius > 0.0,
            Self::Square {
                size,
                rotation_radians,
            } => size.is_finite() && *size > 0.0 && rotation_radians.is_finite(),
            Self::Hexagon {
                radius,
                rotation_radians,
            } => radius.is_finite() && *radius > 0.0 && rotation_radians.is_finite(),
        }
    }

    fn extent(&self) -> f32 {
        match self {
            Self::Circle { radius } | Self::Hexagon { radius, .. } => *radius,
            Self::Square { size, .. } => *size * 0.5,
        }
    }

    fn area(&self) -> f32 {
        match self {
            Self::Circle { radius } => std::f32::consts::PI * radius * radius,
            Self::Square { size, .. } => size * size,
            Self::Hexagon { radius, .. } => 1.5 * 3.0_f32.sqrt() * radius * radius,
        }
    }

    fn footprint(&self, center: [f32; 2]) -> Vec<[f32; 2]> {
        match self {
            Self::Circle { radius } => regular_polygon(center, *radius, CIRCLE_SEGMENTS, 0.0),
            Self::Square {
                size,
                rotation_radians,
            } => regular_polygon(
                center,
                *size / 2.0_f32.sqrt(),
                4,
                *rotation_radians + std::f32::consts::FRAC_PI_4,
            ),
            Self::Hexagon {
                radius,
                rotation_radians,
            } => regular_polygon(center, *radius, 6, *rotation_radians),
        }
    }
}
/// One convex brush stroke resolved in construction-world XZ space.
#[derive(Debug, Clone, PartialEq)]
pub struct PathBrushRequest {
    /// Caller-stable identity used to make introduced graph IDs deterministic.
    pub operation_id: String,
    /// Ordered pointer samples forming the confirmed stroke.
    pub samples: Vec<[f32; 2]>,
    /// Convex footprint applied at every resampled stroke point.
    pub shape: BrushShape,
    /// Maximum downward displacement at the path centre line.
    pub depth: f32,
    /// Source types eligible for local replacement in the same atomic stroke.
    pub source_types: Vec<SurfaceType>,
    /// Type assigned to the painted local region.
    pub target_type: SurfaceType,
}

/// Failure while building a path-brush replacement plan.
#[derive(Debug, Clone, PartialEq)]
pub enum PathBrushFailure {
    /// Samples, shape, or depth are missing, non-finite, or not positive where required.
    InvalidBrush,
    /// The request identity could not become a graph identifier.
    InvalidOperationId,
    /// An eligible source surface could not be triangulated safely.
    InvalidSourceSurface {
        /// Surface that could not participate in the transformation.
        key: SurfaceKey,
    },
    /// No source surface had a semantic delta, so no operation may be committed.
    NoChanges,
    /// The generic plan contract rejected the generated lifecycle data.
    Plan(TransformationPlanFailure),
}

impl fmt::Display for PathBrushFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBrush => formatter.write_str(
                "path brush requires finite samples, a valid brush shape, and finite positive depth",
            ),
            Self::InvalidOperationId => formatter
                .write_str("path brush operation identity cannot form deterministic graph IDs"),
            Self::InvalidSourceSurface { key } => {
                write!(
                    formatter,
                    "path brush could not triangulate source surface: {key:?}"
                )
            }
            Self::NoChanges => formatter.write_str("path brush produced no semantic change"),
            Self::Plan(error) => write!(formatter, "path brush plan is invalid: {error:?}"),
        }
    }
}

impl Error for PathBrushFailure {}

/// Plans a continuous terrain-to-path transformation without mutating state.
///
/// Arbitrary simple source polygons are triangulated through the canonical
/// surface-mesh capability. Each triangle is partitioned against the swept
/// circular footprint: external fragments retain the source type, internal
/// fragments receive the target type and a shallow U-shaped profile. Shared
/// cut positions are interned as one graph node, every replacement cycle has
/// graph edges, and all samples are published as one replacement plan.
pub fn plan_path_brush(
    graph: &Graph<[f32; 3], ()>,
    surfaces: &SurfaceRegistry,
    request: &PathBrushRequest,
) -> Result<SurfaceReplacementPlan<[f32; 3], ()>, PathBrushFailure> {
    validate_request(request)?;
    let footprints = resample_stroke(&request.samples, request.shape.extent() * 0.45);
    let mut builder = ReplacementBuilder::new(graph, surfaces, request, &footprints);

    for key in surfaces.surface_keys() {
        let surface = surfaces
            .surface(&key)
            .expect("surface_keys only returns registered keys");
        if !request.source_types.contains(surface.surface_type()) {
            continue;
        }

        let polygon = surface
            .cycle()
            .iter()
            .map(|id| {
                graph
                    .node(id)
                    .map(|node| ClipVertex {
                        id: Some(id.clone()),
                        position: *node.data(),
                    })
                    .ok_or_else(|| PathBrushFailure::InvalidSourceSurface { key: key.clone() })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let positions = polygon
            .iter()
            .map(|vertex| vertex.position)
            .collect::<Vec<_>>();
        let mesh = triangulate_surface(&positions, None)
            .ok_or_else(|| PathBrushFailure::InvalidSourceSurface { key: key.clone() })?;

        let mut source_fragments = Vec::new();
        let mut target_fragments = Vec::new();
        for triangle in mesh.indices.chunks_exact(3) {
            let outside = vec![
                polygon[triangle[0] as usize].clone(),
                polygon[triangle[1] as usize].clone(),
                polygon[triangle[2] as usize].clone(),
            ];
            let mut remaining = vec![outside];
            for center in &footprints {
                let mut next_remaining = Vec::new();
                for fragment in remaining {
                    let footprint = request.shape.footprint(*center);
                    let (rejected, accepted) = partition_by_footprint(fragment, &footprint);
                    next_remaining.extend(rejected);
                    if let Some(accepted) = accepted {
                        target_fragments.push(accepted);
                    }
                }
                remaining = next_remaining;
                if remaining.is_empty() {
                    break;
                }
            }
            source_fragments.extend(remaining);
        }

        if target_fragments.is_empty() {
            continue;
        }

        let source_type = surface.surface_type().clone();
        builder.begin_surface(&key, surface.cycle());
        let minimum_area = request.shape.area() * MIN_FRAGMENT_AREA_FACTOR;
        for fragment in source_fragments {
            if polygon_area_xz(&fragment).abs() < minimum_area {
                builder.add_path_fragment(fragment)?;
            } else {
                builder.add_surface_fragment(fragment, &source_type)?;
            }
        }
        for fragment in target_fragments {
            builder.add_path_fragment(fragment)?;
        }
    }

    builder.finish()
}

fn validate_request(request: &PathBrushRequest) -> Result<(), PathBrushFailure> {
    if request.operation_id.is_empty() {
        return Err(PathBrushFailure::InvalidOperationId);
    }
    if request.source_types.is_empty()
        || request.samples.is_empty()
        || request
            .samples
            .iter()
            .flatten()
            .any(|coordinate| !coordinate.is_finite())
        || !request.shape.valid()
        || !request.depth.is_finite()
        || request.depth <= 0.0
    {
        return Err(PathBrushFailure::InvalidBrush);
    }
    Ok(())
}

fn regular_polygon(
    center: [f32; 2],
    radius: f32,
    segments: usize,
    rotation_radians: f32,
) -> Vec<[f32; 2]> {
    (0..segments)
        .map(|index| {
            let angle = rotation_radians + std::f32::consts::TAU * index as f32 / segments as f32;
            [
                center[0] + radius * angle.cos(),
                center[1] + radius * angle.sin(),
            ]
        })
        .collect()
}

fn point_in_footprint(point: [f32; 2], footprint: &[[f32; 2]]) -> bool {
    footprint.iter().enumerate().all(|(index, start)| {
        let end = footprint[(index + 1) % footprint.len()];
        (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0])
            >= -0.000_01
    })
}

/// Returns whether `point` lies in the continuous sweep of `shape` over `samples`.
///
/// This is the shared authoritative footprint query used by terrain-cell
/// generation and surface transformations, so both tools interpret brush
/// shape, rotation, and gaps between pointer samples identically.
pub fn swept_brush_contains(shape: &BrushShape, samples: &[[f32; 2]], point: [f32; 2]) -> bool {
    if samples.is_empty() || !shape.valid() || point.iter().any(|value| !value.is_finite()) {
        return false;
    }
    resample_stroke(samples, shape.extent() * 0.45)
        .into_iter()
        .any(|center| point_in_footprint(point, &shape.footprint(center)))
}
fn resample_stroke(samples: &[[f32; 2]], maximum_spacing: f32) -> Vec<[f32; 2]> {
    let mut output = vec![samples[0]];
    for pair in samples.windows(2) {
        let dx = pair[1][0] - pair[0][0];
        let dz = pair[1][1] - pair[0][1];
        let distance = (dx * dx + dz * dz).sqrt();
        let steps = (distance / maximum_spacing).ceil().max(1.0) as usize;
        for step in 1..=steps {
            let t = step as f32 / steps as f32;
            let point = [pair[0][0] + dx * t, pair[0][1] + dz * t];
            if distance_sq(*output.last().expect("one sample"), point) > 0.000_000_1 {
                output.push(point);
            }
        }
    }
    output
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct PositionKey(i64, i64, i64);

impl PositionKey {
    fn new(position: [f32; 3]) -> Self {
        Self(
            (position[0] * POSITION_SCALE).round() as i64,
            (position[1] * POSITION_SCALE).round() as i64,
            (position[2] * POSITION_SCALE).round() as i64,
        )
    }
}

struct ReplacementBuilder<'a> {
    graph: &'a Graph<[f32; 3], ()>,
    registry: &'a SurfaceRegistry,
    request: &'a PathBrushRequest,
    footprints: &'a [[f32; 2]],
    nodes: Vec<Node<[f32; 3]>>,
    edges: Vec<Edge<()>>,
    removed_surfaces: Vec<SurfaceKey>,
    added_surfaces: Vec<SurfaceSpec>,
    created_nodes: BTreeSet<NodeId>,
    preserved_nodes: BTreeSet<NodeId>,
    created_edges: BTreeSet<EdgeId>,
    preserved_edges: BTreeSet<EdgeId>,
    created_surface_keys: BTreeSet<SurfaceKey>,
    removed_surface_keys: BTreeSet<SurfaceKey>,
    changed: BTreeSet<SurfaceKey>,
    neighbors: BTreeSet<SurfaceKey>,
    node_by_position: BTreeMap<PositionKey, NodeId>,
    edge_by_pair: BTreeMap<(NodeId, NodeId), EdgeId>,
    next_node: usize,
    next_edge: usize,
}

impl<'a> ReplacementBuilder<'a> {
    fn new(
        graph: &'a Graph<[f32; 3], ()>,
        registry: &'a SurfaceRegistry,
        request: &'a PathBrushRequest,
        footprints: &'a [[f32; 2]],
    ) -> Self {
        let edge_by_pair = graph
            .snapshot()
            .edges()
            .iter()
            .map(|edge| {
                (
                    ordered_pair(edge.source().clone(), edge.target().clone()),
                    edge.id().clone(),
                )
            })
            .collect();
        Self {
            graph,
            registry,
            request,
            footprints,
            nodes: Vec::new(),
            edges: Vec::new(),
            removed_surfaces: Vec::new(),
            added_surfaces: Vec::new(),
            created_nodes: BTreeSet::new(),
            preserved_nodes: BTreeSet::new(),
            created_edges: BTreeSet::new(),
            preserved_edges: BTreeSet::new(),
            created_surface_keys: BTreeSet::new(),
            removed_surface_keys: BTreeSet::new(),
            changed: BTreeSet::new(),
            neighbors: BTreeSet::new(),
            node_by_position: BTreeMap::new(),
            edge_by_pair,
            next_node: 0,
            next_edge: 0,
        }
    }

    fn begin_surface(&mut self, key: &SurfaceKey, original_cycle: &[NodeId]) {
        for node_id in original_cycle {
            self.preserved_nodes.insert(node_id.clone());
            if let Some(node) = self.graph.node(node_id) {
                self.node_by_position
                    .entry(PositionKey::new(*node.data()))
                    .or_insert_with(|| node_id.clone());
            }
            self.neighbors.extend(
                self.registry
                    .surfaces_referencing(node_id)
                    .filter(|candidate| *candidate != key)
                    .cloned(),
            );
        }
        self.removed_surfaces.push(key.clone());
        self.removed_surface_keys.insert(key.clone());
        self.changed.insert(key.clone());
    }

    fn add_surface_fragment(
        &mut self,
        polygon: Vec<ClipVertex>,
        surface_type: &SurfaceType,
    ) -> Result<(), PathBrushFailure> {
        let cycle = self.resolve_cycle(&polygon)?;
        self.add_cycle_edges(&cycle)?;
        self.add_surface(cycle, surface_type);
        Ok(())
    }

    fn add_path_fragment(&mut self, polygon: Vec<ClipVertex>) -> Result<(), PathBrushFailure> {
        let boundary = self.resolve_cycle(&polygon)?;
        self.add_cycle_edges(&boundary)?;
        let mut center = polygon.iter().fold([0.0; 3], |sum, vertex| {
            [
                sum[0] + vertex.position[0],
                sum[1] + vertex.position[1],
                sum[2] + vertex.position[2],
            ]
        });
        let count = polygon.len() as f32;
        center = [center[0] / count, center[1] / count, center[2] / count];
        let distance = self
            .footprints
            .iter()
            .map(|sample| distance_sq([center[0], center[2]], *sample).sqrt())
            .fold(f32::INFINITY, f32::min);
        let normalized = (distance / self.request.shape.extent()).clamp(0.0, 1.0);
        let profile = 1.0 - normalized * normalized;
        center[1] -= self.request.depth * profile;
        let center_id = self.create_node(center)?;

        for index in 0..boundary.len() {
            let next = (index + 1) % boundary.len();
            self.add_edge(center_id.clone(), boundary[index].clone())?;
            self.add_surface(
                vec![
                    center_id.clone(),
                    boundary[index].clone(),
                    boundary[next].clone(),
                ],
                &self.request.target_type,
            );
        }
        Ok(())
    }

    fn resolve_cycle(&mut self, polygon: &[ClipVertex]) -> Result<Vec<NodeId>, PathBrushFailure> {
        let mut cycle = Vec::with_capacity(polygon.len());
        for vertex in polygon {
            let id = if let Some(id) = &vertex.id {
                self.node_by_position
                    .entry(PositionKey::new(vertex.position))
                    .or_insert_with(|| id.clone());
                id.clone()
            } else if let Some(id) = self
                .node_by_position
                .get(&PositionKey::new(vertex.position))
            {
                id.clone()
            } else {
                let id = self.create_node(vertex.position)?;
                self.node_by_position
                    .insert(PositionKey::new(vertex.position), id.clone());
                id
            };
            if cycle.last() != Some(&id) {
                cycle.push(id);
            }
        }
        if cycle.len() > 1 && cycle.first() == cycle.last() {
            cycle.pop();
        }
        Ok(cycle)
    }

    fn create_node(&mut self, position: [f32; 3]) -> Result<NodeId, PathBrushFailure> {
        let id = NodeId::new(format!(
            "path-{}-node-{}",
            self.request.operation_id, self.next_node
        ))
        .map_err(|_| PathBrushFailure::InvalidOperationId)?;
        self.next_node += 1;
        self.created_nodes.insert(id.clone());
        self.nodes.push(Node::new(id.clone(), position));
        Ok(id)
    }

    fn add_cycle_edges(&mut self, cycle: &[NodeId]) -> Result<(), PathBrushFailure> {
        for index in 0..cycle.len() {
            self.add_edge(
                cycle[index].clone(),
                cycle[(index + 1) % cycle.len()].clone(),
            )?;
        }
        Ok(())
    }

    fn add_edge(&mut self, source: NodeId, target: NodeId) -> Result<(), PathBrushFailure> {
        if source == target {
            return Ok(());
        }
        let pair = ordered_pair(source.clone(), target.clone());
        if let Some(existing_id) = self.edge_by_pair.get(&pair) {
            if !self.created_edges.contains(existing_id) {
                self.preserved_edges.insert(existing_id.clone());
            }
            return Ok(());
        }
        let id = EdgeId::new(format!(
            "path-{}-edge-{}",
            self.request.operation_id, self.next_edge
        ))
        .map_err(|_| PathBrushFailure::InvalidOperationId)?;
        self.next_edge += 1;
        self.created_edges.insert(id.clone());
        self.edge_by_pair.insert(pair, id.clone());
        self.edges.push(Edge::new(id, source, target, ()));
        Ok(())
    }

    fn add_surface(&mut self, cycle: Vec<NodeId>, surface_type: &SurfaceType) {
        if cycle.len() < 3 {
            return;
        }
        let key = SurfaceKey::from_cycle(&cycle);
        if !self.created_surface_keys.insert(key.clone()) {
            return;
        }
        self.changed.insert(key);
        self.added_surfaces.push(SurfaceSpec {
            cycle,
            surface_type: surface_type.clone(),
            physical: true,
            curvature: None,
        });
    }

    fn finish(self) -> Result<SurfaceReplacementPlan<[f32; 3], ()>, PathBrushFailure> {
        if self.removed_surfaces.is_empty() {
            return Err(PathBrushFailure::NoChanges);
        }
        let node_ids = IdentityDelta::new(
            PlanIdentityKind::Node,
            self.created_nodes,
            self.preserved_nodes,
            BTreeSet::new(),
            BTreeSet::new(),
        )
        .map_err(PathBrushFailure::Plan)?;
        let edge_ids = IdentityDelta::new(
            PlanIdentityKind::Edge,
            self.created_edges,
            self.preserved_edges,
            BTreeSet::new(),
            BTreeSet::new(),
        )
        .map_err(PathBrushFailure::Plan)?;
        let surface_ids = IdentityDelta::new(
            PlanIdentityKind::Surface,
            self.created_surface_keys,
            BTreeSet::new(),
            BTreeSet::new(),
            self.removed_surface_keys,
        )
        .map_err(PathBrushFailure::Plan)?;
        let invalidation =
            LocalInvalidationScope::new(self.changed, self.neighbors, BTreeSet::new());
        let transformation = TransformationPlan::new(node_ids, edge_ids, surface_ids, invalidation)
            .map_err(PathBrushFailure::Plan)?;
        Ok(SurfaceReplacementPlan {
            transformation,
            added_nodes: self.nodes,
            added_edges: self.edges,
            removed_surfaces: self.removed_surfaces,
            added_surfaces: self.added_surfaces,
        })
    }
}

fn ordered_pair(left: NodeId, right: NodeId) -> (NodeId, NodeId) {
    if left <= right {
        (left, right)
    } else {
        (right, left)
    }
}

fn polygon_area_xz(polygon: &[ClipVertex]) -> f32 {
    polygon
        .iter()
        .zip(polygon.iter().cycle().skip(1))
        .take(polygon.len())
        .map(|(a, b)| a.position[0] * b.position[2] - b.position[0] * a.position[2])
        .sum::<f32>()
        * 0.5
}

fn distance_sq(left: [f32; 2], right: [f32; 2]) -> f32 {
    let dx = left[0] - right[0];
    let dz = left[1] - right[1];
    dx * dx + dz * dz
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::{Graph, apply_surface_replacement_plan};

    fn id(value: &str) -> NodeId {
        NodeId::new(value).unwrap()
    }

    fn edge_id(value: &str) -> EdgeId {
        EdgeId::new(value).unwrap()
    }

    fn add_polygon(
        graph: &mut Graph<[f32; 3], ()>,
        registry: &mut SurfaceRegistry,
        name: &str,
        points: &[[f32; 3]],
    ) -> SurfaceKey {
        let ids = points
            .iter()
            .enumerate()
            .map(|(index, point)| {
                let node_id = id(&format!("{name}-{index}"));
                graph.add_node(Node::new(node_id.clone(), *point)).unwrap();
                node_id
            })
            .collect::<Vec<_>>();
        for index in 0..ids.len() {
            graph
                .add_edge(Edge::new(
                    edge_id(&format!("{name}-edge-{index}")),
                    ids[index].clone(),
                    ids[(index + 1) % ids.len()].clone(),
                    (),
                ))
                .unwrap();
        }
        registry
            .add_surface(graph, ids, SurfaceType::new("terrain"), true)
            .unwrap()
    }

    fn add_face(
        graph: &mut Graph<[f32; 3], ()>,
        registry: &mut SurfaceRegistry,
        name: &str,
        x: f32,
    ) -> SurfaceKey {
        add_polygon(
            graph,
            registry,
            name,
            &[
                [x, 0.0, 0.0],
                [x + 2.0, 0.0, 0.0],
                [x + 2.0, 0.0, 2.0],
                [x, 0.0, 2.0],
            ],
        )
    }

    fn request(operation_id: &str, samples: Vec<[f32; 2]>, radius: f32) -> PathBrushRequest {
        PathBrushRequest {
            operation_id: operation_id.into(),
            samples,
            shape: BrushShape::Circle { radius },
            depth: 0.25,
            source_types: vec![SurfaceType::new("terrain")],
            target_type: SurfaceType::new("path"),
        }
    }

    #[test]
    fn clips_a_local_path_and_keeps_external_terrain() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut registry = SurfaceRegistry::new();
        let original = add_face(&mut graph, &mut registry, "local", 0.0);
        let plan =
            plan_path_brush(&graph, &registry, &request("local", vec![[1.0, 1.0]], 0.5)).unwrap();
        assert!(plan.removed_surfaces.contains(&original));
        assert!(
            plan.added_surfaces
                .iter()
                .any(|surface| surface.surface_type == SurfaceType::new("terrain"))
        );
        assert!(
            plan.added_surfaces
                .iter()
                .any(|surface| surface.surface_type == SurfaceType::new("path"))
        );
        apply_surface_replacement_plan(&mut graph, &mut registry, plan).unwrap();
        assert!(registry.surface(&original).is_none());
        assert!(
            graph
                .snapshot()
                .nodes()
                .iter()
                .any(|node| node.data()[1] < 0.0)
        );
    }

    #[test]
    fn clips_across_a_face_boundary_without_promoting_whole_faces() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut registry = SurfaceRegistry::new();
        let left = add_face(&mut graph, &mut registry, "left", 0.0);
        let right = add_face(&mut graph, &mut registry, "right", 2.0);
        let plan =
            plan_path_brush(&graph, &registry, &request("seam", vec![[2.0, 1.0]], 0.75)).unwrap();
        assert!(plan.removed_surfaces.contains(&left));
        assert!(plan.removed_surfaces.contains(&right));
        let terrain_count = plan
            .added_surfaces
            .iter()
            .filter(|surface| surface.surface_type == SurfaceType::new("terrain"))
            .count();
        assert!(terrain_count >= 2);
        apply_surface_replacement_plan(&mut graph, &mut registry, plan).unwrap();
    }

    #[test]
    fn handles_a_nonconvex_source_surface() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut registry = SurfaceRegistry::new();
        let original = add_polygon(
            &mut graph,
            &mut registry,
            "concave",
            &[
                [0.0, 0.0, 0.0],
                [3.0, 0.0, 0.0],
                [3.0, 0.0, 3.0],
                [1.5, 0.0, 1.5],
                [0.0, 0.0, 3.0],
            ],
        );
        let plan = plan_path_brush(
            &graph,
            &registry,
            &request("concave", vec![[1.5, 1.0]], 0.8),
        )
        .unwrap();
        assert!(plan.removed_surfaces.contains(&original));
        apply_surface_replacement_plan(&mut graph, &mut registry, plan).unwrap();
    }

    #[test]
    fn one_operation_sweeps_continuously_between_sparse_samples() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut registry = SurfaceRegistry::new();
        add_face(&mut graph, &mut registry, "left", 0.0);
        add_face(&mut graph, &mut registry, "right", 2.0);
        let plan = plan_path_brush(
            &graph,
            &registry,
            &request("stroke", vec![[0.25, 1.0], [3.75, 1.0]], 0.35),
        )
        .unwrap();
        assert_eq!(plan.removed_surfaces.len(), 2);
        assert!(
            plan.added_surfaces
                .iter()
                .filter(|surface| surface.surface_type == SurfaceType::new("path"))
                .count()
                > CIRCLE_SEGMENTS
        );
    }

    #[test]
    fn preserves_original_boundary_nodes() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut registry = SurfaceRegistry::new();
        add_face(&mut graph, &mut registry, "boundary", 0.0);
        let plan = plan_path_brush(
            &graph,
            &registry,
            &request("boundary", vec![[0.2, 1.0]], 0.8),
        )
        .unwrap();
        for index in 0..4 {
            assert!(
                plan.transformation
                    .node_ids()
                    .preserved()
                    .contains(&id(&format!("boundary-{index}")))
            );
        }
        assert!(
            plan.transformation
                .edge_ids()
                .preserved()
                .contains(&edge_id("boundary-edge-1"))
        );
    }

    #[test]
    fn repeating_the_same_stroke_has_no_second_semantic_delta() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut registry = SurfaceRegistry::new();
        add_face(&mut graph, &mut registry, "repeat", 0.0);
        let first = request("repeat-first", vec![[1.0, 1.0]], 4.0);
        let plan = plan_path_brush(&graph, &registry, &first).unwrap();
        apply_surface_replacement_plan(&mut graph, &mut registry, plan).unwrap();
        assert_eq!(
            plan_path_brush(&graph, &registry, &first).unwrap_err(),
            PathBrushFailure::NoChanges
        );
    }

    #[test]
    fn square_and_hexagon_shapes_both_create_local_path() {
        for (name, shape) in [
            (
                "square",
                BrushShape::Square {
                    size: 1.0,
                    rotation_radians: 0.3,
                },
            ),
            (
                "hexagon",
                BrushShape::Hexagon {
                    radius: 0.6,
                    rotation_radians: 0.2,
                },
            ),
        ] {
            let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
            let mut registry = SurfaceRegistry::new();
            add_face(&mut graph, &mut registry, name, 0.0);
            let mut brush = request(name, vec![[1.0, 1.0]], 0.5);
            brush.shape = shape;
            let plan = plan_path_brush(&graph, &registry, &brush).unwrap();
            assert!(
                plan.added_surfaces
                    .iter()
                    .any(|surface| surface.surface_type == SurfaceType::new("path"))
            );
            assert!(
                plan.added_surfaces
                    .iter()
                    .any(|surface| surface.surface_type == SurfaceType::new("terrain"))
            );
        }
    }

    #[test]
    fn shared_sweep_query_closes_gaps_between_sparse_samples() {
        let shape = BrushShape::Hexagon {
            radius: 0.4,
            rotation_radians: 0.0,
        };
        assert!(swept_brush_contains(
            &shape,
            &[[0.0, 0.0], [4.0, 0.0]],
            [2.0, 0.0]
        ));
        assert!(!swept_brush_contains(
            &shape,
            &[[0.0, 0.0], [4.0, 0.0]],
            [2.0, 1.0]
        ));
    }

    #[test]
    fn one_atomic_stroke_transforms_mixed_terrain_types() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut registry = SurfaceRegistry::new();
        let terrain = add_face(&mut graph, &mut registry, "terrain", 0.0);
        let grass_key = add_face(&mut graph, &mut registry, "grass", 2.0);
        let grass = registry.remove_surface(&grass_key).unwrap();
        let grass_key = registry
            .add_surface(
                &graph,
                grass.cycle().to_vec(),
                SurfaceType::new("terrain-grass"),
                true,
            )
            .unwrap();
        let mut brush = request("mixed", vec![[0.5, 1.0], [3.5, 1.0]], 0.5);
        brush.source_types.push(SurfaceType::new("terrain-grass"));
        let plan = plan_path_brush(&graph, &registry, &brush).unwrap();
        assert!(plan.removed_surfaces.contains(&terrain));
        assert!(plan.removed_surfaces.contains(&grass_key));
        assert!(
            plan.added_surfaces
                .iter()
                .any(|surface| surface.surface_type == SurfaceType::new("terrain-grass"))
        );
    }
    #[test]
    fn rejects_an_empty_stroke() {
        let graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let registry = SurfaceRegistry::new();
        assert_eq!(
            plan_path_brush(&graph, &registry, &request("empty", Vec::new(), 1.0)).unwrap_err(),
            PathBrushFailure::InvalidBrush
        );
    }
}
