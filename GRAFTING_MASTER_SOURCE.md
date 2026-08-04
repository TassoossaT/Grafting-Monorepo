# Grafting Monorepo — Master Source of Architecture and Creation

> **Unified canonical document for product, architecture, creation, and AI Control Plane.**
>
> Version: `1.12.1`
> Original base date: July 23, 2026
> Consolidation date: July 26, 2026
> Last updated: 2026-08-02 - Wasm codegen for any Rust crate now lands directly in the consuming app's own build output at build/install time, never in a `packages/` technical package (DEC-055).
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

This file is not merely an architecture description. It is simultaneously:

1. the definition of the technical product;
2. the record of architectural decisions already made;
3. the master source for creating and evolving the monorepo;
4. the plan for incremental creation of the repository;
5. the initial backlog with acceptance criteria;
6. the basis for ADRs, runbooks, contracts, and generated documents;
7. the definition of the Knowledge & Automation Plane;
8. the definition of the AI Control Plane for Claude, GPT/Codex, and future providers.

Every human or agent must read this file before proposing or executing structural changes. `AGENTS.md` complements this document with scope-specific operational rules; `.ai/` contains the capabilities and policies of the AI system.

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
| 4 | Logical architecture | inline below (pending relocation -> `docs/architecture/boundaries.md`, follow-up task) |
| 5 | Decision Gates to close | moved -> `docs/decisions/GATES.md` |
| 6 | Proposed physical topology | inline below (pending relocation -> `docs/architecture/toolchains.md`, follow-up task) |
| 7 | Nx orchestration | inline below (pending relocation -> `docs/architecture/toolchains.md`, follow-up task) |
| 8 | Python management with uv and Nx | inline below (pending relocation -> `docs/architecture/toolchains.md`, follow-up task) |
| 9 | Node, pnpm, and the Wasm package | inline below (pending relocation -> `docs/architecture/toolchains.md`, follow-up task) |
| 10 | Data contracts | inline below (pending relocation -> `docs/architecture/contracts.md`, follow-up task) |
| 11 | FFI and memory | inline below (pending relocation -> `docs/architecture/memory-model.md`, follow-up task) |
| 12 | ABI: version and lifecycle | inline below (pending relocation -> `docs/architecture/abi.md`, follow-up task) |
| 13 | GPU and the single solver | inline below (pending relocation -> `docs/architecture/gpu-model.md`, follow-up task) |
| 14 | Threads and asynchrony | inline below (pending relocation, follow-up task) |
| 15 | Multiplayer | inline below (pending relocation -> `docs/architecture/multiplayer.md`, follow-up task) |
| 16 | Knowledge, documentation, and context for AI | moved -> `docs/architecture/ai-control-plane.md` |
| 17 | Generators and scaffolding | inline below (pending relocation -> `docs/architecture/generators.md`, follow-up task) |
| 18 | CI/CD | inline below (pending relocation -> `docs/architecture/testing.md`, follow-up task) |
| 19 | Testing | inline below (pending relocation -> `docs/architecture/testing.md`, follow-up task) |
| 20 | Observability | moved -> `docs/architecture/observability.md` |
| 21 | Security and robustness | moved -> `docs/architecture/security.md` |
| 22 | Implementation phases | moved -> `docs/architecture/phases.md` |
| 23 | Initial backlog | inline below (pending relocation -> `docs/architecture/backlog.md`, follow-up task) |
| 24 | Definition of Done | moved -> `docs/DEFINITION_OF_DONE.md` |
| 25 | Working protocol for Claude and GPT/Codex agents | inline below, collapsed to a pointer (see 25.0) |
| 26 | Strategy for making the most of agent credit | inline below |
| 27 | Creation checklist | inline below |
| 28 | Future matters deliberately out of V1 | moved -> `docs/architecture/out-of-v1.md` |
| 29 | AI Control Plane in detail | moved -> `docs/architecture/ai-control-plane.md` |
| 30 | Primary technical references | moved -> `docs/architecture/references.md` |
| 31 | Final executive summary | inline below |
| 32 | Maintenance of this master source | inline below |

Sections 4, 6-14, 15, 17-19, and 23 are cited from real Rust/C#/TypeScript
source-code comments via an `S<n>.<n>` shorthand; relocating their prose is
explicitly deferred to a separate follow-up task so that move gets its own
careful pass and verification, rather than being bundled into this router's
first stand-up. Their section *numbers* remain the stable citation key either
way, so no source file needs to change when that follow-up happens.

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

## 4. Logical architecture

### 4.1 Overview

```mermaid
flowchart TB
    Web["Web VTT<br/>TypeScript + Three.js"]
    Desktop["Desktop Game<br/>C# + engine"]
    Isekai["Isekai<br/>Wasm and C ABI"]
    Core["Single Rust Core<br/>domain + solver"]
    Backends["Compute backends<br/>CPU and wgpu"]

    Web --> Isekai
    Desktop --> Isekai
    Isekai --> Core
    Core --> Backends
```

### 4.2 Engine layers

#### `domain-core`

Responsible for:

- business rules;
- authoritative state;
- state machine;
- Command validation;
- applying changes;
- generating DomainEvents;
- controlled RNG;
- state hashes;
- APIs independent of transport and rendering.

Cannot depend on:

- Three.js;
- C#;
- Web APIs;
- sockets;
- database;
- `wgpu`;
- the host's file system;
- a non-injected global clock.

#### `polymath` (Rust) / `@grafting/polymath` (TypeScript) / `Grafting.Polymath` (C#, future)

Infrastructure layer, not a domain layer (DEC-042). Responsible for:

