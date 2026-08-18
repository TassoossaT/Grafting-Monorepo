//! Deterministic planning for local construction-surface transformations.
//!
//! This crate owns domain geometry and formation semantics, but never mutates
//! a graph. A caller submits its [`PathBrushRequest`] with a graph/surface
//! snapshot and receives a generic [`SurfaceReplacementPlan`] that
//! `grafting-graph-core` can validate and publish atomically.

#![deny(missing_docs)]
#![deny(rustdoc::broken_intra_doc_links)]

use std::collections::BTreeSet;
use std::error::Error;
use std::fmt;

use grafting_graph_core::{
    Edge, EdgeId, Graph, IdentityDelta, LocalInvalidationScope, Node, NodeId, PlanIdentityKind,
    SurfaceKey, SurfaceRegistry, SurfaceReplacementPlan, SurfaceSpec, SurfaceType,
    TransformationPlan, TransformationPlanFailure,
};

const CIRCLE_SEGMENTS: usize = 12;
// Fragments smaller than this fraction of the brush footprint are absorbed into path.
const MIN_FRAGMENT_AREA_FACTOR: f32 = 0.015;

/// One circular brush footprint resolved in construction-world XZ space.
#[derive(Debug, Clone, PartialEq)]
pub struct PathBrushRequest {
    /// Caller-stable identity used only to make newly introduced graph IDs deterministic.
    pub operation_id: String,
    /// Brush centre in XZ coordinates.
    pub center: [f32; 2],
    /// Circular footprint radius in world units.
    pub radius: f32,
    /// Maximum downward displacement at the path centre.
    pub depth: f32,
    /// Source type eligible for local replacement.
    pub source_type: SurfaceType,
    /// Type assigned to the painted local region.
    pub target_type: SurfaceType,
}

/// Failure while building a path-brush replacement plan.
#[derive(Debug, Clone, PartialEq)]
pub enum PathBrushFailure {
    /// Radius or depth was non-finite or not strictly positive.
    InvalidBrush,
    /// The request identity could not become a graph identifier.
    InvalidOperationId,
    /// An eligible surface was not a convex polygon in XZ space.
    NonConvexSurface {
        /// Surface whose XZ cycle is not convex.
        key: SurfaceKey,
    },
    /// The footprint intersects a surface but crosses its external boundary.
    ///
    /// This first capability slice deliberately supports complete coverage and
    /// a closed footprint strictly inside one convex terrain face. Crossing an
    /// existing face boundary is rejected atomically until the follow-up
    /// boundary-stitching transformer can preserve shared-edge ownership.
    CrossesSurfaceBoundary {
        /// Surface whose external cycle would need shared-edge stitching.
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
            Self::InvalidBrush => {
                formatter.write_str("path brush radius and depth must be finite positive values")
            }
            Self::InvalidOperationId => formatter
                .write_str("path brush operation identity cannot form deterministic graph IDs"),
            Self::NonConvexSurface { key } => write!(
                formatter,
                "path brush requires a convex source surface: {key:?}"
            ),
            Self::CrossesSurfaceBoundary { key } => write!(
                formatter,
                "path brush footprint crosses source surface boundary: {key:?}"
            ),
            Self::NoChanges => formatter.write_str("path brush produced no semantic change"),
            Self::Plan(error) => write!(formatter, "path brush plan is invalid: {error:?}"),
        }
    }
}

impl Error for PathBrushFailure {}

