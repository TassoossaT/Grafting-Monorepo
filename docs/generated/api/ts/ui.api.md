# ui

### `interface ui.ButtonProps`

Public inputs for a compact, clickable action.

### `property ui.ButtonProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.ButtonProps.label: string`

Human-readable button label.

### `property ui.ButtonProps.onClick?: () => void`

Invoked when the button is activated.

### `property ui.ButtonProps.tone?: "default" | "accent"`

Optional semantic emphasis.

### `interface ui.CardProps`

Public inputs for the smallest reusable bounded surface: a generic card.

### `property ui.CardProps.accentColor?: string`

Optional accent used for the card boundary.

### `property ui.CardProps.ariaLabel?: string`

Optional accessible name for the card.

### `property ui.CardProps.backgroundColor?: string`

Optional background color for the card surface.

### `property ui.CardProps.borderRadius?: number`

Optional rounded-corner radius in CSS pixels.

### `property ui.CardProps.borderWidth?: number`

Optional boundary width in CSS pixels.

### `property ui.CardProps.children: ReactNode`

Caller-owned content rendered inside the card.

### `property ui.CardProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.CardProps.fillContainer?: boolean`

Whether the card occupies the complete width and height of its container.

### `property ui.CardProps.glowColor?: string`

Optional glow color rendered as an outer shadow, e.g. to signal live status.

### `property ui.CardProps.interactive?: boolean`

Whether the card should communicate pointer interaction.

### `property ui.CardProps.padding?: number`

Optional padding in CSS pixels.

### `property ui.CardProps.selected?: boolean`

Whether the card displays its selected treatment.

### `property ui.CardProps.selectedColor?: string`

Optional boundary color used when the card is selected.

### `property ui.CardProps.shape?: CardShape`

Geometric outline of the card; defaults to a rounded rectangle.

### `interface ui.DataTableCellContext`

Immutable context supplied to a custom table-cell renderer.

### `property ui.DataTableCellContext.row: Row`

Complete caller-owned row.

### `property ui.DataTableCellContext.rowIndex: number`

Current presentation index of the row.

### `property ui.DataTableCellContext.value: unknown`

Value projected by the column.

### `interface ui.DataTableColumn`

Vendor-neutral description of one data-table column.

### `property ui.DataTableColumn.align?: "center" | "end" | "start"`

Optional horizontal alignment.

### `property ui.DataTableColumn.header: string`

Human-readable column heading.

### `property ui.DataTableColumn.id: string`

Stable column identifier.

### `property ui.DataTableColumn.renderCell?: (context: DataTableCellContext<Row>) => ReactNode`

Optional custom React presentation for the projected cell value.

### `property ui.DataTableColumn.value: (row: Row) => unknown`

Projects the value represented by this column.

### `property ui.DataTableColumn.width?: number`

Optional width in CSS pixels.

### `interface ui.DataTablePagination`

Minimal pagination contract independent of the current table engine.

### `property ui.DataTablePagination.hideWhenSinglePage?: boolean`

Whether controls disappear when every row fits on one page.

### `property ui.DataTablePagination.pageSize: number`

Number of rows rendered on each page.

### `interface ui.DataTableProps`

Public inputs for the reusable Grafting data table.

### `property ui.DataTableProps.ariaLabel: string`

Accessible table name.

### `property ui.DataTableProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.DataTableProps.columns: readonly DataTableColumn<Row>[]`

Immutable vendor-neutral column definitions.

### `property ui.DataTableProps.density?: "compact" | "regular"`

Optional table density.

### `property ui.DataTableProps.emptyMessage?: string`

Optional text shown when there are no rows.

### `property ui.DataTableProps.loading?: boolean`

Whether a loading treatment is displayed.

### `property ui.DataTableProps.pagination?: false | DataTablePagination`

Optional pagination, or false to render all rows.

### `property ui.DataTableProps.rowKey: (row: Row) => DataTableRowKey`

Returns the stable key for a row.

### `property ui.DataTableProps.rows: readonly Row[]`

Immutable caller-owned rows.

### `property ui.DataTableProps.selection?: DataTableSelection`

Optional controlled selection.

### `interface ui.DataTableSelection`

