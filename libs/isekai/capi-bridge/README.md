# `isekai-capi-bridge` (`grafting-isekai-capi`)

Versioned C ABI exposing `grafting-domain-core` to native hosts (C#,
generic P/Invoke). See `GRAFTING_MASTER_SOURCE.md` S4.2, S11, S12.

## Current status

D-001 through D-005 done: `EngineAbiInfo` (scoped-down v1, see below),
kind-tagged generational handles (`Engine`/`Job`/`Buffer`), explicit
engine lifecycle (`Creating`/`Ready`/`ShuttingDown`/`Destroyed`/`Poisoned`
-- not a mutex-poison-recovery stand-in), buffer lease
(`OwnedByRust`/`ViewLeased`/`Released`), and one real operation,
`engine_submit_increment`, wrapping real `grafting-domain-core` logic
(`apply_command` + `state_hash`).

D-009 (memory test) done too: a persistent engine driven through 5,000
submit/poll/take/view/release cycles asserts both `HandleTable::len()`
(occupied slots -- a plain leak) and `HandleTable::slot_count()` (total
slots ever allocated -- "arena growth"; a broken free-slot-reuse scan
could leave `len()` flat while this still climbs) stay at a constant
1 throughout. A separate test proves the same for repeated engine
create+destroy -- deliberately against a local, non-shared `HandleTable`
rather than the real `registry()`, since every test in this module
shares that one process-wide static and `cargo test` runs them in
parallel; an earlier version of this test asserted against `registry()`
directly and failed intermittently for exactly that reason (several
sibling smoke tests deliberately never destroy the engine they create).
Two new debug exports, `engine_debug_job_count`/`engine_debug_buffer_count`,
exist solely so `Grafting.Isekai.Interop.Tests`' finalizer test can
observe whether a forgotten `Dispose()` really released the native
handle. 25 tests total, all passing.

### Why `engine_submit_increment`, not a generic `engine_submit(bytes)`

Master source S11.6's conceptual API has one generic entry point. Building
it for real means picking a byte layout for `Command`/`DomainEvent` --
both are named for FlatBuffers by S10.1 (`DEC-013`, `LOCKED`), and
`flatc` isn't wired up yet (C-005/C-006 blocked on B-004). A hand-rolled
"temporary" codec for them would repeat a mistake already made and
reversed once in this repo (`domain-core`'s `Snapshot`, which briefly
used `serde_json` -- see `libs/engine/domain-core/src/snapshot.rs`).
Instead, this v1 exposes exactly one concretely-typed real operation. The
generic `engine_submit` arrives once C-005/C-006 land.

### Scoped-down `EngineAbiInfo` (D-001)

S12.3 asks for build ID, target, and async-support signaling in addition
to what's here (`struct_size`, `abi_major`, `abi_minor`, `feature_flags`,
`protocol_version`). Not included as struct fields yet -- no build
pipeline produces a build ID, no cross-target matrix exists. A smaller
v1, documented as such.

### Panic handling (S12.5)

Only the domain-logic call is wrapped in `catch_unwind`; the registry
`MutexGuard` lives in an outer scope the panic never unwinds through, so
the registry mutex is never poisoned by a domain-logic panic. On a caught
panic, the specific engine's lifecycle is set to `Poisoned` explicitly and
every subsequent call on that handle is refused -- unlike
`spikes/rust-capi-dotnet`'s mutex-poison recover-and-continue shortcut
(that spike's own README already flags it as "not the intended production
design"). `engine_debug_trigger_panic` exists solely to test this path.

Deliberately not done, and why:

- **`isekai-wasm`/`isekai-web-client`** (D-007/D-008) -- a different
  technical surface (Wasm/wasm-bindgen vs. this crate's native
  cdylib/P-Invoke); see `isekai-wasm-bridge/README.md` for its own,
  separately-verified memory test.
- **No `ProblemHandle`/resident state** (S13.6) -- same call as Epic E's
  deferral; nothing resident to manage yet.
- **No general Command/DomainEvent wire format** -- see above.
- **Device loss / release-after-cancellation** (S19.5) -- no
  `wgpu::Device` here and nothing to cancel with a synchronous backend;
  both already N/A elsewhere for the same reasons, not re-litigated by
  the memory test.

## Targets

- `check` -- `cargo check -p grafting-isekai-capi`
- `test` -- `cargo test -p grafting-isekai-capi`
- `build` -- `cargo build --release -p grafting-isekai-capi` (produces
  `target/release/grafting_isekai_capi.dll`, consumed by
  `dotnet/Grafting.Isekai.Interop`)

Run via Nx: `nx run isekai-capi-bridge:test`.
