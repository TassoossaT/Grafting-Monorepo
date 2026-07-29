# Architecture Studio open-source integration options

- Research date: 2026-07-29
- Status: non-normative candidate catalog
- Decision authority: none; inclusion here does not approve or adopt a tool
- Product direction: repository-backed knowledge, project, validation, and AI-run review surface

## Purpose

The Architecture Studio is intended to become an Obsidian-like local knowledge
environment specialized for the Grafting repository. Its distinguishing value
is not an unbounded model prompt. It is durable, traceable knowledge from which
the application can assemble a bounded context packet for a specific task.

Candidate inputs include authored Markdown, ADRs, manifests, source code,
coordination tasks and handoffs, Git history, test evidence, and agent/tool
execution traces. Deterministic extractors turn those inputs into evidence with
provenance. Graph IR represents the useful repository relations, Rust owns
reusable graph calculations, and the Studio owns presentation.

```text
authored sources + operational state + external run evidence
                         |
                  bounded adapters
                         |
           derived evidence and Graph IR
                         |
       Rust graph queries and context selection
                         |
       X6 views, search, review, and context packets
```

Raw high-volume traces do not all need to become Graph IR nodes. They may stay
as derived evidence while the extractor projects only useful run, artifact,
task, decision, and validation relations into the graph.

## Existing architectural constraints

Any future evaluation or adoption must preserve these accepted decisions:

- canonical authored files remain authoritative; the Studio and generated
  Graph IR remain consumers and derived evidence (DEC-050);
- reusable graph structures, algorithms, validation, ordering, queries, diffs,
  and layout mathematics remain in `grafting-graph-core` (DEC-051);
- `@grafting/x6-canvas` remains the only TypeScript boundary that imports
  `@antv/x6`, and vendor types do not cross its public API;
- each third-party API stays inside its smallest useful owning boundary, but a
  separate package is not created merely because a dependency exists
  (DEC-049);
- the initial production Studio slice remains read-only. Future editing targets
  authored sources through proposal, validation, diff, and approval;
- repository-native test tools execute tests. The Studio consumes structured
  results and does not become a second test runner implementation.

## Primary candidates

