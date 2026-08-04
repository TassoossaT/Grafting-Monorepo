# `terrain-quantization` (`grafting-procgen-terrain-quantization`)

Wasm bridge quantizing a continuous heightmap (as produced by
`@grafting/procgen-generation-wasm`'s `generate_heightmap`) into a discrete
stacked-layer elevation grid -- a generic, shareable domain capability, born
under `libs/domains/procgen` per `GRAFTING_MASTER_SOURCE.md` §4.4 (DEC-046)
rather than inside any one product.

## Status

Exposes one real function, `quantize_heightmap(heights, levels) ->
Vec<i32>`, linear-binning each continuous `[-1.0, 1.0]` height value into one
of `levels` discrete integer elevation bands. This is pipeline step 3 only
("Quantization into the discrete grid") from
`docs/research/vtt-map-and-terrain-construction-options.md`'s end-to-end
pipeline section -- that document designed this capability for the VTT
product first, but quantizing a heightmap into discrete elevation bands is a
generic operation any consumer of heightmap data could need; the terrain-WFC
tileset pass, water-mask integration, and building/interior passes are
future work, tracked by that document's open items, not this crate.

## Targets

- `check` -- `cargo check -p grafting-procgen-terrain-quantization`
- `test` -- `cargo test -p grafting-procgen-terrain-quantization`

Run via Nx: `nx run terrain-quantization:check` / `:test`.

## Wasm bindings (DEC-055/ADR-0017)

This crate is also a normal pnpm workspace package (`package.json`
co-located right here, name `@grafting/procgen-terrain-quantization`) -- not
a separate `packages/` technical package. Its `postinstall` script runs
`wasm-pack build --target web --out-dir pkg`, so a plain `pnpm install`
already regenerates `pkg/` (gitignored). There is no separate
`procgen-terrain-quantization-package` project.

## Consumer

`apps/architecture-studio`'s `/lab/terrain-quantization` route depends on
`@grafting/procgen-terrain-quantization` as a normal `workspace:*`
dependency and imports it directly in its Dedicated Worker, alongside
`@grafting/procgen-generation-wasm`. Any other product needing to quantize a
heightmap can depend on this crate the same way.
