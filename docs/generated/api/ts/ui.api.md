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

### `interface ui.CanvasConnectionEndpoint`

One endpoint of a connection a user is attempting to draw.

### `property ui.CanvasConnectionEndpoint.dataType?: string`

The port's opaque caller-owned value kind, when it declares one.

### `property ui.CanvasConnectionEndpoint.nodeId: string`

Stable identity of the endpoint node.

### `property ui.CanvasConnectionEndpoint.portId: string`

Identity of the port under the pointer.

### `interface ui.CanvasConnectionRequest`

A user-drawn connection awaiting a consumer's compatibility decision.

### `property ui.CanvasConnectionRequest.source: CanvasConnectionEndpoint`

Endpoint the connection was drawn from.

### `property ui.CanvasConnectionRequest.target: CanvasConnectionEndpoint`

Endpoint the connection was dropped on.

### `interface ui.CanvasEdge`

Immutable presentation data for one directed canvas edge.

### `property ui.CanvasEdge.data?: unknown`

Opaque consumer-owned data delivered unchanged to the edge presenter.

### `property ui.CanvasEdge.id: string`

Stable caller-owned identity preserved by the adapter.

### `property ui.CanvasEdge.source: CanvasEdgeTerminal`

Source node and optional port.

### `property ui.CanvasEdge.target: CanvasEdgeTerminal`

Target node and optional port.

### `property ui.CanvasEdge.view: string`

Identifier of an edge view supplied in the canvas options.

### `interface ui.CanvasEdgeLabelPresentation`

Product-supplied label rendered along an edge.

### `property ui.CanvasEdgeLabelPresentation.backgroundColor?: string`

Label background color.

### `property ui.CanvasEdgeLabelPresentation.borderColor?: string`

Label boundary color.

### `property ui.CanvasEdgeLabelPresentation.borderRadius?: number`

Rounded-corner radius in CSS pixels.

### `property ui.CanvasEdgeLabelPresentation.className?: string`

Optional product CSS class used for effects and typography.

### `property ui.CanvasEdgeLabelPresentation.color?: string`

Text color.

### `property ui.CanvasEdgeLabelPresentation.fontSize?: number`

Font size in CSS pixels.

### `property ui.CanvasEdgeLabelPresentation.fontWeight?: number`

Numeric font weight.

### `property ui.CanvasEdgeLabelPresentation.position?: number`

Relative position from zero at the source to one at the target.

### `property ui.CanvasEdgeLabelPresentation.text: string`

Human-readable text.

### `interface ui.CanvasEdgeLinePresentation`

Product-supplied appearance of the rendered edge path.

### `property ui.CanvasEdgeLinePresentation.attributes?: Readonly<Record<string, string | number>>`

Optional SVG attributes that are not already represented above.

### `property ui.CanvasEdgeLinePresentation.className?: string`

Optional product CSS class used for effects and animation.

### `property ui.CanvasEdgeLinePresentation.color?: string`

Stroke color.

### `property ui.CanvasEdgeLinePresentation.dash?: string`

SVG dash pattern.

### `property ui.CanvasEdgeLinePresentation.opacity?: number`

Stroke opacity from zero to one.

### `property ui.CanvasEdgeLinePresentation.sourceMarker?: CanvasEdgeMarkerPresentation`

Optional source marker.

### `property ui.CanvasEdgeLinePresentation.targetMarker?: CanvasEdgeMarkerPresentation`

Optional target marker.

### `property ui.CanvasEdgeLinePresentation.width?: number`

Stroke width in CSS pixels.

### `interface ui.CanvasEdgeMarkerPresentation`

Optional marker rendered at one end of an edge.

### `property ui.CanvasEdgeMarkerPresentation.fill?: string`

Marker fill color.

### `property ui.CanvasEdgeMarkerPresentation.height?: number`

Marker height in CSS pixels.

### `property ui.CanvasEdgeMarkerPresentation.kind: "block" | "none" | "classic"`

Marker geometry, or `none` to suppress it explicitly.

### `property ui.CanvasEdgeMarkerPresentation.stroke?: string`

Marker stroke color.

### `property ui.CanvasEdgeMarkerPresentation.width?: number`

Marker width in CSS pixels.

### `interface ui.CanvasEdgePresentation`

Complete consumer-owned visual projection for an edge.

### `property ui.CanvasEdgePresentation.connector?: CanvasEdgeConnector`

Optional path geometry; omitted values use the adapter's neutral default.

### `property ui.CanvasEdgePresentation.hitAreaWidth?: number`

Optional transparent interaction width around the visible path.

### `property ui.CanvasEdgePresentation.labels?: readonly CanvasEdgeLabelPresentation[]`

Optional labels rendered along the path.

### `property ui.CanvasEdgePresentation.line?: CanvasEdgeLinePresentation`

Optional line treatment.

### `property ui.CanvasEdgePresentation.zIndex?: number`

Optional layer used only for presentation ordering.

### `interface ui.CanvasEdgeRenderContext`

Context delivered to a consumer-supplied edge presenter.

### `property ui.CanvasEdgeRenderContext.edge: CanvasEdge`

Complete immutable consumer-owned edge.

### `property ui.CanvasEdgeRenderContext.selected: boolean`

Whether the canvas currently selects this edge.

### `interface ui.CanvasEdgeTerminal`

Consumer-owned endpoint of a rendered edge.

### `property ui.CanvasEdgeTerminal.nodeId: string`

Stable identity of the endpoint node.

### `property ui.CanvasEdgeTerminal.portId?: string`

Optional port identity defined by the endpoint node view.

### `interface ui.CanvasEdgeViewDefinition`

Consumer-supplied edge renderer registered for one canvas instance.

### `property ui.CanvasEdgeViewDefinition.id: string`

Stable identifier referenced by `CanvasEdge.view`.

### `method ui.CanvasEdgeViewDefinition.present(context: CanvasEdgeRenderContext): CanvasEdgePresentation`

Projects product data and selection into a vendor-neutral edge presentation.

### `interface ui.CanvasEditingOptions`

Consumer-owned authoring policy.

Omitting this whole option leaves the surface read-only to users; the
programmatic mutation methods on CanvasHandle remain available
regardless, since those are the caller acting on its own data.

### `property ui.CanvasEditingOptions.connectable?: boolean`

