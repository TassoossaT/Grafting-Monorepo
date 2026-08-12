//! Derives construction-surface node cycles for a wall, and for a wall
//! with a door opening cut into it.
//!
//! A wall segment is a flat, double-sided planar quad -- no modeled
//! thickness, matching `docs/architecture/vtt-roadmap.md`'s already-decided
//! `E1.4` fix direction for `vtt-brush`'s wall-mesh bug ("the fix is
//! dropping the box extrusion, not adding anything"); thickness is an
//! Asset-layer rendering concern, not modeled here.
//!
//! A `Surface`'s cycle is one simple closed loop -- it cannot represent a
//! ring with a hole punched in it (`grafting_graph_core::SurfaceKey`,
//! `construction::delete_node`'s cycle-repair algorithm both assume a
//! clean cycle). So a wall with a doorway is generated as up to 3 sibling
//! quad `Surface`s (left remainder, door, right remainder) sharing jamb
//! `NodeId`s at a fixed generation order, not one surface with a hole --
//! matching `ADR-0022`'s own worked `Merge` example ("a door's nodes and an
//! adjoining wall's nodes becoming one thing"). V1 scope: the opening spans
//! the wall's full height (no lintel piece above a shorter door); a
//! partial-height opening is a deliberate, documented follow-up.

use std::error::Error;
use std::fmt;

use grafting_graph_core::{Edge, EdgeId, Node, NodeId, SurfaceSpec, SurfaceType};

/// A wall's centerline and height. No thickness -- see the module doc.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WallSegment {
    /// One end of the centerline, at the wall's base.
    pub start: [f32; 3],
    /// The other end of the centerline, at the wall's base.
    pub end: [f32; 3],
    /// How far above the centerline's own base the wall's top sits.
    pub height: f32,
}

/// A door opening cut into a [`WallSegment`], as fractions along its
/// centerline. `opens_at` must be less than `closes_at`, both within
/// `[0, 1]`. V1: the opening spans the wall's full height -- no lintel
/// piece above it. A partial-height opening is a deliberate, documented
/// follow-up.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DoorOpening {
    /// Fraction along the centerline where the opening begins.
    pub opens_at: f32,
    /// Fraction along the centerline where the opening ends.
    pub closes_at: f32,
}

/// A generated wall node's role -- lets a caller supply stable identity per
/// role via `node_id`/`edge_id` in [`generate_wall`], and lets adjacent
/// pieces agree on a shared jamb node's identity without this crate
/// inventing one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WallNodeRole {
    /// The centerline's start, at the wall's base.
    StartBottom,
    /// The centerline's start, at the wall's top.
    StartTop,
    /// The centerline's end, at the wall's base.
    EndBottom,
    /// The centerline's end, at the wall's top.
    EndTop,
    /// The door opening's near jamb, at the wall's base.
    DoorStartBottom,
    /// The door opening's near jamb, at the wall's top.
    DoorStartTop,
    /// The door opening's far jamb, at the wall's base.
    DoorEndBottom,
    /// The door opening's far jamb, at the wall's top.
    DoorEndTop,
}

/// Why [`generate_wall`] could not derive a wall.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum StructureGenerationError {
    /// `door`'s fractions were outside `[0, 1]`, or `opens_at` was not
    /// strictly less than `closes_at`.
    InvalidDoorOpening {
        /// The opening's supplied start fraction.
        opens_at: f32,
        /// The opening's supplied end fraction.
        closes_at: f32,
    },
}

impl fmt::Display for StructureGenerationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDoorOpening { opens_at, closes_at } => write!(
                formatter,
                "door opening [{opens_at}, {closes_at}] must be within [0, 1] with opens_at < closes_at"
            ),
        }
    }
}

impl Error for StructureGenerationError {}

/// One generated piece of a wall (a whole wall, or one wall-remainder or
/// door segment of a wall with an opening): its own new nodes/edges, and
/// the [`SurfaceSpec`] they form. Nodes shared with a sibling piece (jamb
/// corners) are emitted by every piece whose cycle includes them, under
/// the same `NodeId` (via `node_id` returning the same id for the same
/// role) -- a caller applying more than one piece to a live graph is
/// responsible for not re-adding an id already present, the same
/// composition `grafting-procgen-terrain-generation`'s own interop tests
/// use for a shared seam node.
#[derive(Debug, Clone, PartialEq)]
pub struct StructurePiece {
    /// This piece's nodes, in cycle order.
    pub nodes: Vec<Node<[f32; 3]>>,
    /// This piece's ring edges, connecting `nodes` consecutively.
    pub edges: Vec<Edge<()>>,
    /// The surface `nodes` forms.
    pub surface: SurfaceSpec,
}

