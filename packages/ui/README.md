# `@grafting/ui`

Shared React UI components for Grafting products. The package starts with Ant
Design as a private implementation and exposes only Grafting-owned component
contracts. Its internal organization follows Atomic Design without creating
empty speculative layers.

Current components:

- atom `Text`: bounded text with semantic tones and optional truncation;
- atom `StatusBadge`: semantic status independent of Ant Design status names;
- atom `Card`: a dependency-free bounded surface (background, accent or
  selected boundary, radius, padding, fill, interaction cursor); composes no
  other component and no vendor library;
- atom `GridLayout`: draggable, resizable dashboard panels described by
  Grafting-owned `GridPanel`/`GridPanelPlacement` inputs, privately backed by
  `react-grid-layout`;
- molecule `EntitySummary`: composes `Card`, `Text`, and `StatusBadge` into one
  reusable identity card for tables, X6 React canvas nodes, and inspectors;
  optional fill, accent, interaction, and selection props let it become a
  complete canvas node; its border, selected color, radius, padding, and
  content gap are replaceable;
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

`Card` is a plain bounded surface for content this package does not yet have a
named molecule for. Compose it directly when a future need is only a
styleable container:

```tsx
import { Card } from "@grafting/ui";

<Card ariaLabel="Task status" accentColor="#0f9f6e">
  <TaskChecklist />
</Card>;
```

`GridLayout` needs `react-grid-layout`'s stylesheet for resize-handle and
placeholder presentation. This package does not import it as a side effect
(it declares `sideEffects: false`), so consuming applications import it once,
themselves:

```ts
import "react-grid-layout/css/styles.css";
```

```tsx
import { GridLayout } from "@grafting/ui";

<GridLayout
  ariaLabel="Studio dashboard"
  panels={[
    {
      content: <GraphCanvas />,
      placement: { id: "canvas", x: 0, y: 0, width: 8, height: 6 },
    },
    {
      content: <EntityExplorer />,
      placement: { id: "explorer", x: 8, y: 0, width: 4, height: 6 },
    },
  ]}
  onPlacementsChange={(placements) => savePanelLayout(placements)}
/>;
```

`mountEntitySummary(host, props)` offers a Grafting-owned update/dispose
lifecycle for adapters that own an existing DOM host. ReactDOM remains private
to this package. The generic canvas never assumes that this is the component a
product will mount.

Behavioral tests and generated API snapshots share the single `tests/` root.
Snapshots remain under `tests/snapshots/`; they are not a second test suite.

Targets:

- `ui:check` — strict TypeScript checking;
- `ui:build` — JavaScript and declaration output, plus automatic export of the
  documentation mesh to `docs/generated/meshes/ui-doc-mesh.v1.json`;
- `ui:test` — server-rendered behavioral component contracts;
- `ui:docs-mesh-export` — exports a Storybook-independent JSON mesh for
  documentation/preview consumers (`docs/generated/meshes/ui-doc-mesh.v1.json`)
  by extracting each exported component's `*Props` interface and reflecting
  every field's type, then reading `@layer`/`@status` from the component's
  own TSDoc and an `@example` value from each individual prop's own doc
  comment;
- `ui:api-check` — declaration generation, TSDoc enforcement, AntD leak scan,
  and comparison with the tracked public API baseline.

The documentation mesh requires no separate file to maintain, and there is no
whole hand-written JSX snippet to keep working either. Document a component
with the usual TSDoc description plus `@layer`/`@status`:

```ts
/**
 * One-line description shown as this component's summary everywhere.
 *
 * @layer atom
 * @status stable
 */
export function Button(props: ButtonProps): ReactElement { ... }
```

and give each **prop** its own example value directly on that field, inline
for a short literal or a fenced ` ```tsx ` block for anything longer (an
array, an arrow function, even JSX):

```ts
export interface ButtonProps {
  /**
   * Human-readable button label.
   * @example "Run"
   */
  readonly label: string;
  /** Invoked when the button is activated. */
  readonly onClick?: () => void;
  /** Optional semantic emphasis. */
  readonly tone?: "default" | "accent";
}
```

Every **required** prop must carry an `@example` (the export fails loudly
otherwise); optional props may skip it. `@layer` defaults to `atom` and
`@status` to `stable` when omitted.

Each prop's reflected type also drives a real Storybook control, generated
straight from the mesh with no docgen step: a string-literal union (inline,
or through a named alias like `TextTone`/`UiStatus`/`CardShape`) becomes a
`select` with those options; `boolean`/`number`/`string` become the matching
control; a callback typed `=> void` (e.g. `onClick`) becomes a logged
Storybook action; an array or plain object (`DataTableProps.rows`/`columns`,
`GridLayoutProps.panels`) becomes an editable `object` control. Only
`ReactNode` (a real JSX value a JSON editor cannot usefully represent) and a
callback whose return value the component actually depends on (e.g.
`DataTableProps.rowKey`) stay uncontrolled — both still need their own
`@example` if the prop is required. Each component gets exactly one
generated "Default" story seeded from these examples; every other value is
then explorable live through Storybook's own Controls panel.

To intentionally update the API baseline:

```powershell
$env:UPDATE_SNAPSHOTS = "yes"
pnpm --filter @grafting/ui api-check
Remove-Item Env:UPDATE_SNAPSHOTS
```

Review the baseline together with affected consumers and behavioral tests. A
normal `api-check` never changes it.

See [DECISIONS.md](DECISIONS.md) for the evaluated AntD, TanStack, shadcn/ui,
grid-layout, Card atom, licensing, Atomic Design, and X6/React-node
conclusions.
