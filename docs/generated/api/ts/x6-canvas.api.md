# x6-canvas

### `interface x6-canvas.CanvasEdge`

Immutable presentation data for one directed canvas edge.

### `property x6-canvas.CanvasEdge.data?: unknown`

Opaque consumer-owned data delivered unchanged to the edge presenter.

### `property x6-canvas.CanvasEdge.id: string`

Stable caller-owned identity preserved by the adapter.

### `property x6-canvas.CanvasEdge.source: CanvasEdgeTerminal`

Source node and optional port.

### `property x6-canvas.CanvasEdge.target: CanvasEdgeTerminal`

Target node and optional port.

### `property x6-canvas.CanvasEdge.view: string`

Identifier of an edge view supplied in the canvas options.

### `interface x6-canvas.CanvasEdgeLabelPresentation`

Product-supplied label rendered along an edge.

### `property x6-canvas.CanvasEdgeLabelPresentation.backgroundColor?: string`

Label background color.

### `property x6-canvas.CanvasEdgeLabelPresentation.borderColor?: string`

Label boundary color.

### `property x6-canvas.CanvasEdgeLabelPresentation.borderRadius?: number`

Rounded-corner radius in CSS pixels.

### `property x6-canvas.CanvasEdgeLabelPresentation.className?: string`

Optional product CSS class used for effects and typography.

### `property x6-canvas.CanvasEdgeLabelPresentation.color?: string`

Text color.

### `property x6-canvas.CanvasEdgeLabelPresentation.fontSize?: number`

Font size in CSS pixels.

### `property x6-canvas.CanvasEdgeLabelPresentation.fontWeight?: number`

Numeric font weight.

### `property x6-canvas.CanvasEdgeLabelPresentation.position?: number`

Relative position from zero at the source to one at the target.

### `property x6-canvas.CanvasEdgeLabelPresentation.text: string`

Human-readable text.

### `interface x6-canvas.CanvasEdgeLinePresentation`

Product-supplied appearance of the rendered edge path.

### `property x6-canvas.CanvasEdgeLinePresentation.attributes?: Readonly<Record<string, string | number>>`

Optional SVG attributes that are not already represented above.

### `property x6-canvas.CanvasEdgeLinePresentation.className?: string`

Optional product CSS class used for effects and animation.

### `property x6-canvas.CanvasEdgeLinePresentation.color?: string`

Stroke color.

### `property x6-canvas.CanvasEdgeLinePresentation.dash?: string`

SVG dash pattern.

### `property x6-canvas.CanvasEdgeLinePresentation.opacity?: number`

Stroke opacity from zero to one.

### `property x6-canvas.CanvasEdgeLinePresentation.sourceMarker?: CanvasEdgeMarkerPresentation`

Optional source marker.

### `property x6-canvas.CanvasEdgeLinePresentation.targetMarker?: CanvasEdgeMarkerPresentation`

Optional target marker.

### `property x6-canvas.CanvasEdgeLinePresentation.width?: number`

Stroke width in CSS pixels.

### `interface x6-canvas.CanvasEdgeMarkerPresentation`

Optional marker rendered at one end of an edge.

### `property x6-canvas.CanvasEdgeMarkerPresentation.fill?: string`

Marker fill color.

### `property x6-canvas.CanvasEdgeMarkerPresentation.height?: number`

Marker height in CSS pixels.

### `property x6-canvas.CanvasEdgeMarkerPresentation.kind: "none" | "block" | "classic"`

Marker geometry, or `none` to suppress it explicitly.

### `property x6-canvas.CanvasEdgeMarkerPresentation.stroke?: string`

Marker stroke color.

### `property x6-canvas.CanvasEdgeMarkerPresentation.width?: number`

Marker width in CSS pixels.

### `interface x6-canvas.CanvasEdgePresentation`

Complete consumer-owned visual projection for an edge.

### `property x6-canvas.CanvasEdgePresentation.connector?: CanvasEdgeConnector`

