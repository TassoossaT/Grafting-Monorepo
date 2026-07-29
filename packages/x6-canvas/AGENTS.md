# AGENTS.md - `@grafting/x6-canvas`

Scope-local addendum to the root `AGENTS.md`.

This package is a generic, presentation-neutral X6 adapter. It MUST NOT contain
Graph IR, VTT, workflow, or product semantics. It MUST NOT own graph
structures, algorithms, ordering, queries, diffs, or layout mathematics; those
belong to `grafting-graph-core` (DEC-051).

This is the designated owner of `@antv/x6` and `@antv/x6-react-shape` for
Grafting canvas consumers. X6 and React-shape types remain private. The package
MUST NOT depend on `@grafting/ui`, Ant Design, or a product component. An
application composes this adapter with its chosen UI capability through the
Grafting-owned DOM mount lifecycle (DEC-052).

Node views, ports, edge curves, markers, labels, effects, surface styling, and
interaction choices are supplied per canvas instance. Package defaults are
neutral and replaceable. Canvas lifecycle code MUST NOT branch on concrete
views or product roles. `nodes/registry.ts` registers only the technical host;
that host may size its mount point but MUST NOT add a visible boundary, color,
shape, text, selection style, or behavior policy.

Every exported declaration and public member requires TSDoc. Public API
changes require `x6-canvas:api-check`, a reviewed update to
`tests/snapshots/public-api.md`, and behavioral contract tests. The check MUST
fail if `@antv/x6`, `@antv/x6-react-shape`, `react`, `react-dom`, `antd`, or a
subpath leaks through the public declaration entry point.

Use one `tests/` root. Do not recreate a parallel `test/` directory.
