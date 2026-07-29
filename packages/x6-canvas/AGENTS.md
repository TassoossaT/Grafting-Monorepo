# AGENTS.md — `@grafting/x6-canvas`

Scope-local addendum to the root `AGENTS.md`.

This package is a generic X6 adapter. It MUST NOT contain Graph IR, VTT map,
workflow, or product-specific semantics. Read-only consumers MUST NOT receive
the underlying mutable X6 `Graph` instance.

This is the designated TypeScript owner of `@antv/x6` for Grafting canvas
consumers. No X6-owned public type may cross its API; downstream projects use
only Grafting-owned canvas contracts. This current package boundary is based on
real reuse and is not a precedent for creating one package per dependency. A
future modified X6 fork requires separate provenance/license maintenance
(DEC-049).
