# Current planning state

> **Type:** mutable operational status
> **Authority:** does not alter the architecture; in case of conflict,
> `GRAFTING_MASTER_SOURCE.md` wins.
> **Updated on:** July 29, 2026

## Situation

- Git repository created on July 26, 2026; first documentation commit made.
- The provider-neutral AI Control Plane is operational at its minimal Phase 1
  level: canonical coordination protocol, registered Claude/Codex/Gemini
  identities, single-owner task records, immutable structured handoffs,
  schemas, capabilities/workflows, and deterministic validation/audit. It has
  no gateway, MCP, hook, model call, or self-evolution (DEC-048/ADR-0010).
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
→ Knowledge/Automation Plane ADR   ← done (I-001, DEC-050)
→ Graph IR v1 contract             ← done (I-002; extractor remains I-004)
→ generic Rust graph core          ← done (GRAPH-001, DEC-051)
→ full English translation pass   ← done
→ disposable spikes                ← done (8 accepted)
→ scaffold                          ← in progress (Epic B core done; see below)
```

## Decision Gates — consolidated status

| Gate | Status | Decision | Record |
| --- | --- | --- | --- |
| GATE-001 | **closed** | Web host = Next.js; the VTT is a client-only route, not the whole app | DEC-041 · ADR-0001 |
| GATE-002 | open, **indefinite standby** | Generic C ABI/.NET feasibility is proven; no engine/game work resumes without the owner's explicit instruction | ADR-0002 |
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
| Multi-agent coordination | Claude, Codex, and Gemini share single-owner task state and structured handoffs under `.ai/`; vendor adapters remain short | DEC-048 · ADR-0010 |
| Capability autonomy and external isolation | Reusable capabilities use the smallest useful boundary (module tree, package, or host app); third-party APIs stay internal, package count remains evidence-driven, and authoritative behavior is implemented once | DEC-049 · ADR-0011 · master source §2.6 |
| Knowledge/Automation Plane | Four authority classes and a proposal-based documentary lifecycle; graph computation, visual adaptation, and application presentation are separate responsibilities. The original TypeScript graph-package allocation is amended by DEC-051 | DEC-050 · ADR-0012 · master source §§16.7-16.8 |
| Rust graph authority and API contracts | Rust owns reusable graph structures/calculations; callers own presentation enrichment; every consumed package has a generated API baseline plus behavioral contract tests | DEC-051 · ADR-0013 · master source §§2.7, 16.8 |

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
5. batching and copy-budget benchmark — **done, 2026-07-29.** Native,
   managed/unmanaged, and real-browser clone-vs-transfer paths were measured;
   A-009 is accepted with a provisional copy budget. Tracked evidence:
   `docs/benchmarks/copy-budget-2026-07-28.md`.
6. initial Nx and toolchain validation — **done, 2026-07-28.** Exact pins,
   nine-project baseline graph, affected selection, 0%→100% cache proof, and
   the explicit `@nx/dotnet` fallback were validated. Evidence:
   `docs/benchmarks/toolchain-nx-validation-2026-07-28.md`.
7. minimal Graph IR and read-only X6 visualization — **done, 2026-07-29.**
   Generator, candidate schema, packages, tests, production build, and
   owner-run real-browser read-only interaction check passed. The `0.1-spike`
   name deliberately does not close I-002.
   Evidence: `docs/benchmarks/graph-ir-x6-spike-2026-07-28.md`.
8. minimal AI Control Plane, without a gateway or advanced self-evolution —
   **done, 2026-07-29.** File-based coordination and deterministic audit are
   accepted for Phase 1. Evidence:
   `docs/benchmarks/ai-control-plane-spike-2026-07-29.md`.

Toolchain on the owner's machine (re-verified 2026-07-27): git, node, dotnet,
rustc/cargo (1.97.1, with the `wasm32-unknown-unknown` target installed),
pnpm (11.17.0), uv (0.11.32), and wasm-pack (0.15.0) are all installed. A
real discrete GPU (AMD Radeon RX 5600 XT) is present with working
Vulkan/DX12 drivers, and WebGPU works in a real (non-`about:blank`) page
context in headless Edge. `flatc` is now pinned and installed. All eight
foundational spikes are accepted.

All five throwaway spike directories (`spikes/wasm-worker-nextjs/`,
`spikes/rust-capi-dotnet/`, `spikes/wgpu-native-web/`,
`spikes/polymath-v0/`, `spikes/copy-budget/`) are excluded from version control by the root
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
- `libs/engine/domain-core`'s `project.json` carries pre-I-002
  `metadata.graphIr`; spike 7 produced a validated candidate, not the accepted
  Graph IR v1. The metadata is superseded during I-002/I-004, not silently by
  the spike.
- Copy-budget benchmark (spike 5/A-009) was skipped during this historical
  scaffold pass; it was subsequently completed and accepted on 2026-07-29.
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
- **Worker-crash (`onerror`) path is implemented but not automated in a
  test** — logic simple enough to review directly; flagged as a gap.
- **Device-loss handling / cooperative cancellation** — not applicable
  yet (no `wgpu::Device` in this Worker, PROV-006 still open;
  `increment` completes in microseconds, nothing to interrupt).
- Not committed yet — same standing rule as every prior task.

## Epic D memory test (D-009), 2026-07-28

Owner picked this next, closing out the last open Epic D item. Depends
on D-006 and D-008 per master source §23's backlog table; acceptance
criterion "no leak in the target scenario." "Target scenario" wasn't
treated as a new product decision (unlike E-003's pilot workload) — it's
the realistic session shape D-001..D-008 already implies: one engine
created once, then many repeated submit → poll → take_result → view →
release cycles, the same shape `Engine.IncrementAndWait` and
`worker.ts`'s message handler already exercise exactly once. D-009
proves that shape stays bounded under *repetition*, not just correct on
a single pass.

A Plan-subagent review checked the draft against the actual source before
anything was built and caught two things worth recording:

- **§19.5's "arena growth" is a distinct failure mode from a plain
  handle leak, and needed its own signal.** A table whose occupied count
  (`len()`) stays flat every cycle doesn't prove its backing storage
  isn't still growing — a broken free-slot-reuse scan would leave `len()`
  flat (every cycle still calls `remove()` correctly) while the `Vec`
  behind it grows unboundedly. Fixed by adding a second accessor,
  `slot_count()` (total slots ever allocated), to both crates'
  `HandleTable<T>`, and asserting it too.
- **Wasm linear memory pages are never returned to the browser**, even
  after Rust frees whatever grew them — so the logical handle-table
  counts, however correct, cannot speak to §19.5's literal "`memory.grow`"
  item. Fixed by adding a free `debug_memory()` function (wrapping
  `wasm_bindgen::memory()`) so `test/browser-check.html` can read the
  module's real `WebAssembly.Memory.buffer.byteLength` and confirm it
  plateaus under repetition.

A third issue surfaced empirically, not from the review: the first
version of the native repeated-create/destroy test asserted against
`capi-bridge`'s process-wide `registry()` static, expecting a return to
its own pre-loop baseline. It failed intermittently in practice —
`cargo test` runs tests in parallel, and several existing smoke tests in
the same module (`null_pointers_are_rejected_everywhere_not_crashing`,
`overflow_fails_the_job_not_the_process`,
`a_panic_poisons_the_engine_and_the_process_survives`,
`submitting_after_shutdown_is_refused`) deliberately never destroy the
engine they create, so the registry's size genuinely, permanently moves
for reasons unrelated to a leak. Fixed by testing a local, non-shared
`HandleTable<Engine>` instance instead — the exact same `insert`/`remove`
logic `registry()` wraps, without the shared-state race. A caught,
concrete example of why the general project preference for "real
evidence over assumption" also means re-verifying a test's *own*
reliability, not just the thing it's testing.

**Real and verified:**

- Both crates' `HandleTable<T>` gain `len()` (occupied slots) and
  `slot_count()` (total slots ever allocated). `capi-bridge` gains two
  native debug exports, `engine_debug_job_count`/`engine_debug_buffer_count`,
  wrapped as `Engine.DebugJobCount()`/`DebugBufferCount()` in
  `Grafting.Isekai.Interop` (same "test-only but not cfg-gated"
  convention as `engine_debug_trigger_panic`). `wasm-bridge` gains the
  Wasm-side mirrors plus the module-level `debug_memory()` free function.
- Rust: 5,000-cycle repeated submit/poll/take/view/release tests in both
  `capi-bridge::engine` and `wasm-bridge::engine` (the latter as
  `#[wasm_bindgen_test]`, run via `wasm-pack test --node`), each
  asserting both occupied and total slot counts stay constant every
  iteration. `capi-bridge` also gets the local-`HandleTable` repeated
  create/destroy test described above. 25 capi-bridge tests, 6
  wasm-bridge `wasm-bindgen-test`s (11 total with the 5 native
  `handle.rs` tests), all passing.
