# grafting-procgen-discretize

### `pub fn grafting_procgen_discretize::discretize(values: alloc::vec::Vec<f32>, levels: u32) -> alloc::vec::Vec<i32>`

Discretizes each value of a continuous `[-1.0, 1.0]` array into one of
`levels` discrete integer bands via linear binning. Values outside
`[-1.0, 1.0]` are clamped rather than producing an out-of-range level.
`levels` must be at least 1; a `levels` of 1 maps every value to level 0.

### `pub mod grafting_procgen_discretize`

Wasm bridge discretizing an arbitrary continuous `[-1.0, 1.0]` float
array into `N` discrete integer levels via linear binning, as a generic,
shareable domain capability. Not terrain- or heightmap-specific: any
continuous signal in that range (a heightmap, a data-viz value to
bucket, an LOD distance, a signal to posterize) can consume it. Its
first real consumer is the VTT map-generation pipeline's step 3
("Quantization into the discrete grid", per
`docs/research/vtt-map-and-terrain-construction-options.md`'s end-to-end
pipeline section), quantizing `grafting-procgen-generation-wasm`'s
heightmap output -- but that is one consumer, not this crate's identity.
