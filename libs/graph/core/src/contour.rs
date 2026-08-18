//! Analytic contour topology: nodes stay semantic points, a [`ContourEdge`]
//! is an oriented curve (straight line or true circular arc) between two
//! nodes, and a [`SurfaceRegion`] is a set of oriented edge loops (outer
//! boundaries plus holes) rather than a bare node cycle.
//!
//! **Spatial policy (explicit, not silent):** every [`ContourGeometry::CircularArc`]
//! lives in the surface's own XZ plane, exactly like [`SurfaceCurvature`](crate::SurfaceCurvature)
//! already does -- `center` is an XZ point, radius is derived from the
//! distance to a resolved endpoint, and any height along the curve is a
//! caller-owned derived rule (e.g. interpolated from node Y), never a stored
//! 3D normal. This keeps every intersection, split, and closest-point query
//! 2D, and lets two neighboring regions share the exact same [`ContourEdge`]
//! without reconciling differing planes. A wall or tower that tapers (a
//! cone) is not a special case of this policy: its base and cap are simply
//! two independent `ContourEdge`s, each with its own `center`/radius, since
//! geometry now lives per edge instead of once per whole surface.
//!
//! This module is additive: it does not replace [`Surface`](crate::Surface)
//! or [`SurfaceRegistry`](crate::SurfaceRegistry). [`straight_cycle_region`]
//! is the migration bridge acceptance criterion -- an existing straight
//! node cycle maps onto a [`SurfaceRegion`] of `Line` edges with no visual
//! change. Consumers (procgen brush/extrusion crates, the WASM boundary, TS
//! ports) migrate to authoring [`SurfaceRegion`]s directly in follow-on work;
//! that migration is explicitly out of scope here.
//!
//! Position data itself stays out of this crate -- like `Surface`, geometry
//! here is resolved against caller-supplied endpoint positions, never an
//! opaque node payload `N` this crate cannot interpret.

use std::collections::HashMap;
use std::error::Error;
use std::fmt;

use crate::{Graph, NodeId};

/// Failure to construct a stable contour identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContourIdentifierError {
    /// A contour edge identifier must contain at least one character.
    EmptyContourEdgeId,
    /// A region identifier must contain at least one character.
    EmptyRegionId,
}

impl fmt::Display for ContourIdentifierError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyContourEdgeId => formatter.write_str("contour edge ID must not be empty"),
            Self::EmptyRegionId => formatter.write_str("region ID must not be empty"),
        }
    }
}

impl Error for ContourIdentifierError {}

/// Stable identity of a [`ContourEdge`], independent of which node pair it
/// currently spans.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ContourEdgeId(String);

impl ContourEdgeId {
    /// Creates a non-empty contour edge identifier.
    pub fn new(value: impl Into<String>) -> Result<Self, ContourIdentifierError> {
        let value = value.into();
        if value.is_empty() {
            return Err(ContourIdentifierError::EmptyContourEdgeId);
        }
        Ok(Self(value))
    }

    /// Returns the identifier text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ContourEdgeId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for ContourEdgeId {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

/// Stable identity of a [`SurfaceRegion`], independent of its node set --
/// the replacement for [`SurfaceKey`](crate::SurfaceKey)'s node-set identity,
/// which cannot distinguish two regions sharing nodes but differing edges.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RegionId(String);

impl RegionId {
    /// Creates a non-empty region identifier.
    pub fn new(value: impl Into<String>) -> Result<Self, ContourIdentifierError> {
        let value = value.into();
        if value.is_empty() {
            return Err(ContourIdentifierError::EmptyRegionId);
        }
        Ok(Self(value))
    }

    /// Returns the identifier text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for RegionId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for RegionId {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

/// A point in a surface's own XZ plane -- see this module's own doc for why
/// contour geometry commits to XZ instead of an arbitrary 3D plane.
pub type ContourPoint = [f32; 2];

/// An edge's explicit geometry between its two declared nodes.
///
/// Deliberately closed to exactly these two kinds for now (line and true
/// circular arc) -- Bezier and other curve families are a future extension,
/// not implemented here; see this module's own doc for scope.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ContourGeometry {
    /// A straight chord between the edge's two endpoints.
    Line,
    /// A true circular arc between the edge's two endpoints, in the XZ
    /// plane. `center` plus either endpoint determines the radius; whether
    /// the arc sweeps clockwise or counter-clockwise from the edge's own
    /// start to its own end is the one bit no arrangement of points alone
    /// can supply.
    CircularArc {
        /// The arc's center, in the same XZ plane as its endpoints.
        center: ContourPoint,
        /// Sweep direction from this edge's own start to its own end.
        clockwise: bool,
    },
}

/// An edge's 2D axis-aligned bounding box, in the XZ plane.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ContourBounds {
    /// Minimum X and Z.
    pub min: ContourPoint,
    /// Maximum X and Z.
    pub max: ContourPoint,
}

