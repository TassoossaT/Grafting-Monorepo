//! Derives walls (and, once a stroke closes back on itself, a floor and
//! ceiling) from an ordered path of straight and semicircular-arc edges --
//! the generic "draw a wall, close the loop, get a room" generator behind
//! a Tiny-Glade-style continuous wall brush. Generic on purpose (not
//! house-specific, not fence-specific): the app composition layer decides
//! what a particular closed or open path means; this crate only knows
//! about a path of edges and, when it closes, the room it bounds.
//!
//! Unlike [`crate::cell_partition::generate_cell_partition`], there is no
//! grid here -- a path vertex can sit anywhere, and a curved edge is
//! always a true semicircle (radius and center are fully determined by its
//! two endpoints, never a free parameter), not an arbitrary Bezier. That
//! restriction is deliberate: a free-form curve control lets a careless
//! stroke look crooked, while "straight, or a semicircle bulging one way
//! or the other" is a small enough vocabulary that any stroke reads as
//! intentional. See `docs/research/vtt-reactive-construction-and-tiny-glade-ui-model.md`.
//!
//! An arc edge never gets intermediate *path* vertices of its own -- it
//! stays one [`PathEdge`] with an [`EdgeCurvature::Semicircle`] tag, the
//! same way a straight run stays one edge regardless of length. The
//! `arc_facets` tessellation this module derives from that one edge is a
//! meshing detail (private, position-derived corner nodes, exactly the
//! same kind of jamb node a doored [`crate::wall::generate_wall`] already
//! mints), never fed back into the caller's own path/control-point model.
//!
//! Every corner this module mints is position-derived via
//! [`crate::ids::corner_id`], the same helper `cell_partition` uses -- an
//! arc's tessellated corners, a straight edge's endpoints, and a cell
//! grid's own corners all weld automatically wherever they land on the
//! same world position under the same `id_prefix`, without any generator
//! knowing about any other.

use std::error::Error;
use std::fmt;

use grafting_graph_core::{Node, NodeId, SurfaceSpec, SurfaceType};

use crate::ids::corner_id;
use crate::wall::{StructurePiece, WallNodeRole, WallSegment, generate_wall};

const EPS: f32 = 1e-3;

/// Which side of the chord (walking from an edge's `start` to its `end`) a
/// [`EdgeCurvature::Semicircle`] bulges toward. Which literal side "left"
/// lands on depends only on `start`/`end`'s own order -- callers drawing a
/// stroke in a consistent direction get a consistent, predictable bulge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArcBulge {
    /// Bulges toward the chord's left side, facing from `start` to `end`.
    Left,
    /// Bulges toward the chord's right side, facing from `start` to `end`.
    Right,
}

/// A [`PathEdge`]'s shape. `Semicircle`'s radius and center are always
/// fully determined by the edge's own `start`/`end` (radius is half the
/// chord length, center is the chord's midpoint) -- there is no separate
/// radius or control-point parameter to keep this from ever generating a
/// self-intersecting or otherwise "crooked" curve.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeCurvature {
    /// A flat wall run between the edge's two endpoints.
    Straight,
    /// A true semicircle between the edge's two endpoints -- radius and
    /// center are fully determined by them, only the bulge side varies.
    Semicircle(ArcBulge),
}

/// One edge of a wall path, at the path's own baseline Y. Every edge in one
/// [`generate_wall_path`] call must share the same `start[1]`/`end[1]` --
/// see that function's own doc for why.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PathEdge {
    /// This edge's own start, at the path's baseline Y.
    pub start: [f32; 3],
    /// This edge's own end, at the path's baseline Y.
    pub end: [f32; 3],
    /// This edge's shape.
    pub curvature: EdgeCurvature,
}

/// A wall path's generated pieces. `floor`/`ceiling` are `Some` only when
/// the path closes (its last edge's own `end` lands back on the first
/// edge's own `start`, in `x`/`z`) -- an open path (a fence, a partial
/// stroke) is walls only, same as a real fence has no floor.
#[derive(Debug, Clone, PartialEq)]
pub struct WallPathGeneration {
    /// Wall pieces, in path order; an arc edge contributes more than one.
    pub walls: Vec<StructurePiece>,
    /// The enclosed room's floor, one `Surface` for the whole boundary --
    /// `None` if the path never closes.
    pub floor: Option<StructurePiece>,
    /// The enclosed room's ceiling, mirroring `floor` at `wall_height`
    /// above the baseline -- `None` if the path never closes.
    pub ceiling: Option<StructurePiece>,
}

