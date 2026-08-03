# Implementation phases

> Extracted from `GRAFTING_MASTER_SOURCE.md` §22 as part of the master-source
> split (`DOCS-CONTEXT-SPLIT`). See `GRAFTING_MASTER_SOURCE.md` §0's router
> table for the full document map.

The unified mandatory order is:

```text
decisions
→ Knowledge Plane + minimal Graph IR
→ minimal AI Control Plane
→ spikes
→ context-oriented workspace
→ CPU core
→ Isekai bindings
→ GPU compute
→ hosts
→ multiplayer
→ proprietary solver
→ advanced AI Control Plane
```

## Phase 0 — Architectural closure and knowledge foundation

Objective:

- resolve gates;
- prove P0 risks;
- create contracts for humans and agents;
- not build the product yet.

Deliverables:

- Knowledge & Automation Plane ADR;
- minimal Grafting Graph IR v1;
- `GRAFTING_MASTER_SOURCE.md`;
- root `AGENTS.md`;
- `README.md` + `AGENTS.md` + per-project metadata template;
- minimal `.ai/`;
- AI System Maintainer;
- hooks via `uv`;
- first context pack;
- `ai:validate` and drift check;
- initial ADRs;
- Rust → Wasm spike;
- Rust DLL → C# spike;
- native and Web `wgpu` spike;
- boundary benchmark;
- engine and Web host decision.

## Phase 1 — Minimal context-oriented workspace

Objective:

- create toolchains;
- create Nx;
- create a pure Rust project;
- validate cache;
- validate the graph and operational contracts.

Deliverables:

- root manifests;
- pinned versions;
- bootstrap;
- `nx graph`;
- Nx → Graph IR extractor;
- minimal read-only Studio;
- initial capabilities and agents registry;
- `domain-core` project;
- basic Linux CI.

## Phase 2 — Contracts, CPU core, Prompt IR, and minimal evals

Objective:

- implement a vertical slice without GPU;
- prove the AI Control Plane's basic flow.

Deliverables:

- Command;
- DomainEvent;
- Snapshot;
- codegen;
- state hash;
- pure tests;
- CPU backend;
- minimal Prompt IR;
- initial compiler/snapshot;
- Promptfoo;
- compile cache.

## Phase 3 — Isekai: bindings between worlds

Objective:

- consume the same vertical slice on Web and C#.

Deliverables:

- C ABI v1;
- C# wrapper;
- Wasm Worker;
- job API;
- lifecycle tests.

## Phase 4 — GPU compute

Objective:

- accelerate a workload proven to be appropriate.

Deliverables:

- `compute-api`;
- `compute-wgpu`;
- WGSL kernel;
- resident buffers;
- async readback;
- CPU/GPU comparison;
- fallback.

## Phase 5 — Minimal hosts

Objective:

- minimal UI/render consuming the core.

Deliverables:

- VTT shows the core's state;
- Desktop shows the same state;
- no duplicated domain.

## Phase 6 — Multiplayer

Objective:

- minimal authoritative host.

Deliverables:

- AcceptedCommand;
- journal;
- snapshot/recovery;
- projection;
- per-client delta;
- reconnection.

## Phase 7 — Proprietary solver

Objective:

- reusable optimization framework.

Deliverables:

- problem model;
- CPU backend;
- GPU kernels;
- stopping criteria;
- benchmark;
- validation;
- resident problem persistence.

## Phase 8 — Advanced AI Control Plane

Objective:

- add gateway, observability, learning, and direct communication only after the foundation has been measured.

Deliverables subject to spike:

- Bifrost;
- Langfuse;
- LangMem;
- GEPA/DSPy;
- selective LLMLingua;
- Context Broker MCP;
- provider routing;
- advanced Graph IR;
- AI views in the Architecture Studio.
