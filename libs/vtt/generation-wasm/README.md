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

Run via Nx: `nx run generation-wasm:check` / `:test`.

## Wasm bindings (DEC-055/ADR-0017)

This crate is also a normal pnpm workspace package (`package.json`
co-located right here, name `@grafting/vtt-generation-wasm`) -- not a
separate `packages/` technical package. Its `postinstall` script runs
`wasm-pack build --target web --out-dir pkg`, so a plain `pnpm install`
already regenerates `pkg/` (gitignored). There is no separate
`vtt-generation-wasm-package` project.

## Consumer

`apps/architecture-studio`'s `/vtt-generation` route depends on
`@grafting/vtt-generation-wasm` as a normal `workspace:*` dependency and
imports it directly in its Dedicated Worker.
