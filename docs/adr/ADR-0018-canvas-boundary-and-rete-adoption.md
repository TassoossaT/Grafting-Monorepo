# ADR-0018: unified UI canvas boundary and Rete adoption

- Status: Accepted
- Decision owner: repository-owner
- Decision date: 2026-08-04
- Record: DEC-056
- Supersedes: DEC-046 and DEC-051 clauses that make `packages/x6-canvas` active
- Amends: ADR-0008, ADR-0011, ADR-0013, ADR-0014, ADR-0016
- Related: DEC-049, DEC-052, DEC-054

## Decision

`@grafting/ui` is the single active TypeScript presentation boundary for
browser canvas elements. Consumers import Grafting concepts such as
`createCanvas`, canvas nodes/connections, and `createHeightfieldCanvas`;
package names, public symbols, inputs, outputs, and handles do not identify
Rete, Three.js, X6, or another replaceable renderer.

Rete.js is the active node-graph/editor engine and is private to
`@grafting/ui`'s canvas module tree. Three.js remains private there for 3D
and heightfield rendering; "Rete only" applies to the active node-graph canvas,
not to non-graph 3D rendering. Significant graph structure, validation,
algorithms, ordering, queries, diffs, and layout mathematics remain
authoritative in `grafting-graph-core`.

`packages/x6-canvas` is retired. Its source stays in the repository as dormant
reference code, but it has no consumer, active generated API documentation,
root validation step, or application dependency. Reactivation requires a new
explicit owner decision. `packages/three-canvas` is removed after its one real
implementation and consumer move atomically into `@grafting/ui`.

Applications continue to own concrete node mounts, connection presentation,
colors, effects, surface treatment, and interaction policy. The internal canvas
engine may change again without changing consumer imports or exposing vendor
types.

## Context

The prior boundary correctly isolated X6 but encoded the vendor in a package
name and required applications to know which adapter they were composing.
A second package repeated that pattern for Three.js. The UI package already
uses the intended model: consumers know Grafting elements while Ant Design and
react-grid-layout remain replaceable internals.

The repository owner explicitly withdrew X6 from active use, selected Rete for
future node-graph work, requested vendor-neutral names, and chose
`@grafting/ui` as the possible owning boundary. Existing research had kept
Rete conditional on a real editable/executing pipeline; the Architecture
Studio procedural-generation and agent-orchestration surfaces now provide that
direction, while the same engine can render the read-only Graph IR projection.

## Consequences

- Benefit: consumers depend on one presentation package and no renderer name.
- Benefit: Rete can grow into editable procedural or orchestration pipelines
  without creating another vendor-named public package.
- Benefit: X6 can still be studied or deliberately reactivated later.
- Cost: the old `createReadOnlyCanvas` package API is replaced atomically by
  `@grafting/ui`'s `createCanvas` contract and updated API baseline.
- Cost: `@grafting/ui` owns more internal dependencies and tests.
- Risk: Rete is more capable than a static viewer needs; read-only structural
  authority remains upstream, and editing plugins are introduced only for a
  concrete authored workflow.
- Risk: renderer replacement may expose accidental assumptions; forbidden
  module checks and behavioral tests keep vendor types out of the public API.

## Evidence

- `packages/ui/src/canvas/graph/` is the only active Rete import boundary.
- `packages/ui/src/canvas/heightfield/` is the only active Three.js canvas
  import boundary.
- `apps/architecture-studio` consumes only `@grafting/ui` canvas symbols.
- `packages/ui/tests/canvas.test.mjs` and
  `packages/ui/tests/heightfield-canvas.test.mjs` cover boundary behavior.
- `ui:api-check`, Architecture Studio tests, generated API docs, and Graph IR
  drift checks validate the atomic migration.
- Workspace `allowBuilds` explicitly denies Rete's optional informational
  postinstall; runtime packages remain usable without executing it.

## Migration or rollback

Migration removes active X6/Three package edges, moves the heightfield source
and tests, replaces Architecture Studio imports, updates the UI public API
baseline, and regenerates repository evidence in one change.

Rollback reverts that unit and DEC-056 together. It must not silently reactivate
X6, leak renderer-owned types, or move graph computation out of Rust.
