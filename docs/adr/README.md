# ADRs — Grafting Monorepo

This directory is referenced by [`README.md`](../../README.md) as the canonical
location for Architecture Decision Records. New ADRs use
[`TEMPLATE.md`](TEMPLATE.md), the canonical authoring template established by
task `G-005`. Existing ADRs retain their historical structure; they do not need
mechanical rewrites merely to resemble the new template.

No ADR in this folder closes a gate on its own. Each one presents evidence,
options, and objective criteria; the "Decision" section may only be filled in by
the project owner, per the root `AGENTS.md` operational contract.

## Authoring workflow

1. Copy `TEMPLATE.md` to `ADR-NNNN-kebab-case-title.md`, using the next
   available four-digit number.
2. Keep the title identifier equal to the filename identifier and preserve the
   metadata labels and order from the template.
3. Replace every placeholder, use ISO `YYYY-MM-DD` dates, use `None` for an
   absent optional value, and keep each metadata value on one line.
4. An agent leaves `Status: Proposed` and the `Decision` section pending. Only
   the repository owner may set `Accepted`, `Rejected`, or `Superseded`, assign
   the decision date, or close a related gate.
5. When accepted, update the master decision record and this index in the same
   reviewed change when applicable. A summary never outranks the ADR or master
   source.
6. Do not rename an accepted ADR after it has been indexed without an explicit
   migration, because its repository-relative path participates in its stable
   evidence identity.

Allowed status values for new ADRs are `Proposed`, `Accepted`, `Rejected`, and
`Superseded`. A deferral that is itself accepted uses `Accepted`; the Decision
text records what remains open. `Supersedes` and `Amends` are outgoing
relationships from the new ADR, allowing inverse relationships to be derived
without maintaining the same fact twice.

## Architecture Studio indexing contract

ADRs are canonical authored Markdown. The future repository extractor, not the
browser application, converts them into Graph IR evidence. It must:

- discover only files matching `ADR-[0-9]{4}-[a-z0-9-]+.md`, so
  `TEMPLATE.md` is never mistaken for a decision;
- derive the node ID as `adr:<repository-relative-path>` and preserve the
  source path and content hash as provenance;
- read the first heading, the contiguous metadata block, and the `Summary`
  section without treating those projections as a second authority;
- emit only relation kinds allowed by the active Graph IR schema: `Supersedes`
  maps to `supersedes`, while `Amends` and `Related` map to `related_to` until
  a versioned schema explicitly provides a more precise relation;
- derive inverse labels for presentation or queries from those stored edges
  instead of persisting a second relationship fact;
- expose parse or freshness failures instead of silently omitting an ADR.

The Architecture Studio consumes that Graph IR projection and links back to the
Markdown source. X6 layout, viewport, color, and interaction state never enter
the ADR or Graph IR contract.

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
| [ADR-0010](ADR-0010-multi-agent-coordination.md) | — (AI Control Plane Phase 1) | Provider-neutral task ownership, structured handoffs, and Claude runtime guard | **Accepted; runtime enforcement amended 2026-07-29** |
| [ADR-0011](ADR-0011-package-autonomy-and-external-isolation.md) | — (structural) | Package autonomy, external dependency isolation, and authoritative reuse | **Accepted (DEC-049)** |
| [ADR-0012](ADR-0012-knowledge-automation-plane.md) | I-001 | Knowledge/Automation Plane authority, lifecycle, and graph ports | **Accepted (DEC-050)** |
| [ADR-0013](ADR-0013-rust-graph-core-and-api-contracts.md) | — (structural amendment) | Rust graph authority and generated public API contracts per consumed package | **Accepted (DEC-051)** |

| [ADR-0014](ADR-0014-composable-capability-packages.md) | - (structural amendment) | Neutral composable capability packages and product-owned presentation | **Accepted (DEC-052)** |
| [ADR-0015](ADR-0015-agent-git-write-policy.md) | - (AI operational safety) | Prohibit agent-authored commits and default-branch pushes | **Accepted (DEC-053)** |

Cross-reference: `CURRENT_PLANNING_STATE.md` lists GATE-001 through GATE-005 as
priority gates; `GRAFTING_MASTER_SOURCE.md` section 5 is the source of truth for
each gate.
