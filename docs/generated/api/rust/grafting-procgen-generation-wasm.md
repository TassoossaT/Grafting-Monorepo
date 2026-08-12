# grafting-procgen-generation-wasm

### `pub const grafting_procgen_generation_wasm::MAX_CELLS: u64`

The largest grid this crate will allocate, 4096 x 4096.

At four bytes per sample that is a 64 MiB result, which is already generous
for a heightmap seed and stays well inside `wasm32`'s address space.

### `pub const grafting_procgen_generation_wasm::MAX_SCALE: f64`

The largest `scale` that can still resolve the noise it samples.

Perlin's gradient lattice has period 1.0 on each axis, and `scale` is the
step between samples in that space, so a step of 0.5 is already the Nyquist
limit: two samples per feature. At or above it the returned grid is not a
coarser heightmap, it is an aliased one, and the failure is quiet rather
than obvious.

A whole-number `scale` is the degenerate case of this. Gradient noise is
exactly zero at every integer lattice point, so a whole-number step lands
*every* sample on one and the entire grid comes back as zeros -- a
perfectly flat map from a function that looks like it succeeded. That is a
real bug this crate shipped into two consumers before it was caught, which
is why the limit is enforced here rather than only documented.

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::cell_corners(&self) -> alloc::vec::Vec<u32>`

8 corner vertex indices per cell [V0..V7].

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::cell_count(&self) -> u32`

Total number of cells in the grid mesh.

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::cell_neighbors(&self) -> alloc::vec::Vec<u32>`

6 neighbor cell IDs per cell [North, East, South, West, Bottom, Top].

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::describe()`

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::describe_vector()`

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::height(&self) -> u32`

Grid height in cells.

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::into_abi(self) -> Self::Abi`

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::is_none(abi: &Self::Abi) -> bool`

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::layers(&self) -> u32`

Grid layers count.

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::none() -> Self::Abi`

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::positions(&self) -> alloc::vec::Vec<f32>`

Flat list of 3D vertex positions [x, y, z] for all corners.

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::try_from_js_value(value: wasm_bindgen::JsValue) -> core::result::Result<Self, wasm_bindgen::JsValue>`

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::try_from_js_value_ref(value: &wasm_bindgen::JsValue) -> core::option::Option<Self>`

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::vector_into_abi(vector: alloc::boxed::Box<[grafting_procgen_generation_wasm::WasmPrismMesh]>) -> Self::Abi`

### `pub fn grafting_procgen_generation_wasm::WasmPrismMesh::width(&self) -> u32`

Grid width in cells.

### `pub fn grafting_procgen_generation_wasm::generate_heightmap(width: u32, height: u32, seed: u32, scale: f64) -> core::result::Result<alloc::vec::Vec<f32>, wasm_bindgen::JsValue>`

Samples a real Perlin-noise heightmap on a `width` x `height` grid,
seeded deterministically. Returns a flat row-major array of one height
value per cell, in Perlin's native `[-1.0, 1.0]` range.

`scale` is the distance between samples in the noise's own space, so
**smaller** values produce smoother, larger-scale terrain features. It must
be finite and lie in `(0, MAX_SCALE)`; useful values are well below the
limit, around `0.05` to `0.2`. See [`MAX_SCALE`] for why anything at or
above it cannot return usable terrain.

# Errors

Returns a `JsValue` error, surfacing as a thrown exception in JavaScript,
when `scale` is out of range or the requested grid does not fit in memory.
Validation happens here because panics are not catchable on
`wasm32-unknown-unknown`, so an invalid argument would otherwise abort the
caller's worker instead of rejecting.

### `pub fn grafting_procgen_generation_wasm::generate_prism_mesh(width: u32, height: u32, layers: u32, primitive_u8: u8, deformation_xy: f32, deformation_z: f32) -> core::result::Result<grafting_procgen_generation_wasm::WasmPrismMesh, wasm_bindgen::JsValue>`

Generates a 3D prism grid mesh with 6-slot connectivity and deformation inputs.

* `primitive_u8`: 0 = Passage, 1 = Boundary, 2 = Surface.
* `deformation_xy`: Planar XY alignment deformation (0.0 = regular quad lattice, 1.0 = organic).
* `deformation_z`: Vertical Z height variation factor (0.0 = flat plane, 1.0 = chaotic terrain).

### `pub fn wasm_bindgen::JsValue::from(value: grafting_procgen_generation_wasm::WasmPrismMesh) -> Self`

### `pub mod grafting_procgen_generation_wasm`

Wasm bridge exposing a small, real procedural-generation slice (a
`noise`-backed heightmap sampler) as a generic, shareable domain
capability, currently exercised by Architecture Studio's generation-test
surface. This is pipeline step 1 only (the continuous heightmap seed, per
`docs/research/vtt-map-and-terrain-construction-options.md`'s end-to-end
pipeline section, which designed this capability for the VTT product
first) -- not the terrain-quantization, water, WFC, or interior passes,
which remain future work.

### `pub struct grafting_procgen_generation_wasm::WasmPrismMesh`

A WASM-bindgen friendly wrapper exposing a generated 3D prism grid mesh
as flat typed-array buffers.

### `pub type grafting_procgen_generation_wasm::WasmPrismMesh::Abi = <alloc::boxed::Box<[wasm_bindgen::JsValue]> as wasm_bindgen::convert::traits::FromWasmAbi>::Abi`

### `pub type grafting_procgen_generation_wasm::WasmPrismMesh::Abi = <alloc::boxed::Box<[wasm_bindgen::JsValue]> as wasm_bindgen::convert::traits::IntoWasmAbi>::Abi`

### `pub type grafting_procgen_generation_wasm::WasmPrismMesh::Abi = wasm_bindgen::__rt::WasmPtr<wasm_bindgen::__rt::WasmRefCell<grafting_procgen_generation_wasm::WasmPrismMesh>>`

### `pub type grafting_procgen_generation_wasm::WasmPrismMesh::Anchor = wasm_bindgen::__rt::RcRef<grafting_procgen_generation_wasm::WasmPrismMesh>`

### `pub type grafting_procgen_generation_wasm::WasmPrismMesh::Anchor = wasm_bindgen::__rt::RcRefMut<grafting_procgen_generation_wasm::WasmPrismMesh>`

### `pub unsafe fn grafting_procgen_generation_wasm::WasmPrismMesh::from_abi(js: Self::Abi) -> Self`

### `pub unsafe fn grafting_procgen_generation_wasm::WasmPrismMesh::long_ref_from_abi(js: Self::Abi) -> Self::Anchor`

### `pub unsafe fn grafting_procgen_generation_wasm::WasmPrismMesh::ref_from_abi(js: Self::Abi) -> Self::Anchor`

### `pub unsafe fn grafting_procgen_generation_wasm::WasmPrismMesh::ref_mut_from_abi(js: Self::Abi) -> Self::Anchor`

### `pub unsafe fn grafting_procgen_generation_wasm::WasmPrismMesh::vector_from_abi(js: Self::Abi) -> alloc::boxed::Box<[grafting_procgen_generation_wasm::WasmPrismMesh]>`
