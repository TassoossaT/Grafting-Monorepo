# Architecture Studio read-only v1 specification

- Specification: I-006 functional and interaction contract
- Version: 0.1
- Date: 2026-07-29
- Status: implementation-ready proposal; it does not close I-006
- Product stage: first production read-only slice
- Depends on: I-002 Graph IR v1 and I-004 Nx to Graph IR extractor
- Related decisions: DEC-049, DEC-050, DEC-051, DEC-052
- Related records: ADR-0011, ADR-0012, ADR-0013, ADR-0014

## 1. Outcome

Architecture Studio v1 is a repository-backed, read-only graph explorer. It
loads the real Graph IR v1 document, lets a user navigate a bounded subgraph,
inspect the provenance of every visible fact, and return to the authored or
generated source evidence without changing repository meaning.

The first real data slice contains Nx projects, targets, `contains` edges, and
`depends_on` edges produced by I-004. The interface must be designed for later
Graph IR kinds, but I-006 does not claim that ADR, task, agent, handoff, test,
or run extraction already exists.

The product north star remains a repository-specialized, improved Obsidian:
documentation, project state, validation evidence, AI work, and relationships
can eventually be explored from one surface. This specification deliberately
starts with the smallest honest production slice.

## 2. Authority and safety model

The application is a projection and control surface, never an architectural
authority.

| Information | Authority | Studio behavior |
| --- | --- | --- |
| Source, manifests, schemas, accepted ADRs | Canonical authored source | Read and link; never rewrite through this slice |
| Tasks, handoffs, proposals | Operational authored state | Future read-only projection; no direct mutation in v1 |
| Graph IR and validation reports | Derived evidence | Display with provenance; never edit |
| Selection, filters, zoom, pan, node position, panel size | Presentation state | May change locally; never enters Graph IR |

Every displayed graph fact must remain traceable to `provenance.evidence`.
Presentation labels, colors, icons, grouping, viewport, and local filter state
must not be written into the Graph IR document.

## 3. Scope

### 3.1 Required in I-006 v1

1. Load `docs/generated/grafting.graph.json`, not the frozen spike output.
2. Reject unsupported Graph IR versions and invalid documents visibly.
3. Display graph identity, source revision, generator identity/version, input
   hash, node count, and edge count.
4. Provide both a visual canvas and a keyboard-accessible entity list.
5. Filter by node kind, edge kind, tag, and text label/ID.
6. Request valid filtered/subgraph results through a Rust-owned graph query
   boundary when the operation depends on graph structure.
7. Select/activate an entity from either the list or canvas.
8. Inspect the selected entity's identity, kind, authority class, level, tags,
   relation data, confidence, extractor, revision, and evidence.
9. Copy stable IDs, revisions, hashes, repository-relative paths, JSON
   pointers, and symbols when present.
10. Show clear loading, empty, invalid, unsupported, and freshness states.
11. Preserve the non-editable canvas guarantee.
12. Atomically remove the transitional `@grafting/graph-x6` path after the
    application-owned Graph IR presentation projection is validated.

### 3.2 Explicitly outside I-006 v1

- editing Markdown, ADRs, manifests, tasks, Graph IR, or generated evidence;
- executing tests, builds, scripts, agent tools, or arbitrary commands;
- task, agent, handoff, prompt, skill, tool, run, and AI trace extraction;
- ADR and general Markdown extraction beyond existing real Graph IR data;
- generating I-005 context packs or exposing a Context Broker;
- semantic/vector search, Qdrant, or embedding generation;
- collaborative editing, CRDTs, Yrs/Yjs, or remote synchronization;
- JSON Canvas import/export;
- Milkdown, Excalidraw, Tree-sitter, Node-RED, or another new runtime library;
- graph algorithms, reusable filtering, layout mathematics, or subgraph logic
  implemented in TypeScript;
- changing the authoritative Graph IR v1 schema merely to simplify the UI;
- choosing a permanent browser host or promoting the current Vite spike host
  into a repository-wide architectural decision.