/// A wall's generated pieces: 1 (no door, or a door spanning the whole
/// wall), 2 (a door touching one end), or 3 (a door interior to the wall).
#[derive(Debug, Clone, PartialEq)]
pub struct WallGeneration {
    /// The generated pieces, in centerline order from `start` to `end`.
    pub pieces: Vec<StructurePiece>,
}

fn position_at(wall: &WallSegment, fraction: f32, top: bool) -> [f32; 3] {
    let mut position = [
        wall.start[0] + (wall.end[0] - wall.start[0]) * fraction,
        wall.start[1] + (wall.end[1] - wall.start[1]) * fraction,
        wall.start[2] + (wall.end[2] - wall.start[2]) * fraction,
    ];
    // Y is up (`docs/architecture/vtt-roadmap.md`'s floor-cutaway clip plane
    // is expressed as Y < Y_limit) -- height must land on a fixed axis
    // distinct from the centerline's own direction. Adding it to index 2
    // instead collapses top/bottom onto the centerline whenever a wall runs
    // along Z (as this app's default seed and "generate wall" trigger both
    // do), producing a self-overlapping quad no triangulator can fill.
    if top {
        position[1] += wall.height;
    }
    position
}

fn quad(
    roles: [WallNodeRole; 4],
    positions: [[f32; 3]; 4],
    surface_type: SurfaceType,
    node_id: &impl Fn(WallNodeRole) -> NodeId,
    edge_id: &impl Fn(WallNodeRole, WallNodeRole) -> EdgeId,
) -> StructurePiece {
    let mut nodes = Vec::with_capacity(4);
    let mut cycle = Vec::with_capacity(4);
    for (role, position) in roles.into_iter().zip(positions) {
        let id = node_id(role);
        cycle.push(id.clone());
        nodes.push(Node::new(id, position));
    }
    let mut edges = Vec::with_capacity(4);
    for index in 0..4 {
        let next = (index + 1) % 4;
        edges.push(Edge::new(
            edge_id(roles[index], roles[next]),
            cycle[index].clone(),
            cycle[next].clone(),
            (),
        ));
    }
    StructurePiece { nodes, edges, surface: SurfaceSpec { cycle, surface_type, physical: true } }
}

