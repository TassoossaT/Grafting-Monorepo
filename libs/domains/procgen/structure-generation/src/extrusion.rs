//! Extrudes a path of straight and semicircular-arc edges into vertical
//! panel `Surface`s, with an optional single rectangular notch (a doorway,
//! a gateway, a gap -- this crate names none of them) cut into it. Generic
//! on purpose: the app composition layer decides what a particular path or
//! notch means; this crate only knows about edges, height, and an optional
//! opening.
//!
//! Unlike [`crate::region_partition`]'s grid, a path vertex can sit
//! anywhere, and a curved edge is always a true semicircle (radius and
//! center are fully determined by its two endpoints, never a free
//! parameter), not an arbitrary Bezier. That restriction is deliberate: a
//! free-form curve control lets a careless stroke look crooked, while
//! "straight, or a semicircle bulging one way or the other" is a small
//! enough vocabulary that any stroke reads as intentional. See
//! `docs/research/vtt-reactive-construction-and-tiny-glade-ui-model.md`.
//!
//! An arc edge never gets intermediate *path* vertices of its own -- it
//! stays one [`PathEdge`] with an [`EdgeCurvature::Semicircle`] tag, the
//! same way a straight run stays one edge regardless of length. The
//! `arc_facets` tessellation this module derives from that one edge stays a
//! meshing detail too: a curved edge extrudes into exactly one
//! [`StructurePiece`] (an `2 * (arc_facets + 1)`-node ring), never one piece
//! per facet -- every downstream consumer (a redundant-perimeter filter, a
//! wall-follower tracing a room's own boundary, a notch, `removeSurface`)
//! already treats "one wall run" as one `Surface`, and slicing a curve into
//! many separate small `Surface`s made every one of those boundaries a seam
//! a caller could observe (and mis-treat as its own opening or its own
//! candidate for redundant-duplicate stripping) instead of the curve
//! reading as the single object it visually is.
//!
//! Every corner this module mints is position-derived via
//! [`crate::ids::corner_id`], the same helper [`crate::region_partition`]
//! and [`crate::boundary`] use -- an arc's tessellated corners, a straight
//! edge's endpoints, and a notch's own jamb points all weld automatically
//! wherever they land on the same world position under the same
//! `id_prefix`, without any generator knowing about any other.
//!
//! A notch is v1-scoped to a single straight edge -- the exact shape every
//! caller today already needs (one wall run, one opening). A multi-edge or
//! curved path with a notch is rejected rather than guessed at; lifting
//! that scope is a deliberate, documented follow-up, not a silent
//! approximation.

use std::error::Error;
use std::fmt;

use grafting_graph_core::{Edge, EdgeId, Node, SurfaceSpec, SurfaceType};

use crate::ids::corner_id;

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
    /// A flat run between the edge's two endpoints.
    Straight,
    /// A true semicircle between the edge's two endpoints -- radius and
    /// center are fully determined by them, only the bulge side varies.
    Semicircle(ArcBulge),
}

/// One edge of a path, at the path's own baseline Y. Every edge in one
/// [`extrude_path`] call must share the same `start[1]`/`end[1]`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PathEdge {
    /// This edge's own start, at the path's baseline Y.
    pub start: [f32; 3],
    /// This edge's own end, at the path's baseline Y.
    pub end: [f32; 3],
    /// This edge's shape.
    pub curvature: EdgeCurvature,
}

/// A gap cut into an extruded edge, as fractions along it. `starts_at` must
/// be less than `ends_at`, both within `[0, 1]`. V1: the opening spans the
/// full extrusion height -- no lintel piece above it.
#[derive(Debug, Clone, PartialEq)]
pub struct EdgeNotch {
    /// Fraction along the edge where the opening begins.
    pub starts_at: f32,
    /// Fraction along the edge where the opening ends.
    pub ends_at: f32,
    /// The opening's own surface type -- distinct from the solid panel's.
    pub surface_type: SurfaceType,
}

