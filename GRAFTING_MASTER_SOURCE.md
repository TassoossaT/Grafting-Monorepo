# Grafting Monorepo — Master Source of Architecture and Creation

> **Unified canonical document for product, architecture, creation, and AI Control Plane.**
>
> Version: `1.13.0`
> Original base date: July 23, 2026
> Consolidation date: July 26, 2026
> Last updated: 2026-08-07 - The relocation scheduled by the S0.4 router completed: sections 4, 6-15, 17-19, and 23 moved into dedicated `docs/architecture/` files, taking this document from 2548 lines to ~700. It is now the normative layer plus the router, not the container.
> State: `CANONICAL-UNIFIED`
> Next milestone: close the Decision Gates in Section 5 and execute the unified Phase 0 before the definitive scaffold.
>
> Project name: **Grafting Monorepo**
> Interoperability subsystem: **Isekai**
> AI Control Plane: **`.ai/`**
> Operational contract per scope: **`AGENTS.md`**
>

---

## 0. How to use this document

This file is the entry point and the normative layer for a body of documents
that together define the technical product, the architectural decisions
already made, the plan and backlog for building the monorepo, the basis for
ADRs and contracts, the Knowledge & Automation Plane, and the AI Control
Plane. Most of that material lives in the files named by the S0.4 router
below; this file holds what governs all of them.

Read section 0 before proposing or executing structural changes — it is
short, and it is what tells you how to resolve a conflict between any two of
the documents. Then use the router to fetch only the sections a task actually
needs, rather than reading everything. `AGENTS.md` complements this document
with scope-specific operational rules; `.ai/` contains the capabilities and
policies of the AI system.

### 0.1 Normative language

The terms below have deliberate meaning:

- **MUST / MUST NOT:** mandatory rule.
- **SHOULD / SHOULD NOT:** recommended standard; exceptions need to be justified.
- **MAY:** locally permitted decision.
- **LOCKED:** closed architectural decision.
- **PROVISIONAL:** initial standard that needs to be validated by a spike.
- **OPEN:** human decision not yet made.

### 0.2 Precedence rule

In case of conflict:

1. the project owner's most recent explicit requirements;
2. the most recently accepted ADR;
3. this master document;
4. versioned contracts and schemas;
5. `AGENTS.md` applicable to the scope;
6. existing code, manifests, and pipelines;
7. `.ai/` for AI Control Plane policies and capabilities;
8. vendor adapters such as `CLAUDE.md`, `.claude/`, `.codex/`, and `.agents/`;
9. generated documentation and visualizations;
10. agent assumptions.

If code contradicts a `LOCKED` decision, the agent MUST NOT assume that the code won. It must report the deviation and request a decision. `.ai/` MUST NOT silently override an operational contract in `AGENTS.md`; vendor adapters MUST NOT contradict either layer.

### 0.3 What an agent cannot do silently

The agent MUST NOT:

- turn an `OPEN` decision into a definitive implementation;
- swap a `LOCKED` technology for its own preference;
- create a second implementation of proprietary logic in TypeScript, C#, or Python;
- expose Rust types directly through FFI;
- call state replication Event Sourcing;
- promise zero-copy between distinct memory domains;
- make a cacheable target execute external effects;
- add a new workspace root or a new lockfile without an ADR;
- introduce containers as a requirement for every local build;
- broadly rewrite files unrelated to the task;
- generate empty future directories just to "complete" the tree;
- create a second durable source of tasks;
- expand permissions, hooks, sandbox, or MCPs without approval;
- enable semantic caching for code, security, incidents, or mutable state;
- promote learning or self-rewriting without evidence, evaluation, and rollback.

---

### 0.4 Router: where to find each section

This master source stays the single entry point, but most section bodies now
live in dedicated files so an agent fetches only what a task needs instead of
reading the whole document. Sections marked "moved" below are no longer
present in the body of this file at all -- use this table, not the heading
numbers elsewhere in this document, to find them. Stable citation keys
(`DEC-XXX`, `GATE-XXX`) are location-independent and are unaffected by any of
these moves; cite the ID, never the section number, when referencing a
decision or gate from outside this document.