fn lerp(a: ContourPoint, b: ContourPoint, t: f32) -> ContourPoint {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

fn distance(a: ContourPoint, b: ContourPoint) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

fn angle_of(center: ContourPoint, point: ContourPoint) -> f32 {
    (point[1] - center[1]).atan2(point[0] - center[0])
}

/// Normalizes an angular sweep from `from` to `to` (radians) so it always
/// runs in the requested direction and lands in `[0, tau)`.
fn sweep(from: f32, to: f32, clockwise: bool) -> f32 {
    let tau = std::f32::consts::TAU;
    let mut delta = if clockwise { from - to } else { to - from };
    delta = delta.rem_euclid(tau);
    delta
}

/// An oriented curve between two graph nodes, with explicit geometry.
///
/// Position data is resolved by the caller (mirroring [`Surface`](crate::Surface)'s
/// own separation between topology and geometry) -- every method that needs
/// an endpoint's actual location takes it as a parameter rather than storing
/// it, since this crate does not interpret the opaque node payload `N`.
#[derive(Debug, Clone, PartialEq)]
pub struct ContourEdge {
    id: ContourEdgeId,
    start_node: NodeId,
    end_node: NodeId,
    geometry: ContourGeometry,
}

impl ContourEdge {
    /// Creates a contour edge between two nodes with explicit geometry.
    pub fn new(
        id: ContourEdgeId,
        start_node: NodeId,
        end_node: NodeId,
        geometry: ContourGeometry,
    ) -> Self {
        Self {
            id,
            start_node,
            end_node,
            geometry,
        }
    }

    /// This edge's stable identity.
    pub fn id(&self) -> &ContourEdgeId {
        &self.id
    }

    /// The node this edge starts from, in its own declared direction.
    pub fn start_node(&self) -> &NodeId {
        &self.start_node
    }

    /// The node this edge ends at, in its own declared direction.
    pub fn end_node(&self) -> &NodeId {
        &self.end_node
    }

    /// This edge's geometry.
    pub fn geometry(&self) -> &ContourGeometry {
        &self.geometry
    }

    /// This edge's geometry as seen when traversed in the opposite
    /// direction (end to start) -- the same physical curve, re-parameterized.
    /// Never mutates the edge; a loop that needs to walk this edge backward
    /// uses this alongside swapped endpoint positions.
    pub fn reversed_geometry(&self) -> ContourGeometry {
        match self.geometry {
            ContourGeometry::Line => ContourGeometry::Line,
            ContourGeometry::CircularArc { center, clockwise } => ContourGeometry::CircularArc {
                center,
                clockwise: !clockwise,
            },
        }
    }

    /// Position at parameter `t` in `0.0..=1.0`, walking from `from` to `to`
    /// (the caller's resolved positions for this edge's two endpoints, in
    /// the direction being evaluated).
    pub fn evaluate(&self, from: ContourPoint, to: ContourPoint, t: f32) -> ContourPoint {
        match self.geometry {
            ContourGeometry::Line => lerp(from, to, t),
            ContourGeometry::CircularArc { center, clockwise } => {
                let radius = distance(center, from);
                let start_angle = angle_of(center, from);
                let end_angle = angle_of(center, to);
                let total = sweep(start_angle, end_angle, clockwise).max(f32::EPSILON);
                let signed = if clockwise { -total } else { total };
                let angle = start_angle + signed * t;
                [
                    center[0] + radius * angle.cos(),
                    center[1] + radius * angle.sin(),
                ]
            }
        }
    }

    /// Unit tangent direction at parameter `t`, walking from `from` to `to`.
    pub fn tangent(&self, from: ContourPoint, to: ContourPoint, t: f32) -> ContourPoint {
        match self.geometry {
            ContourGeometry::Line => {
                let dx = to[0] - from[0];
                let dz = to[1] - from[1];
                let len = (dx * dx + dz * dz).sqrt().max(f32::EPSILON);
                [dx / len, dz / len]
            }
            ContourGeometry::CircularArc { center, clockwise } => {
                let point = self.evaluate(from, to, t);
                let radial = [point[0] - center[0], point[1] - center[1]];
                // Perpendicular to the radius, oriented by sweep direction.
                if clockwise {
                    [radial[1], -radial[0]]
                } else {
                    [-radial[1], radial[0]]
                }
            }
        }
    }

    /// Arc length (or straight length) between `from` and `to`.
    pub fn length(&self, from: ContourPoint, to: ContourPoint) -> f32 {
        match self.geometry {
            ContourGeometry::Line => distance(from, to),
            ContourGeometry::CircularArc { center, clockwise } => {
                let radius = distance(center, from);
                let start_angle = angle_of(center, from);
                let end_angle = angle_of(center, to);
                radius * sweep(start_angle, end_angle, clockwise)
            }
        }
    }

    /// Axis-aligned bounding box between `from` and `to`.
    pub fn bounds(&self, from: ContourPoint, to: ContourPoint) -> ContourBounds {
        match self.geometry {
            ContourGeometry::Line => ContourBounds {
                min: [from[0].min(to[0]), from[1].min(to[1])],
                max: [from[0].max(to[0]), from[1].max(to[1])],
            },
            ContourGeometry::CircularArc { center, clockwise } => {
                let radius = distance(center, from);
                let mut min = [from[0].min(to[0]), from[1].min(to[1])];
                let mut max = [from[0].max(to[0]), from[1].max(to[1])];
                let start_angle = angle_of(center, from);
                let total = sweep(start_angle, angle_of(center, to), clockwise);
                // Cardinal directions (0, pi/2, pi, 3pi/2) can extend the
                // straight-chord box whenever the arc actually sweeps past them.
                for cardinal in [
                    0.0_f32,
                    std::f32::consts::FRAC_PI_2,
                    std::f32::consts::PI,
                    3.0 * std::f32::consts::FRAC_PI_2,
                ] {
                    let swept = sweep(start_angle, cardinal, clockwise);
                    if swept <= total {
                        let point = [
                            center[0] + radius * cardinal.cos(),
                            center[1] + radius * cardinal.sin(),
                        ];
                        min = [min[0].min(point[0]), min[1].min(point[1])];
                        max = [max[0].max(point[0]), max[1].max(point[1])];
                    }
                }
                ContourBounds { min, max }
            }
        }
    }

    /// The parameter `t` and position on this edge closest to `point`.
    pub fn closest_point(
        &self,
        from: ContourPoint,
        to: ContourPoint,
        point: ContourPoint,
    ) -> (f32, ContourPoint) {
        match self.geometry {
            ContourGeometry::Line => {
                let dx = to[0] - from[0];
                let dz = to[1] - from[1];
                let len_sq = (dx * dx + dz * dz).max(f32::EPSILON);
                let t = (((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / len_sq)
                    .clamp(0.0, 1.0);
                (t, lerp(from, to, t))
            }
            ContourGeometry::CircularArc { center, clockwise } => {
                let target_angle = angle_of(center, point);
                let start_angle = angle_of(center, from);
                let total = sweep(start_angle, angle_of(center, to), clockwise).max(f32::EPSILON);
                let mut swept = sweep(start_angle, target_angle, clockwise);
                let t = if swept <= total {
                    swept /= total;
                    swept.clamp(0.0, 1.0)
                } else if swept - total < std::f32::consts::TAU - swept {
                    1.0
                } else {
                    0.0
                };
                (t, self.evaluate(from, to, t))
            }
        }
    }

    /// Splits this edge at `at` (assumed to lie on the curve) into two edges
    /// sharing a new node, preserving this edge's geometry description on
    /// both fragments -- a line stays a line, an arc keeps the same center
    /// and sweep direction (only its span shrinks).
    pub fn split(
        &self,
        new_node: NodeId,
        first_id: ContourEdgeId,
        second_id: ContourEdgeId,
    ) -> (ContourEdge, ContourEdge) {
        let first = ContourEdge::new(
            first_id,
            self.start_node.clone(),
            new_node.clone(),
            self.geometry,
        );
        let second = ContourEdge::new(second_id, new_node, self.end_node.clone(), self.geometry);
        (first, second)
    }

    /// A polyline approximation of this edge, suitable only for rendering --
    /// the graph's own topology never stores this. `tolerance` bounds the
    /// maximum deviation (in world units) between the true curve and the
    /// returned chord segments.
    pub fn tessellate(
        &self,
        from: ContourPoint,
        to: ContourPoint,
        tolerance: f32,
    ) -> Vec<ContourPoint> {
        match self.geometry {
            ContourGeometry::Line => vec![from, to],
            ContourGeometry::CircularArc { center, .. } => {
                let radius = distance(center, from).max(f32::EPSILON);
                let tolerance = tolerance.max(f32::EPSILON).min(radius);
                // Max angular step such that the chord's sagitta stays under tolerance.
                let max_step = 2.0 * (1.0 - tolerance / radius).clamp(-1.0, 1.0).acos();
                let total = self.length(from, to) / radius;
                let steps = (total / max_step.max(f32::EPSILON)).ceil().max(1.0) as usize;
                (0..=steps)
                    .map(|i| self.evaluate(from, to, i as f32 / steps as f32))
                    .collect()
            }
        }
    }

    /// Analytic intersection points between this edge and `other`, given
    /// both edges' resolved endpoint positions. Supports line-line,
    /// line-arc, and arc-arc pairs; returns points that lie within both
    /// edges' actual spans, not their full underlying line/circle.
    pub fn intersections(
        &self,
        from: ContourPoint,
        to: ContourPoint,
        other: &ContourEdge,
        other_from: ContourPoint,
        other_to: ContourPoint,
    ) -> Vec<ContourPoint> {
        match (self.geometry, other.geometry) {
            (ContourGeometry::Line, ContourGeometry::Line) => {
                line_line_intersection(from, to, other_from, other_to)
                    .into_iter()
                    .collect()
            }
            (ContourGeometry::Line, ContourGeometry::CircularArc { center, .. }) => {
                line_circle_intersections(from, to, center, distance(center, other_from))
                    .into_iter()
                    .filter(|point| other.on_span(other_from, other_to, *point))
                    .collect()
            }
            (ContourGeometry::CircularArc { center, .. }, ContourGeometry::Line) => {
                line_circle_intersections(other_from, other_to, center, distance(center, from))
                    .into_iter()
                    .filter(|point| self.on_span(from, to, *point))
                    .collect()
            }
            (
                ContourGeometry::CircularArc { center: c1, .. },
                ContourGeometry::CircularArc { center: c2, .. },
            ) => circle_circle_intersections(c1, distance(c1, from), c2, distance(c2, other_from))
                .into_iter()
                .filter(|point| {
                    self.on_span(from, to, *point) && other.on_span(other_from, other_to, *point)
                })
                .collect(),
        }
    }

    /// Whether `point` (assumed to already lie on this edge's underlying
    /// infinite line or full circle) falls within this edge's actual span
    /// between `from` and `to`.
    fn on_span(&self, from: ContourPoint, to: ContourPoint, point: ContourPoint) -> bool {
        const EPSILON: f32 = 1e-3;
        match self.geometry {
            ContourGeometry::Line => {
                let dx = to[0] - from[0];
                let dz = to[1] - from[1];
                let len_sq = (dx * dx + dz * dz).max(f32::EPSILON);
                let t = ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / len_sq;
                (-EPSILON..=1.0 + EPSILON).contains(&t)
            }
            ContourGeometry::CircularArc { center, clockwise } => {
                let start_angle = angle_of(center, from);
                let total = sweep(start_angle, angle_of(center, to), clockwise);
                let swept = sweep(start_angle, angle_of(center, point), clockwise);
                swept <= total + EPSILON
            }
        }
    }
}

fn line_line_intersection(
    a1: ContourPoint,
    a2: ContourPoint,
    b1: ContourPoint,
    b2: ContourPoint,
) -> Option<ContourPoint> {
    let d1 = [a2[0] - a1[0], a2[1] - a1[1]];
    let d2 = [b2[0] - b1[0], b2[1] - b1[1]];
    let denom = d1[0] * d2[1] - d1[1] * d2[0];
    if denom.abs() < f32::EPSILON {
        return None;
    }
    let diff = [b1[0] - a1[0], b1[1] - a1[1]];
    let t = (diff[0] * d2[1] - diff[1] * d2[0]) / denom;
    let u = (diff[0] * d1[1] - diff[1] * d1[0]) / denom;
    if (-1e-3..=1.0 + 1e-3).contains(&t) && (-1e-3..=1.0 + 1e-3).contains(&u) {
        Some(lerp(a1, a2, t))
    } else {
        None
    }
}

fn line_circle_intersections(
    from: ContourPoint,
    to: ContourPoint,
    center: ContourPoint,
    radius: f32,
) -> Vec<ContourPoint> {
    let dx = to[0] - from[0];
    let dz = to[1] - from[1];
    let fx = from[0] - center[0];
    let fz = from[1] - center[1];
    let a = dx * dx + dz * dz;
    if a < f32::EPSILON {
        return Vec::new();
    }
    let b = 2.0 * (fx * dx + fz * dz);
    let c = fx * fx + fz * fz - radius * radius;
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < 0.0 {
        return Vec::new();
    }
    let sqrt_disc = discriminant.sqrt();
    let mut points = Vec::new();
    for t in [(-b - sqrt_disc) / (2.0 * a), (-b + sqrt_disc) / (2.0 * a)] {
        if (-1e-3..=1.0 + 1e-3).contains(&t) {
            points.push(lerp(from, to, t));
        }
    }
    points
}

fn circle_circle_intersections(
    c1: ContourPoint,
    r1: f32,
    c2: ContourPoint,
    r2: f32,
) -> Vec<ContourPoint> {
    let dx = c2[0] - c1[0];
    let dz = c2[1] - c1[1];
    let d = (dx * dx + dz * dz).sqrt();
    if d < f32::EPSILON || d > r1 + r2 || d < (r1 - r2).abs() {
        return Vec::new();
    }
    let a = (r1 * r1 - r2 * r2 + d * d) / (2.0 * d);
    let h_sq = r1 * r1 - a * a;
    if h_sq < 0.0 {
        return Vec::new();
    }
    let h = h_sq.sqrt();
    let mid = [c1[0] + a * dx / d, c1[1] + a * dz / d];
    if h < f32::EPSILON {
        return vec![mid];
    }
    vec![
        [mid[0] + h * dz / d, mid[1] - h * dx / d],
        [mid[0] - h * dz / d, mid[1] + h * dx / d],
    ]
}

/// A single edge-use inside a [`SurfaceRegion`] loop: which [`ContourEdge`]
/// and whether it is walked in its own declared direction or reversed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrientedEdgeUse {
    edge: ContourEdgeId,
    reversed: bool,
}

impl OrientedEdgeUse {
    /// References `edge`, walked in its own declared direction.
    pub fn forward(edge: ContourEdgeId) -> Self {
        Self {
            edge,
            reversed: false,
        }
    }

    /// References `edge`, walked from its declared end to its declared start.
    pub fn reversed(edge: ContourEdgeId) -> Self {
        Self {
            edge,
            reversed: true,
        }
    }

    /// The referenced edge's identity.
    pub fn edge(&self) -> &ContourEdgeId {
        &self.edge
    }

    /// Whether this use walks the edge backward relative to its own
    /// declared direction.
    pub fn is_reversed(&self) -> bool {
        self.reversed
    }
}

/// An ordered, closed sequence of oriented edge uses -- one boundary of a
/// [`SurfaceRegion`] (an outer loop or a hole).
pub type ContourLoop = Vec<OrientedEdgeUse>;

/// A region bounded by one or more outer loops and zero or more holes, all
/// referencing shared [`ContourEdge`]s rather than restating geometry.
///
/// A region's stable identity is its own [`RegionId`], never derived from
/// its node set -- see this module's own doc.
#[derive(Debug, Clone, PartialEq)]
pub struct SurfaceRegion {
    id: RegionId,
    outer_loops: Vec<ContourLoop>,
    holes: Vec<ContourLoop>,
}

impl SurfaceRegion {
    /// This region's stable identity.
    pub fn id(&self) -> &RegionId {
        &self.id
    }

    /// This region's outer boundary loops.
    pub fn outer_loops(&self) -> &[ContourLoop] {
        &self.outer_loops
    }

    /// This region's holes.
    pub fn holes(&self) -> &[ContourLoop] {
        &self.holes
    }
}

/// Structural error from contour edge or region registration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContourError {
    /// A region must declare at least one outer loop.
    NoOuterLoop,
    /// A loop must reference at least one edge.
    EmptyLoop,
    /// A loop referenced an edge that is not registered.
    UnknownEdge {
        /// Identity that could not be resolved.
        id: ContourEdgeId,
    },
    /// A loop is not closed: one edge use's end node does not match the
    /// next use's start node.
    OpenLoop {
        /// Node the previous edge use ended at.
        expected: NodeId,
        /// Node the next edge use actually starts at.
        found: NodeId,
    },
    /// An edge referenced a node the graph does not have.
    UnknownNode {
        /// Identity that could not be resolved.
        id: NodeId,
    },
    /// Two edges cannot share the exact same identity.
    DuplicateEdge {
        /// Identity that already had a registered edge.
        id: ContourEdgeId,
    },
    /// A query or update referenced an edge that is not registered.
    UnknownEdgeIdentity {
        /// Identity that could not be resolved.
        id: ContourEdgeId,
    },
    /// Two regions cannot share the exact same identity.
    DuplicateRegion {
        /// Identity that already had a registered region.
        id: RegionId,
    },
    /// A query or update referenced a region that is not registered.
    UnknownRegion {
        /// Identity that could not be resolved.
        id: RegionId,
    },
    /// An edge would be used more than twice across all registered regions,
    /// or twice in the same direction -- see this module's own doc: a
    /// shared boundary uses the same edge in opposite directions, at most
    /// once each.
    NonManifoldEdge {
        /// The edge whose usage would become invalid.
        id: ContourEdgeId,
    },
}

impl fmt::Display for ContourError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoOuterLoop => {
                formatter.write_str("a region must declare at least one outer loop")
            }
            Self::EmptyLoop => formatter.write_str("a loop must reference at least one edge"),
            Self::UnknownEdge { id } => write!(formatter, "loop references unknown edge {id}"),
            Self::OpenLoop { expected, found } => write!(
                formatter,
                "loop is not closed: expected next edge to start at {expected}, found {found}"
            ),
            Self::UnknownNode { id } => write!(formatter, "edge references unknown node {id}"),
            Self::DuplicateEdge { id } => {
                write!(formatter, "an edge already exists with identity {id}")
            }
            Self::UnknownEdgeIdentity { id } => write!(formatter, "unknown edge identity {id}"),
            Self::DuplicateRegion { id } => {
                write!(formatter, "a region already exists with identity {id}")
            }
            Self::UnknownRegion { id } => write!(formatter, "unknown region identity {id}"),
            Self::NonManifoldEdge { id } => write!(
                formatter,
                "edge {id} would be used more than twice, or twice in the same direction"
            ),
        }
    }
}

