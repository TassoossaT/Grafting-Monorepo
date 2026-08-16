//! Pure inner function for `generate_and_apply_wall_path`: the continuous
//! wall-brush tool's per-tick commit -- draw a path of straight and
//! semicircular-arc edges, and once it closes back on itself, get a room
//! (floor, ceiling, every bounding wall). Same **replace-and-diff** model
//! as `cell_partition::generate_and_apply_cell_partition` (every call
//! regenerates the path's whole geometry and applies only the difference
//! against whatever this same structure already holds), sharing that
//! module's own diff/dedup/orphan-cleanup core via `crate::diff_apply` --
//! see that module's doc for why, and `grafting_procgen_structure_generation::wall_path`
//! for the actual geometry.
//!
//! Unlike `cell_partition`'s bounding-box scoping, a **closed** path scopes
//! its own prior geometry with a true point-in-polygon test against its own
//! newly-derived floor boundary -- the same fix `room_removal::remove_room`
//! already applies, for the same reason (a concave or curved room's
//! bounding box can reach into a different, nearby room). An **open** path
//! (no floor yet -- a fence, or a stroke still short of closing) has no
//! polygon to test against, so it falls back to a bounding box over its own
//! generated geometry.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use grafting_graph_core::{SurfaceKey, SurfaceRegistry, SurfaceType};
use grafting_procgen_structure_generation::{ArcBulge, EdgeCurvature, PathEdge, generate_wall_path};

use crate::diff_apply::diff_and_apply;
use crate::editing::SessionGraph;
use crate::geometry::point_in_or_on_polygon;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathEdgeDto {
    pub start: [f32; 3],
    pub end: [f32; 3],
    /// One of `"straight"`, `"arcLeft"`, `"arcRight"`.
    pub curvature: String,
}