Whether users may draw new connections between ports.

### `property ui.CanvasEditingOptions.magneticRadius?: number`

How far from a port a released connection still snaps to it, in CSS pixels.

Enlarging the drop area is what makes connecting bearable when a port is
small or the surface is zoomed out: the user aims at a region instead of a
dot. Only ports that would have accepted the connection anyway are
considered, so this never turns a refused connection into an allowed one.

Omit, or use zero, to require releasing directly on the port.

### `property ui.CanvasEditingOptions.onConnected?: (edge: CanvasEdge) => void`

Receives the accepted edge once it has been added to the surface.

### `property ui.CanvasEditingOptions.onConnectRequest?: (request: CanvasConnectionRequest) => CanvasConnectionDecision`

Decides whether a user-drawn connection is allowed, and supplies the edge.

The canvas has already verified direction, capacity, self-connection, and
duplicate endpoints before calling this. Omitting it refuses every
user-drawn connection, because only a product knows whether two value
kinds are compatible.

### `property ui.CanvasEditingOptions.onDisconnected?: (edgeId: string) => void`

Receives the identity of a connection removed by a user.

### `property ui.CanvasEditingOptions.onNodeMoved?: (nodeId: string, x: number, y: number) => void`

Receives a node's new coordinates after a user finishes moving it.

### `property ui.CanvasEditingOptions.onNodeResized?: (nodeId: string, width: number, height: number) => void`

Receives a node's new size while a user drags its corner.

### `property ui.CanvasEditingOptions.removableEdges?: boolean`

Whether users may remove an existing connection by activating it with the removal gesture.

### `property ui.CanvasEditingOptions.resizableNodes?: boolean`

Whether users may resize a node by dragging its corner.

The node keeps the proportions its view was designed for; the drag only
chooses how large it is.

### `interface ui.CanvasEntityReference`

Stable reference to one caller-owned entity rendered on the canvas.

### `property ui.CanvasEntityReference.id: string`

Stable caller-owned identifier preserved by the adapter.

### `property ui.CanvasEntityReference.kind: "edge" | "node"`

Kind of rendered entity referenced by the caller-owned identifier.

### `interface ui.CanvasGridPresentation`

Optional grid rendered by the canvas surface.

### `property ui.CanvasGridPresentation.color?: string`

Grid color.

### `property ui.CanvasGridPresentation.kind: "dot" | "mesh"`

Grid geometry.

### `property ui.CanvasGridPresentation.size: number`

Distance between grid marks in CSS pixels.

### `property ui.CanvasGridPresentation.thickness?: number`

Grid mark or line thickness.

### `interface ui.CanvasHandle`

Controls returned to a canvas consumer.

### `property ui.CanvasHandle.edgeCount: number`

Number of edges currently rendered.

### `property ui.CanvasHandle.nodeCount: number`

Number of nodes currently rendered.

### `method ui.CanvasHandle.addEdge(edge: CanvasEdge): void`

Adds one caller-owned edge between two rendered ports.

### `method ui.CanvasHandle.addNode(node: CanvasNode): void`

Adds one caller-owned node.

### `method ui.CanvasHandle.center(): void`

Fits and centers the current rendered content in the viewport.

### `method ui.CanvasHandle.dispose(): void`

Releases the canvas resources owned by this adapter instance.

### `method ui.CanvasHandle.removeEdge(edgeId: string): void`

Removes one edge.

### `method ui.CanvasHandle.removeNode(nodeId: string): void`

Removes one node and every edge attached to it.

### `method ui.CanvasHandle.resetZoom(): void`

Restores the viewport to 100% scale around its center.

### `method ui.CanvasHandle.setSelection(selection: CanvasEntityReference | null): void`

Selects one rendered entity by its caller-owned identity, or clears the selection.

### `method ui.CanvasHandle.updateNode(node: CanvasNode): void`

Replaces one rendered node's data, coordinates, and ports in place.

The node keeps its identity and its connections, so this is how a product
applies a changed parameter without rebuilding the surface.

### `method ui.CanvasHandle.zoomBy(factor: number): void`

Changes the current viewport scale by a multiplicative factor.

Values above one zoom in and values below one zoom out. The result is
clamped to the canvas zoom limits around the viewport center.

### `interface ui.CanvasInteractionOptions`

Consumer-owned interaction policy for a read-only canvas.

### `property ui.CanvasInteractionOptions.clickThreshold?: number`

Movement tolerance that separates activation from panning.

### `property ui.CanvasInteractionOptions.movableNodes?: boolean`

Whether users may reposition nodes locally without changing graph structure or caller data.

### `property ui.CanvasInteractionOptions.panning?: boolean`

Whether ordinary primary-button dragging pans the surface.

### `property ui.CanvasInteractionOptions.selectOnActivate?: boolean`

Whether activation also selects the activated entity.

### `property ui.CanvasInteractionOptions.zoom?: false | CanvasZoomOptions`

Optional wheel zoom behavior, or `false` to disable it.

### `interface ui.CanvasNode`

Immutable presentation data for one canvas node.

### `property ui.CanvasNode.data?: unknown`

Opaque consumer-owned data delivered unchanged to the selected node view.

### `property ui.CanvasNode.height?: number`

Optional rendered height in CSS pixels.

### `property ui.CanvasNode.id: string`

Stable caller-owned identity preserved by the adapter.

### `property ui.CanvasNode.ports?: readonly CanvasPortDefinition[]`

Optional per-node port replacement for the selected view defaults.

### `property ui.CanvasNode.view: string`

Identifier of a node view supplied in the canvas options.

### `property ui.CanvasNode.width?: number`

Optional rendered width in CSS pixels.

### `property ui.CanvasNode.x: number`

Horizontal presentation coordinate supplied by the caller.

### `property ui.CanvasNode.y: number`

Vertical presentation coordinate supplied by the caller.

### `property ui.CanvasNode.zIndex?: number`

Optional layer used only for presentation ordering.

### `interface ui.CanvasNodeRenderContext`

Context delivered to a consumer-supplied node mount.

### `property ui.CanvasNodeRenderContext.node: CanvasNode`

Complete immutable consumer-owned node.

### `property ui.CanvasNodeRenderContext.selected: boolean`

Whether the canvas currently selects this node.

