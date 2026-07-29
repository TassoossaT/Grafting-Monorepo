# AGENTS.md — `@grafting/x6-canvas`

Scope-local addendum to the root `AGENTS.md`.

This package is a generic X6 adapter. It MUST NOT contain Graph IR, VTT map,
workflow, or product-specific semantics. It also MUST NOT own reusable graph
structures, algorithms, ordering, queries, diffs, or layout mathematics; those
belong to `grafting-graph-core`. It consumes immutable Grafting-owned
presentation data. Read-only consumers MUST NOT receive the underlying mutable
X6 `Graph` instance.

This is the designated TypeScript owner of `@antv/x6` for Grafting canvas
consumers. No X6-owned public type may cross its API; downstream projects use
only Grafting-owned canvas contracts. This current package boundary is based on
real reuse and is not a precedent for creating one package per dependency. A
future modified X6 fork requires separate provenance/license maintenance
(DEC-049).

Every exported declaration and public member requires TSDoc. Public API
changes require `x6-canvas:api-check`, a reviewed update to
`tests/snapshots/public-api.md`, and applicable behavioral contract tests. A
normal API check MUST generate declarations in memory, MUST NOT update the
baseline, and MUST fail if `@antv/x6` or one of its subpaths appears in the
public declaration entry point.