fn parse_curvature(wire: &str) -> Result<EdgeCurvature, String> {
    match wire {
        "straight" => Ok(EdgeCurvature::Straight),
        "arcLeft" => Ok(EdgeCurvature::Semicircle(ArcBulge::Left)),
        "arcRight" => Ok(EdgeCurvature::Semicircle(ArcBulge::Right)),
        other => Err(format!("unknown edge curvature: {other}")),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAndApplyWallPathRequest {
    /// The stroke's *whole* current accumulated path, not just what
    /// changed since the last tick -- same full-resend contract as
    /// `cell_partition::GenerateAndApplyCellPartitionRequest`.
    pub edges: Vec<PathEdgeDto>,
    pub wall_height: f32,
    /// How many straight chords approximate one `arcLeft`/`arcRight` edge.
    /// Ignored if every edge is `straight`.
    pub arc_facets: usize,
    /// Namespaces every id this call derives -- must stay the same fixed
    /// value across every tick of one structure, and across separate
    /// strokes painting the same physical structure later, and must vary
    /// per floor/level sharing a footprint. See
    /// `grafting_procgen_structure_generation::generate_wall_path`'s own
    /// doc on this.
    pub id_prefix: String,
    pub wall_type: String,
    pub floor_type: String,
    pub ceiling_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAndApplyWallPathResponse {
    pub added_surface_keys: Vec<Vec<String>>,
    pub removed_surface_keys: Vec<Vec<String>>,
    pub removed_node_ids: Vec<String>,
    /// True once this call's own path closed into a room -- lets a caller
    /// know a floor/ceiling now exist without re-deriving that itself.
    pub closed: bool,
}

/// Regenerates a wall path's full geometry and diffs it against whatever
/// this same structure already holds, applying only the difference.
/// Errors, leaving nothing changed, if `edges` is empty or the path itself
/// is invalid (discontinuous, degenerate, inconsistent baseline, too few
/// `arcFacets` for a curved edge) -- see `generate_wall_path`'s own errors.
pub fn generate_and_apply_wall_path(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    known_surfaces: &HashSet<SurfaceKey>,
    request: GenerateAndApplyWallPathRequest,
) -> Result<GenerateAndApplyWallPathResponse, String> {
    if request.edges.is_empty() {
        return Err("edges must not be empty".to_string());
    }

    let edges: Vec<PathEdge> = request
        .edges
        .iter()
        .map(|dto| Ok(PathEdge { start: dto.start, end: dto.end, curvature: parse_curvature(&dto.curvature)? }))
        .collect::<Result<Vec<_>, String>>()?;

    let generation = generate_wall_path(
        &edges,
        request.wall_height,
        request.arc_facets,
        &request.id_prefix,
        SurfaceType::new(request.wall_type),
        SurfaceType::new(request.floor_type),
        SurfaceType::new(request.ceiling_type),
    )
    .map_err(|error| error.to_string())?;

    let closed = generation.floor.is_some();

    // The scope predicate this call diffs its own prior geometry against:
    // a true point-in-polygon test against the freshly-derived floor
    // boundary once the path is closed, or a bounding box over the
    // generated geometry itself while it is still open (see module doc).
    let polygon: Option<Vec<(f32, f32)>> = generation.floor.as_ref().map(|floor| floor.nodes.iter().map(|node| (node.data()[0], node.data()[2])).collect());

    let mut min_x = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut min_z = f32::INFINITY;
    let mut max_z = f32::NEG_INFINITY;
    for piece in &generation.walls {
        for node in &piece.nodes {
            let position = node.data();
            min_x = min_x.min(position[0]);
            max_x = max_x.max(position[0]);
            min_z = min_z.min(position[2]);
            max_z = max_z.max(position[2]);
        }
    }
    const EPS: f32 = 1e-3;
    let in_box = |position: &[f32; 3]| position[0] >= min_x - EPS && position[0] <= max_x + EPS && position[2] >= min_z - EPS && position[2] <= max_z + EPS;

    let in_scope = |position: &[f32; 3]| match &polygon {
        Some(polygon) => point_in_or_on_polygon((position[0], position[2]), polygon),
        None => in_box(position),
    };

    let old_keys_in_scope: HashSet<SurfaceKey> = known_surfaces
        .iter()
        .filter(|key| surfaces.surface(key).map(|surface| surface.cycle().iter().all(|id| graph.node(id).map(|node| in_scope(node.data())).unwrap_or(false))).unwrap_or(false))
        .cloned()
        .collect();

    let mut all_pieces = generation.walls;
    if let Some(floor) = generation.floor {
        all_pieces.push(floor);
    }
    if let Some(ceiling) = generation.ceiling {
        all_pieces.push(ceiling);
    }

    let outcome = diff_and_apply(graph, surfaces, &old_keys_in_scope, all_pieces, |node| in_scope(node.data()))?;

    Ok(GenerateAndApplyWallPathResponse {
        added_surface_keys: outcome.added_surface_keys,
        removed_surface_keys: outcome.removed_surface_keys,
        removed_node_ids: outcome.removed_node_ids,
        closed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::Graph;

    fn empty_session() -> (SessionGraph, SurfaceRegistry, HashSet<SurfaceKey>) {
        (Graph::try_from_parts(Vec::new(), Vec::new()).unwrap(), SurfaceRegistry::new(), HashSet::new())
    }

    fn edge(start: [f32; 3], end: [f32; 3], curvature: &str) -> PathEdgeDto {
        PathEdgeDto { start, end, curvature: curvature.to_string() }
    }

    fn request(edges: Vec<PathEdgeDto>) -> GenerateAndApplyWallPathRequest {
        GenerateAndApplyWallPathRequest {
            edges,
            wall_height: 3.0,
            arc_facets: 6,
            id_prefix: "house-1".into(),
            wall_type: "wall-white".into(),
            floor_type: "floor".into(),
            ceiling_type: "ceiling".into(),
        }
    }

    fn apply(graph: &mut SessionGraph, surfaces: &mut SurfaceRegistry, known: &mut HashSet<SurfaceKey>, req: GenerateAndApplyWallPathRequest) -> GenerateAndApplyWallPathResponse {
        let response = generate_and_apply_wall_path(graph, surfaces, known, req).unwrap();
        for key in &response.removed_surface_keys {
            known.remove(&SurfaceKey::from_cycle(&key.iter().map(|id| grafting_graph_core::NodeId::new(id.clone()).unwrap()).collect::<Vec<_>>()));
        }
        for key in &response.added_surface_keys {
            known.insert(SurfaceKey::from_cycle(&key.iter().map(|id| grafting_graph_core::NodeId::new(id.clone()).unwrap()).collect::<Vec<_>>()));
        }
        response
    }

    fn square() -> Vec<PathEdgeDto> {
        vec![
            edge([0.0, 0.0, 0.0], [4.0, 0.0, 0.0], "straight"),
            edge([4.0, 0.0, 0.0], [4.0, 0.0, 4.0], "straight"),
            edge([4.0, 0.0, 4.0], [0.0, 0.0, 4.0], "straight"),
            edge([0.0, 0.0, 4.0], [0.0, 0.0, 0.0], "straight"),
        ]
    }

    #[test]
    fn closing_a_square_adds_four_walls_and_a_floor_and_ceiling() {
        let (mut graph, mut surfaces, mut known) = empty_session();
        let response = apply(&mut graph, &mut surfaces, &mut known, request(square()));
        assert!(response.closed);
        // 4 walls + 1 floor + 1 ceiling = 6 surfaces.
        assert_eq!(response.added_surface_keys.len(), 6);
        assert!(response.removed_surface_keys.is_empty());
    }

    #[test]
    fn repainting_the_identical_closed_path_is_a_no_op() {
        let (mut graph, mut surfaces, mut known) = empty_session();
        apply(&mut graph, &mut surfaces, &mut known, request(square()));
        let second = apply(&mut graph, &mut surfaces, &mut known, request(square()));
        assert!(second.added_surface_keys.is_empty());
        assert!(second.removed_surface_keys.is_empty());
    }

    #[test]
    fn an_open_path_reports_not_closed_and_adds_no_floor() {
        let (mut graph, mut surfaces, mut known) = empty_session();
        let edges = vec![edge([0.0, 0.0, 0.0], [4.0, 0.0, 0.0], "straight")];
        let response = apply(&mut graph, &mut surfaces, &mut known, request(edges));
        assert!(!response.closed);
        assert_eq!(response.added_surface_keys.len(), 1, "one wall, no floor/ceiling");
    }

    #[test]
    fn extending_an_open_path_into_a_closed_one_only_adds_the_new_geometry() {
        let (mut graph, mut surfaces, mut known) = empty_session();
        let mut edges = square();
        let last = edges.pop().unwrap();
        let first = apply(&mut graph, &mut surfaces, &mut known, request(edges.clone()));
        assert!(!first.closed);

        edges.push(last);
        let second = apply(&mut graph, &mut surfaces, &mut known, request(edges));
        assert!(second.closed);
        assert!(second.removed_surface_keys.is_empty(), "the first three walls must be untouched, not regenerated");
        // The closing wall + floor + ceiling are new.
        assert_eq!(second.added_surface_keys.len(), 3);
    }

    #[test]
    fn an_unknown_curvature_is_rejected() {
        let (mut graph, mut surfaces, known) = empty_session();
        let edges = vec![edge([0.0, 0.0, 0.0], [4.0, 0.0, 0.0], "spiral")];
        let error = generate_and_apply_wall_path(&mut graph, &mut surfaces, &known, request(edges)).unwrap_err();
        assert!(error.contains("spiral"));
    }
}