/// Plans a terrain-to-path transformation without mutating `graph` or `surfaces`.
///
/// For each eligible convex face, the first slice accepts either a footprint
/// containing the whole face or a footprint wholly inside it. The latter is
/// split into deterministic terrain ring sectors and a path fan whose new
/// centre node has `depth` applied, producing the initial shallow U profile.
/// New IDs derive only from `operation_id`, source surface identity, and their
/// stable local index.
pub fn plan_path_brush(
    graph: &Graph<[f32; 3], ()>,
    surfaces: &SurfaceRegistry,
    request: &PathBrushRequest,
) -> Result<SurfaceReplacementPlan<[f32; 3], ()>, PathBrushFailure> {
    if !request.radius.is_finite()
        || request.radius <= 0.0
        || !request.depth.is_finite()
        || request.depth <= 0.0
    {
        return Err(PathBrushFailure::InvalidBrush);
    }
    if request.operation_id.is_empty() {
        return Err(PathBrushFailure::InvalidOperationId);
    }

    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut removed_surfaces = Vec::new();
    let mut added_surfaces = Vec::new();
    let mut created_nodes = BTreeSet::new();
    let mut preserved_nodes = BTreeSet::new();
    let mut created_edges = BTreeSet::new();
    let mut created_surface_keys = BTreeSet::new();
    let mut removed_surface_keys = BTreeSet::new();
    let mut changed = BTreeSet::new();
    let mut neighbors = BTreeSet::new();

    for key in surfaces.surface_keys() {
        let surface = surfaces
            .surface(&key)
            .expect("surface_keys only returns registered keys");
        if surface.surface_type() != &request.source_type {
            continue;
        }
        let polygon = surface
            .cycle()
            .iter()
            .map(|id| {
                graph
                    .node(id)
                    .map(|node| Vertex {
                        id: Some(id.clone()),
                        position: *node.data(),
                    })
                    .ok_or_else(|| PathBrushFailure::NonConvexSurface { key: key.clone() })
            })
            .collect::<Result<Vec<_>, _>>()?;
        if !is_convex(&polygon) {
            return Err(PathBrushFailure::NonConvexSurface { key });
        }

        let inside_count = polygon
            .iter()
            .filter(|vertex| {
                distance_sq(xz(vertex.position), request.center)
                    <= request.radius * request.radius + 0.0001
            })
            .count();
        let nearest = distance_to_polygon_boundary(request.center, &polygon);
        let intersects = inside_count > 0
            || point_in_convex_polygon(request.center, &polygon)
            || nearest < request.radius;
        if !intersects {
            continue;
        }

        let source_tag = surface_tag(&key);
        if inside_count == polygon.len() {
            let built = whole_face_path(&polygon, &key, &source_tag, request)?;
            append_piece(
                built,
                surface.cycle(),
                &key,
                surfaces,
                &mut nodes,
                &mut edges,
                &mut added_surfaces,
                &mut created_nodes,
                &mut preserved_nodes,
                &mut created_edges,
                &mut created_surface_keys,
                &mut removed_surfaces,
                &mut removed_surface_keys,
                &mut changed,
                &mut neighbors,
            );
        } else if point_in_convex_polygon(request.center, &polygon)
            && nearest > request.radius + 0.0001
        {
            let built = contained_circle_path(&polygon, &key, &source_tag, request)?;
            append_piece(
                built,
                surface.cycle(),
                &key,
                surfaces,
                &mut nodes,
                &mut edges,
                &mut added_surfaces,
                &mut created_nodes,
                &mut preserved_nodes,
                &mut created_edges,
                &mut created_surface_keys,
                &mut removed_surfaces,
                &mut removed_surface_keys,
                &mut changed,
                &mut neighbors,
            );
        } else {
            // A brush spanning adjacent terrain faces still has to produce one
            // atomic result in the VTT. Until the domain owns exact circular
            // clipping/stitching, promote every intersected convex face as a
            // whole. Their original boundary nodes stay preserved, so shared
            // seams remain connected and no client-side topology is invented.
            let built = whole_face_path(&polygon, &key, &source_tag, request)?;
            append_piece(
                built,
                surface.cycle(),
                &key,
                surfaces,
                &mut nodes,
                &mut edges,
                &mut added_surfaces,
                &mut created_nodes,
                &mut preserved_nodes,
                &mut created_edges,
                &mut created_surface_keys,
                &mut removed_surfaces,
                &mut removed_surface_keys,
                &mut changed,
                &mut neighbors,
            );
        }
    }

    if removed_surfaces.is_empty() {
        return Err(PathBrushFailure::NoChanges);
    }

    let node_ids = IdentityDelta::new(
        PlanIdentityKind::Node,
        created_nodes,
        preserved_nodes,
        BTreeSet::new(),
        BTreeSet::new(),
    )
    .map_err(PathBrushFailure::Plan)?;
    let edge_ids = IdentityDelta::new(
        PlanIdentityKind::Edge,
        created_edges,
        BTreeSet::new(),
        BTreeSet::new(),
        BTreeSet::new(),
    )
    .map_err(PathBrushFailure::Plan)?;
    let surface_ids = IdentityDelta::new(
        PlanIdentityKind::Surface,
        created_surface_keys,
        BTreeSet::new(),
        BTreeSet::new(),
        removed_surface_keys,
    )
    .map_err(PathBrushFailure::Plan)?;
    let invalidation = LocalInvalidationScope::new(changed, neighbors, BTreeSet::new());
    let transformation = TransformationPlan::new(node_ids, edge_ids, surface_ids, invalidation)
        .map_err(PathBrushFailure::Plan)?;

    Ok(SurfaceReplacementPlan {
        transformation,
        added_nodes: nodes,
        added_edges: edges,
        removed_surfaces,
        added_surfaces,
    })
}

