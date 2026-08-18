# grafting-procgen-structure-generation

### `pub enum grafting_procgen_structure_generation::Axis`

Which grid axis a [`BoundaryRun`] runs perpendicular to.

### `pub enum grafting_procgen_structure_generation::EdgeCurvature`

A [`PathEdge`]'s shape. `Arc`'s radius and center are always fully
determined by the edge's own `start`/`end` plus its own
`included_angle` -- there is no separate radius or control-point
parameter to keep this from ever generating a self-intersecting or
otherwise "crooked" curve.

### `pub enum grafting_procgen_structure_generation::ExtrusionError`

Why [`extrude_path`] could not derive an extrusion.

### `pub fn grafting_procgen_structure_generation::boundary_runs(cells: &[grafting_procgen_structure_generation::CellCoord], regions: &[grafting_procgen_structure_generation::Region]) -> alloc::vec::Vec<grafting_procgen_structure_generation::BoundaryRun>`

Every boundary run needed between/around `regions`' own cells --
`regions` must be `cells`' own [`partition_cells_into_regions`] result
(or an equivalent partition), since a run's `shared` flag is derived
from which region each of its two bordering cells belongs to.

### `pub fn grafting_procgen_structure_generation::cap_boundary(points: &[[f32; 3]], id_prefix: &str, surface_type: grafting_graph_core::surface::SurfaceType, top: bool) -> grafting_procgen_structure_generation::StructurePiece`

Caps `points` (a closed boundary, in cycle order, each entry's own
`[x, y, z]`) into one `Surface`. `top` reverses winding relative to
`top: false`'s own order, so a caller minting both a floor
(`top: false`) and a ceiling (`top: true`) from the same XZ footprint
gets outward-facing normals on both -- the same convention this
crate previously kept duplicated per generator. Every node this mints goes through
[`corner_id`], keyed by `id_prefix` and each point's own `x`/`z` -- `top`
only picks which of a shared XZ position's two ids (top or bottom node)
applies, so two calls at the same XZ under the same `id_prefix` weld
automatically regardless of Y (`corner_id` never encodes Y itself).

### `pub fn grafting_procgen_structure_generation::extrude_path(edges: &[grafting_procgen_structure_generation::PathEdge], height: f32, notch: core::option::Option<&grafting_procgen_structure_generation::EdgeNotch>, id_prefix: &str, surface_type: grafting_graph_core::surface::SurfaceType) -> core::result::Result<alloc::vec::Vec<grafting_procgen_structure_generation::StructurePiece>, grafting_procgen_structure_generation::ExtrusionError>`

Extrudes `edges` into vertical panel pieces, cutting `notch` into them if
given. Errors, leaving nothing behind, if `edges` is empty, doesn't
chain continuously, doesn't share one baseline Y, contains a zero-length
edge, or `notch` is given against anything but a single straight edge.

`id_prefix` must stay the same fixed value across every tick of one
stroke and across separate strokes extending the same physical
structure later, and must vary per floor/level sharing the same
footprint -- a corner id never encodes Y, only `id_prefix` and its own
`x`/`z`, so two floors reusing one `id_prefix` would mint colliding
corners for any footprint they share.

### `pub fn grafting_procgen_structure_generation::partition_cells_into_regions(cells: &[grafting_procgen_structure_generation::CellCoord], max_region_cells: usize, seed: u64) -> alloc::vec::Vec<grafting_procgen_structure_generation::Region>`

Partitions `cells` into regions: every disconnected component becomes
its own region-in-waiting, then any region over `max_region_cells` is
recursively bisected (re-splitting into connected components after each
cut, since a straight cut across an irregular region's bounding box can
separate it into pieces that are no longer contiguous) until every leaf
fits. `max_region_cells` is clamped to at least 1, so a single-cell
region (which can never be bisected -- zero extent on both axes) always
terminates the recursion -- `max_region_cells: 1` is also how a caller
asks for "never merge cells at all," one region per cell (a terrain
painter's own use, as opposed to a room painter's `max_region_cells > 1`).
Empty input produces no regions.

### `pub grafting_procgen_structure_generation::Axis::X`

A vertical line at a fixed grid-x.

### `pub grafting_procgen_structure_generation::Axis::Z`

A horizontal line at a fixed grid-z.

