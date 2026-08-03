# Decision Gates to close

> Extracted from `GRAFTING_MASTER_SOURCE.md` §5 as part of the master-source
> split (`MASTER-SOURCE-SPLIT-PHASE1`). `GATE-XXX` IDs are cited by ID
> throughout the repository (~84 citations across ~19 files), never by
> section number, so this move needs zero external rewrites. See
> `GRAFTING_MASTER_SOURCE.md` §0's router table for the full document map.
>
> **Bug fixed during this move**: GATE-004 previously had no `Status:` line
> here, unlike every other gate, and unlike its own correct entry in
> `CURRENT_PLANNING_STATE.md` ("open, formally deferred, ADR-0005"). The
> `Status:` line below now matches `CURRENT_PLANNING_STATE.md` and DEC-XXX's
> §3.3 table (`docs/decisions/DECISION-LOG.md`).

This section must be answered by the owner before the final scaffold. The agent can prepare comparisons and spikes, but cannot choose silently.

## GATE-001 — Web Host — CLOSED

Status: **CLOSED on 2026-07-26.** Decision recorded in DEC-041 and detailed in
`docs/adr/ADR-0001-host-web.md`.

Questions that drove the decision:

- Is the VTT a client SPA or does it need SSR?
- Will there be indexable public pages?
- Does the application need server routes from the same framework?
- Will the deploy be static, Node, or edge?

Decision: **Next.js (React + SSR/edge)**. The VTT is just one of the product's planned
pages; the other pages benefit from SSR/server routes in the same framework.

The default originally considered in this section (React + Vite + Three.js as an isolated
SPA, with separate backend services) was discarded because it assumed a single-page
product, which is not the case. The Worker/Wasm bootstrap (DEC-015) must occur within a
client-only Next.js route, without participating in SSR.

## GATE-002 — Desktop Engine

Status: **open and in indefinite standby until the owner explicitly resumes C# game
development** (see `docs/adr/ADR-0002-engine-desktop.md`). The generic C ABI and .NET
interop feasibility work is complete; there is currently no specific game or engine to
evaluate, and no further engine-specific work is planned while the gate is in standby.

The choice, when resumed, needs to evaluate:

- the possibility of distributing a Rust DLL;
- the threading model;
- P/Invoke support;
- packaging control per RID;
- native plugin policy;
- window/input access;
- license restrictions;
- the ability to run tests without an editor.

The core must not assume Unity, Godot, or another engine until the gate closes.

The deferral does not block generic work: `isekai-capi` (C ABI, opaque handles,
DEC-011) is designed to be engine-agnostic by construction, and can be developed
and validated with a generic .NET harness (console app or tests with direct P/Invoke),
without choosing an engine. What remains blocked is the desktop app scaffold itself and the
engine-specific threading/window/input wrapper (section 12.6).

## GATE-003 — V1 Platforms — CLOSED

Status: **CLOSED on 2026-07-26.** Decision recorded in DEC-043 and detailed in
`docs/adr/ADR-0003-platforms-v1.md`.

Decision (pragmatic default originally suggested, adopted unchanged):

- Web: modern browsers with WebAssembly;
- Web GPU: WebGPU when available;
- Desktop V1: Windows x64;
- Linux/macOS: core compilable and progressively validated, with no published client in
  the first milestone.

Rationale: the Polymath package (DEC-042) already isolates platform differences, so
restricting the desktop client to Windows in V1 is a publication sequencing decision,
not an architectural limitation — Linux/macOS come later as new implementations
inside Polymath, without rewriting the core or hosts.

## GATE-004 — Authoritative server

Status: **open, formally deferred to the start of Phase 6/Epic H.** See
`docs/adr/ADR-0005-authoritative-host-deferral.md`.

Acceptable options:

- a TypeScript/Node host loading Wasm or a native addon;
- a C# host loading a native library;
- a Rust host calling the core directly.

Main criterion:

- host operation, observability, and scale;
- not the solver's language, which will remain Rust.

## GATE-005 — Determinism — CLOSED

Status: **CLOSED on 2026-07-26.** Decision recorded in DEC-044 and detailed in
`docs/adr/ADR-0004-determinism.md`.

Differentiated levels (reference):

1. semantic determinism;
2. same-platform replay determinism;
3. cross-platform bit-for-bit determinism;
4. mathematical validity within tolerance.

Floating-point GPU must not be used for decisions that require bit-for-bit equality between machines. A solver may use GPU for search and CPU to validate the final solution.

Decision: V1 adopts **level 2 (replay on the same platform/build)** for the
authoritative path (command ordering, RNG, DomainEvents, snapshots, state hash). "Same
platform" fixes build ID, target, protocol/schema versions, features, numeric
configuration, and RNG algorithm. Numeric and GPU subsystems use **level 4 (mathematical
tolerance)**; GPU results never enter the state hash raw — they are validated,
canonicalized, and deterministically tie-broken on the CPU before touching the
authoritative path. Non-authoritative rendering and effects require only **level 1
(semantic)**. **Level 3 (cross-platform bit-for-bit) is not a V1 requirement**; the
authoritative host stays fixed to a single target during a session. This decision will be
reviewed when closing `GATE-004` and `GATE-009`.
