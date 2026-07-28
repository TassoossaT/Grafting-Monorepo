# Current planning state

> **Type:** mutable operational status
> **Authority:** does not alter the architecture; in case of conflict,
> `GRAFTING_MASTER_SOURCE.md` wins.
> **Updated on:** July 27, 2026

## Situation

- Git repository created on July 26, 2026; first documentation commit made.
- `README.md`, `GRAFTING_MASTER_SOURCE.md` (v1.8.0), `CURRENT_PLANNING_STATE.md`,
  `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `docs/adr/` (8 ADRs), and a minimal
  `.ai/` (`README.md` + the `task-completion` skill, active) all exist. The
  remaining directories from the canonical `.ai/` layout (section 29.1) have
  not been created yet.
- English is now the default documentation language for the entire
  repository (DEC-047): every pre-existing Portuguese document was
  translated to English in this pass. This supersedes the earlier rule that
  only required new files to be written in English going forward.
- **Epic B (workspace foundation) is now real, as of 2026-07-27** — see
  "Workspace foundation (Epic B)" below for exactly what exists and what's
  deliberately still missing. This supersedes the earlier "no workspaces,
  lockfiles ... exist yet" statement.
- The active architectural source is `GRAFTING_MASTER_SOURCE.md`; `docs/adr/`
  is the decision history that feeds it.

## Current phase

```text
planning
→ adversarial review           (not yet formally executed)
→ closing the Decision Gates     ← done
→ ADRs                            ← done
→ full English translation pass   ← done
→ disposable spikes                ← done (4 of 4 foundational spikes)
→ scaffold                          ← in progress (Epic B core done; see below)
```

## Decision Gates — consolidated status

| Gate | Status | Decision | Record |
| --- | --- | --- | --- |
| GATE-001 | **closed** | Web host = Next.js; the VTT is a client-only route, not the whole app | DEC-041 · ADR-0001 |
| GATE-002 | open, **formally deferred** | The C# engine choice awaits a concrete game; generic `isekai-capi`/`Grafting.Isekai.Interop` work is released | ADR-0002 |
| GATE-003 | **closed** | V1 desktop client = Windows x64; Linux/macOS core-build only | DEC-043 · ADR-0003 |
| GATE-004 | open, **formally deferred** | The authoritative server host choice awaits Phase 6 / Epic H | ADR-0005 |
| GATE-005 | **closed** | Replay determinism on the same platform/build; GPU never writes directly to the state hash | DEC-044 · ADR-0004 |
| GATE-007 | **closed** | Single monorepo; "selling" a product means packaging that app's artifact, not splitting the repository | DEC-045 · ADR-0007 |
| GATE-006, 008, 009 | open, unprioritized | WebGPU-less fallback; license/proprietary policy; multiplayer persistence | — |

No agent may close GATE-002, GATE-004, or any gate from GATE-006 to
GATE-009 without an explicit decision from the owner.

## Complementary structural decisions (not numbered gates)

| Decision | Content | Record |
| --- | --- | --- |
| Polymath | One package per runtime (`polymath`/`@grafting/polymath`/`Grafting.Polymath`) is the only place allowed to inspect OS/runtime/RID | DEC-042 · ADR-0006 |
| `libs/` boundary + domain map | A capability used by more than one product is born in `libs/domains`/`packages/`, never duplicated inside an app. Initial map: `narrative` and `session` are generic; the VTT's X6 map is product-specific (only `packages/x6-canvas` is shared with the Architecture Studio); Discord and transcription are external integrations, not domains | DEC-046 · ADR-0008 · master source §4.4 |
| Documentation language | English is the default documentation language repository-wide; all pre-existing Portuguese docs were translated | DEC-047 · master source §3.1 |

Pending, but not blocking Phase 0: standard directory for external
integrations (`apps/integrations/` vs. `tools/`) once Discord/transcription
move from idea to implementation.

Full ADR index, with status and links: `docs/adr/README.md`.

## Foundational spikes planned (Phase 0)

**Owner decision, 2026-07-27: all four spikes below reviewed and
accepted** — this is the accept/reject/rewrite call master source §26
Step 3 reserves for the owner. None of the spike code itself is treated as
production-ready; each README's "Disposition" section records what pattern
should carry forward when the corresponding real work starts (Epic B–E).

1. Rust → Wasm in a Dedicated Worker, under the Next.js host (GATE-001) —
   **done, 2026-07-27, see `spikes/wasm-worker-nextjs/README.md`.** Boundary
   proven end to end with a real (non-virtual-time) headless-browser check,
   not just a build/type-check. Throwaway code; not yet the canonical
   `isekai-wasm`/`isekai-web-client` scaffold.
2. generic Rust C ABI/DLL → C# (`isekai-capi` + `Grafting.Isekai.Interop`),
   without choosing an engine — **done, 2026-07-27, see
   `spikes/rust-capi-dotnet/README.md`.** Opaque generational handles +
   `catch_unwind` verified end to end from a plain .NET console harness over
   P/Invoke, including a deliberate-panic path that returns an error status
   without crashing the .NET process. No engine chosen; GATE-002 untouched.
3. the same WGSL shader in native and Web wgpu, respecting the GATE-005
   determinism floor — **done, 2026-07-27, see
   `spikes/wgpu-native-web/README.md`.** One shared `double.wgsl` file run
   through native `wgpu` (Vulkan, real AMD GPU) and through `wgpu` compiled
   to `wasm32-unknown-unknown` targeting WebGPU (verified in a real headless
   browser session); both produced bit-identical results.
4. Polymath v0 (`libs/platform/polymath`, `packages/polymath`) — real
   support for Windows only, explicit stubs for other platforms — **done,
   2026-07-27, see `spikes/polymath-v0/README.md`.** Rust `os`/`gpu` and
   TypeScript `env`/`gpu`/`worker` modules built; Windows paths verified by
   real tests, Linux/macOS `os` stubs verified to actually compile
   (`cargo check --target x86_64-unknown-linux-gnu` /
   `aarch64-apple-darwin`), and the TS module's Node-vs-browser divergence
   (e.g. `SharedArrayBuffer` gated by cross-origin isolation in the browser
   but not in Node) confirmed with and without COOP/COEP headers.
5. batching and copy-budget benchmark;
6. initial Nx and toolchain validation;
7. minimal Graph IR and read-only X6 visualization;
8. minimal AI Control Plane, without a gateway or advanced self-evolution.

Toolchain on the owner's machine (re-verified 2026-07-27): git, node, dotnet,
rustc/cargo (1.97.1, with the `wasm32-unknown-unknown` target installed),
pnpm (11.17.0), uv (0.11.32), and wasm-pack (0.15.0) are all installed. A
real discrete GPU (AMD Radeon RX 5600 XT) is present with working
Vulkan/DX12 drivers, and WebGPU works in a real (non-`about:blank`) page
context in headless Edge. Nothing is missing for spikes 1–4; `flatc` and
spikes 5–8 remain for later.

All four throwaway spike directories (`spikes/wasm-worker-nextjs/`,
`spikes/rust-capi-dotnet/`, `spikes/wgpu-native-web/`,
`spikes/polymath-v0/`) are excluded from version control by the root
`.gitignore`'s `spikes/` rule — none of this code is meant to be committed
as-is; each spike's README documents the pattern that should carry forward
into the real scaffold.

## Workspace foundation (Epic B), 2026-07-27 — committed

Owner explicitly chose to start the scaffold (master source §26 Step 4)
ahead of spikes 5–8. A Plan-mode review pass (subagent, cross-checked
against the actual docs and actual repo/git state) corrected the first
draft before anything was built — see `GRAFTING_MASTER_SOURCE.md` §27 for
the corresponding checklist state. **Committed** (owner's own commit,
`bb5e49e`, 2026-07-27) — all 24 files in one commit, `git status` clean
afterward. Not pushed to any remote.

**Real and verified:**

- Rust workspace: root `Cargo.toml` (resolver "3"), `rust-toolchain.toml`
  pinned to `1.97.1`. One member, `libs/engine/domain-core`
  (`grafting-domain-core`) — at this point in the log, freshly scaffolded
  and still empty of real domain logic. **Epic C (below, same day) filled
  it in.** `cargo check --workspace` and `cargo test -p grafting-domain-core`
  pass.
- Node/pnpm + Nx workspace: root `package.json` (`packageManager` pinned to
  `pnpm@11.17.0`), `pnpm-workspace.yaml`, `nx.json` (`defaultBase: "master"`
  — verified against actual git state, not assumed "main"; no remote is
  configured). Nx (23.1.0) sees `engine-domain-core` and its cache
  demonstrably works: reset → first run 0% cache hit → second run 100%
  cache hit → touching the source file invalidates it again.
- Python/uv workspace: root `pyproject.toml`
  (`[tool.uv.workspace] members = ["python/*"]`), `uv.lock`,
  `.python-version` pinned to `3.12`. One example member,
  `python/automation`. `uv lock --check`, `uv sync --locked`, and
  `uv run --package automation pytest` all pass.
- Bootstrap: `tools/scripts/bootstrap.ps1` (pnpm install → cargo check →
  uv sync), verified idempotent by running it twice.
- CI: `.github/workflows/ci.yml`, Linux-only, covers Rust + Node/Nx +
  Python. YAML syntax validated locally (Python's `yaml` module). **Not
  pushed** to any remote yet — it is committed locally, though. The
  `.gitignore` `.github/` entry that would have silently blocked this from
  ever being tracked was removed by the owner directly after being
  flagged.
- `AGENTS.md` — added the explicit Polymath rule (DEC-042) closing that
  §27 checklist item.

**Deliberately not done, and why (see `GRAFTING_MASTER_SOURCE.md` §27 for
the matching checklist annotations):**

- No `.NET` root scaffolding (`global.json`/`System.sln`/`Directory.*.props`)
  — ADR-0002 Track 1 clears real projects, not an empty root shell; ties to
  Epic D, not this workspace-foundation pass. B-004/B-010 stay open.
- No Windows/.NET CI job (B-010) — nothing to test yet.
- `libs/engine/domain-core`'s `project.json` carries a placeholder
  `metadata.graphIr` block, not a real Graph IR v1 schema (doesn't exist
  yet) — satisfies DEC-028's letter without inventing a fake schema; to be
  superseded when spike 7 (minimal Graph IR) happens.
- Copy-budget benchmark (spike 5/A-009) — still skipped, per the owner's
  earlier explicit choice; §27's "Before the scaffold" checklist still
  shows this unchecked on purpose.
- `flatc` — still Phase 2 scope, unchanged.

## Domain core (Epic C), 2026-07-27

Owner chose Epic C as the next task after Epic B was committed. A
Plan-mode review pass (subagent) corrected the first draft before
anything was built: dropped a `serde_json` Snapshot format that would
have quietly worked around a `LOCKED` decision (DEC-013 names Snapshot
for FlatBuffers explicitly, master source §10.1), cited the real reason
C-005/C-006 stay out of scope (blocked on B-004, not just "Phase 2"), and
reordered the work so the state hash (C-007) exists before `Snapshot`
(C-004) embeds it.

**Real and verified** (`libs/engine/domain-core`, all against a
deliberately generic "tally counter" example domain — see the crate's own
`README.md`, not a real game/VTT domain, since none is specified anywhere
in the docs):

- C-001 — already satisfied structurally by Epic B, no new work.
- C-002 — `Command` (`Increment`/`Decrement`/`Reset`/`RollAndAdd`) +
  typed `CommandError` validation, never a panic.
- C-003 — `DomainEvent` + `apply_command` tying Command+State+RNG
  together.
- C-007 — SHA-256 state hash over an explicit, hand-written byte
  encoding; a real replay-reproduces-hash test, not just "it compiles."
- C-004 — `Snapshot` (state + RNG seed/position + sequence + hash +
  `core_version`); round-trip via `derive(Clone, PartialEq)`, deliberately
  **no** serialization crate (see above).
- C-008 — `proptest` property tests
  (`libs/engine/domain-core/tests/replay_determinism.rs`): replay
  determinism, no-panics, and snapshot-resume-matches-continuous-replay,
  each checked over hundreds of random command sequences, not fixed
  examples alone.
- 23 tests total (20 unit + 3 property-based), all passing.
- Controlled RNG uses `ChaCha8Rng` (not `rand::StdRng`) specifically
  because ChaCha8's algorithm is fixed by construction — `StdRng`'s is not
  guaranteed stable across `rand` releases, which DEC-044's "RNG algorithm
  fixed per build" needs.

**Deliberately not done, and why:**

- C-005 (flatc config) / C-006 (schema evolution) — genuinely blocked on
  B-004 (.NET solution, still open, tied to Epic D), not a phase-label
  choice.
- No real VTT/game domain content — no product decision exists yet to
  build against.
- No multiplayer (`AcceptedCommand`, journal, `ReplicationDelta`,
  transport) — Phase 6/Epic H.
- No FFI/`isekai-capi` work — Epic D, a separate task.
- **DEC-044's "same platform" is only partially captured.**
  `Snapshot.core_version` is one of six axes ADR-0004 lists (build ID,
  target, protocol/schema versions, features, numeric configuration, RNG
  algorithm). No real "determinism manifest" covering all six exists
  anywhere in this repo yet — recorded as a gap, not implied as solved.
- Not committed yet — left as working-tree changes pending review, same
  standing rule as Epic B.

## Compute (Epic E, partial: E-001 + E-002), 2026-07-27

Owner picked this over Epic D specifically because master source §22
lists "CPU backend" as a Phase 2 deliverable alongside Command/
DomainEvent/Snapshot/state hash — continuing Phase 2 rather than jumping
to Phase 3 (Epic D). A Plan-mode review pass (subagent) corrected the
first draft before anything was built: generalized a hard-coded "double"
example op into a parametrized `ScaleF32 { factor }` (so it can't be
misread as quietly pre-selecting E-003's pilot workload), confirmed a
non-generational `JobHandle` is the right call (§11.3's generational
scheme is FFI-boundary-only, not needed for this internal-Rust contract),
and flagged that `ProblemHandle`/resident-state (§13.6) should be left
out entirely rather than stubbed hollow.

**Real and verified** (`libs/engine/compute-api` + `libs/engine/compute-cpu`):

- E-001 — `ComputeCapabilities`, `JobHandle` (monotonic, not
  generational — see crate docs for why), `JobState`
  (`Pending`/`Running`/`Completed`/`Failed`/`Cancelled`), typed
  `ComputeError`, `ComputeOp`/`ComputePlan`/`ComputeResult` (raw `Vec<f32>`
  payloads, S10.1's hot numeric path — never FlatBuffers), and the
  `ComputeBackend` trait. Zero dependencies — satisfies both "must not
  expose concrete `wgpu` types" (S4.2) and E-001's literal criterion.
- E-002 — `CpuBackend`: synchronous reference implementation. 8 tests,
  all passing (capabilities, immediate completion, correct scaling, empty
  input, non-finite-factor→`Failed` not a panic, unknown-handle rejection,
  double-release rejection, post-release rejection).
- `ComputeOp::ScaleF32 { factor }` is a **structural placeholder**, not
  E-003's pilot workload — chosen because the earlier accepted spike
  (`spikes/wgpu-native-web/`) already proved this operation family
  (element-wise scale) runs identically on native and Web `wgpu`; that
  bit-identical result is a property of trivial power-of-2 scaling, not
  evidence of general GPU float determinism (§13.7, ADR-0004).

**Deliberately not done, and why:**

- E-003 (choose pilot workload) through E-010 — E-003's "dataset and
  metric defined" criterion is a real product decision nothing in the
  docs answers yet. Not invented under the generic-example umbrella the
  way `domain-core`'s tally counter was, because a compute pilot workload
  is supposed to be something real, unlike an abstract state machine.
- No `ProblemHandle`/resident GPU state (§13.6) — Phase 7 solver
  territory; a stateless per-plan op has nothing resident to manage.
- No `compute-wgpu` (E-005) — so `Pending`/`Running`/`Cancelled` are
  unreachable in `compute-cpu` (documented, not hidden), and CPU-vs-GPU
  differential testing (E-009, also `compute-cpu`'s own §4.2
  responsibility) is structurally impossible right now.
- No FFI/`isekai-capi` — Epic D, separate.
- Not committed yet — same standing rule as Epic B/C.

## Isekai native ABI + .NET wrapper (Epic D, partial: D-001..D-006), 2026-07-28

Owner picked this next. Given its size (9 backlog items spanning native
ABI, .NET, and Wasm bindings), this pass covers D-001 through D-006 only
(native C ABI + .NET wrapper + validation harness — ADR-0002 Track 1's
explicit deliverable list); D-007/D-008 (`isekai-wasm`/`isekai-web-client`)
and D-009 (memory test) are a separate task (different surface: Wasm/
wasm-bindgen vs. this pass's native cdylib/P-Invoke).

A Plan-mode review pass caught a near-repeat of a mistake already made
and reversed once in this repo: the first draft proposed a hand-rolled
byte codec for `Command`/`DomainEvent` crossing the C ABI — the same
class of mistake as Epic C's reverted `serde_json` `Snapshot` format,
since master source §10.1 names all three for FlatBuffers (`DEC-013`,
`LOCKED`). Corrected: no general wire format was built. Real
`domain-core` logic is still wrapped, just via one concretely-typed
operation (`engine_submit_increment`) instead of a generic byte channel.

**Real and verified** (`libs/isekai/capi-bridge` + root `.NET`
scaffolding + `dotnet/Grafting.Isekai.Interop*`):

- D-001 — `EngineAbiInfo`, scoped down from §12.3's full field list (no
  build ID/target yet — no build pipeline produces one).
- D-002 — kind-tagged generational handles (`Engine`/`Job`/`Buffer`
  packed into one `u64`, not just index+generation — prevents cross-kind
  handle reuse from silently misvalidating).
- D-003 — explicit engine lifecycle
  (`Creating`/`Ready`/`ShuttingDown`/`Destroyed`/`Poisoned`). A caught
  panic sets `Poisoned` explicitly and refuses further work — **not**
  `spikes/rust-capi-dotnet`'s mutex-poison recover-and-continue shortcut
  (that spike's own README already flagged it as not the intended
  production design).
- D-004 — buffer lease (view/release), leak-free.
- D-005 — `grafting-isekai-capi` v1 exported as a real `.dll`. 21 Rust
  tests, all passing (handle packing/kind validation, lifecycle
  transitions, panic→poison→refusal, overflow→`Failed` not a crash,
  struct_size mismatch, null pointers, invalid/double-released handles).
- D-006 — `Grafting.Isekai.Interop` (`SafeHandle` per kind, centralized
  status→exception translation, buffer views scoped to a callback) +
  `Grafting.Isekai.Interop.Tests` (xUnit, real DLL, not mocked). 13 tests,
  all passing, including the actual proof that matters: a real panic
  through the full P/Invoke boundary poisons the engine, the process
  survives, and other engines keep working.
- Root `.NET` scaffolding created (deferred in Epic B, unblocked here):
  `global.json`, `Directory.Build.props`, `Directory.Packages.props`,
  `System.sln` (classic format — `dotnet new sln`'s default is now
  `.slnx` in this SDK; forced `-f sln` to match master source §6.1's
  literal `System.sln` naming).
- `tools/scripts/bootstrap.ps1` updated with a `dotnet restore
  --locked-mode` step; re-verified idempotent.

**Deliberately not done, and why:**

- **No general Command/DomainEvent wire format** — see above; still
  blocked on C-005/C-006 (`flatc`), which are themselves still blocked on
  a real .NET solution existing... which now exists. C-005/C-006
  themselves remain not started (a separate task).
- **No `isekai-wasm`/`isekai-web-client`/memory test** (D-007-009) —
  separate task, different surface.
- **No `ProblemHandle`/resident state** — same call as Epic E's deferral.
- **No `Grafting.Isekai.Protocol`** (FlatBuffers-generated .NET types) —
  doesn't exist until C-005/C-006 do.
- **"Wrong architecture" (§19.4) not tested** — needs a second-arch
  build, out of reach this pass; flagged, not silently skipped.
- Not committed yet — same standing rule as Epic B/C/E.

## Isekai Wasm bridge + Web client (Epic D, continued: D-007, D-008), 2026-07-28

Owner picked this next, to mirror the native `isekai-capi` work on the
Web side. D-009 (memory test) stays a separate task.

A Plan-subagent review raised a specific, high-stakes concern before
anything was built: whether a Rust panic on `wasm32-unknown-unknown` is
fatal to the *entire* Wasm instance (per `wasm-bindgen`'s own docs and a
Cloudflare Workers postmortem) or scoped to the *specific object* being
mutated — this determines the whole poisoning/recovery design, and the
review cited real, reputable sources contradicting my first quick test.
Rather than trust either side, this was re-verified with a deliberately
more rigorous, realistic probe (real heap allocation — `Vec` push/grow,
`String::format`, matching `apply_command`/`state_hash`'s actual shape),
in **both** Node and a real headless-browser session, then re-verified a
**third** time against the actual compiled crate itself (not just the
throwaway scratch probe) via a real end-to-end browser check. All three
rounds agree: **only the specific panicking object becomes unusable;
everything else — other instances, other heap allocations, new
allocations, the module itself — is completely unaffected.** This
contradicts the cited external sources; documented as a known,
unresolved discrepancy (most likely explanation: those describe a
different failure category, e.g. `panic = "abort"`'s default or an older
`wasm-bindgen` version) rather than silently trusted or silently
dismissed. Re-verify with the same method if `wasm-bindgen` is ever
upgraded.

**Real and verified** (`libs/isekai/wasm-bridge`, `packages/isekai-wasm`,
`packages/isekai-web-client`):

- D-007 — `WasmEngine` (`wasm-bindgen` class, one `State` + one seeded
  RNG), `submit_increment` (same one concretely-typed real operation as
  the native side — no general wire format, same DEC-013 reasoning),
  generational `Job`/`Buffer` handles (mirroring `isekai-capi-bridge`'s
  table, duplicated not shared — ~150 lines, low risk). **No Rust-side
  `Poisoned` state** — impossible to set one; see the panic-handling
  finding above. 10 Rust tests, all passing (5 native, 5
  `wasm-bindgen-test` via `wasm-pack test --node`).
- `packages/isekai-wasm` — the compiled-output package. Correction from
  review: `wasm-pack --scope` renames the *crate*, not to the desired
  package name — hand-authored `package.json` wraps the raw `wasm-pack`
  output instead.
- D-008 — `IsekaiEngine` (one Worker = one engine for V1, `create`/
  `increment`/`terminate`, Promise-per-job, transferred `stateHash`
  bytes), with two distinct, documented failure paths: per-object
  poisoning (caught in the Worker's normal message handler) and Worker
  *crash* (`onerror`, S14.1/S19.5's explicit requirement, not just
  voluntary termination). 2 Vitest tests (Node-only logic) +  a real
  end-to-end browser check (`test/browser-check.html`, Vite-served,
  verified via headless Edge) proving: panic isolation against the real
  crate, a normal round trip, overflow rejection correctly *not* flagged
  as poisoning, and a fresh engine after `terminate()`.

**Deliberately not done, and why:**

- **No general Command/DomainEvent wire format** — same as the native
  side, same reasoning.
- **D-009 (memory test)** — separate task.
- **Worker-crash (`onerror`) path is implemented but not automated in a
  test** — logic simple enough to review directly; flagged as a gap.
- **Device-loss handling / cooperative cancellation** — not applicable
  yet (no `wgpu::Device` in this Worker, PROV-006 still open;
  `increment` completes in microseconds, nothing to interrupt).
- Not committed yet — same standing rule as every prior task.

## Recommended next action

Epic B is committed; Epic C, Epic E (partial), and Epic D (now fully
D-001..D-008, D-009 still open) are built and verified but not yet
committed. Candidates for what's next, no decision recorded yet:
review/commit the above; D-009 (memory test, closing out both Epic D
sides together); C-005/C-006 (`flatc`, genuinely unblocked by a
real `.NET` solution — still needs the `flatc` toolchain installed);
spikes 5–8; or resume Epic E toward E-003 (needs a real product decision
on the pilot workload first).

## Update rule

This file records only: real status, current phase, next steps, blockers,
and decisions awaiting the owner. Actual architectural decisions live in the
master source or an ADR — this file points to them, it does not repeat them.