impl Error for ContourError {}

#[derive(Debug, Clone, PartialEq, Eq)]
struct EdgeUsage {
    region: RegionId,
    reversed: bool,
}

/// Tracks every registered [`ContourEdge`] and [`SurfaceRegion`], enforcing
/// loop closure and the non-manifold-edge rule at registration time -- see
/// [`ContourError::NonManifoldEdge`]. A region under active construction (a
/// brush stroke mid-edit) is expected to stay unregistered, off-graph, until
/// normalized; only a manifold result is ever submitted here.
#[derive(Debug, Default, Clone)]
pub struct ContourTopology {
    edges: HashMap<ContourEdgeId, ContourEdge>,
    usages: HashMap<ContourEdgeId, Vec<EdgeUsage>>,
    regions: HashMap<RegionId, SurfaceRegion>,
}

impl ContourTopology {
    /// Creates an empty topology.
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a new contour edge, validated against `graph`.
    pub fn add_edge<N, E>(
        &mut self,
        graph: &Graph<N, E>,
        edge: ContourEdge,
    ) -> Result<ContourEdgeId, ContourError> {
        if graph.node(&edge.start_node).is_none() {
            return Err(ContourError::UnknownNode {
                id: edge.start_node.clone(),
            });
        }
        if graph.node(&edge.end_node).is_none() {
            return Err(ContourError::UnknownNode {
                id: edge.end_node.clone(),
            });
        }
        if self.edges.contains_key(&edge.id) {
            return Err(ContourError::DuplicateEdge {
                id: edge.id.clone(),
            });
        }
        let id = edge.id.clone();
        self.edges.insert(id.clone(), edge);
        Ok(id)
    }

