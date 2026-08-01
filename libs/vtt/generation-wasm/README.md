# `generation-wasm` (`grafting-vtt-generation-wasm`)

Wasm bridge exposing a small, real VTT procedural-generation slice
(noise-backed heightmap) to the Architecture Studio's VTT generation-test
surface; not the full Townscaper-style generation pipeline.

## Status

Exposes one real function, `generate_heightmap(width, height, seed, scale) ->
Vec<f32>`, sampling `noise`'s `Perlin` on a grid. This is pipeline step 1 only
(the continuous heightmap seed) from
`docs/research/vtt-map-and-terrain-construction-options.md`'s end-to-end
pipeline section — terrain quantization, water, WFC exterior/interior passes
are future work, tracked by that document's open items, not this crate.

Compiles to `wasm32-unknown-unknown`, verified via the same pattern already
proven by `docs/benchmarks/vtt-wasm-compile-spike-2026-08-01.md`.

## Targets

- `check` -- `cargo check -p grafting-vtt-generation-wasm`
- `test` -- `cargo test -p grafting-vtt-generation-wasm`
- `build` -- `wasm-pack build --target web --out-dir ../../../packages/vtt-generation-wasm/pkg libs/vtt/generation-wasm`

Run via Nx: `pnpm exec nx run generation-wasm:check` / `:test` / `:build`.

## Consumer

`apps/architecture-studio`'s `/vtt-generation` route (via
`packages/vtt-generation-wasm`, the generated npm wrapper around this
crate's `wasm-pack` output) — the same static-asset-plus-Dedicated-Worker
pattern already used for the Graph IR explorer's layout worker.
