# `isekai-wasm-bridge` (`grafting-isekai-wasm`)

Wasm bridge exposing `grafting-domain-core` to the Web host, for use
inside a Dedicated Worker (DEC-015). Web-side mirror of
`isekai-capi-bridge`. See `GRAFTING_MASTER_SOURCE.md` S4.2, S9.2, S11.7.

## Current status

D-007 done: `WasmEngine` (a `wasm-bindgen` class holding one
`domain_core::State` + one seeded RNG), `submit_increment` (the same one
concretely-typed real operation as the native side's
`engine_submit_increment` -- not a generic Command/DomainEvent channel;
same DEC-013/FlatBuffers reasoning), a generational `Job`/`Buffer`
`HandleTable` (mirroring `isekai-capi-bridge::handle`, duplicated rather
than shared -- see `src/handle.rs`'s doc comment for why).

D-009 (memory test) done too: one persistent engine driven through 5,000
submit/poll/take/view/release cycles asserts `debug_job_count`/
`debug_buffer_count` (occupied slots) **and** `debug_job_slot_count`/
`debug_buffer_slot_count` (total slots ever allocated -- "arena growth";
a broken free-slot-reuse scan could leave the occupied counts flat while
these still climb) all stay at a constant throughout -- these four
always-present debug accessors, plus a free `debug_memory()` function
(wrapping `wasm_bindgen::memory()`) so a caller can read the module's
`WebAssembly.Memory.buffer.byteLength` directly, exist solely for this.
Wasm linear memory pages obtained via `memory.grow` are never returned to
the browser even after Rust frees what grew them, so the logical
handle-table counts alone can't speak to S19.5's literal "`memory.grow`"
item -- `packages/isekai-web-client/test/browser-check.html` uses
`debug_memory()` to confirm `byteLength` plateaus under repetition
against the real compiled crate, in a real browser.

11 tests total, all passing (5 native `cargo test` for the handle table,
6 `wasm-bindgen-test` for the engine, run via `wasm-pack test --node`).

## The panic-handling difference from the native side is real and load-bearing

Read `src/engine.rs`'s module docs in full before touching this file.
Short version, empirically verified (not assumed) with real
heap-allocating work in both Node and a real headless browser:
`std::panic::catch_unwind` does **not** work on `wasm32-unknown-unknown`
-- a panic traps and surfaces to JS as an uncaught exception.
`wasm-bindgen` itself then marks *only the specific object* that
panicked as permanently unusable (`recursive use of an object detected`)
-- every other `WasmEngine` instance, all unrelated heap allocations, and
the ability to allocate new heap memory all remain completely unaffected.
There is **no Rust-side `Poisoned` enum variant here** (unlike
`isekai-capi-bridge::engine::EngineLifecycle`) -- nothing runs in Rust
after the trap to set one. Classifying "this engine is now dead" happens
in `packages/isekai-web-client`, in JavaScript, by catching the
exception.

This appears to contradict `wasm-bindgen`'s own "hard abort" docs and a
Cloudflare Workers postmortem describing *instance-wide* poisoning --
most likely those describe a different failure category (e.g.
`panic = "abort"`'s default, or an older `wasm-bindgen` version).
Re-verify with the same method (two independent stateful instances, real
heap allocation, one deliberately panicked, checked in both Node and a
real browser) before trusting this design if `wasm-bindgen` is ever
upgraded.

Deliberately not done, and why:

- **No general Command/DomainEvent wire format** -- identical reasoning
  to `isekai-capi-bridge`.
- **No `isekai-web-client`-level testing here** -- the client-facing
  proof (including the panic-isolation finding and the memory test's
  `memory.grow` check, both re-verified against this exact compiled
  crate in a real browser) lives in `packages/isekai-web-client`'s own
  test suite.
- **Device loss / release-after-cancellation** (S19.5, part of the
  memory test's checklist elsewhere) -- no `wgpu::Device` here and
  nothing to cancel with a synchronous backend; both already N/A
  elsewhere for the same reasons.

## Targets

- `check` -- `cargo check -p grafting-isekai-wasm`
- `test` -- `cargo test -p grafting-isekai-wasm && wasm-pack test --node`
- `build` -- `wasm-pack build --target web --out-dir ../../../packages/isekai-wasm/pkg`
  (produces `packages/isekai-wasm/pkg`, gitignored, regenerated on demand)

Run via Nx: `pnpm nx run isekai-wasm-bridge:test`.
