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
//! all, so it can find every one fully inside the room's bounding box.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use grafting_graph_core::{NodeId, SurfaceKey, SurfaceRegistry, SurfaceType};

use crate::dto::surface_key_to_wire;
use crate::editing::SessionGraph;

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
    for id in &bottom_cycle {
        let node = graph.node(id).ok_or_else(|| format!("unknown node id: {id}"))?;
        let position = *node.data();
        min_x = min_x.min(position[0]);
        max_x = max_x.max(position[0]);
        min_z = min_z.min(position[2]);
        max_z = max_z.max(position[2]);
    }
    const EPS: f32 = 1e-3;
    let in_box = |position: &[f32; 3]| {
        position[0] >= min_x - EPS && position[0] <= max_x + EPS && position[2] >= min_z - EPS && position[2] <= max_z + EPS
    };

    let snapshot = graph.snapshot();
    let box_node_ids: HashSet<NodeId> = snapshot.nodes().iter().filter(|node| in_box(node.data())).map(|node| node.id().clone()).collect();

    // Every registered surface fully inside the box: this room's own
    // floor, ceiling, and every wall bounding it (including ones shared
    // with a still-standing neighbor -- the shared line sits exactly on
    // the box's own edge, inclusive).
    let full_candidates: HashSet<SurfaceKey> = known_surfaces
        .iter()
        .filter(|key| {
            surfaces
                .surface(key)
                .map(|surface| surface.cycle().iter().all(|id| box_node_ids.contains(id)))
                .unwrap_or(false)
        })
        .cloned()
        .collect();

    let floor_key = SurfaceKey::from_cycle(&bottom_cycle);
    let ceiling_key = SurfaceKey::from_cycle(&top_cycle);

    let mut to_remove: HashSet<SurfaceKey> = HashSet::new();
    to_remove.insert(floor_key.clone());
    to_remove.insert(ceiling_key.clone());

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
            .filter(|key| *key != &floor_key && *key != &ceiling_key)
            .filter(|key| {
                let surface = surfaces.surface(key).expect("known candidate key");
                surface.cycle().iter().all(|id| graph.node(id).map(|node| on_this_line(node.data())).unwrap_or(false))
            })
            .cloned()
            .collect();

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
    use grafting_procgen_structure_generation::{RectTile, generate_tiled_rooms};
    use grafting_graph_core::{Graph, SurfaceType};

    fn seeded_two_room_graph() -> (SessionGraph, SurfaceRegistry, HashSet<SurfaceKey>) {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let tiles = [
            RectTile { x: 0.0, z: 0.0, width: 4.0, depth: 4.0 },
            RectTile { x: 4.0, z: 0.0, width: 4.0, depth: 4.0 },
        ];
        let generation = generate_tiled_rooms(
            &tiles, 0.0, 3.0, "house-1",
            SurfaceType::new("wall-white"), SurfaceType::new("door"), SurfaceType::new("floor"), SurfaceType::new("ceiling"),
            |_, _, _| None,
        );
        let mut known = HashSet::new();
        for piece in generation.walls.into_iter().chain(generation.floors.into_iter()).chain(generation.ceilings.into_iter()) {
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
            let key = surfaces.add_surface(&graph, piece.surface.cycle, piece.surface.surface_type, piece.surface.physical).unwrap();
            known.insert(key);
        }
        (graph, surfaces, known)
    }

    fn corner(x: f32, z: f32, top: bool) -> String {
        let end = if top { "top" } else { "bottom" };
        format!("house-1:corner:{x:.3}:{z:.3}:{end}")
    }

    #[test]
    fn removing_the_left_room_preserves_the_shared_wall_without_a_door() {
        let (mut graph, mut surfaces, known) = seeded_two_room_graph();

        let bottom_cycle = vec![corner(0.0, 0.0, false), corner(4.0, 0.0, false), corner(4.0, 4.0, false), corner(0.0, 4.0, false)];
        let top_cycle = vec![corner(0.0, 0.0, true), corner(4.0, 0.0, true), corner(4.0, 4.0, true), corner(0.0, 4.0, true)];

        let response = remove_room(
            &mut graph,
            &mut surfaces,
            &known,
            RemoveRoomRequest { bottom_cycle, top_cycle, wall_type: "wall-white".into() },
        )
        .unwrap();

        // The shared wall (x=4) survives as one fresh plain piece, not 3 doored ones.
        assert_eq!(response.preserved_surface_keys.len(), 1);
        let preserved_key = SurfaceKey::from_cycle(&[
            NodeId::new(corner(4.0, 0.0, false)).unwrap(),
            NodeId::new(corner(4.0, 4.0, false)).unwrap(),
            NodeId::new(corner(4.0, 0.0, true)).unwrap(),
            NodeId::new(corner(4.0, 4.0, true)).unwrap(),
        ]);
        let surface = surfaces.surface(&preserved_key).expect("plain replacement wall exists");
        assert_eq!(*surface.surface_type(), SurfaceType::new("wall-white"));

        // The right room's own floor/ceiling and perimeter walls are untouched.
        let right_floor_key = SurfaceKey::from_cycle(&[
            NodeId::new(corner(4.0, 0.0, false)).unwrap(),
            NodeId::new(corner(8.0, 0.0, false)).unwrap(),
            NodeId::new(corner(8.0, 4.0, false)).unwrap(),
            NodeId::new(corner(4.0, 4.0, false)).unwrap(),
        ]);
        assert!(surfaces.surface(&right_floor_key).is_some());
    }

    #[test]
    fn removing_the_left_room_deletes_its_own_floor_ceiling_and_exclusive_perimeter() {
        let (mut graph, mut surfaces, known) = seeded_two_room_graph();

        let bottom_cycle = vec![corner(0.0, 0.0, false), corner(4.0, 0.0, false), corner(4.0, 4.0, false), corner(0.0, 4.0, false)];
        let top_cycle = vec![corner(0.0, 0.0, true), corner(4.0, 0.0, true), corner(4.0, 4.0, true), corner(0.0, 4.0, true)];
        let floor_key = SurfaceKey::from_cycle(&bottom_cycle.iter().map(|s| NodeId::new(s.clone()).unwrap()).collect::<Vec<_>>());

        remove_room(&mut graph, &mut surfaces, &known, RemoveRoomRequest { bottom_cycle, top_cycle, wall_type: "wall-white".into() }).unwrap();

        assert!(surfaces.surface(&floor_key).is_none());
        // The left room's exclusive corner (0,0,bottom) is now orphaned and removed.
        assert!(graph.node(&NodeId::new(corner(0.0, 0.0, false)).unwrap()).is_none());
        // The shared corner (4,0,bottom) survives -- the right room and the preserved wall still reference it.
        assert!(graph.node(&NodeId::new(corner(4.0, 0.0, false)).unwrap()).is_some());
    }

    #[test]
    fn removing_a_free_standing_room_leaves_no_preserved_walls() {
        let mut graph = Graph::try_from_parts(Vec::new(), Vec::new()).unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let tiles = [RectTile { x: 0.0, z: 0.0, width: 4.0, depth: 4.0 }];
        let generation = generate_tiled_rooms(
            &tiles, 0.0, 3.0, "solo-1",
            SurfaceType::new("wall-white"), SurfaceType::new("door"), SurfaceType::new("floor"), SurfaceType::new("ceiling"),
            |_, _, _| None,
        );
        let mut known = HashSet::new();
        for piece in generation.walls.into_iter().chain(generation.floors.into_iter()).chain(generation.ceilings.into_iter()) {
            for node in &piece.nodes {
                if graph.node(node.id()).is_none() {
                    graph.add_node(node.clone()).unwrap();
                }
            }
            let key = surfaces.add_surface(&graph, piece.surface.cycle, piece.surface.surface_type, piece.surface.physical).unwrap();
            known.insert(key);
        }

        let bottom_cycle = vec![
            "solo-1:corner:0.000:0.000:bottom".to_string(),
            "solo-1:corner:4.000:0.000:bottom".to_string(),
            "solo-1:corner:4.000:4.000:bottom".to_string(),
            "solo-1:corner:0.000:4.000:bottom".to_string(),
        ];
        let top_cycle = vec![
            "solo-1:corner:0.000:0.000:top".to_string(),
            "solo-1:corner:4.000:0.000:top".to_string(),
            "solo-1:corner:4.000:4.000:top".to_string(),
            "solo-1:corner:0.000:4.000:top".to_string(),
        ];

        let response = remove_room(&mut graph, &mut surfaces, &known, RemoveRoomRequest { bottom_cycle, top_cycle, wall_type: "wall-white".into() }).unwrap();

        assert!(response.preserved_surface_keys.is_empty());
        assert_eq!(graph.node_count(), 0);
    }
}
