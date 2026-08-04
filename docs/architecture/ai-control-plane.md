# Knowledge, documentation, and the AI Control Plane

> Extracted from `GRAFTING_MASTER_SOURCE.md` §16 ("Knowledge, documentation,
> and context for AI") and §29 ("AI Control Plane in detail") as part of the
> master-source split (`MASTER-SOURCE-SPLIT-PHASE1`) — both sections cover
> one topic and only had light, pointer-style external citations (doc/ADR
> cross-references, no source-code `S<n>.<n>` shorthand). Original section
> numbers are kept as subheadings below so existing prose citations to
> "section 16.x" / "section 29.x" still resolve. See
> `GRAFTING_MASTER_SOURCE.md` §0's router table for the full document map.

## 16.1 Sources of truth

Authority is divided without circular generation:

- this document: global architecture;
- ADRs: specific changes;
- `AGENTS.md`: operational contract per scope;
- `.ai/`: AI Control Plane;
- code/manifests/schemas: implemented facts;
- Graph IR and generated docs: projections with evidence.

```text
docs/
├── architecture/
│   ├── overview.md
│   ├── boundaries.md
│   ├── memory-model.md
│   ├── gpu-model.md
│   ├── abi.md
│   └── multiplayer.md
├── adr/
│   ├── 0001-*.md
│   └── ...
├── runbooks/
├── benchmarks/
└── generated/
    ├── project-graph.json
    ├── project-graph.html
    ├── artifact-manifest.json
    └── repo-map.md
```

## 16.2 `AGENTS.md`

`AGENTS.md` is the agnostic and canonical operational contract per scope:

- purpose and public surface;
- official commands;
- invariants and ownership;
- allowed and forbidden dependencies;
- acceptance criteria;
- boundaries;
- generated files;
- mandatory tests;
- ADRs;
- change checklist;
- documentation map.

Local `AGENTS.md` files restrict the subtree. `.ai/` can index them and validate consistency, but does not silently override them.

## 16.3 `CLAUDE.md` and adapters

`CLAUDE.md` must be short:

- direct to read `AGENTS.md`;
- direct to read this document;
- point to applicable context packs and skills;
- list validation commands;
- explain how to report open decisions;
- contain only Claude-specific behavior.

`.claude/`, `.codex/`, and `.agents/` adapt the same canonical source. Do not duplicate the entire blueprint in these files, as this creates drift and increases context.

## 16.4 Cursor and other vendors

Specific rules can exist in:

- `.cursor/rules/*.mdc`;
- equivalent files from other tools.

They must adapt, not contradict, `AGENTS.md`.

## 16.5 Nx graph

The graph will be generated on demand or in CI:

```bash
nx graph --file=docs/generated/project-graph.json
```

This file is:

- structural context;
- input for tools;
- derived snapshot.

It is not RAG by itself.

RAG only exists when there is:

- a corpus;
- chunking;
- embeddings or an index;
- a retrieval mechanism;
- an update policy;
- relevance evaluation.

## 16.6 Automated documentation

Automation must generate:

- the project graph;
- an artifact matrix;
- a contract inventory;
- a list of ABI exports;
- toolchain versions;
- benchmark summary;
- target compatibility.

Automation must not silently generate:

- architectural decisions;
- ADR rationale;
- support promises;
- product requirements.

## 16.7 Grafting Graph IR

The Graph IR represents projects, targets, modules, symbols, contracts, ABI, artifacts, runtimes, threads, documents, ADRs, workflows, skills, agents, prompts, tools, MCPs, policies, evals, tasks, runs, and handoffs.

Derived relations record extractor, version, file, symbol, hash, confidence, and evidence. The Graph IR is the canonical model for interchange and querying; the authority for a fact remains in the originating code, manifest, schema, or ADR.

Per DEC-050, repository information is explicitly classified as canonical
authored source, operational authored state, derived evidence, or presentation
state. Derived evidence is read-only and traceable to its source. A future edit
from the Architecture Studio creates a proposed source patch or structured
command, validates it, presents a plan/diff for approval, applies it through the
native owning toolchain, and then regenerates evidence. The viewer never writes
Graph IR or generated evidence directly.

Levels:

| Level | Content                                    |
| ------ | -------------------------------------------- |
| L0     | apps, packages, crates, and projects            |
| L1     | modules and imports                           |
| L2     | classes, traits, interfaces, and public APIs |
| L3     | call graph, dataflow, and runtime tracing       |

Approximate call graphs are not normative truth.

Graph IR v1 is defined by `docs/graph-ir/graph-ir-v1.schema.json` and its
adjacent semantic validator. Version `1.0.0` requires stable namespaced node
IDs, canonical relation IDs, one authority class per node, extractor identity
and version, a graph-wide source revision, confidence, and at least one hashed
evidence locator per node and edge. Arrays are deterministically ordered; IDs
are unique; edge endpoints must exist; evidence paths are normalized and
repository-relative. Viewer, X6, DOM, layout, color, and viewport concepts are
excluded from the contract.

I-002 accepts the contract and fixtures, not a live extractor. I-004 owns the
atomic replacement of the spike candidate with the reproducible
`docs/generated/grafting.graph.json` output.

## 16.8 AntV X6 and Architecture Studio

X6 is a controlled viewer/editor. Normative, derived, authored, and visual information remains separate. Derived graphs are read-only. Authored workflows go through schema, policy, plan/diff, and the Nx/CI executor.

V1 views:

1. Project Map;
2. Task Pipeline;
3. Interop/Isekai;
4. Contract Map;
5. Documentation Map;
6. AI Capability Map.

Per DEC-046, DEC-049, DEC-050, and DEC-051, reusable graph structures and
calculations live in `libs/graph/core`. The Rust crate exposes Grafting-owned
IDs, commands, results, errors, and immutable snapshots without leaking vendor
graph or mathematics types. Significant operations cross runtime boundaries in
batches rather than as individual arithmetic calls.

`packages/x6-canvas` owns the Grafting visual input contract and is the
exclusive owner of the external X6 API. Its public surface must not expose the
mutable vendor graph or other X6-owned types. Applications enrich immutable
results with labels, colors, icons, components, selection, and viewport state;
data that affects a shared calculation is an explicit Rust input.

The spike-era `packages/graph-x6` is transitional. It is migrated atomically
after Graph IR v1 is defined: generic graph semantics move to Rust, the
Architecture Studio owns its initial Graph IR presentation projection, and the
superseded package/path is removed so no second authoritative mapping remains.
A VTT may reuse the Rust graph core and X6 adapter without sharing Architecture
Studio or Graph IR semantics.

## 16.9 Context packs

Each task receives a small, reproducible, versioned, and validated context pack containing task, criteria, capabilities, policies, context, allowed/forbidden tools, output schema, artifacts, handoffs, graph scope, and token budget. The context pack is an index, not a substitute for reading the code.

---

## 29.1 Structure

```text
.ai/
├── README.md
├── registry/
│   ├── capabilities.yaml
│   ├── agents.yaml
│   ├── tools.yaml
│   ├── models.yaml
│   ├── prompts.yaml
│   ├── policies.yaml
│   └── workflows.yaml
├── policies/
├── skills/
├── agents/
├── prompts/
├── workflows/
├── context/
├── contracts/
├── adapters/
├── evals/
├── catalog/
├── state/
├── reports/
└── scripts/
```

`.ai/` is the canonical source of the control plane, but it does not replace `AGENTS.md` as the project's operational contract.

## 29.2 Progressive disclosure

Initially load only ID, name, summary, triggers, risk, cost, and dependencies. Skill body, references, scripts, schemas, and tools are loaded only after selection.

## 29.3 Agent Skills

Canonical format:

```text
skill-name/
├── SKILL.md
├── manifest.yaml
├── references/
├── scripts/
├── templates/
├── examples/
├── evals/
├── tests/
└── assets/
```

Lifecycle:

```text
discovered
→ quarantined
→ inspected
→ adapted
→ evaluated
→ approved
→ active
→ monitored
→ deprecated
→ archived
```

External skills never enter directly as active.

## 29.4 Initial control plane agents

- capability-curator;
- skill-engineer;
- context-engineer;
- agent-evaluator;
- repository-intelligence-agent;
- graph-ir-architect.

Each agent defines responsibilities, permissions, limits, tools, context, output schema, and evals.

## 29.5 AI System Maintainer

Modes:

- `observe`: after tools, without a model and without a canonical change;
- `audit`: end of turn, validation, and report;
- `evolve`: evidence-driven, with eval, review, approval, and rollback.

Hooks:

```text
PostToolUse → observe
Stop        → audit
SessionEnd  → finalize
```

Python execution:

```bash
uv run --locked --no-sync python <script>
```

The skill itself, hooks, permissions, sandbox, and MCPs only change in a separate task with human approval.

## 29.6 Prompt IR

Canonical prompts live in `.ai/prompts/`. The compiler validates schema, resolves fragments, deduplicates, preserves priority, generates adapters and snapshots, computes hash, and records provenance.

BAML is an optional spike; it does not replace the Git source.

## 29.7 Gateway and cache

Bifrost is a priority spike, initially run as a pinned container or external service and configured in `tools/ai-gateway/`.

Distinct caches:

- prompt compilation;
- the provider's native prompt caching;
- exact response cache;
- semantic cache.

Semantic cache is disabled by default and prohibited for implementation, debugging, review, security, incidents, architecture, side effects, and mutable state.

## 29.8 Token economy

Use progressive disclosure, tool search, namespaces, context packs, deduplication, structured summaries, cache, and selective compression.

LLMLingua must not compress policies, permissions, AGENTS, CLAUDE, contracts, schemas, code, ABI, acceptance criteria, critical messages, or configurations.

## 29.9 Observability and evals

Langfuse is a spike for tracing and datasets; `.ai/prompts/` remains the canonical source.

Promptfoo is the default for quick evals. Record correctness, scope, regression, rework, cost, latency, tokens, cache hit, tools, files, and side effects.

## 29.10 Continuous learning

Pipeline:

```text
execution
→ observation
→ evidence
→ grouping
→ learning candidate
→ proposal
→ eval
→ variant
→ comparison
→ review
→ approval
→ promotion
→ monitoring
```

Minimum evidence: explicit request, the same fix twice, a critical incident, a reproducible eval, an equivalent workflow three times, or objective drift.

LangMem, Hermes, GEPA, and DSPy are references/spikes; they do not promote changes directly.

## 29.11 Communication between agents

> **Note (2026-08-01, `docs/adr/ADR-0016-architecture-studio-scope-expansion.md`,
> Proposed):** `ADR-0016` proposes a Studio *product feature* (agent
> orchestration surfaced through the Architecture Studio UI) that uses MCP.
> This is independent of the Context Broker MCP described below, which
> coordinates Claude/Codex/Gemini working on this repository itself. Both
> may eventually share the same `@modelcontextprotocol/sdk` dependency, but
> must not share one implementation unless a later task explicitly merges
> them (DEC-049: no duplicated authoritative behavior).

Phase 1: files in `.ai/state/`.

Phase 2: Context Broker MCP with minimal tools:

```text
capabilities.search
capabilities.describe
context.build_pack
tasks.get
tasks.update
handoffs.create
handoffs.respond
artifacts.publish
events.append
```

Phase 3: Claude and Codex call each other via MCP/wrappers with limits, tracing, schemas, and approval for effects.
