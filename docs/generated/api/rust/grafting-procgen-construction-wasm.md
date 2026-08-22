# grafting-procgen-construction-wasm

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::add_patch_json(&mut self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

Registers a whole generated patch -- nodes, shared boundary edges,
and the regions over them -- in one call. See
`region_editing::apply_add_patch` for why a generator must name its
own edges rather than let each face mint its own.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::all_region_topologies_json(&self) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

Every registered region's boundary -- the edit-mode bootstrap call.
See `region_editing::all_region_topologies`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::all_surface_meshes_json(&self) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

Every currently-known surface's triangulated mesh, in stable key
order -- the one bootstrap call a renderer uses to draw everything
already in the session. See `mesh::all_surface_meshes`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::apply_path_brush_json(&mut self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

Applies one validated terrain-to-path brush operation. The session only
forwards the resolved request to the domain transformer and publishes
its already-atomic replacement plan.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::classify_points_json(&self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

Which of the given XZ points already sit inside a region -- what a
generator consults so it only builds over open ground. See
`footprint::classify_points`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::cloud_json(&self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

The connected component of same-`type` regions reachable from
`seed` by shared graph nodes -- `ADR-0022`'s "cloud" query. See
`geometry::connected_component`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::delete_region_json(&mut self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

`DeleteRegion`. See `region_editing::apply_delete_region`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::describe()`

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::describe_vector()`

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::duplicate_region_json(&mut self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

`DuplicateRegion`. See `region_editing::apply_duplicate_region`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::footprint_coverage_json(&self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

What a brush footprint currently covers, before anything is
generated -- the creation-side counterpart to `region_topology_json`.
The engine reports; the caller's own per-type table decides what to
do about it. See `footprint::footprint_coverage`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::generate_and_apply_region_partition_json(&mut self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

Regenerates a painted cell set's whole region partition (every
region's own per-cell floor/ceiling, and a wall -- notched where a
run borders a different region -- along every boundary run) and
applies only the difference against whatever this structure already
holds -- the "Pintar Casa" tool's per-tick commit, and (once a
wall-brush stroke's path closes) the wall-brush's own closure
commit. See `generation::generate_and_apply_region_partition`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::insert_vertex_json(&mut self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

`InsertVertex`. See `region_editing::apply_insert_vertex`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::into_abi(self) -> Self::Abi`

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::is_none(abi: &Self::Abi) -> bool`

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::move_edge_json(&mut self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

`MoveEdge`. See `region_editing::apply_move_edge`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::move_region_json(&mut self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

`MoveRegion`. See `region_editing::apply_move_region`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::move_vertex_json(&mut self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

`MoveVertex`. See `region_editing::apply_move_vertex`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::new() -> grafting_procgen_construction_wasm::ConstructionSession`

Creates an empty session.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::none() -> Self::Abi`

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::redo_path_brush(&mut self, operation_id: &str) -> core::result::Result<(), wasm_bindgen::JsValue>`

Restores the state immediately after the latest matching undone path-brush operation.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::region_topology_json(&self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

One region's live boundary, in this crate's own deterministic order.
See `region_editing::region_topology`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::remove_surface_json(&mut self, request_json: &str) -> core::result::Result<(), wasm_bindgen::JsValue>`

Unregisters a surface outright -- no hole-repair, no cascading. See
`editing::remove_surface`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::remove_vertex_json(&mut self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

`RemoveVertex`. See `region_editing::apply_remove_vertex`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::retype_edge_json(&mut self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

`RetypeEdge`. See `region_editing::apply_retype_edge`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::snapshot_json(&self) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

The session's current nodes, edges, and surfaces, for a caller to
render from without re-deriving state.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::surface_mesh_json(&self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

One surface's triangulated mesh piece(s), by key -- what a caller
re-fetches for each entry in an operation's `affectedSurfaceKeys`
after a mutation, instead of re-fetching everything. An analytic
region key can legitimately return more than one piece; a plain
surface key always returns exactly one. See `mesh::surface_mesh`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::try_from_js_value(value: wasm_bindgen::JsValue) -> core::result::Result<Self, wasm_bindgen::JsValue>`

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::try_from_js_value_ref(value: &wasm_bindgen::JsValue) -> core::option::Option<Self>`

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::undo_path_brush(&mut self, operation_id: &str) -> core::result::Result<(), wasm_bindgen::JsValue>`

Restores the state immediately before the latest matching path-brush operation.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::unfilled_loops_json(&self, request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

Every closed loop of free boundary, among the nodes the request
names, that another such loop encloses -- a hole in the surface whose
rim already exists. The caller passes the region it just touched;
boundary elsewhere on the map is none of its business. See
`enclosure::unfilled_loops`.

### `pub fn grafting_procgen_construction_wasm::ConstructionSession::vector_into_abi(vector: alloc::boxed::Box<[grafting_procgen_construction_wasm::ConstructionSession]>) -> Self::Abi`

### `pub fn wasm_bindgen::JsValue::from(value: grafting_procgen_construction_wasm::ConstructionSession) -> Self`

### `pub mod grafting_procgen_construction_wasm`

Wasm bridge exposing `grafting-graph-core`'s construction operations and
the terrain-generation/structure-generation crates' pure generators as
one stateful `ConstructionSession` for the Web host. Pure wiring only --
see this crate's `AGENTS.md` for the boundary this crate must not cross.

### `pub struct grafting_procgen_construction_wasm::ConstructionSession`

One live editing session: a `Graph<[f32; 3], ()>` + `SurfaceRegistry`,
plus an optional `PrismGridMesh` terrain generation reads from. In-memory
only -- gone when the tab/Worker closes; see this crate's `AGENTS.md` for
why no persistence is built here.

### `pub type grafting_procgen_construction_wasm::ConstructionSession::Abi = <alloc::boxed::Box<[wasm_bindgen::JsValue]> as wasm_bindgen::convert::traits::FromWasmAbi>::Abi`

### `pub type grafting_procgen_construction_wasm::ConstructionSession::Abi = <alloc::boxed::Box<[wasm_bindgen::JsValue]> as wasm_bindgen::convert::traits::IntoWasmAbi>::Abi`

### `pub type grafting_procgen_construction_wasm::ConstructionSession::Abi = wasm_bindgen::__rt::WasmPtr<wasm_bindgen::__rt::WasmRefCell<grafting_procgen_construction_wasm::ConstructionSession>>`

### `pub type grafting_procgen_construction_wasm::ConstructionSession::Anchor = wasm_bindgen::__rt::RcRef<grafting_procgen_construction_wasm::ConstructionSession>`

### `pub type grafting_procgen_construction_wasm::ConstructionSession::Anchor = wasm_bindgen::__rt::RcRefMut<grafting_procgen_construction_wasm::ConstructionSession>`

### `pub unsafe fn grafting_procgen_construction_wasm::ConstructionSession::from_abi(js: Self::Abi) -> Self`

### `pub unsafe fn grafting_procgen_construction_wasm::ConstructionSession::long_ref_from_abi(js: Self::Abi) -> Self::Anchor`

### `pub unsafe fn grafting_procgen_construction_wasm::ConstructionSession::ref_from_abi(js: Self::Abi) -> Self::Anchor`

### `pub unsafe fn grafting_procgen_construction_wasm::ConstructionSession::ref_mut_from_abi(js: Self::Abi) -> Self::Anchor`

### `pub unsafe fn grafting_procgen_construction_wasm::ConstructionSession::vector_from_abi(js: Self::Abi) -> alloc::boxed::Box<[grafting_procgen_construction_wasm::ConstructionSession]>`
