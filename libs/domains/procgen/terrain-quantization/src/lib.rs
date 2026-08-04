//! Wasm bridge quantizing a continuous heightmap (as produced by
//! `grafting-procgen-generation-wasm`'s `generate_heightmap`) into a
//! discrete stacked-layer elevation grid, as a generic, shareable domain
//! capability. This is pipeline step 3 only ("Quantization into the
//! discrete grid", per
//! `docs/research/vtt-map-and-terrain-construction-options.md`'s end-to-end
//! pipeline section, which designed this capability for the VTT product
//! first) -- not the terrain-WFC tileset pass, water-mask integration, or
//! any other future step, which remain separate future crates.

use wasm_bindgen::prelude::*;

/// Quantizes each cell of a continuous heightmap (expected in
/// `generate_heightmap`'s native `[-1.0, 1.0]` range) into one of `levels`
/// discrete integer elevation bands via linear binning. Values outside
/// `[-1.0, 1.0]` are clamped rather than producing an out-of-range level.
/// `levels` must be at least 1; a `levels` of 1 quantizes every cell to
/// level 0.
#[wasm_bindgen]
pub fn quantize_heightmap(heights: Vec<f32>, levels: u32) -> Vec<i32> {
    let levels = levels.max(1);
    heights.iter().map(|&h| quantize_one(h, levels)).collect()
}

fn quantize_one(height: f32, levels: u32) -> i32 {
    let clamped = height.clamp(-1.0, 1.0);
    let normalized = (clamped + 1.0) / 2.0;
    let level = (normalized * levels as f32).floor() as i32;
    level.clamp(0, levels as i32 - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn min_value_quantizes_to_level_zero() {
        assert_eq!(quantize_heightmap(vec![-1.0], 8), vec![0]);
    }

    #[test]
    fn max_value_quantizes_to_top_level() {
        assert_eq!(quantize_heightmap(vec![1.0], 8), vec![7]);
    }

    #[test]
    fn is_monotonic_non_decreasing_for_increasing_input() {
        let input: Vec<f32> = (0..=20).map(|i| -1.0 + i as f32 * 0.1).collect();
        let output = quantize_heightmap(input, 5);
        for pair in output.windows(2) {
            assert!(pair[0] <= pair[1]);
        }
    }

    #[test]
    fn is_deterministic_for_the_same_input() {
        let input = vec![-0.4, 0.0, 0.6, 1.0];
        let a = quantize_heightmap(input.clone(), 6);
        let b = quantize_heightmap(input, 6);
        assert_eq!(a, b);
    }

    #[test]
    fn output_length_matches_input_length() {
        let input = vec![0.1_f32; 17];
        let output = quantize_heightmap(input, 4);
        assert_eq!(output.len(), 17);
    }
}
