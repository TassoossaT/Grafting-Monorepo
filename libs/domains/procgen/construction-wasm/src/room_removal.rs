//! Pure inner function for `remove_room`: deletes a whole room (floor,
//! ceiling, every bounding wall) -- the "Apagar Cômodo" tool. Unlike
//! `editing::apply_delete_node` (one node, hole-repaired), this removes a
//! whole disjoint chunk of already-closed surfaces at once, so no cap
//! repair applies; `SurfaceRegistry::remove_surface` is used directly.
//!
//! A side shared with a still-standing neighbor is **preserved**, not
//! removed with the rest of the room -- it becomes that neighbor's own
//! new perimeter wall. If it had a door, the door is stripped (nothing to
//! walk into anymore): the doored pieces are removed and replaced with
//! one fresh plain wall reusing the same far corners, since there is no
//! in-place "reclassify a surface's own cycle" operation in this crate.
//!
//! `known_surfaces` (the caller's own bookkeeping, `SurfaceRegistry`
//! itself has no "all surfaces" iterator -- see `session.rs`'s own doc on
//! this) is how this function knows which registered surfaces exist at
//! all, so it can find every one belonging to the room.
//!
//! "Belonging to the room" is a point-in-polygon test against
//! `bottomCycle` itself (each candidate surface's own centroid), not a
//! bounding-box test -- a room can be non-rectangular now that
//! `cell_partition`'s brush can paint an L, a plus, or any other
//! polyomino shape, and a bounding box drawn around a concave room is
//! strictly bigger than the room: it can also cover a *different* room
//! filling the concave corner. A bounding-box test would wrongly count
//! that other room's own floor as "part of the room being deleted,"
//! which corrupts `has_external_neighbor`'s "is some surface OUTSIDE our
//! own candidates still referencing this side" check below and makes a
//! wall that should be preserved (door-stripped) get deleted outright
//! instead.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use grafting_graph_core::{NodeId, SurfaceKey, SurfaceRegistry, SurfaceType};

