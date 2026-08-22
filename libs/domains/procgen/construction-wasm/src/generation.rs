//! Pure inner functions for this crate's three generic `generate_and_apply_*`
//! operations, every one a thin wrapper over a `grafting-procgen-structure-generation`
//! pure primitive plus `diff_apply::diff_and_apply`. None of these three
//! know a product concept -- `wall`/`door`/`room`/`floor`/`ceiling` never
//! appear as Rust identifiers here, only as opaque `SurfaceType` strings a
//! caller supplies. Replaces `wall.rs`, `wall_path.rs`, and `cell_partition.rs`.
//!
//! - [`generate_and_apply_path_extrusion`] -- a path of straight/arc edges
//!   becomes vertical panels, via `extrusion::extrude_path`. Open or closed;
//!   never generates a cap (a floor/ceiling/roof) itself -- that is
//!   [`generate_and_apply_boundary_cap`]'s or
//!   [`generate_and_apply_region_partition`]'s own job, called separately
//!   once a caller decides a path closed into something that needs one.
//! - [`generate_and_apply_boundary_cap`] -- one closed boundary of 3D points
//!   becomes one capping surface, via `boundary::cap_boundary`.
//! - [`generate_and_apply_region_partition`] -- paints a set of grid cells
//!   into disjoint regions (`structure_generation::partition_cells_into_regions`),
//!   then for every region caps each cell's own footprint and extrudes a
//!   wall along every boundary run, placing a notch on any run shared with
//!   a neighboring region. This is the generic primitive both the
//!   wall-brush's closure and the cell-brush ("Pintar Casa") route through.
//!
//! All three follow this crate's established **replace-and-diff** model
//! (see `diff_apply`'s own doc): regenerate the whole request's geometry,
//! apply only the difference against whatever this same structure already
//! holds. This works cheaply because every id
//! `grafting-procgen-structure-generation` mints is a pure function of
//! world position -- see that crate's own `ids` module doc.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use grafting_graph_core::{ContourTopology, RegionId, SurfaceRegistry, SurfaceType};
use grafting_procgen_structure_generation::{
    Axis, BoundaryRun, CellCoord, EdgeCurvature, EdgeNotch, PathEdge, StructurePiece,
    boundary_runs, cap_boundary, extrude_path, partition_cells_into_regions,
};

use crate::diff_apply::diff_and_apply;
use crate::editing::SessionGraph;

/// Whether every node touched by `region_id`'s own outer loops (and holes)
/// satisfies `in_scope`, resolving each contour edge's endpoints through
/// `graph`. A region with a node `graph` no longer has, or an id
/// `topology` no longer knows, is never in scope -- the same "absent means
/// out of scope" posture the legacy `surface.cycle()` walk this replaces
/// already had.
fn region_in_scope(
    topology: &ContourTopology,
    graph: &SessionGraph,
    region_id: &RegionId,
    in_scope: &impl Fn(&[f32; 3]) -> bool,
) -> bool {
    let Some(region) = topology.region(region_id) else {
        return false;
    };
    for loop_ in region.outer_loops().iter().chain(region.holes().iter()) {
        for use_ in loop_ {
            let Some(edge) = topology.edge(use_.edge()) else {
                return false;
            };
            for node_id in [edge.start_node(), edge.end_node()] {
                let Some(node) = graph.node(node_id) else {
                    return false;
                };
                if !in_scope(node.data()) {
                    return false;
                }
            }
        }
    }
    true
}

fn regions_in_scope(
    topology: &ContourTopology,
    graph: &SessionGraph,
    known_regions: &HashSet<RegionId>,
    in_scope: &impl Fn(&[f32; 3]) -> bool,
) -> HashSet<RegionId> {
    known_regions
        .iter()
        .filter(|id| region_in_scope(topology, graph, id, in_scope))
        .cloned()
        .collect()
}

// ---- Path extrusion ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResponse {
    pub added_surface_keys: Vec<Vec<String>>,
    pub removed_surface_keys: Vec<Vec<String>>,
    pub removed_node_ids: Vec<String>,
}

fn bounding_box_scope(pieces: &[StructurePiece]) -> impl Fn(&[f32; 3]) -> bool + use<> {
    let mut min_x = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut min_z = f32::INFINITY;
    let mut max_z = f32::NEG_INFINITY;
    for piece in pieces {
        for node in &piece.nodes {
            let position = node.data();
            min_x = min_x.min(position[0]);
            max_x = max_x.max(position[0]);
            min_z = min_z.min(position[2]);
            max_z = max_z.max(position[2]);
        }
    }
    const EPS: f32 = 1e-3;
    move |position: &[f32; 3]| {
        position[0] >= min_x - EPS
            && position[0] <= max_x + EPS
            && position[2] >= min_z - EPS
            && position[2] <= max_z + EPS
    }
}

// ---- Boundary cap ----

// ---- Region partition ----