| § | Topic | Location |
| - | ----- | -------- |
| 0 | How to use this document | inline below |
| 1 | Product vision | moved -> `docs/architecture/overview.md` |
| 2 | Architectural principles | inline below |
| 3 | Summary decision log | moved -> `docs/decisions/DECISION-LOG.md` |
| 4 | Logical architecture | moved -> `docs/architecture/boundaries.md` |
| 5 | Decision Gates to close | moved -> `docs/decisions/GATES.md` |
| 6 | Proposed physical topology | moved -> `docs/architecture/toolchains.md` |
| 7 | Nx orchestration | moved -> `docs/architecture/toolchains.md` |
| 8 | Python management with uv and Nx | moved -> `docs/architecture/toolchains.md` |
| 9 | Node, pnpm, and the Wasm package | moved -> `docs/architecture/toolchains.md` |
| 10 | Data contracts | moved -> `docs/architecture/contracts.md` |
| 11 | FFI and memory | moved -> `docs/architecture/memory-model.md` |
| 12 | ABI: version and lifecycle | moved -> `docs/architecture/abi.md` |
| 13 | GPU and the single solver | moved -> `docs/architecture/gpu-model.md` |
| 14 | Threads and asynchrony | moved -> `docs/architecture/concurrency.md` |
| 15 | Multiplayer | moved -> `docs/architecture/multiplayer.md` |
| 16 | Knowledge, documentation, and context for AI | moved -> `docs/architecture/ai-control-plane.md` |
| 17 | Generators and scaffolding | moved -> `docs/architecture/generators.md` |
| 18 | CI/CD | moved -> `docs/architecture/testing.md` |
| 19 | Testing | moved -> `docs/architecture/testing.md` |
| 20 | Observability | moved -> `docs/architecture/observability.md` |
| 21 | Security and robustness | moved -> `docs/architecture/security.md` |
| 22 | Implementation phases | moved -> `docs/architecture/phases.md` |
| 23 | Initial backlog | moved -> `docs/architecture/backlog.md` |
| 24 | Definition of Done | moved -> `docs/DEFINITION_OF_DONE.md` |
| 25 | Working protocol for Claude and GPT/Codex agents | inline below, collapsed to a pointer (see 25.0) |
| 26 | Strategy for making the most of agent credit | inline below |
| 27 | Creation checklist | inline below |
| 28 | Future matters deliberately out of V1 | moved -> `docs/architecture/out-of-v1.md` |
| 29 | AI Control Plane in detail | moved -> `docs/architecture/ai-control-plane.md` |
| 30 | Primary technical references | moved -> `docs/architecture/references.md` |
| 31 | Final executive summary | inline below |
| 32 | Maintenance of this master source | inline below |

The relocation this table had scheduled completed on 2026-08-07: sections 4,
6-15, 17-19, and 23 moved out, taking this document from 2548 lines to under
700. Every section that remains inline is here because it has no other home —
section 0 is the normative layer (precedence, MUST/LOCKED/PROVISIONAL/OPEN,
what an agent may not do silently) that governs every other document, and
sections 2, 26, 27, 31, and 32 are cross-cutting rather than owned by any one
package.

Sections 4, 6-15, 17-19, and 23 are cited from real Rust/C#/TypeScript
source-code comments and package manifests via an `S<n>.<n>` shorthand (for
example `packages/isekai-web-client/package.json` cites S9.2/S9.3). Their
numbered headings moved verbatim along with their prose, so those citations
still resolve — in the file this table names, rather than in this one. No
source file needed to change, and none should be rewritten to cite a path:
the section number stays the stable key precisely so the prose can move again
without touching code.

## 2. Architectural principles

### 2.1 Single source of truth

All logic that needs to produce the same meaning on Web, Desktop, or server MUST live in Rust or in shared contracts.

TypeScript and C# are hosts:

- collect input;
- control UI and rendering;
- operate transport;
- convert errors to the host language;
- call batched operations;
- present results.

They MUST NOT reproduce the core's internal rules.

### 2.2 Meta-orchestration

Nx will be the higher-level orchestrator, not a replacement for the compilers.

| Ecosystem    | Native authority             | Nx's role                                                         |
| -------------- | ----------------------------- | ------------------------------------------------------------------- |
| TypeScript     | pnpm + Vite/tsc/test runner   | ordering, filtering affected, and caching                                 |
| Rust           | Cargo + rustup + wasm tooling | ordering targets, declaring inputs/outputs, and caching final artifacts |
| C#             | dotnet + MSBuild              | integrating projects into the graph and running targets                       |
| Python         | uv + Python                | preparing the environment and running packages/scripts                       |
| Contracts      | `flatc`                     | generating languages in the correct order                   |
| Documentation | dedicated generator           | orchestrating and validating drift                                   |

