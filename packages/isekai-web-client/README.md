# `@grafting/isekai-web-client`

Idiomatic Worker/Promise wrapper over `@grafting/isekai-wasm` (master
source S9.3). Never exposes memory offsets/handles to callers.

## Current status

D-008 done: `IsekaiEngine` -- `create(seed)` spawns one Dedicated Worker
owning exactly one `WasmEngine` (**one Worker = one Engine is this
package's own V1 scope decision**, not an `isekai-wasm` limitation --
the Rust crate itself supports multiple instances, proven by its own
cross-instance test); `increment(amount)` is one `postMessage` round trip
= one `Promise` (S9.3); `terminate()`. Transferables: `stateHash`'s bytes
are transferred, not copied, back to the main thread.

Two distinct failure paths, both documented in `src/worker.ts` and
`src/index.ts`:

- **Per-object poisoning** (a Wasm panic, or any other thrown exception
  from a `WasmEngine` call -- the Worker doesn't try to distinguish them,
  see `src/worker.ts`'s module docs for why that's a safe, deliberate
  simplification): caught inside the Worker's normal message handler,
  reported back as a clean `EngineError` with `poisoned: true`. Other
  `IsekaiEngine` instances (even in other Workers, or the underlying Wasm
  module more broadly) are unaffected.
- **Worker crash** (S14.1/S19.5: an *unexpected* failure outside the
  normal message protocol): `worker.onerror` rejects every outstanding
  `Promise` and marks this client dead.

Both end the same way: create a fresh `IsekaiEngine` for a working
client.

D-009 (memory test) done too: `test/browser-check.html` now also proves
the "target scenario" (many repeated `increment()` cycles, not just one)
stays leak-free -- both the mechanism (calling `@grafting/isekai-wasm`
directly, checking its debug handle/slot counts and its linear memory's
`byteLength` plateau) and the real production path (`IsekaiEngine.increment()`
through the Worker, 2,000 cycles), plus 30 repeated `create()`+`terminate()`
cycles proving no state bleeds across Worker instances. See
`isekai-wasm-bridge/README.md` for what the underlying debug accessors
prove and why. Whether the browser actually reclaims a terminated
Worker's OS memory is a browser-engine guarantee this test page has no
reliable, non-experimental JS API to check -- flagged, not verified here.

## Testing

- `pnpm test` (Vitest, Node environment) -- only what doesn't need a real
  Worker (e.g. seed-length validation, `EngineError`'s shape). Node has
  no global `Worker` matching the browser API this package targets, so
  Vitest's default environment can't exercise the real integration.
- **The real proof** -- `test/browser-check.html`, served with real
  module resolution via Vite and checked in an actual (headless) browser,
  same methodology already established for spikes 1/3 in this repo:

  ```bash
  pnpm exec vite --port 4900   # from this package's directory
  # open http://localhost:4900/test/browser-check.html
  ```

  Verified end to end (2026-07-28, D-007/D-008): a panic in one
  `WasmEngine` (via the crate's own `debug_trigger_panic`, called
  directly against `@grafting/isekai-wasm` to test the empirical finding
  against the real compiled crate, not just the throwaway scratch probe
  that first established it) leaves an unrelated, independently-created
  engine fully correct and usable; the poisoned engine itself is
  confirmed unusable afterward; a normal `increment` round trip, an
  overflow rejection (`poisoned: false` -- confirmed distinct from real
  poisoning), and a fresh engine after `terminate()` all behave
  correctly.

  Extended and re-verified end to end (2026-07-28, D-009): 2,000
  submit/poll/take/view/release cycles direct against `WasmEngine` leave
  its debug job/buffer counts and slot counts unchanged at their
  baseline every cycle, and the module's `WebAssembly.Memory.buffer.byteLength`
  (via `debug_memory()`) plateaus rather than growing; 2,000
  `IsekaiEngine.increment()` cycles through the real Worker/production
  API produce the correct final value; 30 `create()`+`terminate()`
  cycles each work correctly and reject a call made after their own
  `terminate()`.

Deliberately not automated in this pass: the Worker-crash (`onerror`)
path is implemented (`src/index.ts`) but not exercised by an automated
test here -- its logic is simple enough to review directly; flagged as a
gap, not silently skipped.

## Not applicable yet, flagged not hidden

- Device-loss handling -- no `wgpu::Device` in this Worker yet (PROV-006
  still open, per `spikes/wgpu-native-web/README.md`'s own disposition).
- Cooperative mid-flight cancellation -- `increment` completes in
  microseconds; nothing to interrupt. `JobStateCode.Cancelled` stays part
  of the shared vocabulary, unreachable here (same pattern as
  `engine-compute-cpu`'s unreachable `Pending`/`Running`).
- Whether a terminated Worker's OS memory is actually reclaimed by the
  browser (D-009) -- a browser-engine guarantee with no reliable,
  non-experimental JS API to verify it from a test page.
