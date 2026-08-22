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
//! **Scoped to the caller's own region.** The query is always asked about a
//! set of nodes -- the ones a stroke just touched -- and only boundary whose
//! *both* endpoints are in that set can take part. That is not an
//! optimisation bolted onto a global sweep; it is what makes the answer
//! right. Free boundary elsewhere on the map belongs to shapes nobody is
//! editing: a courtyard between two unrelated patches is a closed loop
//! enclosed by another closed loop, and a global sweep would pave it over
//! because a brush ran somewhere else entirely. Confining the walk to the
//! painted nodes also keeps the work proportional to the stroke rather than
//! to the table.
//!
//! **No policy here.** Which loops are worth filling, and with what surface
//! type, is the caller's decision; this module has no opinion about terrain.

use serde::{Deserialize, Serialize};

use std::collections::{BTreeMap, BTreeSet};

use grafting_graph_core::{
    ContourEdgeId, ContourLoop, ContourTopology, NodeId, OrientedEdgeUse, RegionId, SurfaceRegistry,
};

use crate::editing::SessionGraph;
use crate::footprint::{loop_polygon, polygon_contains_point, xz};

/// The region to look inside: the nodes a stroke touched.
///
/// An empty -- or two-node -- set closes nothing, and is answered with no
/// loops rather than by widening the search. A caller with no region to name
/// has no hole to fill.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnfilledLoopsRequest {
    pub node_ids: Vec<String>,
}

/// One oriented use of an already-registered edge, in the wire shape
/// `add_region` accepts unchanged.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryUseDto {
    pub edge_id: String,
    pub reversed: bool,
}

/// The face on the other side of one of a gap's edges.
///
/// Reported, never acted on: what a gap should be *made of* is policy, and
/// policy lives with the caller. All this says is what is actually there.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeighbourFaceDto {
    pub surface_type: String,
    pub physical: bool,
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
    /// The face on the far side of each boundary edge, in the loop's own
    /// walk order and with repeats -- a caller that wants the gap to match
    /// the ground around it can count them rather than guess.
    pub neighbours: Vec<NeighbourFaceDto>,
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

/// Every edge incident to each node, built once so a walk can look at the
/// fan around a node without rescanning the topology at every step.
fn incidence(topology: &ContourTopology) -> BTreeMap<NodeId, Vec<ContourEdgeId>> {
    let mut fans: BTreeMap<NodeId, Vec<ContourEdgeId>> = BTreeMap::new();
    for id in topology.edge_ids() {
        let Some(edge) = topology.edge(&id) else {
            continue;
        };
        fans.entry(edge.start_node().clone())
            .or_default()
            .push(id.clone());
        fans.entry(edge.end_node().clone()).or_default().push(id);
    }
    fans
}

/// `edge`'s far endpoint seen from `node`, or `None` if it does not touch it.
fn opposite_end(topology: &ContourTopology, edge: &ContourEdgeId, node: &NodeId) -> Option<NodeId> {
    let edge = topology.edge(edge)?;
    if edge.start_node() == node {
        Some(edge.end_node().clone())
    } else if edge.end_node() == node {
        Some(edge.start_node().clone())
    } else {
        None
    }
}

/// The edges meeting at `node`, in angular order around it in XZ.
///
/// Straight chords, which is what a terrain boundary is made of. An arc
/// leaving its node at a different angle from its chord would need its
/// tangent here instead; the walk that reads this only ever consults it at a
/// node where two gaps meet, so a wrong angle there costs one pairing, not
/// the surface.
fn fan_around(
    graph: &SessionGraph,
    topology: &ContourTopology,
    fans: &BTreeMap<NodeId, Vec<ContourEdgeId>>,
    node: &NodeId,
) -> Option<Vec<ContourEdgeId>> {
    let centre = xz(graph, node)?;
    let mut ordered: Vec<(f32, ContourEdgeId)> = Vec::new();
    for edge in fans.get(node)? {
        let Some(far) = opposite_end(topology, edge, node) else {
            continue;
        };
        let Some(point) = xz(graph, &far) else {
            continue;
        };
        ordered.push((
            (point[1] - centre[1]).atan2(point[0] - centre[0]),
            edge.clone(),
        ));
    }
    ordered.sort_by(|left, right| left.0.total_cmp(&right.0));
    Some(ordered.into_iter().map(|(_, edge)| edge).collect())
}

