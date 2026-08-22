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
//! connected component of same-`type` regions reachable from a seed by
//! shared graph nodes. Graph adjacency never depends on `type` (see the
//! ADR); this is the one place that reads `type` at all, and only to
//! filter which already-adjacent regions belong to one cloud, never to
//! decide adjacency itself.

use std::collections::{HashSet, VecDeque};

use grafting_graph_core::{ContourTopology, RegionId, SurfaceRegistry, SurfaceType};

/// The connected component of same-`type` regions reachable from `seed` by
/// shared graph nodes -- `ADR-0022`'s "cloud" query. Empty if `seed` itself
/// is not a known region of `same_type`.
///
/// Adjacency comes from the topology, never from `type`: two regions are
/// neighbours because a node is on both their boundaries. `type` only
/// filters which already-adjacent regions belong to one cloud, matching the
/// ADR's rule that a seam between different-type clouds stays connected
/// without being part of either.
pub(crate) fn connected_component(
    surfaces: &SurfaceRegistry,
    topology: &ContourTopology,
    known_regions: &HashSet<RegionId>,
    seed: &RegionId,
    same_type: &SurfaceType,
) -> HashSet<RegionId> {
    let matches = |id: &RegionId| {
        known_regions.contains(id)
            && surfaces
                .region_surface(id)
                .is_some_and(|surface| surface.surface_type() == same_type)
    };

    let mut visited: HashSet<RegionId> = HashSet::new();
    let mut queue: VecDeque<RegionId> = VecDeque::new();
    if matches(seed) {
        visited.insert(seed.clone());
        queue.push_back(seed.clone());
    }

    while let Some(current) = queue.pop_front() {
        let Ok(nodes) = topology.region_nodes(&current) else {
            continue;
        };
        for node_id in &nodes {
            for candidate in topology.regions_touching_node(node_id) {
                if visited.contains(&candidate) || !matches(&candidate) {
                    continue;
                }
                visited.insert(candidate.clone());
                queue.push_back(candidate);
            }
        }
    }

    visited
}

#[cfg(test)]
mod cloud_tests {
    use super::*;
    use grafting_graph_core::{Graph, Node, NodeId, straight_cycle_region};

    use crate::editing::SessionGraph;

    /// Two triangles sharing one node, each registered as its own region --
    /// the shape every cloud test needs. `shared` is on both boundaries,
    /// which is the only reason they are neighbours.
    fn two_regions(
        left_type: &str,
        right_type: &str,
    ) -> (SurfaceRegistry, ContourTopology, RegionId, RegionId) {
        let mut graph: SessionGraph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        for id in ["shared", "a2", "a3", "b2", "b3"] {
            graph
                .add_node(Node::new(NodeId::new(id).unwrap(), [0.0; 3]))
                .unwrap();
        }
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();
        let register = |topology: &mut ContourTopology,
                        surfaces: &mut SurfaceRegistry,
                        id: &str,
                        cycle: [&str; 3],
                        surface_type: &str| {
            let region_id = RegionId::new(id).unwrap();
            let nodes: Vec<NodeId> = cycle.iter().map(|id| NodeId::new(*id).unwrap()).collect();
            straight_cycle_region(topology, &graph, region_id.clone(), &nodes).unwrap();
            surfaces
                .add_region_surface(
                    topology,
                    region_id.clone(),
                    SurfaceType::new(surface_type),
                    true,
                )
                .unwrap();
            region_id
        };
        let left = register(
            &mut topology,
            &mut surfaces,
            "left",
            ["shared", "a2", "a3"],
            left_type,
        );
        let right = register(
            &mut topology,
            &mut surfaces,
            "right",
            ["shared", "b2", "b3"],
            right_type,
        );
        (surfaces, topology, left, right)
    }

    #[test]
    fn two_same_type_regions_sharing_a_node_form_one_cloud() {
        let (surfaces, topology, left, right) = two_regions("terrain", "terrain");
        let known = HashSet::from([left.clone(), right.clone()]);

        let cloud = connected_component(
            &surfaces,
            &topology,
            &known,
            &left,
            &SurfaceType::new("terrain"),
        );
        assert!(cloud.contains(&left));
        assert!(cloud.contains(&right));
    }

    #[test]
    fn a_different_type_region_across_the_seam_is_excluded() {
        let (surfaces, topology, left, right) = two_regions("terrain", "path");
        let known = HashSet::from([left.clone(), right.clone()]);

        let cloud = connected_component(
            &surfaces,
            &topology,
            &known,
            &left,
            &SurfaceType::new("terrain"),
        );
        assert!(cloud.contains(&left));
        assert!(!cloud.contains(&right));
    }

    #[test]
    fn a_seed_that_is_not_a_known_region_yields_an_empty_cloud() {
        let (surfaces, topology, left, _right) = two_regions("terrain", "terrain");

        let cloud = connected_component(
            &surfaces,
            &topology,
            &HashSet::new(),
            &left,
            &SurfaceType::new("terrain"),
        );
        assert!(cloud.is_empty());
    }
}
