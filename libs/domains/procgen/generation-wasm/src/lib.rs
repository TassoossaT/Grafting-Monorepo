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

/// The largest `scale` that can still resolve the noise it samples.
///
/// Perlin's gradient lattice has period 1.0 on each axis, and `scale` is the
/// step between samples in that space, so a step of 0.5 is already the Nyquist
/// limit: two samples per feature. At or above it the returned grid is not a
/// coarser heightmap, it is an aliased one, and the failure is quiet rather
/// than obvious.
///
/// A whole-number `scale` is the degenerate case of this. Gradient noise is
/// exactly zero at every integer lattice point, so a whole-number step lands
/// *every* sample on one and the entire grid comes back as zeros -- a
/// perfectly flat map from a function that looks like it succeeded. That is a
/// real bug this crate shipped into two consumers before it was caught, which
/// is why the limit is enforced here rather than only documented.
pub const MAX_SCALE: f64 = 0.5;

/// The largest grid this crate will allocate, 4096 x 4096.
///
/// At four bytes per sample that is a 64 MiB result, which is already generous
/// for a heightmap seed and stays well inside `wasm32`'s address space.
pub const MAX_CELLS: u64 = 4096 * 4096;

/// Samples a real Perlin-noise heightmap on a `width` x `height` grid,
/// seeded deterministically. Returns a flat row-major array of one height
/// value per cell, in Perlin's native `[-1.0, 1.0]` range.
///
/// `scale` is the distance between samples in the noise's own space, so
/// **smaller** values produce smoother, larger-scale terrain features. It must
/// be finite and lie in `(0, MAX_SCALE)`; useful values are well below the
/// limit, around `0.05` to `0.2`. See [`MAX_SCALE`] for why anything at or
/// above it cannot return usable terrain.
///
/// # Errors
///
/// Returns a `JsValue` error, surfacing as a thrown exception in JavaScript,
/// when `scale` is out of range or the requested grid does not fit in memory.
/// Validation happens here because panics are not catchable on
/// `wasm32-unknown-unknown`, so an invalid argument would otherwise abort the
/// caller's worker instead of rejecting.
#[wasm_bindgen]
pub fn generate_heightmap(
    width: u32,
    height: u32,
    seed: u32,
    scale: f64,
) -> Result<Vec<f32>, JsValue> {
    let cells = validate(width, height, scale).map_err(|message| JsValue::from_str(&message))?;

    let perlin = Perlin::new(seed);
    let mut values = Vec::with_capacity(cells);
    for y in 0..height {
        for x in 0..width {
            let sample = perlin.get([x as f64 * scale, y as f64 * scale]);
            values.push(sample as f32);
        }
    }
    Ok(values)
}

/// Boundary validation.
///
/// Reports failures as `String` rather than `JsValue` so that it can be tested
/// natively: constructing a `JsValue` off `wasm32` aborts the process, and an
/// abort is not something a test can assert against.
fn validate(width: u32, height: u32, scale: f64) -> Result<usize, String> {
    if !scale.is_finite() || scale <= 0.0 {
        return Err("generate_heightmap: scale must be a finite number greater than 0".to_owned());
    }
    if scale >= MAX_SCALE {
        return Err(format!(
            "generate_heightmap: scale {scale} is at or above the Nyquist limit of {MAX_SCALE}; \
             the result would be aliased, and a whole-number scale returns an all-zero grid. \
             Use a value well below it, around 0.05 to 0.2",
        ));
    }

    // An explicit cap rather than an overflow check: `usize` is 64-bit on the
    // native test target and 32-bit on `wasm32`, so a check that overflows in
    // the browser passes silently in `cargo test`. The allocation that matters
    // is the same size on both.
    let cells = (width as u64) * (height as u64);
    if cells > MAX_CELLS {
        return Err(format!(
            "generate_heightmap: {width}x{height} is {cells} cells, above the limit of {MAX_CELLS}",
        ));
    }
    Ok(cells as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_one_value_per_cell_in_range() {
        let values = generate_heightmap(8, 6, 42, 0.15).expect("0.15 is a valid scale");
        assert_eq!(values.len(), 8 * 6);
        assert!(values.iter().all(|v| v.is_finite() && *v >= -1.0 && *v <= 1.0));
    }

    #[test]
    fn is_deterministic_for_a_given_seed() {
        let a = generate_heightmap(4, 4, 7, 0.2).expect("0.2 is a valid scale");
        let b = generate_heightmap(4, 4, 7, 0.2).expect("0.2 is a valid scale");
        assert_eq!(a, b);
    }

    #[test]
    fn differs_across_seeds() {
        let a = generate_heightmap(4, 4, 1, 0.2).expect("0.2 is a valid scale");
        let b = generate_heightmap(4, 4, 2, 0.2).expect("0.2 is a valid scale");
        assert_ne!(a, b);
    }

    #[test]
    fn rejects_a_whole_number_scale() {
        // The case that motivated the guard: every sample lands on an integer
        // lattice point, where gradient noise is exactly zero, so the caller
        // gets a flat map back with no indication anything went wrong.
        for scale in [1.0, 2.0, 3.0] {
            assert!(validate(16, 16, scale).is_err(), "scale {scale} should be rejected");
        }
    }

    #[test]
    fn rejects_scale_at_or_above_the_nyquist_limit() {
        assert!(validate(4, 4, MAX_SCALE).is_err());
        assert!(validate(4, 4, 3.5).is_err());
        assert!(validate(4, 4, 0.49).is_ok());
    }

    #[test]
    fn rejects_a_scale_that_is_not_a_positive_finite_number() {
        assert!(validate(4, 4, 0.0).is_err());
        assert!(validate(4, 4, -0.1).is_err());
        assert!(validate(4, 4, f64::NAN).is_err());
        assert!(validate(4, 4, f64::INFINITY).is_err());
    }

    #[test]
    fn a_permitted_scale_still_varies_across_the_grid() {
        // The guard is only worth having if what it lets through is usable, so
        // this asserts the property the rejected values fail to have.
        let values = generate_heightmap(16, 16, 1, 0.15).expect("0.15 is a valid scale");
        let first = values[0];
        assert!(
            values.iter().any(|v| (v - first).abs() > 1e-6),
            "a permitted scale must not produce a constant grid",
        );
    }

    #[test]
    fn rejects_a_grid_too_large_to_allocate() {
        assert!(validate(u32::MAX, u32::MAX, 0.1).is_err());
        assert!(validate(65536, 65536, 0.1).is_err());
        assert!(validate(4096, 4096, 0.1).is_ok());
    }
}