    /// Looks up a registered edge by identity.
    pub fn edge(&self, id: &ContourEdgeId) -> Option<&ContourEdge> {
        self.edges.get(id)
    }

    /// Registers a new region from its outer loops and holes, validating
    /// loop closure and the non-manifold-edge rule against edges already
    /// registered via [`add_edge`](Self::add_edge). Rejects and leaves no
    /// partial state on any failure.
    pub fn add_region(
        &mut self,
        id: RegionId,
        outer_loops: Vec<ContourLoop>,
        holes: Vec<ContourLoop>,
    ) -> Result<RegionId, ContourError> {
        if self.regions.contains_key(&id) {
            return Err(ContourError::DuplicateRegion { id });
        }
        if outer_loops.is_empty() {
            return Err(ContourError::NoOuterLoop);
        }

        let mut pending_usages: Vec<(ContourEdgeId, EdgeUsage)> = Vec::new();
        for loop_ in outer_loops.iter().chain(holes.iter()) {
            self.validate_loop(loop_, &id, &mut pending_usages)?;
        }

        for (edge_id, usage) in &pending_usages {
            self.usages
                .entry(edge_id.clone())
                .or_default()
                .push(usage.clone());
        }
        self.regions.insert(
            id.clone(),
            SurfaceRegion {
                id: id.clone(),
                outer_loops,
                holes,
            },
        );
        Ok(id)
    }