Optional path geometry; omitted values use the adapter's neutral default.

### `property x6-canvas.CanvasEdgePresentation.hitAreaWidth?: number`

Optional transparent interaction width around the visible path.

### `property x6-canvas.CanvasEdgePresentation.labels?: readonly CanvasEdgeLabelPresentation[]`

Optional labels rendered along the path.

### `property x6-canvas.CanvasEdgePresentation.line?: CanvasEdgeLinePresentation`

Optional line treatment.

### `property x6-canvas.CanvasEdgePresentation.zIndex?: number`

Optional layer used only for presentation ordering.

### `interface x6-canvas.CanvasEdgeRenderContext`

Context delivered to a consumer-supplied edge presenter.

### `property x6-canvas.CanvasEdgeRenderContext.edge: CanvasEdge`

Complete immutable consumer-owned edge.

### `property x6-canvas.CanvasEdgeRenderContext.selected: boolean`

Whether the canvas currently selects this edge.

### `interface x6-canvas.CanvasEdgeTerminal`

Consumer-owned endpoint of a rendered edge.

### `property x6-canvas.CanvasEdgeTerminal.nodeId: string`

Stable identity of the endpoint node.

### `property x6-canvas.CanvasEdgeTerminal.portId?: string`

Optional port identity defined by the endpoint node view.

### `interface x6-canvas.CanvasEdgeViewDefinition`

Consumer-supplied edge renderer registered for one canvas instance.

### `property x6-canvas.CanvasEdgeViewDefinition.id: string`

Stable identifier referenced by `CanvasEdge.view`.

### `method x6-canvas.CanvasEdgeViewDefinition.present(context: CanvasEdgeRenderContext): CanvasEdgePresentation`

Projects product data and selection into a vendor-neutral edge presentation.

### `interface x6-canvas.CanvasEntityReference`

Stable reference to one caller-owned entity rendered on the canvas.

### `property x6-canvas.CanvasEntityReference.id: string`

Stable caller-owned identifier preserved by the adapter.

### `property x6-canvas.CanvasEntityReference.kind: "node" | "edge"`

Kind of rendered entity referenced by the caller-owned identifier.

### `interface x6-canvas.CanvasGridPresentation`

Optional grid rendered by the canvas surface.

### `property x6-canvas.CanvasGridPresentation.color?: string`

Grid color.

### `property x6-canvas.CanvasGridPresentation.kind: "dot" | "mesh"`

Grid geometry.

### `property x6-canvas.CanvasGridPresentation.size: number`

Distance between grid marks in CSS pixels.

### `property x6-canvas.CanvasGridPresentation.thickness?: number`

Grid mark or line thickness.

### `interface x6-canvas.CanvasInteractionOptions`

Consumer-owned interaction policy for a read-only canvas.

### `property x6-canvas.CanvasInteractionOptions.clickThreshold?: number`

Movement tolerance that separates activation from panning.

### `property x6-canvas.CanvasInteractionOptions.movableNodes?: boolean`

Whether users may reposition nodes locally without changing graph structure or caller data.

### `property x6-canvas.CanvasInteractionOptions.panning?: boolean`

Whether ordinary primary-button dragging pans the surface.

### `property x6-canvas.CanvasInteractionOptions.selectOnActivate?: boolean`

Whether activation also selects the activated entity.

### `property x6-canvas.CanvasInteractionOptions.zoom?: false | CanvasZoomOptions`

Optional wheel zoom behavior, or `false` to disable it.

### `interface x6-canvas.CanvasNode`

Immutable presentation data for one canvas node.

### `property x6-canvas.CanvasNode.data?: unknown`

Opaque consumer-owned data delivered unchanged to the selected node view.

### `property x6-canvas.CanvasNode.height?: number`

Optional rendered height in CSS pixels.

### `property x6-canvas.CanvasNode.id: string`

Stable caller-owned identity preserved by the adapter.

