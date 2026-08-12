# `terrain-generation` (`grafting-procgen-terrain-generation`)

Derives `ADR-0022` construction-surface node cycles from a WFC-chosen
terrain module and a `grafting-graph-core::PrismGridMesh` cell -- the
"terrain" half of `docs/architecture/vtt-roadmap.md`'s E3.3, the last
undone piece of Epic 3's map-construction slice. Generation-only: this
crate produces plain `Node`/`Edge`/`SurfaceSpec` data and never mutates a
`Graph` or `SurfaceRegistry` itself.

## Status

V1: `CornerHeightModule` (a flat corner-height profile) only, ported from
`apps/architecture-studio/src/vtt/terrain-modules.ts`'s
`ModuleShape::CornerHeights`. `generate_terrain_cell_surface` reads a
`PrismGridMesh` cell's 8 corner indices, lerps each corner slot's
bottom/top position by the module's per-corner height fraction, and returns
the 4 new nodes, the 4-edge ring, and one `SurfaceSpec` a caller can hand to
`grafting-graph-core::SurfaceRegistry::add_surface` (first creation) or use
as an operand to the existing node operations (an edit).

`bilinear_point` (a full irregular-quad bilinear map, also ported from
`module-placement.ts`) is real, tested infrastructure for a documented
follow-up -- an arbitrary authored-mesh module shape -- not yet called by
`generate_terrain_cell_surface`, since a corner-heights module only ever
samples the 4 exact corners.

No Wasm boundary in this crate yet -- deferred to a separate follow-up task
alongside exposing `grafting-graph-core`'s construction operations to
JS/the Studio brush tool.

## Targets

- `check` -- `cargo check -p grafting-procgen-terrain-generation`
- `test` -- `cargo test -p grafting-procgen-terrain-generation`

Run via Nx: `nx run terrain-generation:check` / `:test`.