/// Which edge continues the *same gap* at `node` after arriving along
/// `arrived`.
///
/// Two gaps meeting at a single node -- two skipped faces sitting corner to
/// corner, which is what a patchy stroke produces constantly -- offer a walk
/// two ways onward, and taking the wrong one splices both gaps into a single
/// figure-eight loop that is not a face anybody can register. Picking by the
/// geometry around the node settles it exactly.
///
/// `arrived` is free, so exactly one face touches it, and that face occupies
/// exactly one of the two sectors meeting along it at `node`. The other
/// sector is therefore empty -- nothing can cover it without also using
/// `arrived` as a boundary -- and the edge bounding that empty sector is
/// simply `arrived`'s angular neighbour on the far side from the face's own
/// other edge here. No winding is assumed anywhere: which side is solid is
/// read off the face that is actually there.
fn continuation(
    graph: &SessionGraph,
    topology: &ContourTopology,
    fans: &BTreeMap<NodeId, Vec<ContourEdgeId>>,
    node: &NodeId,
    arrived: &ContourEdgeId,
) -> Option<ContourEdgeId> {
    let region_id = topology.regions_using_edge(arrived).into_iter().next()?;
    let region = topology.region(&region_id)?;
    let solid = region
        .outer_loops()
        .iter()
        .chain(region.holes())
        .flatten()
        .map(|use_| use_.edge())
        .find(|edge| *edge != arrived && opposite_end(topology, edge, node).is_some())?
        .clone();

    let fan = fan_around(graph, topology, fans, node)?;
    let index = fan.iter().position(|edge| edge == arrived)?;
    let before = fan[(index + fan.len() - 1) % fan.len()].clone();
    let after = fan[(index + 1) % fan.len()].clone();
    if before == solid {
        Some(after)
    } else if after == solid {
        Some(before)
    } else {
        None
    }
}

/// Chains free boundary into closed loops, resolving a node where two gaps
/// meet by [`continuation`] rather than by whichever edge happened to come
/// first in the list.
///
/// A walk that cannot close puts back every edge it consumed. Otherwise one
/// open chain -- a rim running off the edge of the caller's scope -- would
/// swallow edges belonging to loops that *do* close, and the gaps they bound
/// would go unreported for a reason having nothing to do with them.
fn assemble_free_loops(
    graph: &SessionGraph,
    topology: &ContourTopology,
    free: &[OrientedEdgeUse],
) -> Vec<ContourLoop> {
    let fans = incidence(topology);
    let ends = |use_: &OrientedEdgeUse| -> Option<(NodeId, NodeId)> {
        let edge = topology.edge(use_.edge())?;
        Some(if use_.is_reversed() {
            (edge.end_node().clone(), edge.start_node().clone())
        } else {
            (edge.start_node().clone(), edge.end_node().clone())
        })
    };

    let mut outgoing: BTreeMap<NodeId, Vec<usize>> = BTreeMap::new();
    for (index, use_) in free.iter().enumerate() {
        if let Some((start, _)) = ends(use_) {
            outgoing.entry(start).or_default().push(index);
        }
    }

    let mut used = vec![false; free.len()];
    let mut loops = Vec::new();
    for seed in 0..free.len() {
        if used[seed] {
            continue;
        }
        let Some((origin, mut cursor)) = ends(&free[seed]) else {
            continue;
        };
        let mut walked = vec![seed];
        let mut arrived = free[seed].edge().clone();
        used[seed] = true;

        while cursor != origin {
            let candidates: Vec<usize> = outgoing
                .get(&cursor)
                .into_iter()
                .flatten()
                .copied()
                .filter(|index| !used[*index])
                .collect();
            let chosen = match candidates.as_slice() {
                [] => None,
                [only] => Some(*only),
                _ => continuation(graph, topology, &fans, &cursor, &arrived).and_then(|edge| {
                    candidates
                        .iter()
                        .copied()
                        .find(|index| *free[*index].edge() == edge)
                }),
            };
            let Some(index) = chosen else {
                break;
            };
            let Some((_, end)) = ends(&free[index]) else {
                break;
            };
            used[index] = true;
            walked.push(index);
            arrived = free[index].edge().clone();
            cursor = end;
        }

        if cursor == origin {
            loops.push(walked.iter().map(|index| free[*index].clone()).collect());
        } else {
            for index in walked {
                used[index] = false;
            }
        }
    }
    loops
}

