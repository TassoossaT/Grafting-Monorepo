# grafting-vtt-generation-wasm

### `pub fn grafting_vtt_generation_wasm::generate_heightmap(width: u32, height: u32, seed: u32, scale: f64) -> alloc::vec::Vec<f32>`

Samples a real Perlin-noise heightmap on a `width` x `height` grid,
seeded deterministically. Returns a flat row-major array of one height
value per cell, in Perlin's native `[-1.0, 1.0]` range. `scale` controls
the noise frequency (smaller values produce smoother, larger-scale
terrain features).

### `pub mod grafting_vtt_generation_wasm`

Wasm bridge exposing a small, real VTT procedural-generation slice
(a `noise`-backed heightmap sampler) to the Architecture Studio's VTT
generation-test surface. This is pipeline step 1 only (the continuous
heightmap seed, per `docs/research/vtt-map-and-terrain-construction-options.md`'s
end-to-end pipeline section) -- not the terrain-quantization, water,
WFC, or interior passes, which remain future work.