### `interface ui.CanvasNodeRenderHandle`

Lifecycle owned by a mounted consumer-supplied node view.

### `method ui.CanvasNodeRenderHandle.dispose(): void`

Releases every resource created by the mount.

### `method ui.CanvasNodeRenderHandle.update(context: CanvasNodeRenderContext): void`

Updates the mounted view after node data or selection changes.

### `interface ui.CanvasNodeViewDefinition`

Consumer-supplied node renderer registered for one canvas instance.

### `property ui.CanvasNodeViewDefinition.defaultHeight: number`

Default rendered height when a node does not override it.

### `property ui.CanvasNodeViewDefinition.defaultWidth: number`

Default rendered width when a node does not override it.

### `property ui.CanvasNodeViewDefinition.id: string`

Stable identifier referenced by `CanvasNode.view`.

### `property ui.CanvasNodeViewDefinition.ports?: readonly CanvasPortDefinition[]`

Optional replaceable connection ports shared by this view.

### `method ui.CanvasNodeViewDefinition.mount(host: HTMLElement, context: CanvasNodeRenderContext): CanvasNodeRenderHandle`

Mounts any DOM-based implementation without exposing its UI runtime.

### `interface ui.CanvasOptions`

Composition and optional read-only callbacks for a canvas instance.

### `property ui.CanvasOptions.edgeViews?: readonly CanvasEdgeViewDefinition[]`

Edge presenters available to this canvas instance.

### `property ui.CanvasOptions.editing?: CanvasEditingOptions`

Optional authoring policy; omission leaves the surface read-only to users.

### `property ui.CanvasOptions.interaction?: CanvasInteractionOptions`

Optional replaceable interaction policy.

### `property ui.CanvasOptions.nodeViews: readonly CanvasNodeViewDefinition[]`

Node view implementations available to this canvas instance.

### `property ui.CanvasOptions.onActivate?: (entity: CanvasEntityReference) => void`

Receives an immutable entity reference when a rendered entity is activated.

### `property ui.CanvasOptions.surface?: CanvasSurfacePresentation`

Optional background and grid treatment.

### `property ui.CanvasOptions.viewport?: CanvasViewportOptions`

Optional replaceable fit-to-content behavior.

### `interface ui.CanvasPortDefinition`

Consumer-owned connection point exposed by a node view.

### `property ui.CanvasPortDefinition.capacity?: number`

Maximum number of connections this port accepts.

Omit for no limit. A user-drawn connection that would exceed the limit is
refused before the consumer is consulted.

### `property ui.CanvasPortDefinition.dataType?: string`

Opaque caller-owned value kind carried by this port.

The canvas never interprets it; it is reported back to the consumer so a
product can decide whether two ports are compatible.

### `property ui.CanvasPortDefinition.direction?: CanvasPortDirection`

Endpoint role used when a user draws a connection.

### `property ui.CanvasPortDefinition.id: string`

Stable identifier referenced by edge terminals.

### `property ui.CanvasPortDefinition.magnet?: boolean`

Whether the port may participate in user-drawn connections.

### `property ui.CanvasPortDefinition.position: CanvasPortPosition`

Boundary side or custom position of the port.

### `property ui.CanvasPortDefinition.presentation?: CanvasPortPresentation`

Optional visible treatment; omitted ports remain technically available.

### `interface ui.CanvasPortPresentation`

Optional product-supplied appearance of a visible connection port.

### `property ui.CanvasPortPresentation.fill?: string`

Fill color understood by the browser.

### `property ui.CanvasPortPresentation.label?: string`

Optional text rendered beside the port.

### `property ui.CanvasPortPresentation.labelColor?: string`

Color of the optional label; falls back to the port stroke.

### `property ui.CanvasPortPresentation.labelFontSize?: number`

Font size of the optional label in CSS pixels.

### `property ui.CanvasPortPresentation.opacity?: number`

Opacity from zero to one.

### `property ui.CanvasPortPresentation.radius?: number`

Radius in CSS pixels.

### `property ui.CanvasPortPresentation.stroke?: string`

Stroke color understood by the browser.

### `property ui.CanvasPortPresentation.strokeWidth?: number`

Stroke width in CSS pixels.

### `interface ui.CanvasSurfacePresentation`

Consumer-owned canvas background and grid treatment.

### `property ui.CanvasSurfacePresentation.backgroundColor?: string`

Optional background color; omission leaves the surface transparent.

### `property ui.CanvasSurfacePresentation.grid?: false | CanvasGridPresentation`

Optional grid, or `false` to suppress it explicitly.

### `interface ui.CanvasViewportOptions`

Consumer-owned fit-to-content behavior.

### `property ui.CanvasViewportOptions.fitOnCreate?: boolean`

Whether content is fit and centered when the canvas is created.

### `property ui.CanvasViewportOptions.maxScale?: number`

Maximum scale used by fit and `center` operations.

### `property ui.CanvasViewportOptions.padding?: number`

Padding used by fit and `center` operations.

### `interface ui.CanvasZoomOptions`

Consumer-owned wheel zoom behavior.

### `property ui.CanvasZoomOptions.factor?: number`

Multiplicative zoom factor.

### `property ui.CanvasZoomOptions.maxScale?: number`

Maximum permitted scale.

### `property ui.CanvasZoomOptions.minScale?: number`

Minimum permitted scale.

### `property ui.CanvasZoomOptions.modifiers?: readonly CanvasInteractionModifier[]`

Required modifier keys; an empty list permits an unmodified wheel.

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

### `interface ui.CollapsePanel`

One collapsible section.

### `property ui.CollapsePanel.content: ReactNode`

Section content, shown when expanded.

### `property ui.CollapsePanel.header: string`

Section header, always visible.

### `property ui.CollapsePanel.key: string`

Stable identity within the list, and what `defaultActiveKeys` names.

### `interface ui.CollapseProps`

Public inputs for a set of stacked, individually collapsible sections.

### `property ui.CollapseProps.bordered?: boolean`

Whether the whole set draws its own outer border and panel background.
Set to `false` when this sits inside a surface that already provides
its own boundary (e.g. a Drawer) -- left `true`, both frame the
same content and it reads as boxed twice.

### `property ui.CollapseProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.CollapseProps.defaultActiveKeys?: readonly string[]`

