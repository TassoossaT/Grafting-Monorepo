# AGENTS.md - retired `@grafting/x6-canvas`

Scope-local addendum to the root `AGENTS.md`.

This package is retained as dormant reference code under DEC-056. It has no
active consumer and MUST NOT be added to an application, root validation
pipeline, generated API catalog, or new dependency graph without a new explicit
owner decision that reactivates it.

Maintenance while retired is limited to security or repository-compatibility
work needed to keep the retained source inspectable. Do not add features,
presentation policy, graph computation, or a second active canvas boundary
here. The active browser canvas implementation is private to `@grafting/ui`;
its public API uses Grafting-owned names and keeps renderer types private.

The retained source remains bound by DEC-049, DEC-051, and DEC-052: no vendor
types may cross its old public boundary, graph calculations remain in
`grafting-graph-core`, and product presentation remains application-owned.