- .NET: new `MemorySmokeTests.cs` — a 5,000-cycle `IncrementAndWait` loop
  proving no growth through the real P/Invoke boundary, and a
  GC-finalizer test that deliberately abandons a `JobSafeHandle` without
  disposing it (factored into a `[MethodImpl(MethodImplOptions.NoInlining)]`
  helper so an unoptimized build's JIT can't keep it rooted), forces
  `GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();`, and
  confirms via the new debug exports that the native handle was really
  released — not just that nothing else broke. Keeps its `Engine`
  rooted for the whole test on purpose (`JobSafeHandle.ReleaseHandle()`
  calls back into its owning `EngineSafeHandle`; .NET doesn't guarantee
  finalization order between two objects that become garbage together).
  15 tests total (13 existing + 2 new), all passing against the real
  `grafting_isekai_capi.dll`.
- Web/Wasm: `test/browser-check.html` extended with three new blocks —
  2,000 cycles direct against `WasmEngine` checking debug counts stay at
  their baseline and `debug_memory()`'s `byteLength` plateaus after an
  initial warm-up sample; 2,000 `IsekaiEngine.increment()` cycles through
  the real Worker/production API producing the correct final value; 30
  `create()`+`terminate()` cycles each working correctly and rejecting a
  post-`terminate()` call. Verified in a real headless Edge instance
  driven over CDP (same methodology as every prior real-browser check in
  this repo) — all existing D-007/D-008 checks on the same page still
  pass unchanged.

**Deliberately not done, and why:**

- **Device loss / release-after-cancellation** — already N/A elsewhere
  (no `wgpu::Device` yet; nothing to cancel with a synchronous backend),
  not re-litigated here.
- **"Short pinning"** — enforced by `WithBufferView<T>`'s callback-scoped
  signature (no escape hatch exists to call), not a runtime check that
  could regress and needs a test.
- **Whether a terminated Worker's OS memory is actually reclaimed by the
  browser** — a browser-engine guarantee with no reliable,
  non-experimental JS API to verify it from a test page.
- Not committed yet — same standing rule as every prior task.

## Epic C: `flatc` + FlatBuffers schemas (C-005/C-006), 2026-07-28

