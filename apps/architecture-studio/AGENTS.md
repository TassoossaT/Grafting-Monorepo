# AGENTS.md — Architecture Studio

Scope-local addendum to the root `AGENTS.md`.

Derived Graph IR is read-only. This app MUST NOT edit generated facts or bypass
schema/policy/plan review for authored workflows. During the migration it
consumes `graph-x6`; the target composition maps Graph IR and application-owned
presentation enrichment to `@grafting/x6-canvas`. It does not import raw X6 or
VTT map semantics.

The app only composes and presents capabilities. Reusable repository,
documentation, test-evidence, and graph logic belongs in Grafting packages.
External visualization APIs must remain behind their designated smallest
owning boundary. This does not require a separate package for every library or
layer (DEC-049).

Reusable graph structures and calculations belong to `grafting-graph-core`.
The app may own labels, colors, icons, viewport state, and other presentation
metadata, but calculation-affecting data crosses an explicit Rust contract
(DEC-051).
