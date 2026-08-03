# ADR-0005: Formal deferral of the authoritative server host (GATE-004)

- Status: **Accepted — formal deferral memo (does not close `GATE-004`, it only
  records the deferral required by the pre-scaffold checklist, section 27).**
- Date: 2026-07-26
- Related gate: `GATE-004`
- Related `LOCKED` decisions: DEC-001/DEC-004 (Rust is the single source of logic/solver,
  regardless of who hosts the server), section 15.4 (transport-agnostic core)
- Authority: in case of conflict, `GRAFTING_MASTER_SOURCE.md` prevails over this ADR.

## Purpose of this ADR

This document **does not close** `GATE-004`. It exists to satisfy the pre-scaffold
checklist item that requires the gate to be "at least formally deferred" (section 27) when
it is not a dependency of Phases 0-5. The master source backlog already treats the actual
authoritative host ADR as task `H-001`, which **depends on** `GATE-004` being closed
(section 23, Epic H) — that is, the decision itself happens only at the start of Phase 6
(Multiplayer), not now.

## Why it is safe to defer

The core is explicitly transport-agnostic (section 15.4): it knows nothing about sockets,
IP, reconnection, TLS, database, or concrete authentication — the host injects commands
and collects results. This means no decision from Phase 0 to 5 (Knowledge Plane,
workspace, `domain-core`, Isekai bindings, GPU compute, client-side Web/Desktop hosts)
depends on the language of the server host. The gate's main criterion is host operation,
observability, and scale — not the solver's language, which remains Rust regardless
(`docs/decisions/GATES.md`, GATE-004).

## Options already recorded for when the gate is decided

The master source already lists the acceptable options (`docs/decisions/GATES.md`), preserved here only
as a reference — none is chosen by this ADR:

1. TypeScript/Node host loading Wasm or a native addon.
2. C# host loading a native library.
3. Rust host calling the core directly.

## Impact of the deferral

- `GATE-005` (determinism, ADR-0004) assumes a minimum floor of replay determinism on the
  same platform; if the authoritative host migrates across OS/CPU, that ADR needs to be
  revisited.
- No Phase 0-5 artifact needs to be redone when `GATE-004` is closed, as long as the
  core's boundary remains transport-agnostic per section 15.4.

## Decision

> Formal deferral recorded. The substantive decision for `GATE-004` is scheduled for the
> start of Phase 6 / Epic H (task H-001), to be made explicitly by the owner at that time.
> No agent should choose an authoritative host by default before then.

## Next steps

- Revisit this ADR and open the actual decision (replacing it or creating a specific
  ADR-000N) when starting Phase 6.
- Re-check ADR-0004 (determinism) at that time, in case the host choice changes the
  cross-platform migration assumptions.