#[derive(Debug, Clone)]
struct Vertex {
    id: Option<NodeId>,
    position: [f32; 3],
}

struct Piece {
    nodes: Vec<Node<[f32; 3]>>,
    edges: Vec<Edge<()>>,
    surfaces: Vec<SurfaceSpec>,
}

fn whole_face_path(
    polygon: &[Vertex],
    _key: &SurfaceKey,
    source_tag: &str,
    request: &PathBrushRequest,
) -> Result<Piece, PathBrushFailure> {
    let center = center_of(polygon);
    let center_id = generated_node_id(request, source_tag, "center")?;
    let shoulder = average_height(polygon);
    let mut piece = Piece {
        nodes: vec![Node::new(
            center_id.clone(),
            [center[0], shoulder - request.depth, center[1]],
        )],
        edges: Vec::new(),
        surfaces: Vec::new(),
    };
    for (index, current) in polygon.iter().enumerate() {
        let next = &polygon[(index + 1) % polygon.len()];
        let a = current.id.clone().expect("source vertices always have IDs");
        let b = next.id.clone().expect("source vertices always have IDs");
        piece.edges.push(Edge::new(
            generated_edge_id(request, source_tag, &format!("radial-{index}"))?,
            center_id.clone(),
            a.clone(),
            (),
        ));
        piece.surfaces.push(surface_spec(
            vec![center_id.clone(), a, b],
            &request.target_type,
        ));
    }
    Ok(piece)
}

fn contained_circle_path(
    polygon: &[Vertex],
    _key: &SurfaceKey,
    source_tag: &str,
    request: &PathBrushRequest,
) -> Result<Piece, PathBrushFailure> {
    let shoulder = average_height(polygon);
    let center_id = generated_node_id(request, source_tag, "center")?;
    let mut piece = Piece {
        nodes: vec![Node::new(
            center_id.clone(),
            [
                request.center[0],
                shoulder - request.depth,
                request.center[1],
            ],
        )],
        edges: Vec::new(),
        surfaces: Vec::new(),
    };
    let mut ring = Vec::with_capacity(CIRCLE_SEGMENTS);
    let mut rays = Vec::with_capacity(CIRCLE_SEGMENTS);
    for index in 0..CIRCLE_SEGMENTS {
        let angle = std::f32::consts::TAU * index as f32 / CIRCLE_SEGMENTS as f32;
        let point = [
            request.center[0] + request.radius * angle.cos(),
            request.center[1] + request.radius * angle.sin(),
        ];
        let id = generated_node_id(request, source_tag, &format!("ring-{index}"))?;
        piece
            .nodes
            .push(Node::new(id.clone(), [point[0], shoulder, point[1]]));
        ring.push(id);
        let mut ray = ray_to_convex_boundary(request.center, point, polygon);
        ray.id = generated_node_id(request, source_tag, &format!("outer-{index}"))?;
        piece.nodes.push(Node::new(
            ray.id.clone(),
            [ray.position[0], ray.height, ray.position[1]],
        ));
        rays.push(ray);
    }
    for index in 0..CIRCLE_SEGMENTS {
        let next = (index + 1) % CIRCLE_SEGMENTS;
        piece.edges.push(Edge::new(
            generated_edge_id(request, source_tag, &format!("ring-{index}"))?,
            ring[index].clone(),
            ring[next].clone(),
            (),
        ));
        piece.edges.push(Edge::new(
            generated_edge_id(request, source_tag, &format!("radial-{index}"))?,
            center_id.clone(),
            ring[index].clone(),
            (),
        ));
        piece.surfaces.push(surface_spec(
            vec![center_id.clone(), ring[index].clone(), ring[next].clone()],
            &request.target_type,
        ));

        let mut sector = vec![ring[index].clone()];
        sector.push(rays[index].id.clone());
        append_outer_arc(&mut sector, &rays[index], &rays[next], polygon);
        sector.push(ring[next].clone());
        let sector_points = outer_sector_points(
            point_on_ring(request, index),
            &rays[index],
            &rays[next],
            polygon,
            point_on_ring(request, next),
        );
        let minimum_area =
            std::f32::consts::PI * request.radius * request.radius * MIN_FRAGMENT_AREA_FACTOR;
        // The first deterministic cleanup policy absorbs a brush-relative
        // sliver into the intended path region. These convex ring sectors do
        // not require the later same-type-neighbor merge fallback.
        let type_for_sector = if polygon_area(&sector_points).abs() < minimum_area {
            &request.target_type
        } else {
            &request.source_type
        };
        piece.surfaces.push(surface_spec(sector, type_for_sector));
    }
    Ok(piece)
}