/// One generated piece of an extrusion (a whole panel, or one
/// remainder/notch segment of a panel with an opening): its own new
/// nodes/edges, and the [`SurfaceSpec`] they form. Nodes shared with a
/// sibling piece (a notch's own jamb corners, or two adjacent path
/// sub-segments) are emitted by every piece whose cycle includes them,
/// under the same [`NodeId`] (position-derived, via `corner_id`) -- a
/// caller applying more than one piece to a live graph is responsible for
/// not re-adding an id already present.
#[derive(Debug, Clone, PartialEq)]
pub struct StructurePiece {
    /// This piece's nodes, in cycle order.
    pub nodes: Vec<Node<[f32; 3]>>,
    /// This piece's ring edges, connecting `nodes` consecutively.
    pub edges: Vec<Edge<()>>,
    /// The surface `nodes` forms.
    pub surface: SurfaceSpec,
}

/// Why [`extrude_path`] could not derive an extrusion.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ExtrusionError {
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
    /// baseline (`edges[0].start[1]`).
    InconsistentBaseline {
        /// The edge whose own Y breaks the shared baseline.
        index: usize,
    },
    /// `edges[index]`'s `start` and `end` are the same point.
    DegenerateEdge {
        /// The zero-length edge.
        index: usize,
    },
    /// A `Semicircle` edge is present but `arc_facets` is fewer than 2.
    TooFewArcFacets {
        /// The offending, too-low value that was supplied.
        arc_facets: usize,
    },
    /// A notch was given but `edges` was not exactly one `Straight` edge --
    /// see this module's own doc on the v1 notch scope.
    NotchRequiresSingleStraightEdge,
    /// `notch`'s fractions were outside `[0, 1]`, or `starts_at` was not
    /// strictly less than `ends_at`.
    InvalidNotch {
        /// The notch's supplied start fraction.
        starts_at: f32,
        /// The notch's supplied end fraction.
        ends_at: f32,
    },
}

impl fmt::Display for ExtrusionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyPath => write!(formatter, "path must have at least one edge"),
            Self::Discontinuous { index } => write!(formatter, "edge {index} does not start where edge {} ends", index.saturating_sub(1)),
            Self::InconsistentBaseline { index } => write!(formatter, "edge {index} does not share the path's own baseline Y"),
            Self::DegenerateEdge { index } => write!(formatter, "edge {index} has zero length"),
            Self::TooFewArcFacets { arc_facets } => write!(formatter, "arc_facets ({arc_facets}) must be at least 2 to tessellate a curved edge"),
            Self::NotchRequiresSingleStraightEdge => write!(formatter, "a notch requires exactly one straight edge"),
            Self::InvalidNotch { starts_at, ends_at } => write!(formatter, "notch [{starts_at}, {ends_at}] must be within [0, 1] with starts_at < ends_at"),
        }
    }
}

impl Error for ExtrusionError {}

fn xz_close(a: [f32; 3], b: [f32; 3]) -> bool {
    (a[0] - b[0]).abs() < EPS && (a[2] - b[2]).abs() < EPS
}

fn validate(edges: &[PathEdge], arc_facets: usize) -> Result<(), ExtrusionError> {
    if edges.is_empty() {
        return Err(ExtrusionError::EmptyPath);
    }
    if edges.iter().any(|edge| matches!(edge.curvature, EdgeCurvature::Semicircle(_))) && arc_facets < 2 {
        return Err(ExtrusionError::TooFewArcFacets { arc_facets });
    }
    let baseline_y = edges[0].start[1];
    for (index, edge) in edges.iter().enumerate() {
        if xz_close(edge.start, edge.end) {
            return Err(ExtrusionError::DegenerateEdge { index });
        }
        if (edge.start[1] - baseline_y).abs() > EPS || (edge.end[1] - baseline_y).abs() > EPS {
            return Err(ExtrusionError::InconsistentBaseline { index });
        }
        if index > 0 && !xz_close(edges[index - 1].end, edge.start) {
            return Err(ExtrusionError::Discontinuous { index });
        }
    }
    Ok(())
}