Candidate open-source integrations remain cataloged separately in
[`../research/architecture-studio-open-source-options.md`](../research/architecture-studio-open-source-options.md).

## 4. Primary user

The first user is the repository owner working locally while multiple AI
providers may be changing the monorepo through coordinated tasks.

The user needs to answer these questions without reading generated JSON:

- What projects and targets currently exist?
- Which projects depend on which other projects?
- Why is this node or edge present?
- Which file and exact location supplied this fact?
- Is the displayed graph associated with the expected repository revision?
- Can I isolate one project and its relevant neighborhood without modifying
  anything?

## 5. Core user journey

1. The user opens Architecture Studio.
2. The application enters `loading` and attempts to load the real Graph IR.
3. The application validates the supported schema version and structural
   contract before rendering.
4. A summary bar displays graph identity, revision, freshness state, and
   counts.
5. The full project/target graph is visible in the canvas and entity list.
6. The user searches or selects filters.
7. The application requests the resulting view snapshot. Graph-aware
   selection and subgraph work is performed by Rust through a batched contract.
8. The entity list and canvas render the same snapshot and preserve stable IDs.
9. The user activates a node or edge.
10. The inspector displays its data and complete provenance evidence.
11. The user copies a source path, pointer, hash, or stable ID and returns to
    repository work.

No step writes repository or generated data.

## 6. Information architecture

I-006 v1 has one primary workspace rather than several mostly empty routes.

```text
+--------------------------------------------------------------------------------+
| Architecture Studio | graph + revision | freshness | counts | Center | Reset  |
+----------------------+----------------------------------------+----------------+
| Explorer             | Graph canvas                           | Inspector      |
| [Search...........]   |                                        |                |
| Node kinds            |    project ----depends_on----> project | Stable ID      |
| [x] project           |       |                                | Kind/authority |
| [x] target            |    contains                            | Tags/level     |
| Edge kinds            |       v                                | Relations      |
| [x] contains          |     target                             | Provenance     |
| [x] depends_on        |                                        | Evidence       |
| Tags                  |                                        | Copy actions   |
| --------------------  |                                        |                |
| Entity results        |                                        |                |
+----------------------+----------------------------------------+----------------+
| status / errors / current visible node and edge counts                          |
+--------------------------------------------------------------------------------+
```

On narrow screens the Explorer and Inspector become dismissible drawers. The
canvas may shrink, but the entity list remains available so the graph is not
the only navigation mechanism.

### 6.1 Header

The header contains:

- product name;
- `graphId`;
- shortened `sourceRevision` with a copy-full-value action;
- freshness badge: `verified`, `stale`, `unknown`, or `invalid`;
- total and visible node/edge counts;
- `Center` and `Reset view` actions.

`Center` only changes the viewport. `Reset view` clears presentation filters,
selection, zoom, and pan; it never regenerates or changes Graph IR.

### 6.2 Explorer

The Explorer contains:

- text search over label and stable ID;
- node-kind multi-select;
- edge-kind multi-select;
- tag multi-select populated from the current document;
- entity result list with kind, label, stable ID, and authority indicator;
- a clear-filters action;
- visible/total result count.

Search and filters combine with logical `AND` across categories and `OR`
within a category. The exact query is submitted as one immutable request to
the graph query boundary. The application must not rebuild structural
filtering independently.

### 6.3 Canvas

The Canvas:

- renders only immutable Grafting-owned node and edge presentation data;
- preserves the stable Graph IR IDs exactly;
- allows pan, bounded zoom, centering, local node repositioning, and read-only
  activation;
- prohibits creating/reconnecting edges, editing labels, deletion, clipboard
  mutation, and vendor command access;
- distinguishes node and edge kinds using text/icon/shape in addition to
  color;
- exposes selected and keyboard-focused state through Grafting-owned
  presentation contracts, not X6 objects.