Nx will not resolve Python dependencies, will not replace Cargo, will not compile C# directly, and will not be the source of truth for those ecosystems' dependencies.

### 2.3 Native toolchains and native builds

Platform-dependent artifacts MUST be built on the corresponding system or runner:

- Wasm: Linux runner for the normal build;
- `.dll`: Windows;
- `.so`: Linux;
- `.dylib`: macOS;
- DirectX graphics tests: Windows with appropriate hardware;
- Metal graphics tests: macOS with appropriate hardware.

Containers MAY be used in CI, auxiliary services, and specific reproducible environments, but MUST NOT be the universal abstraction for development or replace native graphics runners.

### 2.4 Proven performance

The project MUST NOT use GPU, FlatBuffers, pinning, SharedArrayBuffer, or unsafe code merely for architectural prestige.

Every major optimization must have:

- a representative benchmark;
- a CPU baseline;
- an upload measurement;
- a compute measurement;
- a readback measurement;
- a batch size;
- memory consumption;
- fallback behavior.

### 2.5 Portability before low-level interop

In the first version:

- rendering devices and buffers will not be shared with `wgpu`;
- solver GPU resources will be private to Rust;
- results will cross an explicit CPU boundary;
- external resource interop via D3D12/Vulkan/Metal can only be introduced after benchmarking and an ADR.

### 2.6 Package autonomy and dependency isolation

Every reusable boundary owns one coherent capability and exposes
Grafting-owned contracts. The boundary may be an internal module tree, a
package, or a host application. Separate packages are created only for a real
cross-project reuse, public-API/dependency boundary, independent build/test
ownership, or maintained fork; applications compose capabilities, present UI,
and own host-specific integration.

A third-party runtime/library API may be imported only inside its smallest
useful owning boundary. Outside consumers use a Grafting facade, contract,
function, or component, and external types must not cross that boundary. Host
frameworks may remain inside their owning app, and native build/test toolchains
remain directly operated under DEC-002; the rule isolates runtime APIs rather
than wrapping commands mechanically or creating one package per dependency.

Cloned or modified third-party source may justify its own package/tree only
after a separate license, provenance, update, security, naming, and rollback
review. It remains in the existing workspace/lockfile unless an ADR explicitly
authorizes otherwise.

Repository meaning has one authoritative implementation or canonical source.
Independent tests, deterministic generated bindings, frozen compatibility
fixtures, thin boundary translations, and evidence-backed derived projections
are allowed; they must not become alternate implementations of the same rule.

Generic packages are created with a real capability and consumer, never as an
empty speculative tree. See DEC-049 and ADR-0011.

A reusable capability package is deliberately composable: it supplies neutral
mechanisms, stable Grafting-owned contracts, extension points, and at most
replaceable defaults. It must not decide a consuming product's visual identity,
semantic roles, effects, or interaction policy. A package may privately own a
third-party adapter while the application supplies concrete components and
presentation through those neutral contracts. This keeps capabilities useful
as blank building blocks that products can combine without forking or bypassing
the package. See DEC-052 and ADR-0014.

### 2.7 Public API contracts

Every package consumed by another project treats its source-language public
declarations and documentation as the authoritative API. A generated,
Git-tracked API baseline records names, signatures, required inputs, outputs,
errors/types, and documentation evidence. An `api-check` target fails when the
regenerated baseline differs without review. Behavioral contract tests protect
guarantees a signature cannot express.

The baseline is derived evidence, not a second manually maintained interface.
Intentional incompatible changes update code, baseline, documentation,
affected consumers, and the applicable version/decision together. Native tools
extract Rust, TypeScript, C#, and Python APIs; versioned schemas/IDLs remain
authoritative only at actual ABI, protocol, or process boundaries. See DEC-051
and ADR-0013.

---

## 25. Working protocol for Claude and GPT/Codex agents

### 25.0 This section is a pointer, not a restatement

The task lifecycle is defined only by `AGENTS.md`, `.ai/coordination/PROTOCOL.md`, ADR-0010 and ADR-0015. It uses isolated worktrees, forward-only task-branch commits and human PR merge. This section keeps no second copy of those rules.

### 25.1 Recommended bootstrap prompt