/// Tessellates one semicircular edge into the `arc_facets + 1` points of its
/// own polyline, `start` to `end` in order. The first and last points are
/// forced to the exact input `start`/`end` (not just approximately equal
/// after the trig round-trip), so a tessellated arc's own endpoints weld
/// byte-identically with whatever straight edge or other arc shares that
/// same path vertex.
fn tessellate_semicircle_points(start: [f32; 3], end: [f32; 3], bulge: ArcBulge, arc_facets: usize) -> Vec<[f32; 3]> {
    let y = start[1];
    let (sx, sz) = (start[0], start[2]);
    let (ex, ez) = (end[0], end[2]);
    let (mx, mz) = ((sx + ex) / 2.0, (sz + ez) / 2.0);
    let chord_length = ((ex - sx).powi(2) + (ez - sz).powi(2)).sqrt();
    let radius = chord_length / 2.0;
    let (ux, uz) = ((ex - sx) / chord_length, (ez - sz) / chord_length);
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
        let theta = std::f32::consts::PI * (1.0 - t);
        let x = mx + radius * theta.cos() * ux + sign * radius * theta.sin() * nx;
        let z = mz + radius * theta.cos() * uz + sign * radius * theta.sin() * nz;
        points.push([x, y, z]);
    }
    points
}

/// One flat panel between `from` and `to` (both at the path's baseline Y),
/// rising `height` above it. Every corner is minted via `corner_id`, keyed
/// by `id_prefix` and each corner's own `x`/`z` -- no caller-supplied
/// identity, matching every other generator in this crate.
fn quad_piece(id_prefix: &str, from: [f32; 3], to: [f32; 3], height: f32, surface_type: SurfaceType) -> StructurePiece {
    let ids = [
        corner_id(id_prefix, from[0], from[2], false),
        corner_id(id_prefix, to[0], to[2], false),
        corner_id(id_prefix, to[0], to[2], true),
        corner_id(id_prefix, from[0], from[2], true),
    ];
    let positions = [from, to, [to[0], to[1] + height, to[2]], [from[0], from[1] + height, from[2]]];
    let nodes: Vec<Node<[f32; 3]>> = ids.iter().cloned().zip(positions).map(|(id, position)| Node::new(id, position)).collect();
    let mut edges = Vec::with_capacity(4);
    for index in 0..4 {
        let next = (index + 1) % 4;
        let edge_id = EdgeId::new(format!("{}:{}", ids[index].as_str(), ids[next].as_str())).expect("formatted id is never empty");
        edges.push(Edge::new(edge_id, ids[index].clone(), ids[next].clone(), ()));
    }
    StructurePiece { nodes, edges, surface: SurfaceSpec { cycle: ids.to_vec(), surface_type, physical: true } }
}

/// One curved panel spanning every point of an already-tessellated polyline
/// (`points[0]` through `points[points.len() - 1]`, both at the path's
/// baseline Y), rising `height` above it -- the ring generalization of
/// [`quad_piece`] (a straight edge's two-point polyline *is* the
/// `points.len() == 2` case of this same construction: bottom row in order,
/// top row reversed, so the two share one winding convention). One
/// `StructurePiece`, one `Surface`, regardless of how many facets the arc
/// was tessellated into -- see this module's own top-level doc for why that
/// matters to every other tool that treats "one wall run" as "one
/// `Surface`."
fn ring_piece(id_prefix: &str, points: &[[f32; 3]], height: f32, surface_type: SurfaceType) -> StructurePiece {
    let bottom_ids: Vec<_> = points.iter().map(|point| corner_id(id_prefix, point[0], point[2], false)).collect();
    let top_ids: Vec<_> = points.iter().map(|point| corner_id(id_prefix, point[0], point[2], true)).collect();

    let mut ids = bottom_ids.clone();
    ids.extend(top_ids.iter().rev().cloned());

    let mut nodes: Vec<Node<[f32; 3]>> = Vec::with_capacity(ids.len());
    nodes.extend(bottom_ids.iter().cloned().zip(points.iter().copied()).map(|(id, point)| Node::new(id, point)));
    nodes.extend(top_ids.iter().cloned().zip(points.iter().copied()).rev().map(|(id, point)| Node::new(id, [point[0], point[1] + height, point[2]])));

    let mut edges = Vec::with_capacity(ids.len());
    for index in 0..ids.len() {
        let next = (index + 1) % ids.len();
        let edge_id = EdgeId::new(format!("{}:{}", ids[index].as_str(), ids[next].as_str())).expect("formatted id is never empty");
        edges.push(Edge::new(edge_id, ids[index].clone(), ids[next].clone(), ()));
    }
    StructurePiece { nodes, edges, surface: SurfaceSpec { cycle: ids, surface_type, physical: true } }
}