    fn validate_loop(
        &self,
        loop_: &ContourLoop,
        region: &RegionId,
        pending_usages: &mut Vec<(ContourEdgeId, EdgeUsage)>,
    ) -> Result<(), ContourError> {
        if loop_.is_empty() {
            return Err(ContourError::EmptyLoop);
        }
        for use_ in loop_ {
            let edge = self
                .edges
                .get(&use_.edge)
                .ok_or_else(|| ContourError::UnknownEdge {
                    id: use_.edge.clone(),
                })?;
            let (start, end) = if use_.reversed {
                (edge.end_node.clone(), edge.start_node.clone())
            } else {
                (edge.start_node.clone(), edge.end_node.clone())
            };
            self.check_manifold(&use_.edge, use_.reversed, pending_usages)?;
            pending_usages.push((
                use_.edge.clone(),
                EdgeUsage {
                    region: region.clone(),
                    reversed: use_.reversed,
                },
            ));
            let _ = (start, end);
        }
        for window in loop_.windows(2) {
            let current_end = self.use_end_node(&window[0]);
            let next_start = self.use_start_node(&window[1]);
            if current_end != next_start {
                return Err(ContourError::OpenLoop {
                    expected: current_end,
                    found: next_start,
                });
            }
        }
        let last_end = self.use_end_node(&loop_[loop_.len() - 1]);
        let first_start = self.use_start_node(&loop_[0]);
        if last_end != first_start {
            return Err(ContourError::OpenLoop {
                expected: last_end,
                found: first_start,
            });
        }
        Ok(())
    }

