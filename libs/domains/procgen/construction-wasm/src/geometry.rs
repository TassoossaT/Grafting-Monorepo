//! Shared 2D (XZ-plane) point-in-polygon geometry, used wherever "does this
//! candidate belong to this boundary's own footprint" must be a true
//! point-in-polygon test rather than a bounding-box one -- a bounding box
//! drawn around a concave or curved boundary is strictly bigger than the
//! boundary itself, and can wrongly claim a different, nearby boundary's
//! own geometry. Extracted from `boundary_delete`'s own original
//! implementation once `generation` needed the identical test to scope a
//! closed loop's own prior geometry for diffing.
//!
//! Also holds `connected_component`, `ADR-0022`'s "cloud" query: the
//! connected component of same-`type` surfaces reachable from a seed by
//! shared graph nodes. Graph adjacency never depends on `type` (see the
//! ADR); this is the one place that reads `type` at all, and only to
//! filter which already-adjacent surfaces belong to one cloud, never to
//! decide adjacency itself.

use std::collections::{HashSet, VecDeque};

use grafting_graph_core::{SurfaceKey, SurfaceRegistry, SurfaceType};

/// True if `point` lies on (within `EPS`) one of `polygon`'s own edges, or
/// strictly inside it (standard ray-casting, which handles a concave --
/// non-convex -- simple polygon correctly). The on-edge check is checked
/// first and separately because ray-casting alone is unreliable exactly
/// on a boundary.
pub(crate) fn point_in_or_on_polygon(point: (f32, f32), polygon: &[(f32, f32)]) -> bool {
    const EPS: f32 = 1e-3;
    let n = polygon.len();
    if n < 3 {
        return false;
    }
    for i in 0..n {
        if on_segment(point, polygon[i], polygon[(i + 1) % n], EPS) {
            return true;
        }
    }
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, zi) = polygon[i];
        let (xj, zj) = polygon[j];
        if (zi > point.1) != (zj > point.1) {
            let x_intersect = xi + (point.1 - zi) * (xj - xi) / (zj - zi);
            if point.0 < x_intersect {
                inside = !inside;
            }
        }
        j = i;
    }
    inside
}

fn on_segment(point: (f32, f32), a: (f32, f32), b: (f32, f32), eps: f32) -> bool {
    let cross = (point.0 - a.0) * (b.1 - a.1) - (point.1 - a.1) * (b.0 - a.0);
    if cross.abs() > eps {
        return false;
    }
    let dot = (point.0 - a.0) * (b.0 - a.0) + (point.1 - a.1) * (b.1 - a.1);
    let len_sq = (b.0 - a.0).powi(2) + (b.1 - a.1).powi(2);
    dot >= -eps && dot <= len_sq + eps
}

/// The connected component of `known_surfaces` reachable from `seed` by
/// repeatedly stepping to another known surface of the same `same_type`
/// that shares at least one graph node with a surface already in the
/// component. Empty if `seed` itself is not a known surface of
/// `same_type`. A different-type seam a candidate surface sits across
/// stays un-crossed (that surface's own type differs), matching the ADR's
/// "seams between different-type clouds stay connected but are not part
/// of either cloud" rule -- crossing it is a follow-up (texture blending),
/// not this query's job.
pub(crate) fn connected_component(surfaces: &SurfaceRegistry, known_surfaces: &HashSet<SurfaceKey>, seed: &SurfaceKey, same_type: &SurfaceType) -> HashSet<SurfaceKey> {
    let mut visited: HashSet<SurfaceKey> = HashSet::new();
    let mut queue: VecDeque<SurfaceKey> = VecDeque::new();

    let seed_matches = surfaces.surface(seed).map(|surface| surface.surface_type() == same_type).unwrap_or(false);
    if seed_matches && known_surfaces.contains(seed) {
        visited.insert(seed.clone());
        queue.push_back(seed.clone());
    }

    while let Some(current) = queue.pop_front() {
        let cycle = surfaces.surface(&current).expect("every queued key was already confirmed to exist").cycle().to_vec();
        for node_id in &cycle {
            for candidate in surfaces.surfaces_referencing(node_id) {
                if visited.contains(candidate) || !known_surfaces.contains(candidate) {
                    continue;
                }
                let matches = surfaces.surface(candidate).map(|surface| surface.surface_type() == same_type).unwrap_or(false);
                if matches {
                    visited.insert(candidate.clone());
                    queue.push_back(candidate.clone());
                }
            }
        }
    }

    visited
}

#[cfg(test)]
mod cloud_tests {
    use super::*;
    use grafting_graph_core::{Graph, Node, NodeId};

    use crate::editing::SessionGraph;

    #[test]
    fn two_same_type_surfaces_sharing_a_node_form_one_cloud() {
        let mut graph: SessionGraph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let mut known = HashSet::new();

        for id in ["shared", "a2", "a3", "b2", "b3"] {
            graph.add_node(Node::new(NodeId::new(id).unwrap(), [0.0; 3])).unwrap();
        }

        let key_a = surfaces
            .add_surface(&graph, vec![NodeId::new("shared").unwrap(), NodeId::new("a2").unwrap(), NodeId::new("a3").unwrap()], SurfaceType::new("terrain"), true)
            .unwrap();
        let key_b = surfaces
            .add_surface(&graph, vec![NodeId::new("shared").unwrap(), NodeId::new("b2").unwrap(), NodeId::new("b3").unwrap()], SurfaceType::new("terrain"), true)
            .unwrap();
        known.insert(key_a.clone());
        known.insert(key_b.clone());

        let cloud = connected_component(&surfaces, &known, &key_a, &SurfaceType::new("terrain"));
        assert!(cloud.contains(&key_a));
        assert!(cloud.contains(&key_b));
    }

    #[test]
    fn a_different_type_surface_across_the_seam_is_excluded() {
        let mut graph: SessionGraph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let mut known = HashSet::new();

        for id in ["shared", "a2", "a3", "b2", "b3"] {
            graph.add_node(Node::new(NodeId::new(id).unwrap(), [0.0; 3])).unwrap();
        }

        let key_a = surfaces
            .add_surface(&graph, vec![NodeId::new("shared").unwrap(), NodeId::new("a2").unwrap(), NodeId::new("a3").unwrap()], SurfaceType::new("terrain"), true)
            .unwrap();
        let key_b = surfaces
            .add_surface(&graph, vec![NodeId::new("shared").unwrap(), NodeId::new("b2").unwrap(), NodeId::new("b3").unwrap()], SurfaceType::new("path"), true)
            .unwrap();
        known.insert(key_a.clone());
        known.insert(key_b.clone());

        let cloud = connected_component(&surfaces, &known, &key_a, &SurfaceType::new("terrain"));
        assert!(cloud.contains(&key_a));
        assert!(!cloud.contains(&key_b));
    }

    #[test]
    fn a_seed_not_in_known_surfaces_yields_an_empty_cloud() {
        let mut graph: SessionGraph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut surfaces = SurfaceRegistry::new();
        for id in ["a", "b", "c"] {
            graph.add_node(Node::new(NodeId::new(id).unwrap(), [0.0; 3])).unwrap();
        }
        let key = surfaces.add_surface(&graph, vec![NodeId::new("a").unwrap(), NodeId::new("b").unwrap(), NodeId::new("c").unwrap()], SurfaceType::new("wall"), true).unwrap();

        let cloud = connected_component(&surfaces, &HashSet::new(), &key, &SurfaceType::new("wall"));
        assert!(cloud.is_empty());
    }
}
