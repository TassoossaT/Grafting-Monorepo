# ADR-0012: Knowledge and Automation Plane authority, lifecycle, and graph ports

- Status: **Proposed - pending repository-owner confirmation.**
- Proposal date: 2026-07-29.
- Backlog item: I-001.
- Related: DEC-028, DEC-040, DEC-046, DEC-048, DEC-049, ADR-0010,
  ADR-0011, and master source sections 16 and 25.

## Context

The Architecture Studio is intended to become the first real application built
on the repository's Knowledge and Automation Plane. Its initial spike already
proves that deterministic repository evidence can be rendered with X6, but it
does not yet define:

- which sources are authoritative;
- how authored information becomes validated, derived evidence;
- how a future editing flow proposes changes without mutating generated facts;
- where generic graph behavior ends and the X6 adapter begins;
- how documentation and test evidence are added without duplicating their
  source meaning.

I-001 establishes those boundaries before Graph IR v1 (I-002) and the
production read-only Studio (I-006).

## Proposed decision

### Plane responsibilities

The Knowledge Plane organizes authored sources, contracts, and reproducible
evidence. The Automation Plane validates, extracts, generates, tests, audits,
and applies approved plans through native toolchains. The Architecture Studio
is a consumer and control surface for both planes; it is never an architectural
authority by itself.

### Authority classes

Repository information belongs to one of four explicit classes:

| Class | Examples | May be edited directly? | Authority |
| --- | --- | --- | --- |
| Canonical authored source | master source, accepted ADRs, schemas, manifests, source code | Yes, through the owning workflow | Normative within the repository precedence rules |
| Operational authored state | task records, handoffs, proposals, plans | Yes, through the coordination protocol | Coordinates work; never overrides architecture |
| Derived evidence | Graph IR, Nx projections, generated bindings, test and audit reports | No | Reproducible evidence pointing back to sources |
| Presentation state | viewport, filters, selection, local layout preference | Yes | Non-normative UI state only |

Every derived fact carries source evidence or a reproducible input hash. A
summary, graph node, test card, or visual relation cannot become more
authoritative than the source it represents.

### Documentary lifecycle

The lifecycle is one directional until an explicit proposal is created:

```text
authored source
  -> native validation
  -> deterministic extraction/generation
  -> evidence with provenance
  -> read-only Graph IR projection
  -> Architecture Studio view
```

A future editing interaction starts a separate proposal flow:

```text
view intent
  -> proposed source patch or structured command
  -> policy and schema validation
  -> plan/diff review
  -> owner or task-authorized approval
  -> native executor changes the authored source
  -> evidence is regenerated
```

The Studio must not write generated Graph IR, generated bindings, test output,
or audit output directly. It may remember presentation state without treating
that state as repository truth.

### Generic graph port and X6 adapter

The target TypeScript dependency direction is:

```text
                         +--------------------+
Graph IR projection ---> | @grafting/graph    |
                         | model + ports      |
                         +---------^----------+
                                   |
                         implements| GraphCanvasPort
                                   |
                         +---------+----------+
                         | @grafting/x6-canvas|
                         | X6 adapter         |
                         +---------+----------+
                                   |
                                @antv/x6

apps/architecture-studio composes the projection, graph contract, and adapter.
```

Using the owner's connector analogy, `@grafting/graph` owns the stable female
socket and `@grafting/x6-canvas` supplies the matching male plug. Concretely:

- `@grafting/graph` owns the vendor-neutral immutable node/edge model and the
  ports used to render, select, inspect, and dispose graph views;
- graph extension points are framework-neutral ports and callbacks first;
  React hooks or other framework bindings are added only with a real consumer;
- `@grafting/graph` knows neither Graph IR nor X6, DOM containers, VTT rules,
  documentation routes, or product presentation;
- `@grafting/x6-canvas` depends on the graph contract, imports `@antv/x6`, and
  implements the browser adapter without exporting vendor types or the mutable
  X6 `Graph`;
- `apps/architecture-studio` initially owns its Graph IR-to-generic-graph
  projection as an internal module because it is the only real consumer;
- if that projection gains another real consumer, it is promoted as one
  coherent capability instead of being copied.

The current `@grafting/graph-x6` spike package is transitional. A later
implementation task will migrate its generic model/port behavior into
`@grafting/graph`, move the Graph IR projection to the Studio's owning boundary,
and retire or rename `graph-x6` atomically. The repository must not retain both
old and new authoritative mapping paths.

This creates two reusable packages because there are two demonstrated
boundaries: a vendor-neutral graph contract and a replaceable X6 runtime
adapter. It does not establish a package-per-layer or package-per-dependency
rule.

### Initial Architecture Studio scope

The first production slice remains read-only and focuses on repository
documentation and validation evidence:

1. navigate projects, tasks, agents, documents, decisions, and their evidence;
2. show validation state and link every derived item to its source;
3. filter and inspect a subgraph without changing repository meaning;
4. expose freshness or drift failures instead of silently displaying stale
   evidence;
5. keep test execution in the Automation Plane and display only its structured
   results.

Editing workflows, autonomous maintenance, arbitrary code execution, and
provider-specific agent control are outside this first slice.

## Options considered

### Keep `graph-x6` as the permanent central abstraction

Rejected as the target because its name and dependency direction couple the
graph capability to one rendering library even when its public types are
currently vendor-neutral.

### Put all graph and X6 code inside the app

Rejected because the graph contract and X6 adapter already have credible reuse
outside the Architecture Studio, including another graph-oriented product.

### Create separate packages for model, queries, hooks, layout, ports, and X6

Rejected for now. No evidence justifies that package count. These concerns may
start as modules within `@grafting/graph` and be separated only when DEC-049's
reuse or ownership criteria are met.

## Acceptance criteria

I-001 is accepted when the repository owner confirms that:

- the four authority classes and lifecycle are correct;
- derived evidence is read-only and traceable to authored sources;
- proposed edits target authored sources through plan/diff and approval;
- `@grafting/graph` owns vendor-neutral ports and model;
- `@grafting/x6-canvas` implements those ports and exclusively owns the X6 API;
- the Studio owns composition and its initial Graph IR projection;
- the `graph-x6` migration happens atomically in a separately validated task.

## Consequences

- I-002 can define Graph IR v1 without embedding viewer-library concepts.
- Test and documentation views share provenance rules instead of custom copies.
- X6 can be replaced or forked without changing the graph contract when that
  contract remains valid.
- A future renderer can implement the same graph port without changing the
  Knowledge Plane.
- Presentation state and repository truth remain separate.

## Risks

- An overly broad graph contract could become a renamed X6 API. Ports must be
  derived from Grafting use cases and kept deliberately small.
- Premature framework hooks could bind the generic package to React or another
  UI framework without evidence.
- Migrating `graph-x6` incrementally could duplicate the authoritative Graph IR
  mapping. The migration needs one cutover and deletion of the superseded path.
- Test evidence can become stale unless every record carries run identity,
  source revision, and freshness status in a later schema.

## Decision

Pending explicit confirmation from the repository owner. No package rename,
move, or new Graph IR v1 contract is authorized by this proposal alone.

## Next steps after acceptance

1. record the accepted decision in the master source and current state;
2. execute I-002 to define Graph IR v1 authority, identifiers, provenance, and
   evidence schemas;
3. plan the atomic `graph-x6` to `graph` boundary migration against Graph IR v1;
4. continue I-004 and I-006 with drift checks and a read-only Studio slice.