/// A wall run shorter than this (world units) never gets a notch, even if
/// it borders a neighboring region -- a sliver is too narrow for a
/// sensible opening, so it stays a plain, uninterrupted panel. Matches the
/// fixed default this crate's predecessor used.
const MIN_NOTCH_SEGMENT_WIDTH: f32 = 1.0;
/// Half the generated notch's width, as a fraction of its own run.
const NOTCH_HALF_WIDTH: f32 = 0.1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellCoordDto {
    pub x: i32,
    pub z: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAndApplyRegionPartitionRequest {
    /// Every cell currently painted in this stroke -- the *whole*
    /// accumulated set, not just what changed since the last tick.
    pub cells: Vec<CellCoordDto>,
    pub cell_size: f32,
    pub origin: [f32; 3],
    pub wall_height: f32,
    pub max_region_cells: usize,
    pub seed: u64,
    /// Namespaces every id this call derives -- must stay the same fixed
    /// value across every tick of one structure (and across separate
    /// strokes painting the same physical structure later).
    pub id_prefix: String,
    pub wall_type: String,
    pub notch_type: String,
    pub floor_type: String,
    pub ceiling_type: String,
}

fn run_world_endpoints(
    run: &BoundaryRun,
    cell_size: f32,
    origin: [f32; 3],
) -> ([f32; 3], [f32; 3]) {
    match run.axis {
        Axis::X => {
            let x = origin[0] + run.line as f32 * cell_size;
            (
                [x, origin[1], origin[2] + run.from as f32 * cell_size],
                [x, origin[1], origin[2] + run.to as f32 * cell_size],
            )
        }
        Axis::Z => {
            let z = origin[2] + run.line as f32 * cell_size;
            (
                [origin[0] + run.from as f32 * cell_size, origin[1], z],
                [origin[0] + run.to as f32 * cell_size, origin[1], z],
            )
        }
    }
}

fn cell_world_points(cell: &CellCoord, cell_size: f32, origin: [f32; 3]) -> [[f32; 3]; 4] {
    let x0 = origin[0] + cell.x as f32 * cell_size;
    let x1 = origin[0] + (cell.x + 1) as f32 * cell_size;
    let z0 = origin[2] + cell.z as f32 * cell_size;
    let z1 = origin[2] + (cell.z + 1) as f32 * cell_size;
    let y = origin[1];
    [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]]
}