```text
Read GRAFTING_MASTER_SOURCE.md in full.

Your current mission is to work only on Phase 0. Do not yet create the
definitive tree of the applications and do not silently turn OPEN decisions
into choices.

1. Extract the table of LOCKED, PROVISIONAL, and OPEN decisions.
2. Perform an adversarial analysis of the P0 decisions:
   - GPU ownership;
   - copy budget;
   - ABI/lifecycle;
   - multiplayer.
3. Propose the ADRs needed to close GATE-001 through GATE-005.
4. Propose four minimal spikes:
   - Rust -> Wasm in a Worker;
   - Rust DLL -> C#;
   - the same WGSL on native and Web wgpu;
   - a batching/copy benchmark.
5. For each spike, define the minimal tree, commands, test, and objective
   success criteria.
6. Do not implement anything until you present the plan and the points that
   require a decision.

When you find a conflict, cite the section and present the smallest possible change.
```

### 25.2 Prompt after gates close

```text
Read GRAFTING_MASTER_SOURCE.md, root and local AGENTS.md, the context pack, and all accepted ADRs.

Execute only task <ID>.

Before editing:
- confirm dependencies;
- show the files that will be created/changed;
- declare Nx inputs and outputs;
- list validations.

During implementation:
- keep native toolchains as the source of truth;
- do not replicate Rust logic;
- do not make silent architectural changes;
- preserve others' changes.

At the end, use the completion format defined in AGENTS.md.
```

## 26. Strategy for making the most of agent credit

Credit should be spent reducing uncertainty and on verifiable work, in this order:

### Step 1 — Adversarial review

Ask Claude to try to break this blueprint:

- contradictions;
- toolchain incompatibilities;
- hidden costs;
- threading risks;
- ABI risk;
- device loss risk;
- missing tasks.

Do not allow editing in this pass.

### Step 2 — ADRs

One session per major decision:

- Web;
- C# engine;
- platforms;
- determinism;
- server.

Each session must end in an ADR, not in code.

### Step 3 — Throwaway spikes

Spikes must be small and measurable. They do not automatically become the foundation.

**Where a new spike lives (2026-08-07):** a new spike is declared as an
experimental laboratory item inside `apps/architecture-studio` — its `/lab`
trials surface — not as a new top-level `spikes/` directory. The Studio is
already the place where a capability is exercised, previewed, and compared
against its alternatives, so an experiment that lives there is runnable and
visible next to the others instead of being an orphan tree at the repository
root that nobody opens again. The existing `spikes/` entries listed below stay
where they are as historical record; the rule applies to new spikes.

After the result:

- accept;
- reject;
- rewrite as production code.

### Step 4 — Scaffold

Only afterward:

- manifests;
- workspace;
- Nx;
- minimal core;
- CI.

### Step 5 — Vertical slice

Deliver one complete action:

```text
Web/C# input
→ binding
→ Rust
→ event/result
→ host
```

Before creating dozens of packages.

### Step 6 — Automation

Automate only conventions already proven:

- generators;
- docs;
- manifests;
- release.

### Practices to reduce waste

- provide a task ID in every prompt;
- do not ask to "build the whole monorepo";
- ask for a plan and expected diff;
- keep `repo-map.md` up to date;
- separate review from implementation;
- require acceptance criteria;
- create checkpoints;
- do not repeat the entire blueprint in agent files.

---

## 27. Creation checklist

### Before the scaffold

- [x] GATE-001 closed (`docs/adr/ADR-0001-host-web.md`, DEC-041).
- [ ] GATE-002 closed — **indefinite standby confirmed 2026-07-28.** Generic
      C ABI/.NET feasibility is proven; the desktop scaffold, engine choice,
      and engine-specific wrapper resume only on the owner's explicit request
      (`docs/adr/ADR-0002-engine-desktop.md`).
- [x] GATE-003 closed (`docs/adr/ADR-0003-platforms-v1.md`, DEC-043).
- [x] GATE-004 at least formally deferred (`docs/adr/ADR-0005-authoritative-host-deferral.md`).
- [x] GATE-005 closed (`docs/adr/ADR-0004-determinism.md`, DEC-044).
- [x] Wasm spike approved (2026-07-27, `spikes/wasm-worker-nextjs/README.md`).
- [x] C ABI spike approved (2026-07-27, `spikes/rust-capi-dotnet/README.md`).
- [x] Web/native wgpu spike approved (2026-07-27, `spikes/wgpu-native-web/README.md`).
- [x] Copy budget measured — **accepted 2026-07-29:** native,
      managed/unmanaged, and real-browser Web/Worker clone-vs-transfer paths
      have recorded evidence and a provisional budget. See
      `docs/benchmarks/copy-budget-2026-07-28.md`.

