//! What a brush footprint currently covers.
//!
//! This is the creation-side twin of `region_editing.rs`'s topology query:
//! before anything is generated, the caller asks "what is already here?" and
//! its own per-type table decides what that means -- substitute, cut,
//! restack, ignore, or refuse. The engine reports; it never decides.
//!
//! **No interaction rule lives here.** This module has no opinion about a
//! path crossing a wall or terrain landing on terrain; it only answers which
//! regions the footprint touches, how it touches each one, and where. Two
//! different structure types looking at the identical answer are expected to
//! do completely different things with it.

use serde::{Deserialize, Serialize};

use grafting_graph_core::{ContourLoop, ContourTopology, NodeId, RegionId, SurfaceRegistry};

use crate::editing::SessionGraph;
use crate::mesh::region_id_to_wire;

/// How finely a curved boundary edge is sampled before the point-in-polygon
/// tests. Not a rendering tolerance -- real tessellation happens later, from
/// the true analytic edges -- just fine enough that a corner sitting close to
/// an arc is never misjudged. Mirrors `analytic_brush`'s own constant.
const COVERAGE_TOLERANCE: f32 = 0.05;

/// How a footprint touches one region.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CoverageKind {
    /// The region's own centroid is inside the footprint -- the whole face
    /// is under the brush. This is what a "whole face" selection rule keys
    /// on (terrain restacking, most commonly).
    Centroid,
    /// The footprint and the region overlap, but the centroid is outside --
    /// the brush clips this face rather than covering it. A type that cuts
    /// (a path) cares about these; a type that swaps whole faces ignores them.
    Overlap,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FootprintCoverageRequest {
    /// The footprint's own closed XZ polygon, in order. A caller with a
    /// swept brush passes its already-unioned outline.
    pub polygon: Vec<[f32; 2]>,
}

/// One region the footprint touches, with everything a per-type rule needs
/// to decide without asking again: which region, what it is, how it was
/// touched, and where it sits.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoveredRegionDto {
    pub surface_key: Vec<String>,
    pub surface_type: String,
    pub physical: bool,
    pub coverage: CoverageKind,
    /// The region's own centroid, in world space. `y` is averaged over its
    /// boundary nodes -- which is what "the height this face currently sits
    /// at" means for a face whose interior is derived, not stored.
    pub centroid: [f32; 3],
    /// Every boundary node, in the topology's own deterministic order.
    pub node_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FootprintCoverageResponse {
    pub covered: Vec<CoveredRegionDto>,
}

pub(crate) fn polygon_contains_point(polygon: &[[f32; 2]], point: [f32; 2]) -> bool {
    let mut inside = false;
    let mut j = polygon.len().wrapping_sub(1);
    for i in 0..polygon.len() {
        let a = polygon[i];
        let b = polygon[j];
        if (a[1] > point[1]) != (b[1] > point[1]) {
            let t = (point[1] - a[1]) / (b[1] - a[1]);
            if point[0] < a[0] + t * (b[0] - a[0]) {
                inside = !inside;
            }
        }
        j = i;
    }
    inside
}

/// One loop's boundary sampled into an XZ polygon, walking each edge in the
/// loop's own direction so a curve contributes its real shape rather than
/// its chord.
pub(crate) fn loop_polygon(
    topology: &ContourTopology,
    graph: &SessionGraph,
    loop_: &ContourLoop,
) -> Option<Vec<[f32; 2]>> {
    let mut polygon = Vec::new();
    for use_ in loop_ {
        let edge = topology.edge(use_.edge())?;
        let (from_id, to_id) = if use_.is_reversed() {
            (edge.end_node(), edge.start_node())
        } else {
            (edge.start_node(), edge.end_node())
        };
        let from = xz(graph, from_id)?;
        let to = xz(graph, to_id)?;
        let geometry = if use_.is_reversed() {
            edge.reversed_geometry()
        } else {
            *edge.geometry()
        };
        let mut sampled = grafting_graph_core::ContourEdge::new(
            edge.id().clone(),
            from_id.clone(),
            to_id.clone(),
            geometry,
        )
        .tessellate(from, to, COVERAGE_TOLERANCE);
        // This edge's last point is the next edge's first; drop it so the
        // closed polygon carries one copy of each shared corner.
        sampled.pop();
        polygon.extend(sampled);
    }
    (polygon.len() >= 3).then_some(polygon)
}

