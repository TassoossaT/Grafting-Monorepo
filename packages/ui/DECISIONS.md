# UI package decisions

This file preserves the conclusions that led to the initial `@grafting/ui`
boundary. Architectural authority remains in the master source and accepted
ADRs; this is package-local implementation guidance.

## Current choice

- Start with Ant Design because it already provides the controls needed by the
  first products and the owner is productive with it.
- Keep `antd` private to this package. Consumers use Grafting props and
  callbacks so a later implementation change remains localized.
- Build bespoke components only when a concrete screen, canvas, table, or
  interaction needs them. The package is not a catalog-generation exercise.
- Organize implemented components using Atomic Design. A level is a
  maintainership category, not a package and not a reason to create an empty
  directory.
- Export one deliberate root API; atomic folders stay private.

## Table decision

Ant Design Table is the initial private table engine. It already supports React
content inside cells, controlled selection, pagination, loading states, and the
other behavior required by the first `DataTable` contract.

TanStack Table was evaluated at version `8.21.3` on 2026-07-29. It is free,
open source, and MIT licensed. It is headless and therefore combines naturally
with owned HTML/CSS primitives or source-owned components such as selected
shadcn/ui pieces. It is not installed now because running it beside Ant Design
Table would duplicate table state and behavior without a demonstrated need.

If the product later needs fully custom markup, deeper headless state control,
or a visual treatment that Ant Design Table resists, `DataTable` may switch its
private engine to TanStack. Consumers must not receive TanStack `ColumnDef`, row
models, or table instances; the existing Grafting column and selection
contracts are the replacement boundary.

## Card atom decision

`Card` was extracted from `EntitySummary` on 2026-07-29 after the owner stated
the package's Atomic Design rule precisely: a component that composes no other
Grafting component is an atom, one that composes an atom is a molecule, and so
on. `GridLayout` moved from `organisms/` to `atoms/` under the same rule, since
it only wraps `react-grid-layout` directly and composes no other Grafting
component.

Inspecting `EntitySummary`'s actual use of Ant Design's `Card` found it
exercised no vendor-specific capability: no cover image, no `actions` footer,
no loading skeleton, no built-in header `extra` slot. Every visual property
(`background`, boundary color and width, radius, fill, cursor, `data-selected`)
was already supplied through inline styles the component authored itself.
Ant Design's `Card` was contributing nothing beyond a `<div>` here, so "the
best card" for this need was a dependency-free one: no antd, no Tailwind, no
other vendor. Introducing a vendor card component (Ant Design's own, or a
Tailwind-based one from shadcn/coss ui) for a need that is fully satisfied by a
styled element would be an unjustified dependency, contrary to this package's
own rule to add a component only for a demonstrated need.

`EntitySummary` now composes `Card`, `Text`, and `StatusBadge` instead of
wrapping Ant Design's `Card`, `Typography.Text`, and `Tag` in one place.
`EntitySummaryProps` did not change; only its private implementation moved, so
existing consumers (the X6 canvas React-node bridge that mounts
`EntitySummary` as a node view) are unaffected.

`Card` is a plain bounded surface only. It intentionally does not grow a
`title`/`description`/`status` shape of its own — that composition belongs to
`EntitySummary` (or a future molecule), keeping `Card` reusable for whatever
unrelated content a caller places inside it.

## Grid layout decision

`react-grid-layout` `2.2.3` is the initial private engine behind `GridLayout`,
chosen over Gridstack.js in an owner conversation on 2026-07-29. Both are MIT
and free. The deciding factor was the confirmed destination runtime: the
consuming application (a Next.js documentation-and-tooling app) is React from
its first commit, so Gridstack's main advantage — working natively in a
vanilla-DOM phase before a React migration — never applies here, while its
cost — mounting React content into a container it creates and owns itself,
via a second detached root or a portal — would have applied on every panel.
`react-grid-layout` is also the more established option by community size
(over twice the GitHub stars and roughly five times the weekly downloads of
Gridstack.js at evaluation time) and had just completed a v2 TypeScript
rewrite with tree-shakable exports.

The package uses `react-grid-layout`'s `/legacy` entry point
(`ReactGridLayoutLegacy` + `WidthProvider`), not the new v2 native
`useContainerWidth`/`useGridLayout` hooks composed by hand. The `/legacy`
surface is an officially maintained, fully documented compatibility layer
(the v2 authors converted it internally to the same composable primitives),
and its flat, well-established prop shape maps directly onto the
`GridPanelPlacement` contract with far less risk than hand-wiring the newer
low-level hooks for a first implementation.