The implemented presentation maps Graph IR kinds to opaque application view
data and stable application view IDs. `src/canvas-composition.ts` supplies the
current `@grafting/ui` Ant Design Card mount, ports, smooth curves, arrow
markers, compact relation labels, effects, canvas surface, and interaction
policy to the neutral canvas adapter. Neither vendor API crosses the
application contract. New visual shapes are application-owned view definitions
and do not change graph structure or canvas lifecycle code. Dragging changes
only the private position of a rendered node for the lifetime of the canvas;
it does not mutate the immutable projection, the Rust layout snapshot, or
Graph IR.

A simple deterministic application-owned placement by kind may be used when it
is purely presentation policy. Any graph-aware ranking, layered/DAG layout,
crossing minimization, path-based placement, or reusable layout calculation
belongs in Rust.

The implemented initial heuristic follows that boundary: the application
selects grouping relation kinds and presentation dimensions in one projection
configuration, sends the corresponding stable IDs through one batched Worker/
Wasm request, and receives an immutable grouped-grid snapshot calculated by
`grafting-graph-core`. TypeScript does not calculate coordinates.

### 6.4 Inspector

With no selection, the Inspector explains how to choose an entity and shows a
small graph summary. With a selection, it shows:

For nodes:

- label and stable ID;
- `kind`, `authorityClass`, optional `level`, and tags;
- incoming and outgoing relation summaries from the current view snapshot;
- provenance extractor ID/version, source revision, and confidence;
- every evidence item with kind, path, optional pointer, optional symbol, and
  SHA-256.

Incoming/outgoing summaries are supplied by the Rust-owned snapshot/query
result. The Inspector formats those values; it does not maintain a second
adjacency implementation in TypeScript.

For edges:

- stable ID, relation kind, and relation class;
- source and target stable IDs with activate actions;
- the same provenance and evidence structure.

Hashes and revisions may be visually shortened, but copy actions must return
the complete original value. Evidence must never be silently collapsed into a
single source when several entries exist.

### 6.5 Source actions

The universally supported source action is `Copy repository path`. Additional
`Open source` behavior requires a host-owned capability that safely maps a
repository-relative path to the current workspace. The browser must not invent
`file://` URLs or expose arbitrary filesystem access.

## 7. Functional requirements

### Data loading and identity

- **FR-001:** The application must consume Graph IR v1 from
  `docs/generated/grafting.graph.json` in the production build path.
- **FR-002:** The application must not import
  `docs/generated/grafting.graph.spike.json` after the I-006 cutover.
- **FR-003:** Before canvas creation, the document must pass the authoritative
  Graph IR validation path applicable to the built artifact.
- **FR-004:** `schemaVersion`, `graphId`, `sourceRevision`, generator ID,
  generator version, and generator input hash must be retained unchanged.
- **FR-005:** Unsupported versions and invalid structure must render an error
  state containing an actionable reason; the application must not display a
  partial graph as if it were valid.

The normal production artifact should be validated during its deterministic
generation/build path. Runtime guards may prevent unsafe rendering and explain
an invalid input, but they must not become an independently maintained copy of
the Rust structural validator or Graph IR schema rules.

### Navigation and view snapshots

- **FR-006:** The entity list and canvas must represent the same immutable view
  snapshot and preserve node/edge IDs.
- **FR-007:** A view request may contain text, node kinds, edge kinds, tags,
  selected/root entity, direction, and optional neighborhood depth.
- **FR-008:** Structural filtering, neighborhood/subgraph creation, ordering,
  and graph-aware layout must execute through a batched Rust-owned contract.
- **FR-009:** A query failure must leave the last valid snapshot visible or
  show a clear non-destructive error; it must never mutate the source document.
- **FR-010:** Empty query results must show `No matching entities`, preserve
  the active filters, and provide a clear-filters action.

### Activation and inspection

- **FR-011:** A node or edge can be activated from the entity list.
- **FR-012:** A node or edge can be activated from the canvas without enabling
  graph editing.
