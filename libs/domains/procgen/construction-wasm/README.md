# `construction-wasm` (`grafting-procgen-construction-wasm`)

Wasm bridge exposing `grafting-graph-core`'s construction operations
(`move_node`/`delete_node`/`merge_surfaces`/`split_surface`/`duplicate_surface`)
and the `grafting-procgen-terrain-generation`/`grafting-procgen-structure-generation`
crates' pure generators as one stateful `ConstructionSession` for the Web
host -- born under `libs/domains/procgen` per `GRAFTING_MASTER_SOURCE.md`
§4.4 (DEC-046, routed to `docs/architecture/boundaries.md`), since none of
the three wrapped inputs are VTT- or Architecture-Studio-exclusive. This is
`docs/architecture/vtt-roadmap.md` E3.3's WASM-bindings follow-up.

## Status

`ConstructionSession` owns one live `Graph<[f32; 3], ()>` + `SurfaceRegistry`
(+ an optional `PrismGridMesh` set via `set_terrain_mesh`) across a whole
editing session. Exposes bootstrapping (`add_node_json`/`add_edge_json`/
`add_surface_json`), all five construction operations
(`move_node_json`/`delete_node_json`/`merge_surfaces_json`/
`split_surface_json`/`duplicate_surface_json`), two atomic
generate-and-apply methods (`generate_and_apply_terrain_cell_json`/
`generate_and_apply_wall_json`), and `snapshot_json` for read-back. Every
method takes/returns a JSON string, following
`libs/isekai/wasm-bridge/src/graph_evaluation.rs`'s established
`NodeId`/`EdgeId`-crossing pattern -- never passing a graph identifier
directly across the boundary.

This crate performs no generation or construction logic of its own -- it is
pure wiring over three already-tested, already-merged Rust crates. Compiles
to `wasm32-unknown-unknown`, verified via the same pattern already proven by
`docs/benchmarks/vtt-wasm-compile-spike-2026-08-01.md`.

## Targets

- `check` -- `cargo check -p grafting-procgen-construction-wasm`
- `test` -- `cargo test -p grafting-procgen-construction-wasm && wasm-pack test --node libs/domains/procgen/construction-wasm`

Run via Nx: `nx run construction-wasm:check` / `:test`.

## Wasm bindings (DEC-055/ADR-0017)

This crate is also a normal pnpm workspace package (`package.json`
co-located right here, name `@grafting/procgen-construction-wasm`) -- not a
separate `packages/` technical package. Its `postinstall` script runs
`wasm-pack build --target web --out-dir pkg`, so a plain `pnpm install`
already regenerates `pkg/` (gitignored).

## Consumer

None yet. Building an `apps/architecture-studio`/`apps/vtt` consumer is a
separate, future task -- this crate only establishes the API to build
against. `apps/architecture-studio`'s `/lab/heightmap` route (Dedicated
Worker calling `@grafting/procgen-generation-wasm`) is the closest existing
precedent for how a future consumer would load this crate's `pkg/` output,
though a stateful `ConstructionSession` would live inside one long-lived
Worker rather than being constructed per call.