### `pub grafting_procgen_structure_generation::BoundaryRun::axis: grafting_procgen_structure_generation::Axis`

This run's own axis.

### `pub grafting_procgen_structure_generation::BoundaryRun::from: i32`

This run's start, inclusive, in cell-grid units.

### `pub grafting_procgen_structure_generation::BoundaryRun::line: i32`

The fixed grid line this run sits on.

### `pub grafting_procgen_structure_generation::BoundaryRun::shared: bool`

True iff this run separates two different regions.

### `pub grafting_procgen_structure_generation::BoundaryRun::to: i32`

This run's end, exclusive, in cell-grid units.

### `pub grafting_procgen_structure_generation::CellCoord::x: i32`

Grid column.

### `pub grafting_procgen_structure_generation::CellCoord::z: i32`

Grid row.

### `pub grafting_procgen_structure_generation::EdgeCurvature::Arc`

A true circular arc between the edge's two endpoints -- radius and
center are fully determined by them plus `included_angle`; `bulge`
is only which of the two arcs sharing that chord and angle is meant.

### `pub grafting_procgen_structure_generation::EdgeCurvature::Arc::bulge: grafting_graph_core::surface::ArcBulge`

Which side of the chord this arc bulges toward, facing from
`start` to `end` -- see [`ArcBulge`]'s own doc.

### `pub grafting_procgen_structure_generation::EdgeCurvature::Arc::included_angle: f32`

The arc's own swept angle, in radians, strictly between `0` and
`2 * PI`. `PI` is a true semicircle (the only shape this module
supported before arcs of arbitrary angle were needed to compose
closed shapes from 3+ arcs -- see this module's own top-level
doc).

### `pub grafting_procgen_structure_generation::EdgeCurvature::Straight`

A flat run between the edge's two endpoints.

### `pub grafting_procgen_structure_generation::EdgeNotch::ends_at: f32`

Fraction along the edge where the opening ends.

### `pub grafting_procgen_structure_generation::EdgeNotch::starts_at: f32`

Fraction along the edge where the opening begins.

### `pub grafting_procgen_structure_generation::EdgeNotch::surface_type: grafting_graph_core::surface::SurfaceType`

The opening's own surface type -- distinct from the solid panel's.

### `pub grafting_procgen_structure_generation::ExtrusionError::DegenerateEdge`

`edges[index]`'s `start` and `end` are the same point.

### `pub grafting_procgen_structure_generation::ExtrusionError::DegenerateEdge::index: usize`

The zero-length edge.

### `pub grafting_procgen_structure_generation::ExtrusionError::Discontinuous`

`edges[index - 1].end` and `edges[index].start` do not land on the
same `x`/`z` -- a path's edges must chain, each one starting where
the last one ended.

### `pub grafting_procgen_structure_generation::ExtrusionError::Discontinuous::index: usize`

The edge whose own `start` breaks the chain.

### `pub grafting_procgen_structure_generation::ExtrusionError::EmptyPath`

`edges` was empty -- a path needs at least one edge.

### `pub grafting_procgen_structure_generation::ExtrusionError::InconsistentBaseline`

`edges[index]`'s own `start[1]`/`end[1]` do not match the path's own
baseline (`edges[0].start[1]`).

### `pub grafting_procgen_structure_generation::ExtrusionError::InconsistentBaseline::index: usize`

The edge whose own Y breaks the shared baseline.

### `pub grafting_procgen_structure_generation::ExtrusionError::InvalidIncludedAngle`

An `Arc` edge's own `included_angle` is not strictly between `0` and
`2 * PI`.

### `pub grafting_procgen_structure_generation::ExtrusionError::InvalidIncludedAngle::included_angle: f32`

The offending value that was supplied.

### `pub grafting_procgen_structure_generation::ExtrusionError::InvalidIncludedAngle::index: usize`

The edge whose own angle is out of range.

### `pub grafting_procgen_structure_generation::ExtrusionError::InvalidNotch`

`notch`'s fractions were outside `[0, 1]`, or `starts_at` was not
strictly less than `ends_at`.

### `pub grafting_procgen_structure_generation::ExtrusionError::InvalidNotch::ends_at: f32`

The notch's supplied end fraction.

### `pub grafting_procgen_structure_generation::ExtrusionError::InvalidNotch::starts_at: f32`

