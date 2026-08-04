//! Wasm bridge discretizing an arbitrary continuous `[-1.0, 1.0]` float
//! array into `N` discrete integer levels via linear binning, as a generic,
//! shareable domain capability. Not terrain- or heightmap-specific: any
//! continuous signal in that range (a heightmap, a data-viz value to
//! bucket, an LOD distance, a signal to posterize) can consume it. Its
//! first real consumer is the VTT map-generation pipeline's step 3
//! ("Quantization into the discrete grid", per
//! `docs/research/vtt-map-and-terrain-construction-options.md`'s end-to-end
//! pipeline section), quantizing `grafting-procgen-generation-wasm`'s
//! heightmap output -- but that is one consumer, not this crate's identity.

use wasm_bindgen::prelude::*;

/// Discretizes each value of a continuous `[-1.0, 1.0]` array into one of
/// `levels` discrete integer bands via linear binning. Values outside
/// `[-1.0, 1.0]` are clamped rather than producing an out-of-range level.
/// `levels` must be at least 1; a `levels` of 1 maps every value to level 0.
#[wasm_bindgen]
pub fn discretize(values: Vec<f32>, levels: u32) -> Vec<i32> {
    let levels = levels.max(1);
    values.iter().map(|&v| discretize_one(v, levels)).collect()
}

fn discretize_one(value: f32, levels: u32) -> i32 {
    let clamped = value.clamp(-1.0, 1.0);
    let normalized = (clamped + 1.0) / 2.0;
    let level = (normalized * levels as f32).floor() as i32;
    level.clamp(0, levels as i32 - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn min_value_maps_to_level_zero() {
        assert_eq!(discretize(vec![-1.0], 8), vec![0]);
    }

    #[test]
    fn max_value_maps_to_top_level() {
        assert_eq!(discretize(vec![1.0], 8), vec![7]);
    }

    #[test]
    fn is_monotonic_non_decreasing_for_increasing_input() {
        let input: Vec<f32> = (0..=20).map(|i| -1.0 + i as f32 * 0.1).collect();
        let output = discretize(input, 5);
        for pair in output.windows(2) {
            assert!(pair[0] <= pair[1]);
        }
    }

    #[test]
    fn is_deterministic_for_the_same_input() {
        let input = vec![-0.4, 0.0, 0.6, 1.0];
        let a = discretize(input.clone(), 6);
        let b = discretize(input, 6);
        assert_eq!(a, b);
    }

    #[test]
    fn output_length_matches_input_length() {
        let input = vec![0.1_f32; 17];
        let output = discretize(input, 4);
        assert_eq!(output.len(), 17);
    }
}
