# `terrain-quantization` (`grafting-vtt-terrain-quantization`)

Wasm bridge quantizing a continuous VTT heightmap (as produced by
`@grafting/vtt-generation-wasm`'s `generate_heightmap`) into a discrete
stacked-layer elevation grid.

## Status

Exposes one real function, `quantize_heightmap(heights, levels) ->
Vec<i32>`, linear-binning each continuous `[-1.0, 1.0]` height value into one
of `levels` discrete integer elevation bands. This is pipeline step 3 only
("Quantization into the discrete grid") from
`docs/research/vtt-map-and-terrain-construction-options.md`'s end-to-end
pipeline section -- the terrain-WFC tileset pass, water-mask integration,
and building/interior passes are future work, tracked by that document's
open items, not this crate.

## Targets

- `check` -- `cargo check -p grafting-vtt-terrain-quantization`
- `test` -- `cargo test -p grafting-vtt-terrain-quantization`

Run via Nx: `nx run terrain-quantization:check` / `:test`.

## Wasm bindings (DEC-055/ADR-0017)

This crate is also a normal pnpm workspace package (`package.json`
co-located right here, name `@grafting/vtt-terrain-quantization`) -- not a
separate `packages/` technical package. Its `postinstall` script runs
`wasm-pack build --target web --out-dir pkg`, so a plain `pnpm install`
already regenerates `pkg/` (gitignored). There is no separate
`vtt-terrain-quantization-package` project.

## Consumer

`apps/architecture-studio`'s `/lab/terrain-quantization` route depends on
`@grafting/vtt-terrain-quantization` as a normal `workspace:*` dependency
and imports it directly in its Dedicated Worker, alongside
`@grafting/vtt-generation-wasm`.