### Workspace

- [x] pnpm and Nx pinned (root `package.json` pins `pnpm@11.17.0`; Nx
      resolved and installed 2026-07-27).
- [x] valid Cargo workspace (`cargo check --workspace` passes; members as
      of 2026-07-27: `domain-core`, `compute-api`, `compute-cpu`,
      `isekai-capi-bridge`).
- [x] valid uv workspace and lock (`uv lock --check` and `uv sync --locked`
      pass; one example member, `python/automation`).
- [x] valid .NET solution (`System.sln`, created 2026-07-27 alongside Epic
      D once real projects — `Grafting.Isekai.Interop` +
      `Grafting.Isekai.Interop.Tests` — existed to justify it; `dotnet
      build`/`dotnet test` both pass).
- [x] `flatc` pinned (C-005, 2026-07-28; `tools/flatc-version.txt`,
      `25.12.19`, checked by `bootstrap.ps1`; installed locally via
      `winget`, on Linux CI via the matching GitHub release asset —
      that CI step is written from verified real release-asset names
      but not executed on a real runner during this task, flagged not
      hidden. C# generation uses a *second*, older, separately-pinned
      `flatc` — `Google.FlatBuffers` on NuGet lags the primary pin; see
      `libs/engine/domain-core/contracts/README.md`).
- [x] idempotent bootstrap (`tools/scripts/bootstrap.ps1`, verified by
      running it twice).
- [x] `.venv` outside the cache (uv-managed, gitignored, per-checkout as
      DEC-019 requires).
- [ ] deterministic publishable outputs — `dist/architecture-studio` is now
      exercised by the historical Graph IR/X6 spike and the active UI canvas,
      but no product release artifact or
      artifact manifest exists yet.
- [x] Polymath rule (DEC-042) documented in `AGENTS.md` (2026-07-27). Not
      yet lint/ast-grep-verified — deferred until CI has something to
      check it against, per the rule's own text ("when there is CI").

### Core

- [x] pure domain (`libs/engine/domain-core`, zero host/network/GPU deps;
      example domain is deliberately generic, not real game content —
      2026-07-27).
- [x] CPU backend (`libs/engine/compute-cpu`, E-001/E-002, 2026-07-27;
      synchronous reference implementation of `compute-api`'s
      `ComputeBackend`; CPU-vs-GPU differential testing still structurally
      unreachable — no `compute-wgpu` exists yet).
- [x] command/event/snapshot (C-002/C-003/C-004, 2026-07-27; C-005/C-006,
      2026-07-28, added the real FlatBuffers wire format —
      `contracts/*.fbs`, generated Rust/TS/C#, a round-trip test
      covering every `Command`/`DomainEvent` variant plus `Snapshot`,
      and a real schema-evolution/compatibility test using a frozen
      `command_v1.fbs` fixture, C-006. `Snapshot.core_version` changed
      `&'static str` → `String` — a decoded snapshot's version is real
      data read from bytes, never `'static`. `ReplicationDelta` still
      not modeled anywhere — Phase 6/Epic H, not silently dropped from
      DEC-013's list. The generic `engine_submit(bytes)` FFI entry point
      (§11.6) stays deliberately out of scope — C-005/C-006's own
      criteria are schema generation + an evolution test, not that).
- [x] state hash (C-007, SHA-256 over an explicit byte encoding,
      2026-07-27).
- [x] invariant tests (C-008, `proptest` property tests covering replay
      determinism, no-panics, and snapshot-resume, 2026-07-27).
- [x] no host imported (verified: crate's only dependencies are `rand`,
      `rand_chacha`, `sha2`, plus `proptest` as a dev-dependency).

### FFI

- [x] ABI major/minor (`EngineAbiInfo`, D-001, 2026-07-27; scoped-down v1
      -- no build ID/target fields yet, see `isekai-capi-bridge/README.md`).
- [x] `struct_size` (checked on `EngineCreateInfo` input; `engine_create`
      rejects a mismatch with `StructSizeMismatch`, tested).
