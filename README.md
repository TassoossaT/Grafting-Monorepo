# Grafting Monorepo

Grafting is a planned polyglot monorepo bringing together:

- a Web Virtual Tabletop in TypeScript and Three.js;
- a desktop game in C#/.NET;
- a single Rust core for domain, math, AI, pathfinding, and solver logic;
- Python tooling managed by uv;
- Rust/Wasm/TypeScript and Rust/C ABI/C# interop through the Isekai subsystem;
- GPU compute with wgpu/WGSL and a CPU fallback;
- a Knowledge & Automation Plane;
- the Grafting Graph IR;
- an AI Control Plane shared between Claude and GPT/Codex.

## Current state

The repository is still in the planning phase. There is no implementation,
workspace, or prior Git history beyond planning documents.

The next milestone is closing the Decision Gates and running the Phase 0
spikes before the definitive scaffold.

See:

- [`GRAFTING_MASTER_SOURCE.md`](GRAFTING_MASTER_SOURCE.md) — canonical
  architecture, decisions, backlog, and plan (itself a router — see its
  §0.4 table for where each section's full body actually lives);
- [`AGENTS.md`](AGENTS.md) — operational contract for agents;
- [`docs/adr/`](docs/adr/) — architectural decision records;
- [`docs/decisions/GATES.md`](docs/decisions/GATES.md) — live Decision Gate
  status;
- [`.ai/README.md`](.ai/README.md) — current scope of the AI Control Plane;
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) — record of external
  open-source code copied or adapted into this repository, with attribution
  and license.

Historical build log (what was done, when, and why, epic by epic) is
archived at [`docs/history/PLANNING_LOG.md`](docs/history/PLANNING_LOG.md) —
optional reading, not part of the required chain above.

## Documentation authority

The order of authority is:

1. `GRAFTING_MASTER_SOURCE.md`;
2. approved ADRs;
3. versioned contracts and schemas;
4. code, manifests, and pipelines;
5. root and local `AGENTS.md` files;
6. `.ai/`;
7. vendor adapters;
8. generated documentation.

Summary documents do not override the master source.

## Build order

```text
decisions
→ ADRs
→ spikes
→ minimal workspace
→ CPU core
→ Isekai bindings
→ GPU compute
→ hosts
→ multiplayer
→ solver
→ advanced AI Control Plane
```

## Core rule

Do not build all layers at once. First reduce uncertainty, measure the
critical boundaries, and close the decisions that change the structure.