- centralizing all OS/runtime/RID inspection (`polymath::os` in Rust: paths, dynamic
  library extension `.dll`/`.so`/`.dylib`, config/cache/temp dirs, process/thread
  differences; `@grafting/polymath`'s `env`: Node vs. Edge vs. Browser);
- exposing graphics capability facts to the rest of the system (`polymath::gpu` in Rust:
  which backends the OS/driver exposes — Vulkan/DX12/Metal; `@grafting/polymath`'s `gpu`:
  WebGPU support in the browser) and Worker facts (`@grafting/polymath`'s `worker`:
  `SharedArrayBuffer`/Worker);
- serving as the single boundary that `compute-wgpu`, `isekai-capi`, `isekai-wasm`, and the
  hosts consult for platform-dependent decisions.

Cannot contain:

- domain logic or business rules (that would duplicate DEC-001);
- the compute contract itself (that remains in `compute-api`) — Polymath supplies environment
  facts that `compute-wgpu` consumes, never the other way around;
- Worker/Wasm orchestration (that remains in `isekai-wasm`/`packages/isekai-web-client`).

No other module should inspect `cfg(target_os)`, `navigator.gpu`,
`process.platform`, or RID directly outside Polymath (DEC-042).

#### `compute-api`

Defines:

- mathematical operations;
- job types;
- capabilities;
- fallback policies;
- contracts between the domain and backends;
- batch execution plans.

Must not expose concrete `wgpu` types.

#### `compute-cpu`

Responsible for:

- the reference implementation;
- execution on machines without WebGPU;
- differential tests;
- final result verification;
- small workloads where the GPU would be slower.

#### `compute-wgpu`

Responsible for:

- adapter/device/queue creation;
- pipelines;
- pipeline cache;
- persistent buffers;
- upload arenas;
- asynchronous readback;
- WGSL kernels;
- capability negotiation;
- device loss recovery;
- upload/dispatch/readback metrics.

#### `projection-core`

Responsible for:

- transforming authoritative state/events into a view allowed for each client;
- hiding private information;
- producing `ReplicationDelta`;
- not knowing about WebSocket, UDP, TCP, or concrete authentication.

#### `isekai-wasm`

Responsible for:

- adapting linear memory offsets and lengths;
- exposing numeric handles;
- asynchronous initialization;
- Worker integration;
- converting errors into stable codes/structures;
- never duplicating rules.

#### `isekai-capi`

Responsible for:

- `extern "C"` exports;
- versioned ABI;
- pointer validation;
- `catch_unwind` at the boundary;
- generational handles;
- status codes;
- creation/release functions;
- never exposing `Vec`, `String`, trait objects, or Rust enums.

### 4.3 Future domains

Domains such as physics, pathfinding, AI, and optimization should be added by feature slice.

A domain may contain:

- its own contracts;
- a Rust crate;
- tests;
- benchmarks;
- local documentation;
- integration with `domain-core` or `compute-api`.

Empty directories must not be created ahead of time. The local generator will create each slice when a real feature exists.

### 4.4 `libs/` boundary rule and multi-product domains (DEC-046)

A capability is born in `libs/domains` (Rust) or `packages/` (TypeScript) —
never duplicated inside an `app` — whenever more than one product needs
it, or it is reasonable to foresee that it will. An `app` (`apps/*`) should
only contain: domain composition, presentation/UI, and integration specific
to that host. This extends DEC-001 (Rust as the single source of logic) to
the multi-product axis: DEC-001 prevents duplicating Rust logic in another
language; this rule prevents duplicating domain logic between different
products of the same monorepo (DEC-045, single monorepo).

Initial domain map (see `docs/adr/ADR-0008-libs-boundary-and-domain-map.md`):

| Capability | Classification | Where it is born |
| --- | --- | --- |
| Narrative / story creation | generic domain | `libs/domains/narrative` |
| Session / campaign organization | generic domain | `libs/domains/session` |
| VTT interactive map (X6) | product-specific + generic wrapper | `apps/web-vtt` consumes `packages/x6-canvas`, shared with `apps/architecture-studio` (`docs/architecture/ai-control-plane.md` §16.8) |
| Procedural terrain/heightmap generation (heightmap seed, discrete-grid quantization) | generic domain | `libs/domains/procgen` (`generation-wasm`, `terrain-quantization` Rust/Wasm crates) — designed against the VTT's map-generation pipeline (`docs/research/vtt-map-and-terrain-construction-options.md`) but reclassified from an initial VTT-scoped `libs/vtt/` location (owner direction, 2026-08-04): not exclusive to the VTT, any product needing procedural heightmap generation can depend on it |
| Discord bot | external integration | its own service consuming `session`/`narrative` contracts, never internals |
| Session transcription | external integration (likely Python) | `python/` or a dedicated service, feeding `narrative` via contract |

The map above follows the rule in section 4.3: `narrative` and `session` are
born because there is already a declared intention for more than one
product to need them; the VTT map remains within the app until a second
product requires a map.

> **Footnote (2026-08-01, `docs/adr/ADR-0016-architecture-studio-scope-expansion.md`,
> Proposed):** the "VTT interactive map (X6)" row's `apps/web-vtt` label
> reads as inconsistent with `DEC-041` ("the VTT is a client-only route
> within [the Next.js Web host], not a standalone app") — flagged here, not
> resolved. Separately, ADR-0016 proposes that `apps/architecture-studio`
> also host a **generation-testing and visualization surface** for the VTT's
> procedural-generation pipeline (Rust/Wasm crates rendered via Three.js) —
> a distinct relationship from the one this table row already describes
> (sharing `packages/x6-canvas`): the new surface shares the VTT's Rust
> domain crate and the Isekai/Wasm pathway instead, not `x6-canvas`.

DEC-049 strengthens this boundary: reusable capabilities expose Grafting-owned
interfaces and isolate third-party runtime APIs inside the smallest useful
owning module/project boundary. It does not require one package per dependency.
Shared behavior is reused from its authoritative implementation rather than
copied into a second module, package, or application.

---

## 6. Proposed physical topology

### 6.1 Initial tree

```text
/
├── GRAFTING_MASTER_SOURCE.md
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── grafting.graph.json
├── .mcp.json
├── .ai/
│   ├── README.md
│   ├── registry/
│   ├── policies/
│   ├── skills/
│   ├── agents/
│   ├── prompts/
│   ├── workflows/
│   ├── context/
│   ├── contracts/
│   ├── adapters/
│   ├── evals/
│   ├── catalog/
│   ├── state/
│   ├── reports/
│   └── scripts/
├── .claude/
├── .codex/
├── .agents/
├── nx.json
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── Cargo.toml
├── Cargo.lock
├── rust-toolchain.toml
├── pyproject.toml
├── uv.lock
├── .python-version
├── global.json
├── Directory.Build.props
├── Directory.Packages.props
├── System.sln
├── apps/
│   ├── web-vtt/
│   ├── desktop-game/
│   └── architecture-studio/
├── libs/
│   ├── engine/
│   │   ├── contracts/
│   │   ├── domain-core/
│   │   ├── compute-api/
│   │   ├── compute-cpu/
│   │   ├── compute-wgpu/
│   │   └── projection-core/
│   ├── isekai/
│   │   ├── wasm-bridge/
│   │   └── capi-bridge/
│   ├── platform/
│   │   └── polymath/
│   ├── graph/
│   │   └── core/
│   └── domains/
│       ├── narrative/
│       └── session/
├── packages/
│   ├── isekai-web-client/
│   ├── polymath/
│   └── x6-canvas/
├── dotnet/
│   ├── Grafting.Isekai.Interop/
│   ├── Grafting.Isekai.Protocol/
│   └── Grafting.Polymath/
├── python/
│   ├── automation/
│   ├── data-tools/
│   └── experiments/
├── tools/
│   ├── ai-gateway/
│   ├── nx-plugin/
│   ├── generators/
│   ├── graph-extractors/
│   └── scripts/
├── graphs/
│   ├── authored/
│   ├── schemas/
│   └── views/
├── backlog/
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── runbooks/
│   ├── benchmarks/
│   ├── generated/
│   └── archive/superseded/
└── dist/
```

Directories associated with `OPEN` decisions must not be definitively populated before the corresponding gate closes. The tree is a direction; it is not authorization to create every empty directory.

Every Nx project created must contain:

```text
project.json
README.md
AGENTS.md
Graph IR metadata
src/
```

A local `CLAUDE.md` will only be created when there is a specific need for the Claude adapter.

### 6.2 Correct rule for manifests

There will be a single **workspace root and lockfile** per ecosystem, but local manifests will continue to exist when the toolchain requires them.

| Ecosystem | Unique at the root                              | Allowed/required in members                                             |
| ----------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| Rust        | workspace `Cargo.toml`, `Cargo.lock`     | one `Cargo.toml` per crate                                                    |
| Node        | `pnpm-workspace.yaml`, `pnpm-lock.yaml` | one `package.json` per package/app                                             |
| Python      | workspace `pyproject.toml`, `uv.lock`    | one `pyproject.toml` per packaged member                                    |
| .NET        | `System.sln`, central props and packages   | one `.csproj` and, if lock mode is adopted, `packages.lock.json` per project |

It is forbidden to create:

- a second `Cargo.lock` inside a member crate;
- a second `pnpm-lock.yaml`;
- another independent uv workspace without an ADR;
- a parallel .NET solution without explicit reason;
- committed virtual environments.

### 6.3 Deterministic outputs

Consumable artifacts must converge into:

```text
dist/
├── wasm/
│   └── engine/
├── native/
│   ├── win-x64/
│   ├── linux-x64/
│   └── osx-arm64/
├── dotnet/
├── python/
├── contracts/
└── docs/
```

Internal build directories are not public artifacts:

- `target/`;
- `bin/`;
- `obj/`;
- `.venv/`;
- `node_modules/`;
- local caches.

Nx must cache final artifacts or deterministic outputs, not entire environments.

---

## 7. Nx orchestration

### 7.1 Role

Nx must:

- know the projects;
- know the dependencies;
- build the task DAG;
- execute in order;
- parallelize independent tasks;
- compute hashes from inputs;
- restore outputs and logs;
- run only affected tasks in PRs;
- provide local generators;
- export the structural graph.

Nx must not:

- install toolchains during every target;
- sync `.venv` across multiple parallel tasks;
- hide undeclared external dependencies;
- cache actions with side effects;
- fake hermeticity the workspace doesn't have.

### 7.2 Cache rule

A task can only use `cache: true` when:

\[
f(\text, \text, \text)
======================
\text{deterministic outputs}
\]

Cacheable targets:

- compile;
- build;
- lint;
- deterministic unit test;
- codegen;
- generated documentation;
- benchmarks only when treated as artifacts, not as an absolute time comparison.

Non-cacheable targets:

- install/bootstrap;
- deploy;
- publish;
- signing;
- database migration;
- calls to external services;
- end-to-end tests against a mutable environment;
- lockfile update;
- mutable download without checksum.

Nx restores both declared files and terminal output. Inputs and outputs need to be adjusted per project, per the official documentation:

- [https://nx.dev/docs/features/cache-task-results](https://nx.dev/docs/features/cache-task-results)
- [https://nx.dev/docs/reference/project-configuration](https://nx.dev/docs/reference/project-configuration)

### 7.3 Minimal target convention

Every applicable project should expose:

| Target           | Function                       |
| ---------------- | ------------------------------ |
| `format:check` | check formatting         |
| `lint`         | static analysis             |
| `typecheck`    | type checking              |
| `test`         | unit tests              |
| `build`        | produce artifact              |
| `codegen`      | generate derived sources         |
| `bench`        | local benchmark                |
| `package`      | organize publishable artifact |

Specific targets:

- `build:wasm`;
- `build:native`;
- `test:abi`;
- `test:protocol`;
- `test:differential`;
- `test:gpu`;
- `docs:generate`;
- `docs:check`.

### 7.4 Conceptual dependencies

```text
contracts:codegen
    ├──> domain-core:build
    ├──> isekai-web-client:build
    └──> isekai-dotnet-protocol:build

domain-core:build
    ├──> isekai-wasm-bridge:check
    └──> isekai-capi-bridge:build

isekai-wasm-bridge:check
    └──> (not an Nx target -- `libs/isekai/wasm-bridge`'s own co-located
         `package.json` `postinstall` script runs `wasm-pack` into that
         same directory on a plain `pnpm install`; consuming apps just
         depend on `@grafting/isekai-wasm` as `workspace:*`,
         DEC-055/ADR-0017)

isekai-capi-bridge:build
    └──> isekai-dotnet-interop:build

isekai-dotnet-interop:build
    └──> desktop-game:build
```

### 7.5 Explicit project before sophisticated plugins

In the initial phase, Rust, Python, and utilities must be representable with `project.json` and native commands.

A local Nx plugin should only abstract something after:

- there are at least two real occurrences;
- the inputs/outputs are well understood;
- the manual command has been tested;
- the abstraction reduces maintenance.

Do not create a "universal" generic executor that recreates Cargo, uv, or MSBuild.

### 7.6 .NET integration

The official `@nx/dotnet` plugin must be evaluated in a spike:

- `.csproj` detection;
- project dependencies;
- inferred targets;
- outputs;
- compatibility with the chosen engine;
- behavior on machines without the .NET SDK;
- migration cost.

If the spike fails, the fallback is:

- explicit projects;
- `dotnet restore/build/test/publish`;
- dependencies declared in the graph;
- without abandoning Nx.

For deterministic restore:

- NuGet versions are centralized in `Directory.Packages.props`;
- `RestorePackagesWithLockFile` must be enabled;
- `packages.lock.json` must be committed per project;
- CI uses `dotnet restore --locked-mode`;
- `bin/` and `obj/` files are neither sources nor lockfiles.

References:

- [https://nx.dev/docs/technologies/dotnet/introduction](https://nx.dev/docs/technologies/dotnet/introduction)
- [https://nx.dev/docs/technologies/dotnet/guides/migrate-from-nx-dotnet-core](https://nx.dev/docs/technologies/dotnet/guides/migrate-from-nx-dotnet-core)

### 7.7 Project identity and tags

Nx projects must use stable names and predictable tags.

Initial categories:

```text
scope:engine
scope:domain
scope:host
scope:tooling
scope:contracts

lang:rust
lang:typescript
lang:csharp
lang:python
lang:schema

platform:web
platform:desktop
platform:server
platform:cross

type:app
type:lib
type:binding
type:generator
type:test
```

Boundary rules:

- `scope:engine` does not depend on `scope:host`;
- `scope:domain` does not depend on bindings;
- hosts depend on wrappers/bindings, not on the core's internal details;
- `compute-api` does not depend on `compute-wgpu`;
- contracts do not depend on generated consumer code;
- tools can read manifests, but do not enter the product's runtime.

### 7.8 Polyglot dependencies in the graph

Nx must not "guess" Rust or Python dependencies from TypeScript imports.

Initial phase:

- declare `implicitDependencies` between polyglot projects;
- use generators to update those dependencies;
- validate the graph in CI.

Later phase:

- a local plugin can read `cargo metadata`;
- a local plugin can read uv's members and sources;
- `@nx/dotnet` can provide `.csproj` dependencies;
- generated dependencies must be compared against the declared graph.

The local plugin must not implement a new resolver. It only translates toolchain metadata into Nx's project model.

### 7.9 Explicit Rust project example

```json
{
  "name": "engine-compute-wgpu",
  "root": "libs/engine/compute-wgpu",
  "projectType": "library",
  "tags": [
    "scope:engine",
    "lang:rust",
    "platform:cross",
    "type:lib"
  ],
  "implicitDependencies": [
    "engine-compute-api"
  ],
  "targets": {
    "check": {
      "executor": "nx:run-commands",
      "options": {
        "command": "cargo check -p engine-compute-wgpu"
      },
      "cache": true,
      "inputs": [
        "{projectRoot}/**/*",
        "{workspaceRoot}/Cargo.toml",
        "{workspaceRoot}/Cargo.lock",
        "{workspaceRoot}/rust-toolchain.toml"
      ]
    }
  }
}
```

The example is conceptual. The real crate name and shared inputs must be defined via `namedInputs`.

### 7.10 Build directories and concurrency

Rust:

- `target/` can continue to be shared by Cargo locally;
- Nx must not publish `target/` as an artifact;
- publishable builds copy only final files into `dist/`;
- overly fragmented Cargo targets can contend for the same lock;
- prefer Cargo tasks with enough granularity to avoid dozens of redundant processes.

Python:

- `uv sync` happens before parallel execution;
- parallel tasks use `--no-sync`.

.NET:

- restore happens before the build matrix;
- targets should not perform implicit restore when `--no-restore` is safe.

Node:

- `pnpm install` happens before Nx;
- targets do not modify the lockfile or `node_modules`.

### 7.11 Global inputs

Build hashes must consider, depending on the target:

- the ecosystem's lockfile;
- the root manifest;
- the member manifest;
- the pinned toolchain;
- the schema;
- the build profile;
- the target triple/RID;
- features;
- environment variables that change output;
- scripts actually executed.

Do not depend on a hidden external variable, such as `RUSTFLAGS`, without declaring it as an input or neutralizing it in CI.

---

## 8. Python management with uv and Nx

### 8.1 Model

Python will be used heavily for:

- HTTP requests;
- automation;
- data generation;
- experimentation;
- AI;
- analysis;
- CI tools;
- documentation;
- maintenance scripts.

uv is the source of truth for:

- dependency resolution;
- lock;
- environment creation;
- execution;
- package build.

Nx only schedules these operations.

### 8.2 Workspace

The uv workspace will have:

- a root `pyproject.toml`;
- a cross-platform `uv.lock`;
- members with their own `pyproject.toml`;
- local dependencies declared as workspace sources;
- dependency groups where appropriate.

uv workspaces share a single lockfile, but each package keeps its own declaration:

- [https://docs.astral.sh/uv/concepts/projects/workspaces/](https://docs.astral.sh/uv/concepts/projects/workspaces/)

### 8.3 `.venv`

The rule is:

> one environment per checkout and per operating system, reconstructible from `uv.lock`.

`.venv`:

- is not universal;
- is not an Nx artifact;
- is not shared Windows ↔ WSL;
- is not sent to the remote cache;
- is not run in parallel by `sync` jobs;
- is not committed.

### 8.4 Avoiding races in parallel tasks

Local and CI flow:

1. run `uv sync --locked` once during bootstrap;
2. run Nx tasks in parallel;
3. within tasks use:

```bash
uv run --locked --no-sync --package <package> <command>
```

This prevents multiple targets from trying to mutate `.venv` simultaneously.

In CI:

```bash
uv lock --check
uv sync --locked
nx affected -t lint test build
```

The behavior of `--locked`, `--frozen`, and `--no-sync` is documented at:

- [https://docs.astral.sh/uv/concepts/projects/sync/](https://docs.astral.sh/uv/concepts/projects/sync/)

### 8.5 Packages with native builds

Python packages that depend on native wheels must:

- use pinned versions;
- prefer official wheels;
- declare platform markers;
- be tested in the OS/architecture matrix;
- never reuse `.venv` from another platform;
- produce their own wheels on native runners when necessary.

The Nx cache may store:

```text
dist/python/<package>/<version>/<platform-tag>/*.whl
```

It must not store the installed environment.

### 8.6 HTTP requests

Libraries such as `requests` must be a dependency of the package that actually uses them.

Example:

```bash
uv add --package automation requests
```

Do not manually install dependencies with `pip` inside `.venv`.

### 8.7 Throwaway scripts versus production automation

- Small experiments can use inline metadata recognized by uv.
- Automation used by CI or release must be a tested member package.
- Scripts must not implicitly depend on the current directory.
- Input, output, and side effects must be explicit.

---

## 9. Node, pnpm, and the Wasm package

### 9.1 pnpm policy

Use:

- the standard content-addressed store;
- workspace protocol;
- a single lockfile;
- Corepack or a pinned version;
- frozen install in CI.

Do not make the experimental Global Virtual Store a requirement.

### 9.2 Wasm codegen (DEC-055)

Generated Wasm bindings (`.wasm`, loader, TypeScript definitions,
ABI/protocol metadata, strictly necessary glue) never live inside a
separate `packages/` technical package, not even gitignored. Instead, the
Rust crate itself (`libs/isekai/wasm-bridge` and equivalents) is *also* a
normal pnpm workspace package: a `package.json` co-located right next to
its `Cargo.toml`, with a `postinstall` script that runs `wasm-pack build
--target web --out-dir pkg`, writing generated output into that same
directory (gitignored). Consuming apps depend on it exactly like any other
workspace package -- `"@grafting/isekai-wasm": "workspace:*"` in
`dependencies`, then a normal `import` -- no custom build script, no Nx
target/`project.json` entry for this at all. A plain `pnpm install`
already performs the conversion, the same as any npm package with native
bindings. There is no standalone `packages/isekai-wasm`-style intermediate
package; `@grafting/isekai-wasm` and `@grafting/vtt-generation-wasm` are
themselves the crates' own package.json identities. See
`docs/adr/ADR-0017-wasm-bindings-colocated-with-crate.md` for the full
rationale, the two earlier designs it supersedes (an app-owned Nx target,
then an app-owned `package.json` script), and the trade-offs.

The Rust crate must not contain domain logic rewritten in TypeScript.

### 9.3 Web wrapper

`packages/isekai-web-client` must offer an idiomatic API:

- Worker creation/termination;
- batch submission;
- Promise per job;
- cooperative cancellation;
- device loss handling;
- structured result decoding;
- transferables management.

Per DEC-055, this package depends on `@grafting/isekai-wasm` as a normal
`workspace:*` dependency and imports it statically, same as before this
decision -- what changed is only where `@grafting/isekai-wasm`'s own
`package.json` lives (co-located in `libs/isekai/wasm-bridge`, not a
separate `packages/isekai-wasm`).

The wrapper must not expose memory offsets to React components.

---

## 10. Data contracts

### 10.1 Two data paths

#### Structured path

Use FlatBuffers for:

- Commands;
- DomainEvents;
- ReplicationDeltas;
- Snapshots;
- transport envelopes;
- heterogeneous results;
- versionable messages.

#### Hot numeric path

Use raw arrays, preferably Structure of Arrays, for:

- positions;
- matrices;
- vectors;
- costs;
- gradients;
- candidates;
- indices;
- large homogeneous batches.

Example:

```text
positions_x: Float32Array
positions_y: Float32Array
positions_z: Float32Array
entity_ids:  Uint32Array
```

Do not wrap millions of floats in individual FlatBuffers objects.

### 10.2 Location

- Contracts exclusive to a domain live in the domain.
- Global envelopes live in `libs/engine/contracts`.
- Generated code goes into fixed consumer directories.

Example:

```text
libs/domains/physics/contracts/*.fbs
packages/isekai-web-client/src/generated/
dotnet/Grafting.Isekai.Protocol/Generated/
libs/engine/domain-core/src/generated/
```

### 10.3 Generation

`flatc` must:

- have a pinned version;
- be invoked by a deterministic Nx target;
- produce TS, C#, and Rust;
- fail on invalid schema;
- produce declared outputs;
- run during bootstrap.

Generated code:

- is not the source of truth;
- does not need to be committed by default;
- must be ignored when always reproducible;
- must exist before typechecking/IDE use;
- must be regenerated automatically in build/CI.

If a consumer or IDE requires committed code, the exception must be recorded via an ADR and validated with `codegen:check`.

### 10.4 Evolution

Minimum rules:

- new table fields are added at the end or use explicit IDs;
- removed fields are marked deprecated, not erased;
- existing defaults are not changed without migration;
- FlatBuffers `struct` is reserved for truly stable layouts;
- untrusted messages are verified before use;
- protocol version stays in the envelope.

References:

- [https://flatbuffers.dev/](https://flatbuffers.dev/)
- [https://flatbuffers.dev/evolution/](https://flatbuffers.dev/evolution/)
- [https://flatbuffers.dev/languages/typescript/](https://flatbuffers.dev/languages/typescript/)
- [https://flatbuffers.dev/languages/c_sharp/](https://flatbuffers.dev/languages/c_sharp/)
- [https://flatbuffers.dev/languages/rust/](https://flatbuffers.dev/languages/rust/)

---

## 11. FFI and memory

### 11.1 Main rule

> Whoever allocates controls the lifecycle and offers the compatible release operation.

This does not mean all memory needs to be copied. It means ownership cannot be implicit.

### 11.2 What can cross the C ABI

Allowed:

- fixed-width integers;
- fixed-width floats;
- pointer + length;
- opaque handles;
- versioned `#[repr(C)]` structs;
- status codes;
- callbacks with an explicit contract.

Forbidden:

- `Vec<T>`;
- `String`;
- `&str`;
- `Box<T>` without an opaque API;
- Rust enum without a fixed representation;
- trait object;
- panic;
- C# exception;
- ABI-dependent `usize`, `long`, or `bool`.

### 11.3 Handles

Use 64-bit generational handles:

```text
EngineHandle
ProblemHandle
JobHandle
BufferHandle
```

Properties:

- `0` is invalid;
- index and generation prevent trivial use-after-free;
- the logical type is validated;
- duplicate release returns an error;
- handles are not public pointers.

### 11.4 Synchronous call

For small data or short work:

```text
host lends pointer + length
Rust processes during the call
Rust does not retain the pointer
call returns
host can move/free the memory
```

In C#, managed memory must remain pinned only during the call.

### 11.5 Asynchronous call

For long CPU work or GPU:

```text
host submits batch
Rust copies to its own arena or receives explicit ownership
Rust returns JobHandle
host polls/waits on status
Rust delivers BufferHandle
host reads within a lease
host releases BufferHandle
```

A pinned C# pointer MUST NOT be retained after the `submit` call returns.

### 11.6 Conceptual API

```c
EngineStatus engine_get_abi_info(EngineAbiInfo* out_info);

EngineStatus engine_create(
    const EngineCreateInfo* create_info,
    EngineHandle* out_engine
);

EngineStatus engine_submit(
    EngineHandle engine,
    const uint8_t* command_data,
    uint64_t command_length,
    JobHandle* out_job
);

EngineStatus engine_job_poll(
    JobHandle job,
    JobState* out_state
);

EngineStatus engine_job_take_result(
    JobHandle job,
    BufferHandle* out_buffer
);

EngineStatus engine_buffer_view(
    BufferHandle buffer,
    const uint8_t** out_data,
    uint64_t* out_length
);

EngineStatus engine_buffer_release(BufferHandle buffer);
EngineStatus engine_job_release(JobHandle job);
EngineStatus engine_shutdown(EngineHandle engine);
EngineStatus engine_destroy(EngineHandle engine);
```

### 11.7 Wasm

In Wasm:

- public references are offsets and lengths;
- TypedArrays are views into linear memory;
- `memory.grow` can invalidate previous views;
- views must be recreated after growth;
- arenas should reduce frequent growth;
- the Worker must own the Wasm instance.

Conceptual API:

```text
reserve_input(length) -> offset
commit_input(offset, length) -> JobHandle
job_poll(job) -> state
job_result(job) -> { offset, length, BufferHandle }
buffer_release(handle)
```

### 11.8 Copy budget

| Boundary                 | V1 target                                                        |
| ------------------------- | -------------------------------------------------------------- |
| C# → Rust synchronous      | zero copy, memory pinned during the call                 |
| C# → Rust asynchronous    | one copy into native memory                                |
| Rust → C# synchronous view | zero copy within lease                                    |
| Main thread → Worker     | `ArrayBuffer` ownership transfer when possible |
| JS → Wasm arena          | one copy when data originated outside Wasm                  |
| Wasm view → Rust         | zero copy within linear memory                          |
| CPU/Wasm → GPU           | one explicit upload                                           |
| GPU → CPU                | one explicit readback                                           |
| network                      | copies depend on the runtime and transport                       |

Correct formulation:

> The system aims to avoid full deserialization and redundant copies, keeping at most the intentional copies required by each memory domain.

---

## 12. ABI: version and lifecycle

### 12.1 Version axes

| Axis            | Example                      | What it protects                           |
| --------------- | ----------------------------- | ---------------------------------------- |
| Product         | `1.4.0`                    | user-perceived release         |
| ABI             | `2.1`                      | native library layout and functions |
| Wire protocol   | `3.0`                      | client/server messages              |
| Schema revision | per-contract identifiers | FlatBuffers evolution                  |
| Save format     | `5`                        | persisted snapshots/savegames         |

Do not infer protocol compatibility solely from the product version.

### 12.2 ABI policy

- `ABI_MAJOR`: incompatible break.
- `ABI_MINOR`: compatible append-only extension.
- product patch: internal implementation without contractual change.

Every public struct begins with:

```c
uint32_t struct_size;
```

New fields are added only at the end.

### 12.3 Capability negotiation

`EngineAbiInfo` must report:

- major;
- minor;
- size;
- build ID;
- target;
- feature flags;
- CPU backend;
- GPU backend;
- async support;
- supported protocol version.

The C# wrapper validates this at startup.

### 12.4 Lifecycle

#### Engine

```text
Creating → Ready → ShuttingDown → Destroyed
                  ↘
                   Poisoned → Destroyed
```

#### Job

```text
Pending → Running → Completed → Released
                  ↘ Failed ───→ Released
                  ↘ Cancelled → Released
```

#### Buffer

```text
OwnedByRust → ViewLeased → OwnedByRust → Released
```

### 12.5 Panic

Every `extern "C"` export must protect the boundary.

If a recoverable panic occurs:

- convert to status;
- log internal diagnostics;
- mark the engine as poisoned when the state cannot be guaranteed;
- allow querying the error and destruction;
- do not continue simulating in a doubtful state.

`catch_unwind` does not capture builds with `panic=abort`; the compilation policy must be deliberate.

Reference:

- [https://doc.rust-lang.org/nomicon/ffi.html](https://doc.rust-lang.org/nomicon/ffi.html)

### 12.6 C# wrapper

The wrapper must use:

- `LibraryImport` when compatible;
- `SafeHandle`;
- `Span<T>` only within a valid lifetime;
- centralized status translation;
- idempotent shutdown;
- packaging per RID;
- ABI test before first real use.

---

## 13. GPU and the single solver

### 13.1 Ownership

Closed rule:

> Rust is the sole owner of GPU resources for mathematical computation. Three.js and the C# engine own the rendering resources.

This produces:

- one solver;
- one Rust dispatcher;
- one WGSL collection;
- two distribution formats;
- separate logical devices when the renderer also uses GPU.

### 13.2 The same backend on Web and Desktop

`wgpu` runs:

- natively on Vulkan, Metal, D3D12, and OpenGL;
- on Wasm over WebGPU or WebGL2.

General compute requires WebGPU; WebGL2 must not be treated as an equivalent fallback for compute. When WebGPU is unavailable, the CPU backend must take over.

Reference:

- [https://github.com/gfx-rs/wgpu](https://github.com/gfx-rs/wgpu)

### 13.3 Backend contents

`compute-wgpu` must control:

- `Instance`;
- `Adapter`;
- `Device`;
- `Queue`;
- shader modules;
- bind groups;
- compute pipelines;
- persistent buffers;
- staging buffers;
- ring buffers;
- submission IDs;
- readback pool;
- device loss.

### 13.4 Resident data

For a future solver:

1. the model is loaded;
2. matrices and vectors persist on the GPU;
3. each iteration sends only parameters/deltas;
4. multiple kernels are chained;
5. readback occurs only for scalars or the final solution;
6. the solution is validated on the CPU.

Avoid:

```text
upload matrix → dispatch → readback matrix
```

on every iteration.

### 13.5 Solver versus kernel division

Rust:

- modeling;
- search policy;
- macro control of iterations;
- stopping criteria;
- memory management;
- scheduling;
- validation.

WGSL:

- parallel evaluation;
- matvec;
- reductions;
- scoring;
- constraint evaluation;
- vector update;
- dense or massively parallel operations.

`wgpu` does not automatically turn a regular Rust function into a compute shader. WGSL kernels are the single source for GPU.

### 13.6 Async jobs

Conceptual internal API:

```rust
trait ComputeBackend {
    fn capabilities(&self) -> ComputeCapabilities;
    fn upload_problem(&mut self, problem: &ProblemData) -> ProblemHandle;
    fn submit(&mut self, plan: ComputePlan) -> JobHandle;
    fn poll(&mut self, job: JobHandle) -> JobState;
    fn take_result(&mut self, job: JobHandle) -> Result<ComputeResult, ComputeError>;
    fn release_problem(&mut self, problem: ProblemHandle);
}
```

Avoid one FFI call per numeric operation. `ComputePlan` must represent a batch large enough to amortize dispatch.

### 13.7 Suitable workloads

Good candidates:

- thousands of independent evaluations;
- linear algebra;
- distance fields;
- AI scoring;
- relaxations;
- reduction of large vectors;
- offline generation;
- a solver with resident state and compact response.

Bad candidates:

- business rules;
- highly branched and small flows;
- tasks smaller than the upload cost;
- logic that requires bit-for-bit determinism;
- huge output consumed by the renderer every frame.

### 13.8 Limit of device separation

If Rust computes millions of positions that Three.js needs to render every frame:

```text
Rust GPU → CPU → renderer GPU
```

the readback/upload can dominate.

In that case, a future ADR will choose between:

1. running the visual compute in the renderer;
2. moving rendering to Rust;
3. implementing external-memory interop per backend.

Do not generalize this exception to pathfinding, AI, or a solver with compact output.

---

## 14. Threads and asynchrony

### 14.1 Web

Main thread:

- React/UI;
- Three.js;
- input;
- presentation;
- frame loop.

Worker:

- Wasm instance;
- simulation state;
- `wgpu` compute;
- jobs;
- protocol decode/encode;
- optionally WebSocket in a future phase.

Rules:

- do not block the main thread;
- do not use busy polling;
- communicate via messages;
- transfer `ArrayBuffer` when ownership can change;
- do not introduce `SharedArrayBuffer` in V1;
- handle Worker termination and crash.

### 14.2 Desktop

The C# host must not run heavy jobs on the UI/render thread.

Model:

- C# submits;
- Rust schedules;
- GPU/worker executes;
- C# receives completion;
- the result is consumed at a safe point in the frame.

Do not call `device.poll(Wait)` on the main thread.

### 14.3 Readback

GPU readback must use:

- staging buffer;
- submission;
- callback/future;
- buffer pool;
- short signaling;
- later consumption.

While a buffer is mapped by the CPU, it must not be used simultaneously by the GPU.

Reference:

- [https://docs.rs/wgpu/latest/wgpu/struct.CommandBuffer.html](https://docs.rs/wgpu/latest/wgpu/struct.CommandBuffer.html)

---

## 15. Multiplayer

### 15.1 Correct architecture name

V1:

> Authoritative replication with a journal of accepted commands and periodic snapshots.

Do not call it Event Sourcing.

### 15.2 Distinct types

| Type                 | Meaning                                           |
| -------------------- | ----------------------------------------------------- |
| `ClientCommand`    | intent sent by the client                       |
| `AcceptedCommand`  | authenticated, ordered, and accepted command                |
| `DomainEvent`      | semantic fact produced by the domain               |
| `ReplicationDelta` | projection transmissible to a specific client |
| `Snapshot`         | persistable authoritative state                      |

`DomainEvent` is not `ReplicationDelta`.

### 15.3 Flow

```text
ClientCommand
  → authentication/authorization on the host
  → ordering and deduplication
  → batch to Rust
  → DomainEvents + state hash
  → journal
  → per-client projection
  → ReplicationDelta
  → transport
```

### 15.4 Agnostic core

The core does not know about:

- sockets;
- IP;
- reconnection;
- TLS;
- database;
- queues;
- concrete authentication.

The host injects commands and collects results.

### 15.5 Journal

Minimum record:

- tick;
- sequence;
- command ID;
- logical client ID;
- AcceptedCommand;
- DomainEvents;
- state hash;
- core version;
- protocol version.

### 15.6 Snapshot

Minimum content:

- authoritative state;
- RNG state;
- last sequence;
- state hash;
- core version;
- protocol/save version.

### 15.7 Recovery

```text
load the most recent snapshot
→ apply subsequent AcceptedCommands
→ recompute state hash
→ compare
→ release the session
```

Full Event Sourcing will only be adopted if events become the primary source and there is a formal upcasting/migration policy.

---

## 17. Generators and scaffolding

### 17.1 Local plugin

A local Nx plugin will be created after the initial scaffold stabilizes.

Planned generators:

- `domain`;
- `rust-crate`;
- `flatbuffer-contract`;
- `python-package`;
- `web-package`;
- `dotnet-wrapper`;
- `adr`;
- `benchmark`.

### 17.2 Domain generator

Input:

- name;
- tags;
- needs a contract?;
- needs compute?;
- needs a public binding?;

Minimum output:

- directory;
- member manifest;
- `project.json`;
- tests;
- local documentation;
- workspace update;
- graph dependencies.

Do not create bindings for every domain automatically. Prefer an aggregated engine API.

### 17.3 Adoption rule

During the bootstrap phase, the first structure can be created manually by the agent.

After the generator passes its tests:

- new standardized projects must use the generator;
- manual topology changes must be justified;
- the generator must be updated when the convention changes.

---

## 18. CI/CD

### 18.1 Principles

- installation happens before Nx;
- cacheable tasks do not perform installation;
- runners use lockfiles;
- cache is partitioned by OS, architecture, profile, and toolchain;
- real GPU is tested separately from CPU CI;
- publish/sign/deploy are never restored from cache.

### 18.2 Pull Request pipeline

Steps:

1. checkout;
2. validate toolchain versions;
3. `pnpm install --frozen-lockfile`;
4. `uv lock --check`;
5. `uv sync --locked`;
6. `cargo metadata` and lock check;
7. `dotnet restore --locked-mode`, when applicable;
8. codegen;
9. `nx affected` for format/lint/typecheck/test/build;
10. validate ABI and protocol;
11. extract and validate Graph IR;
12. block forbidden architectural relations;
13. generate context packs and documentation;
14. validate `.ai/`, registries, skills, and references;
15. compile prompts and generate adapters;
16. detect drift;
17. run quick evals;
18. review permission and MCP expansion;
19. check for unexpected artifacts.

### 18.3 Native matrix

| Runner      | Artifacts                                 |
| ----------- | ----------------------------------------- |
| Linux x64   | Wasm, `.so`, Rust/Python/TS tests       |
| Windows x64 | `.dll`, C# wrapper, desktop V1          |
| macOS arm64 | `.dylib`, future Metal/wgpu validation |

Do not assume a Linux build is equivalent to validating DirectX or Metal.

### 18.4 GPU tests

Normal pipeline:

- validates WGSL;
- compiles the backend;
- tests CPU fallback;
- runs tests without requiring a dedicated GPU.

GPU pipeline, nightly/manual:

- runs on known hardware;
- collects adapter/features/limits;
- runs benchmarks;
- tests device loss when possible;
- compares result against CPU within tolerance;
- publishes a report, not cached as eternal truth.

### 18.5 Release

While everything is internal:

- one product version;
- artifact manifest;
- separate ABI/protocol versions;
- build ID and git SHA;
- checksums.

Manifest:

```json
{
  "productVersion": "0.1.0",
  "coreVersion": "0.1.0",
  "abi": { "major": 1, "minor": 0 },
  "protocol": { "major": 1, "minor": 0 },
  "gitSha": "<sha>",
  "target": "x86_64-pc-windows-msvc",
  "profile": "release",
  "features": ["cpu", "wgpu"]
}
```

Nx Release may coordinate versions and changelogs, but Cargo/NuGet/Python publication will require explicit adapters. Do not assume automatic polyglot publication.

---

## 19. Testing

### 19.1 Pyramid

1. pure domain tests;
2. property-based tests;
3. CPU versus GPU differential tests;
4. contract tests;
5. ABI tests;
6. binding integration tests;
7. host tests;
8. e2e;
9. benchmarks.

### 19.2 Domain

Test:

- invariants;
- invalid commands;
- transitions;
- controlled RNG;
- replay;
- state hash;
- snapshots.

### 19.3 CPU versus GPU

For each kernel:

- generate small cases;
- run on CPU;
- run on GPU;
- compare within tolerance;
- include NaN, infinity, empty, boundary cases;
- test devices with minimal features.

Do not require bit-for-bit floating-point equality without mathematical justification.

### 19.4 ABI

Test:

- compatible version;
- incompatible major;
- smaller/larger `struct_size`;
- invalid handle;
- double release;
- use-after-release;
- null pointer;
- empty buffer;
- internal panic;
- shutdown with pending jobs;
- missing library;
- wrong architecture.

### 19.5 Memory

Test:

- leaks;
- arena growth;
- leases;
- short pinning;
- Worker termination;
- `memory.grow`;
- device loss;
- release after cancellation.

---

## 23. Initial backlog

### Epic A — Decisions and proofs of concept

| ID    | Work              | Depends on  | Acceptance criteria                           |
| ----- | ---------------------- | ----------- | --------------------------------------------- |
| A-001 | Web host ADR       | —          | GATE-001 closed with justification            |
| A-002 | C# engine ADR      | —          | GATE-002 closed and P/Invoke risk assessed |
| A-003 | V1 platforms ADR | —          | explicit OS/arch matrix                  |
| A-004 | Determinism ADR   | —          | required levels defined                    |
| A-005 | Rust/C# C ABI spike   | A-002       | create/execute/destroy and error work       |
| A-006 | Wasm/Worker spike   | A-001       | batch processed off the main thread          |
| A-007 | Native `wgpu` spike  | —          | compute + async readback                |
| A-008 | Web `wgpu` spike     | A-006       | same WGSL runs on WebGPU                  |
| A-009 | Copy benchmark  | A-005,A-006 | copy budget measured                  |
| A-010 | Evaluate `@nx/dotnet` | A-002       | adopt or record fallback                  |

### Epic B — Workspace foundation

| ID    | Work                | Depends on   | Acceptance criteria                       |
| ----- | ----------------------- | ------------ | ----------------------------------------- |
| B-001 | Create pnpm/Nx workspace | A-001        | executable graph                         |
| B-002 | Create Cargo workspace   | —           | `cargo check --workspace`               |
| B-003 | Create uv workspace      | —           | `uv lock --check` and example package      |
| B-004 | Create .NET solution    | A-002        | minimal restore/build                     |
| B-005 | Pin toolchains        | B-001..B-004 | reproducible versions                   |
| B-006 | Create bootstrap         | B-005        | installs/syncs once                |
| B-007 | Configure Nx cache     | B-001        | second build restores output               |
| B-008 | Configure affected     | B-007        | local change runs only dependents |
| B-009 | Initial Linux CI        | B-006        | green PR on clean checkout                |
| B-010 | Initial Windows CI      | B-004,B-006  | DLL and C# tests green                |

### Epic C — Core and contracts

| ID    | Work                     | Depends on        | Acceptance criteria             |
| ----- | ---------------------------- | ----------------- | ------------------------------- |
| C-001 | Create `domain-core`         | B-002             | pure crate with no host/network/GPU |
| C-002 | Define minimal Command      | C-001             | validation and test             |
| C-003 | Define minimal DomainEvent  | C-002             | tested semantic event       |
| C-004 | Define minimal Snapshot     | C-001             | round trip and hash               |
| C-005 | Configure `flatc`          | B-001,B-002,B-004 | TS/C#/Rust generated              |
| C-006 | Define schema evolution | C-005             | compatibility test        |
| C-007 | Implement state hash       | C-001             | replay reproduces hash             |
| C-008 | Create property tests         | C-002..C-004      | invariants covered            |

### Epic D — Isekai, ABI, and bindings

| ID    | Work                         | Depends on   | Acceptance criteria                 |
| ----- | -------------------------------- | ------------ | ----------------------------------- |
| D-001 | Define `EngineAbiInfo`         | A-005        | compatibility tested             |
| D-002 | Implement handles              | C-001        | generation and double-release tested |
| D-003 | Implement engine lifecycle     | D-002        | states and poison tested           |
| D-004 | Implement buffer lease         | D-002        | view/release without leak               |
| D-005 | Export `isekai-capi` v1       | D-001..D-004 | header and DLL                        |
| D-006 | Create `Grafting.Isekai.Interop` | D-005        | `SafeHandle` and smoke test         |
| D-007 | Create `isekai-wasm`             | C-001,D-002  | offsets/handles tested            |
| D-008 | Create `isekai-web-client`       | D-007        | Promise/job/cancel/shutdown         |
| D-009 | Memory test                | D-006,D-008  | no leak in the target scenario           |

### Epic E — Compute

| ID    | Work                 | Depends on  | Acceptance criteria              |
| ----- | ------------------------ | ----------- | -------------------------------- |
| E-001 | Create `compute-api`     | C-001       | domain does not depend on `wgpu` |
| E-002 | Create `compute-cpu`     | E-001       | correct baseline                 |
| E-003 | Choose pilot workload | A-007,A-008 | dataset and metric defined     |
| E-004 | Create single WGSL        | E-003       | validates native and Web              |
| E-005 | Create `compute-wgpu`    | E-001,E-004 | device/pipeline/job              |
| E-006 | Persistent buffers     | E-005       | amortized upload                |
| E-007 | Async readback     | E-005       | no wait on UI             |
| E-008 | CPU fallback             | E-002,E-005 | capability switch tested        |
| E-009 | Differential test        | E-002,E-005 | tolerance approved             |
| E-010 | Decision benchmark     | E-006,E-007 | range in which GPU wins           |

### Epic F — Hosts

| ID    | Work                     | Depends on  | Acceptance criteria          |
| ----- | ---------------------------- | ----------- | ---------------------------- |
| F-001 | Web scaffold                 | A-001,B-001 | app starts                   |
| F-002 | Integrate Worker/Wasm         | D-008,F-001 | state comes from Rust           |
| F-003 | Integrate Three.js            | F-001       | renderer separate from compute |
| F-004 | Desktop scaffold             | A-002,B-004 | app starts                   |
| F-005 | Integrate DLL                 | D-006,F-004 | state comes from Rust           |
| F-006 | Native packaging             | F-005       | correct DLL per RID          |
| F-007 | Shared vertical slice | F-002,F-005 | equivalent behavior    |

### Epic G — Automation and documentation

| ID    | Work                | Depends on  | Acceptance criteria               |
| ----- | ----------------------- | ----------- | --------------------------------- |
| G-001 | Create `AGENTS.md`      | B-001       | correct rules and commands        |
| G-002 | Create `CLAUDE.md`      | G-001       | short adapter, no duplication |
| G-003 | Generate repo map          | B-001       | reproducible derived file    |
| G-004 | Generate artifact manifest | D-001       | correct versions and target        |
| G-005 | ADR template         | —          | standardized new ADR              |
| G-006 | Crate generator      | B-001,B-002 | valid crate and graph            |
| G-007 | Domain generator   | G-006,C-005 | complete slice                    |
| G-008 | `docs:check`          | G-003,G-004 | CI detects drift                 |

### Epic H — Future multiplayer

| ID    | Work                 | Depends on  | Acceptance criteria           |
| ----- | ------------------------ | ----------- | ----------------------------- |
| H-001 | Authoritative host ADR | GATE-004    | GATE-004 closed              |
| H-002 | AcceptedCommand          | C-002       | order/dedup tested          |
| H-003 | Journal                  | H-002       | append/recovery               |
| H-004 | Snapshot recovery        | C-004,H-003 | validated hash                 |
| H-005 | Projection core          | C-003       | private information isolated  |
| H-006 | ReplicationDelta         | H-005       | client-specific delta |
| H-007 | Transport adapter        | H-001,H-006 | core remains agnostic      |

---

### Epic I — Knowledge Plane and Graph IR

| ID    | Work                            | Depends on  | Acceptance criteria                            |
| ----- | ----------------------------------- | ----------- | ---------------------------------------------- |
| I-001 | Knowledge & Automation Plane ADR | —          | authority and documentary lifecycle defined    |
| I-002 | Graph IR v1                         | I-001       | schemas, IDs, and evidence validated            |
| I-003 | Per-project operational/API template | I-001       | README, AGENTS, metadata, generated API baseline, `api-check`, and behavioral contracts validated |
| I-004 | Nx → Graph IR extractor             | I-002,B-001 | reproducible projects/targets/edges          |
| I-005 | Context pack v1                     | I-002,G-001 | task generates a small, traceable package         |
| I-006 | Read-only Architecture Studio       | I-002,I-004 | navigable subgraph without editing derived facts |
| I-007 | Drift check                         | I-003,I-004 | CI detects outdated documentation/graph  |

### Epic J — AI Control Plane

| ID    | Work                          | Depends on        | Acceptance criteria                                 |
| ----- | --------------------------------- | ----------------- | ----------------------------------------------------- |
| J-001 | Create `.ai/` structure           | I-001             | valid registry, policies, contracts, and state      |
| J-002 | Install AI System Maintainer     | J-001,B-003       | observe/audit tested via uv                       |
| J-003 | Capabilities and agents registry | J-001             | unique IDs and valid schemas                      |
| J-004 | Skill lifecycle and adapters        | J-003,G-001,G-002 | same skill locatable by Claude and Codex         |
| J-005 | Prompt IR v1                      | J-001             | compiled prompt with reproducible hash               |
| J-006 | Promptfoo                         | J-005       | evaluated regressions and triggers               |
| J-007 | Bifrost gateway spike             | J-005,J-006       | routing/cost/exact cache measured                |
| J-008 | Langfuse spike                    | J-005,J-006       | tracing with validated data policy             |
| J-009 | Learning candidates               | J-002,J-006       | evidence becomes a proposal, not an automatic change |
| J-010 | LangMem/GEPA/DSPy spikes          | J-009             | variant evaluated in a branch with rollback            |
| J-011 | Context Broker MCP                | I-005,J-003       | minimal tools tested in MCP Inspector            |
| J-012 | AI Graph IR extension             | I-002,J-003,J-005 | skills/prompts/runs appear with evidence         |

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
      exercised by the Graph IR/X6 spike, but no product release artifact or
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
      `graph-core:api-check`/`x6-canvas:api-check` checks rather than a
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