- **FR-013:** Canvas activation emits only a Grafting stable ID and entity kind
  or another minimal Grafting-owned value; it must not expose an X6 cell/event.
- **FR-014:** List selection, canvas selection, inspector content, and URL/local
  presentation state must converge on one selected stable ID.
- **FR-015:** The Inspector must render every provenance evidence entry and all
  fields present in the Graph IR contract.
- **FR-016:** Activating an edge endpoint from the Inspector must select the
  referenced node when it is part of the current snapshot, or offer a new
  bounded view request when it is outside that snapshot.

### Freshness and failures

- **FR-017:** `verified` may be displayed only when a deterministic validation
  artifact or build-time check proves the Graph IR matches its declared inputs.
- **FR-018:** If the application only knows the document revision, freshness
  must be `unknown`, not inferred from appearance or load success.
- **FR-019:** A known check mismatch must display `stale` and must not be hidden
  by a successful JSON parse.
- **FR-020:** Error details must distinguish load failure, unsupported schema,
  invalid Graph IR, Rust query failure, and canvas render failure.

### Read-only guarantee

- **FR-021:** No UI control may edit Graph IR or authored repository files.
- **FR-022:** The rendered canvas may explicitly allow local node
  repositioning, but must keep connection, edge, vertex, label, tool, and
  graph-data editing interactions disabled.
- **FR-023:** No public app or package API may return the mutable X6 graph,
  cells, events, options, errors, or configuration objects.
- **FR-024:** Test/build execution belongs to the Automation Plane and is not a
  hidden side effect of browsing, filtering, or selecting entities.

## 8. View request and snapshot concepts

This specification defines product concepts rather than a finalized ABI.
Exact Rust and Wasm declarations require their own implementation review and
public API checks.

```text
GraphViewRequest
  text?: string
  nodeKinds: NodeKind[]
  edgeKinds: EdgeKind[]
  tags: string[]
  rootId?: StableId
  direction?: incoming | outgoing | both
  depth?: integer

GraphViewSnapshot
  requestIdentity
  sourceRevision
  nodes[]
  edges[]
  totalCounts
  visibleCounts
  diagnostics[]
```

Constraints:

- requests and results cross the runtime boundary in batches;
- no elementary `getNode`, `nextEdge`, or coordinate-per-call hot path;
- results are immutable snapshots using Grafting IDs and value types;
- Rust/vendor types do not cross the ABI;
- the TypeScript app enriches results with labels, colors, icons, components,
  and viewport state only after the graph result is fixed;
- schema-specific provenance remains Graph IR evidence, not a Rust-owned ADR or
  task authority.

## 9. Package and dependency boundaries

The target dependency direction is:

```text
docs/generated/grafting.graph.json
  -> Architecture Studio Graph IR loader/single projection configuration
  -> app-owned Web Worker
  -> @grafting/isekai-wasm generated adapter
  -> batched grafting-graph-core layout/query boundary
  -> immutable layout snapshot + application presentation enrichment
  -> immutable Grafting canvas model
  -> @grafting/x6-canvas
  -> @antv/x6 (private)
```

Concrete presentation composes alongside that data flow:

```text
Architecture Studio canvas composition
  -> @grafting/ui DOM mount lifecycle (Ant Design private)
  -> @grafting/x6-canvas neutral node/edge contracts (X6 private)
```

I-006 must not create separate packages for loader, filters, hooks, inspector,
layout, or each UI component without a demonstrated reuse/build/API boundary.
They begin as coherent modules inside the owning application or existing Rust
crate.

The transitional direction below disappeared atomically during the cutover:

```text
Architecture Studio -> @grafting/graph-x6 -> @grafting/x6-canvas
```

The application is now the sole owner of its Graph IR presentation mapping.
No second mapping remains after migration; `@grafting/graph-x6` was removed.

## 10. Required `x6-canvas` contract evolution

The current public canvas handle exposes counts, `center()`, and `dispose()`.
That is insufficient for an Inspector driven from the visual canvas.