/// Regenerates a painted cell set's whole region partition (every region's
/// own per-cell floor/ceiling, and a wall -- notched where a run borders a
/// different region -- along every boundary run) and diffs it against
/// whatever this same structure's bounding box already holds. Errors,
/// leaving nothing changed, if `cells` is empty or `cellSize` is not
/// positive.
pub fn generate_and_apply_region_partition(
    graph: &mut SessionGraph,
    surfaces: &mut SurfaceRegistry,
    topology: &mut ContourTopology,
    known_regions: &HashSet<RegionId>,
    request: GenerateAndApplyRegionPartitionRequest,
) -> Result<DiffResponse, String> {
    if request.cells.is_empty() {
        return Err("cells must not be empty".to_string());
    }
    if request.cell_size <= 0.0 {
        return Err("cellSize must be positive".to_string());
    }

    let cells: Vec<CellCoord> = request
        .cells
        .iter()
        .map(|cell| CellCoord {
            x: cell.x,
            z: cell.z,
        })
        .collect();
    let wall_type = SurfaceType::new(request.wall_type);
    let notch_type = SurfaceType::new(request.notch_type);
    let floor_type = SurfaceType::new(request.floor_type);
    let ceiling_type = SurfaceType::new(request.ceiling_type);

    let mut all_pieces = Vec::new();
    for cell in &cells {
        let points = cell_world_points(cell, request.cell_size, request.origin);
        all_pieces.push(cap_boundary(
            &points,
            &request.id_prefix,
            floor_type.clone(),
            false,
        ));
        all_pieces.push(cap_boundary(
            &points,
            &request.id_prefix,
            ceiling_type.clone(),
            true,
        ));
    }

    let regions = partition_cells_into_regions(&cells, request.max_region_cells, request.seed);
    for run in boundary_runs(&cells, &regions) {
        let (start, end) = run_world_endpoints(&run, request.cell_size, request.origin);
        let run_length = (run.to - run.from) as f32 * request.cell_size;
        let notch = (run.shared && run_length >= MIN_NOTCH_SEGMENT_WIDTH).then(|| EdgeNotch {
            starts_at: 0.5 - NOTCH_HALF_WIDTH,
            ends_at: 0.5 + NOTCH_HALF_WIDTH,
            surface_type: notch_type.clone(),
        });
        let edge = PathEdge {
            start,
            end,
            curvature: EdgeCurvature::Straight,
        };
        let pieces = extrude_path(
            &[edge],
            request.wall_height,
            notch.as_ref(),
            &request.id_prefix,
            wall_type.clone(),
        )
        .expect("a single straight edge with a centered default notch is always valid");
        all_pieces.extend(pieces);
    }

    let in_scope = bounding_box_scope(&all_pieces);
    let old_ids_in_scope = regions_in_scope(topology, graph, known_regions, &in_scope);

    let outcome = diff_and_apply(
        graph,
        surfaces,
        topology,
        &old_ids_in_scope,
        all_pieces,
        |node| in_scope(node.data()),
    )?;
    Ok(DiffResponse {
        added_surface_keys: outcome.added_surface_keys,
        removed_surface_keys: outcome.removed_surface_keys,
        removed_node_ids: outcome.removed_node_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafting_graph_core::Graph;

    fn empty_session() -> (
        SessionGraph,
        SurfaceRegistry,
        ContourTopology,
        HashSet<RegionId>,
    ) {
        (
            Graph::try_from_parts(Vec::new(), Vec::new()).unwrap(),
            SurfaceRegistry::new(),
            ContourTopology::new(),
            HashSet::new(),
        )
    }

    fn track(known: &mut HashSet<RegionId>, response: &DiffResponse) {
        for wire_key in &response.removed_surface_keys {
            known.remove(&crate::mesh::region_id_from_wire(wire_key).unwrap());
        }
        for wire_key in &response.added_surface_keys {
            known.insert(crate::mesh::region_id_from_wire(wire_key).unwrap());
        }
    }

    // -- path extrusion --

    fn region_request(
        cells: Vec<(i32, i32)>,
        max_region_cells: usize,
    ) -> GenerateAndApplyRegionPartitionRequest {
        GenerateAndApplyRegionPartitionRequest {
            cells: cells
                .into_iter()
                .map(|(x, z)| CellCoordDto { x, z })
                .collect(),
            cell_size: 2.0,
            origin: [0.0, 0.0, 0.0],
            wall_height: 3.0,
            max_region_cells,
            seed: 1,
            id_prefix: "brush-1".into(),
            wall_type: "wall-white".into(),
            notch_type: "door".into(),
            floor_type: "floor".into(),
            ceiling_type: "ceiling".into(),
        }
    }

    #[test]
    fn a_single_cell_gets_four_walls_and_a_floor_and_ceiling() {
        let (mut graph, mut surfaces, mut topology, known) = empty_session();
        let response = generate_and_apply_region_partition(
            &mut graph,
            &mut surfaces,
            &mut topology,
            &known,
            region_request(vec![(0, 0)], 6),
        )
        .unwrap();
        assert_eq!(response.added_surface_keys.len(), 6);
    }

    #[test]
    fn repainting_the_same_cell_is_a_no_op() {
        let (mut graph, mut surfaces, mut topology, mut known) = empty_session();
        let first = generate_and_apply_region_partition(
            &mut graph,
            &mut surfaces,
            &mut topology,
            &known,
            region_request(vec![(0, 0)], 6),
        )
        .unwrap();
        track(&mut known, &first);
        let second = generate_and_apply_region_partition(
            &mut graph,
            &mut surfaces,
            &mut topology,
            &known,
            region_request(vec![(0, 0)], 6),
        )
        .unwrap();
        assert!(second.added_surface_keys.is_empty());
        assert!(second.removed_surface_keys.is_empty());
    }

    #[test]
    fn growing_past_the_threshold_splits_with_a_notch_between_the_halves() {
        let (mut graph, mut surfaces, mut topology, mut known) = empty_session();
        let first = generate_and_apply_region_partition(
            &mut graph,
            &mut surfaces,
            &mut topology,
            &known,
            region_request(vec![(0, 0), (1, 0)], 2),
        )
        .unwrap();
        track(&mut known, &first);
        let doors_before = known
            .iter()
            .filter(|id| {
                surfaces
                    .region_surface(id)
                    .map(|s| s.surface_type().as_str() == "door")
                    .unwrap_or(false)
            })
            .count();
        assert_eq!(doors_before, 0);

        let second = generate_and_apply_region_partition(
            &mut graph,
            &mut surfaces,
            &mut topology,
            &known,
            region_request(vec![(0, 0), (1, 0), (2, 0)], 2),
        )
        .unwrap();
        track(&mut known, &second);
        let doors_after = known
            .iter()
            .filter(|id| {
                surfaces
                    .region_surface(id)
                    .map(|s| s.surface_type().as_str() == "door")
                    .unwrap_or(false)
            })
            .count();
        assert_eq!(
            doors_after, 1,
            "growing past the threshold must introduce exactly one split with a notch"
        );
    }

    #[test]
    fn empty_cells_errors_without_mutating() {
        let (mut graph, mut surfaces, mut topology, known) = empty_session();
        let error = generate_and_apply_region_partition(
            &mut graph,
            &mut surfaces,
            &mut topology,
            &known,
            region_request(vec![], 6),
        )
        .unwrap_err();
        assert!(error.contains("cells"));
        assert_eq!(graph.node_count(), 0);
    }
}
