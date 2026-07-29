# AGENTS.md — `@grafting/ui`

Scope-local addendum to the root `AGENTS.md`.

This package is the shared React presentation boundary for Grafting products.
It owns the current Ant Design integration. Runtime code outside this package
MUST consume `@grafting/ui` instead of importing `antd` directly when the
capability is intended to be reusable.

Public props, statuses, column descriptions, selection state, and callbacks use
Grafting-owned vocabulary. Ant Design components, column types, tokens, themes,
and configuration objects MUST remain private. React is the explicit UI runtime
of this package; no claim is made that these components are framework-neutral.

Use Atomic Design as an internal organization rule:

- atoms are indivisible presentation primitives;
- molecules combine atoms into one reusable identity or interaction;
- organisms coordinate reusable groups such as a data table;
- templates and higher levels are created only when a real component exists.

Do not create empty category folders. Do not import internal category paths from
consumers; the root entry point is the only public surface. Add a component only
for a demonstrated consumer need and compose existing parts before introducing
another implementation of the same meaning.

`DataTable` currently owns Ant Design Table internally. TanStack Table is an
approved MIT headless alternative, not a simultaneous second table engine. It
may replace the internal engine when a concrete requirement needs more visual
control or headless state composition; the Grafting public contract should stay
stable across that replacement.

Every exported declaration and public member requires TSDoc. Public API changes
require `ui:api-check`, a reviewed update to
`tests/snapshots/public-api.md`, and behavioral contract tests. A normal API
check MUST NOT update the baseline and MUST fail if `antd` leaks through the
public declaration entry point.

This package owns presentation only. Graph validation, ordering, queries,
layout, and other graph computation remain in `grafting-graph-core`.