I-006 implementation therefore requires one minimal, vendor-neutral,
read-only activation capability. The exact API name is decided in the
implementation task, but its behavior must satisfy all of these constraints:

1. input/output values use only Grafting-owned IDs and primitive/value types;
2. activation does not implicitly enable movement, connecting, editing, or
   deletion; node movement is a separate opt-in interaction policy;
3. the consumer can distinguish node activation from edge activation;
4. selection can be updated from outside the canvas so list and canvas remain
   synchronized;
5. disposal removes listeners and prevents later callbacks;
6. the generated TypeScript public API baseline is intentionally updated;
7. negative tests prove that `@antv/x6` types still do not leak;
8. behavioral contract tests prove activation, external selection, and
   disposal semantics.

This is an intentional consumed-package API change under DEC-051, not a private
shortcut inside the app.

## 11. Presentation mapping

The application maps Graph IR fields without changing their meaning:

| Graph IR field | Presentation use |
| --- | --- |
| `node.id` / `edge.id` | Stable selection, list key, canvas identity, copy action |
| `kind` | Label, icon/shape, filter option |
| `authorityClass` | Authority badge and Inspector explanation |
| `level` | Optional hierarchy badge/filter when present |
| `label` | Primary visible text |
| `tags` | Secondary labels and filter options |
| `relationClass` | Edge styling plus explicit text, never color alone |
| `provenance.confidence` | Numeric/semantic confidence presentation |
| `provenance.extractor` | Extractor identity/version in Inspector |
| `provenance.sourceRevision` | Revision in Inspector and mismatch diagnostics |
| `provenance.evidence` | Complete evidence list and copy actions |

The application must render unknown-but-schema-valid kinds through a generic
fallback presentation rather than crashing. A schema-invalid kind is an input
validation failure, not a generic fallback.

## 12. Application states

| State | Required behavior |
| --- | --- |
| `loading` | Show progress/skeleton; do not create an empty canvas presented as success |
| `ready` | Header, Explorer, canvas, and Inspector operate on one valid snapshot |
| `empty-document` | Valid graph with zero entities; explain that no evidence is present |
| `no-query-results` | Retain filters and offer clear/reset without changing the source |
| `unsupported-schema` | Show received and supported versions; no partial rendering |
| `invalid-graph` | Show validation summary and source identity when safely available |
| `stale` | Keep evidence visible with prominent stale status and regeneration guidance |
| `unknown-freshness` | Show that validity is known but freshness was not proven |
| `query-error` | Preserve last valid view where possible and report the query failure |
| `canvas-error` | Keep accessible entity list/Inspector usable and report render failure |

Errors shown to the user must not include secrets, arbitrary file contents, or
unbounded stack traces. Development diagnostics may remain in the developer
console when they do not expose protected data.

## 13. Accessibility and keyboard behavior

- Every filter, result, copy action, Center, and Reset control must be keyboard
  reachable with a visible focus indicator.
- The entity result list uses semantic list/option behavior and exposes the
  current selection.
- Selecting an entity from the list must not require using the canvas.
- Status and error changes use an appropriate live region without repeatedly
  announcing viewport-only changes.
- Color is never the sole indicator of kind, relation class, authority, state,
  or selection.
- Hashes and IDs remain available as text even if visually truncated.
- Canvas failure must not remove access to the entity list and provenance.

## 14. Presentation-state persistence

For v1, filters and selected stable ID should be serializable into URL query
parameters so a local view can be revisited. Zoom, pan, panel sizes, and drawer
state may remain in memory.

All URL values are presentation state:

- they do not become Graph IR evidence;
- unknown kinds/tags/IDs are ignored with a diagnostic rather than changing
  source data;
- stable IDs must be URL encoded and decoded losslessly;
- loading a URL against a different graph revision must show the current
  revision and gracefully clear selections that no longer exist.

No database or synchronization service is required for I-006.

## 15. Performance and resource guardrails

