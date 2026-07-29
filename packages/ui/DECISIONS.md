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
└── EntitySummary inside a future X6 React shape
```

The future X6 integration remains a separate task. `@grafting/x6-canvas` stays
the only X6-owning boundary, while `@grafting/ui` owns React presentation. Stable
caller-owned IDs synchronize selection between canvas, table, and inspector.

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
- `@tanstack/react-table` `8.21.3`: MIT, evaluated but not installed;
- React/React DOM: explicit peer runtime for this React-specific package.

Upgrades still require the normal dependency, compatibility, security, and
public-API review. This record is not permission to add another UI framework
without a demonstrated component need.
