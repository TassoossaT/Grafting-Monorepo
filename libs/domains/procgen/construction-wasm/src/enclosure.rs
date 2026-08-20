//! Closed loops the mesh already bounds but no face fills.
//!
//! A generator that skips a candidate face -- because it was degenerate,
//! because its corners welded onto ground that already had one, because a
//! rule refused it -- leaves a gap whose *boundary still exists*: the
//! neighbours around the gap each contribute one edge, and those edges close
//! a loop with nothing inside it. That is a hole in the surface, and it is
//! visible as one.
//!
//! This query finds them structurally rather than geometrically. It never
//! guesses where a face "should" be from proximity or coverage; it reports
//! only loops the registered edges *already close*, oriented so a face can
//! be registered along them directly. Filling one adds no edge and no node
//! -- the boundary was there all along, used once instead of twice.
//!
//! **No policy here.** Which loops are worth filling, and with what surface
//! type, is the caller's decision; this module has no opinion about terrain.

use serde::Serialize;

use std::collections::BTreeSet;

use grafting_graph_core::{
    ContourEdgeId, ContourLoop, ContourTopology, NodeId, OrientedEdgeUse,
};

use crate::editing::SessionGraph;
use crate::footprint::{loop_polygon, polygon_contains_point};

/// One oriented use of an already-registered edge, in the wire shape
/// `add_region` accepts unchanged.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryUseDto {
    pub edge_id: String,
    pub reversed: bool,
}

/// One closed loop with no face on it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnfilledLoopDto {
    /// The loop's edges, each oriented **opposite** the single region still
    /// using it. A face registered along this walks the shared boundary the
    /// other way from its neighbour, which is what makes the two manifold
    /// neighbours rather than an illegal double use in the same direction.
    pub boundary: Vec<BoundaryUseDto>,
    /// The loop's nodes in walk order -- what a caller needs to name the
    /// region it is about to create, or to decide it does not want to.
    pub node_ids: Vec<String>,
    /// The loop's centroid in world space, averaged over its nodes.
    pub centroid: [f32; 3],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnfilledLoopsResponse {
    pub loops: Vec<UnfilledLoopDto>,
}