The accepted spike measured approximately 592.15 KiB raw / 170.14 KiB gzip of
JavaScript. I-006 must capture a new production bundle report instead of
silently accepting growth.

Provisional guardrails:

- JavaScript gzip, excluding source maps and Wasm, should stay at or below
  200 KiB. A larger result requires an itemized explanation and owner review;
- Wasm size must be reported separately when the Rust graph query boundary is
  added; the first real measurement establishes its budget rather than hiding
  it inside the JavaScript number;
- initial render, filtering, activation, and disposal must complete without
  browser console errors on the real I-004 document;
- repeated filter/view replacement must dispose the previous canvas/listeners
  and must not accumulate duplicate activation callbacks;
- a synthetic larger fixture may be used for measurement, but it remains test
  evidence and does not become a second canonical Graph IR document.

## 16. Security and trust boundaries

- Treat labels, tags, paths, symbols, and diagnostics as untrusted text; do not
  render them as arbitrary HTML.
- Repository-relative evidence paths must remain relative and must not permit
  path traversal when passed to any future host source-opening capability.
- Do not fetch remote content referenced by a label/path automatically.
- Do not include source-file contents in the Graph IR merely to make the
  Inspector easier to implement.
- Any future trace/run ingestion must define secret and retention policies
  before appearing in this application.

## 17. Acceptance criteria

- **AC-001:** Production code imports the real Graph IR v1 output and contains
  no reference to the spike JSON.
- **AC-002:** A valid real document renders with exact total counts, graph ID,
  source revision, generator identity/version, and input hash.
- **AC-003:** Unsupported schema and invalid/dangling graph fixtures produce
  distinct visible failure states without a success canvas.
- **AC-004:** Every rendered list/canvas entity preserves its Graph IR stable
  ID, and the visible snapshot contains no dangling edge.
- **AC-005:** Kind, relation, tag, and text filters combine according to this
  specification and return a Rust-produced immutable snapshot for structural
  operations.
- **AC-006:** Activating an entity from the list selects it in the canvas and
  Inspector; activating it from the canvas selects it in the list and
  Inspector.
- **AC-007:** The Inspector renders every present provenance/evidence field and
  copy actions return complete unmodified values.
- **AC-008:** Center, Reset, filters, activation, local node movement, URL
  restoration, and disposal change presentation only; a before/after hash of
  the input Graph IR remains identical.
- **AC-009:** Node drag may update private canvas coordinates only. Connect,
  reconnect, edge/vertex/label editing, delete, and mutable vendor graph access
  remain unavailable.
- **AC-010:** Empty results, unknown freshness, stale evidence, query failure,
  and canvas failure are observable and recoverable as specified.
- **AC-011:** All core navigation and inspection tasks can be completed with a
  keyboard and without relying on color.
- **AC-012:** `@grafting/graph-x6` is removed in the same validated cutover that
  moves the presentation projection into the app; no duplicate Graph IR
  mapping remains.
- **AC-013:** `x6-canvas:api-check` passes against an intentionally reviewed
  baseline, forbidden `@antv/x6` public-type tests pass, and activation/
  disposal behavioral contracts pass.
- **AC-014:** Graph IR schema/Rust structural validation, app typecheck/tests,
  package checks/tests, and the production build all pass without relying on
  Nx cache.
- **AC-015:** The real app is checked in a supported browser for list/canvas
  synchronization, local node movement, structural read-only behavior,
  provenance inspection, filters, zoom, pan, Center, Reset, URL restoration,
  and absence of runtime/console errors.
- **AC-016:** The bundle report records raw and gzip JavaScript plus separate
  Wasm size when applicable, and evaluates the provisional guardrails.

## 18. Test matrix