#[derive(Clone)]
struct RayHit {
    id: NodeId,
    edge_index: usize,
    edge_t: f32,
    position: [f32; 2],
    height: f32,
}

fn ray_to_convex_boundary(origin: [f32; 2], point: [f32; 2], polygon: &[Vertex]) -> RayHit {
    let direction = [point[0] - origin[0], point[1] - origin[1]];
    let mut best: Option<(f32, usize, f32, [f32; 2])> = None;
    for index in 0..polygon.len() {
        let a = xz(polygon[index].position);
        let b = xz(polygon[(index + 1) % polygon.len()].position);
        if let Some((ray_t, edge_t)) = ray_segment_intersection(origin, direction, a, b) {
            if ray_t > 0.0 && best.as_ref().is_none_or(|current| ray_t > current.0) {
                best = Some((
                    ray_t,
                    index,
                    edge_t,
                    [
                        origin[0] + ray_t * direction[0],
                        origin[1] + ray_t * direction[1],
                    ],
                ));
            }
        }
    }
    let (_, edge_index, edge_t, position) =
        best.expect("a ray from inside a convex polygon hits its boundary");
    let start_height = polygon[edge_index].position[1];
    let end_height = polygon[(edge_index + 1) % polygon.len()].position[1];
    RayHit {
        id: NodeId::new("pending-ray").expect("literal ID is valid"),
        edge_index,
        edge_t,
        position,
        height: start_height + (end_height - start_height) * edge_t,
    }
}

fn point_on_ring(request: &PathBrushRequest, index: usize) -> [f32; 2] {
    let angle = std::f32::consts::TAU * index as f32 / CIRCLE_SEGMENTS as f32;
    [
        request.center[0] + request.radius * angle.cos(),
        request.center[1] + request.radius * angle.sin(),
    ]
}

fn outer_sector_points(
    inner_start: [f32; 2],
    start: &RayHit,
    end: &RayHit,
    polygon: &[Vertex],
    inner_end: [f32; 2],
) -> Vec<[f32; 2]> {
    let mut points = vec![inner_start, start.position];
    let mut edge = start.edge_index;
    if start.edge_index == end.edge_index && start.edge_t <= end.edge_t {
        points.push(end.position);
    } else {
        loop {
            points.push(xz(polygon[(edge + 1) % polygon.len()].position));
            edge = (edge + 1) % polygon.len();
            if edge == end.edge_index {
                points.push(end.position);
                break;
            }
        }
    }
    points.push(inner_end);
    points
}
fn append_outer_arc(out: &mut Vec<NodeId>, start: &RayHit, end: &RayHit, polygon: &[Vertex]) {
    let mut edge = start.edge_index;
    if start.edge_index == end.edge_index && start.edge_t <= end.edge_t {
        out.push(end.id.clone());
        return;
    }
    loop {
        out.push(
            polygon[(edge + 1) % polygon.len()]
                .id
                .clone()
                .expect("source vertex"),
        );
        edge = (edge + 1) % polygon.len();
        if edge == end.edge_index {
            out.push(end.id.clone());
            break;
        }
    }
}