- [x] generational handles (D-002; kind-tagged -- `Engine`/`Job`/`Buffer`
      packed into one `u64` with a kind tag, not just index+generation,
      so cross-kind handle reuse can't silently misvalidate).
- [x] status codes (`EngineStatus`, fixed-width `#[repr(i32)]`).
- [x] protected panic (D-003; `catch_unwind` around domain-logic calls
      only, engine `Poisoned` explicitly on a caught panic, never
      mutex-poison recover-and-continue -- see `engine.rs` module docs).
- [x] shutdown (idempotent `engine_shutdown`, tested with a pending
      unpolled job).
- [x] leases (D-004, 2026-07-27; buffer view/release, tested for a
      *single* leak-free round trip -- D-009, below, extends this to
      repeated cycles).
- [x] Worker (D-007/D-008, 2026-07-28; `isekai-wasm-bridge`'s `WasmEngine`
      + `@grafting/isekai-web-client`'s `IsekaiEngine`, one Worker per
      engine for V1; panic handling differs fundamentally from the native
      side here -- empirically verified, see `isekai-wasm-bridge/src/engine.rs`
      module docs -- `catch_unwind` does not work on `wasm32-unknown-unknown`;
      poisoning is per-object via `wasm-bindgen`'s own guard, classified
      in TypeScript, not a Rust-side `Poisoned` enum variant).
- [x] C# wrapper (`Grafting.Isekai.Interop`, D-006; `SafeHandle` per kind,
      centralized status→exception translation, 13 smoke tests against
      the real DLL).
