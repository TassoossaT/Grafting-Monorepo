//! Wasm bridge exposing a small, real procedural-generation slice (a
//! `noise`-backed heightmap sampler) as a generic, shareable domain
//! capability, currently exercised by Architecture Studio's generation-test
//! surface. This is pipeline step 1 only (the continuous heightmap seed, per
//! `docs/research/vtt-map-and-terrain-construction-options.md`'s end-to-end
//! pipeline section, which designed this capability for the VTT product
//! first) -- not the terrain-quantization, water, WFC, or interior passes,
//! which remain future work.

use noise::{NoiseFn, Perlin};
use wasm_bindgen::prelude::*;

/// Samples a real Perlin-noise heightmap on a `width` x `height` grid,
/// seeded deterministically. Returns a flat row-major array of one height
/// value per cell, in Perlin's native `[-1.0, 1.0]` range. `scale` controls
/// the noise frequency (smaller values produce smoother, larger-scale
/// terrain features).
#[wasm_bindgen]
pub fn generate_heightmap(width: u32, height: u32, seed: u32, scale: f64) -> Vec<f32> {
    let perlin = Perlin::new(seed);
    let mut values = Vec::with_capacity((width * height) as usize);
    for y in 0..height {
        for x in 0..width {
            let sample = perlin.get([x as f64 * scale, y as f64 * scale]);
            values.push(sample as f32);
        }
    }
    values
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_one_value_per_cell_in_range() {
        let values = generate_heightmap(8, 6, 42, 0.15);
        assert_eq!(values.len(), 8 * 6);
        assert!(values.iter().all(|v| v.is_finite() && *v >= -1.0 && *v <= 1.0));
    }

    #[test]
    fn is_deterministic_for_a_given_seed() {
        let a = generate_heightmap(4, 4, 7, 0.2);
        let b = generate_heightmap(4, 4, 7, 0.2);
        assert_eq!(a, b);
    }

    #[test]
    fn differs_across_seeds() {
        let a = generate_heightmap(4, 4, 1, 0.2);
        let b = generate_heightmap(4, 4, 2, 0.2);
        assert_ne!(a, b);
    }
}