Controlled row-selection contract for a data table.

### `property ui.DataTableSelection.onChange: (keys: readonly DataTableRowKey[]) => void`

Receives the complete next selection.

### `property ui.DataTableSelection.selectedKeys: readonly DataTableRowKey[]`

Currently selected stable row keys.

### `interface ui.EntitySummaryProps`

Public inputs for a reusable entity summary shown in canvases, tables, or inspectors.

### `property ui.EntitySummaryProps.accentColor?: string`

Optional accent used for the complete card boundary.

### `property ui.EntitySummaryProps.actionLabel?: string`

Optional label for a compact action button rendered in the card.

### `property ui.EntitySummaryProps.actions?: ReactNode`

Optional actions placed after the textual identity.

### `property ui.EntitySummaryProps.ariaLabel?: string`

Optional accessible name for the summary container.

### `property ui.EntitySummaryProps.backgroundColor?: string`

Optional background color for the complete card surface.

### `property ui.EntitySummaryProps.bodyPadding?: number`

Optional body padding in CSS pixels.

### `property ui.EntitySummaryProps.borderRadius?: number`

Optional rounded-corner radius in CSS pixels.

### `property ui.EntitySummaryProps.borderWidth?: number`

Optional boundary width in CSS pixels.

### `property ui.EntitySummaryProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.EntitySummaryProps.contentGap?: number`

Optional gap between the component's content regions.

### `property ui.EntitySummaryProps.description?: string`

Optional secondary description.

### `property ui.EntitySummaryProps.fillContainer?: boolean`

Whether the card occupies the complete width and height of its container.

### `property ui.EntitySummaryProps.glowColor?: string`

Optional glow color rendered as an outer shadow, e.g. to signal live status.

### `property ui.EntitySummaryProps.interactive?: boolean`

Whether the card should communicate pointer interaction.

### `property ui.EntitySummaryProps.leading?: ReactNode`

Optional visual placed before the textual identity.

### `property ui.EntitySummaryProps.onAction?: () => void`

Invoked when the action button is activated.

### `property ui.EntitySummaryProps.selected?: boolean`

Whether the card displays its selected treatment.

### `property ui.EntitySummaryProps.selectedColor?: string`

Optional boundary color used when the component is selected.

### `property ui.EntitySummaryProps.shape?: CardShape`

Geometric outline of the card; defaults to a rounded rectangle.

### `property ui.EntitySummaryProps.status?: UiStatus`

Optional semantic status.

### `property ui.EntitySummaryProps.statusLabel?: string`

Human-readable label paired with status.

### `property ui.EntitySummaryProps.tags?: readonly string[]`

Optional short caller-owned labels rendered as compact badges below the identity.

### `property ui.EntitySummaryProps.title: string`

Primary human-readable entity name.

### `interface ui.GridLayoutProps`

Public inputs for the reusable Grafting dashboard grid layout.

### `property ui.GridLayoutProps.ariaLabel: string`

Accessible name for the grid region.

### `property ui.GridLayoutProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.GridLayoutProps.columns?: number`

Number of columns the grid is divided into.

### `property ui.GridLayoutProps.draggable?: boolean`

Whether panels can be dragged to a new position.

### `property ui.GridLayoutProps.gap?: number`

Gap between panels in CSS pixels, applied both horizontally and vertically.

### `property ui.GridLayoutProps.onPlacementsChange?: (placements: readonly GridPanelPlacement[]) => void`

Receives the complete next placement for every panel after a drag, resize, or compaction.

### `property ui.GridLayoutProps.panels: readonly GridPanel[]`

Immutable caller-owned panels and their current placements.

### `property ui.GridLayoutProps.resizable?: boolean`

Whether panels can be resized.

### `property ui.GridLayoutProps.rowHeight?: number`

Height of one grid row in CSS pixels.

### `interface ui.GridPanel`

One panel rendered by the Grafting grid layout.

### `property ui.GridPanel.content: ReactNode`

Caller-owned content rendered inside the panel.

### `property ui.GridPanel.placement: GridPanelPlacement`

Current placement of this panel.

### `interface ui.GridPanelPlacement`

Vendor-neutral position and size of one panel, in grid units, not pixels.