    fn check_manifold(
        &self,
        edge_id: &ContourEdgeId,
        reversed: bool,
        pending_usages: &[(ContourEdgeId, EdgeUsage)],
    ) -> Result<(), ContourError> {
        let existing = self.usages.get(edge_id).map(|v| v.len()).unwrap_or(0)
            + pending_usages
                .iter()
                .filter(|(id, _)| id == edge_id)
                .count();
        if existing >= 2 {
            return Err(ContourError::NonManifoldEdge {
                id: edge_id.clone(),
            });
        }
        if existing == 1 {
            let same_direction = self
                .usages
                .get(edge_id)
                .into_iter()
                .flatten()
                .chain(
                    pending_usages
                        .iter()
                        .filter(|(id, _)| id == edge_id)
                        .map(|(_, usage)| usage),
                )
                .any(|usage| usage.reversed == reversed);
            if same_direction {
                return Err(ContourError::NonManifoldEdge {
                    id: edge_id.clone(),
                });
            }
        }
        Ok(())
    }

    fn use_start_node(&self, use_: &OrientedEdgeUse) -> NodeId {
        let edge = &self.edges[&use_.edge];
        if use_.reversed {
            edge.end_node.clone()
        } else {
            edge.start_node.clone()
        }
    }

    fn use_end_node(&self, use_: &OrientedEdgeUse) -> NodeId {
        let edge = &self.edges[&use_.edge];
        if use_.reversed {
            edge.start_node.clone()
        } else {
            edge.end_node.clone()
        }
    }

    /// Looks up a registered region by identity.
    pub fn region(&self, id: &RegionId) -> Option<&SurfaceRegion> {
        self.regions.get(id)
    }

    /// Removes a region, releasing its edge usages. Edges themselves stay
    /// registered (another region may still reference them).
    pub fn remove_region(&mut self, id: &RegionId) -> Result<SurfaceRegion, ContourError> {
        let region = self
            .regions
            .remove(id)
            .ok_or_else(|| ContourError::UnknownRegion { id: id.clone() })?;
        for loop_ in region.outer_loops.iter().chain(region.holes.iter()) {
            for use_ in loop_ {
                if let Some(usages) = self.usages.get_mut(&use_.edge) {
                    usages.retain(|usage| usage.region != *id);
                    if usages.is_empty() {
                        self.usages.remove(&use_.edge);
                    }
                }
            }
        }
        Ok(region)
    }
}