fn append_piece(
    piece: Piece,
    original_cycle: &[NodeId],
    key: &SurfaceKey,
    registry: &SurfaceRegistry,
    nodes: &mut Vec<Node<[f32; 3]>>,
    edges: &mut Vec<Edge<()>>,
    added_surfaces: &mut Vec<SurfaceSpec>,
    created_nodes: &mut BTreeSet<NodeId>,
    preserved_nodes: &mut BTreeSet<NodeId>,
    created_edges: &mut BTreeSet<EdgeId>,
    created_surface_keys: &mut BTreeSet<SurfaceKey>,
    removed_surfaces: &mut Vec<SurfaceKey>,
    removed_surface_keys: &mut BTreeSet<SurfaceKey>,
    changed: &mut BTreeSet<SurfaceKey>,
    neighbors: &mut BTreeSet<SurfaceKey>,
) {
    created_nodes.extend(piece.nodes.iter().map(|node| node.id().clone()));
    created_edges.extend(piece.edges.iter().map(|edge| edge.id().clone()));
    created_surface_keys.extend(
        piece
            .surfaces
            .iter()
            .map(|surface| SurfaceKey::from_cycle(&surface.cycle)),
    );
    preserved_nodes.extend(original_cycle.iter().cloned());
    for node in original_cycle {
        neighbors.extend(
            registry
                .surfaces_referencing(node)
                .filter(|candidate| *candidate != key)
                .cloned(),
        );
    }
    changed.insert(key.clone());
    changed.extend(
        piece
            .surfaces
            .iter()
            .map(|surface| SurfaceKey::from_cycle(&surface.cycle)),
    );
    removed_surfaces.push(key.clone());
    removed_surface_keys.insert(key.clone());
    nodes.extend(piece.nodes);
    edges.extend(piece.edges);
    added_surfaces.extend(piece.surfaces);
}

fn surface_spec(cycle: Vec<NodeId>, surface_type: &SurfaceType) -> SurfaceSpec {
    SurfaceSpec {
        cycle,
        surface_type: surface_type.clone(),
        physical: true,
        curvature: None,
    }
}

fn generated_node_id(
    request: &PathBrushRequest,
    source_tag: &str,
    local: &str,
) -> Result<NodeId, PathBrushFailure> {
    NodeId::new(format!(
        "path-{}-{}-{local}",
        request.operation_id, source_tag
    ))
    .map_err(|_| PathBrushFailure::InvalidOperationId)
}

fn generated_edge_id(
    request: &PathBrushRequest,
    source_tag: &str,
    local: &str,
) -> Result<EdgeId, PathBrushFailure> {
    EdgeId::new(format!(
        "path-{}-{}-{local}",
        request.operation_id, source_tag
    ))
    .map_err(|_| PathBrushFailure::InvalidOperationId)
}

fn surface_tag(key: &SurfaceKey) -> String {
    key.nodes()
        .iter()
        .map(|id| id.as_str())
        .collect::<Vec<_>>()
        .join("-")
}

fn xz(position: [f32; 3]) -> [f32; 2] {
    [position[0], position[2]]
}
fn cross(a: [f32; 2], b: [f32; 2]) -> f32 {
    a[0] * b[1] - a[1] * b[0]
}
fn subtract(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [a[0] - b[0], a[1] - b[1]]
}
fn distance_sq(a: [f32; 2], b: [f32; 2]) -> f32 {
    let dx = a[0] - b[0];
    let dz = a[1] - b[1];
    dx * dx + dz * dz
}

fn is_convex(polygon: &[Vertex]) -> bool {
    if polygon.len() < 3 {
        return false;
    }
    let mut sign = 0.0_f32;
    for index in 0..polygon.len() {
        let a = xz(polygon[index].position);
        let b = xz(polygon[(index + 1) % polygon.len()].position);
        let c = xz(polygon[(index + 2) % polygon.len()].position);
        let current = cross(subtract(b, a), subtract(c, b));
        if current.abs() <= 0.0001 {
            continue;
        }
        if sign != 0.0 && current.signum() != sign.signum() {
            return false;
        }
        sign = current;
    }
    sign != 0.0
}