pub(crate) fn xz(graph: &SessionGraph, id: &NodeId) -> Option<[f32; 2]> {
    graph.node(id).map(|node| {
        let position = node.data();
        [position[0], position[2]]
    })
}

fn centroid_of(graph: &SessionGraph, nodes: &[NodeId]) -> Option<[f32; 3]> {
    if nodes.is_empty() {
        return None;
    }
    let mut sum = [0.0_f32; 3];
    for id in nodes {
        let position = graph.node(id)?.data();
        for axis in 0..3 {
            sum[axis] += position[axis];
        }
    }
    let count = nodes.len() as f32;
    Some([sum[0] / count, sum[1] / count, sum[2] / count])
}

/// Every registered region the footprint touches.
///
/// Deliberately reports both centroid-covered and merely-overlapping
/// regions, tagged: different structure types need different rules from the
/// same query, and re-running it per type would be the same work twice.
pub fn footprint_coverage(
    graph: &SessionGraph,
    topology: &ContourTopology,
    surfaces: &SurfaceRegistry,
    request: FootprintCoverageRequest,
) -> Result<FootprintCoverageResponse, String> {
    if request.polygon.len() < 3 {
        return Err("a footprint polygon needs at least three points".into());
    }
    let mut covered = Vec::new();
    for region_id in topology.region_ids() {
        let Some(dto) = covered_region(graph, topology, surfaces, &region_id, &request.polygon)?
        else {
            continue;
        };
        covered.push(dto);
    }
    Ok(FootprintCoverageResponse { covered })
}

