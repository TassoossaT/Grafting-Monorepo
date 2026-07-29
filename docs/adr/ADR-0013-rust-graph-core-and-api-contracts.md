# ADR-0013: Rust graph authority and per-package API contracts

- Status: **Accepted.** Recorded from the repository owner's explicit
  refinement on 2026-07-29.
- Decision date: 2026-07-29.
- Record: DEC-051.
- Amends: DEC-050 and ADR-0012's originally proposed TypeScript graph package.
- Related: DEC-001, DEC-002, DEC-013, DEC-046, DEC-049, I-002, and I-003.

## Context

ADR-0012 correctly separated repository knowledge, graph computation, visual
adaptation, and presentation, but initially assigned the generic graph model
and ports to `@grafting/graph` in TypeScript. The owner clarified two stronger
requirements:

1. reusable graph structures, algorithms, ordering, validation, layout math,
   queries, diffs, and other significant calculations are authoritative in
   Rust for reuse and performance;
2. every package consumed by another project needs a reviewable public API
   contract so accidental function renames or input/output changes cannot
   silently break consumers.

The caller may still own labels, colors, icons, UI components, selection,
viewport state, and product-specific metadata. Data that changes a calculation
crosses an explicit Rust-owned command or parameter contract.

## Decision

### Rust owns graph computation

One coherent Rust crate, initially `libs/graph/core` with Cargo package name
`grafting-graph-core`, owns the reusable graph model and calculations. Internal
modules may separate model, algorithms, validation, queries, layout, snapshots,
and adapters without creating a crate per concern.

The crate may use third-party graph or mathematics libraries privately. Their
types must not cross the Grafting public API. Callers use stable Grafting IDs,
commands, results, errors, and snapshots, so replacing `petgraph`, adding
`nalgebra`, or introducing a custom implementation remains localized.

Rust owns, when implemented:

- node/edge identity and structural invariants;
- traversal, reachability, paths, cycles, components, and topological order;
- reusable filters, subgraphs, ranks, diffs, and deterministic ordering;
- mathematical or layout calculations shared across consumers;
- data that affects those calculations and the errors they can return;
- immutable calculation/view snapshots crossing runtime boundaries.

The TypeScript/browser side owns presentation enrichment and host integration:

- labels, colors, icons, tooltips, and visual components;
- DOM container, viewport, zoom, panning, and current selection;
- product-specific information that does not affect shared calculations;
- batched boundary calls and conversion of Rust results into visual adapter
  inputs.

Fine-grained exports of elementary mathematical operations are prohibited.
Runtime boundaries use batched commands such as load, validate, query, order,
layout, and snapshot so boundary overhead does not replace calculation cost.

### Graph IR is a contract, not the graph engine

`docs/graph-ir/graph-ir-v1.schema.json` remains the canonical language-neutral
document contract for repository knowledge. JSON Schema validation checks its
shape. Graph-structural semantics and reusable calculations are delegated to
the Rust core; Graph IR-specific evidence paths, authority classes, source
revisions, and canonical document rules stay with the Graph IR adapter.

Graph IR does not own rendering, and the Rust graph crate does not become the
authority for ADRs, tasks, manifests, or other facts represented by Graph IR.

### X6 remains a private visual adapter

`@grafting/x6-canvas` remains the only TypeScript package allowed to import
`@antv/x6`. It receives immutable Grafting view data, enriches or renders it,
and exposes only Grafting-owned visual interfaces. It contains no graph
algorithms or repository semantics.

The spike-era `@grafting/graph-x6` is removed during an atomic migration. The
Architecture Studio owns its Graph IR presentation projection; heavy or shared
graph operations call the Rust core through the existing Isekai/Wasm boundary.
A thin TypeScript client is created only when a real consumer requires it and
contains no alternate graph implementation.

### Public API contract per consumed package

For this rule, "public" means imported by another project in the monorepo, even
when the Cargo or npm package is private and unpublished.

The source language remains authoritative:

- Rust public items and Rustdoc;
- TypeScript exports and TSDoc;
- C# public symbols and XML documentation;
- Python exported interfaces and docstrings;
- versioned IDLs/schemas at ABI, protocol, or process boundaries.

Each consumed package provides three complementary protections:

1. a generated, Git-tracked public API baseline containing names, signatures,
   required inputs, outputs, errors/types, and documentation evidence;
2. an `api-check` target that regenerates a temporary baseline and fails on an
   unapproved diff;
3. behavioral contract tests for guarantees a signature cannot express.

The baseline is derived evidence, never a second manually maintained API. An
intentional incompatible change updates the authoritative code, baseline,
documentation, affected consumers, and version/decision record together.

I-003 owns the reusable per-project convention and tool evaluation. Suitable
native extractors include Rust public-API/SemVer tooling, TypeScript API reports,
and C# public-API analyzers; no universal custom IDL is introduced for
in-process APIs.

## Consequences

- `packages/graph` is removed from the target tree; the graph capability is a
  Rust crate under `libs/graph/core`.
- Graph computation is implemented once and can be reused natively or through
  Wasm without a TypeScript copy.
- Presentation metadata remains flexible and application-owned.
- API diffs become explicit review artifacts, while contract tests protect
  behavior that signatures cannot express.
- Graph IR and generated API catalogs can index public contracts without
  becoming their authority.

## Risks

- A Rust/Wasm boundary can erase performance gains if every elementary
  operation becomes a separate call; batching is mandatory.
- Public API snapshots can create noise if internal symbols are exported
  carelessly; package entry points must stay deliberate.
- A signature-compatible behavioral regression is invisible to API diffing;
  contract tests remain mandatory.
- Adding graph/mathematics dependencies before a real operation requires them
  would recreate speculative infrastructure.

## Rollback

Rollback requires an explicit owner decision because DEC-051 is `LOCKED` and
amends DEC-050. Reverting this ADR alone does not authorize graph logic in
TypeScript or removal of API compatibility checks.