fn point_in_convex_polygon(point: [f32; 2], polygon: &[Vertex]) -> bool {
    let mut sign = 0.0_f32;
    for index in 0..polygon.len() {
        let a = xz(polygon[index].position);
        let b = xz(polygon[(index + 1) % polygon.len()].position);
        let current = cross(subtract(b, a), subtract(point, a));
        if current.abs() <= 0.0001 {
            continue;
        }
        if sign != 0.0 && current.signum() != sign.signum() {
            return false;
        }
        sign = current;
    }
    true
}

fn distance_to_polygon_boundary(point: [f32; 2], polygon: &[Vertex]) -> f32 {
    (0..polygon.len())
        .map(|index| {
            distance_to_segment(
                point,
                xz(polygon[index].position),
                xz(polygon[(index + 1) % polygon.len()].position),
            )
        })
        .fold(f32::INFINITY, f32::min)
}

fn distance_to_segment(point: [f32; 2], a: [f32; 2], b: [f32; 2]) -> f32 {
    let segment = subtract(b, a);
    let length_sq = segment[0] * segment[0] + segment[1] * segment[1];
    let t = (((point[0] - a[0]) * segment[0] + (point[1] - a[1]) * segment[1]) / length_sq)
        .clamp(0.0, 1.0);
    distance_sq(point, [a[0] + t * segment[0], a[1] + t * segment[1]]).sqrt()
}

fn ray_segment_intersection(
    origin: [f32; 2],
    direction: [f32; 2],
    a: [f32; 2],
    b: [f32; 2],
) -> Option<(f32, f32)> {
    let edge = subtract(b, a);
    let denominator = cross(direction, edge);
    if denominator.abs() <= 0.0001 {
        return None;
    }
    let delta = subtract(a, origin);
    let ray_t = cross(delta, edge) / denominator;
    let edge_t = cross(delta, direction) / denominator;
    ((0.0..=1.0).contains(&edge_t)).then_some((ray_t, edge_t))
}

fn polygon_area(points: &[[f32; 2]]) -> f32 {
    points
        .iter()
        .zip(points.iter().cycle().skip(1))
        .take(points.len())
        .map(|(a, b)| a[0] * b[1] - b[0] * a[1])
        .sum::<f32>()
        * 0.5
}
fn center_of(polygon: &[Vertex]) -> [f32; 2] {
    let count = polygon.len() as f32;
    let sum = polygon.iter().fold([0.0, 0.0], |acc, vertex| {
        let p = xz(vertex.position);
        [acc[0] + p[0], acc[1] + p[1]]
    });
    [sum[0] / count, sum[1] / count]
}