fn covered_region(
    graph: &SessionGraph,
    topology: &ContourTopology,
    surfaces: &SurfaceRegistry,
    region_id: &RegionId,
    footprint: &[[f32; 2]],
) -> Result<Option<CoveredRegionDto>, String> {
    let (Some(region), Some(surface)) = (
        topology.region(region_id),
        surfaces.region_surface(region_id),
    ) else {
        return Ok(None);
    };
    let nodes = topology
        .region_nodes(region_id)
        .map_err(|error| error.to_string())?;
    let Some(centroid) = centroid_of(graph, &nodes) else {
        return Ok(None);
    };

    let mut overlaps = false;
    for loop_ in region.outer_loops() {
        let Some(polygon) = loop_polygon(topology, graph, loop_) else {
            continue;
        };
        // Overlap in either direction: a small face wholly inside the brush
        // has no vertex outside it, and a brush wholly inside a huge face
        // has no vertex inside the face -- checking only one direction
        // misses one of those every time.
        if polygon
            .iter()
            .any(|&point| polygon_contains_point(footprint, point))
            || footprint
                .iter()
                .any(|&point| polygon_contains_point(&polygon, point))
        {
            overlaps = true;
            break;
        }
    }
    let centroid_inside = polygon_contains_point(footprint, [centroid[0], centroid[2]]);
    if !overlaps && !centroid_inside {
        return Ok(None);
    }

    Ok(Some(CoveredRegionDto {
        surface_key: region_id_to_wire(region_id),
        surface_type: surface.surface_type().as_str().to_owned(),
        physical: surface.physical(),
        coverage: if centroid_inside {
            CoverageKind::Centroid
        } else {
            CoverageKind::Overlap
        },
        centroid,
        node_ids: nodes.iter().map(|id| id.as_str().to_owned()).collect(),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifyPointsRequest {
    /// XZ points to test, in the caller's own order.
    pub points: Vec<[f32; 2]>,
}

/// One point that landed inside a region, by its index in the request.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointHitDto {
    pub index: usize,
    pub surface_key: Vec<String>,
    pub surface_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifyPointsResponse {
    /// Only the points that hit something; a point over open ground is
    /// simply absent, so the common "mostly empty" case stays small.
    pub hits: Vec<PointHitDto>,
}

/// Which of `points` fall inside an already-registered region.
///
/// The precise, cheap form of "is there already something here?" -- what a
/// generator consults per candidate face so it builds only over open ground.
/// A footprint-wide answer ([`footprint_coverage`]) cannot serve this: a
/// stroke that spans both occupied and open ground needs the distinction
/// *within* its own area, not one verdict for the whole thing.
pub fn classify_points(
    graph: &SessionGraph,
    topology: &ContourTopology,
    surfaces: &SurfaceRegistry,
    request: ClassifyPointsRequest,
) -> Result<ClassifyPointsResponse, String> {
    let mut hits = Vec::new();
    let mut polygons: Vec<(RegionId, String, Vec<Vec<[f32; 2]>>)> = Vec::new();
    for region_id in topology.region_ids() {
        let (Some(region), Some(surface)) = (
            topology.region(&region_id),
            surfaces.region_surface(&region_id),
        ) else {
            continue;
        };
        let rings: Vec<Vec<[f32; 2]>> = region
            .outer_loops()
            .iter()
            .filter_map(|loop_| loop_polygon(topology, graph, loop_))
            .collect();
        if rings.is_empty() {
            continue;
        }
        polygons.push((region_id, surface.surface_type().as_str().to_owned(), rings));
    }

    for (index, point) in request.points.iter().enumerate() {
        for (region_id, surface_type, rings) in &polygons {
            if rings
                .iter()
                .any(|ring| polygon_contains_point(ring, *point))
            {
                hits.push(PointHitDto {
                    index,
                    surface_key: region_id_to_wire(region_id),
                    surface_type: surface_type.clone(),
                });
                break;
            }
        }
    }
    Ok(ClassifyPointsResponse { hits })
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::{Graph, Node, SurfaceType, straight_cycle_region};

    /// A 2x1 pair of unit faces side by side, spanning x in 0..2, z in 0..1.
    fn two_faces() -> (SessionGraph, ContourTopology, SurfaceRegistry) {
        let mut nodes = Vec::new();
        for column in 0..3 {
            for row in 0..2 {
                nodes.push(Node::new(
                    NodeId::new(format!("n{column}_{row}")).unwrap(),
                    [column as f32, 0.0, row as f32],
                ));
            }
        }
        let graph: SessionGraph = Graph::try_from_parts(nodes, Vec::new()).unwrap();
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();
        for column in 0..2 {
            let id = RegionId::new(format!("face{column}")).unwrap();
            let cycle = [
                format!("n{column}_0"),
                format!("n{}_0", column + 1),
                format!("n{}_1", column + 1),
                format!("n{column}_1"),
            ]
            .map(|name| NodeId::new(name).unwrap());
            straight_cycle_region(&mut topology, &graph, id.clone(), &cycle).unwrap();
            surfaces
                .add_region_surface(&topology, id, SurfaceType::new("terrain"), true)
                .unwrap();
        }
        (graph, topology, surfaces)
    }

    fn coverage(polygon: Vec<[f32; 2]>) -> Vec<CoveredRegionDto> {
        let (graph, topology, surfaces) = two_faces();
        footprint_coverage(
            &graph,
            &topology,
            &surfaces,
            FootprintCoverageRequest { polygon },
        )
        .unwrap()
        .covered
    }

    #[test]
    fn a_footprint_over_one_face_reports_it_as_centroid_covered() {
        let covered = coverage(vec![[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]);
        assert_eq!(covered.len(), 1);
        assert_eq!(covered[0].surface_key, vec!["@region", "face0"]);
        assert_eq!(covered[0].coverage, CoverageKind::Centroid);
        assert_eq!(covered[0].surface_type, "terrain");
        assert_eq!(covered[0].node_ids.len(), 4);
    }

    /// The distinction the whole query exists for: a face the brush merely
    /// clips is reported separately from one it covers, so a type that swaps
    /// whole faces and a type that cuts can read the same answer differently.
    #[test]
    fn a_footprint_clipping_a_neighbour_reports_it_as_overlap_not_centroid() {
        let covered = coverage(vec![[0.1, 0.1], [1.4, 0.1], [1.4, 0.9], [0.1, 0.9]]);
        assert_eq!(covered.len(), 2);
        let kinds: Vec<(&str, CoverageKind)> = covered
            .iter()
            .map(|dto| (dto.surface_key[1].as_str(), dto.coverage))
            .collect();
        assert_eq!(
            kinds,
            vec![
                ("face0", CoverageKind::Centroid),
                ("face1", CoverageKind::Overlap)
            ]
        );
    }

    #[test]
    fn a_footprint_over_empty_space_covers_nothing() {
        assert!(coverage(vec![[9.0, 9.0], [10.0, 9.0], [10.0, 10.0], [9.0, 10.0]]).is_empty());
    }

    /// A brush smaller than the face it lands in still has to find it --
    /// no vertex of the face is inside the brush, so a one-directional
    /// containment test would report empty space.
    #[test]
    fn a_footprint_wholly_inside_one_face_still_finds_it() {
        let covered = coverage(vec![[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]]);
        assert_eq!(covered.len(), 1);
        assert_eq!(covered[0].surface_key[1], "face0");
    }

    #[test]
    fn the_reported_centroid_carries_the_face_current_height() {
        let (mut graph, topology, surfaces) = two_faces();
        for name in ["n0_0", "n1_0", "n1_1", "n0_1"] {
            let id = NodeId::new(name).unwrap();
            graph.node_mut(&id).unwrap().data_mut()[1] = 5.0;
        }
        let covered = footprint_coverage(
            &graph,
            &topology,
            &surfaces,
            FootprintCoverageRequest {
                polygon: vec![[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
            },
        )
        .unwrap()
        .covered;
        assert_eq!(covered[0].centroid[1], 5.0);
    }

    /// The distinction one footprint-wide verdict cannot give: a stroke
    /// spanning occupied and open ground needs to know, face by face, which
    /// is which. This is what stops a generator building on top of what is
    /// already there while still letting it fill the gap beside it.
    #[test]
    fn classify_points_separates_occupied_ground_from_open_ground() {
        let (graph, topology, surfaces) = two_faces();
        let response = classify_points(
            &graph,
            &topology,
            &surfaces,
            ClassifyPointsRequest {
                points: vec![[0.5, 0.5], [9.0, 9.0], [1.5, 0.5]],
            },
        )
        .unwrap();

        assert_eq!(
            response
                .hits
                .iter()
                .map(|hit| (hit.index, hit.surface_key[1].as_str()))
                .collect::<Vec<_>>(),
            vec![(0, "face0"), (2, "face1")],
            "the open-ground point is simply absent, not reported as a miss"
        );
        assert_eq!(response.hits[0].surface_type, "terrain");
    }

    #[test]
    fn classify_points_over_an_empty_session_reports_nothing() {
        let (graph, topology, surfaces) = two_faces();
        let response = classify_points(
            &graph,
            &topology,
            &surfaces,
            ClassifyPointsRequest {
                points: vec![[50.0, 50.0]],
            },
        )
        .unwrap();
        assert!(response.hits.is_empty());
    }

    #[test]
    fn a_degenerate_footprint_is_rejected_rather_than_matching_everything() {
        let (graph, topology, surfaces) = two_faces();
        let error = footprint_coverage(
            &graph,
            &topology,
            &surfaces,
            FootprintCoverageRequest {
                polygon: vec![[0.0, 0.0], [1.0, 0.0]],
            },
        )
        .unwrap_err();
        assert!(error.contains("three points"), "unexpected error: {error}");
    }
}
