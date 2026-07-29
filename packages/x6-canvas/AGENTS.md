# AGENTS.md — `@grafting/x6-canvas`

Scope-local addendum to the root `AGENTS.md`.

This package is a generic X6 adapter. It MUST NOT contain Graph IR, VTT map,
workflow, or product-specific semantics. Read-only consumers MUST NOT receive
the underlying mutable X6 `Graph` instance.