/// Why [`generate_wall_path`] could not derive a generation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WallPathError {
    /// `edges` was empty -- a path needs at least one edge.
    EmptyPath,
    /// `edges[index - 1].end` and `edges[index].start` do not land on the
    /// same `x`/`z` -- a path's edges must chain, each one starting where
    /// the last one ended.
    Discontinuous {
        /// The edge whose own `start` breaks the chain.
        index: usize,
    },
    /// `edges[index]`'s own `start[1]`/`end[1]` do not match the path's own
    /// baseline (`edges[0].start[1]`) -- every edge in one path shares one
    /// horizontal plane; a change in floor level is a new, separate path
    /// (and a new `id_prefix`, so it does not collide with this one -- see
    /// this module's doc on `id_prefix`).
    InconsistentBaseline {
        /// The edge whose own Y breaks the shared baseline.
        index: usize,
    },
    /// `edges[index]`'s `start` and `end` are the same point -- a
    /// zero-length edge has no direction to build a wall (or, for an arc,
    /// no chord to derive a radius from).
    DegenerateEdge {
        /// The zero-length edge.
        index: usize,
    },
    /// A `Semicircle` edge is present but `arc_facets` is fewer than 2,
    /// leaving no interior point to actually bend the wall through.
    TooFewArcFacets {
        /// The offending, too-low value that was supplied.
        arc_facets: usize,
    },
}

impl fmt::Display for WallPathError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyPath => write!(formatter, "wall path must have at least one edge"),
            Self::Discontinuous { index } => write!(formatter, "edge {index} does not start where edge {} ends", index.saturating_sub(1)),
            Self::InconsistentBaseline { index } => write!(formatter, "edge {index} does not share the path's own baseline Y"),
            Self::DegenerateEdge { index } => write!(formatter, "edge {index} has zero length"),
            Self::TooFewArcFacets { arc_facets } => write!(formatter, "arc_facets ({arc_facets}) must be at least 2 to tessellate a curved edge"),
        }
    }
}

impl Error for WallPathError {}

fn xz_close(a: [f32; 3], b: [f32; 3]) -> bool {
    (a[0] - b[0]).abs() < EPS && (a[2] - b[2]).abs() < EPS
}

/// Tessellates one semicircular edge into `arc_facets` straight chords,
/// `(from, to)` pairs covering `start` to `end` in order. The first pair's
/// `from` and the last pair's `to` are forced to the exact input
/// `start`/`end` (not just approximately equal after the trig round-trip),
/// so a tessellated arc's own endpoints weld byte-identically with
/// whatever straight edge or other arc shares that same path vertex.
fn tessellate_semicircle(start: [f32; 3], end: [f32; 3], bulge: ArcBulge, arc_facets: usize) -> Vec<([f32; 3], [f32; 3])> {
    let y = start[1];
    let (sx, sz) = (start[0], start[2]);
    let (ex, ez) = (end[0], end[2]);
    let (mx, mz) = ((sx + ex) / 2.0, (sz + ez) / 2.0);
    let chord_length = ((ex - sx).powi(2) + (ez - sz).powi(2)).sqrt();
    let radius = chord_length / 2.0;
    let (ux, uz) = ((ex - sx) / chord_length, (ez - sz) / chord_length);
    // Perpendicular to the chord direction, in the XZ plane.
    let (nx, nz) = (-uz, ux);
    let sign: f32 = match bulge {
        ArcBulge::Left => 1.0,
        ArcBulge::Right => -1.0,
    };

    let mut points: Vec<[f32; 3]> = Vec::with_capacity(arc_facets + 1);
    for step in 0..=arc_facets {
        if step == 0 {
            points.push(start);
            continue;
        }
        if step == arc_facets {
            points.push(end);
            continue;
        }
        let t = step as f32 / arc_facets as f32;
        // theta sweeps from PI (start) to 0 (end); sin(theta) >= 0 across
        // that whole range, so the bulge sits on exactly one side (`sign`)
        // of the chord for the whole arc, never crossing back over it.
        let theta = std::f32::consts::PI * (1.0 - t);
        let x = mx + radius * theta.cos() * ux + sign * radius * theta.sin() * nx;
        let z = mz + radius * theta.cos() * uz + sign * radius * theta.sin() * nz;
        points.push([x, y, z]);
    }

    points.windows(2).map(|pair| (pair[0], pair[1])).collect()
}

