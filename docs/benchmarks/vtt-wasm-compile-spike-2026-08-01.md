# Benchmark: VTT procedural-generation crates on `wasm32-unknown-unknown`

Status: accepted on 2026-08-01. Compile, native-test, and Node-instantiation
validation are complete. This spike does not close any of the VTT map/terrain
research document's open items beyond item 6 itself, and does not promote its
throwaway crate into a real domain crate.

## Objective

`docs/research/vtt-map-and-terrain-construction-options.md`'s own "Recommended
next practical step" section named this as the single cheapest, most
informative action to take before investing in tileset authoring: confirm
that `ghx_proc_gen`, `fast-surface-nets` (crates.io name for the
`fast-surface-nets-rs` GitHub project), `block-mesh` (crates.io name for
`block-mesh-rs`), and `noise` (crates.io name for `noise-rs`) actually compile
to `wasm32-unknown-unknown` and produce correct output when instantiated
outside a native host, mirroring the rigor already established by
`spikes/wasm-worker-nextjs`. `ADR-0016`'s Follow-up work item 1 named this
exact action as runnable independent of that ADR's acceptance; it is
performed here after the ADR was in fact accepted (`DEC-054`), as part of
continuing the owner-approved Architecture Studio expansion plan.

## What exists

A throwaway spike crate at `spikes/vtt-wasm-crate-compile/rust-core/`
(`vtt_wasm_compile_spike`, not a Cargo workspace member — opts out via its own
empty `[workspace]` table, matching the fix `spikes/wasm-worker-nextjs`'s own
crate now also needs against the current root `Cargo.toml`), exposing one
`wasm-bindgen` function per candidate crate, each performing a real,
non-trivial call:

- `spike_noise_sample` — `noise::Perlin::new(seed).get([x, y])`.
- `spike_surface_nets_vertex_count` — `fast_surface_nets::surface_nets` over a
  hand-built sphere SDF on an 18×18×18 `ConstShape3u32` grid.
- `spike_greedy_quads_count` — `block_mesh::greedy_quads` over a solid cube on
  the same grid shape.
- `spike_ghx_grid_node_count` — `ghx_proc_gen::ghx_grid::cartesian::grid::CartesianGrid::new_cartesian_2d`
  (grid types live in the re-exported `ghx_grid` crate, not directly under
  `ghx_proc_gen`, contrary to this spike's first guess).

## Result (observed, not assumed)

All four crates compile to `wasm32-unknown-unknown` and produce correct
output:

- `cargo check` / `cargo test` (native): all 4 unit tests pass, each asserting
  a real, non-placeholder result (finite noise sample; a positive mesh vertex
  count; a positive quad count; the exact expected grid node count).
- `cargo build --target wasm32-unknown-unknown`: succeeds for all four crates
  together, after one real fix (below).
- `wasm-pack build --target web`: succeeds, producing
  `vtt_wasm_compile_spike.js` + `_bg.wasm` + `.d.ts`.
- `node verify-wasm-boundary.mjs` (loads the compiled module directly in Node,
  bypassing `fetch()` for the sibling `.wasm` file exactly as
  `spikes/wasm-worker-nextjs/rust-core/verify-wasm-boundary.mjs` already
  established, since Node's `fetch()` does not support `file://` URLs):

  ```text
  OK: {"spike_ping":1,"spike_noise_sample":-1,"spike_surface_nets_vertex_count":656,"spike_greedy_quads_count":6,"spike_ghx_grid_node_count":16}
  ```

  `spike_greedy_quads_count` returning exactly `6` for a solid cube (one quad
  per face) and `spike_ghx_grid_node_count` returning exactly `16` for a 4×4
  grid are both exact, checkable confirmations that the generated output is
  real, not merely non-crashing.

## The one real fix required

`getrandom` (a transitive dependency pulled in via `rand`, itself pulled in by
`noise` and `ghx_proc_gen`) fails to compile for `wasm32-unknown-unknown` by
default: `compile_error!("the wasm*-unknown-unknown targets are not supported
by default, you may need to enable the \"js\" feature...")`. Fixed by adding
`getrandom` as a direct dependency pinned to the same `0.2` line already
resolved transitively, with its `js` feature enabled — Cargo's feature
unification then applies that feature to the transitive copy too. This is the
same class of fix `libs/isekai/wasm-bridge/Cargo.toml` already applies for its
own `getrandom` dependency (there pinned to the newer `0.4` line with the
renamed `wasm_js` feature, since `getrandom` renamed `js` to `wasm_js` at
0.3). No other fix was required; all four crates' own code compiled cleanly
on the first attempt once this transitive issue was resolved.

## A second, unrelated Cargo-workspace fix discovered along the way

Building any crate under `spikes/` directly (`cd spikes/.../rust-core && cargo
build`) currently fails with "current package believes it's in a workspace
when it's not," because the root `Cargo.toml`'s `[workspace]` table does not
list or exclude `spikes/`. This affects this spike's own crate and, it turns
out, the pre-existing `spikes/wasm-worker-nextjs/rust-core` crate too (tested
directly: same error). Fixed for this spike's own crate by adding an empty
`[workspace]` table to its `Cargo.toml`, per Cargo's own suggested remedy.
`spikes/wasm-worker-nextjs`'s crate was not touched (out of scope for this
task; that spike is disposable and not part of the work requested).

## Disposition

Per master source §26 Step 3, this spike's own code is not meant to become
the foundation directly. It answers the compile-target question the VTT
research document posed. The next task (VTT generation-test surface scaffold)
promotes a small, real subset of this into an actual domain crate wired into
`apps/architecture-studio`; `spikes/vtt-wasm-crate-compile/` can be deleted
once that exists.

## Dependencies exercised (versions as resolved 2026-08-01)

`noise` 0.9.0, `ghx_proc_gen` 0.8.0 (pulls in `ghx_grid` 0.8.0), `fast-surface-nets`
0.2.1, `block-mesh` 0.2.0, `getrandom` 0.2 (`js` feature), `wasm-bindgen`
0.2.126. All dual/either MIT-or-Apache-2.0 licensed, consistent with this
project's closed-source-commercial-sale requirement.