fn position_along(edge: &PathEdge, fraction: f32) -> [f32; 3] {
    [
        edge.start[0] + (edge.end[0] - edge.start[0]) * fraction,
        edge.start[1],
        edge.start[2] + (edge.end[2] - edge.start[2]) * fraction,
    ]
}

fn notched_pieces(id_prefix: &str, edge: &PathEdge, height: f32, notch: &EdgeNotch, surface_type: SurfaceType) -> Vec<StructurePiece> {
    let start = position_along(edge, 0.0);
    let end = position_along(edge, 1.0);
    let notch_start = position_along(edge, notch.starts_at);
    let notch_end = position_along(edge, notch.ends_at);

    let opens_at_start = notch.starts_at == 0.0;
    let closes_at_end = notch.ends_at == 1.0;

    match (opens_at_start, closes_at_end) {
        (true, true) => vec![quad_piece(id_prefix, start, end, height, notch.surface_type.clone())],
        (true, false) => vec![
            quad_piece(id_prefix, start, notch_end, height, notch.surface_type.clone()),
            quad_piece(id_prefix, notch_end, end, height, surface_type),
        ],
        (false, true) => vec![
            quad_piece(id_prefix, start, notch_start, height, surface_type),
            quad_piece(id_prefix, notch_start, end, height, notch.surface_type.clone()),
        ],
        (false, false) => vec![
            quad_piece(id_prefix, start, notch_start, height, surface_type.clone()),
            quad_piece(id_prefix, notch_start, notch_end, height, notch.surface_type.clone()),
            quad_piece(id_prefix, notch_end, end, height, surface_type),
        ],
    }
}