### `property x6-canvas.CanvasNode.ports?: readonly CanvasPortDefinition[]`

Optional per-node port replacement for the selected view defaults.

### `property x6-canvas.CanvasNode.view: string`

Identifier of a node view supplied in the canvas options.

### `property x6-canvas.CanvasNode.width?: number`

Optional rendered width in CSS pixels.

### `property x6-canvas.CanvasNode.x: number`

Horizontal presentation coordinate supplied by the caller.

### `property x6-canvas.CanvasNode.y: number`

Vertical presentation coordinate supplied by the caller.

### `property x6-canvas.CanvasNode.zIndex?: number`

Optional layer used only for presentation ordering.

### `interface x6-canvas.CanvasNodeRenderContext`

Context delivered to a consumer-supplied node mount.

### `property x6-canvas.CanvasNodeRenderContext.node: CanvasNode`

Complete immutable consumer-owned node.

### `property x6-canvas.CanvasNodeRenderContext.selected: boolean`

Whether the canvas currently selects this node.

### `interface x6-canvas.CanvasNodeRenderHandle`

Lifecycle owned by a mounted consumer-supplied node view.

### `method x6-canvas.CanvasNodeRenderHandle.dispose(): void`

Releases every resource created by the mount.

### `method x6-canvas.CanvasNodeRenderHandle.update(context: CanvasNodeRenderContext): void`

Updates the mounted view after node data or selection changes.

### `interface x6-canvas.CanvasNodeViewDefinition`

Consumer-supplied node renderer registered for one canvas instance.

### `property x6-canvas.CanvasNodeViewDefinition.defaultHeight: number`

Default rendered height when a node does not override it.

### `property x6-canvas.CanvasNodeViewDefinition.defaultWidth: number`

Default rendered width when a node does not override it.

### `property x6-canvas.CanvasNodeViewDefinition.id: string`

Stable identifier referenced by `CanvasNode.view`.

### `property x6-canvas.CanvasNodeViewDefinition.ports?: readonly CanvasPortDefinition[]`

Optional replaceable connection ports shared by this view.

### `method x6-canvas.CanvasNodeViewDefinition.mount(host: HTMLElement, context: CanvasNodeRenderContext): CanvasNodeRenderHandle`

Mounts any DOM-based implementation without exposing its UI runtime.

### `interface x6-canvas.CanvasPortDefinition`

Consumer-owned connection point exposed by a node view.

### `property x6-canvas.CanvasPortDefinition.id: string`

Stable identifier referenced by edge terminals.

### `property x6-canvas.CanvasPortDefinition.magnet?: boolean`

Whether the port may participate in future editable connections.

### `property x6-canvas.CanvasPortDefinition.position: CanvasPortPosition`

Boundary side or custom position of the port.

### `property x6-canvas.CanvasPortDefinition.presentation?: CanvasPortPresentation`

Optional visible treatment; omitted ports remain technically available.

### `interface x6-canvas.CanvasPortPresentation`

Optional product-supplied appearance of a visible connection port.

### `property x6-canvas.CanvasPortPresentation.fill?: string`

Fill color understood by the browser.

### `property x6-canvas.CanvasPortPresentation.opacity?: number`

Opacity from zero to one.

### `property x6-canvas.CanvasPortPresentation.radius?: number`

Radius in CSS pixels.

### `property x6-canvas.CanvasPortPresentation.stroke?: string`

Stroke color understood by the browser.

### `property x6-canvas.CanvasPortPresentation.strokeWidth?: number`

Stroke width in CSS pixels.

### `interface x6-canvas.CanvasSurfacePresentation`

Consumer-owned canvas background and grid treatment.

### `property x6-canvas.CanvasSurfacePresentation.backgroundColor?: string`

Optional background color; omission leaves the surface transparent.

### `property x6-canvas.CanvasSurfacePresentation.grid?: false | CanvasGridPresentation`

Optional grid, or `false` to suppress it explicitly.

