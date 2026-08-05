# `discretize` (`grafting-procgen-discretize`)

Wasm bridge discretizing an arbitrary continuous `[-1.0, 1.0]` float array
into `N` discrete integer levels via linear binning -- a generic, shareable
domain capability, born under `libs/domains/procgen` per
`GRAFTING_MASTER_SOURCE.md` §4.4 (DEC-046) rather than inside any one
product. Not terrain- or heightmap-specific: this crate has no concept of a
"terrain" or a "heightmap" -- it only knows about continuous values and
levels.

## Status

Exposes one real function, `discretize(values, levels) -> Vec<i32>`,
linear-binning each continuous `[-1.0, 1.0]` value into one of `levels`
discrete integer bands. Its first real consumer is the VTT map-generation
pipeline's step 3 ("Quantization into the discrete grid") from
`docs/research/vtt-map-and-terrain-construction-options.md`'s end-to-end
pipeline section, quantizing `@grafting/procgen-generation-wasm`'s heightmap
output -- but any consumer needing to bucket a continuous signal into
discrete levels (data-viz bucketing, LOD, posterization) can depend on this
crate the same way. The terrain-WFC tileset pass, water-mask integration,
and building/interior passes described in that research document are future
work, tracked by that document's open items, not this crate.

## Targets

- `check` -- `cargo check -p grafting-procgen-discretize`
- `test` -- `cargo test -p grafting-procgen-discretize`

Run via Nx: `nx run discretize:check` / `:test`.

## Wasm bindings (DEC-055/ADR-0017)

This crate is also a normal pnpm workspace package (`package.json`
co-located right here, name `@grafting/procgen-discretize`) -- not a
separate `packages/` technical package. Its `postinstall` script runs
`wasm-pack build --target web --out-dir pkg`, so a plain `pnpm install`
already regenerates `pkg/` (gitignored). There is no separate
`procgen-discretize-package` project.

## Consumer

`apps/architecture-studio`'s `/lab/terrain-quantization` route depends on
`@grafting/procgen-discretize` as a normal `workspace:*` dependency and
imports it directly in its Dedicated Worker, alongside
`@grafting/procgen-generation-wasm`, to quantize a heightmap as one concrete
use of this crate's generic capability.
