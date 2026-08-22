//! Generic "regenerate a structure's whole geometry, apply only the diff"
//! core -- shared by every `generate_and_apply_*` operation whose
//! generator produces a *complete* replacement for some scoped region each
//! call (as opposed to `wall::generate_and_apply_wall`'s purely additive
//! model, or `room_removal::remove_room`'s purely subtractive one).
//!
//! Extracted from `cell_partition`'s own original inline implementation
//! once `wall_path` needed the identical diff/dedup/orphan-cleanup logic
//! against a different scope test (a polygon boundary, not a bounding
//! box) -- deciding *what counts as "this structure's own geometry"* is
//! each caller's own concern (see their own docs), but *what to do once
//! that's decided* -- remove what's gone, add what's new, skip what's
//! unchanged, sweep orphaned nodes -- is identical, so it lives here once.
//!
//! This only works cheaply because every id a generator in this crate's
//! sibling `grafting-procgen-structure-generation` produces is a pure
//! function of world position -- repainting the same geometry across ticks
//! or across separate calls always reproduces the exact same [`RegionId`]
//! (via [`region_id_from_cycle`]), so unchanged geometry costs nothing (its
//! id is already in `old_ids_in_scope`, so it's filtered out of both the
//! add and remove sets) and only genuinely new or genuinely stale pieces
//! are touched.
//!
//! Every surface this module creates is an analytic
//! [`grafting_graph_core::SurfaceRegion`], not a legacy
//! [`grafting_graph_core::Surface`] -- see this crate's own migration
//! notes. A piece with `surface.curvature` set (a curved wall/tower panel)
//! gets its base and top rims built as true `ContourGeometry::CircularArc`
//! edges instead of the legacy `SurfaceCurvature` decoration -- see
//! [`arc_geometry_for_curvature`]'s own doc.

use std::collections::{HashMap, HashSet};

use grafting_graph_core::{
    ArcBulge, ContourEdge, ContourEdgeId, ContourGeometry, ContourTopology, Edge, EdgeId, Node,
    NodeId, OrientedEdgeUse, RegionId, SurfaceCurvature, SurfaceRegistry, straight_cycle_region,
};
use grafting_procgen_structure_generation::StructurePiece;

use crate::dto::region_id_from_cycle;
use crate::editing::SessionGraph;
use crate::mesh::region_id_to_wire;

/// What changed, in wire-ready form -- the same shape every
/// `generate_and_apply_*` JSON response already uses.
pub struct DiffOutcome {
    pub added_surface_keys: Vec<Vec<String>>,
    pub removed_surface_keys: Vec<Vec<String>>,
    pub removed_node_ids: Vec<String>,
}

/// The reference midpoint the OLD renderer (`grafting-procgen-surface-mesh`'s
/// `tessellate_arc`) would have placed at `t=0.5` for this exact `(start,
/// end, curvature)`: at `t=0.5` that function's own `theta = PI/2` term
/// drops the `cos` component entirely, reducing to `center + sign*radius*normal`.
/// [`SurfaceCurvature`] only stores `{center, bulge}` (no explicit swept
/// angle), while [`ContourGeometry::CircularArc`] needs an explicit
/// `clockwise` -- this picks whichever `clockwise` value reproduces the same
/// reference midpoint the legacy renderer would have drawn, so migrating off
/// `SurfaceCurvature` changes no visual output. Only used to pick a
/// direction, never to tessellate anything here -- `ContourTopology`'s own
/// tessellation runs later, at mesh-derivation time.
fn arc_geometry_for_curvature(
    start: [f32; 3],
    end: [f32; 3],
    curvature: SurfaceCurvature,
) -> ContourGeometry {
    let (sx, sz) = (start[0], start[2]);
    let (ex, ez) = (end[0], end[2]);
    let chord = ((ex - sx).powi(2) + (ez - sz).powi(2))
        .sqrt()
        .max(f32::EPSILON);
    let (ux, uz) = ((ex - sx) / chord, (ez - sz) / chord);
    let (nx, nz) = (-uz, ux);
    let sign: f32 = match curvature.bulge {
        ArcBulge::Left => 1.0,
        ArcBulge::Right => -1.0,
    };
    let center = curvature.center;
    let radius = ((sx - center[0]).powi(2) + (sz - center[1]).powi(2))
        .sqrt()
        .max(f32::EPSILON);
    let reference_mid = [
        center[0] + sign * radius * nx,
        center[1] + sign * radius * nz,
    ];

    let angle_of = |p: [f32; 2]| (p[1] - center[1]).atan2(p[0] - center[0]);
    let sweep = |from: f32, to: f32, clockwise: bool| {
        let tau = std::f32::consts::TAU;
        (if clockwise { from - to } else { to - from }).rem_euclid(tau)
    };
    let midpoint_for = |clockwise: bool| {
        let start_angle = angle_of([sx, sz]);
        let end_angle = angle_of([ex, ez]);
        let total = sweep(start_angle, end_angle, clockwise).max(f32::EPSILON);
        let signed = if clockwise { -total } else { total };
        let angle = start_angle + signed * 0.5;
        [
            center[0] + radius * angle.cos(),
            center[1] + radius * angle.sin(),
        ]
    };
    let dist2 = |a: [f32; 2], b: [f32; 2]| (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2);
    let clockwise =
        dist2(midpoint_for(true), reference_mid) < dist2(midpoint_for(false), reference_mid);
    ContourGeometry::CircularArc { center, clockwise }
}

