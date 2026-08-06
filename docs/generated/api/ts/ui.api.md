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

### `property ui.CanvasEditingOptions.removableEdges?: boolean`

Whether users may remove an existing connection by activating it with the removal gesture.

### `interface ui.CanvasEntityReference`

Stable reference to one caller-owned entity rendered on the canvas.

### `property ui.CanvasEntityReference.id: string`

Stable caller-owned identifier preserved by the adapter.

### `property ui.CanvasEntityReference.kind: "node" | "edge"`

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

### `interface ui.HeightfieldCanvas`

Lifecycle handle returned by createHeightfieldCanvas.

### `method ui.HeightfieldCanvas.captureImage(): string`

Captures the current frame as a PNG data URL, for use as a `PreviewCard` cover image.

### `method ui.HeightfieldCanvas.dispose(): void`

Stops rendering and releases all GPU/DOM resources.

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

### `property ui.HeightfieldCanvasOptions.planeSize?: number`

World-space size of the rendered plane. Defaults to `20`.

### `property ui.HeightfieldCanvasOptions.values: Float32Array`

Row-major height values, one per cell.

### `property ui.HeightfieldCanvasOptions.width: number`

Grid width, in cells.

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

### `function ui.createCanvas(container: HTMLElement, nodes: readonly CanvasNode[], edges: readonly CanvasEdge[], options: CanvasOptions): CanvasHandle`

Creates a graph canvas from caller-owned presentation data.

The UI boundary preserves identifiers and coordinates, mounts
consumer-supplied views, and keeps its rendering engine private. Graph
layout remains an explicit upstream computation.

### `function ui.createHeightfieldCanvas(container: HTMLElement, options: HeightfieldCanvasOptions): HeightfieldCanvas`

Mounts a real-time heightfield preview while keeping the renderer private.

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

### `function ui.PreviewCard(props: PreviewCardProps): ReactElement`

Gallery-style tile built from Card, Text, and StatusBadge: a cover image,
title/description, status, tags, and caller-owned actions.

### `function ui.StatusBadge(props: StatusBadgeProps): ReactElement`

Semantic status marker with Grafting-owned status names.

### `function ui.Text(props: TextProps): ReactElement`

Bounded text with semantic tone and optional truncation.