### `interface x6-canvas.CanvasViewportOptions`

Consumer-owned fit-to-content behavior.

### `property x6-canvas.CanvasViewportOptions.fitOnCreate?: boolean`

Whether content is fit and centered when the canvas is created.

### `property x6-canvas.CanvasViewportOptions.maxScale?: number`

Maximum scale used by fit and `center` operations.

### `property x6-canvas.CanvasViewportOptions.padding?: number`

Padding used by fit and `center` operations.

### `interface x6-canvas.CanvasZoomOptions`

Consumer-owned wheel zoom behavior.

### `property x6-canvas.CanvasZoomOptions.factor?: number`

Multiplicative zoom factor.

### `property x6-canvas.CanvasZoomOptions.maxScale?: number`

Maximum permitted scale.

### `property x6-canvas.CanvasZoomOptions.minScale?: number`

Minimum permitted scale.

### `property x6-canvas.CanvasZoomOptions.modifiers?: readonly CanvasInteractionModifier[]`

Required modifier keys; an empty list permits an unmodified wheel.

### `interface x6-canvas.ReadOnlyCanvas`

Read-only controls returned to a canvas consumer.

### `property x6-canvas.ReadOnlyCanvas.edgeCount: number`

Number of edges supplied when the canvas was created.

### `property x6-canvas.ReadOnlyCanvas.nodeCount: number`

Number of nodes supplied when the canvas was created.

### `method x6-canvas.ReadOnlyCanvas.center(): void`

Fits and centers the current rendered content in the viewport.

### `method x6-canvas.ReadOnlyCanvas.dispose(): void`

Releases the canvas resources owned by this adapter instance.

### `method x6-canvas.ReadOnlyCanvas.setSelection(selection: CanvasEntityReference | null): void`

Selects one rendered entity by its caller-owned identity, or clears the selection.

### `interface x6-canvas.ReadOnlyCanvasOptions`

Composition and optional read-only callbacks for a canvas instance.

### `property x6-canvas.ReadOnlyCanvasOptions.edgeViews?: readonly CanvasEdgeViewDefinition[]`

Edge presenters available to this canvas instance.

### `property x6-canvas.ReadOnlyCanvasOptions.interaction?: CanvasInteractionOptions`

Optional replaceable interaction policy.

### `property x6-canvas.ReadOnlyCanvasOptions.nodeViews: readonly CanvasNodeViewDefinition[]`

Node view implementations available to this canvas instance.

### `property x6-canvas.ReadOnlyCanvasOptions.onActivate?: (entity: CanvasEntityReference) => void`

Receives an immutable entity reference when a rendered entity is activated.

### `property x6-canvas.ReadOnlyCanvasOptions.surface?: CanvasSurfacePresentation`

Optional background and grid treatment.

### `property x6-canvas.ReadOnlyCanvasOptions.viewport?: CanvasViewportOptions`

Optional replaceable fit-to-content behavior.

### `type x6-canvas.CanvasEdgeConnector = { kind: "straight" } | { direction?: "horizontal" | "vertical"; kind: "smooth" } | { kind: "rounded"; radius?: number }`

Connector geometry selected by a consumer without exposing X6 names.

### `type x6-canvas.CanvasInteractionModifier = "control" | "meta" | "alt" | "shift"`

Modifier used by the optional canvas zoom interaction.

### `type x6-canvas.CanvasPortPosition = "top" | "right" | "bottom" | "left" | { x: number; y: number }`

Immutable position for a connection port around a node boundary.

### `function x6-canvas.createReadOnlyCanvas(container: HTMLElement, nodes: readonly CanvasNode[], edges: readonly CanvasEdge[], options: ReadOnlyCanvasOptions): ReadOnlyCanvas`

Creates a non-editable graph canvas from caller-owned presentation data.

The adapter preserves identifiers and coordinates, mounts consumer-supplied
views, and never exposes the mutable vendor graph. Graph layout remains an
explicit upstream computation.