| Candidate | License | Potential role | Recommended timing |
| --- | --- | --- | --- |
| [JSON Canvas](https://jsoncanvas.org/) | MIT | Import/export interoperability with Obsidian-style `.canvas` files. It is not a replacement for Graph IR. | Early, after the real read-only Studio slice |
| [Milkdown](https://github.com/Milkdown/milkdown) | MIT | WYSIWYG Markdown editing while keeping Markdown as the authored format. Vendor API stays behind a document-editor boundary. | After the proposal/diff/approval editing lifecycle exists |
| [Tantivy](https://github.com/quickwit-oss/tantivy) | MIT | Embedded Rust full-text index with BM25, phrase queries, fields, facets, and incremental indexing. | Early search spike after real repository evidence exists |
| [OpenTelemetry](https://opentelemetry.io/docs/) | Apache-2.0 | Vendor-neutral traces, metrics, and logs for operations and tool execution. | Early contract/spike for agent-run evidence |
| [OpenInference](https://github.com/Arize-ai/openinference) | Apache-2.0 | AI-specific semantic conventions over OpenTelemetry for model, retrieval, agent, and tool spans. | Pair with OpenTelemetry; map into Grafting-owned run contracts |
| [gitoxide/gix](https://github.com/GitoxideLabs/gitoxide) | MIT OR Apache-2.0 | Read Git objects, revisions, diffs, status, and provenance in Rust. | When Git history becomes a real Studio view/query requirement |
| [Mermaid](https://github.com/mermaid-js/mermaid) | MIT | Render authored text diagrams inside documentation. It complements rather than replaces X6. | When Markdown rendering needs diagrams |
| [Allure 3](https://github.com/allure-framework/allure3) | Apache-2.0 | Reference implementation or optional adapter for multi-language test reports. | Later; ingest JUnit XML, SARIF, LCOV/Cobertura, and native reports first |

## Deferred candidates

| Candidate | License | Potential role | Admission condition |
| --- | --- | --- | --- |
| [Qdrant](https://github.com/qdrant/qdrant) | Apache-2.0 | Vector and semantic retrieval, including a Rust implementation and local/edge options. | Tantivy plus graph queries must first prove insufficient for a measured use case |
| [Yrs/Y-CRDT](https://github.com/y-crdt/y-crdt) | MIT | Rust/Yjs-compatible collaborative documents with Rust and Wasm boundaries. | Real-time multi-user editing is approved and the persistence/sync model is decided |
| [Excalidraw](https://github.com/excalidraw/excalidraw) | MIT | Free-form sketches stored as documents or attachments related to graph evidence. | A sketching use case exists that X6 semantic views should not serve |
| [Tree-sitter](https://github.com/tree-sitter/tree-sitter) | MIT | Incremental multi-language syntax parsing for symbol and call-relationship views. | Native manifests, Rustdoc JSON, TypeScript declarations, and language-native extractors cannot satisfy a concrete cross-language navigation need |
| [Node-RED](https://github.com/node-red/node-red) | Apache-2.0 | Executable visual automation or flow import. | The Automation Plane explicitly needs user-authored executable flows; it is not part of the initial read-only Studio |

### Tree-sitter complexity note

Tree-sitter is deliberately not an initial dependency. It would require
selecting and pinning grammars per language, defining stable queries, handling
grammar/version drift, incremental index ownership, and controlling a much
larger graph. The repository already has more precise structured sources for
the initial product: Nx/project manifests, Cargo metadata, public API reports,
Rustdoc JSON, TypeScript declarations, JSON Schema, Graph IR, and authored
Markdown metadata.

Tree-sitter becomes justified only for a concrete view such as:

```text
package -> file -> type -> function -> calls function
```

and only when the required relation cannot be obtained reliably from the
native language toolchain without duplicating authoritative extraction logic.

## External systems and product references

These products are useful as API integrations or design references. They are
not candidates to copy wholesale into the Studio:

| Project | License posture | Useful lesson or integration |
| --- | --- | --- |
| [Backstage Software Catalog](https://backstage.io/docs/features/software-catalog/) | Apache-2.0 project | Repository-owned catalog metadata, ownership, docs-like-code, collators, search, and plugin composition |
| [Plane Community Edition](https://plane.so/open-source) | AGPL-3.0 | Issues, cycles, modules, pages, APIs, and webhooks; prefer an external connector over embedded code |
| [OpenProject Community Edition](https://www.openproject.org/community-edition/) | GPL project | Projects, work packages, roadmaps, and a REST/HATEOAS API; prefer an external connector |
| [Logseq](https://github.com/logseq/logseq) | copyleft; re-audit before reuse | Local-first outlining, backlinks, blocks, and graph navigation as UX references |
| [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | AGPL-3.0 | Local-first documents, databases, and Rust-backed application architecture as UX references |
| [AFFiNE](https://github.com/toeverything/AFFiNE) | mixed/project-specific; audit required | Combined documents, canvas, and tables as a product reference only |

## License exclusions and cautions

- [Arize Phoenix](https://github.com/Arize-ai/phoenix/blob/main/LICENSE) is a
  capable AI observability reference, but its repository currently uses the
  Elastic License 2.0. It is not a strict free/open-source core candidate.
- [Langfuse](https://github.com/langfuse/langfuse) has an MIT-licensed core and
  commercially licensed/open-core areas. Treat it as an optional external
  backend or connector only after a path-by-path feature and license audit.
- Copyleft projects may still be valid separately deployed integrations. Their
  source must not be copied or linked into a distributed Grafting product
  without a deliberate license and distribution review.

## Candidate Grafting contracts

These names describe capability seams, not a mandate to create one package per
item:

- `DocumentEditorPort`: authored Markdown operations; Milkdown stays private;
- `CanvasExchangePort`: JSON Canvas import/export translations;
- `SearchIndexPort`: indexing and search; Tantivy stays private in Rust;
- `AgentTraceIngestPort`: OpenTelemetry/OpenInference and provider-log
  normalization;
- `TestEvidenceIngestPort`: native test-report normalization;
- `SketchSurfacePort`: free-form sketch documents; Excalidraw stays private;
- the existing Grafting canvas API remains the X6 visualization boundary.

A normalized AI/workflow evidence model may later include `AgentRun`,
`TaskAttempt`, `ToolCall`, `ArtifactRead`, `ArtifactChange`, `ValidationRun`,
`DecisionReference`, `Handoff`, `Failure`, and `ContextPacket`. These are
candidate vocabulary items, not an accepted schema.

## Recommended evaluation order

1. Complete I-004 and build I-006 from real Graph IR as a read-only slice.
2. Display authored documentation, ADRs, tasks, handoffs, and structured test
   evidence with provenance and freshness.
3. Spike Tantivy for local full-text search using representative repository
   content and a measurable index/query budget.
4. Define a small Grafting-owned agent-run ingestion contract and test
   OpenTelemetry plus OpenInference against at least two provider formats.
5. Assemble a bounded `ContextPacket` per task from applicable decisions,
   evidence, subgraph, validation state, risks, and source links.
6. Add JSON Canvas import/export interoperability.
7. Evaluate Milkdown only when editing proposals can produce reviewable source
   diffs instead of modifying derived evidence.
8. Evaluate Qdrant, Yrs, Excalidraw, or Tree-sitter only after a concrete need
   satisfies their admission conditions.

## Adoption checklist

Before any candidate becomes a dependency or deployed integration:

1. assign a separate task and single owner;
2. state the measured product need and rejected simpler alternative;
3. re-check current license, transitive licenses, provenance, maintenance, and
   security posture;
4. identify the smallest owning boundary and Grafting-owned public contract;
5. prove that vendor types do not leak and graph calculations are not copied
   outside Rust;
6. define build, runtime, bundle, memory, and data-retention costs;
7. run a disposable spike with acceptance and rollback criteria;
8. update an ADR only when adoption changes an architectural decision.

