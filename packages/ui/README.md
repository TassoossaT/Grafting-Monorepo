# `@grafting/ui`

Shared React UI components for Grafting products. The package starts with Ant
Design as a private implementation and exposes only Grafting-owned component
contracts. Its internal organization follows Atomic Design without creating
empty speculative layers.

Current components:

- atom `Text`: bounded text with semantic tones and optional truncation;
- atom `StatusBadge`: semantic status independent of Ant Design status names;
- molecule `EntitySummary`: one reusable Ant Design card for tables, X6 React
  canvas nodes, and inspectors; optional fill, accent, interaction, and
  selection props let the Card itself become a complete canvas node; its
  border, selected color, radius, padding, and content gap are replaceable;
- organism `DataTable`: immutable rows, stable keys, controlled selection,
  pagination, and bespoke React cell renderers through Grafting column types.

Consumers import only from the package root:

```tsx
import { DataTable, EntitySummary } from "@grafting/ui";

<DataTable
  ariaLabel="Repository nodes"
  rows={nodes}
  rowKey={(node) => node.id}
  columns={[
    {
      id: "node",
      header: "Node",
      value: (node) => node.label,
      renderCell: ({ row }) => (
        <EntitySummary title={row.label} description={row.kind} />
      ),
    },
  ]}
/>;
```

Do not import `src/atoms`, `src/molecules`, or `src/organisms` directly. Those
paths describe maintainership, not separate public APIs.

`mountEntitySummary(host, props)` offers a Grafting-owned update/dispose
lifecycle for adapters that own an existing DOM host. ReactDOM remains private
to this package. The generic canvas never assumes that this is the component a
product will mount.

Behavioral tests and generated API snapshots share the single `tests/` root.
Snapshots remain under `tests/snapshots/`; they are not a second test suite.

Targets:

- `ui:check` — strict TypeScript checking;
- `ui:build` — JavaScript and declaration output;
- `ui:test` — server-rendered behavioral component contracts;
- `ui:api-check` — declaration generation, TSDoc enforcement, AntD leak scan,
  and comparison with the tracked public API baseline.

To intentionally update the API baseline:

```powershell
$env:UPDATE_SNAPSHOTS = "yes"
pnpm --filter @grafting/ui api-check
Remove-Item Env:UPDATE_SNAPSHOTS
```

Review the baseline together with affected consumers and behavioral tests. A
normal `api-check` never changes it.

See [DECISIONS.md](DECISIONS.md) for the evaluated AntD, TanStack, shadcn/ui,
licensing, Atomic Design, and X6/React-node conclusions.