fn straight_sub_segments(edge: &PathEdge, arc_facets: usize) -> Vec<([f32; 3], [f32; 3])> {
    match edge.curvature {
        EdgeCurvature::Straight => vec![(edge.start, edge.end)],
        EdgeCurvature::Semicircle(bulge) => tessellate_semicircle(edge.start, edge.end, bulge, arc_facets),
    }
}

fn wall_sub_segment_piece(id_prefix: &str, from: [f32; 3], to: [f32; 3], wall_height: f32, wall_type: SurfaceType) -> StructurePiece {
    let node_id = |role: WallNodeRole| -> NodeId {
        match role {
            WallNodeRole::StartBottom => corner_id(id_prefix, from[0], from[2], false),
            WallNodeRole::StartTop => corner_id(id_prefix, from[0], from[2], true),
            WallNodeRole::EndBottom => corner_id(id_prefix, to[0], to[2], false),
            WallNodeRole::EndTop => corner_id(id_prefix, to[0], to[2], true),
            other => unreachable!("wall_path never opens a door, so no {other:?} role is ever requested"),
        }
    };
    let edge_id = |from_role: WallNodeRole, to_role: WallNodeRole| {
        grafting_graph_core::EdgeId::new(format!("{}:{}", node_id(from_role).as_str(), node_id(to_role).as_str())).expect("formatted id is never empty")
    };
    let wall = WallSegment { start: from, end: to, height: wall_height };
    let generation = generate_wall(&wall, None, node_id, edge_id, wall_type.clone(), wall_type).expect("no door is ever passed, so validation never fails");
    generation.pieces.into_iter().next().expect("a wall with no door always generates exactly one piece")
}

fn floor_or_ceiling_piece(id_prefix: &str, boundary_xz: &[(f32, f32)], y: f32, surface_type: SurfaceType, top: bool) -> StructurePiece {
    let mut ids: Vec<NodeId> = boundary_xz.iter().map(|(x, z)| corner_id(id_prefix, *x, *z, top)).collect();
    let mut nodes: Vec<Node<[f32; 3]>> = ids.iter().zip(boundary_xz).map(|(id, (x, z))| Node::new(id.clone(), [*x, y, *z])).collect();
    if top {
        // Reverse winding relative to the floor so the ceiling's derived
        // face normal points the opposite way -- same convention
        // `cell_partition::cell_floor_ceiling` already uses.
        ids.reverse();
        nodes.reverse();
    }
    StructurePiece { nodes, edges: Vec::new(), surface: SurfaceSpec { cycle: ids, surface_type, physical: true } }
}

