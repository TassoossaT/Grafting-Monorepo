# grafting-procgen-structure-generation

### `pub enum grafting_procgen_structure_generation::StructureGenerationError`

Why [`generate_wall`] could not derive a wall.

### `pub enum grafting_procgen_structure_generation::WallNodeRole`

A generated wall node's role -- lets a caller supply stable identity per
role via `node_id`/`edge_id` in [`generate_wall`], and lets adjacent
pieces agree on a shared jamb node's identity without this crate
inventing one.

### `pub fn grafting_procgen_structure_generation::generate_room_grid(layout: &grafting_procgen_structure_generation::RoomGridLayout, id_prefix: &str, wall_type: grafting_graph_core::surface::SurfaceType, door_type: grafting_graph_core::surface::SurfaceType, floor_type: grafting_graph_core::surface::SurfaceType, ceiling_type: grafting_graph_core::surface::SurfaceType) -> grafting_procgen_structure_generation::RoomGridGeneration`

Generates a room-grid layout's wall/floor/ceiling pieces. `id_prefix`
namespaces every generated id, same role as `wall-corner-weld.ts`'s
`tableId:salt` naming plays for a hand-drawn wall, resolved here
instead since this generator already knows its own full topology
upfront once the treemap has run.

### `pub fn grafting_procgen_structure_generation::generate_tiled_rooms(tiles: &[grafting_procgen_structure_generation::RectTile], origin_y: f32, wall_height: f32, id_prefix: &str, wall_type: grafting_graph_core::surface::SurfaceType, door_type: grafting_graph_core::surface::SurfaceType, floor_type: grafting_graph_core::surface::SurfaceType, ceiling_type: grafting_graph_core::surface::SurfaceType, corner_override: impl core::ops::function::Fn(f32, f32, bool) -> core::option::Option<grafting_graph_core::model::NodeId>) -> grafting_procgen_structure_generation::RoomGridGeneration`

