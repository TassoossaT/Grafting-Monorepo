# ADR-0023: VTT application architecture

- Status: Accepted
- Decision owner: repository-owner
- Decision date: 2026-08-11
- Record: DEC-061
- Amends: ADR-0001 (clarifies the product host and tabletop route)
- Related: ADR-0007, ADR-0008, ADR-0011, ADR-0014, ADR-0016, ADR-0018
- Normative specification:
  `docs/architecture/vtt-application-architecture.md`

## Decision

`apps/vtt` will be the Next.js host for the VTT product. The interactive
tabletop remains a client-only route within that host, preserving DEC-041; it
is not a separate Vite application. This app is one of the distinct products
inside the monolithic workspace established by DEC-045.

The application uses vertical slices organized by product nouns (`entities`),
user verbs (`features`), large UI compositions (`widgets`), and one tabletop
composition root. App-owned ports describe VTT conversations; adapters
translate them to generic packages and platform APIs. One `TabletopRuntime`
owns each open table's external store, session, renderer, Worker, and resource
lifecycle.

Reusable packages remain generic capabilities. They MUST NOT gain a VTT
namespace, VTT-specific entities or operations, or app-exclusive methods.
Product vocabulary, workflows, presentation, and interaction policy remain in
`apps/vtt`; reusable authoritative computation remains in its canonical Rust
capability and is reached through thin app adapters.

The complete normative structure, dependency rules, runtime contract, state
partitions, gesture protocol, and acceptance checks live in
`docs/architecture/vtt-application-architecture.md`. That file is written as
an implementation contract for repository agents and is the canonical source
for the app's internal architecture.

## Status of the physical app

This ADR closes the architecture decision only. It authorizes, but does not
materialize, the real Nx/Next.js project. The first implementation must create
`project.json`, `README.md`, scope-local `AGENTS.md`, Graph IR metadata, and
`src/` atomically with a real executable slice, as required by DEC-028. It
MUST NOT create the entire conceptual tree empty.

The implementation follow-through is `vtt-roadmap.md` task `E2.6` and requires
an `ia-graft` worktree because it will touch non-Markdown files.

## Consequences

- App-local contracts may use VTT vocabulary; reusable package contracts may
  not.
- React is presentation, not ownership for confirmed table state or external
  resources.
- High-frequency gesture preview is separate from confirmed projection state.
- Gesture completion submits exactly one operation; cancellation submits none.
- Renderer, Worker, state-store, persistence, network, and authoritative-host
  implementations remain replaceable behind app-owned boundaries.
- `GATE-004` and proposed DEC-057/058/059 remain open or proposed exactly as
  recorded; this decision does not close or adopt them.

## Rejected alternatives

### VTT modules inside a generic package

Rejected because it makes a reusable capability aware of one consuming app
and contradicts DEC-046, DEC-049, DEC-052, and the owner's explicit direction.

### Technical top-level folders only

Rejected because `components`, `hooks`, `services`, and `utils` do not express
product ownership or dependency direction and tend to become global coupling
points.

### React Context as the mutable table store

Rejected because table, gesture, rendering, and Worker updates have different
frequencies and ownership. Context may carry only a stable runtime reference.

### Global event bus

Rejected because it hides ownership and ordering. Queues are allowed only at
real asynchronous boundaries.

## Acceptance evidence

The repository owner explicitly accepted the proposed application architecture
and directed E2.1 to be concluded on 2026-08-11. The normative specification
records that accepted design without claiming the later scaffold exists.