/// Walks a loop's nodes in order, following each use's own direction.
fn loop_nodes(topology: &ContourTopology, loop_: &ContourLoop) -> Option<Vec<NodeId>> {
    let mut nodes = Vec::with_capacity(loop_.len());
    for use_ in loop_ {
        let edge = topology.edge(use_.edge())?;
        nodes.push(if use_.is_reversed() {
            edge.end_node().clone()
        } else {
            edge.start_node().clone()
        });
    }
    (nodes.len() >= 3).then_some(nodes)
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

/// Every closed loop of free boundary that some other free loop encloses.
///
/// **Why enclosure and not orientation.** Free edges split into two kinds:
/// the outer silhouette of a patch, and the rim of a hole inside it. Telling
/// them apart by winding assumes every face was registered with a consistent
/// winding, which nothing in this crate enforces -- a generator emitting one
/// quad clockwise would then have its outer boundary reported as a hole and
/// get a face laid over the whole patch. Enclosure asks the question
/// directly: a hole is a loop something else contains, and an outer
/// silhouette is contained by nothing. Disjoint patches fall out correctly
/// for free -- neither contains the other, so neither is a hole.
pub fn unfilled_loops(
    graph: &SessionGraph,
    topology: &ContourTopology,
) -> Result<UnfilledLoopsResponse, String> {
    // Oriented opposite the sole user, so what comes back is directly
    // registrable -- see `BoundaryUseDto::boundary`.
    let free: Vec<OrientedEdgeUse> = topology
        .edge_ids()
        .into_iter()
        .filter_map(|edge| {
            topology.sole_usage_reversed(&edge).map(|reversed| {
                if reversed {
                    OrientedEdgeUse::forward(edge)
                } else {
                    OrientedEdgeUse::reversed(edge)
                }
            })
        })
        .collect();
    if free.is_empty() {
        return Ok(UnfilledLoopsResponse { loops: Vec::new() });
    }

    // A hole a region *declared* -- a doorway cut in a floor, a courtyard --
    // is free boundary enclosed by that region's own outer loop, and so
    // looks exactly like a gap from the outside. It is not one: somebody
    // asked for it. Its edges are exactly the ones already listed as a
    // region's hole loop, so they are excluded by name.
    let declared: BTreeSet<ContourEdgeId> = topology
        .region_ids()
        .iter()
        .filter_map(|id| topology.region(id))
        .flat_map(|region| region.holes())
        .flatten()
        .map(|use_| use_.edge().clone())
        .collect();

    let closed = topology.assemble_oriented_loops(&free);
    let mut candidates: Vec<(ContourLoop, Vec<NodeId>, Vec<[f32; 2]>)> = Vec::new();
    for loop_ in closed {
        if loop_.iter().all(|use_| declared.contains(use_.edge())) {
            continue;
        }
        let (Some(nodes), Some(polygon)) = (
            loop_nodes(topology, &loop_),
            loop_polygon(topology, graph, &loop_),
        ) else {
            continue;
        };
        candidates.push((loop_, nodes, polygon));
    }

    let mut loops = Vec::new();
    for (index, (loop_, nodes, polygon)) in candidates.iter().enumerate() {
        // Any vertex of a hole lies strictly inside whatever encloses it, so
        // one probe settles it -- no need for area, winding, or a full
        // polygon-in-polygon test.
        let Some(&probe) = polygon.first() else {
            continue;
        };
        let enclosed = candidates
            .iter()
            .enumerate()
            .any(|(other, (_, _, outer))| other != index && polygon_contains_point(outer, probe));
        if !enclosed {
            continue;
        }
        let Some(centroid) = centroid_of(graph, nodes) else {
            continue;
        };
        loops.push(UnfilledLoopDto {
            boundary: loop_
                .iter()
                .map(|use_| BoundaryUseDto {
                    edge_id: use_.edge().as_str().to_owned(),
                    reversed: use_.is_reversed(),
                })
                .collect(),
            node_ids: nodes.iter().map(|id| id.as_str().to_owned()).collect(),
            centroid,
        });
    }
    Ok(UnfilledLoopsResponse { loops })
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::{
        ContourEdgeId, Graph, Node, RegionId, SurfaceRegistry, SurfaceType, straight_cycle_region,
    };

    use crate::region_editing::{
        AddPatchRequest, OrientedEdgeUseDto, PatchEdgeDto, PatchNodeDto, PatchRegionDto,
        apply_add_patch,
    };

    fn edge(id: &str) -> ContourEdgeId {
        ContourEdgeId::new(id.to_owned()).unwrap()
    }

    /// The reason a generator cannot let each face mint its own edges: two
    /// faces side by side end up with two coincident-but-separate edges, so
    /// nothing in the topology is ever shared and no boundary is ever free
    /// in the structural sense this module reads.
    #[test]
    fn neighbouring_faces_registered_from_cycles_do_not_share_an_edge() {
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
        let shared = topology
            .edge_ids()
            .into_iter()
            .filter(|id| topology.usage_count(id) == 2)
            .count();
        assert_eq!(
            shared, 0,
            "cycle-derived faces mint coincident but separate edges"
        );
    }

    /// A `columns` x `rows` grid of unit faces built through `apply_add_patch`
    /// with caller-named shared edges, omitting every face in `holes`.
    fn lattice(
        columns: usize,
        rows: usize,
        holes: &[(usize, usize)],
    ) -> (SessionGraph, ContourTopology, SurfaceRegistry) {
        let mut graph: SessionGraph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();

        let node_name = |column: usize, row: usize| format!("n{column}_{row}");
        let nodes: Vec<PatchNodeDto> = (0..=columns)
            .flat_map(|column| {
                (0..=rows).map(move |row| PatchNodeDto {
                    id: node_name(column, row),
                    position: [column as f32, 0.0, row as f32],
                })
            })
            .collect();

        // One edge per lattice segment, named after the segment itself, so
        // the two faces meeting on it reference the same edge.
        let horizontal = |column: usize, row: usize| format!("h{column}_{row}");
        let vertical = |column: usize, row: usize| format!("v{column}_{row}");
        let mut edges = Vec::new();
        for column in 0..columns {
            for row in 0..=rows {
                edges.push(PatchEdgeDto {
                    edge_id: horizontal(column, row),
                    start_node_id: node_name(column, row),
                    end_node_id: node_name(column + 1, row),
                });
            }
        }
        for column in 0..=columns {
            for row in 0..rows {
                edges.push(PatchEdgeDto {
                    edge_id: vertical(column, row),
                    start_node_id: node_name(column, row),
                    end_node_id: node_name(column, row + 1),
                });
            }
        }

        let mut regions = Vec::new();
        for column in 0..columns {
            for row in 0..rows {
                if holes.contains(&(column, row)) {
                    continue;
                }
                regions.push(PatchRegionDto {
                    region_id: format!("face{column}_{row}"),
                    // Walked as one consistent circuit: bottom left-to-right,
                    // right side up, top right-to-left, left side down.
                    boundary: vec![
                        OrientedEdgeUseDto {
                            edge_id: horizontal(column, row),
                            reversed: false,
                        },
                        OrientedEdgeUseDto {
                            edge_id: vertical(column + 1, row),
                            reversed: false,
                        },
                        OrientedEdgeUseDto {
                            edge_id: horizontal(column, row + 1),
                            reversed: true,
                        },
                        OrientedEdgeUseDto {
                            edge_id: vertical(column, row),
                            reversed: true,
                        },
                    ],
                    surface_type: "terrain".into(),
                    physical: true,
                });
            }
        }

        apply_add_patch(
            &mut graph,
            &mut topology,
            &mut surfaces,
            AddPatchRequest {
                nodes,
                edges,
                regions,
            },
        )
        .unwrap();
        (graph, topology, surfaces)
    }

    #[test]
    fn a_patch_of_shared_edges_leaves_every_interior_boundary_used_twice() {
        let (_graph, topology, _surfaces) = lattice(3, 3, &[]);
        let shared = topology
            .edge_ids()
            .into_iter()
            .filter(|id| topology.usage_count(id) == 2)
            .count();
        assert_eq!(shared, 12, "3x3 faces meet on twelve interior segments");
    }

    #[test]
    fn a_complete_patch_reports_no_hole() {
        let (graph, topology, _surfaces) = lattice(3, 3, &[]);
        let response = unfilled_loops(&graph, &topology).unwrap();
        assert!(
            response.loops.is_empty(),
            "the outer silhouette is free boundary but nothing encloses it"
        );
    }

    /// The whole point: a face the generator skipped leaves a loop its
    /// neighbours already close, and that loop is findable without knowing
    /// anything about how the gap came to be.
    #[test]
    fn a_missing_interior_face_is_reported_as_an_unfilled_loop() {
        let (graph, topology, _surfaces) = lattice(3, 3, &[(1, 1)]);
        let response = unfilled_loops(&graph, &topology).unwrap();
        assert_eq!(response.loops.len(), 1);
        let hole = &response.loops[0];
        assert_eq!(hole.boundary.len(), 4);
        assert_eq!(hole.centroid, [1.5, 0.0, 1.5], "the gap's own centre");

        let mut named: Vec<&str> = hole.node_ids.iter().map(String::as_str).collect();
        named.sort();
        assert_eq!(named, vec!["n1_1", "n1_2", "n2_1", "n2_2"]);
    }

    /// The rim comes back oriented for the face that fills it, so
    /// registering it is a plain region add with no flipping -- and every
    /// edge of the gap ends up used exactly twice, which is what "the hole
    /// is closed" means structurally.
    #[test]
    fn a_reported_loop_is_registrable_verbatim_and_closes_the_hole() {
        let (mut graph, mut topology, mut surfaces) = lattice(3, 3, &[(1, 1)]);
        let hole = unfilled_loops(&graph, &topology)
            .unwrap()
            .loops
            .pop()
            .unwrap();
        let boundary: Vec<OrientedEdgeUseDto> = hole
            .boundary
            .iter()
            .map(|use_| OrientedEdgeUseDto {
                edge_id: use_.edge_id.clone(),
                reversed: use_.reversed,
            })
            .collect();

        apply_add_patch(
            &mut graph,
            &mut topology,
            &mut surfaces,
            AddPatchRequest {
                nodes: Vec::new(),
                edges: Vec::new(),
                regions: vec![PatchRegionDto {
                    region_id: "patched".into(),
                    boundary,
                    surface_type: "terrain".into(),
                    physical: true,
                }],
            },
        )
        .expect("the reported rim registers as-is");

        for use_ in &hole.boundary {
            assert_eq!(
                topology.usage_count(&edge(&use_.edge_id)),
                2,
                "{} should now be shared by the gap's face and its neighbour",
                use_.edge_id
            );
        }
        assert!(unfilled_loops(&graph, &topology).unwrap().loops.is_empty());
    }

    /// Two separate patches are not each other's holes, however close they
    /// sit -- neither encloses the other.
    #[test]
    fn two_disjoint_patches_report_no_hole_between_them() {
        let (mut graph, mut topology, mut surfaces) = lattice(2, 2, &[]);
        apply_add_patch(
            &mut graph,
            &mut topology,
            &mut surfaces,
            AddPatchRequest {
                nodes: vec![
                    PatchNodeDto {
                        id: "f0".into(),
                        position: [10.0, 0.0, 0.0],
                    },
                    PatchNodeDto {
                        id: "f1".into(),
                        position: [11.0, 0.0, 0.0],
                    },
                    PatchNodeDto {
                        id: "f2".into(),
                        position: [11.0, 0.0, 1.0],
                    },
                    PatchNodeDto {
                        id: "f3".into(),
                        position: [10.0, 0.0, 1.0],
                    },
                ],
                edges: vec![
                    PatchEdgeDto {
                        edge_id: "fa".into(),
                        start_node_id: "f0".into(),
                        end_node_id: "f1".into(),
                    },
                    PatchEdgeDto {
                        edge_id: "fb".into(),
                        start_node_id: "f1".into(),
                        end_node_id: "f2".into(),
                    },
                    PatchEdgeDto {
                        edge_id: "fc".into(),
                        start_node_id: "f2".into(),
                        end_node_id: "f3".into(),
                    },
                    PatchEdgeDto {
                        edge_id: "fd".into(),
                        start_node_id: "f3".into(),
                        end_node_id: "f0".into(),
                    },
                ],
                regions: vec![PatchRegionDto {
                    region_id: "far".into(),
                    boundary: ["fa", "fb", "fc", "fd"]
                        .into_iter()
                        .map(|edge_id| OrientedEdgeUseDto {
                            edge_id: edge_id.into(),
                            reversed: false,
                        })
                        .collect(),
                    surface_type: "terrain".into(),
                    physical: true,
                }],
            },
        )
        .unwrap();
        assert!(unfilled_loops(&graph, &topology).unwrap().loops.is_empty());
    }
    /// A hole somebody asked for is not a hole to repair. A floor with a
    /// doorway cut in it looks identical from the outside -- free boundary
    /// enclosed by the floor's own silhouette -- so without this the very
    /// next stroke would seal every door on the table.
    #[test]
    fn a_hole_a_region_declared_is_left_alone() {
        let mut graph: SessionGraph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut topology = ContourTopology::new();
        let mut surfaces = SurfaceRegistry::new();

        // Outer square 0..4, inner square 1..3 declared as its hole.
        let corners = [
            ("o0", [0.0, 0.0, 0.0]),
            ("o1", [4.0, 0.0, 0.0]),
            ("o2", [4.0, 0.0, 4.0]),
            ("o3", [0.0, 0.0, 4.0]),
            ("i0", [1.0, 0.0, 1.0]),
            ("i1", [3.0, 0.0, 1.0]),
            ("i2", [3.0, 0.0, 3.0]),
            ("i3", [1.0, 0.0, 3.0]),
        ];
        let nodes = corners
            .iter()
            .map(|(id, position)| PatchNodeDto {
                id: (*id).into(),
                position: *position,
            })
            .collect();
        let ring = |prefix: &str| {
            (0..4)
                .map(|index| PatchEdgeDto {
                    edge_id: format!("{prefix}e{index}"),
                    start_node_id: format!("{prefix}{index}"),
                    end_node_id: format!("{prefix}{}", (index + 1) % 4),
                })
                .collect::<Vec<_>>()
        };
        let mut edges = ring("o");
        edges.extend(ring("i"));

        apply_add_patch(
            &mut graph,
            &mut topology,
            &mut surfaces,
            AddPatchRequest {
                nodes,
                edges,
                regions: Vec::new(),
            },
        )
        .unwrap();

        let loop_of = |prefix: &str, reversed: bool| {
            (0..4)
                .map(|index| OrientedEdgeUse::forward(
                    ContourEdgeId::new(format!("{prefix}e{index}")).unwrap(),
                ))
                .map(|use_| {
                    if reversed {
                        OrientedEdgeUse::reversed(use_.edge().clone())
                    } else {
                        use_
                    }
                })
                .collect::<Vec<_>>()
        };
        let floor = RegionId::new("floor").unwrap();
        topology
            .add_region(floor.clone(), vec![loop_of("o", false)], vec![loop_of("i", false)])
            .unwrap();
        surfaces
            .add_region_surface(&topology, floor, SurfaceType::new("floor"), true)
            .unwrap();

        assert!(
            unfilled_loops(&graph, &topology).unwrap().loops.is_empty(),
            "the declared hole is somebody's doorway, not a gap to seal"
        );
    }
}