Which panel keys start expanded. Defaults to every panel's own key, i.e. all expanded.

### `property ui.CollapseProps.panels: readonly CollapsePanel[]`

The sections, in display order.

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

### `interface ui.DescriptionItem`

One label-value row.

### `property ui.DescriptionItem.key: string`

Stable identity within the list.

### `property ui.DescriptionItem.label: string`

Row label.

### `property ui.DescriptionItem.value: ReactNode`

Row value, plain text or caller-rendered content.

### `interface ui.DescriptionsProps`

Public inputs for a compact label-value grid.

### `property ui.DescriptionsProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.DescriptionsProps.column?: number`

How many label-value pairs sit per row.

### `property ui.DescriptionsProps.items: readonly DescriptionItem[]`

The rows to display, in order.

### `interface ui.DrawerProps`

Public inputs for a panel that slides in from a screen edge.

### `property ui.DrawerProps.children: ReactNode`

Content rendered inside the drawer body.

### `property ui.DrawerProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.DrawerProps.onClose: () => void`

Invoked when the drawer requests to close, e.g. its own close button or Escape.

### `property ui.DrawerProps.open: boolean`

Whether the drawer is currently shown.

### `property ui.DrawerProps.placement?: "bottom" | "left" | "right" | "top"`

Which screen edge the drawer slides in from.

### `property ui.DrawerProps.size?: number`

Drawer width (for `left`/`right` placement) or height (for `top`/`bottom`), in CSS pixels.

### `property ui.DrawerProps.title?: string`

Optional header text shown above the content.

### `interface ui.EdgeHandleProps`

Public inputs for a small handle fused to one edge of a panel, toggling it open/closed.

### `property ui.EdgeHandleProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.EdgeHandleProps.edge: "left" | "right"`

