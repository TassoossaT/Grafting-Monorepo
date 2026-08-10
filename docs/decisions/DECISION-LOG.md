# Summary decision log

> Extracted from `GRAFTING_MASTER_SOURCE.md` §3 as part of the master-source
> split (`MASTER-SOURCE-SPLIT-PHASE1`). `DEC-XXX` and `PROV-XXX` IDs are cited
> by ID throughout the repository (~308 citations across ~129 files), never by
> section number, so this move needs zero external rewrites. See
> `GRAFTING_MASTER_SOURCE.md` §0's router table for the full document map.

## 3.1 `LOCKED` Decisions

| ID      | Decision                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| DEC-001 | Rust is the single source of proprietary logic, mathematics, and the solver.                                                           |
| DEC-002 | Nx acts as the meta-orchestrator; native toolchains remain sovereign.                                                         |
| DEC-003 | pnpm manages the Node/TypeScript workspace.                                                                                       |
| DEC-004 | Cargo manages Rust crates, features, targets, and dependencies.                                                                   |
| DEC-005 | uv manages Python, environments, and the lockfile.                                                                                        |
| DEC-006 | dotnet/MSBuild manages C# projects.                                                                                             |
| DEC-007 | Rust owns the GPU compute resources; the hosts own the rendering resources.                                                   |
| DEC-008 | The GPU backend will be based on `wgpu`; portable kernels will be written in WGSL.                                              |
| DEC-009 | The GPU backend has a functional CPU fallback.                                                                                     |
| DEC-010 | FFI calls will be batched; per-entity iterative operations are prohibited in the hot path.                                     |
| DEC-011 | The desktop ABI will be a versioned C ABI with opaque handles and fixed-width types.                                             |
| DEC-012 | ABI, network protocol, and product version are separate versioning axes.                                                     |
| DEC-013 | FlatBuffers will be used for structured data; hot numeric arrays will use explicit raw layouts.                     |
| DEC-014 | "Zero-copy" will not be described as an end-to-end property.                                                                   |
| DEC-015 | Web will run Wasm/simulation/compute in a Dedicated Worker.                                                                   |
| DEC-016 | Initial multiplayer will be authoritative replication with a journal and snapshots, not full Event Sourcing.                       |
| DEC-017 | Native builds will occur on runners of the target system.                                                                      |
| DEC-018 | Generated code will not be mandatorily committed; generation will be a deterministic task.                                |
| DEC-019 | `.venv` will never be shared between Windows, WSL, Linux, macOS, or different checkouts.                                    |
| DEC-020 | pnpm's experimental Global Virtual Store is not an architectural requirement.                                                      |
| DEC-021 | Nx graph export is derived structural context, not RAG.                                                              |
| DEC-022 | `AGENTS.md` will be the agent-agnostic contract; vendor-specific files will be short adapters.              |
| DEC-023 | The project is called Grafting; Isekai is exclusively the interoperability boundary between runtimes and languages.             |
| DEC-024 | The root and local `AGENTS.md` is the canonical operational contract per scope.                                                       |
| DEC-025 | `.ai/` is the canonical source of the AI Control Plane: skills, agents, prompts, policies, workflows, evals, catalog, and routing. |
| DEC-026 | `CLAUDE.md`, `.claude/`, `.codex/`, and `.agents/` are vendor adapters and not parallel architectural sources.       |
| DEC-027 | Knowledge & Automation Plane and a minimal Graph IR are P0.                                                                         |
| DEC-028 | Every Nx project is born with `project.json`, `README.md`, `AGENTS.md`, Graph IR metadata, and `src/`.                        |
| DEC-029 | Capabilities, skills, tools, and context are loaded on demand.                                                         |
| DEC-030 | Agent Skills is the base interoperable skill format.                                                                         |
| DEC-031 | Executable task state is derived from the deterministic `task/<TASK-ID>` branch, `.worktrees/<TASK-ID>` worktree and its PR; task/handoff JSON is retired (ADR-0010). |
| DEC-032 | Each task has a single executing owner at a time; parallel executors use distinct worktrees.                      |
| DEC-033 | The implementer cannot be the sole reviewer of their own change.                                                             |
| DEC-034 | Continuous learning is evidence-driven, evaluated, and approval-gated.                                                             |
| DEC-035 | Post-tool maintenance is deterministic and does not call a model.                                                           |
| DEC-036 | Semantic caching remains disabled by default and is prohibited for code, security, incidents, and side effects.              |
| DEC-037 | Canonical prompts live in `.ai/prompts/`; external records are published projections.                                     |
| DEC-038 | External AI integrations enter via spike, quarantine, license, security, and evaluation.                                   |
| DEC-039 | No AI integration can create another workspace root, lockfile, or toolchain without an ADR.                                    |
| DEC-040 | The Grafting Graph IR also represents capabilities, skills, agents, prompts, tools, policies, evals, tasks, and runs.    |
| DEC-041 | The Web host is Next.js (React + SSR/edge); the VTT is a client-only route within it, not a standalone app (GATE-001, `docs/adr/ADR-0001-host-web.md`). |
| DEC-042 | Platform/environment differences (OS, Web runtime, RID) may only be inspected inside the Polymath package per runtime (`polymath` Rust, `@grafting/polymath` TS, `Grafting.Polymath` C# in the future); no other module performs this inspection directly (`docs/adr/ADR-0006-polymath-platform-abstraction.md`). |
| DEC-043 | The V1 desktop client is Windows x64 only; Linux/macOS remain core compilation targets, validated progressively, with no published client in V1 (GATE-003, `docs/adr/ADR-0003-platforms-v1.md`). Future expansion is absorbed by Polymath (DEC-042), not by rewriting the core. |
| DEC-044 | The V1 authoritative path requires replay determinism on the same platform/build (command ordering, RNG, DomainEvents, snapshots, state hash); "same platform" fixes build ID, target, protocol/schema versions, features, numeric configuration, and RNG algorithm. Numeric/GPU subsystems use mathematical tolerance; GPU results are validated, canonicalized, and deterministically tie-broken on the CPU before touching the state hash. Non-authoritative rendering/effects require only semantic determinism. Bit-for-bit cross-platform matching is not a V1 requirement; the authoritative host stays fixed to one target per session (GATE-005, `docs/adr/ADR-0004-determinism.md`; to be reviewed when closing GATE-004/GATE-009). |
| DEC-045 | Monorepo distribution is monolithic: a single workspace, multiple products as distinct `apps/`, with no satellite repositories per product. "Selling" a product means packaging that app's build artifact (`dist/<app>`), not splitting repositories (GATE-007, `docs/adr/ADR-0007-repo-distribution-strategy.md`). |
| DEC-046 | A capability is born in `libs/domains` or `packages/` — never duplicated inside an `app` — whenever more than one product needs it or it is reasonable to foresee that it will; an `app` only composes domains, presents UI, and integrates the host. Initial map: `narrative` and `session` are generic domains (`libs/domains`); Discord and transcription are external integrations that consume contracts, never internal domains. The former X6-sharing clause is superseded by DEC-056 (`docs/adr/ADR-0008-libs-boundary-and-domain-map.md`, `docs/adr/ADR-0018-canvas-boundary-and-rete-adoption.md`). |
| DEC-047 | English is the default documentation language for the entire repository, effective 2026-07-26. All pre-existing Portuguese documents (`GRAFTING_MASTER_SOURCE.md`, `CURRENT_PLANNING_STATE.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `README.md`, `docs/adr/*.md`) were translated to English in full as part of this decision. This supersedes the earlier informal rule that only required new files to be written in English going forward. New files, package names, comments, and READMEs continue to be written in English. |
| DEC-048 | Provider-neutral coordination uses `tools/ia-graft`, isolated worktrees and Git/PR evidence; review feedback resumes the same task/PR, dependent tasks name an explicit parent branch, and chat plus duplicate ownership/handoff files are not authoritative (ADR-0010). |
| DEC-049 | Reusable capabilities use the smallest useful consumer-agnostic boundary (internal tree, package, or host app); third-party runtime/library APIs remain inside that boundary and are exposed through Grafting-owned surfaces without vendor-type leakage; separate packages require real reuse/build/ownership/fork evidence; authoritative behavior has one implementation or canonical source, with explicit allowances for independent tests, generated bindings, frozen fixtures, thin boundary translations, and derived evidence (`docs/adr/ADR-0011-package-autonomy-and-external-isolation.md`). |
| DEC-050 | The Knowledge and Automation Plane separates canonical authored sources, operational authored state, derived evidence, and presentation state; derived facts remain read-only and traceable, while proposed edits target authored sources through validation and plan/diff approval. Graph computation, visual adaptation, and application presentation remain separate; the original TypeScript graph-package allocation is amended by DEC-051 (`docs/adr/ADR-0012-knowledge-automation-plane.md`). |
| DEC-051 | Reusable graph structures, semantic validation, algorithms, ordering, queries, diffs, layout mathematics, and other significant calculations are authoritative in the Rust `grafting-graph-core` crate; callers own presentation enrichment. Every consumed package has a generated public-API baseline, an `api-check` target, and behavioral contract tests, with native source declarations remaining authoritative. Its former X6-ownership clause is superseded by DEC-056 (`docs/adr/ADR-0013-rust-graph-core-and-api-contracts.md`, `docs/adr/ADR-0018-canvas-boundary-and-rete-adoption.md`). |
| DEC-052 | Reusable capability packages expose neutral mechanisms, Grafting-owned composition contracts, extension points, and only replaceable defaults; consuming applications own concrete visual identity, semantic roles, effects, and interaction policy. A package may privately adapt third-party code, but it must not hardcode one product's presentation or force consumers to bypass its boundary (`docs/adr/ADR-0014-composable-capability-packages.md`). |
| DEC-053 | Agents may create forward-only commits only on their own `task/<TASK-ID>` worktree and push that branch; `ia-graft task sync` is the sole recorded-base integration path and may create a forward merge commit or abort only its own unfinished merge; a clean task may temporarily occupy a clean main checkout only through `task checkout` for testing, never commits; agents never invoke raw history-integration commands, write the default branch, rewrite history, force refs or merge PRs (ADR-0015). |
| DEC-054 | `apps/architecture-studio`'s scope expands to three named surfaces: (1) the existing Graph IR explorer, unchanged and still read-only; (2) a new VTT procedural-generation test/visualization surface executing Rust/Wasm generation code, rendered via Three.js inside `@grafting/ui`'s `GridLayout`; (3) a new agent-orchestration surface, a Node backend executing MCP-based agent workflows, bound by a license-risk policy (no Mastra `ee/` code reachable from a shipped build) and still routing any canonical-source edit through `ADR-0012`'s existing proposal/validation/plan/approval lifecycle. `ADR-0012`'s read-only-only exclusion is superseded for surfaces 2 and 3 only (`docs/adr/ADR-0016-architecture-studio-scope-expansion.md`). |
| DEC-055 | Generated Wasm bindings (`wasm-pack` output or equivalent) for any Rust crate never live inside `packages/`, even gitignored; the Rust crate stays a plain Cargo project under `libs/`, and its generated output is produced at build/install time directly into a directory owned by the consuming app, via an Nx target that app declares itself. `packages/isekai-wasm` and `packages/vtt-generation-wasm` are eliminated; `packages/isekai-web-client` receives its compiled Wasm module's location as a runtime parameter instead of importing a generated package (`docs/adr/ADR-0017-wasm-bindings-colocated-with-crate.md`). |
| DEC-056 | Active browser canvas elements are exported through the vendor-neutral `@grafting/ui` root API. Rete.js is the sole active graph-canvas engine and Three.js remains the private 3D/heightfield renderer inside that package; neither vendor appears in consumer contracts. `@grafting/x6-canvas` is retired and dormant, while `@grafting/three-canvas` is absorbed and removed. Rust graph authority and application-owned presentation remain unchanged (`docs/adr/ADR-0018-canvas-boundary-and-rete-adoption.md`). |
| DEC-057 | **Pending owner acceptance — `docs/adr/ADR-0019-editable-canvas-and-node-bench.md` is still `Proposed`.** `@grafting/ui`'s canvas gains an editing capability split between caller and user: the handle always accepts programmatic mutation of the caller's own nodes and edges, while user-drawn connections stay unavailable until a consumer supplies an explicit editing policy. Ports become directional and carry an opaque caller-owned `dataType`; the package enforces only direction, capacity, self-connection, and duplicate endpoints, and delegates type compatibility to a consumer callback. `apps/architecture-studio`'s `/lab` becomes a dataflow node bench where each element is a node declared once as a product-owned `NodeKind` (ports, parameter schema, evaluation), parameters belong to node instances, and evaluation order plus cycle detection stay authoritative in `grafting-graph-core` (amends ADR-0014, ADR-0016, ADR-0018). |
| DEC-058 | **Pending owner acceptance — `docs/adr/ADR-0020-nx-rebuilds-wasm-bindings.md` is still `Proposed`.** Every Rust crate compiling to Wasm gains an Nx `build` target running the same `wasm-pack` command its `postinstall` already runs, with `pkg/` as a cached output, and consuming projects declare it in `dependsOn`. ADR-0017's `postinstall` is unchanged and remains what makes a fresh clone work; this amends only ADR-0017's "no Nx target" clause, for the case `postinstall` structurally cannot serve — Rust source changing without an install, which silently served a stale `pkg/` to `nx dev`. `grafting-isekai-wasm` also gains the missing `engine-domain-core:generate` edge it needs to compile at all (amends ADR-0017). |
| DEC-059 | **Pending owner acceptance — `docs/adr/ADR-0021-render-3d-engine-package.md` is still `Proposed`.** The 3D renderer leaves `@grafting/ui` and becomes `@grafting/render-3d`, owning Three.js privately; this amends DEC-056's clause placing the 3D/heightfield renderer inside `@grafting/ui`, whose Rete graph canvas and vendor-neutral API are otherwise unchanged. The new package is organized by capability (clock, scene and layers, visual-kind registry, animation, invalidation, views) and MUST NOT name a product concept such as a token, wall, spell, or fog. Everything drawable enters through a visual kind registered from outside as plain descriptor data, which is sufficient for a separate package to supply a product's concepts without either package importing the other. Simulated time is separate from real time, so pausing and resolving a whole turn as one step are engine properties rather than per-consumer features. `@grafting/ui` retains `createHeightfieldCanvas` as a thin boundary translation, not a second implementation (amends ADR-0018; DEC-049, DEC-052 unchanged). |
| DEC-060 | `docs/adr/ADR-0022-wall-representation-free-geometry.md` (Accepted). A wall, door or other construction-layer boundary is stored as geometry in world coordinates carrying behavioural flags, never as a grid address (not a cell, not a `(cell, face)` pair). The grid remains an authoring aid (snapping) and may shape a spatial index, but is not the address. This governs the authoritative semantic store only: the solver keeps assigning one module per cell, since that is its sole output vocabulary. Driven by three checkable facts — `tileset-wfc` never assigns to a link, mesh topology must stay editable because procedural generation is one of four construction tiers rather than the fixed one, and Tier 2 import brings walls that never had cells. Corollary: `CellId` is an index into one solve, not an identity — `shell-cell-graph.ts` numbers cells positionally, so no persisted record may hold one. Costs accepted: a spatial index becomes a design dependency, and pinning semantics into generation needs a geometry→cells conversion step (`docs/research/vtt-wall-representation-options.md`). |

## 3.2 `PROVISIONAL` Decisions

| ID       | Decision to validate                                                                            |
| -------- | --------------------------------------------------------------------------------------------- |
| PROV-001 | Re-evaluate the official `@nx/dotnet` plugin when GATE-002 resumes or manual .NET metadata becomes costly. A-010 validated that the plugin is available and compatible, but the current small, generic C# surface deliberately retains explicit `nx:run-commands` targets as its documented fallback (`docs/benchmarks/toolchain-nx-validation-2026-07-28.md`). |
| PROV-002 | Use `wasm-pack` as the initial packager for the Wasm binding.                                   |
| PROV-003 | Use FlatBuffers for Commands, DomainEvents, ReplicationDeltas, and Snapshots.                  |
| PROV-004 | Maintain a single `uv.lock` for the workspace's compatible Python packages.                 |
| PROV-005 | Use a single product version while artifacts remain internal.                      |
| PROV-006 | Keep the Web `wgpu::Device` inside the same Worker that holds the Wasm instance.          |
| PROV-007 | Use Bifrost as the central gateway, initially as a pinned container or external service.    |
| PROV-008 | Use BAML as the typed prompt compiler.                                                                  |
| PROV-009 | Use Langfuse for tracing, datasets, and published prompt versions.                        |
| PROV-010 | Use Promptfoo for quick evals and regressions.                                             |
| PROV-011 | Use LangMem for extracting and consolidating learning candidates.                         |
| PROV-012 | Use GEPA/DSPy for offline optimization of variants.                                        |
| PROV-013 | Use LLMLingua only for selective compression of non-normative content.                 |
| PROV-014 | Use Serena and ast-grep as complements to repository intelligence.                    |

## 3.3 `OPEN` Decisions

See `docs/decisions/GATES.md` for the full status of every Decision Gate.

| Gate     | Human decision needed                        | Impact                                              |
| -------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| GATE-002 | C# engine: Unity, Godot C#, MonoGame, Stride, or a custom engine    | native integration, packaging, and thread ownership — **formally deferred until there is a concrete C# game project; see `docs/adr/ADR-0002-engine-desktop.md`. Does not block the generic development of `isekai-capi`, only the desktop app scaffold and the engine-specific wrapper.** |
| GATE-004 | Authoritative server host language                         | future tree and deployment — **formally deferred to the start of Phase 6/Epic H; see `docs/adr/ADR-0005-authoritative-host-deferral.md`.** |
| GATE-006 | Support policy when WebGPU is unavailable           | UX, fallback, and minimum requirements                   |
| GATE-008 | Proprietary code license and policy                      | publication and distribution of symbols           |
| GATE-009 | Multiplayer persistence                                       | journal, snapshots, and operation                      |

`GATE-001` has been closed — see DEC-041 and `docs/adr/ADR-0001-host-web.md`.
`GATE-003` has been closed — see DEC-043 and `docs/adr/ADR-0003-platforms-v1.md`.
`GATE-005` has been closed — see DEC-044 and `docs/adr/ADR-0004-determinism.md`.
`GATE-007` has been closed — see DEC-045 and `docs/adr/ADR-0007-repo-distribution-strategy.md`.

No gate prevents creating isolated proofs of concept. Of the gates that were blocking the definitive scaffold of the applications, only `GATE-002` remains open (GATE-001 and GATE-003 closed).
