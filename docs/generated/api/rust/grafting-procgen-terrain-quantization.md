# grafting-procgen-terrain-quantization

### `pub fn grafting_procgen_terrain_quantization::quantize_heightmap(heights: alloc::vec::Vec<f32>, levels: u32) -> alloc::vec::Vec<i32>`

Quantizes each cell of a continuous heightmap (expected in
`generate_heightmap`'s native `[-1.0, 1.0]` range) into one of `levels`
discrete integer elevation bands via linear binning. Values outside
`[-1.0, 1.0]` are clamped rather than producing an out-of-range level.
`levels` must be at least 1; a `levels` of 1 quantizes every cell to
level 0.

### `pub mod grafting_procgen_terrain_quantization`

Wasm bridge quantizing a continuous heightmap (as produced by
`grafting-procgen-generation-wasm`'s `generate_heightmap`) into a
discrete stacked-layer elevation grid, as a generic, shareable domain
capability. This is pipeline step 3 only ("Quantization into the
discrete grid", per
`docs/research/vtt-map-and-terrain-construction-options.md`'s end-to-end
pipeline section, which designed this capability for the VTT product
first) -- not the terrain-WFC tileset pass, water-mask integration, or
any other future step, which remain separate future crates.
