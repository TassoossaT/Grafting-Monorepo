# ADRs — Grafting Monorepo

This directory is referenced by [`README.md`](../../README.md) as the canonical
location for Architecture Decision Records. There is no formal generated template
yet (task `G-005` in the master source); the ADRs below use a provisional structure
(context, options, criteria, non-binding recommendation, pending decision, next
steps) until the official generator exists.

No ADR in this folder closes a gate on its own. Each one presents evidence,
options, and objective criteria; the "Decision" section may only be filled in by
the project owner, per `AGENTS.md` and `CLAUDE.md`.

## Index

| ADR | Gate | Subject | Status |
| --- | --- | --- | --- |
| [ADR-0001](ADR-0001-host-web.md) | GATE-001 | Web application host | **Accepted — closed (Next.js)** |
| [ADR-0002](ADR-0002-engine-desktop.md) | GATE-002 | Desktop game engine (C#) | Open — indefinite standby; generic ABI feasibility proven |
| [ADR-0003](ADR-0003-platforms-v1.md) | GATE-003 | Supported platforms in V1 | **Accepted — closed (Windows x64 only in V1)** |
| [ADR-0004](ADR-0004-determinism.md) | GATE-005 | Required degree of determinism | **Accepted — closed (same-platform replay + GPU tolerance)** |
| [ADR-0005](ADR-0005-authoritative-host-deferral.md) | GATE-004 | Formal deferral of the authoritative host | **Accepted — deferral memorandum (GATE-004 remains `OPEN`, not closed)** |
| [ADR-0006](ADR-0006-polymath-platform-abstraction.md) | — (complements GATE-003/006) | Polymath package: platform and capability abstraction | **Accepted (DEC-042)** |
| [ADR-0007](ADR-0007-repo-distribution-strategy.md) | GATE-007 | Multi-product repository/distribution strategy | **Accepted — closed (single monorepo)** |
| [ADR-0008](ADR-0008-libs-boundary-and-domain-map.md) | — (structural, post GATE-007) | `libs/` boundary rule and domain map (narrative, session, X6, Discord, transcription) | **Accepted (DEC-046)** |
| [ADR-0009](ADR-0009-committed-flatbuffers-fixture.md) | — (structural, §10.3 exception) | Commit C-006's frozen FlatBuffers evolution fixture's generated code | Proposed — pending owner decision |
| [ADR-0010](ADR-0010-multi-agent-coordination.md) | — (AI Control Plane Phase 1) | Provider-neutral task ownership and structured handoffs | **Accepted** |

Cross-reference: `CURRENT_PLANNING_STATE.md` lists GATE-001 through GATE-005 as
priority gates; `GRAFTING_MASTER_SOURCE.md` section 5 is the source of truth for
each gate.
