# `generation-wasm` (`grafting-procgen-generation-wasm`)

Wasm bridge exposing a small, real procedural-generation slice (noise-backed
heightmap) as a generic, shareable domain capability -- born under
`libs/domains/procgen` per `GRAFTING_MASTER_SOURCE.md` §4.4 (DEC-046) rather
than inside any one product, since heightmap generation is not exclusive to
one consumer. Not the full Townscaper-style generation pipeline.

## Status

Exposes one real function, `generate_heightmap(width, height, seed, scale) ->
Result<Vec<f32>, JsValue>`, sampling `noise`'s `Perlin` on a grid. This is
pipeline step 1 only
(the continuous heightmap seed) from
`docs/research/vtt-map-and-terrain-construction-options.md`'s end-to-end
pipeline section -- that document designed this capability for the VTT
product first, but the capability itself is generic (any consumer needing a
noise-backed heightmap can depend on it); terrain quantization, water, WFC
exterior/interior passes are future work, tracked by that document's open
items, not this crate.

Compiles to `wasm32-unknown-unknown`, verified via the same pattern already
proven by `docs/benchmarks/vtt-wasm-compile-spike-2026-08-01.md`.

## The `scale` range is enforced, not merely suggested

`scale` is the distance between samples in the noise's own space, so **smaller
values give smoother, larger-scale features**. Perlin's gradient lattice has
period 1.0, which makes 0.5 the Nyquist limit: at or above it the grid is
aliased rather than coarse. A **whole-number** `scale` is the degenerate case —
gradient noise is exactly zero at every integer lattice point, so every sample
lands on one and the whole grid comes back as zeros, a perfectly flat map from
a call that looks like it succeeded.

That is not hypothetical: it shipped into two Architecture Studio trials whose
sliders offered only whole and half steps, and it read as "the terrain only
changes at .5 values". `generate_heightmap` now rejects anything at or above
`MAX_SCALE`, along with non-finite, zero, and negative values, and grids above
`MAX_CELLS`. Useful values sit around 0.05 to 0.2.

Validation is at the boundary because panics are not catchable on
`wasm32-unknown-unknown` (see this crate's `AGENTS.md`), so the error surfaces
as a thrown JavaScript exception the calling worker can report.

## Targets

- `check` -- `cargo check -p grafting-procgen-generation-wasm`
- `test` -- `cargo test -p grafting-procgen-generation-wasm`

Run via Nx: `nx run generation-wasm:check` / `:test`.

## Wasm bindings (DEC-055/ADR-0017)

This crate is also a normal pnpm workspace package (`package.json`
co-located right here, name `@grafting/procgen-generation-wasm`) -- not a
separate `packages/` technical package. Its `postinstall` script runs
`wasm-pack build --target web --out-dir pkg`, so a plain `pnpm install`
already regenerates `pkg/` (gitignored). There is no separate
`procgen-generation-wasm-package` project.

## Consumer

`apps/architecture-studio`'s `/lab/heightmap` route depends on
`@grafting/procgen-generation-wasm` as a normal `workspace:*` dependency and
imports it directly in its Dedicated Worker. Any other product needing a
procedural heightmap seed can depend on this crate the same way -- it is not
gated to Architecture Studio or the VTT.