Which edge of the panel the handle protrudes from -- `"right"` bulges
rightward (for a panel anchored to the screen's left edge), `"left"`
bulges leftward (for a panel anchored to the right edge).

### `property ui.EdgeHandleProps.onClick: () => void`

Invoked on a plain tap/click (movement below the drag threshold) or a keyboard activation. Never called for a real drag -- use `onDragEnd` for that.

### `property ui.EdgeHandleProps.onDrag?: (deltaX: number) => void`

Optional drag reporting. Once a press moves past a small threshold,
`onDrag` fires on every subsequent move with the horizontal offset (in
pixels, signed) from where the press started, and `onDragEnd` fires
once on release with the final offset -- a caller (e.g. `SlidingPanel`)
uses these to let the panel itself track the pointer 1:1 while
dragging. A press that never crosses the threshold is a plain tap and
only calls `onClick`; provide both callbacks together or neither.

### `property ui.EdgeHandleProps.onDragEnd?: (deltaX: number) => void`

Fires once on release, only after a real drag (see `onDrag`).

### `property ui.EdgeHandleProps.open: boolean`

Whether the panel this handle belongs to is currently open.

### `property ui.EdgeHandleProps.style?: CSSProperties`

Optional caller-owned inline style, e.g. to place this handle at a specific position.

### `property ui.EdgeHandleProps.title: string`

Tooltip and accessible name.

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

### `interface ui.FloatButtonGroupProps`

Public inputs for a cluster of floating actions, either collapsed behind one trigger or always visible as a plain row/column.

### `property ui.FloatButtonGroupProps.alwaysExpanded?: boolean`

Skips the collapsible trigger entirely -- every item renders directly,
always visible, with no separate open/close button. Use this for a
plain always-on toolbar rather than a Foundry-style "tap to reveal"
menu.

### `property ui.FloatButtonGroupProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.FloatButtonGroupProps.icon?: ReactNode`

The trigger's own icon, shown when the group is collapsed. Unused when `alwaysExpanded` is set -- there is no trigger to show it on.

### `property ui.FloatButtonGroupProps.items: readonly FloatButtonItem[]`

The actions revealed when the group is open, in display order.

### `property ui.FloatButtonGroupProps.onOpenChange?: (open: boolean) => void`

Invoked with the group's next open state, e.g. on an outside click or its own trigger.

### `property ui.FloatButtonGroupProps.open?: boolean`

Controlled open state, together with `trigger` -- required to close the
group programmatically, e.g. after an item's own `onClick` fires, since
Ant Design does not do that on its own. Uncontrolled (starts collapsed,
closes only on its own trigger/outside click) when omitted. Ignored
when `alwaysExpanded` is set.

### `property ui.FloatButtonGroupProps.placement?: "bottom" | "left" | "right" | "top"`

Which side the group expands toward from the trigger -- `"top"`/`"bottom"`
stack items in a vertical column, `"left"`/`"right"` lay them out in a
horizontal row. When `alwaysExpanded` is set, this only picks the row's
axis (vertical for `"top"`/`"bottom"`, horizontal for `"left"`/`"right"`),
since there is no trigger to expand away from.

### `property ui.FloatButtonGroupProps.shape?: "circle" | "square"`

Outline. `"square"` renders the items as one joined, gapless block
(Ant Design's own compact-group styling) instead of separate floating
circles -- the trigger itself, which becomes the close control once
open, always renders as its own separate element outside that block.
Ignored (no joined styling) when `alwaysExpanded` is set.

### `property ui.FloatButtonGroupProps.style?: CSSProperties`

Optional caller-owned inline style, e.g. to place this group's trigger at a specific fixed position.

### `property ui.FloatButtonGroupProps.trigger?: "click" | "hover"`

Whether the group opens on click or hover. Ignored when `alwaysExpanded`
is set.

### `interface ui.FloatButtonItem`

One action inside a FloatButtonGroup.

### `property ui.FloatButtonItem.disabled?: boolean`

Renders this item non-interactive.

### `property ui.FloatButtonItem.icon: ReactNode`

Caller-rendered icon content. Vendor-neutral -- this molecule never ships its own icon set.

### `property ui.FloatButtonItem.key: string`

Stable identity within the list.

### `property ui.FloatButtonItem.onClick?: () => void`

Invoked when this item is activated.

### `property ui.FloatButtonItem.tone?: "default" | "primary"`

Emphasis, e.g. to mark the currently-active item in a tool selector.

### `property ui.FloatButtonItem.tooltip: string`

Tooltip and accessible name -- a float button shows no visible text label of its own.

### `interface ui.FloatButtonProps`

Public inputs for a single floating action, independent of any group.

### `property ui.FloatButtonProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.FloatButtonProps.disabled?: boolean`

Renders this button non-interactive.

### `property ui.FloatButtonProps.icon: ReactNode`

Caller-rendered icon content. Vendor-neutral -- this atom never ships its own icon set.

### `property ui.FloatButtonProps.onClick?: () => void`

Invoked when this button is activated.

### `property ui.FloatButtonProps.shape?: "circle" | "square"`

Outline. `"square"` reads as part of a joined block -- pair it with a
`FloatButtonGroup` molecule using the same shape so the two visually
belong together.

### `property ui.FloatButtonProps.style?: CSSProperties`

Optional caller-owned inline style, e.g. to place this button at a specific fixed position.

### `property ui.FloatButtonProps.tone?: "default" | "primary"`

Emphasis. `"primary"` is the right choice for a button that opens a
panel rather than firing a direct action, so it reads as distinct from
a same-row action cluster.

### `property ui.FloatButtonProps.tooltip: string`

Tooltip and accessible name -- a float button shows no visible text label of its own.

### `interface ui.FloatButtonTreeBranch`

A branch: its own floating trigger, revealing a nested list of further FloatButtonTreeNodes -- leaves, or further branches.

### `property ui.FloatButtonTreeBranch.children: readonly FloatButtonTreeNode[]`

The nodes revealed when this branch opens, in display order.

### `property ui.FloatButtonTreeBranch.disabled?: boolean`

Renders this branch's own trigger non-interactive.

### `property ui.FloatButtonTreeBranch.icon: ReactNode`

Caller-rendered icon content. Vendor-neutral -- this organism never ships its own icon set.

### `property ui.FloatButtonTreeBranch.key: string`

Stable identity among its siblings.

### `property ui.FloatButtonTreeBranch.onClick?: undefined`

Absent on a branch -- a branch opens its `children`, it does not fire a direct action.

### `property ui.FloatButtonTreeBranch.placement?: FloatButtonTreePlacement`

Overrides the tree-level default expand direction for this branch's own submenu.

### `property ui.FloatButtonTreeBranch.siblingMode?: FloatButtonTreeSiblingMode`

Overrides the tree-level default sibling behavior among this branch's own children.

### `property ui.FloatButtonTreeBranch.tone?: "default" | "primary"`

Emphasis, e.g. to mark the currently-active branch in a selector.

### `property ui.FloatButtonTreeBranch.tooltip: string`

Tooltip and accessible name -- a float button shows no visible text label of its own.

### `property ui.FloatButtonTreeBranch.trigger?: FloatButtonTreeTrigger`

Overrides the tree-level default trigger for this branch's own submenu.

### `interface ui.FloatButtonTreeLeaf`

A direct action -- the tree's equivalent of a leaf node.

### `property ui.FloatButtonTreeLeaf.children?: undefined`

Absent on a leaf -- its presence (not its value) is what distinguishes a FloatButtonTreeBranch from a leaf.

### `property ui.FloatButtonTreeLeaf.disabled?: boolean`

Renders this leaf non-interactive.

### `property ui.FloatButtonTreeLeaf.icon: ReactNode`

Caller-rendered icon content. Vendor-neutral -- this organism never ships its own icon set.

### `property ui.FloatButtonTreeLeaf.key: string`

Stable identity among its siblings.

### `property ui.FloatButtonTreeLeaf.onClick: () => void`

Invoked when this leaf is activated. Closes the whole tree afterward, like choosing a menu action.

### `property ui.FloatButtonTreeLeaf.tone?: "default" | "primary"`

Emphasis, e.g. to mark the currently-active leaf in a selector.

### `property ui.FloatButtonTreeLeaf.tooltip: string`

Tooltip and accessible name -- a float button shows no visible text label of its own.

### `interface ui.FloatButtonTreeProps`

Public inputs for a tree of floating-button groups -- a group whose items can themselves be groups.

### `property ui.FloatButtonTreeProps.className?: string`

Optional caller-owned class name for the tree's own root position wrapper.

### `property ui.FloatButtonTreeProps.placement?: FloatButtonTreePlacement`

Default submenu expand direction for every branch that does not set its own.

### `property ui.FloatButtonTreeProps.root: FloatButtonTreeBranch`

The tree's single entry point. Always a branch: a tree with nothing to expand is just a `FloatButton`.

### `property ui.FloatButtonTreeProps.shape?: "circle" | "square"`

Outline for every button in the tree.

### `property ui.FloatButtonTreeProps.siblingMode?: FloatButtonTreeSiblingMode`

Default sibling behavior for every branch that does not set its own.

### `property ui.FloatButtonTreeProps.style?: CSSProperties`

Optional caller-owned inline style, e.g. to fix the tree's root to a corner of the screen.

### `property ui.FloatButtonTreeProps.trigger?: FloatButtonTreeTrigger`

Default submenu trigger for every branch that does not set its own.

### `interface ui.GeometryCanvas`

Lifecycle handle returned by createGeometryCanvas.

### `method ui.GeometryCanvas.captureImage(): string`

Captures the current frame as a PNG data URL.

### `method ui.GeometryCanvas.dispose(): void`

Stops rendering and releases all GPU/DOM resources.

### `method ui.GeometryCanvas.resetCamera(): void`

Frames the geometry, whatever the user has done to the camera.

### `method ui.GeometryCanvas.setNavigable(navigable: boolean): void`

Turns camera navigation on or off after construction.

### `method ui.GeometryCanvas.update(positions: Float32Array, indices: Uint32Array): void`

Replaces the rendered geometry, keeping the camera where the user left it.

### `interface ui.GeometryCanvasOptions`

Configuration for createGeometryCanvas. Colors are plain numeric hex values (e.g. `0x5b8a63`).

### `property ui.GeometryCanvasOptions.backgroundColor?: number`

Scene background color. Defaults to `0x0f172a`.

### `property ui.GeometryCanvasOptions.indices: Uint32Array`

Triangles indexing them.

### `property ui.GeometryCanvasOptions.meshColor?: number`

Surface color. Defaults to `0x7fa86a`.

### `property ui.GeometryCanvasOptions.navigable?: boolean`

Whether dragging and scrolling drive the camera. Defaults to `false`.

Off by default for the same reason the heightfield canvas leaves it off:
this is usually embedded in a surface that pans and zooms itself, and a
canvas that silently swallowed those gestures would break it.

### `property ui.GeometryCanvasOptions.positions: Float32Array`

Flat `xyz` triples.

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

### `interface ui.HeightfieldCanvas`

Lifecycle handle returned by createHeightfieldCanvas.

### `method ui.HeightfieldCanvas.captureImage(): string`

Captures the current frame as a PNG data URL, for use as a `PreviewCard` cover image.

### `method ui.HeightfieldCanvas.dispose(): void`

Stops rendering and releases all GPU/DOM resources.

### `method ui.HeightfieldCanvas.resetCamera(): void`

Returns the camera to the framing the canvas was created with.

### `method ui.HeightfieldCanvas.setNavigable(navigable: boolean): void`

Turns camera navigation on or off after construction.

Auto-rotation stops while navigation is on: a camera the user is aiming
and a mesh that keeps turning under it fight each other, and the result
reads as the controls being broken.

### `method ui.HeightfieldCanvas.update(values: Float32Array): void`

Replaces the rendered terrain with new height values, keeping the same grid size and camera.

### `interface ui.HeightfieldCanvasOptions`

Configuration for createHeightfieldCanvas. Colors are plain numeric hex values (e.g. `0x5b8a63`).

### `property ui.HeightfieldCanvasOptions.autoRotate?: boolean`

Whether the terrain slowly auto-rotates. Defaults to `true`.

### `property ui.HeightfieldCanvasOptions.backgroundColor?: number`

Scene background color. Defaults to `0xf7f9fc`.

### `property ui.HeightfieldCanvasOptions.height: number`

Grid height, in cells.

### `property ui.HeightfieldCanvasOptions.heightScale?: number`

Vertical displacement multiplier applied to each height value. Defaults to `6`.

### `property ui.HeightfieldCanvasOptions.meshColor?: number`

Terrain mesh color. Defaults to `0x5b8a63`.

### `property ui.HeightfieldCanvasOptions.navigable?: boolean`

Whether dragging and scrolling drive the camera. Defaults to `false`.

Off by default because this canvas is often embedded in a surface that
pans and zooms itself -- a graph node, a scrolling page -- and a canvas
that silently swallowed those gestures would break the surface around it.
A host that wants navigation asks for it, and gets exclusive use of the
pointer while it is on.

### `property ui.HeightfieldCanvasOptions.planeSize?: number`

World-space size of the rendered plane. Defaults to `20`.

### `property ui.HeightfieldCanvasOptions.values: Float32Array`

Row-major height values, one per cell.

### `property ui.HeightfieldCanvasOptions.width: number`

Grid width, in cells.

### `interface ui.IconButtonProps`

Public inputs for a compact, icon-first action or toggle.

### `property ui.IconButtonProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.IconButtonProps.disabled?: boolean`

Whether the button rejects interaction.

### `property ui.IconButtonProps.icon: ReactNode`

Caller-rendered icon content (glyph, emoji, or inline SVG). Vendor-neutral
on purpose -- this atom never ships its own icon set.

### `property ui.IconButtonProps.label?: string`

Optional visible label rendered beside the icon. Icon-only when omitted.

### `property ui.IconButtonProps.onClick?: () => void`

Invoked when the button is activated.

### `property ui.IconButtonProps.selected?: boolean`

Whether the button displays its selected/active treatment.

### `property ui.IconButtonProps.title: string`

Accessible name and hover tooltip. Required when `label` is omitted, since an icon-only button has no other text content.

### `interface ui.PopoverProps`

Public inputs for a small floating panel anchored to a trigger element.

### `property ui.PopoverProps.anchor: ReactNode`

The element the popover positions itself against.

### `property ui.PopoverProps.children: ReactNode`

Content rendered inside the popover body.

### `property ui.PopoverProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.PopoverProps.onClose: () => void`

Invoked when the popover requests to close, e.g. an outside click or Escape.

### `property ui.PopoverProps.open: boolean`

Whether the popover is currently shown.

### `property ui.PopoverProps.placement?: "bottom" | "left" | "right" | "top"`

Which side of `anchor` the popover opens toward.

### `property ui.PopoverProps.title?: string`

Optional header text shown above the content.

### `interface ui.PreviewCardProps`

Public inputs for a gallery-style tile: cover image, title/description, status, tags, and actions.

### `property ui.PreviewCardProps.accentColor?: string`

Optional accent used for the card boundary.

### `property ui.PreviewCardProps.actions?: ReactNode`

Optional actions rendered at the bottom of the card.

### `property ui.PreviewCardProps.ariaLabel?: string`

Optional accessible name for the card container.

### `property ui.PreviewCardProps.backgroundColor?: string`

Optional background color for the card surface.

### `property ui.PreviewCardProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.PreviewCardProps.cover?: { alt: string; src: string }`

Optional cover image shown above the title, clipped to the card's own
corners. `alt` is bundled with `src` so accessible text can never be
forgotten when a cover is present.

### `property ui.PreviewCardProps.description?: string`

Optional secondary description.

### `property ui.PreviewCardProps.fillContainer?: boolean`

Whether the card occupies the complete width and height of its container.

### `property ui.PreviewCardProps.glowColor?: string`

Optional glow color rendered as an outer shadow, e.g. to signal live status.

### `property ui.PreviewCardProps.interactive?: boolean`

Whether the card should communicate pointer interaction.

### `property ui.PreviewCardProps.selected?: boolean`

Whether the card displays its selected treatment.

### `property ui.PreviewCardProps.selectedColor?: string`

Optional boundary color used when the card is selected.

### `property ui.PreviewCardProps.status?: UiStatus`

Optional semantic status.

### `property ui.PreviewCardProps.statusLabel?: string`

Human-readable label paired with status.

### `property ui.PreviewCardProps.tags?: readonly string[]`

Optional short caller-owned labels rendered as compact badges.

### `property ui.PreviewCardProps.title: string`

Primary human-readable title.

### `interface ui.SelectableChipProps`

Public inputs for a small, toggleable choice within a set of options.

### `property ui.SelectableChipProps.className?: string`

Optional caller-owned class name for layout composition.

### `property ui.SelectableChipProps.label: string`

Human-readable choice label.

### `property ui.SelectableChipProps.onSelect?: (selected: boolean) => void`

Invoked when the chip is activated. Receives the chip's own next selected state, matching Ant Design's `CheckableTag` convention.

### `property ui.SelectableChipProps.selected?: boolean`

Whether this chip is the active choice.

### `property ui.SelectableChipProps.swatchColor?: string`

Optional color swatch rendered before the label, e.g. a material preview.

### `interface ui.SlidingPanelProps`

Public inputs for a panel anchored to one screen edge that slides fully off-screen when closed, dragged open/closed by a handle fused to its own edge.

### `property ui.SlidingPanelProps.children: ReactNode`

The panel's own content, below the title.

### `property ui.SlidingPanelProps.className?: string`

Optional caller-owned class name for the panel's own container.

### `property ui.SlidingPanelProps.edge: "left" | "right"`

Which screen edge the panel is anchored to.

### `property ui.SlidingPanelProps.onOpenChange: (open: boolean) => void`

Invoked with the panel's next open state, from a tap or a drag past the midpoint.

### `property ui.SlidingPanelProps.open: boolean`

Whether the panel is currently open.

### `property ui.SlidingPanelProps.style?: CSSProperties`

Optional caller-owned inline style, merged onto the panel's own container.

### `property ui.SlidingPanelProps.title: string`

Header text shown at the top of the panel's content area.

### `property ui.SlidingPanelProps.width: number`

Panel width in pixels.

### `property ui.SlidingPanelProps.zIndex?: number`

Stacking order for the panel's own fixed container.

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

### `type ui.CanvasConnectionDecision = { accepted: false; reason?: string } | { accepted: true; edge: CanvasEdge }`

A consumer's answer to a connection request.

Accepting requires supplying the new edge, because identity, view selection,
and edge data are caller-owned and the canvas cannot invent them.

### `type ui.CanvasEdgeConnector = { kind: "straight" } | { direction?: "horizontal" | "vertical"; kind: "smooth" } | { kind: "rounded"; radius?: number }`

Connector geometry selected by a consumer without exposing renderer-specific names.

### `type ui.CanvasInteractionModifier = "control" | "meta" | "alt" | "shift"`

Modifier used by the optional canvas zoom interaction.

### `type ui.CanvasPortDirection = "in" | "out" | "both"`

Role a port plays when a connection is drawn.

`both` preserves the undirected behavior of ports that predate directional
authoring: such a port may act as either endpoint.

### `type ui.CanvasPortPosition = "top" | "right" | "bottom" | "left" | { x: number; y: number }`

Immutable position for a connection port around a node boundary.

### `type ui.CardShape = "rectangle" | "pill" | "circle" | "hexagon"`

Geometric outline of a card surface.

### `type ui.DataTableRowKey = string | number`

Stable key used to identify a table row independently of its position.

### `type ui.FloatButtonTreeNode = FloatButtonTreeLeaf | FloatButtonTreeBranch`

One node of a FloatButtonTree: either a leaf action or a branch with its own nested children.

### `type ui.FloatButtonTreePlacement = "top" | "right" | "bottom" | "left"`

Which side a branch's own submenu expands toward from its trigger.

### `type ui.FloatButtonTreeSiblingMode = "accordion" | "multiple"`

How siblings under the same branch coordinate their open state. `"accordion"` closes any other open sibling when one opens; `"multiple"` lets them stay open together.

### `type ui.FloatButtonTreeTrigger = "click" | "hover"`

How a branch's own submenu opens.

### `type ui.GridPanelId = string`

Stable caller-owned identity for one panel in a Grafting grid layout.

### `type ui.TextTone = "default" | "muted" | "accent" | "danger"`

Semantic text tones independent of the current visual implementation.

### `type ui.UiStatus = "neutral" | "info" | "success" | "warning" | "error"`

Semantic statuses supported by Grafting UI components.

### `variable ui.EDGE_HANDLE_SIZE: 28`

The handle's own footprint (`width`, half of `height`) -- exported so a caller composing a panel around this handle (e.g. `SlidingPanel`) can position it flush against the panel's edge without duplicating the magic number.

### `function ui.Button(props: ButtonProps): ReactElement`

Compact action button for lightweight command triggers.

### `function ui.Card(props: CardProps): ReactElement`

Dependency-free bounded surface with replaceable accent and selection styles.

### `function ui.Collapse(props: CollapseProps): ReactElement`

Several named sections stacked in one surface, each independently
expandable -- the right shape for a settings/inspector panel with more
than one topic, where stacking a separate Card per topic would
double the framing (the panel this sits inside, e.g. a Drawer,
already provides the outer boundary).

### `function ui.createCanvas(container: HTMLElement, nodes: readonly CanvasNode[], edges: readonly CanvasEdge[], options: CanvasOptions): CanvasHandle`

Creates a graph canvas from caller-owned presentation data.

The UI boundary preserves identifiers and coordinates, mounts
consumer-supplied views, and keeps its rendering engine private. Graph
layout remains an explicit upstream computation.

### `function ui.createGeometryCanvas(container: HTMLElement, options: GeometryCanvasOptions): GeometryCanvas`

Mounts a real-time preview of arbitrary triangle geometry, keeping the
renderer private.

Separate from createHeightfieldCanvas rather than a mode of it: a
raster holds one height per point, and geometry off the lattice or with a
vertical step has more than one.

### `function ui.createHeightfieldCanvas(container: HTMLElement, options: HeightfieldCanvasOptions): HeightfieldCanvas`

Mounts a real-time heightfield preview while keeping the renderer private.

### `function ui.DataTable(props: DataTableProps<Row>): ReactElement`

Immutable rows table with controlled selection and custom renderers.

### `function ui.Descriptions(props: DescriptionsProps): ReactElement`

A read-only label-value grid -- the right shape for an inspector or a
metrics panel, where Card (a bounded, bordered surface meant to
stand alone, e.g. in a gallery grid) adds a frame this content does not
need, especially when several of these already sit inside another bounded
surface like Drawer or a Collapse panel.

### `function ui.Drawer(props: DrawerProps): ReactElement`

An edge-sliding settings/inspector panel, built on Ant Design's own
`Drawer`. Non-modal by default (no backdrop, no interaction lock on the
rest of the page) -- the common case for a persistent settings panel
beside a live 3D viewport, where blocking the scene behind it would be
unwanted.

### `function ui.EdgeHandle(props: EdgeHandleProps): ReactElement`

A half-round tab fused to one edge of a panel -- rounded on the side
facing away from the panel, flat on the side touching it, so it reads as
grown out of the panel rather than a separate floating control. Toggles
the panel open/closed on tap; optionally reports raw drag deltas so a
caller can let the panel itself be pulled open/closed, not just clicked.
No library ships this shape (confirmed by research before building it --
shadcn/ui's `SidebarRail` is the closest published pattern, but it is a
full-height drag rail on a Tailwind/Radix stack this project does not
use, not this shape). Hand-built CSS is the right size of solution here:
one small shape, no dependency.

### `function ui.EntitySummary(props: EntitySummaryProps): ReactElement`

Composable identity card built from Card, Text, and StatusBadge.

### `function ui.FloatButton(props: FloatButtonProps): ReactElement`

One floating action, standalone -- the right shape for a corner-fixed
trigger like a settings-panel toggle, or a `Popover`/`Drawer` anchor whose
behavior (opens a panel) does not belong inside a `FloatButtonGroup`
molecule's list of direct actions.

### `function ui.FloatButtonGroup(props: FloatButtonGroupProps): ReactElement`

A cluster of floating actions -- either collapsed behind one trigger
(Ant Design's own `FloatButton.Group`, for a Foundry-style tool menu: a
category button that reveals its own sub-items) or, with `alwaysExpanded`,
a plain always-visible row/column of the same items with no trigger at
all. The atom `FloatButton` remains the right choice for a single
standalone action; this molecule is for a *cluster*.

The collapsed path renders its items as Ant Design's own `FloatButton`
directly, not this package's `FloatButton` atom -- `FloatButton.Group`
recognizes its children by that exact component reference to apply
group-item styling and layout, and a wrapping component in between breaks
that recognition silently (the group renders, but its items lose the
group's own positioning and behavior). The `alwaysExpanded` path has no
such constraint (no `FloatButton.Group` involved), but uses the same
direct `AntFloatButton` reference for consistency.

### `function ui.FloatButtonTree(props: FloatButtonTreeProps): ReactElement`

A tree of floating-button groups: a root trigger reveals a floating list
of items, any of which can itself be a branch with its own nested list
-- "a group of groups". Generic and product-agnostic: every node is
plain data (an action, or an icon/tooltip plus more nodes), nothing here
names a product concept.

Built on `@floating-ui/react` (MIT, the maintained successor to Popper.js)
rather than hand-rolled, specifically for its `FloatingTree` primitive:
coordinating open/close state, dismissal, and positioning across an
arbitrarily nested set of floating elements is exactly the hard part a
library should own. The event-coordination pattern here (a branch
announces opening via `tree.events` so accordion siblings close, a leaf
click announces closing the whole tree) mirrors Floating UI's own
reference nested-menu implementation
(`packages/react/test/visual/components/Menu.tsx` in their monorepo),
simplified: no roving-tabindex list navigation or typeahead, since this
is a cluster of buttons, not a full ARIA menu widget.

Every branch's trigger mode (`"click"` | `"hover"`) and sibling behavior
(`"accordion"` | `"multiple"`) default from this component's own props
but can be overridden per branch node, so one tree can mix e.g.
click-to-open categories with hover-to-open sub-items.

### `function ui.GridLayout(props: GridLayoutProps): ReactElement`

Draggable/resizable dashboard layout using Grafting-owned panel contracts.

Consumers whose bundler does not already provide it must import
`react-grid-layout/css/styles.css` once at the application level; this
package does not import it as a side effect (it declares `sideEffects:
false`), so the choice of when and whether to load that stylesheet stays
with the consuming application.

### `function ui.IconButton(props: IconButtonProps): ReactElement`

Compact icon-first action button with an explicit selected state, for
toolbars, rails, and hotbars where a text-label Button would not
fit -- backed by the same Ant Design button as Button, with
Grafting owning the selected-state boundary color rather than trusting a
vendor theme default.

### `function ui.mountEntitySummary(host: HTMLElement, props: EntitySummaryProps): UiMountHandle<EntitySummaryProps>`

Mounts an EntitySummary into an existing DOM host without exposing ReactDOM.

### `function ui.Popover(props: PopoverProps): ReactElement`

Dismissible floating content anchored to a trigger element -- e.g. a
shape/material picker opened from a toolbar button -- built on Ant
Design's own `Popover` rather than a hand-positioned overlay, since
anchor-relative placement (including flipping when it would overflow the
viewport) is exactly what that vendor primitive already solves.

### `function ui.PreviewCard(props: PreviewCardProps): ReactElement`

Gallery-style tile built from Card, Text, and StatusBadge: a cover image,
title/description, status, tags, and caller-owned actions.

### `function ui.SelectableChip(props: SelectableChipProps): ReactElement`

One toggleable choice in a small set -- e.g. a material or preset picker --
built on Ant Design's `Tag.CheckableTag` rather than a bare `Tag`, since the
selectable behavior (not just the visual chip shape) is exactly what that
vendor primitive already models.

### `function ui.SlidingPanel(props: SlidingPanelProps): ReactElement`

A panel fixed to one edge of the screen that slides fully off-screen when
closed and back into view when open, with an EdgeHandle fused to
its edge as the drag/toggle control -- the handle is a child of the
panel's own transformed element, so it visually travels with the slide
animation instead of sitting at a fixed screen position while the panel
moves independently underneath it. The handle can also be dragged: while
pressed, the panel tracks the pointer 1:1 (no transition), and on release
it snaps to whichever side (open/closed) it crossed the midpoint toward.

Not built on `Drawer` (this package's own, wrapping Ant Design's): that
component's portal/motion internals give no seam to attach external
content that moves with its animated edge, which is the entire point of
this molecule.

### `function ui.StatusBadge(props: StatusBadgeProps): ReactElement`

Semantic status marker with Grafting-owned status names.

### `function ui.Text(props: TextProps): ReactElement`

Bounded text with semantic tone and optional truncation.