The notch's supplied start fraction.

### `pub grafting_procgen_structure_generation::ExtrusionError::NotchRequiresSingleStraightEdge`

A notch was given but `edges` was not exactly one `Straight` edge --
see this module's own doc on the v1 notch scope.

### `pub grafting_procgen_structure_generation::PathEdge::curvature: grafting_procgen_structure_generation::EdgeCurvature`

This edge's shape.

### `pub grafting_procgen_structure_generation::PathEdge::end: [f32; 3]`

This edge's own end, at the path's baseline Y.

### `pub grafting_procgen_structure_generation::PathEdge::start: [f32; 3]`

This edge's own start, at the path's baseline Y.

### `pub grafting_procgen_structure_generation::Region::cells: alloc::collections::btree::set::BTreeSet<grafting_procgen_structure_generation::CellCoord>`

This region's own cells.

### `pub grafting_procgen_structure_generation::StructurePiece::edges: alloc::vec::Vec<grafting_graph_core::model::Edge<()>>`

This piece's ring edges, connecting `nodes` consecutively.

### `pub grafting_procgen_structure_generation::StructurePiece::nodes: alloc::vec::Vec<grafting_graph_core::model::Node<[f32; 3]>>`

This piece's nodes, in cycle order.

### `pub grafting_procgen_structure_generation::StructurePiece::surface: grafting_graph_core::construction::SurfaceSpec`

The surface `nodes` forms.

### `pub mod grafting_procgen_structure_generation`

Generic geometry primitives behind `ADR-0022` construction surfaces:
extruding a path into vertical panels, capping a closed boundary, and
finding regions/boundaries in a set of grid cells. No product concept
(wall, door, room, terrain cell) is known here -- see
`docs/adr/ADR-0022-wall-representation-free-geometry.md`'s "Structure
clouds and the generation/orchestration split."

This crate produces plain data only -- new nodes, new edges, and
[`grafting_graph_core::SurfaceSpec`]s -- and never mutates a
[`grafting_graph_core::Graph`] or [`grafting_graph_core::SurfaceRegistry`]
itself. Applying that data to a live graph, whether as a first creation
or as an edit against prior state, is a caller concern.

### `pub struct grafting_procgen_structure_generation::BoundaryRun`

One merged run of cell-edges needing a boundary, along one grid line:
`axis`/`line` fix the grid line (a vertical line at grid-x `line` for
[`Axis::X`], a horizontal line at grid-z `line` for [`Axis::Z`]),
`[from, to)` is the cell-width span along it. `shared` is true iff two
*different* regions (from the same [`partition_cells_into_regions`]
call) border this run on either side -- false for the outer edge of the
whole painted footprint. A caller decides what (if anything) a `shared`
run's own opening looks like; this module only reports where one is.

### `pub struct grafting_procgen_structure_generation::CellCoord`

One cell's grid coordinates -- not world units. Ord'd lexicographically
(x then z) so every collection built from a set of these has a
deterministic iteration order, which is what makes
[`partition_cells_into_regions`] a pure function of its input cell set
alone.

### `pub struct grafting_procgen_structure_generation::EdgeNotch`

A gap cut into an extruded edge, as fractions along it. `starts_at` must
be less than `ends_at`, both within `[0, 1]`. V1: the opening spans the
full extrusion height -- no lintel piece above it.

### `pub struct grafting_procgen_structure_generation::PathEdge`

One edge of a path, at the path's own baseline Y. Every edge in one
[`extrude_path`] call must share the same `start[1]`/`end[1]`.

### `pub struct grafting_procgen_structure_generation::Region`

One region: a connected set of cells no larger than the `max_region_cells`
its own [`partition_cells_into_regions`] call was given.

### `pub struct grafting_procgen_structure_generation::StructurePiece`

One generated piece of an extrusion (a whole panel, or one
remainder/notch segment of a panel with an opening): its own new
nodes/edges, and the [`SurfaceSpec`] they form. Nodes shared with a
sibling piece (a notch's own jamb corners, or two adjacent path
sub-segments) are emitted by every piece whose cycle includes them,
under the same [`NodeId`] (position-derived, via `corner_id`) -- a
caller applying more than one piece to a live graph is responsible for
not re-adding an id already present.

### `pub use grafting_procgen_structure_generation::ArcBulge`