/// Registers one new surface's own loop of contour edges -- straight
/// (`Line`) unless `curvature` is set, in which case a 4-corner cycle's
/// base edge (index 0, `cycle[0] -> cycle[1]`) and top edge (index 2,
/// `cycle[2] -> cycle[3]`) become `CircularArc`s sharing the same center --
/// see `extrusion::quad_piece`'s own doc for why exactly those two edges of
/// a curved panel share one arc (a vertical extrusion of a curved base has
/// an identically-curved top rim, just offset in Y). The two vertical side
/// edges (indices 1 and 3) always stay straight.
fn register_region(
    graph: &SessionGraph,
    topology: &mut ContourTopology,
    region_id: &RegionId,
    cycle: &[NodeId],
    curvature: Option<SurfaceCurvature>,
) -> Result<(), String> {
    let Some(curvature) = curvature else {
        straight_cycle_region(topology, graph, region_id.clone(), cycle)
            .map_err(|error| error.to_string())?;
        return Ok(());
    };
    let positions: Vec<[f32; 3]> = cycle
        .iter()
        .map(|id| {
            *graph
                .node(id)
                .expect("cycle nodes were already added to the graph")
                .data()
        })
        .collect();
    let base_geometry = arc_geometry_for_curvature(positions[0], positions[1], curvature);
    let top_geometry = match base_geometry {
        ContourGeometry::CircularArc { center, clockwise } => ContourGeometry::CircularArc {
            center,
            clockwise: !clockwise,
        },
        ContourGeometry::Line => ContourGeometry::Line,
    };
    let mut loop_ = Vec::with_capacity(cycle.len());
    for index in 0..cycle.len() {
        let start = cycle[index].clone();
        let end = cycle[(index + 1) % cycle.len()].clone();
        let geometry = if index == 0 {
            base_geometry
        } else if cycle.len() == 4 && index == 2 {
            top_geometry
        } else {
            ContourGeometry::Line
        };
        let edge_id = ContourEdgeId::new(format!("{region_id}-{index}"))
            .map_err(|error| error.to_string())?;
        topology
            .add_edge(
                graph,
                ContourEdge::new(edge_id.clone(), start, end, geometry),
            )
            .map_err(|error| error.to_string())?;
        loop_.push(OrientedEdgeUse::forward(edge_id));
    }
    topology
        .add_region(region_id.clone(), vec![loop_], Vec::new())
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Diffs `all_pieces` (a generator's complete, freshly-derived output)
/// against `old_ids_in_scope` (every previously-registered region the
/// caller has already decided belongs to this same structure), applies
/// only the difference, and sweeps any node `node_in_scope` still claims
/// but nothing -- neither a legacy `Surface` nor a surviving analytic
/// region -- references anymore.
pub fn diff_and_apply(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    topology: &mut ContourTopology,
    old_ids_in_scope: &HashSet<RegionId>,
    all_pieces: Vec<StructurePiece>,
    node_in_scope: impl Fn(&Node<[f32; 3]>) -> bool,
) -> Result<DiffOutcome, String> {
    let new_ids: HashSet<RegionId> = all_pieces
        .iter()
        .map(|piece| region_id_from_cycle(&piece.surface.cycle))
        .collect::<Result<_, _>>()?;

    let to_remove: Vec<RegionId> = old_ids_in_scope.difference(&new_ids).cloned().collect();
    // A generator can legitimately emit the same cycle twice in one call
    // (a free-form stroke fitted into two collinear edges that share both
    // endpoints, most commonly) -- since ids are position-derived, that's
    // the same `RegionId` twice, not two distinct surfaces. Keep only the
    // first occurrence, the same way `unique_nodes`/`unique_edges` below
    // already dedupe within one call.
    let mut seen_new_ids: HashSet<RegionId> = HashSet::new();
    let to_add: Vec<_> = all_pieces
        .into_iter()
        .filter(|piece| {
            let id = region_id_from_cycle(&piece.surface.cycle)
                .expect("already validated above while building new_ids");
            !old_ids_in_scope.contains(&id) && seen_new_ids.insert(id)
        })
        .collect();

    let mut removed_surface_keys = Vec::with_capacity(to_remove.len());
    for id in &to_remove {
        topology
            .remove_region(id)
            .map_err(|error| error.to_string())?;
        surfaces
            .remove_region_surface(id)
            .map_err(|error| error.to_string())?;
        removed_surface_keys.push(region_id_to_wire(id));
    }

    // Dedup nodes/edges across every kept piece before mutating -- a
    // corner or jamb shared by more than one piece must only be added
    // once, and one already present from a prior call (or a neighboring
    // piece's own) is reused, never re-added.
    let mut unique_nodes: HashMap<NodeId, Node<[f32; 3]>> = HashMap::new();
    let mut unique_edges: HashMap<EdgeId, Edge<()>> = HashMap::new();
    for piece in &to_add {
        for node in &piece.nodes {
            unique_nodes
                .entry(node.id().clone())
                .or_insert_with(|| node.clone());
        }
        for edge in &piece.edges {
            unique_edges
                .entry(edge.id().clone())
                .or_insert_with(|| edge.clone());
        }
    }
    for (id, node) in &unique_nodes {
        if graph.node(id).is_none() {
            graph
                .add_node(node.clone())
                .map_err(|error| error.to_string())?;
        }
    }
    for (id, edge) in &unique_edges {
        if graph.edge(id).is_none() {
            graph
                .add_edge(edge.clone())
                .map_err(|error| error.to_string())?;
        }
    }

    let mut added_surface_keys = Vec::with_capacity(to_add.len());
    for piece in to_add {
        let region_id = region_id_from_cycle(&piece.surface.cycle)?;
        register_region(
            graph,
            topology,
            &region_id,
            &piece.surface.cycle,
            piece.surface.curvature,
        )?;
        surfaces
            .add_region_surface(
                topology,
                region_id.clone(),
                piece.surface.surface_type,
                piece.surface.physical,
            )
            .map_err(|error| error.to_string())?;
        added_surface_keys.push(region_id_to_wire(&region_id));
    }
    topology.prune_unused_edges();

    // Orphan cleanup: any node still claimed by the caller's own scope
    // that no surviving region's boundary references anymore (a removed
    // run's own private jamb/facet nodes, most commonly) is deleted.
    let nodes_in_use = topology.nodes_in_use();
    let snapshot = graph.snapshot();
    let scoped_node_ids: Vec<NodeId> = snapshot
        .nodes()
        .iter()
        .filter(|node| node_in_scope(node))
        .map(|node| node.id().clone())
        .collect();
    let mut removed_node_ids = Vec::new();
    for id in &scoped_node_ids {
        if nodes_in_use.contains(id) {
            continue;
        }
        graph.remove_node(id).map_err(|error| error.to_string())?;
        removed_node_ids.push(id.as_str().to_owned());
    }

    Ok(DiffOutcome {
        added_surface_keys,
        removed_surface_keys,
        removed_node_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::{Graph, NodeId, SurfaceSpec, SurfaceType};

    fn quad_piece(prefix: &str) -> StructurePiece {
        let ids: Vec<NodeId> = ["a", "b", "c", "d"]
            .iter()
            .map(|suffix| NodeId::new(format!("{prefix}:{suffix}")).unwrap())
            .collect();
        let positions: [[f32; 3]; 4] = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 0.0, 1.0],
            [0.0, 0.0, 1.0],
        ];
        let nodes: Vec<Node<[f32; 3]>> = ids
            .iter()
            .zip(positions)
            .map(|(id, position)| Node::new(id.clone(), position))
            .collect();
        let edges: Vec<Edge<()>> = (0..4)
            .map(|index| {
                let id = EdgeId::new(format!("{prefix}:edge{index}")).unwrap();
                Edge::new(id, ids[index].clone(), ids[(index + 1) % 4].clone(), ())
            })
            .collect();
        StructurePiece {
            nodes,
            edges,
            surface: SurfaceSpec {
                cycle: ids,
                surface_type: SurfaceType::new("wall"),
                physical: true,
                curvature: None,
            },
        }
    }

    #[test]
    fn a_generator_emitting_the_same_cycle_twice_in_one_call_adds_it_once() {
        let mut graph: SessionGraph = Graph::try_from_parts(vec![], vec![]).unwrap();
        let mut surfaces = SurfaceRegistry::new();
        let mut topology = ContourTopology::new();

        // A stroke fitted into two collinear edges sharing both endpoints
        // -- same node-derived ids twice, not two distinct surfaces.
        let all_pieces = vec![quad_piece("wall"), quad_piece("wall")];

        let outcome = diff_and_apply(
            &mut graph,
            &mut surfaces,
            &mut topology,
            &HashSet::new(),
            all_pieces,
            |_| true,
        )
        .unwrap();
        assert_eq!(
            outcome.added_surface_keys.len(),
            1,
            "the duplicate cycle must be added exactly once, not rejected as already existing"
        );
    }
}