/// Extrudes `edges` into vertical panel pieces, cutting `notch` into them if
/// given. Errors, leaving nothing behind, if `edges` is empty, doesn't
/// chain continuously, doesn't share one baseline Y, contains a zero-length
/// edge, has a curved edge with too few `arc_facets`, or `notch` is given
/// against anything but a single straight edge.
///
/// `id_prefix` must stay the same fixed value across every tick of one
/// stroke and across separate strokes extending the same physical
/// structure later, and must vary per floor/level sharing the same
/// footprint -- a corner id never encodes Y, only `id_prefix` and its own
/// `x`/`z`, so two floors reusing one `id_prefix` would mint colliding
/// corners for any footprint they share.
pub fn extrude_path(
    edges: &[PathEdge],
    height: f32,
    notch: Option<&EdgeNotch>,
    arc_facets: usize,
    id_prefix: &str,
    surface_type: SurfaceType,
) -> Result<Vec<StructurePiece>, ExtrusionError> {
    validate(edges, arc_facets)?;

    if let Some(notch) = notch {
        if edges.len() != 1 || !matches!(edges[0].curvature, EdgeCurvature::Straight) {
            return Err(ExtrusionError::NotchRequiresSingleStraightEdge);
        }
        if !(0.0..=1.0).contains(&notch.starts_at) || !(0.0..=1.0).contains(&notch.ends_at) || notch.starts_at >= notch.ends_at {
            return Err(ExtrusionError::InvalidNotch { starts_at: notch.starts_at, ends_at: notch.ends_at });
        }
        return Ok(notched_pieces(id_prefix, &edges[0], height, notch, surface_type));
    }

    let mut pieces = Vec::with_capacity(edges.len());
    for edge in edges {
        let piece = match edge.curvature {
            EdgeCurvature::Straight => quad_piece(id_prefix, edge.start, edge.end, height, surface_type.clone()),
            EdgeCurvature::Semicircle(bulge) => {
                let points = tessellate_semicircle_points(edge.start, edge.end, bulge, arc_facets);
                ring_piece(id_prefix, &points, height, surface_type.clone())
            }
        };
        pieces.push(piece);
    }
    Ok(pieces)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn straight(start: [f32; 3], end: [f32; 3]) -> PathEdge {
        PathEdge { start, end, curvature: EdgeCurvature::Straight }
    }

    fn surface_type() -> SurfaceType {
        SurfaceType::new("panel")
    }

    fn notch_type() -> SurfaceType {
        SurfaceType::new("opening")
    }

    #[test]
    fn a_single_straight_edge_extrudes_one_quad() {
        let edges = [straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0])];
        let pieces = extrude_path(&edges, 3.0, None, 8, "wall-1", surface_type()).unwrap();
        assert_eq!(pieces.len(), 1);
        let piece = &pieces[0];
        assert_eq!(*piece.nodes[0].data(), [0.0, 0.0, 0.0]);
        assert_eq!(*piece.nodes[1].data(), [4.0, 0.0, 0.0]);
        assert_eq!(*piece.nodes[2].data(), [4.0, 3.0, 0.0]);
        assert_eq!(*piece.nodes[3].data(), [0.0, 3.0, 0.0]);
    }

    /// An edge running along Z must not collapse its top edge back onto its
    /// own centerline -- height has to land on a different axis than the
    /// edge's own length, regardless of which horizontal direction it runs.
    #[test]
    fn an_edge_running_along_z_keeps_top_and_bottom_on_distinct_axes() {
        let edges = [straight([2.0, 0.0, 0.0], [2.0, 0.0, 4.0])];
        let pieces = extrude_path(&edges, 3.0, None, 8, "wall-1", surface_type()).unwrap();
        let piece = &pieces[0];
        assert_eq!(*piece.nodes[2].data(), [2.0, 3.0, 4.0]);
        assert_eq!(*piece.nodes[3].data(), [2.0, 3.0, 0.0]);
    }

    #[test]
    fn a_multi_edge_open_path_extrudes_one_quad_per_edge() {
        let edges = [straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0]), straight([4.0, 0.0, 0.0], [4.0, 0.0, 4.0])];
        let pieces = extrude_path(&edges, 3.0, None, 8, "fence-1", surface_type()).unwrap();
        assert_eq!(pieces.len(), 2);
    }

    #[test]
    fn a_semicircle_edge_extrudes_into_one_ring_piece_with_endpoints_snapped_exactly() {
        let edges = [PathEdge { start: [0.0, 0.0, 0.0], end: [4.0, 0.0, 0.0], curvature: EdgeCurvature::Semicircle(ArcBulge::Left) }];
        let pieces = extrude_path(&edges, 3.0, None, 6, "arc-1", surface_type()).unwrap();
        assert_eq!(pieces.len(), 1, "one curved edge must extrude into exactly one Surface, not one per facet");
        let piece = &pieces[0];
        // 6 facets -> 7 points on the bottom ring, 7 mirrored on top -> 14 nodes total.
        assert_eq!(piece.nodes.len(), 14);
        assert_eq!(*piece.nodes[0].data(), [0.0, 0.0, 0.0], "the ring's first bottom node is the edge's own start");
        assert_eq!(*piece.nodes[6].data(), [4.0, 0.0, 0.0], "the ring's last bottom node is the edge's own end");
        assert_eq!(*piece.nodes[7].data(), [4.0, 3.0, 0.0], "the top ring starts back at the end, mirrored at height");
        assert_eq!(*piece.nodes[13].data(), [0.0, 3.0, 0.0], "the top ring closes back at the start, mirrored at height");
    }

    /// A curved edge chained after a straight one in the same multi-edge
    /// path still extrudes into two separate pieces (one per edge) -- the
    /// single-`Surface`-per-curve fix only collapses a curve's own internal
    /// facets, it does not fuse distinct edges of one path together.
    #[test]
    fn a_straight_edge_followed_by_a_curve_extrudes_into_two_pieces() {
        let edges = [
            straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0]),
            PathEdge { start: [4.0, 0.0, 0.0], end: [4.0, 0.0, 4.0], curvature: EdgeCurvature::Semicircle(ArcBulge::Left) },
        ];
        let pieces = extrude_path(&edges, 3.0, None, 4, "mixed-1", surface_type()).unwrap();
        assert_eq!(pieces.len(), 2);
        assert_eq!(pieces[0].nodes.len(), 4);
        assert_eq!(pieces[1].nodes.len(), 10);
    }

    #[test]
    fn repainting_the_same_path_yields_identical_corner_ids() {
        let edges = [straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0])];
        let a = extrude_path(&edges, 3.0, None, 8, "house-1", surface_type()).unwrap();
        let b = extrude_path(&edges, 3.0, None, 8, "house-1", surface_type()).unwrap();
        assert_eq!(a[0].surface.cycle, b[0].surface.cycle);
    }

    #[test]
    fn a_discontinuous_path_is_rejected() {
        let edges = [straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0]), straight([9.0, 0.0, 0.0], [9.0, 0.0, 4.0])];
        let error = extrude_path(&edges, 3.0, None, 8, "house-1", surface_type()).unwrap_err();
        assert_eq!(error, ExtrusionError::Discontinuous { index: 1 });
    }

    #[test]
    fn a_semicircle_with_too_few_arc_facets_is_rejected() {
        let edges = [PathEdge { start: [0.0, 0.0, 0.0], end: [4.0, 0.0, 0.0], curvature: EdgeCurvature::Semicircle(ArcBulge::Left) }];
        let error = extrude_path(&edges, 3.0, None, 1, "arc-1", surface_type()).unwrap_err();
        assert_eq!(error, ExtrusionError::TooFewArcFacets { arc_facets: 1 });
    }

    #[test]
    fn an_interior_notch_generates_three_pieces_sharing_jamb_identity() {
        let edges = [straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0])];
        let notch = EdgeNotch { starts_at: 0.25, ends_at: 0.75, surface_type: notch_type() };
        let pieces = extrude_path(&edges, 3.0, Some(&notch), 8, "wall-1", surface_type()).unwrap();
        assert_eq!(pieces.len(), 3);
        assert_eq!(pieces[0].surface.surface_type, surface_type());
        assert_eq!(pieces[1].surface.surface_type, notch_type());
        assert_eq!(pieces[2].surface.surface_type, surface_type());
        assert_eq!(pieces[0].nodes[1].id(), pieces[1].nodes[0].id());
        assert_eq!(pieces[0].nodes[2].id(), pieces[1].nodes[3].id());
        assert_eq!(pieces[1].nodes[1].id(), pieces[2].nodes[0].id());
        assert_eq!(pieces[1].nodes[2].id(), pieces[2].nodes[3].id());
    }

    #[test]
    fn a_notch_touching_the_start_generates_two_pieces() {
        let edges = [straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0])];
        let notch = EdgeNotch { starts_at: 0.0, ends_at: 0.5, surface_type: notch_type() };
        let pieces = extrude_path(&edges, 3.0, Some(&notch), 8, "wall-1", surface_type()).unwrap();
        assert_eq!(pieces.len(), 2);
        assert_eq!(pieces[0].surface.surface_type, notch_type());
        assert_eq!(pieces[1].surface.surface_type, surface_type());
    }

    #[test]
    fn a_notch_spanning_the_whole_edge_generates_one_piece() {
        let edges = [straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0])];
        let notch = EdgeNotch { starts_at: 0.0, ends_at: 1.0, surface_type: notch_type() };
        let pieces = extrude_path(&edges, 3.0, Some(&notch), 8, "wall-1", surface_type()).unwrap();
        assert_eq!(pieces.len(), 1);
        assert_eq!(pieces[0].surface.surface_type, notch_type());
    }

    #[test]
    fn a_notch_on_a_multi_edge_path_is_rejected() {
        let edges = [straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0]), straight([4.0, 0.0, 0.0], [4.0, 0.0, 4.0])];
        let notch = EdgeNotch { starts_at: 0.25, ends_at: 0.75, surface_type: notch_type() };
        let error = extrude_path(&edges, 3.0, Some(&notch), 8, "wall-1", surface_type()).unwrap_err();
        assert_eq!(error, ExtrusionError::NotchRequiresSingleStraightEdge);
    }

    #[test]
    fn an_inverted_or_out_of_range_notch_is_rejected() {
        let edges = [straight([0.0, 0.0, 0.0], [4.0, 0.0, 0.0])];
        let inverted = EdgeNotch { starts_at: 0.7, ends_at: 0.2, surface_type: notch_type() };
        assert_eq!(
            extrude_path(&edges, 3.0, Some(&inverted), 8, "wall-1", surface_type()).unwrap_err(),
            ExtrusionError::InvalidNotch { starts_at: 0.7, ends_at: 0.2 }
        );
    }
}