Derives every tile's wall/floor/ceiling pieces: one wall piece per
maximal run along every interior or perimeter line the tiling
produces (see the module doc for why a run can be shorter than a
whole tile edge), and one floor + one ceiling per tile. `corner_override`
lets a caller weld specific corners onto pre-existing node ids instead
of this crate's own position-derived default -- see
[`resolve_corner_id`]. Pass `|_, _, _| None` for the common case (a
fresh, unwelded tiling, e.g. `room_grid`'s whole-footprint generation).

### `pub fn grafting_procgen_structure_generation::generate_wall(wall: &grafting_procgen_structure_generation::WallSegment, door: core::option::Option<&grafting_procgen_structure_generation::DoorOpening>, node_id: impl core::ops::function::Fn(grafting_procgen_structure_generation::WallNodeRole) -> grafting_graph_core::model::NodeId, edge_id: impl core::ops::function::Fn(grafting_procgen_structure_generation::WallNodeRole, grafting_procgen_structure_generation::WallNodeRole) -> grafting_graph_core::model::EdgeId, wall_type: grafting_graph_core::surface::SurfaceType, door_type: grafting_graph_core::surface::SurfaceType) -> core::result::Result<grafting_procgen_structure_generation::WallGeneration, grafting_procgen_structure_generation::StructureGenerationError>`

Derives a wall's construction-surface node cycle(s), splitting around a
door opening if `door` is given. `node_id`/`edge_id` let the caller
decide identity per [`WallNodeRole`] -- this crate never invents one,
matching `grafting_graph_core::construction::duplicate_surface`'s own
principle. Validates `door` (if any) before constructing anything, so a
rejected call leaves nothing behind.

### `pub grafting_procgen_structure_generation::DoorOpening::closes_at: f32`

Fraction along the centerline where the opening ends.

### `pub grafting_procgen_structure_generation::DoorOpening::opens_at: f32`

Fraction along the centerline where the opening begins.

### `pub grafting_procgen_structure_generation::RectTile::depth: f32`

This tile's extent along Z.

### `pub grafting_procgen_structure_generation::RectTile::width: f32`

This tile's extent along X.

### `pub grafting_procgen_structure_generation::RectTile::x: f32`

This tile's minimum corner along X.

### `pub grafting_procgen_structure_generation::RectTile::z: f32`

This tile's minimum corner along Z.

### `pub grafting_procgen_structure_generation::RoomGridGeneration::ceilings: alloc::vec::Vec<grafting_procgen_structure_generation::StructurePiece>`

One ceiling piece per tile, in input order.

### `pub grafting_procgen_structure_generation::RoomGridGeneration::floors: alloc::vec::Vec<grafting_procgen_structure_generation::StructurePiece>`

One floor piece per tile, in input order.

### `pub grafting_procgen_structure_generation::RoomGridGeneration::walls: alloc::vec::Vec<grafting_procgen_structure_generation::StructurePiece>`

Wall pieces, in sweep order (all vertical lines, then all horizontal lines).

### `pub grafting_procgen_structure_generation::RoomGridLayout::depth: f32`

The footprint's extent along Z. Must be positive.

### `pub grafting_procgen_structure_generation::RoomGridLayout::origin: [f32; 3]`

The footprint's min-x/min-z corner, at its own base (Y is the floor level).

### `pub grafting_procgen_structure_generation::RoomGridLayout::room_count: u32`

Number of rooms to partition the footprint into. Must be at least 1.

### `pub grafting_procgen_structure_generation::RoomGridLayout::seed: u64`

Drives both the per-room size weights and the treemap's own item
order -- the same seed always reproduces the same layout.

### `pub grafting_procgen_structure_generation::RoomGridLayout::wall_height: f32`

Every wall's rise above `origin`'s own Y.

### `pub grafting_procgen_structure_generation::RoomGridLayout::width: f32`

The footprint's extent along X. Must be positive.

### `pub grafting_procgen_structure_generation::StructureGenerationError::InvalidDoorOpening`

`door`'s fractions were outside `[0, 1]`, or `opens_at` was not
strictly less than `closes_at`.

### `pub grafting_procgen_structure_generation::StructureGenerationError::InvalidDoorOpening::closes_at: f32`

The opening's supplied end fraction.

### `pub grafting_procgen_structure_generation::StructureGenerationError::InvalidDoorOpening::opens_at: f32`

The opening's supplied start fraction.

### `pub grafting_procgen_structure_generation::StructurePiece::edges: alloc::vec::Vec<grafting_graph_core::model::Edge<()>>`

This piece's ring edges, connecting `nodes` consecutively.

### `pub grafting_procgen_structure_generation::StructurePiece::nodes: alloc::vec::Vec<grafting_graph_core::model::Node<[f32; 3]>>`

This piece's nodes, in cycle order.

### `pub grafting_procgen_structure_generation::StructurePiece::surface: grafting_graph_core::construction::SurfaceSpec`

The surface `nodes` forms.

### `pub grafting_procgen_structure_generation::WallGeneration::pieces: alloc::vec::Vec<grafting_procgen_structure_generation::StructurePiece>`

The generated pieces, in centerline order from `start` to `end`.

### `pub grafting_procgen_structure_generation::WallNodeRole::DoorEndBottom`

The door opening's far jamb, at the wall's base.

### `pub grafting_procgen_structure_generation::WallNodeRole::DoorEndTop`

The door opening's far jamb, at the wall's top.

### `pub grafting_procgen_structure_generation::WallNodeRole::DoorStartBottom`

The door opening's near jamb, at the wall's base.

### `pub grafting_procgen_structure_generation::WallNodeRole::DoorStartTop`

The door opening's near jamb, at the wall's top.

### `pub grafting_procgen_structure_generation::WallNodeRole::EndBottom`

The centerline's end, at the wall's base.

### `pub grafting_procgen_structure_generation::WallNodeRole::EndTop`

The centerline's end, at the wall's top.

### `pub grafting_procgen_structure_generation::WallNodeRole::StartBottom`

The centerline's start, at the wall's base.

### `pub grafting_procgen_structure_generation::WallNodeRole::StartTop`

The centerline's start, at the wall's top.

### `pub grafting_procgen_structure_generation::WallSegment::end: [f32; 3]`

The other end of the centerline, at the wall's base.

### `pub grafting_procgen_structure_generation::WallSegment::height: f32`

How far above the centerline's own base the wall's top sits.

### `pub grafting_procgen_structure_generation::WallSegment::start: [f32; 3]`

One end of the centerline, at the wall's base.

### `pub mod grafting_procgen_structure_generation`

Derives `ADR-0022` construction-surface node cycles for walls and door
openings from centerline generation parameters.

This crate produces plain data only -- new nodes, new edges, and
[`grafting_graph_core::SurfaceSpec`]s -- and never mutates a
[`grafting_graph_core::Graph`] or [`grafting_graph_core::SurfaceRegistry`]
itself. Applying that data to a live graph, whether as a first creation
or as an edit against prior state, is a caller concern.

### `pub struct grafting_procgen_structure_generation::DoorOpening`

A door opening cut into a [`WallSegment`], as fractions along its
centerline. `opens_at` must be less than `closes_at`, both within
`[0, 1]`. V1: the opening spans the wall's full height -- no lintel
piece above it. A partial-height opening is a deliberate, documented
follow-up.

### `pub struct grafting_procgen_structure_generation::RectTile`

One rectangular room's footprint, in the tiling's own ground plane
(`x`/`z`, matching every other generator in this crate). `width` runs
along `x`, `depth` runs along `z`. Must not overlap any other tile in
the same call, and the full set must tile its bounding footprint with
no gaps -- both are the caller's responsibility (e.g. `streemap`'s own
contract), not validated here.

### `pub struct grafting_procgen_structure_generation::RoomGridGeneration`

A generated tiling's pieces: one wall piece per maximal wall run (see
the module doc for why a run can be shorter than a whole tile edge),
and one floor + one ceiling piece per tile.

### `pub struct grafting_procgen_structure_generation::RoomGridLayout`

A rectangular `width` x `depth` footprint split into `room_count`
rooms, `origin` at the footprint's own min-x/min-z corner. v1 scope: a
single rectangular footprint, no L-shaped or otherwise non-rectangular
silhouette.

### `pub struct grafting_procgen_structure_generation::StructurePiece`

One generated piece of a wall (a whole wall, or one wall-remainder or
door segment of a wall with an opening): its own new nodes/edges, and
the [`SurfaceSpec`] they form. Nodes shared with a sibling piece (jamb
corners) are emitted by every piece whose cycle includes them, under
the same `NodeId` (via `node_id` returning the same id for the same
role) -- a caller applying more than one piece to a live graph is
responsible for not re-adding an id already present, the same
composition `grafting-procgen-terrain-generation`'s own interop tests
use for a shared seam node.

### `pub struct grafting_procgen_structure_generation::WallGeneration`

A wall's generated pieces: 1 (no door, or a door spanning the whole
wall), 2 (a door touching one end), or 3 (a door interior to the wall).

### `pub struct grafting_procgen_structure_generation::WallSegment`

A wall's centerline and height. No thickness -- see the module doc.