/// A point in the middle of a region, for asking which side of a loop it is
/// on.
///
/// The centroid of the region's outer loop, which is inside it for the
/// convex faces a lattice produces. For a region shaped so that its own
/// centroid falls outside it, the answer degrades toward "this loop is not a
/// gap" -- the safe direction, since the cost is a hole left alone rather
/// than a face laid over something.
fn region_probe(
    graph: &SessionGraph,
    topology: &ContourTopology,
    region: &RegionId,
) -> Option<[f32; 2]> {
    let outer = topology.region(region)?.outer_loops().first()?.clone();
    let polygon = loop_polygon(topology, graph, &outer)?;
    if polygon.is_empty() {
        return None;
    }
    let mut sum = [0.0_f32; 2];
    for point in &polygon {
        sum[0] += point[0];
        sum[1] += point[1];
    }
    let count = polygon.len() as f32;
    Some([sum[0] / count, sum[1] / count])
}

/// What sits on the far side of each of a gap's edges, in walk order.
///
/// Repeats are kept on purpose. A gap bounded on three sides by one kind of
/// ground and on one side by another is a fact about the gap, and a caller
/// deciding what to fill it with wants the counts, not a set.
fn neighbours_of(
    topology: &ContourTopology,
    surfaces: &SurfaceRegistry,
    loop_: &ContourLoop,
) -> Vec<NeighbourFaceDto> {
    let mut faces = Vec::with_capacity(loop_.len());
    for use_ in loop_ {
        let Some(region) = topology.regions_using_edge(use_.edge()).into_iter().next() else {
            continue;
        };
        let Some(surface) = surfaces.region_surface(&region) else {
            continue;
        };
        faces.push(NeighbourFaceDto {
            surface_type: surface.surface_type().as_str().to_owned(),
            physical: surface.physical(),
        });
    }
    faces
}

/// Whether any face along this loop lies *inside* it.
///
/// This is what tells a gap from the outline of the surface around it, and
/// it asks only about the faces the loop already touches -- no second loop
/// has to be present for the answer to be right. A gap's rim has its
/// neighbours on the outside of it; a patch's own outline has them on the
/// inside, because it goes around them. That difference is what lets the
/// query answer for a *part* of a surface: a brush covering the middle of an
/// existing patch names nodes whose outline is nowhere in scope, and asking
/// "what encloses this loop" would find nothing to enclose it and call the
/// gap no gap at all.
fn wraps_a_neighbour(
    graph: &SessionGraph,
    topology: &ContourTopology,
    probes: &mut BTreeMap<RegionId, Option<[f32; 2]>>,
    loop_: &ContourLoop,
    polygon: &[[f32; 2]],
) -> bool {
    for use_ in loop_ {
        for region in topology.regions_using_edge(use_.edge()) {
            let probe = match probes.get(&region) {
                Some(cached) => *cached,
                None => {
                    let computed = region_probe(graph, topology, &region);
                    probes.insert(region.clone(), computed);
                    computed
                }
            };
            if let Some(point) = probe {
                if polygon_contains_point(polygon, point) {
                    return true;
                }
            }
        }
    }
    false
}

