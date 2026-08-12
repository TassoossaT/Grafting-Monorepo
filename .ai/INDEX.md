# AI Context Index — Grafting Monorepo

> **Ultra-dense LLM Context Map & Router (Tier 1)**
> Use this file to locate authoritative sources, architectural specs, workspace packages, and ADRs without loading full repository directories.

---

## 1. Normative Rules & Coordination Precedence

In case of ambiguity, follow this strict precedence hierarchy:

1. **`GRAFTING_MASTER_SOURCE.md` (§0)** — Normative layer, architectural router, and Decision Gates.
2. **Accepted ADRs (`docs/adr/`)** — Architecture Decision Records.
3. **`AGENTS.md` & `GEMINI.md`** — Scope-local operational rules & token economy mandates.
4. **`.ai/coordination/PROTOCOL.md`** — Task lifecycle protocol (`tools/ia-graft`).
5. **Code & Schemas** — `docs/generated/api/`, FlatBuffers schemas (`.fbs`), and source.

---

## 2. Architectural Router (`docs/architecture/`)

Fetch **only** the section needed for your task:

| Topic | File | Key Focus |
| --- | --- | --- |
| **Product Overview** | [overview.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/architecture/overview.md) | Vision, Isekai interop, spatial core |
| **Boundaries & Package Isolation** | [boundaries.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/architecture/boundaries.md) | Ecosystem separation, external isolation (DEC-049) |
| **Memory Model** | [memory-model.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/architecture/memory-model.md) | Arena allocation, ownership across runtimes |
| **ABI & Interop** | [abi.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/architecture/abi.md) | FlatBuffers, C-ABI bridge, Polymath abstraction |
| **Concurrency & Threading** | [concurrency.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/architecture/concurrency.md) | Async runtime rules, lock-free queues |
| **GPU Execution Model** | [gpu-model.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/architecture/gpu-model.md) | WebGPU / Compute pipelines |
| **AI Control Plane** | [ai-control-plane.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/architecture/ai-control-plane.md) | `.ai/` policies, registries, and skills |
| **Toolchains & Native Build** | [toolchains.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/architecture/toolchains.md) | Cargo, pnpm, uv, dotnet tooling standards |
| **Testing Strategy** | [testing.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/architecture/testing.md) | Unit, integration, ABI, contract test requirements |
| **Backlog & Phases** | [backlog.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/architecture/backlog.md) & [phases.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/architecture/phases.md) | Implementation roadmap |
| **VTT Product Roadmap** | [vtt-roadmap.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/architecture/vtt-roadmap.md) | VTT epics 1-6: Studio health, VTT architecture, map, assets, tokens, rules |
| **VTT Map Roadmap** | [vtt-map-construction-roadmap.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/architecture/vtt-map-construction-roadmap.md) | VTT Map construction architecture & 4-phase backlog (Epic 3 detail) |
| **External Skills Catalog** | [EXTERNAL_SKILLS_CATALOG.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/.ai/registry/EXTERNAL_SKILLS_CATALOG.md) | Catalog of cloned mattpocock/skills & stitch-skills |



---

## 3. Workspace Packages & Applications

Generated baseline map derived from `docs/generated/repo-map.md`:

### Rust Core (`libs/`)
- **`graph-core`** (`libs/graph/core`) — Canonical Rust graph engine. See API doc: [graph-core API](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/generated/api/rust)
- **`engine-domain-core`** (`libs/engine/domain-core`) — Core domain mathematical calculations & spatial state.
- **`engine-compute-api`** (`libs/engine/compute-api`) — Abstract compute interface.
- **`engine-compute-cpu`** (`libs/engine/compute-cpu`) — CPU execution engine.
- **`isekai-capi-bridge`** (`libs/isekai/capi-bridge`) — Low-level C-ABI export layer for C#/.NET interop.
- **`isekai-wasm-bridge`** (`libs/isekai/wasm-bridge`) — WASM bindings for Web/TS applications.
- **`discretize`** (`libs/domains/procgen/discretize`) & **`generation-wasm`** (`libs/domains/procgen/generation-wasm`) — Procedural generation & discretization algorithms.

### TypeScript Apps & Packages (`apps/`, `packages/`, `tools/`)
- **`architecture-studio`** (`apps/architecture-studio`) — Primary visual lab application & UI workspace. API: [architecture-studio.api.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/generated/api/ts/architecture-studio.api.md)
- **`ui`** (`packages/ui`) — Design system & shared UI capability components. API: [ui.api.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/generated/api/ts/ui.api.md)
- **`render-3d`** (`packages/render-3d`) — 3D graphics & spatial rendering engine. API: [render-3d.api.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/generated/api/ts/render-3d.api.md)
- **`isekai-web-client`** (`packages/isekai-web-client`) — Web client bridge for Isekai interop. API: [isekai-web-client.api.md](file:///C:/Users/PICHAU/Desktop/Grafting%20Monorepo/docs/generated/api/ts/isekai-web-client.api.md)
- **`x6-canvas`** (`packages/x6-canvas`) — Graph canvas visual representation package.
- **`ia-graft`** (`tools/ia-graft`) — Monorepo AI task lifecycle & isolation CLI.

### C# / .NET (`dotnet/`)
- **`isekai-dotnet-interop`** (`dotnet/Grafting.Isekai.Interop`) — C# P/Invoke bridge & interop.
- **`isekai-dotnet-protocol`** (`dotnet/Grafting.Isekai.Protocol`) — C# protocol definitions.

---

## 4. Architectural Decision Records (ADRs) Summary

| ADR | Title | Domain / Impact |
| --- | --- | --- |
| **ADR-0001** | Host Web | Web host architecture & TS integration |
| **ADR-0006** | Polymath Platform Abstraction | Centralized platform/runtime detection |
| **ADR-0008** | Libs Boundary & Domain Map | Library boundaries & domain separation |
| **ADR-0010** | Multi-Agent Coordination | Task isolation, worktree protocol (`ia-graft`) |
| **ADR-0011** | Package Autonomy & External Isolation | Vendor wrapping, no third-party API leak |
| **ADR-0013** | Rust Graph Core & API Contracts | `grafting-graph-core` single canonical logic |
| **ADR-0014** | Composable Capability Packages | UI/Capability separation (neutral mechanisms) |
| **ADR-0015** | Agent Git Write Policy | Worktree + Branch per task; PR workflow |
| **ADR-0016** | Architecture Studio Scope Expansion | Lab trials, spike isolation in `/lab` |
| **ADR-0017** | WASM Bindings Colocated | Colocated WASM wrappers per Rust crate |
| **ADR-0021** | Render 3D Engine Package | Spatial rendering package bounds |

---

## 5. Token Economy & Task Operational Protocol

When executing tasks in this monorepo:
1. **Never list full directories**: Use `glob` or `grep` search for targeted patterns.
2. **Never read entire large files**: Read line ranges or specific function/type definitions.
3. **Use `ia-graft` CLI**:
   - `ia-graft task new --id <TASK-ID>` — Create/resume task worktree.
   - `ia-graft guard-check` — Check path/command permissions.
   - `ia-graft task commit --id <TASK-ID> -m <msg>` — Stage and commit worktree changes.
   - `ia-graft task test --id <TASK-ID> --command <cmd>` — Run capped verification tests.
   - `ia-graft task done --id <TASK-ID> --title <t> --body <b>` — Open PR for review.
4. **Direct Prose Edits**: Pure Markdown documentation changes commit directly on `main`/`master` without task ceremony.