use crate::dto::surface_key_to_wire;
use crate::editing::SessionGraph;
use crate::geometry::point_in_or_on_polygon;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveRoomRequest {
    /// The room's own floor corner ids, in cycle order -- the same shape
    /// `room-derive-tool.ts`'s `findEnclosingRoom` already derives from a
    /// click point.
    pub bottom_cycle: Vec<String>,
    /// The matching top corner ids, same order/length as `bottom_cycle`.
    pub top_cycle: Vec<String>,
    /// Surface type for a preserved side's fresh plain-wall replacement,
    /// if its door needs stripping.
    pub wall_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveRoomResponse {
    pub removed_surface_keys: Vec<Vec<String>>,
    /// Fresh plain-wall surfaces created to replace a preserved,
    /// door-stripped side. Empty if every preserved side already had no
    /// door.
    pub preserved_surface_keys: Vec<Vec<String>>,
    pub removed_node_ids: Vec<String>,
}

fn parse_cycle(ids: &[String]) -> Result<Vec<NodeId>, String> {
    ids.iter().map(|id| NodeId::new(id.clone()).map_err(|error| error.to_string())).collect()
}

fn surface_centroid_xz(cycle: &[NodeId], graph: &SessionGraph) -> Option<(f32, f32)> {
    if cycle.is_empty() {
        return None;
    }
    let mut sum_x = 0.0;
    let mut sum_z = 0.0;
    for id in cycle {
        let position = graph.node(id)?.data();
        sum_x += position[0];
        sum_z += position[2];
    }
    let count = cycle.len() as f32;
    Some((sum_x / count, sum_z / count))
}

/// Removes a room's floor, ceiling, and every bounding wall -- preserving
/// (and door-stripping) any side still shared with a standing neighbor.
/// Errors, leaving nothing changed, if `bottomCycle`/`topCycle` mismatch
/// in length, are shorter than a triangle, or name an unknown node.
pub fn remove_room(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    known_surfaces: &HashSet<SurfaceKey>,
    request: RemoveRoomRequest,
) -> Result<RemoveRoomResponse, String> {
    let bottom_cycle = parse_cycle(&request.bottom_cycle)?;
    let top_cycle = parse_cycle(&request.top_cycle)?;
    if bottom_cycle.len() < 3 || bottom_cycle.len() != top_cycle.len() {
        return Err("bottomCycle and topCycle must be the same length, at least 3".to_string());
    }

    let mut min_x = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut min_z = f32::INFINITY;
    let mut max_z = f32::NEG_INFINITY;
    let mut polygon: Vec<(f32, f32)> = Vec::with_capacity(bottom_cycle.len());
    for id in &bottom_cycle {
        let node = graph.node(id).ok_or_else(|| format!("unknown node id: {id}"))?;
        let position = *node.data();
        min_x = min_x.min(position[0]);
        max_x = max_x.max(position[0]);
        min_z = min_z.min(position[2]);
        max_z = max_z.max(position[2]);
        polygon.push((position[0], position[2]));
    }
    const EPS: f32 = 1e-3;
    let in_box = |position: &[f32; 3]| {
        position[0] >= min_x - EPS && position[0] <= max_x + EPS && position[2] >= min_z - EPS && position[2] <= max_z + EPS
    };

    let snapshot = graph.snapshot();
    // Orphan cleanup (below) still scans the whole bounding box -- overly
    // broad is harmless there, since a node still referenced by another
    // room's surface simply survives the "no references left" check.
    let box_node_ids: HashSet<NodeId> = snapshot.nodes().iter().filter(|node| in_box(node.data())).map(|node| node.id().clone()).collect();

    // Every registered surface belonging to *this room's own polygon*:
    // its floor, ceiling, and every wall bounding it (including ones
    // shared with a still-standing neighbor -- a shared wall's centroid
    // sits exactly on the polygon's own boundary, which counts as
    // belonging). See the module doc for why this must be a true
    // point-in-polygon test, not a bounding-box test.
    let full_candidates: HashSet<SurfaceKey> = known_surfaces
        .iter()
        .filter(|key| {
            surfaces
                .surface(key)
                .and_then(|surface| surface_centroid_xz(surface.cycle(), graph).map(|centroid| point_in_or_on_polygon(centroid, &polygon)))
                .unwrap_or(false)
        })
        .cloned()
        .collect();

    // `cell_partition` generates floor/ceiling per painted cell, not one
    // per room -- a multi-cell room has no single surface whose cycle
    // equals the whole `bottomCycle`/`topCycle` perimeter passed in here.
    // So floor/ceiling pieces are identified structurally instead: every
    // `full_candidates` member NOT claimed as a wall piece by some side
    // below is, by construction, a floor or ceiling piece belonging to
    // this room (its cycle spans a cell's own 2D footprint, so it can
    // never lie collinear with any one side -- see `on_this_line` below)
    // and is unconditionally removed.
    let mut to_remove: HashSet<SurfaceKey> = HashSet::new();
    let mut claimed_by_a_side: HashSet<SurfaceKey> = HashSet::new();

    let side_count = bottom_cycle.len();
    let mut plain_replacements: Vec<[NodeId; 4]> = Vec::new();
    for index in 0..side_count {
        let a = &bottom_cycle[index];
        let b = &bottom_cycle[(index + 1) % side_count];
        let a_top = &top_cycle[index];
        let b_top = &top_cycle[(index + 1) % side_count];
        let pa = *graph.node(a).ok_or_else(|| format!("unknown node id: {a}"))?.data();
        let pb = *graph.node(b).ok_or_else(|| format!("unknown node id: {b}"))?.data();

        // Every candidate wall lying on this side's own line and within
        // its span -- position-based, not corner-set-based, because two
        // adjacent sides share an endpoint corner (a's far end is the
        // previous side's own near end too), so a piece touching only
        // one bare corner (a doored wall's own remainder, whose other
        // end is a private jamb node) would otherwise match both sides.
        let on_this_line = |position: &[f32; 3]| -> bool {
            const EPS: f32 = 1e-3;
            if (pa[0] - pb[0]).abs() < EPS {
                (position[0] - pa[0]).abs() < EPS && position[2] >= pa[2].min(pb[2]) - EPS && position[2] <= pa[2].max(pb[2]) + EPS
            } else {
                (position[2] - pa[2]).abs() < EPS && position[0] >= pa[0].min(pb[0]) - EPS && position[0] <= pa[0].max(pb[0]) + EPS
            }
        };
        let side_pieces: Vec<SurfaceKey> = full_candidates
            .iter()
            .filter(|key| {
                let surface = surfaces.surface(key).expect("known candidate key");
                surface.cycle().iter().all(|id| graph.node(id).map(|node| on_this_line(node.data())).unwrap_or(false))
            })
            .cloned()
            .collect();
        claimed_by_a_side.extend(side_pieces.iter().cloned());

        // A neighbor borders this exact side iff some surface outside our
        // own candidate set references BOTH of this side's bottom
        // corners together -- the neighbor's own floor, if it exists.
        // Checking each corner individually (rather than jointly) would
        // false-positive on a corner shared with a *different* side's
        // neighbor, since two adjacent sides always share one endpoint.
        let has_external_neighbor = surfaces
            .surfaces_referencing(a)
            .any(|key| !full_candidates.contains(key) && surfaces.surface(key).map(|s| s.cycle().contains(b)).unwrap_or(false));

        if !has_external_neighbor {
            to_remove.extend(side_pieces);
            continue;
        }
        if side_pieces.len() <= 1 {
            // Already a single plain piece (or none found) -- nothing to strip.
            continue;
        }
        // Doored and shared: strip the door, replace with one plain piece
        // reusing the same 4 far corners.
        to_remove.extend(side_pieces);
        plain_replacements.push([a.clone(), b.clone(), b_top.clone(), a_top.clone()]);
    }

    for key in &full_candidates {
        if !claimed_by_a_side.contains(key) {
            to_remove.insert(key.clone());
        }
    }

    let mut removed_surface_keys = Vec::with_capacity(to_remove.len());
    for key in &to_remove {
        surfaces.remove_surface(key).map_err(|error| error.to_string())?;
        removed_surface_keys.push(surface_key_to_wire(key));
    }

    let mut preserved_surface_keys = Vec::with_capacity(plain_replacements.len());
    for cycle in plain_replacements {
        let key = surfaces
            .add_surface(graph, cycle.to_vec(), SurfaceType::new(request.wall_type.clone()), true)
            .map_err(|error| error.to_string())?;
        preserved_surface_keys.push(surface_key_to_wire(&key));
    }

    // Orphan cleanup: any node this room's own geometry touched that no
    // surface references anymore (a preserved side's own far corners are
    // still referenced by the replacement wall added just above, so they
    // survive; a removed side's jamb nodes and this room's own
    // exclusive corners do not).
    let mut removed_node_ids = Vec::new();
    for id in &box_node_ids {
        if surfaces.surfaces_referencing(id).next().is_none() {
            graph.remove_node(id).map_err(|error| error.to_string())?;
            removed_node_ids.push(id.as_str().to_owned());
        }
    }

    Ok(RemoveRoomResponse { removed_surface_keys, preserved_surface_keys, removed_node_ids })
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::{Graph, SurfaceType};
    use grafting_procgen_structure_generation::{CellCoord, RoomGridGeneration, generate_cell_partition};

    /// Applies a whole generation's pieces, skipping any surface whose key
    /// already exists -- the same idempotent-by-position-derived-id
    /// property `cell_partition::generate_and_apply_cell_partition` relies
    /// on in production, needed here so two separate fixture calls sharing
    /// an id_prefix (e.g. `seeded_l_shaped_neighbor_graph`, two rooms of
    /// the same structure generated independently) can weld without
    /// double-adding the boundary they happen to agree on.
    fn apply_generation(graph: &mut SessionGraph, surfaces: &mut SurfaceRegistry, known: &mut HashSet<SurfaceKey>, generation: RoomGridGeneration) {
        for piece in generation.walls.into_iter().chain(generation.floors.into_iter()).chain(generation.ceilings.into_iter()) {
            let key = SurfaceKey::from_cycle(&piece.surface.cycle);
            if surfaces.surface(&key).is_some() {
                continue;
            }
            for node in &piece.nodes {
                if graph.node(node.id()).is_none() {
                    graph.add_node(node.clone()).unwrap();
                }
            }
            for edge in piece.edges.clone() {
                if graph.edge(edge.id()).is_none() {
                    graph.add_edge(edge).unwrap();
                }
            }
            let inserted = surfaces.add_surface(graph, piece.surface.cycle, piece.surface.surface_type, piece.surface.physical).unwrap();
            known.insert(inserted);
        }
    }

    fn seeded_two_room_graph() -> (SessionGraph, SurfaceRegistry, HashSet<SurfaceKey>) {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let mut known = HashSet::new();
        // Two 1-cell rooms forced apart by max_room_cells=1, cell_size=2 --
        // the doored shared wall this test needs.
        let cells = [CellCoord { x: 0, z: 0 }, CellCoord { x: 1, z: 0 }];
        let generation = generate_cell_partition(
            &cells, 2.0, [0.0, 0.0, 0.0], 3.0, 1, 1, "house-1",
            SurfaceType::new("wall-white"), SurfaceType::new("door"), SurfaceType::new("floor"), SurfaceType::new("ceiling"),
        );
        apply_generation(&mut graph, &mut surfaces, &mut known, generation);
        (graph, surfaces, known)
    }

    /// An L-shaped room (3 cells) with a second, separate 1-cell room
    /// nestled in the L's own concave corner -- generated as two
    /// *independent* `generate_cell_partition` calls sharing the same
    /// `id_prefix` (mirroring two separate brush strokes over the same
    /// physical structure), so their one physically-shared boundary welds
    /// by position without either call knowing about the other. The
    /// corner room's bounding box is a strict subset of the L's own
    /// bounding box but NOT a subset of the L's actual polygon -- exactly
    /// the shape that reproduces the AABB-scoping bug this module's doc
    /// comment describes.
    fn seeded_l_shaped_neighbor_graph() -> (SessionGraph, SurfaceRegistry, HashSet<SurfaceKey>) {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let mut known = HashSet::new();
        let types = || {
            (SurfaceType::new("wall-white"), SurfaceType::new("door"), SurfaceType::new("floor"), SurfaceType::new("ceiling"))
        };

        let l_cells = [CellCoord { x: 0, z: 0 }, CellCoord { x: 1, z: 0 }, CellCoord { x: 0, z: 1 }];
        let (wall_type, door_type, floor_type, ceiling_type) = types();
        let l_generation = generate_cell_partition(&l_cells, 2.0, [0.0, 0.0, 0.0], 3.0, 10, 1, "house-1", wall_type, door_type, floor_type, ceiling_type);
        apply_generation(&mut graph, &mut surfaces, &mut known, l_generation);

        let corner_cells = [CellCoord { x: 1, z: 1 }];
        let (wall_type, door_type, floor_type, ceiling_type) = types();
        let corner_generation = generate_cell_partition(&corner_cells, 2.0, [0.0, 0.0, 0.0], 3.0, 10, 1, "house-1", wall_type, door_type, floor_type, ceiling_type);
        apply_generation(&mut graph, &mut surfaces, &mut known, corner_generation);

        (graph, surfaces, known)
    }

    fn corner(x: f32, z: f32, top: bool) -> String {
        let end = if top { "top" } else { "bottom" };
        format!("house-1:corner:{x:.3}:{z:.3}:{end}")
    }

    #[test]
    fn removing_the_left_room_preserves_the_shared_wall_without_a_door() {
        let (mut graph, mut surfaces, known) = seeded_two_room_graph();

        let bottom_cycle = vec![corner(0.0, 0.0, false), corner(2.0, 0.0, false), corner(2.0, 2.0, false), corner(0.0, 2.0, false)];
        let top_cycle = vec![corner(0.0, 0.0, true), corner(2.0, 0.0, true), corner(2.0, 2.0, true), corner(0.0, 2.0, true)];

        let response = remove_room(
            &mut graph,
            &mut surfaces,
            &known,
            RemoveRoomRequest { bottom_cycle, top_cycle, wall_type: "wall-white".into() },
        )
        .unwrap();

        // The shared wall (x=2) survives as one fresh plain piece, not 3 doored ones.
        assert_eq!(response.preserved_surface_keys.len(), 1);
        let preserved_key = SurfaceKey::from_cycle(&[
            NodeId::new(corner(2.0, 0.0, false)).unwrap(),
            NodeId::new(corner(2.0, 2.0, false)).unwrap(),
            NodeId::new(corner(2.0, 0.0, true)).unwrap(),
            NodeId::new(corner(2.0, 2.0, true)).unwrap(),
        ]);
        let surface = surfaces.surface(&preserved_key).expect("plain replacement wall exists");
        assert_eq!(*surface.surface_type(), SurfaceType::new("wall-white"));

        // The right room's own floor/ceiling and perimeter walls are untouched.
        let right_floor_key = SurfaceKey::from_cycle(&[
            NodeId::new(corner(2.0, 0.0, false)).unwrap(),
            NodeId::new(corner(4.0, 0.0, false)).unwrap(),
            NodeId::new(corner(4.0, 2.0, false)).unwrap(),
            NodeId::new(corner(2.0, 2.0, false)).unwrap(),
        ]);
        assert!(surfaces.surface(&right_floor_key).is_some());
    }

    #[test]
    fn removing_the_left_room_deletes_its_own_floor_ceiling_and_exclusive_perimeter() {
        let (mut graph, mut surfaces, known) = seeded_two_room_graph();

        let bottom_cycle = vec![corner(0.0, 0.0, false), corner(2.0, 0.0, false), corner(2.0, 2.0, false), corner(0.0, 2.0, false)];
        let top_cycle = vec![corner(0.0, 0.0, true), corner(2.0, 0.0, true), corner(2.0, 2.0, true), corner(0.0, 2.0, true)];
        let floor_key = SurfaceKey::from_cycle(&bottom_cycle.iter().map(|s| NodeId::new(s.clone()).unwrap()).collect::<Vec<_>>());

        remove_room(&mut graph, &mut surfaces, &known, RemoveRoomRequest { bottom_cycle, top_cycle, wall_type: "wall-white".into() }).unwrap();

        assert!(surfaces.surface(&floor_key).is_none());
        // The left room's exclusive corner (0,0,bottom) is now orphaned and removed.
        assert!(graph.node(&NodeId::new(corner(0.0, 0.0, false)).unwrap()).is_none());
        // The shared corner (2,0,bottom) survives -- the right room and the preserved wall still reference it.
        assert!(graph.node(&NodeId::new(corner(2.0, 0.0, false)).unwrap()).is_some());
    }

    #[test]
    fn removing_a_free_standing_room_leaves_no_preserved_walls() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let mut known = HashSet::new();
        let generation = generate_cell_partition(
            &[CellCoord { x: 0, z: 0 }], 2.0, [0.0, 0.0, 0.0], 3.0, 6, 1, "solo-1",
            SurfaceType::new("wall-white"), SurfaceType::new("door"), SurfaceType::new("floor"), SurfaceType::new("ceiling"),
        );
        apply_generation(&mut graph, &mut surfaces, &mut known, generation);

        let bottom_cycle = vec![
            "solo-1:corner:0.000:0.000:bottom".to_string(),
            "solo-1:corner:2.000:0.000:bottom".to_string(),
            "solo-1:corner:2.000:2.000:bottom".to_string(),
            "solo-1:corner:0.000:2.000:bottom".to_string(),
        ];
        let top_cycle = vec![
            "solo-1:corner:0.000:0.000:top".to_string(),
            "solo-1:corner:2.000:0.000:top".to_string(),
            "solo-1:corner:2.000:2.000:top".to_string(),
            "solo-1:corner:0.000:2.000:top".to_string(),
        ];

        let response = remove_room(&mut graph, &mut surfaces, &known, RemoveRoomRequest { bottom_cycle, top_cycle, wall_type: "wall-white".into() }).unwrap();

        assert!(response.preserved_surface_keys.is_empty());
        assert_eq!(graph.node_count(), 0);
    }

    /// Regression test for the bounding-box scoping bug described in this
    /// module's doc comment: deleting the L-shaped room must not corrupt
    /// (and wrongly delete) the walls it shares with the separate room
    /// nestled in its own concave corner, even though that neighbor's
    /// bounding box is entirely inside the L's own bounding box.
    #[test]
    fn removing_an_l_shaped_room_preserves_the_walls_shared_with_its_concave_corner_neighbor() {
        let (mut graph, mut surfaces, known) = seeded_l_shaped_neighbor_graph();

        let bottom_cycle = vec![
            corner(0.0, 0.0, false),
            corner(4.0, 0.0, false),
            corner(4.0, 2.0, false),
            corner(2.0, 2.0, false),
            corner(2.0, 4.0, false),
            corner(0.0, 4.0, false),
        ];
        let top_cycle = vec![
            corner(0.0, 0.0, true),
            corner(4.0, 0.0, true),
            corner(4.0, 2.0, true),
            corner(2.0, 2.0, true),
            corner(2.0, 4.0, true),
            corner(0.0, 4.0, true),
        ];

        remove_room(&mut graph, &mut surfaces, &known, RemoveRoomRequest { bottom_cycle, top_cycle, wall_type: "wall-white".into() }).unwrap();

        // Both walls shared with the corner room must survive -- this is
        // exactly what the AABB-based bug used to delete.
        let shared_wall_a = SurfaceKey::from_cycle(&[
            NodeId::new(corner(2.0, 2.0, false)).unwrap(),
            NodeId::new(corner(4.0, 2.0, false)).unwrap(),
            NodeId::new(corner(2.0, 2.0, true)).unwrap(),
            NodeId::new(corner(4.0, 2.0, true)).unwrap(),
        ]);
        let shared_wall_b = SurfaceKey::from_cycle(&[
            NodeId::new(corner(2.0, 2.0, false)).unwrap(),
            NodeId::new(corner(2.0, 4.0, false)).unwrap(),
            NodeId::new(corner(2.0, 2.0, true)).unwrap(),
            NodeId::new(corner(2.0, 4.0, true)).unwrap(),
        ]);
        assert!(surfaces.surface(&shared_wall_a).is_some(), "wall shared with the corner room's north side must survive");
        assert!(surfaces.surface(&shared_wall_b).is_some(), "wall shared with the corner room's west side must survive");

        // The corner room's own (single-cell) floor is untouched.
        let corner_floor_key = SurfaceKey::from_cycle(&[
            NodeId::new(corner(2.0, 2.0, false)).unwrap(),
            NodeId::new(corner(4.0, 2.0, false)).unwrap(),
            NodeId::new(corner(4.0, 4.0, false)).unwrap(),
            NodeId::new(corner(2.0, 4.0, false)).unwrap(),
        ]);
        assert!(surfaces.surface(&corner_floor_key).is_some(), "the neighboring room's own floor must survive");

        // Floor/ceiling are generated per cell, not per room -- the L's 3
        // cells each have their own exclusive floor, and all 3 must be gone.
        let l_cell_floor_keys = [
            SurfaceKey::from_cycle(&[
                NodeId::new(corner(0.0, 0.0, false)).unwrap(),
                NodeId::new(corner(2.0, 0.0, false)).unwrap(),
                NodeId::new(corner(2.0, 2.0, false)).unwrap(),
                NodeId::new(corner(0.0, 2.0, false)).unwrap(),
            ]),
            SurfaceKey::from_cycle(&[
                NodeId::new(corner(2.0, 0.0, false)).unwrap(),
                NodeId::new(corner(4.0, 0.0, false)).unwrap(),
                NodeId::new(corner(4.0, 2.0, false)).unwrap(),
                NodeId::new(corner(2.0, 2.0, false)).unwrap(),
            ]),
            SurfaceKey::from_cycle(&[
                NodeId::new(corner(0.0, 2.0, false)).unwrap(),
                NodeId::new(corner(2.0, 2.0, false)).unwrap(),
                NodeId::new(corner(2.0, 4.0, false)).unwrap(),
                NodeId::new(corner(0.0, 4.0, false)).unwrap(),
            ]),
        ];
        for key in &l_cell_floor_keys {
            assert!(surfaces.surface(key).is_none(), "every one of the L's own per-cell floors must be removed");
        }
    }
}