/// Every closed loop of free boundary, *within `request`'s nodes*, that no
/// face fills.
///
/// **Why the neighbours and not the winding.** Free edges split into two
/// kinds: the outline of a patch, and the rim of a gap inside it. Telling
/// them apart by winding assumes every face was registered with a consistent
/// winding, which nothing in this crate enforces -- a generator emitting one
/// quad clockwise would then have its outline reported as a gap and get a
/// face laid over the whole patch. Asking where the loop's own neighbours
/// lie needs no such assumption, and needs no second loop either: a gap has
/// the faces around it on the *outside* of its rim, an outline has them on
/// the inside because it goes around them. Disjoint patches fall out for
/// free, since each outline wraps its own faces.
pub fn unfilled_loops(
    graph: &SessionGraph,
    topology: &ContourTopology,
    surfaces: &SurfaceRegistry,
    request: UnfilledLoopsRequest,
) -> Result<UnfilledLoopsResponse, String> {
    let scope: BTreeSet<NodeId> = request
        .node_ids
        .into_iter()
        .map(|id| NodeId::new(id).map_err(|error| error.to_string()))
        .collect::<Result<_, _>>()?;
    // Three nodes are the fewest that can bound anything, and an unscoped
    // call must find nothing rather than fall back to the whole map.
    if scope.len() < 3 {
        return Ok(UnfilledLoopsResponse { loops: Vec::new() });
    }

    // Oriented opposite the sole user, so what comes back is directly
    // registrable -- see `BoundaryUseDto::boundary`.
    let free: Vec<OrientedEdgeUse> = topology
        .edge_ids()
        .into_iter()
        .filter(|edge| {
            // Both endpoints, not either: an edge leaving the painted region
            // is the region's own rim seen from outside, and following it
            // would walk the search out into geometry nobody touched.
            topology.edge(edge).is_some_and(|edge| {
                scope.contains(edge.start_node()) && scope.contains(edge.end_node())
            })
        })
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

    let mut probes: BTreeMap<RegionId, Option<[f32; 2]>> = BTreeMap::new();
    let mut loops = Vec::new();
    for loop_ in assemble_free_loops(graph, topology, &free) {
        if loop_.iter().all(|use_| declared.contains(use_.edge())) {
            continue;
        }
        let (Some(nodes), Some(polygon)) = (
            loop_nodes(topology, &loop_),
            loop_polygon(topology, graph, &loop_),
        ) else {
            continue;
        };
        if wraps_a_neighbour(graph, topology, &mut probes, &loop_, &polygon) {
            continue;
        }
        let Some(centroid) = centroid_of(graph, &nodes) else {
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
            neighbours: neighbours_of(topology, surfaces, &loop_),
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

    /// Every node any region uses -- the scope a stroke that had painted the
    /// whole fixture would name.
    fn scope_of(topology: &ContourTopology) -> UnfilledLoopsRequest {
        UnfilledLoopsRequest {
            node_ids: topology
                .nodes_in_use()
                .iter()
                .map(|id| id.as_str().to_owned())
                .collect(),
        }
    }

    fn scope(names: &[&str]) -> UnfilledLoopsRequest {
        UnfilledLoopsRequest {
            node_ids: names.iter().map(|name| (*name).to_owned()).collect(),
        }
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
                    geometry: None,
                });
            }
        }
        for column in 0..=columns {
            for row in 0..rows {
                edges.push(PatchEdgeDto {
                    edge_id: vertical(column, row),
                    start_node_id: node_name(column, row),
                    end_node_id: node_name(column, row + 1),
                    geometry: None,
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
        let (graph, topology, surfaces) = lattice(3, 3, &[]);
        let response = unfilled_loops(&graph, &topology, &surfaces, scope_of(&topology)).unwrap();
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
        let (graph, topology, surfaces) = lattice(3, 3, &[(1, 1)]);
        let response = unfilled_loops(&graph, &topology, &surfaces, scope_of(&topology)).unwrap();
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
        let hole = unfilled_loops(&graph, &topology, &surfaces, scope_of(&topology))
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
        assert!(unfilled_loops(&graph, &topology, &surfaces, scope_of(&topology)).unwrap().loops.is_empty());
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
                        geometry: None,
                    },
                    PatchEdgeDto {
                        edge_id: "fb".into(),
                        start_node_id: "f1".into(),
                        end_node_id: "f2".into(),
                        geometry: None,
                    },
                    PatchEdgeDto {
                        edge_id: "fc".into(),
                        start_node_id: "f2".into(),
                        end_node_id: "f3".into(),
                        geometry: None,
                    },
                    PatchEdgeDto {
                        edge_id: "fd".into(),
                        start_node_id: "f3".into(),
                        end_node_id: "f0".into(),
                        geometry: None,
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
        assert!(unfilled_loops(&graph, &topology, &surfaces, scope_of(&topology)).unwrap().loops.is_empty());
    }

    /// The scope is the answer, not a speed-up. A stroke somewhere else on
    /// the table must leave an existing gap exactly as it found it --
    /// without this, painting in one corner would quietly pave over a gap in
    /// another, and a courtyard between two patches is precisely such a gap.
    #[test]
    fn a_gap_outside_the_named_region_is_not_reported() {
        let (graph, topology, surfaces) = lattice(3, 3, &[(1, 1)]);
        let elsewhere = scope(&["n0_0", "n1_0", "n1_1", "n0_1"]);
        assert!(
            unfilled_loops(&graph, &topology, &surfaces, elsewhere)
                .unwrap()
                .loops
                .is_empty(),
            "the gap at (1,1) belongs to nodes this caller never named"
        );
        // ...and the same graph still reports it to a caller that did.
        assert_eq!(
            unfilled_loops(&graph, &topology, &surfaces, scope_of(&topology))
                .unwrap()
                .loops
                .len(),
            1
        );
    }

    /// A caller naming nothing gets nothing. An empty scope must never be
    /// read as "look everywhere" -- that is the whole-map sweep this query
    /// exists to avoid, and it would arrive by accident.
    #[test]
    fn an_empty_scope_finds_nothing_rather_than_everything() {
        let (graph, topology, surfaces) = lattice(3, 3, &[(1, 1)]);
        assert!(
            unfilled_loops(&graph, &topology, &surfaces, scope(&[]))
                .unwrap()
                .loops
                .is_empty()
        );
    }

    /// A stroke that painted an unbroken patch has one closed loop in scope
    /// -- its own outline -- and that is not a hole. This is the ordinary
    /// case, and it must add nothing.
    #[test]
    fn a_region_whose_only_loop_is_its_own_outline_is_left_alone() {
        let (graph, topology, surfaces) = lattice(2, 2, &[]);
        assert!(
            unfilled_loops(&graph, &topology, &surfaces, scope_of(&topology))
                .unwrap()
                .loops
                .is_empty()
        );
    }

    /// Two gaps touching at one corner, which a patchy stroke produces
    /// constantly. Walking the free boundary greedily splices them into one
    /// figure-eight loop through the shared node: a single bow-tie "face"
    /// that fills neither gap, and one report where there should be two.
    #[test]
    fn two_gaps_meeting_at_a_corner_are_two_loops_not_a_figure_eight() {
        let (graph, topology, surfaces) = lattice(4, 4, &[(1, 1), (2, 2)]);
        let response = unfilled_loops(&graph, &topology, &surfaces, scope_of(&topology)).unwrap();
        assert_eq!(response.loops.len(), 2, "one loop per gap");
        let mut centres: Vec<[f32; 3]> = response.loops.iter().map(|l| l.centroid).collect();
        centres.sort_by(|left, right| left[0].total_cmp(&right[0]));
        assert_eq!(centres, vec![[1.5, 0.0, 1.5], [2.5, 0.0, 2.5]]);
        for hole in &response.loops {
            assert_eq!(hole.boundary.len(), 4, "each gap keeps its own four sides");
        }
    }

    /// Two gaps sharing a whole edge are one gap, and come back as one
    /// six-sided loop rather than two overlapping quads.
    #[test]
    fn two_gaps_sharing_an_edge_are_reported_as_one() {
        let (graph, topology, surfaces) = lattice(4, 4, &[(1, 1), (2, 1)]);
        let response = unfilled_loops(&graph, &topology, &surfaces, scope_of(&topology)).unwrap();
        assert_eq!(response.loops.len(), 1);
        assert_eq!(response.loops[0].boundary.len(), 6);
    }

    /// A gap comes back with the ground around it described, so a caller can
    /// fill it to match instead of stamping whatever its brush is set to --
    /// which is how a mended gap ends up a different colour from the patch
    /// it sits in.
    #[test]
    fn a_gap_reports_what_each_of_its_sides_is_made_of() {
        let (graph, topology, mut surfaces) = lattice(3, 3, &[(1, 1)]);
        surfaces
            .set_region_type(
                &RegionId::new("face0_1").unwrap(),
                SurfaceType::new("terrain-grass"),
            )
            .unwrap();

        let response = unfilled_loops(&graph, &topology, &surfaces, scope_of(&topology)).unwrap();
        let hole = &response.loops[0];
        let mut kinds: Vec<&str> = hole
            .neighbours
            .iter()
            .map(|face| face.surface_type.as_str())
            .collect();
        kinds.sort();
        assert_eq!(
            kinds,
            vec!["terrain", "terrain", "terrain", "terrain-grass"],
            "one side is the retyped face, three are plain terrain"
        );
        assert!(hole.neighbours.iter().all(|face| face.physical));
    }

    /// The repaint case, and the reason the outline cannot be what decides.
    /// A brush passing over the middle of an existing patch names only the
    /// nodes it covered; the patch's own outline is nowhere in that scope,
    /// and every edge bounding the scope is interior to the patch and so not
    /// free at all. The gap is still a gap, and still fillable.
    #[test]
    fn a_gap_is_found_when_the_scope_covers_only_the_middle_of_a_patch() {
        let (graph, topology, surfaces) = lattice(4, 4, &[(1, 1)]);
        let middle: Vec<String> = (0..=3)
            .flat_map(|column| (0..=3).map(move |row| format!("n{column}_{row}")))
            .collect();
        let named: Vec<&str> = middle.iter().map(String::as_str).collect();
        let response = unfilled_loops(&graph, &topology, &surfaces, scope(&named)).unwrap();
        assert_eq!(response.loops.len(), 1, "the gap in the middle");
        assert_eq!(response.loops[0].centroid, [1.5, 0.0, 1.5]);
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
                    geometry: None,
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
            unfilled_loops(&graph, &topology, &surfaces, scope_of(&topology)).unwrap().loops.is_empty(),
            "the declared hole is somebody's doorway, not a gap to seal"
        );
    }
    /// A later stroke welding onto a segment that already has a face on
    /// both sides is asking for a third face on it. That is terrain being
    /// created above terrain, and the manifold rule is where it becomes
    /// precise -- but it must cost that one face, not the whole stroke.
    #[test]
    fn a_face_reusing_an_interior_edge_is_skipped_not_thrown() {
        let (mut graph, mut topology, mut surfaces) = lattice(2, 1, &[]);
        // The segment between the two faces is interior: used twice.
        assert_eq!(topology.usage_count(&edge("v1_0")), 2);

        let response = apply_add_patch(
            &mut graph,
            &mut topology,
            &mut surfaces,
            AddPatchRequest {
                nodes: vec![
                    PatchNodeDto {
                        id: "extra".into(),
                        position: [1.5, 0.0, 0.5],
                    },
                    PatchNodeDto {
                        id: "y0".into(),
                        position: [20.0, 0.0, 0.0],
                    },
                    PatchNodeDto {
                        id: "y1".into(),
                        position: [21.0, 0.0, 0.0],
                    },
                    PatchNodeDto {
                        id: "y2".into(),
                        position: [21.0, 0.0, 1.0],
                    },
                ],
                edges: vec![
                    PatchEdgeDto {
                        edge_id: "xa".into(),
                        start_node_id: "n1_1".into(),
                        end_node_id: "extra".into(),
                        geometry: None,
                    },
                    PatchEdgeDto {
                        edge_id: "xb".into(),
                        start_node_id: "extra".into(),
                        end_node_id: "n1_0".into(),
                        geometry: None,
                    },
                    PatchEdgeDto {
                        edge_id: "ya".into(),
                        start_node_id: "y0".into(),
                        end_node_id: "y1".into(),
                        geometry: None,
                    },
                    PatchEdgeDto {
                        edge_id: "yb".into(),
                        start_node_id: "y1".into(),
                        end_node_id: "y2".into(),
                        geometry: None,
                    },
                    PatchEdgeDto {
                        edge_id: "yc".into(),
                        start_node_id: "y2".into(),
                        end_node_id: "y0".into(),
                        geometry: None,
                    },
                ],
                regions: vec![
                    PatchRegionDto {
                        region_id: "intruder".into(),
                        boundary: vec![
                            OrientedEdgeUseDto {
                                edge_id: "v1_0".into(),
                                reversed: false,
                            },
                            OrientedEdgeUseDto {
                                edge_id: "xa".into(),
                                reversed: false,
                            },
                            OrientedEdgeUseDto {
                                edge_id: "xb".into(),
                                reversed: false,
                            },
                        ],
                        surface_type: "terrain".into(),
                        physical: true,
                    },
                    PatchRegionDto {
                        region_id: "innocent".into(),
                        boundary: vec![
                            OrientedEdgeUseDto {
                                edge_id: "ya".into(),
                                reversed: false,
                            },
                            OrientedEdgeUseDto {
                                edge_id: "yb".into(),
                                reversed: false,
                            },
                            OrientedEdgeUseDto {
                                edge_id: "yc".into(),
                                reversed: false,
                            },
                        ],
                        surface_type: "terrain".into(),
                        physical: true,
                    },
                ],
            },
        )
        .expect("one refused face must not abort the batch");

        assert_eq!(response.skipped_region_ids, vec!["intruder".to_string()]);
        assert_eq!(
            response.outcome.created_surface_keys.len(),
            1,
            "the face standing on open ground still went in"
        );
        assert_eq!(
            topology.usage_count(&edge("v1_0")),
            2,
            "the interior segment still has exactly its two faces"
        );
        assert!(
            topology.edge(&edge("xa")).is_none() && topology.edge(&edge("xb")).is_none(),
            "edges minted only for the refused face leave no debris"
        );
    }
}