Gridstack's own advantages — grids nested inside each other, and dragging a
panel from one grid instance into a different one — are not implemented.
Neither was a demonstrated requirement at evaluation time; if one becomes
concrete, it is a private-engine change behind the same `GridLayout` contract,
not a public API change, mirroring how `DataTable` may later swap Ant Design
Table for TanStack Table.

`react-grid-layout` requires its own stylesheet
(`react-grid-layout/css/styles.css`) for resize-handle and placeholder
presentation. This package does not import it as a side effect, because the
package declares `sideEffects: false` for tree-shaking; a hidden CSS import
would contradict that declaration and risks silent removal by an aggressive
bundler. The consuming application imports the stylesheet once, the same way
it would for any other CSS-dependent dependency it takes on directly.

**Addendum (2026-08-01, `docs/adr/ADR-0016-architecture-studio-scope-expansion.md`,
Proposed, pending owner acceptance):** `apps/architecture-studio` is proposed
as an additional `GridLayout` consumer, alongside the originally anticipated
Next.js documentation-and-tooling app referenced above. `GridLayout`'s public
contract does not change — it was already consumer-agnostic — but this is
worth recording because `apps/architecture-studio` has no existing
app-level React root today (`src/main.ts` is plain DOM; React currently
only exists privately inside `@grafting/x6-canvas`'s per-node mounts), so
wiring `GridLayout` in is a first-time integration decision for that app,
not routine reuse of an established pattern.

## shadcn/ui conclusion

shadcn/ui is a source distribution approach rather than a mandatory runtime
component dependency. Selected components may be copied and adapted later when
their exact source-level control solves a real need. Original MIT copyright and
license notices must be preserved as applicable; local modifications and
Grafting-specific composition are maintained by this repository.

Adding shadcn/ui wholesale would create unused code and a second visual system.
The package instead adopts individual ideas or components only when they fit an
identified requirement.

## Entity components, tables, and graph nodes

The same entity should be projected through reusable React presentation rather
than copied or represented by a complete X6 runtime node inside a table cell:

```text
caller-owned entity view data
├── EntitySummary inside DataTable
├── EntitySummary inside an inspector
└── EntitySummary inside an X6 React shape
```

The X6 integration is implemented by `@grafting/x6-canvas`, which stays the
only X6-owning boundary and privately owns `@antv/x6-react-shape`.
`@grafting/ui` owns reusable React presentation and privately owns Ant Design.
Neither reusable package chooses the other: an application composes a UI DOM
mount into a consumer-supplied canvas node view. Stable caller-owned IDs
synchronize canvas, table, and inspector without leaking either vendor API.

When a product chooses a Card node, `EntitySummary` owns the full visible node
boundary, background, dimensions, accent, and selected treatment. The generic
canvas supplies only a technical mount point and lifecycle. Ports and all
concrete presentation are product composition. A decorative wrapper around
the Card would create two competing node geometries and is prohibited.

Full data tables should not be embedded in compact graph nodes. A node receives
a bounded summary; detailed tables belong in an inspector or adjacent panel.

## Logic boundary

UI-local display state such as a selected row, visible column, or current page
may remain in the React layer. Authoritative graph validation, semantic filters,
ordering, neighborhood queries, subgraphs, and layout calculations remain in
`grafting-graph-core` and cross a batched contract. A table or graph component
only presents those results.

## Dependency and license record

The initial dependency evaluation used registry metadata on 2026-07-29:

- `antd` `6.5.2`: MIT; React and React DOM `>=18.0.0` peers;
- `@antv/x6-react-shape` `3.0.1`: MIT; owned by `@grafting/x6-canvas`,
  compatible with X6 3.x and React/React DOM `>=18.0.0`;
- `@tanstack/react-table` `8.21.3`: MIT, evaluated but not installed;
- `react-grid-layout` `2.2.3`: MIT; React and React DOM `>=16.3.0` peers;
  Gridstack.js `MIT` was evaluated and not installed (see the Grid layout
  decision above);
- React/React DOM: explicit peer runtime for this React-specific package.

Upgrades still require the normal dependency, compatibility, security, and
public-API review. This record is not permission to add another UI framework
without a demonstrated component need.