/// Generates a wall path's walls and, if the path closes, its floor and
/// ceiling. Every edge must share one baseline Y (`edges[0].start[1]`) and
/// chain continuously (`edges[i].end` in `x`/`z` == `edges[i + 1].start`).
/// The path is a closed room iff the last edge's own `end` lands back on
/// the first edge's own `start`, in `x`/`z`.
///
/// `id_prefix` must stay the same fixed value across every tick of one
/// stroke and across separate strokes extending the same physical
/// structure later -- exactly [`crate::cell_partition::generate_cell_partition`]'s
/// own `id_prefix` contract, for the same reason (idempotent regeneration
/// keyed by position). It must also vary per floor/level sharing the same
/// footprint: a corner's id never encodes Y (see [`crate::ids::corner_id`]),
/// so two floors reusing one `id_prefix` would mint colliding corners for
/// any footprint they share.
#[allow(clippy::too_many_arguments)]
pub fn generate_wall_path(
    edges: &[PathEdge],
    wall_height: f32,
    arc_facets: usize,
    id_prefix: &str,
    wall_type: SurfaceType,
    floor_type: SurfaceType,
    ceiling_type: SurfaceType,
) -> Result<WallPathGeneration, WallPathError> {
    if edges.is_empty() {
        return Err(WallPathError::EmptyPath);
    }
    if edges.iter().any(|edge| matches!(edge.curvature, EdgeCurvature::Semicircle(_))) && arc_facets < 2 {
        return Err(WallPathError::TooFewArcFacets { arc_facets });
    }
    let baseline_y = edges[0].start[1];
    for (index, edge) in edges.iter().enumerate() {
        if (edge.start[0] - edge.end[0]).abs() < EPS && (edge.start[2] - edge.end[2]).abs() < EPS {
            return Err(WallPathError::DegenerateEdge { index });
        }
        if (edge.start[1] - baseline_y).abs() > EPS || (edge.end[1] - baseline_y).abs() > EPS {
            return Err(WallPathError::InconsistentBaseline { index });
        }
        if index > 0 && !xz_close(edges[index - 1].end, edge.start) {
            return Err(WallPathError::Discontinuous { index });
        }
    }

    let mut walls = Vec::new();
    let mut boundary_xz: Vec<(f32, f32)> = Vec::new();
    for edge in edges {
        for (from, to) in straight_sub_segments(edge, arc_facets) {
            walls.push(wall_sub_segment_piece(id_prefix, from, to, wall_height, wall_type.clone()));
            boundary_xz.push((from[0], from[2]));
        }
    }

    let closed = xz_close(edges[edges.len() - 1].end, edges[0].start);
    let (floor, ceiling) = if closed && boundary_xz.len() >= 3 {
        (
            Some(floor_or_ceiling_piece(id_prefix, &boundary_xz, baseline_y, floor_type, false)),
            Some(floor_or_ceiling_piece(id_prefix, &boundary_xz, baseline_y + wall_height, ceiling_type, true)),
        )
    } else {
        (None, None)
    };

    Ok(WallPathGeneration { walls, floor, ceiling })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn types() -> (SurfaceType, SurfaceType, SurfaceType) {
        (SurfaceType::new("wall-white"), SurfaceType::new("floor"), SurfaceType::new("ceiling"))
    }

    fn straight(start: [f32; 3], end: [f32; 3]) -> PathEdge {
        PathEdge { start, end, curvature: EdgeCurvature::Straight }
    }

    #[test]
    fn an_open_path_generates_walls_but_no_floor_or_ceiling() {
        let edges = vec![straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0]), straight([4.0, 0.0, 0.0], [4.0, 0.0, 4.0])];
        let (wall_type, floor_type, ceiling_type) = types();
        let generation = generate_wall_path(&edges, 3.0, 8, "fence-1", wall_type, floor_type, ceiling_type).unwrap();
        assert_eq!(generation.walls.len(), 2);
        assert!(generation.floor.is_none());
        assert!(generation.ceiling.is_none());
    }

    #[test]
    fn a_closed_square_generates_four_walls_and_a_matching_floor_and_ceiling() {
        let edges = vec![
            straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0]),
            straight([4.0, 0.0, 0.0], [4.0, 0.0, 4.0]),
            straight([4.0, 0.0, 4.0], [0.0, 0.0, 4.0]),
            straight([0.0, 0.0, 4.0], [0.0, 0.0, 0.0]),
        ];
        let (wall_type, floor_type, ceiling_type) = types();
        let generation = generate_wall_path(&edges, 3.0, 8, "house-1", wall_type, floor_type, ceiling_type).unwrap();
        assert_eq!(generation.walls.len(), 4);
        let floor = generation.floor.expect("closed path has a floor");
        let ceiling = generation.ceiling.expect("closed path has a ceiling");
        assert_eq!(floor.surface.cycle.len(), 4);
        assert_eq!(ceiling.surface.cycle.len(), 4);
        // Every floor corner sits at y = 0, every ceiling corner at y = 3.
        assert!(floor.nodes.iter().all(|node| node.data()[1] == 0.0));
        assert!(ceiling.nodes.iter().all(|node| node.data()[1] == 3.0));
    }

    #[test]
    fn a_semicircle_edge_tessellates_into_arc_facets_wall_pieces_with_endpoints_snapped_exactly() {
        let edges = vec![PathEdge { start: [0.0, 0.0, 0.0], end: [4.0, 0.0, 0.0], curvature: EdgeCurvature::Semicircle(ArcBulge::Left) }];
        let (wall_type, floor_type, ceiling_type) = types();
        let generation = generate_wall_path(&edges, 3.0, 6, "arc-1", wall_type, floor_type, ceiling_type).unwrap();
        assert_eq!(generation.walls.len(), 6);
        assert_eq!(*generation.walls[0].nodes[0].data(), [0.0, 0.0, 0.0]);
        let last = generation.walls.last().unwrap();
        assert_eq!(*last.nodes[1].data(), [4.0, 0.0, 0.0]);
        // The arc's own midpoint facet must bulge to one side of the chord (x != 2.0 is not
        // guaranteed, but z must move away from 0 -- the chord itself is along z = 0).
        let mid_facet_start = generation.walls[3].nodes[0].data();
        assert!(mid_facet_start[2].abs() > 0.5, "midpoint of a 4-unit-chord semicircle should bulge well off the chord line");
    }

    #[test]
    fn two_semicircles_walked_in_a_loop_close_into_a_lens_shaped_room() {
        // Both edges bulge "Left" relative to their own direction of
        // travel, but edge 2 walks back the other way along the same
        // chord -- so its "Left" lands on the opposite absolute side from
        // edge 1's, and together they bulge outward on both sides,
        // forming a lens instead of retracing the same curve.
        let edges = vec![
            PathEdge { start: [0.0, 0.0, 0.0], end: [4.0, 0.0, 0.0], curvature: EdgeCurvature::Semicircle(ArcBulge::Left) },
            PathEdge { start: [4.0, 0.0, 0.0], end: [0.0, 0.0, 0.0], curvature: EdgeCurvature::Semicircle(ArcBulge::Left) },
        ];
        let (wall_type, floor_type, ceiling_type) = types();
        let generation = generate_wall_path(&edges, 3.0, 6, "lens-1", wall_type, floor_type, ceiling_type).unwrap();
        assert_eq!(generation.walls.len(), 12);
        assert!(generation.floor.is_some(), "a path that returns to its own start must be treated as closed");
    }

    #[test]
    fn repainting_the_same_path_yields_identical_corner_ids() {
        let edges = vec![straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0])];
        let (wall_type, floor_type, ceiling_type) = types();
        let a = generate_wall_path(&edges, 3.0, 8, "house-1", wall_type.clone(), floor_type.clone(), ceiling_type.clone()).unwrap();
        let b = generate_wall_path(&edges, 3.0, 8, "house-1", wall_type, floor_type, ceiling_type).unwrap();
        assert_eq!(a.walls[0].surface.cycle, b.walls[0].surface.cycle);
    }

    #[test]
    fn two_floors_sharing_a_footprint_use_distinct_id_prefixes_to_avoid_colliding() {
        // Same x/z footprint, different baseline Y -- exactly the "second
        // story" case that collides if a caller reuses one id_prefix for
        // both floors (see this module's own doc on `id_prefix`).
        let ground = vec![straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0])];
        let upper = vec![straight([0.0, 3.0, 0.0], [4.0, 3.0, 0.0])];
        let (wall_type, floor_type, ceiling_type) = types();
        let ground_generation = generate_wall_path(&ground, 3.0, 8, "house-1:floor-0", wall_type.clone(), floor_type.clone(), ceiling_type.clone()).unwrap();
        let upper_generation = generate_wall_path(&upper, 3.0, 8, "house-1:floor-1", wall_type, floor_type, ceiling_type).unwrap();
        assert_ne!(ground_generation.walls[0].surface.cycle, upper_generation.walls[0].surface.cycle, "distinct id_prefixes must mint distinct corners even at the same x/z");
    }

    #[test]
    fn a_discontinuous_path_is_rejected() {
        let edges = vec![straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0]), straight([9.0, 0.0, 0.0], [9.0, 0.0, 4.0])];
        let (wall_type, floor_type, ceiling_type) = types();
        let error = generate_wall_path(&edges, 3.0, 8, "house-1", wall_type, floor_type, ceiling_type).unwrap_err();
        assert_eq!(error, WallPathError::Discontinuous { index: 1 });
    }

    #[test]
    fn a_semicircle_with_too_few_arc_facets_is_rejected() {
        let edges = vec![PathEdge { start: [0.0, 0.0, 0.0], end: [4.0, 0.0, 0.0], curvature: EdgeCurvature::Semicircle(ArcBulge::Left) }];
        let (wall_type, floor_type, ceiling_type) = types();
        let error = generate_wall_path(&edges, 3.0, 1, "arc-1", wall_type, floor_type, ceiling_type).unwrap_err();
        assert_eq!(error, WallPathError::TooFewArcFacets { arc_facets: 1 });
    }
}
