# `@grafting/ui`

Shared React UI components for Grafting products. The package starts with Ant
Design as a private implementation and exposes only Grafting-owned component
contracts. Its internal organization follows Atomic Design without creating
empty speculative layers.

Current components:

- atom `Text`: bounded text with semantic tones and optional truncation;
- atom `StatusBadge`: semantic status independent of Ant Design status names;
- molecule `EntitySummary`: one reusable entity identity for tables, future
  React canvas nodes, and inspectors;
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
licensing, Atomic Design, and future X6/React-node conclusions.