- [x] memory test (D-009, 2026-07-28; "no leak in the target scenario" --
      repeated submit/poll/take/view/release cycles, not just the single
      pass D-004/D-007 already proved. Covers S19.5's leaks, arena growth
      (a table's total slot count, not just its occupied count -- a
      broken free-slot-reuse scan could otherwise hide behind a flat
      occupied count), leases, Worker termination, and `memory.grow`
      (linear memory's `byteLength` plateaus under repetition, checked
      directly since Wasm pages are never returned to the browser even
      after Rust frees what grew them -- the logical handle counts alone
      can't speak to this). Native side adds a GC-finalizer test proving
      a *forgotten* `Dispose()` still releases the handle (via new
      `engine_debug_job_count`/`engine_debug_buffer_count` debug exports,
      since nothing else could observe that). Not covered, flagged not
      hidden: device loss (no `wgpu::Device` yet, PROV-006 open) and
      release-after-cancellation (nothing to cancel with a synchronous
      backend) -- both already N/A elsewhere; short pinning (enforced by
      `WithBufferView<T>`'s callback-scoped signature, not a runtime
      check to regression-test); and whether a terminated Worker's OS
      memory is actually reclaimed by the browser, which has no reliable
      non-experimental JS API to verify from a test page).

### GPU

- [ ] private ownership.
- [ ] capability negotiation.
- [ ] CPU fallback.
- [ ] persistent buffers.
- [ ] async readback.
- [ ] benchmark.
- [ ] differential test.

### CI and documentation

- [x] affected (representative `domain-core` and `compute-api` file sets select
      only their real dependents locally; CI wiring remains separate).
- [ ] cache per platform.
- [ ] native runners.
- [x] generated docs (G-003, 2026-07-29: `docs/generated/repo-map.md`,
      a deterministic Nx-project-grouped-by-ecosystem table, via
      `tools/scripts/generate-repo-map.mjs`, `pnpm graph:map`/
      `graph:map:check`, mirroring `generate-graph-ir.mjs`'s established
      convention. G-008's CI drift-check wiring for it is done -- see
      below).
- [x] ADRs (G-005, 2026-07-29: `docs/adr/TEMPLATE.md` and
      `docs/adr/README.md`, Codex).
- [x] artifact manifest (G-004, 2026-07-29: `docs/generated/artifact-manifest.json`,
      matching S18.5's literal shape exactly; `abi`/`protocol`/`features`
      come from a real runtime value -- `libs/isekai/capi-bridge`'s new
      `abi-info-cli` bin, behind an `abi-info-cli` feature so it never
      ships in the real `cdylib` -- not from parsing Rust source;
      `gitSha`/`target` computed live. Via
      `tools/scripts/generate-artifact-manifest.mjs`, `pnpm graph:manifest`/
      `graph:manifest:check`).
- [x] `AGENTS.md` (canonical provider-neutral contract, including coordination).
- [x] `CLAUDE.md` (short adapter; drift checked alongside `GEMINI.md`).
- [x] `docs:check`/CI drift detection (I-007 + G-008, 2026-07-29: one
      entry point, `pnpm docs:check`, chaining the real
      `graph:map:check`/`graph:manifest:check`/`graph:extract:check`/
      `graph-core:api-check`/`ui:api-check` checks rather than a
      second implementation; wired into `.github/workflows/ci.yml` as one
      step, replacing the two previously separate/bundled `api-check`
      invocations with no coverage change).

---

### Knowledge & AI Control Plane

- [ ] master document adopted;
- [ ] superseded documents archived;
- [x] Graph IR v1 schema, stable IDs, provenance, evidence, and semantic
      validation (I-002, 2026-07-29);
- [x] `grafting.graph.json` (I-004, 2026-07-29; real Nx-sourced extractor --
      `project`/`target` nodes, `contains`/`depends_on` edges only;
      agent/skill/prompt coverage remains a later
      I-006/J-012 extension, not this file);
- [ ] README/AGENTS/metadata template;
- [x] minimal `.ai/` (task-completion skill plus Phase 1 coordination protocol,
      contracts, registries, Git-derived task coordination, capabilities, and workflows;
      unused canonical directories remain absent);
- [ ] AI System Maintainer tested via uv;
- [ ] hooks with no model call;
- [x] valid registry and schemas (standard-library validator, no model call);
- [ ] first context pack;
- [x] Claude/Codex/Gemini adapters without drift (Codex consumes `AGENTS.md`
      directly; Claude/Gemini short adapters are audited by hash and required
      canonical references);
- [ ] Prompt IR and reproducible snapshot;
- [ ] Promptfoo;
- [x] semantic cache disabled (no cache implementation exists; DEC-036 remains
      the enforced policy);
- [x] a single durable source of tasks (Git worktree + branch + PR per
      task; replaces the earlier unimplemented `Backlog.md` default);
- [x] approval for control changes (ADR-0010 and the coordination protocol
      require a separate task and explicit owner approval);
- [ ] tested rollback.

## 31. Final executive summary

The intended architecture is viable:

- a single proprietary core in Rust;
- one solver implementation;
- WGSL kernels reused on Web and Desktop;
- CPU fallback;
- thin bindings;
- Nx coordinating native toolchains;
- Python managed by uv;
- structured contracts and hot numeric arrays;
- explicit ABI;
- GPU compute private to the core;
- rendering private to the hosts;
- authoritative multiplayer without falsely calling it Event Sourcing.

The biggest risk is not technological. It is trying to build all layers simultaneously before validating:

- the C# engine;
- the Wasm Worker;
- the C ABI;
- Web `wgpu`;
- the real cost of transfers.

That is why the mandatory order is:

```text
decisions
→ Knowledge Plane + minimal Graph IR
→ minimal AI Control Plane
→ spikes
→ workspace
→ CPU core
→ bindings
→ GPU
→ hosts
→ multiplayer
→ solver
→ advanced AI Control Plane
```

This sequence preserves the main objective: creating a truly reusable mathematical core without turning the monorepo into a build-maintenance project.

---

## 32. Maintenance of this master source

Most section bodies now live in the files named by the S0.4 router, so
"update the affected section" usually means editing one of those files, not
this one. Edit this file for section 0's normative layer, the router table
itself, or a section still marked "inline below". When a section's body moves
to a new file, update its router row in the same change — the router is what
`tools/scripts/context-resolver.mjs` parses to tell an agent where to look,
so a stale row silently sends every future task to the wrong place.

Every architectural change must:

1. identify the affected section;
2. cite the task and ADR;
3. update the version;
4. classify the decision as `LOCKED`, `PROVISIONAL`, or `OPEN`;
5. update the Graph IR;
6. update `AGENTS.md` when operational behavior changes;
7. update `.ai/` when the AI Control Plane changes;
8. regenerate adapters;
9. run drift checks;
10. preserve Git history.

Superseded documents must go to:

```text
docs/archive/superseded/
```

with:

```text
SUPERSEDED BY: GRAFTING_MASTER_SOURCE.md
DO NOT USE AS CURRENT ARCHITECTURAL AUTHORITY
```