fn average_height(polygon: &[Vertex]) -> f32 {
    polygon.iter().map(|vertex| vertex.position[1]).sum::<f32>() / polygon.len() as f32
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

    fn add_face(
        graph: &mut Graph<[f32; 3], ()>,
        registry: &mut SurfaceRegistry,
        name: &str,
        x: f32,
    ) -> SurfaceKey {
        let ids = [
            id(&format!("{name}-a")),
            id(&format!("{name}-b")),
            id(&format!("{name}-c")),
            id(&format!("{name}-d")),
        ];
        let points = [
            [x, 0.0, 0.0],
            [x + 2.0, 0.0, 0.0],
            [x + 2.0, 0.0, 2.0],
            [x, 0.0, 2.0],
        ];
        for (node_id, point) in ids.iter().cloned().zip(points) {
            graph.add_node(Node::new(node_id, point)).unwrap();
        }
        for (index, (a, b)) in ids
            .iter()
            .zip(ids.iter().cycle().skip(1))
            .take(4)
            .enumerate()
        {
            graph
                .add_edge(Edge::new(
                    edge_id(&format!("{name}-e{index}")),
                    a.clone(),
                    b.clone(),
                    (),
                ))
                .unwrap();
        }
        registry
            .add_surface(
                graph,
                ids.into_iter().collect(),
                SurfaceType::new("terrain"),
                true,
            )
            .unwrap()
    }

    fn request(id: &str, center: [f32; 2], radius: f32) -> PathBrushRequest {
        PathBrushRequest {
            operation_id: id.into(),
            center,
            radius,
            depth: 0.25,
            source_type: SurfaceType::new("terrain"),
            target_type: SurfaceType::new("path"),
        }
    }

    #[test]
    fn splits_one_large_face_into_path_fan_and_terrain_ring() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut registry = SurfaceRegistry::new();
        let original = add_face(&mut graph, &mut registry, "one", 0.0);
        let plan = plan_path_brush(&graph, &registry, &request("one", [1.0, 1.0], 0.5)).unwrap();
        assert_eq!(
            plan.transformation.node_ids().created().len(),
            CIRCLE_SEGMENTS * 2 + 1
        );
        assert!(
            plan.transformation
                .node_ids()
                .preserved()
                .contains(&id("one-a"))
        );
        assert!(
            plan.transformation
                .surface_ids()
                .removed()
                .contains(&original)
        );
        let outcome = apply_surface_replacement_plan(&mut graph, &mut registry, plan).unwrap();
        assert!(registry.surface(&original).is_none());
        assert_eq!(
            outcome.invalidation().changed_surfaces().len(),
            CIRCLE_SEGMENTS * 2 + 1
        );
        assert_eq!(
            graph
                .node(&id("path-one-one-a-one-b-one-c-one-d-center"))
                .unwrap()
                .data()[1],
            -0.25
        );
    }

    #[test]
    fn one_operation_can_cover_multiple_complete_faces() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut registry = SurfaceRegistry::new();
        let left = add_face(&mut graph, &mut registry, "left", 0.0);
        let right = add_face(&mut graph, &mut registry, "right", 3.0);
        let plan = plan_path_brush(&graph, &registry, &request("both", [2.5, 1.0], 4.0)).unwrap();
        assert!(plan.removed_surfaces.contains(&left));
        assert!(plan.removed_surfaces.contains(&right));
        apply_surface_replacement_plan(&mut graph, &mut registry, plan).unwrap();
        assert!(registry.surface(&left).is_none());
        assert!(registry.surface(&right).is_none());
    }

    #[test]
    fn preserves_existing_external_boundary_nodes() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut registry = SurfaceRegistry::new();
        add_face(&mut graph, &mut registry, "boundary", 0.0);
        let plan =
            plan_path_brush(&graph, &registry, &request("boundary", [1.0, 1.0], 4.0)).unwrap();
        for suffix in ["a", "b", "c", "d"] {
            assert!(
                plan.transformation
                    .node_ids()
                    .preserved()
                    .contains(&id(&format!("boundary-{suffix}")))
            );
        }
    }

    #[test]
    fn absorbs_brush_relative_terrain_slivers_into_path() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut registry = SurfaceRegistry::new();
        add_face(&mut graph, &mut registry, "sliver", 0.0);
        let plan =
            plan_path_brush(&graph, &registry, &request("sliver", [1.0, 0.505], 0.5)).unwrap();
        let path_count = plan
            .added_surfaces
            .iter()
            .filter(|surface| surface.surface_type == SurfaceType::new("path"))
            .count();
        assert!(
            path_count > CIRCLE_SEGMENTS,
            "a sub-threshold terrain sector is absorbed into path"
        );
    }

    #[test]
    fn repeated_stroke_has_no_second_semantic_delta() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut registry = SurfaceRegistry::new();
        add_face(&mut graph, &mut registry, "repeat", 0.0);
        let first = request("repeat-first", [1.0, 1.0], 4.0);
        let plan = plan_path_brush(&graph, &registry, &first).unwrap();
        apply_surface_replacement_plan(&mut graph, &mut registry, plan).unwrap();
        assert_eq!(
            plan_path_brush(&graph, &registry, &first).unwrap_err(),
            PathBrushFailure::NoChanges
        );
    }

    #[test]
    fn cross_boundary_brush_replaces_the_intersected_face_atomically() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut registry = SurfaceRegistry::new();
        let original = add_face(&mut graph, &mut registry, "cross-face", 0.0);
        let plan =
            plan_path_brush(&graph, &registry, &request("cross-face", [0.2, 1.0], 0.8)).unwrap();
        assert!(
            plan.transformation
                .surface_ids()
                .removed()
                .contains(&original)
        );
        assert!(!plan.transformation.surface_ids().created().is_empty());
        apply_surface_replacement_plan(&mut graph, &mut registry, plan).unwrap();
        assert!(registry.surface(&original).is_none());
    }
}
