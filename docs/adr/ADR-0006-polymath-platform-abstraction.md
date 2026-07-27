# ADR-0006: Polymath — platform and capability abstraction layer

- Status: **Accepted.** Does not close any numbered gate and is not, in itself, a Decision
  Gate of the master source; it is a complementary structural decision, recorded as
  DEC-042.
- Proposal date: 2026-07-26
- Decision date: 2026-07-26
- Motivated by: the real heterogeneity of the development machines (Windows PC, macOS
  notebook) and the expectation of Linux servers, plus gates `GATE-003` (V1 platforms) and
  `GATE-006` (fallback without WebGPU), both still `OPEN`.
- Related `LOCKED` decisions: DEC-001 (Rust is the single source of logic — Polymath never
  contains domain logic), DEC-007/008/009 (GPU in Rust via wgpu + CPU fallback),
  section 4.2 (`domain-core` and `compute-api` rules)
- Authority: in case of conflict, `GRAFTING_MASTER_SOURCE.md` prevails over this ADR.

## Context

The owner develops on Windows and macOS, and expects to host servers on Linux. This is
orthogonal to the `GATE-003` question ("which platforms are official V1 clients?") — even
if the published client is Windows-only at first, the *code* already coexists with three
different OSes today, in day-to-day development and possibly on the server host.

The work pattern described by the owner (inspired by Atomic Design: an internal package
whose only role is to "export" items, absorbing differences and problems at the export
layer, even if today it is a 1:1 proxy) is exactly the **facade/adapter** pattern already
implicitly used elsewhere in the master source: `compute-api` already fulfills this role
for GPU, hiding concrete `wgpu` types from `domain-core` (section 4.2). This ADR proposes
generalizing this same principle to *platform/environment* concerns (OS, Web runtime,
.NET RID), under the name **Polymath**.

## Core principle

No logic module (domain-core, compute-cpu/compute-wgpu, isekai-\*, the Web app, or the
future desktop app) should directly inspect `cfg(target_os)`, `navigator.gpu`,
`process.platform`, .NET RID, or equivalents. All such inspection is centralized in
Polymath, per runtime. The rest of the code consumes a stable, agnostic API; changing what
happens behind it (Windows today, Linux/macOS tomorrow, WebGPU vs. fallback) should not
require touching any consumer.

This does not violate DEC-001 (no domain logic is duplicated) because Polymath carries no
business rules — it carries only environment/platform facts and differences.

## Proposed structure (one package per runtime, modules per concern)

| Runtime | Package | Proposed path | Modules |
| --- | --- | --- | --- |
| Rust | `polymath` | `libs/platform/polymath/` | `os` (paths, dynamic library extension `.dll`/`.so`/`.dylib`, config/cache/temp dirs, process/thread differences); `gpu` (OS/driver facts about available graphics backends — Vulkan/DX12/Metal — consumed by `compute-wgpu`) |
| TypeScript | `@grafting/polymath` | `packages/polymath/` | `env` (Node vs. Edge vs. Browser, supporting the SSR/client-only split of the Next.js host defined in ADR-0001); `gpu` (WebGPU support detection, supporting the `GATE-006` fallback policy); `worker` (`SharedArrayBuffer`/Worker support) |
| C# (future) | `Grafting.Polymath` | `dotnet/Grafting.Polymath/` | RID differences and window/input integration — only makes sense alongside `GATE-002` Track 2 (chosen engine); plan the name now, implement later |

Relationship with what already exists:

- `compute-api`/`compute-cpu`/`compute-wgpu` remain the owners of the *compute contract*
  (math, jobs, fallback policy) — this does not change. `polymath::gpu` only supplies
  environment facts (which backends the OS/driver exposes); `compute-wgpu` consumes these
  facts, never the other way around. There is no overlap of responsibility.
- `packages/isekai-web-client` remains the owner of Worker/Wasm orchestration (creation,
  batch submission, Promise per job — section 9.3). `@grafting/polymath` only answers
  "does this environment support X?", it does not orchestrate anything.
- `dotnet/Grafting.Isekai.Interop` (already present in the section 6.1 tree) is the
  natural candidate to consume `Grafting.Polymath` once it exists, instead of that logic
  spreading through the engine wrapper.

## Incremental rollout (do not implement everything at once)

Consistent with the "Core Rule" of `README.md` (reduce uncertainty before building every
layer) and with the default already recorded for `GATE-003` (Linux/macOS "compiled and
progressively validated, without promising a final client at the first milestone"):

1. Initial phase: Polymath is born with a real implementation only for the platform in
   active use (Windows), and the others (`linux`, `macos`, WebGPU fallback) as explicit
   stubs that fail loudly (`todo!()`/clear exception), never as a silently absent `cfg`.
2. Each new real platform (your Mac notebook, the Linux server) becomes an additional
   implementation within the same module — never a new parallel package.
3. `GATE-003` and `GATE-006`, once closed, only determine *which* Polymath implementations
   need to move from "stub" to "supported" — they do not change the structure itself.

## Consequences

- Centralizes every platform-change point into two (eventually three) small, predictable
  packages.
- Reduces the cost of deciding `GATE-003`/`GATE-006` later or incrementally, because the
  seam already exists before the final decision.
- Adds two new projects to the workspace (`libs/platform/polymath`,
  `packages/polymath`) — these are not a new workspace root nor a new lockfile, so they do
  not run into the "new workspace root without an ADR" rule (this very ADR covers the
  creation of the packages).

## Risks

- Without code review discipline, platform checks may leak outside of Polymath again. It
  is recommended to record this rule in `AGENTS.md` (or in lint/CI) once the workspace
  exists.
- If the `gpu` modules of Polymath (Rust) and `compute-api` do not have their
  responsibility boundary clearly documented in code, the boundary described here may get
  lost in practice — an architecture comment in both crates is worthwhile once they are
  created.

## Questions — answered by the owner on 2026-07-26

1. **Modules**: a single Polymath package per runtime, with an internal `gpu` module (not
   a dedicated sibling package for WebGPU). Confirmed — avoids proliferating small
   packages before it is needed.
2. **Paths**: `libs/platform/polymath`, `packages/polymath`, `dotnet/Grafting.Polymath`
   accepted as proposed.
3. **Scope**: implicitly confirmed by accepting the structure above — Polymath is only
   environment/platform, never domain logic or Worker/compute orchestration.

## Decision

> **Accepted on 2026-07-26.** Polymath is born as one package per runtime
> (`polymath` in Rust, `@grafting/polymath` in TypeScript, `Grafting.Polymath` in C# —
> the latter only implemented when `GATE-002` Track 2 is resumed), each organized into
> internal modules by concern (`os`/`gpu` in Rust; `env`/`gpu`/`worker` in TypeScript), at
> the proposed paths. Recorded as DEC-042.

## Next steps

- [x] Add Polymath to section 4.2 (Engine layers) as an infrastructure layer, distinct
      from `compute-api`.
- [x] Add the proposed paths to the section 6.1 tree.
- [x] Record the "only Polymath inspects platform" rule as a creation checklist item
      (section 27).
- [ ] Once CI exists, turn this rule into an automated lint/check (e.g.,
      ast-grep/PROV-014) — pending a real workspace.
