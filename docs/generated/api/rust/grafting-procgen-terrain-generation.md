# grafting-procgen-terrain-generation

### `pub enum grafting_procgen_terrain_generation::TerrainGenerationError`

Why [`generate_terrain_cell_surface`] could not derive a surface.

### `pub fn grafting_procgen_terrain_generation::bilinear_point(corners: [[f32; 3]; 4], u: f32, v: f32) -> [f32; 3]`

Maps unit-cell point `(u, v)` onto `corners`, per the module doc's
bilinear formula. `u`/`v` are not clamped to `[0, 1]` -- a caller may
legitimately extrapolate past the quad's own edge.

### `pub fn grafting_procgen_terrain_generation::generate_terrain_cell_surface(mesh: &grafting_graph_core::model::PrismGridMesh, cell: usize, module: &grafting_procgen_terrain_generation::CornerHeightModule, node_id: impl core::ops::function::Fn(usize) -> grafting_graph_core::model::NodeId, edge_id: impl core::ops::function::Fn(usize) -> grafting_graph_core::model::EdgeId, surface_type: grafting_graph_core::surface::SurfaceType) -> core::result::Result<grafting_procgen_terrain_generation::TerrainCellGeneration, grafting_procgen_terrain_generation::TerrainGenerationError>`

Derives one `PrismGridMesh` cell's top surface from `module`'s
corner-height profile: for each of the cell's 4 corner slots, the
generated node's position is a straight lerp between that slot's
bottom-ring and top-ring position in `mesh`, by `module.corner_heights`'
fraction at that slot.

This is the correct, minimal algorithm for a flat corner-heights module
on a `PrismGridMesh` cell -- the cell's own bottom/top rings already are
the quad's real corners at every height fraction, so no XY bilinear
re-interpolation ([`crate::bilinear_point`]) is needed to place a point
exactly on the cell's own corner column; that function exists for the
documented `Mesh`-shape follow-up (interior/edge sampling), not called
here.

`node_id`/`edge_id` (0..3, ring edge `i` connects slot `i` to
`(i + 1) % 4`) let the caller decide identity -- in particular, whether
two adjacent cells sharing a `PrismGridMesh` vertex index get the *same*
`NodeId` (a seamless join) or different ones (a deliberate crack); this
crate never invents identity, matching `duplicate_surface`'s own
principle (`grafting_graph_core`).

### `pub fn grafting_procgen_terrain_generation::rotate_corner_heights(heights: [f32; 4], turns: usize) -> [f32; 4]`

Applies a solved rotation to a corner-height profile.

Ported from `rotateUnitCell`, specialized to the 4 exact corner points:
one turn moves the unit cell's corner `i` to where corner `i + 1` was
(`(0,0) -> (1,0) -> (1,1) -> (0,1) -> (0,0)`, matching
`PrismGridMesh::cell_corners`' own `[bottom-left, bottom-right,
top-right, top-left]` order), so the height that was at slot `i` before
rotation ends up at slot `i + 1` after -- a `rotate_right` by `turns`,
verified by hand against `terrain-modules.ts::moduleMesh`'s per-corner
loop. `turns` wraps at 4, matching
`grafting_procgen_tileset_wfc::rotation::ModuleOrigin::turns`'s own
convention (one turn per quarter rotation).

### `pub grafting_procgen_terrain_generation::CornerHeightModule::corner_heights: [f32; 4]`

Fraction of the cell's own vertical extent, one per corner, in
`PrismGridMesh::cell_corners`' cyclic order: `0.0` sits at that
corner slot's bottom-ring position, `1.0` at its top-ring position.
Not clamped to `[0, 1]` -- a module may legitimately extrapolate
past the cell's own height (an overhanging cliff face, for
instance).

### `pub grafting_procgen_terrain_generation::CornerHeightModule::name: alloc::string::String`

Caller-facing identity, matching
`grafting_procgen_tileset_wfc::Module::name` -- how a caller maps a
solved `ModuleId` back to this module's geometry. Not interpreted by
this crate.

### `pub grafting_procgen_terrain_generation::TerrainCellGeneration::edges: alloc::vec::Vec<grafting_graph_core::model::Edge<()>>`

The 4-edge ring connecting `nodes` consecutively, wrapping around.

### `pub grafting_procgen_terrain_generation::TerrainCellGeneration::nodes: alloc::vec::Vec<grafting_graph_core::model::Node<[f32; 3]>>`

The 4 corner nodes, in `PrismGridMesh::cell_corners`' cyclic order.

### `pub grafting_procgen_terrain_generation::TerrainCellGeneration::surface: grafting_graph_core::construction::SurfaceSpec`

The surface these nodes and edges form.

### `pub grafting_procgen_terrain_generation::TerrainGenerationError::UnknownCell`

`cell` is outside `mesh`'s own cell count.

### `pub grafting_procgen_terrain_generation::TerrainGenerationError::UnknownCell::cell: usize`

The index that was requested.

### `pub grafting_procgen_terrain_generation::TerrainGenerationError::UnknownCell::cell_count: usize`

How many cells `mesh` actually has.

### `pub mod grafting_procgen_terrain_generation`

Derives `ADR-0022` construction-surface node cycles from a WFC-chosen
terrain module and a [`grafting_graph_core::PrismGridMesh`] cell.

This crate produces plain data only -- new nodes, new edges, and a
[`grafting_graph_core::SurfaceSpec`] -- and never mutates a
[`grafting_graph_core::Graph`] or [`grafting_graph_core::SurfaceRegistry`]
itself. Applying that data to a live graph, whether as a first creation
or as an edit against prior state, is a caller concern.

### `pub struct grafting_procgen_terrain_generation::CornerHeightModule`

A flat corner-height terrain module: a top surface at 4 corner heights,
per `terrain-modules.ts`'s doc comment ("A flat top is `[1, 1, 1, 1]`; a
ramp is `[1, 1, 0, 0]`").

### `pub struct grafting_procgen_terrain_generation::TerrainCellGeneration`

One cell's worth of generated construction-surface data: new nodes, the
ring edges connecting them, and the [`SurfaceSpec`] a caller can
register (first creation) or use as an operand to
`grafting_graph_core`'s existing node operations (an edit). This crate
never performs either itself.