/// Derives a wall's construction-surface node cycle(s), splitting around a
/// door opening if `door` is given. `node_id`/`edge_id` let the caller
/// decide identity per [`WallNodeRole`] -- this crate never invents one,
/// matching `grafting_graph_core::construction::duplicate_surface`'s own
/// principle. Validates `door` (if any) before constructing anything, so a
/// rejected call leaves nothing behind.
pub fn generate_wall(
    wall: &WallSegment,
    door: Option<&DoorOpening>,
    node_id: impl Fn(WallNodeRole) -> NodeId,
    edge_id: impl Fn(WallNodeRole, WallNodeRole) -> EdgeId,
    wall_type: SurfaceType,
    door_type: SurfaceType,
) -> Result<WallGeneration, StructureGenerationError> {
    use WallNodeRole::{DoorEndBottom, DoorEndTop, DoorStartBottom, DoorStartTop, EndBottom, EndTop, StartBottom, StartTop};

    let Some(door) = door else {
        let pieces = vec![quad(
            [StartBottom, EndBottom, EndTop, StartTop],
            [position_at(wall, 0.0, false), position_at(wall, 1.0, false), position_at(wall, 1.0, true), position_at(wall, 0.0, true)],
            wall_type,
            &node_id,
            &edge_id,
        )];
        return Ok(WallGeneration { pieces });
    };

    if !(0.0..=1.0).contains(&door.opens_at) || !(0.0..=1.0).contains(&door.closes_at) || door.opens_at >= door.closes_at {
        return Err(StructureGenerationError::InvalidDoorOpening { opens_at: door.opens_at, closes_at: door.closes_at });
    }

    let start_bottom = position_at(wall, 0.0, false);
    let start_top = position_at(wall, 0.0, true);
    let end_bottom = position_at(wall, 1.0, false);
    let end_top = position_at(wall, 1.0, true);
    let door_start_bottom = position_at(wall, door.opens_at, false);
    let door_start_top = position_at(wall, door.opens_at, true);
    let door_end_bottom = position_at(wall, door.closes_at, false);
    let door_end_top = position_at(wall, door.closes_at, true);

    let opens_at_start = door.opens_at == 0.0;
    let closes_at_end = door.closes_at == 1.0;

    let pieces = match (opens_at_start, closes_at_end) {
        (true, true) => vec![quad(
            [StartBottom, EndBottom, EndTop, StartTop],
            [start_bottom, end_bottom, end_top, start_top],
            door_type,
            &node_id,
            &edge_id,
        )],
        (true, false) => vec![
            quad(
                [StartBottom, DoorEndBottom, DoorEndTop, StartTop],
                [start_bottom, door_end_bottom, door_end_top, start_top],
                door_type,
                &node_id,
                &edge_id,
            ),
            quad(
                [DoorEndBottom, EndBottom, EndTop, DoorEndTop],
                [door_end_bottom, end_bottom, end_top, door_end_top],
                wall_type,
                &node_id,
                &edge_id,
            ),
        ],
        (false, true) => vec![
            quad(
                [StartBottom, DoorStartBottom, DoorStartTop, StartTop],
                [start_bottom, door_start_bottom, door_start_top, start_top],
                wall_type,
                &node_id,
                &edge_id,
            ),
            quad(
                [DoorStartBottom, EndBottom, EndTop, DoorStartTop],
                [door_start_bottom, end_bottom, end_top, door_start_top],
                door_type,
                &node_id,
                &edge_id,
            ),
        ],
        (false, false) => vec![
            quad(
                [StartBottom, DoorStartBottom, DoorStartTop, StartTop],
                [start_bottom, door_start_bottom, door_start_top, start_top],
                wall_type.clone(),
                &node_id,
                &edge_id,
            ),
            quad(
                [DoorStartBottom, DoorEndBottom, DoorEndTop, DoorStartTop],
                [door_start_bottom, door_end_bottom, door_end_top, door_start_top],
                door_type,
                &node_id,
                &edge_id,
            ),
            quad(
                [DoorEndBottom, EndBottom, EndTop, DoorEndTop],
                [door_end_bottom, end_bottom, end_top, door_end_top],
                wall_type,
                &node_id,
                &edge_id,
            ),
        ],
    };

    Ok(WallGeneration { pieces })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wall() -> WallSegment {
        WallSegment { start: [0.0, 0.0, 0.0], end: [4.0, 0.0, 0.0], height: 3.0 }
    }

    fn node_id(role: WallNodeRole) -> NodeId {
        NodeId::new(format!("{role:?}")).unwrap()
    }

    fn edge_id(a: WallNodeRole, b: WallNodeRole) -> EdgeId {
        EdgeId::new(format!("{a:?}-{b:?}")).unwrap()
    }

    fn wall_type() -> SurfaceType {
        SurfaceType::new("wall")
    }

    fn door_type() -> SurfaceType {
        SurfaceType::new("door")
    }

    #[test]
    fn no_door_generates_one_piece() {
        let generation = generate_wall(&wall(), None, node_id, edge_id, wall_type(), door_type()).unwrap();
        assert_eq!(generation.pieces.len(), 1);
        let piece = &generation.pieces[0];
        assert_eq!(piece.nodes.len(), 4);
        assert_eq!(piece.edges.len(), 4);
        assert_eq!(piece.surface.surface_type, wall_type());
        assert_eq!(*piece.nodes[0].data(), [0.0, 0.0, 0.0]);
        assert_eq!(*piece.nodes[1].data(), [4.0, 0.0, 0.0]);
        assert_eq!(*piece.nodes[2].data(), [4.0, 3.0, 0.0]);
        assert_eq!(*piece.nodes[3].data(), [0.0, 3.0, 0.0]);
    }

    /// A wall running along Z (this app's own default seed and its
    /// "generate wall" edit-mode trigger both build walls this way) must
    /// not collapse its top edge back onto its own centerline -- height has
    /// to land on a different axis than the wall's length, regardless of
    /// which horizontal direction that length runs in.
    #[test]
    fn a_wall_running_along_z_keeps_top_and_bottom_on_distinct_axes() {
        let wall = WallSegment { start: [2.0, 0.0, 0.0], end: [2.0, 0.0, 4.0], height: 3.0 };
        let generation = generate_wall(&wall, None, node_id, edge_id, wall_type(), door_type()).unwrap();
        let piece = &generation.pieces[0];
        assert_eq!(*piece.nodes[0].data(), [2.0, 0.0, 0.0]);
        assert_eq!(*piece.nodes[1].data(), [2.0, 0.0, 4.0]);
        assert_eq!(*piece.nodes[2].data(), [2.0, 3.0, 4.0]);
        assert_eq!(*piece.nodes[3].data(), [2.0, 3.0, 0.0]);
    }

    #[test]
    fn interior_door_generates_three_pieces_sharing_jamb_identity() {
        let door = DoorOpening { opens_at: 0.25, closes_at: 0.75 };
        let generation = generate_wall(&wall(), Some(&door), node_id, edge_id, wall_type(), door_type()).unwrap();
        assert_eq!(generation.pieces.len(), 3);
        assert_eq!(generation.pieces[0].surface.surface_type, wall_type());
        assert_eq!(generation.pieces[1].surface.surface_type, door_type());
        assert_eq!(generation.pieces[2].surface.surface_type, wall_type());

        // The left piece's far jamb (slot 1, DoorStartBottom) must be the
        // identical NodeId as the door piece's near jamb (slot 0).
        assert_eq!(generation.pieces[0].nodes[1].id(), generation.pieces[1].nodes[0].id());
        assert_eq!(generation.pieces[0].nodes[2].id(), generation.pieces[1].nodes[3].id());
        // The door piece's far jamb (slot 1/2) must match the right
        // piece's near jamb (slot 0/3).
        assert_eq!(generation.pieces[1].nodes[1].id(), generation.pieces[2].nodes[0].id());
        assert_eq!(generation.pieces[1].nodes[2].id(), generation.pieces[2].nodes[3].id());
    }

    #[test]
    fn boundary_door_at_start_generates_two_pieces() {
        let door = DoorOpening { opens_at: 0.0, closes_at: 0.5 };
        let generation = generate_wall(&wall(), Some(&door), node_id, edge_id, wall_type(), door_type()).unwrap();
        assert_eq!(generation.pieces.len(), 2);
        assert_eq!(generation.pieces[0].surface.surface_type, door_type());
        assert_eq!(generation.pieces[1].surface.surface_type, wall_type());
        assert_eq!(generation.pieces[0].nodes[1].id(), generation.pieces[1].nodes[0].id());
    }

    #[test]
    fn boundary_door_at_end_generates_two_pieces() {
        let door = DoorOpening { opens_at: 0.5, closes_at: 1.0 };
        let generation = generate_wall(&wall(), Some(&door), node_id, edge_id, wall_type(), door_type()).unwrap();
        assert_eq!(generation.pieces.len(), 2);
        assert_eq!(generation.pieces[0].surface.surface_type, wall_type());
        assert_eq!(generation.pieces[1].surface.surface_type, door_type());
        assert_eq!(generation.pieces[0].nodes[1].id(), generation.pieces[1].nodes[0].id());
    }

    #[test]
    fn a_door_spanning_the_whole_wall_generates_one_door_piece() {
        let door = DoorOpening { opens_at: 0.0, closes_at: 1.0 };
        let generation = generate_wall(&wall(), Some(&door), node_id, edge_id, wall_type(), door_type()).unwrap();
        assert_eq!(generation.pieces.len(), 1);
        assert_eq!(generation.pieces[0].surface.surface_type, door_type());
    }

    #[test]
    fn rejects_an_inverted_or_out_of_range_opening_and_builds_nothing() {
        let inverted = DoorOpening { opens_at: 0.7, closes_at: 0.2 };
        assert_eq!(
            generate_wall(&wall(), Some(&inverted), node_id, edge_id, wall_type(), door_type()).unwrap_err(),
            StructureGenerationError::InvalidDoorOpening { opens_at: 0.7, closes_at: 0.2 }
        );

        let out_of_range = DoorOpening { opens_at: -0.1, closes_at: 0.5 };
        assert_eq!(
            generate_wall(&wall(), Some(&out_of_range), node_id, edge_id, wall_type(), door_type()).unwrap_err(),
            StructureGenerationError::InvalidDoorOpening { opens_at: -0.1, closes_at: 0.5 }
        );
    }
}