/// Builds a single-outer-loop, hole-free [`SurfaceRegion`] out of straight
/// [`ContourGeometry::Line`] edges from an existing node cycle -- the
/// migration bridge for a straight surface that used to be described only
/// as [`Surface::cycle`](crate::Surface::cycle). Produces edge ids of the
/// form `"{region_id}-{index}"`; callers that need stable, caller-chosen
/// edge ids should build the loop directly instead.
///
/// Registers the produced edges and region into `topology`, validated
/// against `graph` exactly as any other region would be.
pub fn straight_cycle_region<N, E>(
    topology: &mut ContourTopology,
    graph: &Graph<N, E>,
    id: RegionId,
    cycle: &[NodeId],
) -> Result<RegionId, ContourError> {
    if cycle.is_empty() {
        return Err(ContourError::EmptyLoop);
    }
    let mut loop_ = Vec::with_capacity(cycle.len());
    for (index, window_start) in cycle.iter().enumerate() {
        let window_end = &cycle[(index + 1) % cycle.len()];
        let edge_id = ContourEdgeId::new(format!("{id}-{index}"))
            .expect("region id plus numeric suffix is never empty");
        let edge = ContourEdge::new(
            edge_id.clone(),
            window_start.clone(),
            window_end.clone(),
            ContourGeometry::Line,
        );
        topology.add_edge(graph, edge)?;
        loop_.push(OrientedEdgeUse::forward(edge_id));
    }
    topology.add_region(id, vec![loop_], Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Edge, EdgeId, Node};

    fn node(id: &str) -> Node<ContourPoint> {
        Node::new(NodeId::new(id).unwrap(), [0.0, 0.0])
    }

    fn positioned_node(id: &str, position: ContourPoint) -> Node<ContourPoint> {
        Node::new(NodeId::new(id).unwrap(), position)
    }

    fn nid(name: &str) -> NodeId {
        NodeId::new(name).unwrap()
    }

    fn eid(name: &str) -> ContourEdgeId {
        ContourEdgeId::new(name).unwrap()
    }

    fn rid(name: &str) -> RegionId {
        RegionId::new(name).unwrap()
    }

    fn square_graph() -> Graph<ContourPoint, ()> {
        Graph::try_from_parts(
            vec![
                positioned_node("a", [0.0, 0.0]),
                positioned_node("b", [1.0, 0.0]),
                positioned_node("c", [1.0, 1.0]),
                positioned_node("d", [0.0, 1.0]),
            ],
            vec![],
        )
        .unwrap()
    }

    #[test]
    fn straight_cycle_migrates_to_line_edges_without_visual_change() {
        let graph = square_graph();
        let mut topology = ContourTopology::new();
        let cycle = vec![nid("a"), nid("b"), nid("c"), nid("d")];

        let region_id = straight_cycle_region(&mut topology, &graph, rid("floor"), &cycle).unwrap();
        let region = topology.region(&region_id).unwrap();
        assert_eq!(region.outer_loops().len(), 1);
        assert_eq!(region.outer_loops()[0].len(), 4);
        assert!(region.holes().is_empty());

        for use_ in &region.outer_loops()[0] {
            let edge = topology.edge(use_.edge()).unwrap();
            assert_eq!(edge.geometry(), &ContourGeometry::Line);
        }

        // Evaluating each edge at its own endpoints reproduces exactly the
        // original polygon corners -- no visual change from the old cycle.
        let positions = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        for (index, use_) in region.outer_loops()[0].iter().enumerate() {
            let edge = topology.edge(use_.edge()).unwrap();
            let start = positions[index];
            let end = positions[(index + 1) % 4];
            assert_eq!(edge.evaluate(start, end, 0.0), start);
            assert_eq!(edge.evaluate(start, end, 1.0), end);
        }
    }

    #[test]
    fn shared_arc_edge_used_by_two_regions_in_opposite_directions_is_valid() {
        let graph = square_graph();
        let mut topology = ContourTopology::new();
        let shared = ContourEdge::new(
            eid("shared"),
            nid("a"),
            nid("b"),
            ContourGeometry::CircularArc {
                center: [0.5, -0.5],
                clockwise: false,
            },
        );
        topology.add_edge(&graph, shared).unwrap();

        // Region A: a → b (forward) then back through two synthetic straight edges.
        topology
            .add_edge(
                &graph,
                ContourEdge::new(eid("b-c"), nid("b"), nid("c"), ContourGeometry::Line),
            )
            .unwrap();
        topology
            .add_edge(
                &graph,
                ContourEdge::new(eid("c-a"), nid("c"), nid("a"), ContourGeometry::Line),
            )
            .unwrap();
        topology
            .add_region(
                rid("region-a"),
                vec![vec![
                    OrientedEdgeUse::forward(eid("shared")),
                    OrientedEdgeUse::forward(eid("b-c")),
                    OrientedEdgeUse::forward(eid("c-a")),
                ]],
                Vec::new(),
            )
            .unwrap();

        // Region B: b → a (reversed) then back through one synthetic straight edge.
        topology
            .add_edge(
                &graph,
                ContourEdge::new(eid("a-d"), nid("a"), nid("d"), ContourGeometry::Line),
            )
            .unwrap();
        topology
            .add_edge(
                &graph,
                ContourEdge::new(eid("d-b"), nid("d"), nid("b"), ContourGeometry::Line),
            )
            .unwrap();
        let result = topology.add_region(
            rid("region-b"),
            vec![vec![
                OrientedEdgeUse::reversed(eid("shared")),
                OrientedEdgeUse::forward(eid("a-d")),
                OrientedEdgeUse::forward(eid("d-b")),
            ]],
            Vec::new(),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn reusing_shared_edge_in_same_direction_is_non_manifold() {
        let graph = square_graph();
        let mut topology = ContourTopology::new();
        topology
            .add_edge(
                &graph,
                ContourEdge::new(eid("shared"), nid("a"), nid("b"), ContourGeometry::Line),
            )
            .unwrap();
        topology
            .add_edge(
                &graph,
                ContourEdge::new(eid("b-a"), nid("b"), nid("a"), ContourGeometry::Line),
            )
            .unwrap();
        topology
            .add_region(
                rid("region-a"),
                vec![vec![
                    OrientedEdgeUse::forward(eid("shared")),
                    OrientedEdgeUse::forward(eid("b-a")),
                ]],
                Vec::new(),
            )
            .unwrap();

        let result = topology.add_region(
            rid("region-b"),
            vec![vec![
                OrientedEdgeUse::forward(eid("shared")),
                OrientedEdgeUse::forward(eid("b-a")),
            ]],
            Vec::new(),
        );
        assert_eq!(
            result.unwrap_err(),
            ContourError::NonManifoldEdge { id: eid("shared") }
        );
    }

    #[test]
    fn a_third_usage_of_an_edge_is_rejected() {
        let graph = square_graph();
        let mut topology = ContourTopology::new();
        topology
            .add_edge(
                &graph,
                ContourEdge::new(eid("shared"), nid("a"), nid("b"), ContourGeometry::Line),
            )
            .unwrap();
        topology
            .add_edge(
                &graph,
                ContourEdge::new(eid("b-a-1"), nid("b"), nid("a"), ContourGeometry::Line),
            )
            .unwrap();
        topology
            .add_edge(
                &graph,
                ContourEdge::new(eid("a-b-2"), nid("a"), nid("b"), ContourGeometry::Line),
            )
            .unwrap();
        topology
            .add_region(
                rid("region-a"),
                vec![vec![
                    OrientedEdgeUse::forward(eid("shared")),
                    OrientedEdgeUse::forward(eid("b-a-1")),
                ]],
                Vec::new(),
            )
            .unwrap();
        topology
            .add_region(
                rid("region-b"),
                vec![vec![
                    OrientedEdgeUse::reversed(eid("shared")),
                    OrientedEdgeUse::forward(eid("a-b-2")),
                ]],
                Vec::new(),
            )
            .unwrap();

        let result = topology.add_region(
            rid("region-c"),
            vec![vec![
                OrientedEdgeUse::forward(eid("shared")),
                OrientedEdgeUse::forward(eid("b-a-1")),
            ]],
            Vec::new(),
        );
        assert_eq!(
            result.unwrap_err(),
            ContourError::NonManifoldEdge { id: eid("shared") }
        );
    }

    #[test]
    fn open_loop_is_rejected() {
        let graph = square_graph();
        let mut topology = ContourTopology::new();
        topology
            .add_edge(
                &graph,
                ContourEdge::new(eid("a-b"), nid("a"), nid("b"), ContourGeometry::Line),
            )
            .unwrap();
        topology
            .add_edge(
                &graph,
                ContourEdge::new(eid("c-d"), nid("c"), nid("d"), ContourGeometry::Line),
            )
            .unwrap();

        let result = topology.add_region(
            rid("region-a"),
            vec![vec![
                OrientedEdgeUse::forward(eid("a-b")),
                OrientedEdgeUse::forward(eid("c-d")),
            ]],
            Vec::new(),
        );
        assert_eq!(
            result.unwrap_err(),
            ContourError::OpenLoop {
                expected: nid("b"),
                found: nid("c"),
            }
        );
    }

    #[test]
    fn removing_a_region_frees_its_shared_edge_for_reuse() {
        let graph = square_graph();
        let mut topology = ContourTopology::new();
        topology
            .add_edge(
                &graph,
                ContourEdge::new(eid("shared"), nid("a"), nid("b"), ContourGeometry::Line),
            )
            .unwrap();
        topology
            .add_edge(
                &graph,
                ContourEdge::new(eid("b-a"), nid("b"), nid("a"), ContourGeometry::Line),
            )
            .unwrap();
        let region = topology
            .add_region(
                rid("region-a"),
                vec![vec![
                    OrientedEdgeUse::forward(eid("shared")),
                    OrientedEdgeUse::forward(eid("b-a")),
                ]],
                Vec::new(),
            )
            .unwrap();

        topology.remove_region(&region).unwrap();
        let result = topology.add_region(
            rid("region-b"),
            vec![vec![
                OrientedEdgeUse::forward(eid("shared")),
                OrientedEdgeUse::forward(eid("b-a")),
            ]],
            Vec::new(),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn arc_split_preserves_center_and_direction_on_both_fragments() {
        let arc = ContourEdge::new(
            eid("arc"),
            nid("a"),
            nid("b"),
            ContourGeometry::CircularArc {
                center: [0.0, 0.0],
                clockwise: false,
            },
        );
        let (first, second) = arc.split(nid("mid"), eid("arc-1"), eid("arc-2"));
        assert_eq!(first.geometry(), arc.geometry());
        assert_eq!(second.geometry(), arc.geometry());
        assert_eq!(first.start_node(), &nid("a"));
        assert_eq!(first.end_node(), &nid("mid"));
        assert_eq!(second.start_node(), &nid("mid"));
        assert_eq!(second.end_node(), &nid("b"));
    }

    #[test]
    fn line_line_intersection_finds_crossing_within_both_spans() {
        let a = ContourEdge::new(eid("a"), nid("a1"), nid("a2"), ContourGeometry::Line);
        let b = ContourEdge::new(eid("b"), nid("b1"), nid("b2"), ContourGeometry::Line);
        let points = a.intersections([0.0, 0.0], [2.0, 2.0], &b, [0.0, 2.0], [2.0, 0.0]);
        assert_eq!(points.len(), 1);
        assert!((points[0][0] - 1.0).abs() < 1e-4);
        assert!((points[0][1] - 1.0).abs() < 1e-4);
    }

    #[test]
    fn line_line_intersection_outside_span_is_not_returned() {
        let a = ContourEdge::new(eid("a"), nid("a1"), nid("a2"), ContourGeometry::Line);
        let b = ContourEdge::new(eid("b"), nid("b1"), nid("b2"), ContourGeometry::Line);
        let points = a.intersections([0.0, 0.0], [1.0, 1.0], &b, [3.0, 0.0], [3.0, 2.0]);
        assert!(points.is_empty());
    }

    #[test]
    fn arc_tessellation_starts_and_ends_at_endpoints() {
        let arc = ContourEdge::new(
            eid("arc"),
            nid("a"),
            nid("b"),
            ContourGeometry::CircularArc {
                center: [0.0, 0.0],
                clockwise: false,
            },
        );
        let from = [1.0, 0.0];
        let to = [0.0, 1.0];
        let points = arc.tessellate(from, to, 0.01);
        assert!(points.len() >= 2);
        assert!((points[0][0] - from[0]).abs() < 1e-4);
        assert!((points[0][1] - from[1]).abs() < 1e-4);
        let last = *points.last().unwrap();
        assert!((last[0] - to[0]).abs() < 1e-4);
        assert!((last[1] - to[1]).abs() < 1e-4);
    }

    #[test]
    fn unknown_node_in_edge_is_rejected() {
        let graph = square_graph();
        let mut topology = ContourTopology::new();
        let result = topology.add_edge(
            &graph,
            ContourEdge::new(eid("bad"), nid("a"), nid("missing"), ContourGeometry::Line),
        );
        assert_eq!(
            result.unwrap_err(),
            ContourError::UnknownNode { id: nid("missing") }
        );
    }

    #[test]
    fn identifiers_reject_empty_values() {
        assert_eq!(
            ContourEdgeId::new("").unwrap_err(),
            ContourIdentifierError::EmptyContourEdgeId
        );
        assert_eq!(
            RegionId::new("").unwrap_err(),
            ContourIdentifierError::EmptyRegionId
        );
        let _ = node("unused");
        let _ = Edge::new(EdgeId::new("e").unwrap(), nid("a"), nid("b"), ());
    }
}
