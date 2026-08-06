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

Use Atomic Design as an internal organization rule, decided by composition, not
by visual complexity: a component that composes no other Grafting component is
an atom, even if it privately wraps a vendor library. A component that
composes one or more Grafting atoms is a molecule. A component that composes
molecules (or coordinates a reusable group of atoms and molecules) is an
organism. Reclassify a component's folder the moment its composition changes;
folder placement must track actual composition, not history.

- atoms are indivisible presentation primitives that compose no other Grafting
  component (`Text`, `StatusBadge`, `Card`, `GridLayout`);
- molecules combine atoms into one reusable identity or interaction
  (`EntitySummary` composes `Card`, `Text`, and `StatusBadge`);
- organisms coordinate reusable groups such as a data table;
- templates and higher levels are created only when a real component exists.

Do not create empty category folders. Do not import internal category paths from
consumers; the root entry point is the only public surface. Add a component only
for a demonstrated consumer need and compose existing parts before introducing
another implementation of the same meaning.

When a UI component is used as a canvas node, the component itself owns the
complete visible boundary. Canvas adapters MUST NOT add a second decorative
wrapper that changes the component's size, border, or selection geometry.
Any default visual treatment exposed by this package must remain replaceable;
an application, not the generic canvas adapter, chooses which concrete UI
component and appearance to compose (DEC-052).

This package also owns the active browser canvas implementation. Rete.js and
Three.js are private integrations inside `src/canvas`; consumers import only
vendor-neutral elements and contracts from the `@grafting/ui` root. Vendor
package names and vendor-owned types MUST NOT appear in public symbols, inputs,
outputs, handles, or consumer imports. Rete.js is the sole active node-graph
engine; Three.js is limited to 3D/heightfield rendering. Significant graph
structure, validation, algorithms, queries, diffs, ordering, and layout remain
Rust-owned, while applications own concrete presentation and interaction policy
(DEC-051, DEC-052, DEC-056).

The canvas separates what the *consumer* may do from what the *user* may do
(DEC-057, `docs/adr/ADR-0019-editable-canvas-and-node-bench.md`). `CanvasHandle`
always exposes programmatic mutation — the caller acting on its own nodes and
edges. Anything a user does with the pointer stays neutral until a consumer
supplies `CanvasOptions.editing`, exactly as `CanvasInteractionOptions` already
works. Ports carry a `direction`, an opaque caller-owned `dataType`, and a
`capacity`. The canvas MUST enforce only rules it can verify without domain
knowledge — direction, capacity, self-connection, duplicate endpoints. Whether
two `dataType` values are compatible is a product question answered by
`onConnectRequest`; this package MUST NOT interpret a `dataType` or assign it a
color, since that is the consuming application's visual identity (DEC-052).
DOM-mountable components expose only Grafting-owned update/dispose handles.
ReactDOM roots and renderer types remain private to this package.

`DataTable` currently owns Ant Design Table internally. TanStack Table is an
approved MIT headless alternative, not a simultaneous second table engine. It
may replace the internal engine when a concrete requirement needs more visual
control or headless state composition; the Grafting public contract should stay
stable across that replacement.

`Card` is a dependency-free atom: a bounded surface (background, accent or
selected boundary, radius, padding, fill, and interaction cursor) built from a
plain element, not a vendor component. It was extracted from `EntitySummary`,
which no longer imports Ant Design's `Card` directly and instead composes this
atom; `EntitySummary`'s own public props did not change. Prefer composing
`Card` over adding a vendor card component when a future need only requires a
bounded, styleable surface rather than vendor-specific behavior such as a
cover image or a built-in loading skeleton.

`GridLayout` privately owns `react-grid-layout`. Its Grafting-owned
`GridPanel`/`GridPanelPlacement` vocabulary is the only public surface;
`react-grid-layout`'s `Layout`/`LayoutItem` types and its `/legacy` import path
are an internal implementation detail that must remain swappable (for example
for Gridstack.js) without a public contract change. This package does not
import `react-grid-layout/css/styles.css` as a side effect — it declares
`sideEffects: false`, and a hidden CSS side effect would contradict that and
could be silently dropped by an aggressive bundler. Consumers that need the
stylesheet import it once at the application level.

Every exported declaration and public member requires TSDoc. Public API changes
require `ui:api-check`, a reviewed update to
`tests/snapshots/public-api.md`, and behavioral contract tests. A normal API
check MUST NOT update the baseline and MUST fail if `antd` leaks through the
public declaration entry point.

This package owns presentation only. Graph validation, ordering, queries,
layout, and other graph computation remain in `grafting-graph-core`.