| Layer | Required evidence |
| --- | --- |
| Graph IR loader | valid v1, unsupported version, malformed document, missing evidence, dangling edge |
| Rust graph query | combined filters, neighborhood depth/direction, no matches, cycles where allowed, deterministic snapshot ordering |
| Presentation projection | every v1 node/edge kind has generic presentation; stable IDs/fields preserved |
| `x6-canvas` | activation, external selection, opt-in node movement with structural editing disabled, no vendor-type leakage, listener cleanup/disposal |
| Explorer/Inspector | keyboard selection, copy-full-value, multiple evidence items, endpoint navigation |
| URL state | lossless stable IDs, invalid/removed ID recovery, different-revision recovery |
| Application | loading/error/empty/stale/unknown/ready states, real document, production build |
| Browser acceptance | pan, node movement, bounded zoom, Center, Reset, filters, synchronized selection, structural read-only guarantee |

Tests may independently repeat expected behavior. They must remain traceable to
the canonical Graph IR schema and Grafting contracts rather than maintaining a
second implementation of graph rules.

## 19. Implementation checkpoints

These are checkpoints inside I-006 planning, not a requirement to create one
package or one durable task per line.

### Checkpoint A: contract preparation

- define the batched Rust view request/snapshot operation needed by real UI
  filters and neighborhood navigation;
- define minimal vendor-neutral canvas activation/external-selection behavior;
- update and test consumed-package API baselines intentionally.

### Checkpoint B: atomic data and adapter cutover

- import Graph IR v1 real output;
- create the application-owned presentation projection;
- remove the `graph-x6` dependency/package and spike JSON use in one change;
- preserve stable IDs and read-only behavior.

### Checkpoint C: explorer and provenance

- implement Header, Explorer, entity list, Inspector, URL state, and complete
  application states;
- connect filters/subgraphs to the Rust snapshot boundary;
- add accessibility and copy actions.

### Checkpoint D: verification and handoff

- run API, structural, unit, integration, build, browser, bundle, and
  coordination validations;
- record limitations, freshness semantics, measured sizes, and browser details;
- obtain independent review where required before representing I-006 as
  complete.

## 20. Later product increments

These extend the same information architecture after their authoritative data
and contracts exist:

1. authored Markdown and ADR extraction with source links and drift status;
2. coordination tasks, agents, and handoffs through an `.ai/` Graph IR
   extractor extension;
3. structured test and audit evidence views without executing tests in the
   browser;
4. I-005 task-centered `ContextPacket` generation and review;
5. full-text search, evaluated first with Tantivy in Rust;
6. OpenTelemetry/OpenInference agent-run evidence after a data/secret policy;
7. JSON Canvas interoperability;
8. proposal/diff/approval editing, followed by a Markdown editor evaluation;
9. collaboration or semantic retrieval only after a measured need.

The first future increment should add real extracted evidence, not empty tabs
or placeholder packages.

## 21. Definition of done for the specification

Traceability to the controlling scope is explicit:

| Source obligation | Specification coverage |
| --- | --- |
| I-006: navigable subgraph | FR-006 through FR-016; AC-004 through AC-007 |
| I-006: no editing of derived facts | FR-021 through FR-024; AC-008 and AC-009 |
| ADR-0012: provenance and source links | Sections 6.4-6.5; FR-015 through FR-020; AC-007 and AC-010 |
| ADR-0012: freshness/drift is visible | FR-017 through FR-020; application-state table |
| ADR-0012: projects, tasks, agents, documents, decisions, and test evidence | Projects/targets are the real I-004 starting slice; missing authoritative extractors are explicit later increments in Section 20 and are not represented as completed data |
| DEC-051: graph computation in Rust | FR-008, Section 8, Checkpoint A, and Rust query tests |
| DEC-049: smallest owning boundary | Section 9; no package-per-component design |

This specification is ready for implementation planning when:

- every I-006 backlog criterion maps to functional and acceptance requirements;
- current I-004 capabilities and missing data kinds are distinguished;
- all write/execution features are explicitly excluded;
- Rust, application, canvas, and vendor responsibilities are unambiguous;
- selection and API compatibility impacts are identified before code changes;
- failure, freshness, accessibility, test, and performance expectations are
  verifiable;
- no I-004 implementation or generated artifact was changed by authoring this
  document.