Owner picked this next. C-005 ("Configure `flatc`," depends on
B-001/B-002/B-004, all satisfied) and C-006 ("Define schema evolution,"
depends on C-005) are both done — the blocker named in four places
across this repo (`domain-core/snapshot.rs`, both Isekai crates' docs)
is gone.

A Plan-subagent review checked the draft against the actual source
before anything was built and caught two problems the draft missed
entirely, both fixed before implementation:

- **CI would have silently broken.** `.github/workflows/ci.yml` runs
  `cargo check`/`cargo test --workspace` directly on `ubuntu-latest`,
  *before and outside* any Nx step — once `domain-core` had a test
  depending on generated code, this currently-green job would fail the
  moment it was pushed. Fixed with two new CI steps (install a
  version-matched Linux `flatc`, then generate Rust code) before the
  existing Cargo step. Verified against the real, published
  `google/flatbuffers` GitHub release assets (not assumed) — but this
  exact YAML was not executed on a real Actions runner during this
  task; flagged, watch the first real push.
- **`Snapshot.core_version: &'static str` could not survive a real
  decode.** A FlatBuffers-decoded string is never `'static` — producing
  one would mean leaking memory every decode or silently substituting
  the current build's version, defeating the field's whole point (S15.6:
  identify which build produced a snapshot). Fixed: `core_version`
  changed to an owned `String`.

A third issue surfaced empirically during implementation, not from the
review: the C# side (`Google.FlatBuffers` on NuGet) turned out to lag
the primary pinned `flatc` (25.12.19) — NuGet's latest is 25.2.10.
flatc-generated C# embeds a version-marker call
(`FlatBufferConstants.FLATBUFFERS_<version>()`) that only exists in a
runtime package published by the *same* generator version, so generated
C# genuinely failed to compile against the available NuGet package —
confirmed by actually trying it, not assumed to be "low risk" as the
plan first guessed. Fixed with a second, older, separately-pinned
`flatc` used only for C# generation
(`tools/scripts/get-flatc-csharp.ps1`, downloaded on demand) — the real
fix, not a workaround, since the wire format itself is unchanged across
that version range.

**Real and verified:**

- `flatc` installed (`winget`, version `25.12.19`) and pinned
  (`tools/flatc-version.txt`, checked by `bootstrap.ps1`).
- Three schemas (`libs/engine/domain-core/contracts/{command,domain_event,snapshot}.fbs`)
  covering the three S10.1 types that actually exist in this codebase —
  `Command`/`DomainEvent` as a `union` of per-variant tables (gets
  `flatc`'s own structural verifier for free, S10.4's "untrusted
  messages verified before use"), `Snapshot` as one table.
  `rng_seed`/`state_hash` (`[u8;32]`) are `[ubyte]` vectors with
  hand-written `len()==32` validation on decode, since FlatBuffers fixed
  arrays are a `struct`-only feature and `struct` is excluded here
  (S10.4: these are "versionable messages").
- One Nx `generate` target (`engine-domain-core:generate`, a real
  `dependsOn` of `check`/`test` and of the new consumers below) producing
  Rust/TS/C# into the three literal example paths from S10.2. All three
  gitignored.
- `libs/engine/domain-core/src/wire.rs`: real hand-written
  encode/decode conversions between the canonical `Command`/
  `DomainEvent`/`Snapshot` and their generated wire types.
  `tests/flatbuffers_round_trip.rs` proves every variant of both enums
  plus `Snapshot` survives a genuine encode/decode round trip — the
  real proof C-005 needs, not just "the schema compiles" — plus a
  garbage-bytes-rejected test and a wrong-length-field-rejected test
  (S10.4's verification requirement).
- C-006: `contracts/fixtures/command_v1.fbs` is a frozen, committed copy
  of `command.fbs` from before `Increment` gained `sequence_hint`; its
  generated Rust code is committed too, via a documented S10.3 exception
  (`docs/adr/ADR-0009-committed-flatbuffers-fixture.md`, Decision section
  left open for the owner per this repo's own ADR convention).
  `tests/flatbuffers_evolution.rs` proves both directions for real: old
  writer → new reader (shared fields survive, new field defaults) and
  new writer → old reader (shared fields survive, new field ignored).
- New `dotnet/Grafting.Isekai.Protocol` project (added to `System.sln`,
  own `project.json`) for the C# generated output — deliberately not
  referenced by `Grafting.Isekai.Interop`, no live consumer on either
  side yet.
- `packages/isekai-web-client` gained the `flatbuffers` npm dependency
  the generated TS actually imports (a real gap in the first draft, not
  just missing polish) — `tsc --noEmit` passes.
- All Rust tests pass (`cargo test --workspace`, includes the 7 new
  FlatBuffers tests), `dotnet build System.sln` passes (3 projects now),
  `tsc --noEmit` passes in `isekai-web-client`.

**Deliberately not done, and why:**

- **`ReplicationDelta`** — not modeled anywhere in this codebase yet
  (Phase 6/Epic H); a schema can't be written for a type with no Rust
  definition.
- **The generic `engine_submit(bytes)` FFI entry point** (S11.6) —
  separately-scoped future work; C-005/C-006's own criteria are schema
  generation + an evolution test, not rewiring the FFI. Neither
  `engine_submit_increment` nor `WasmEngine::submit_increment` was
  touched.
- **TS/C# round-trip consumers** — both verified compile-only (`tsc
  --noEmit`, `dotnet build`), since neither has a real consumer of these
  types yet either, same honesty as the "no live consumer" note above.
- **CI YAML not runner-verified** — written from real, verified release
  asset names, but no GitHub Actions runner was available to actually
  execute it during this task.
- **ADR-0009's Decision section** — left open for the owner, per this
  repo's own ADR convention (`docs/adr/README.md`), even though the code
  it documents is implemented and tested.

## Generic Rust graph core (GRAPH-001), 2026-07-29

DEC-051 is implemented as a real Cargo/Nx project at `libs/graph/core`, not as
an empty planned directory:

- `grafting-graph-core` is a generic directed multigraph with Grafting-owned
  node/edge IDs, generic calculation payloads, private storage, endpoint and
  identity validation, deterministic predecessor/successor queries, immutable
  sorted snapshots, and deterministic topological ordering with explicit cycle
  errors;
- `petgraph 0.8.3` is pinned and private. Its types do not cross the public API;
  optional pinned `serde`/`serde_json` dependencies exist only for the Graph IR
  CLI adapter. All three dependencies are MIT OR Apache-2.0;
- `graph-core:format`, `check`, `lint`, `test`, `api-check`, and
  `graph-ir-check` are real Nx targets. Six Rust tests cover structure,
  determinism, cycles, the public names/signatures, and positive/negative
  Graph IR CLI behavior;
- Graph IR shape and format-specific provenance/canonicalization stay in JSON
  Schema/JavaScript. Duplicate identities and missing endpoints now run only
  through the Rust core, so the prior cross-language behavior copy is gone;
- `pnpm graph:v1:check` and `pnpm graph:v1:test` execute both the Graph IR layer
  and the Rust structural layer.

Deliberately not done in GRAPH-001: no speculative mathematics dependency or
unused algorithm catalog was added; no fine-grained Rust/Wasm calls were
created; and the working `graph-x6` spike package was not removed before its
Architecture Studio consumer is migrated atomically. GRAPH-001 supplied the
compile-time consumer and behavioral contracts that I-003A now complements
with the first generated, Git-tracked API baseline.

## Toolchain security remediation (SECURITY-001), 2026-07-29

Owner picked this up for Claude to run in parallel with Codex's I-003 work
(claimed through `.ai/coordination/PROTOCOL.md`, not started informally).
`pnpm audit` had 17 advisories (6 high, 11 moderate): 5 on `vite` (direct
dependency of `apps/architecture-studio`), 1 high + 8 moderate on `axios`
(transitive via `nx`), 2 high on `brace-expansion` (transitive via `nx`/
`nx>minimatch`). Ajv (introduced by I-002) was already unaffected.

**Real and verified:**

- `vite` bumped `7.2.2` → `7.3.6` in `apps/architecture-studio/package.json`
  -- patches all 5 Vite advisories (server.fs.deny bypass x2, arbitrary
  file read, optimized-deps `.map` path traversal, launch-editor NTLMv2).
  Real production build (979 modules) and `tsc --noEmit` both verified
  clean afterward, not just "the version string changed."
- `axios`/`brace-expansion` forced to `^1.18.1`/`^5.0.8` via
  `pnpm-workspace.yaml`'s `overrides` field -- **not** `package.json`'s
  `pnpm.overrides`, which a real `pnpm install` run showed a warning for
  (pnpm 11 no longer reads that location; confirmed empirically, fixed
  before re-verifying, not assumed from memory). `nx` itself stays
  pinned at `23.1.0` -- still the latest *stable* release; `23.2.0` only
  has beta/canary builds, which the task's own original risk notes
  already flagged as undesirable to adopt for a "reproducible versions"
  toolchain pin (B-005).
- `pnpm audit` now reports "No known vulnerabilities found."
- No second workspace root/lockfile created (would need an ADR per
  `AGENTS.md`) -- `overrides` is a normal mechanism within the existing
  pnpm workspace/lockfile.

**Deliberately not done, and why:**

- Leftover pre-override `axios@1.16.1`/`brace-expansion@5.0.6` artifacts
  remain in pnpm's content-addressable store -- confirmed absent from
  `pnpm-lock.yaml`'s actual resolved graph (what `pnpm audit` and the
  real dependency tree use), so harmless; store pruning is unrelated to
  this task's scope, not attempted.
- Not committed yet -- same standing rule as every prior task.

## Rust public API contract pilot (I-003A), 2026-07-29

DEC-051's per-package contract convention is now proven on the real
`grafting-graph-core` boundary:

- a deterministic, Git-tracked report is generated from native Rustdoc JSON
  and contains public names, signatures, inputs, outputs, trait guarantees,
  and the authored Rustdoc obligations;
- missing public documentation and broken Rustdoc links are compile errors;
- `graph-core:api-check` compares the report without changing it, proves that
  drift is rejected, and compiles the independent consumer contract;
- the exact extraction libraries and `nightly-2025-11-23` are pinned while
  stable Rust `1.97.1` remains the authoritative compiler; extraction tools
  are development-only and do not enter the runtime API;
- formatting, Clippy, all graph-core targets/features, Rustdoc, the generated
  baseline, the consumer contract, and the entire locked Cargo workspace test
  suite passed. CI now installs the extraction nightly explicitly before
  running the same Nx API target.

The rejected `nightly-2025-08-02` compatibility attempt and the chosen design
are recorded in `docs/benchmarks/rust-public-api-contract-pilot-2026-07-29.md`.
I-003A establishes the Rust template; the TypeScript pilot follows below.
Python remains a future evidence-driven expansion, and C# remains in standby.

## Repo tooling: repo map, artifact manifest, crate/domain generators (G-003/G-004/G-006/G-007), 2026-07-29

Owner picked Epic G's repo-tooling items for Claude to run alongside
Codex's I-003B. Claimed through `.ai/coordination/PROTOCOL.md`
(`.ai/state/tasks/G-TOOLING-REPO-MAP-AND-GENERATORS.json`). G-005 (ADR
template) and G-008 (`docs:check` CI wiring) were *not* picked up --
explicitly out of scope this pass, though G-008 is now a small, natural
follow-on since G-003/G-004 both already have the `--check` mechanism it
would wire into CI.

**Real and verified:**

- G-003: `tools/scripts/generate-repo-map.mjs` (`pnpm graph:map`/
  `graph:map:check`) produces `docs/generated/repo-map.md` -- every real
  Nx project (13 today), grouped by ecosystem tag, read from
  `docs/generated/project-graph.json`. Mirrors `generate-graph-ir.mjs`'s
  established deterministic-output/`--check` convention exactly, not a
  new one.
- G-004: `tools/scripts/generate-artifact-manifest.mjs` (`pnpm
  graph:manifest`/`graph:manifest:check`) produces
  `docs/generated/artifact-manifest.json`, matching S18.5's literal
  example shape (`productVersion`/`coreVersion`/`abi`/`protocol`/
  `gitSha`/`target`/`profile`/`features`) exactly -- `target` is a single
  string, live-derived from `rustc -vV`'s `host:` line, not a guessed/
  hardcoded value (a Plan-subagent review caught that an earlier draft's
  "Windows + wasm32" pair wasn't backed by real evidence -- `rustc-vV`'s
  host line is honest regardless of which machine/CI runner generates
  it). `abi`/`protocol`/`features` come from a real runtime value --
  `libs/isekai/capi-bridge` gained a new `abi-info-cli` bin (behind an
  `abi-info-cli` Cargo feature, never in the real `cdylib`;
  `EngineAbiInfo::current()` widened from `pub(crate)` to `pub` so the
  bin, technically a separate crate within the same package, can call
  it) that prints the same review-caught reason as C-005/C-006's own
  `abi-info`/`graph-ir-cli` precedent: parsing Rust source with regex
  would duplicate logic that already exists and drift as it grows (e.g.
  once GPU support lands).
- G-006: `tools/scripts/generate-rust-crate.mjs` scaffolds a new Rust
  crate matching every existing crate's exact shape (`Cargo.toml`,
  `src/lib.rs`, `README.md`, `AGENTS.md`, `project.json` with `check`/
  `test` targets, no stale placeholder `_comment` in `metadata.graphIr`
  -- matching `graph-core`'s newer convention, not the older crates'
  wording), and appends the new path to root `Cargo.toml`'s explicit
  `members` array (a real, tested text transform -- insertion at start/
  middle/end, idempotent on re-insertion).
- G-007: `tools/scripts/generate-domain.mjs` reuses G-006's scaffolding
  logic for `libs/domains/<name>`, per S17.2's exact input/output spec.
  Refuses to scaffold a public binding unless `--force-binding` is
  explicitly passed -- S17.2, verbatim: "do not create bindings for
  every domain automatically." `--contract` scaffolds a starter `.fbs`
  placeholder + a Rust-only `generate` Nx target (no TS/C# generation --
  no known consumer needs it yet for a domain nobody has asked for).
  `--compute` adds a real `implicitDependencies: ["engine-domain-core"]`
  graph edge, not just a comment.
- **Both generators' own tests genuinely prove their literal acceptance
  criteria** ("valid crate **and graph**" / "complete slice"), not just
  "the files look right": a Plan-subagent review caught that a true OS
  temp directory (or `spikes/`, already `.gitignore`d) would be
  structurally invisible to Nx's default project-graph construction (it
  only crawls the real, non-ignored repo tree) -- confirmed empirically
  before writing the tests. Fixed: `generate-rust-crate.test.mjs`/
  `generate-domain.test.mjs` scaffold into a uniquely-named, in-repo,
  non-ignored scratch directory (`libs/.generator-*-test-<id>/`), run a
  real `cargo check` inside it (after appending a local, test-only empty
  `[workspace]` table -- confirmed empirically that Cargo otherwise
  refuses to check a crate nested inside the real workspace tree that
  isn't a declared member), run `pnpm exec nx show projects --json` and
  assert the scratch project is actually discovered, then delete it --
  confirmed absent afterward via `git status --short`. `pnpm exec`
  itself needed `CI=true` in the test's own environment (confirmed
  empirically: without an inherited TTY it aborts asking to
  interactively purge `node_modules`, per pnpm's own error message).
- `tools/scripts/README.md` (new) documents every script in the
  directory, including Codex's Graph IR/coordination ones, for
  discoverability as the script list grows.

**Deliberately not done, and why:**

- G-005 (ADR template) and G-008 (`docs:check` CI wiring) -- not
  selected for this pass.
- The `@nx/devkit`-based local Nx plugin S17.1 describes ("will be
  created after the initial scaffold stabilizes") -- explicitly future
  work; every existing "generate a file" tool in this repo is a plain
  Node script, and these two match that convention rather than adding
  new, heavier infrastructure.
- No real crate or domain was actually created under the permanent tree
  -- master source S4.3 (`LOCKED`): "Empty directories must not be
  created ahead of time." No real product need exists yet; using either
  generator for real is a decision for whoever has one.
- Not committed yet -- same standing rule as every prior task.

## TypeScript public API contract pilot (I-003B-TS), 2026-07-29

DEC-051's TypeScript convention is now proven on the real consumed boundary
`@grafting/x6-canvas`, without adding a package or dependency:

- the package's pinned TypeScript 5.9.3 compiler emits its declaration entry
  point entirely in memory; the generated and Git-tracked
  `tests/snapshots/public-api.md` contains consumer-visible names, required and
  optional inputs, outputs, operations, and TSDoc;
- `project.json#metadata.publicApi` holds only the entry point, baseline path,
  and forbidden external modules, so the checker is reusable rather than
  X6-specific;
- every directly exported declaration and public member requires meaningful
  TSDoc, and `@antv/x6` or any subpath in the emitted public declaration fails
  the check. The only runtime import remains inside `x6-canvas`;
- `x6-canvas:api-check` runs five checker tests (including negative drift,
  missing/empty documentation, forbidden modules, and path containment) and
  compares the baseline without changing its hash or timestamp;
- a private behavior seam owns construction of the frozen read-only handle.
  Its contract test proves that only `nodeCount`, `edgeCount`, `center`, and
  `dispose` are exposed and that actions delegate to the private controller;
- Nx check/test/api-check passed without cache, `@grafting/graph-x6` passed
  check/test, and Architecture Studio passed typecheck plus a real Vite 7.3.6
  production build (980 modules). CI now runs the same x6-canvas contracts.

The selected design and the deferred API Extractor alternative are recorded in
`docs/benchmarks/typescript-public-api-contract-pilot-2026-07-29.md`.
TypeScript is complete for this pilot. Python remains evidence-driven until a
consumed public package boundary needs the convention; C# remains in indefinite
standby by owner decision and was not touched.

## ADR template (G-005), 2026-07-29

Codex completed G-005 in parallel with I-004: `docs/adr/TEMPLATE.md` (11
ordered metadata fields, 12 required sections, controlled statuses, Graph
IR v1-compatible relation mappings) and `docs/adr/README.md`. `TEMPLATE.md`
deliberately does not match the real ADR discovery pattern
(`ADR-[0-9]{4}-[a-z0-9-]+.md`); full ADR indexing into Graph IR remains a
later I-006-or-later extractor extension, not part of I-004's Nx-sourced
scope. Recorded here per Codex's own completion handoff
(`.ai/state/handoffs/20260729T143032Z--G-005-ADR-TEMPLATE--codex-to-claude.json`),
which asked the next editor of this shared file to note it rather than
requiring a second concurrent edit. G-008 (`docs:check` CI wiring) remains
open, not selected in any pass yet.

## Nx to Graph IR v1 extractor (I-004), 2026-07-29

Claimed through `.ai/coordination/PROTOCOL.md`
(`.ai/state/tasks/I-004-GRAPH-IR-EXTRACTOR.json`) after the owner split
remaining work between Claude (I-004) and Codex in parallel again. A
Plan-subagent review pass caught two real correctness problems before
anything was written, both fixed and re-verified before completion.

**Real and verified:**

- `tools/scripts/graph-ir-extract.mjs` (`pnpm graph:extract` /
  `graph:extract:check`) reads the committed `docs/generated/project-graph.json`
  and each project's manifest, and produces the real
  `docs/generated/grafting.graph.json`: `project`/`target` nodes and
  `contains`/`depends_on` edges -- the Nx-sourced slice of the v1 contract,
  matching the backlog item's own title ("Nx -> Graph IR extractor") and
  criterion ("reproducible projects/targets/edges"). Task/agent/handoff/
  skill/prompt coverage stays out of scope (`.ai/`-sourced, not
  Nx-sourced; independently confirmed by Codex's own G-005 handoff, which
  names the same boundary) -- see I-006/J-012.
- Real, current data drove two design corrections a naive port of the
  existing spike generator would have gotten wrong: Nx records the same
  `(source,target)` dependency pair under two different types at once in
  real cases today (`architecture-studio`->`graph-x6`,
  `graph-x6`->`x6-canvas`, both `implicit`+`static`) -- the v1 schema's
  canonical edge ID has no room for a type suffix, so these collapse to one
  `depends_on` edge per pair (`declared`/confidence 1 if an authored
  `implicitDependencies` entry exists, else `derived`/confidence 0.95 from
  Nx's own inference alone -- the real, static-only case is
  `isekai-web-client`->`@grafting/isekai-wasm`). The same declared/derived
  split applies to targets Nx infers via a plugin but that aren't literally
  in a project's own manifest get `authorityClass: "derived_evidence"`, not
  `"canonical_authored_source"`, with evidence pointing at the Nx export
  rather than a manifest key that doesn't actually exist. At I-004 completion,
  `architecture-studio`'s inferred `dev` target was the real example; I-006B
  later declared that target explicitly, so it is canonical authored source in
  the current Graph IR.
- `sourceRevision` (`git:<sha>` or `workspace:sha256:<fingerprint>`, per
  `docs/graph-ir/README.md`) is new logic with no prior implementation in
  this repo. A Plan-review pass caught that scoping the dirty-tree
  fingerprint to a whole-repo `git status` scan (the first draft) is
  self-referential: the generator's own output becomes part of the working
  tree the moment it's first written, so a later run's fingerprint would
  never match the one already embedded in the file, and `--check` could
  never converge -- confirmed live against a real dirty tree carrying
  unrelated concurrent work from Codex's own tasks. Fixed by scoping the
  fingerprint strictly to the extractor's own real inputs (the same file
  set `generator.inputHash` already correctly used), never its own output
  path.
- Self-checks its own output against both Graph IR validation layers
  before writing: the JS schema/semantic validator
  (`validate-graph-ir.mjs`) and the real Rust `graph-ir-cli` structural
  layer (`cargo run -p grafting-graph-core --features graph-ir-cli --bin
  validate-graph-ir`) -- per DEC-051, unique-ID and edge-endpoint-existence
  invariants are authoritative in Rust, not reimplemented in TypeScript (a
  Plan-review pass caught that the first draft's own ad hoc JS
  duplicate-ID guard would have been exactly that duplication).
- 6 Node tests (`graph-ir-extract.test.mjs`) pass: end-to-end schema/Rust
  validation of the real generated document, the two collision-case
  assertions above, direct unit coverage of the JSON Pointer escaping
  helper (RFC 6901; a Plan-review pass found the original claim that
  `@grafting/isekai-wasm`'s real data exercises this today was overstated
  -- that project currently has no targets or dependencies, so nothing
  routes its `/`-containing name through a pointer segment yet -- fixed by
  testing the helper directly instead), and `--check` convergence
  immediately after a fresh generate. Manually confirmed `--check` also
  fails after a hand-edit and recovers after regenerating.
- Real output today: 47 nodes, 43 edges, `sourceRevision:
  git:<40-hex>` (this task's own inputs were clean at generation time even
  though the wider tree carried unrelated concurrent work).
- `docs/graph-ir/README.md`/`AGENTS.md` updated from future to past tense;
  both state plainly that `grafting.graph.spike.json` and the Architecture
  Studio spike viewer are untouched and stay frozen until I-006's separate
  viewer cutover. `GRAFTING_MASTER_SOURCE.md` S27's
  `- [ ] grafting.graph.json;` line is now checked.

**Deliberately not done, and why:**

- Task/agent/handoff/skill/prompt Graph IR coverage -- `.ai/`-sourced, not
  Nx-sourced; a later I-006-or-later/J-012 extractor extension, not this
  one.
- The Architecture Studio spike viewer migration itself (moving off
  `grafting.graph.spike.json` onto the real v1 file, removing
  `graph-x6`) -- I-006, a separate backlog item, now genuinely unblocked
  by this data existing but not started here.
- ADR extraction into Graph IR -- G-005 published the authoring
  convention only; indexing it is later work per that task's own handoff.
- Not committed yet -- same standing rule as every prior task.

## Unified docs/Graph IR drift check (I-007 + G-008), 2026-07-29

Owner split remaining work between Claude and Codex again, following
Codex's own proposed division: Codex took `I-006A-X6-READONLY-SELECTION`
(`packages/x6-canvas/**` only); Claude took the unification of I-007
("Drift check") and G-008 ("`docs:check`") into one entry point instead of
two separate implementations. Claimed through
`.ai/coordination/PROTOCOL.md`
(`.ai/state/tasks/I-007-G-008-DOCS-GRAPH-DRIFT.json`).

**Real and verified:**

- `pnpm docs:check` (root `package.json`) chains five already-existing,
  already-tested checks -- a plain `&&` sequence, not a new script --
  `graph:map:check` (G-003), `graph:manifest:check` (G-004),
  `graph:extract:check` (I-004, the real `grafting.graph.json`),
  `nx run graph-core:api-check` (I-003A), `nx run x6-canvas:api-check`
  (I-003B). `graph:v1:check` (fixture-only validation) and `graph:check`
  (the frozen spike) are deliberately excluded -- neither is real
  generated-doc drift in the I-007/G-008 sense.
- Real gap closed: reading `.github/workflows/ci.yml` end to end showed
  none of G-003/G-004/I-004's three `--check` scripts ran in CI at all
  before this task; the two API-baseline checks did run, but scattered
  across two separate/bundled steps. `.github/workflows/ci.yml` now runs
  one "Docs and Graph IR drift check" step (`pnpm run docs:check`) after
  the Cargo build step; the old "Rust public API contract" step is gone
  and `x6-canvas:api-check` moved out of the TypeScript step (now
  "TypeScript behavior contracts," `check`+`test` only) -- same coverage,
  same relative order, one named step instead of three. YAML re-parsed
  successfully (Python's `yaml` module); no GitHub Actions runner was
  available to execute it for real, same limitation as every prior CI
  edit this session.
- Drift detection proven for real, not assumed: `docs/generated/repo-map.md`
  and `docs/generated/artifact-manifest.json` were each deliberately
  hand-corrupted in turn; `pnpm docs:check` failed both times, naming the
  actual stale file via the underlying script's own error message;
  regenerating (`pnpm graph:map` / `graph:manifest`) restored a passing
  run each time. `grafting.graph.json` was caught genuinely stale by real
  concurrent drift (Codex's parallel work changing task records/manifests
  mid-task) rather than a manufactured test -- regenerating
  (`pnpm graph:extract`) fixed it the same way.
- `tools/scripts/README.md` documents the new entry point.
  `GRAFTING_MASTER_SOURCE.md` S27 now records `docs:check`/CI drift
  detection as done, and (a small in-scope courtesy while already editing
  this exact section) checks off the stale `ADRs (G-005...)` line --
  Codex completed G-005 earlier this session but it was never marked here.

**Deliberately not done, and why:**

- CI still never regenerates `docs/generated/project-graph.json` itself --
  a pre-existing gap (already true of `graph:map:check`/
  `graph:manifest:check` before this task), not something either backlog
  item's literal criterion asks this task to fix.
- No new automated test file wrapping `docs:check` -- it is a plain
  `&&`-chain of five commands that each already have their own drift-proof
  coverage; the aggregate behavior was proven with real command
  transcripts instead (see above), not a test with nothing of its own to
  unit-test.
- `packages/x6-canvas/` and `apps/architecture-studio/` untouched --
  confirmed via a live task-registry check that I-006A owns the former
  exclusively; `docs:check` only calls its existing `api-check` target
  from outside.
- Not committed yet -- same standing rule as every prior task.

## Architecture Studio real graph and Rust layout cutover (I-006B), 2026-07-29

The owner manually accepted the initial real-graph viewer but identified its
fixed four-column placement as an unstructured block. The completed Codex task
`I-006B-ARCH-STUDIO-REAL-GRAPH-CUTOVER` contains the full coherent cutover
rather than creating one package per layer.

**Implemented and automated-test verified:**

- Architecture Studio consumes `docs/generated/grafting.graph.json` directly;
  the frozen spike artifact is no longer in its production path, and the
  transitional `@grafting/graph-x6` package was removed atomically.
- `@grafting/x6-canvas` remains the only X6-owning boundary. The application
  owns its labels, colors, inspector, viewport state, and Graph IR presentation
  mapping without exposing vendor types.
- `grafting-graph-core` now owns a deterministic one-level grouped-grid layout.
  The app supplies the explicit grouping edge IDs; `contains` currently makes
  each project a root with its targets directly below it. Standalone nodes are
  retained, invalid/nested/multiple grouping is rejected, and coordinate
  arithmetic is checked.
- The layout crosses one batch JSON adapter in `grafting-isekai-wasm` and runs
  in an app-owned Web Worker. TypeScript performs boundary translation and
  presentation enrichment only; it does not duplicate graph calculation.
- `apps/architecture-studio/src/presentation.ts#PROJECTION` is the single
  authored projection configuration for node dimensions, colors, spacing,
  columns, grouping relation kinds, and vendor-neutral visual roles. Repository entities remain dynamic:
  regenerate the Nx export and `pnpm graph:extract`; new projects, targets, and
  relations require no app-code changes.
- Owner acceptance clarified that coordinate grouping alone was not enough:
  `@grafting/x6-canvas` now privately maps generic node/relation roles to Ant
  Design cards from `@grafting/ui`, mounted through its private React-shape
  adapter, plus subtle boundary ports, smooth hierarchy paths, smooth
  dependency curves, modern arrow markers, label capsules, a responsive dotted
  canvas, and fit-to-content centering. Repeated `contains` labels are
  suppressed by the application projection to preserve visual hierarchy. No
  X6, React-shape, or AntD type and no Graph IR-specific name entered the
  reusable public API.
- Rust unit/contract tests, native Wasm adapter tests, TypeScript presentation
  tests, typecheck, and a Vite production build pass. The build emits a separate
  layout Worker and the Wasm asset. The Rust public-API baseline now protects
  the new names and signatures.

**Known test-environment limitation:**

- The in-app browser integration exposes no browser backend in this session.
  The owner's browser is serving the app at `http://127.0.0.1:4511/`; one manual
  refresh remains useful for visual inspection but is not represented as
  automated-browser evidence.

## Pluggable canvas node views (X6-002), 2026-07-29

The completed Codex task `X6-002-PLUGGABLE-NODE-VIEWS` corrects the first React
integration and reorganizes `@grafting/x6-canvas` by responsibility. The Ant
Design `EntitySummary` Card is now the complete React-shape root rather than a
child of a decorative wrapper. A vendor-neutral `CanvasNode.view` selects an
internal definition from a pure catalog; X6 registration, canvas lifecycle,
node ports, selection, edge presentation, and concrete node components are
separate modules. The first registered view is `card`. Future formats add an
isolated component/data/definition folder and a catalog entry without changing
the canvas controller. Behavioral tests and public-API snapshots are
consolidated under one `tests/` root in both affected TypeScript packages.

This fixed internal catalog was intentionally superseded by X6-003 after the
owner clarified the repository-wide composition rule below.

## Neutral composable canvas boundary (X6-003), 2026-07-29

The owner accepted DEC-052/ADR-0014: reusable packages are neutral capabilities
with Grafting-owned extension points and replaceable defaults; applications own
concrete visual identity, semantic treatments, effects, and interaction policy.

`@grafting/x6-canvas` now registers one presentation-free DOM host and accepts
per-canvas node mounts, ports, edge presenters, surface options, interaction,
and viewport policy. It contains no Card, product role, palette, or fixed edge
theme and no longer depends on `@grafting/ui`. X6, React-shape, React, ReactDOM,
and Ant Design types are forbidden from its public declaration.

Architecture Studio now composes both packages explicitly:
`canvas-views.ts` owns its view identities/data, `presentation.ts` maps Graph IR
and Rust layout results, and `canvas-composition.ts` owns the Ant Design Card,
ports, palette, curves, arrows, labels, effects, grid, pan, zoom, selection, and
fit behavior. Another shape or arc can be added to the application composition
without editing the generic canvas lifecycle.

## Recommended next action

All foundational spikes are accepted. GATE-002 stays in indefinite standby.
I-001/DEC-050, I-002, GRAPH-001/DEC-051, the Rust/TypeScript public-API
pilots, SECURITY-001, G-003/G-004/G-005/G-006/G-007, I-004, I-007/G-008, and
X6-002, X6-003/DEC-052
are complete (see above). I-006A and I-006B are complete: the real Graph IR
cutover, selection inspector, Rust/Wasm grouped layout, single projection
configuration, and reusable AntD React cards inside X6 are implemented and
contract-verified. The in-app browser backend was unavailable for automated
visual capture, which remains an external test-environment limitation rather
than an implementation blocker. The next Architecture Studio slice is the
grouped Rust query contract for filters, neighborhood, direction, depth,
immutable subgraphs, and deterministic ordering; it should extend the existing
batch boundary without duplicating algorithms in TypeScript. Python contract
expansion waits for a consumed public boundary; C# remains in standby and does
not block the Web path. ADR-0009's Decision section remains pending owner
confirmation; `engine_submit(bytes)` and E-003 remain separately scoped future
work.

## Update rule

This file records only: real status, current phase, next steps, blockers,
and decisions awaiting the owner. Actual architectural decisions live in the
master source or an ADR — this file points to them, it does not repeat them.
