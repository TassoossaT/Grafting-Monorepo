# AGENTS.md -- `grafting-procgen-construction-wasm`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

This crate is a Wasm bridge only, mirroring `libs/isekai/wasm-bridge`'s and
`libs/domains/procgen/generation-wasm`'s own boundary discipline: it exposes
a thin, JSON-request/response ABI over `grafting-graph-core`'s construction
operations (`move_node`/`delete_node`/`merge_surfaces`/`split_surface`/
`duplicate_surface`) and `grafting-procgen-terrain-generation`'s/
`grafting-procgen-structure-generation`'s pure generators, wired into one
stateful `ConstructionSession`. It must not grow new domain logic of its
own -- every mutation this crate performs is an existing, already-tested
Rust function call; if a new construction rule is needed, it belongs in
`grafting-graph-core`, not here.

`generate_and_apply_terrain_cell`/`generate_and_apply_wall` call a pure
generation function then apply its result to the session's own live
`Graph`/`SurfaceRegistry` in one call. This does not violate
`terrain-generation`'s/`structure-generation`'s own "never mutates a graph"
rule -- that rule is about the generation crate itself, not about every
possible caller; applying a generation crate's output is exactly the
"future orchestration layer" both of those crates' `AGENTS.md`s already
name. This crate reproduces `duplicate_surface`'s validate-before-mutate
discipline by hand for each `generate_and_apply_*` operation (pre-checking
every new node/edge id is free, including cross-piece jamb-node dedup for
`generate_and_apply_wall`) before committing anything, since no single
`grafting-graph-core` primitive already provides that atomicity for a
multi-node/multi-edge/multi-surface generation result.

`WallNodeRole`'s wire representation is a hand-written `wire_name()` match,
never `{:?}` -- a `Debug`-derived string would silently change the JSON
contract if a variant were ever renamed.

Panics are not catchable on `wasm32-unknown-unknown` (no `catch_unwind`),
the same constraint `libs/isekai/wasm-bridge/AGENTS.md` and
`libs/domains/procgen/generation-wasm/AGENTS.md` already document --
validate inputs at the JSON-parsing boundary rather than relying on panic
recovery.

Out of scope, deliberately: no `apps/architecture-studio`/`apps/vtt` UI
wiring (a future task, zero existing frontend expectation), no persistence
(`ConstructionSession` is in-memory only -- `E1.5`/`ADR-0022`'s "Migration
or rollback" section removed `map_state.fbs` and explicitly deferred any
replacement wire contract to its first real persistence consumer, not this
crate).

Lives under `libs/domains/procgen` (DEC-046, `docs/architecture/boundaries.md`
§4.4, routed from `GRAFTING_MASTER_SOURCE.md`): two of its three wrapped
inputs already live there, and none of the three (`grafting-graph-core`'s
construction ops, terrain-generation, structure-generation) are VTT- or
Architecture-Studio-exclusive.

Per DEC-055/ADR-0017: `pkg/` (this crate's own `wasm-pack` output) is
gitignored and MUST NOT be committed. Do not reintroduce a separate
`packages/procgen-construction-wasm` technical package.