### `property ui.GridPanelPlacement.height: number`

Height in grid rows.

### `property ui.GridPanelPlacement.id: string`

Stable identity matching the panel this placement belongs to.

### `property ui.GridPanelPlacement.locked?: boolean`

Whether the panel is fixed in place and excluded from drag or resize.

### `property ui.GridPanelPlacement.maxHeight?: number`

Optional maximum height in grid rows.

### `property ui.GridPanelPlacement.maxWidth?: number`

Optional maximum width in grid columns.

### `property ui.GridPanelPlacement.minHeight?: number`

Optional minimum height in grid rows.

### `property ui.GridPanelPlacement.minWidth?: number`

Optional minimum width in grid columns.

### `property ui.GridPanelPlacement.width: number`

Width in grid columns.

### `property ui.GridPanelPlacement.x: number`

Horizontal position in grid columns, zero-indexed from the left.

### `property ui.GridPanelPlacement.y: number`

Vertical position in grid rows, zero-indexed from the top.

### `interface ui.StatusBadgeProps`

Public inputs for a compact semantic status indicator.

### `property ui.StatusBadgeProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.StatusBadgeProps.label: string`

Human-readable status label.

### `property ui.StatusBadgeProps.status: UiStatus`

Semantic state to present.

### `interface ui.TextProps`

Public inputs for the smallest reusable text presentation primitive.

### `property ui.TextProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.TextProps.content: string`

Text content rendered by the component.

### `property ui.TextProps.maxWidth?: number`

Optional maximum width in CSS pixels.

### `property ui.TextProps.strong?: boolean`

Whether the text uses the emphasized weight.

### `property ui.TextProps.tone?: TextTone`

Optional semantic color treatment.

### `property ui.TextProps.tooltip?: string`

Optional tooltip text used when truncation is enabled.

### `property ui.TextProps.truncate?: boolean`

Whether overflowing single-line content is truncated with an accessible tooltip.

### `interface ui.UiMountHandle`

Vendor-neutral lifecycle returned by a UI component mounted into an existing DOM host.

### `method ui.UiMountHandle.dispose(): void`

Unmounts the component and releases the owned UI root.

### `method ui.UiMountHandle.update(props: Props): void`

Re-renders the mounted component with complete next inputs.

### `type ui.CardShape = "rectangle" | "pill" | "circle" | "hexagon"`

Geometric outline of a card surface.

### `type ui.DataTableRowKey = string | number`

Stable key used to identify a table row independently of its position.

### `type ui.GridPanelId = string`

Stable caller-owned identity for one panel in a Grafting grid layout.

### `type ui.TextTone = "default" | "muted" | "accent" | "danger"`

Semantic text tones independent of the current visual implementation.

### `type ui.UiStatus = "neutral" | "info" | "success" | "warning" | "error"`

Semantic statuses supported by Grafting UI components.

### `function ui.Button(props: ButtonProps): ReactElement`

Compact action button for lightweight command triggers.

### `function ui.Card(props: CardProps): ReactElement`

Dependency-free bounded surface with replaceable accent and selection styles.

### `function ui.DataTable(props: DataTableProps<Row>): ReactElement`

Immutable rows table with controlled selection and custom renderers.

### `function ui.EntitySummary(props: EntitySummaryProps): ReactElement`

Composable identity card built from Card, Text, and StatusBadge.

### `function ui.GridLayout(props: GridLayoutProps): ReactElement`

Draggable/resizable dashboard layout using Grafting-owned panel contracts.

Consumers whose bundler does not already provide it must import
`react-grid-layout/css/styles.css` once at the application level; this
package does not import it as a side effect (it declares `sideEffects:
false`), so the choice of when and whether to load that stylesheet stays
with the consuming application.

### `function ui.mountEntitySummary(host: HTMLElement, props: EntitySummaryProps): UiMountHandle<EntitySummaryProps>`

Mounts an EntitySummary into an existing DOM host without exposing ReactDOM.

### `function ui.StatusBadge(props: StatusBadgeProps): ReactElement`

Semantic status marker with Grafting-owned status names.

### `function ui.Text(props: TextProps): ReactElement`

Bounded text with semantic tone and optional truncation.
