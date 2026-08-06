/** Immutable position for a connection port around a node boundary. */
export type CanvasPortPosition =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | { readonly x: number; readonly y: number };

/**
 * Role a port plays when a connection is drawn.
 *
 * `both` preserves the undirected behavior of ports that predate directional
 * authoring: such a port may act as either endpoint.
 */
export type CanvasPortDirection = "in" | "out" | "both";

/** Optional product-supplied appearance of a visible connection port. */
export interface CanvasPortPresentation {
  /** Radius in CSS pixels. */
  readonly radius?: number;
  /** Optional text rendered beside the port. */
  readonly label?: string;
  /** Color of the optional label; falls back to the port stroke. */
  readonly labelColor?: string;
  /** Font size of the optional label in CSS pixels. */
  readonly labelFontSize?: number;
  /** Fill color understood by the browser. */
  readonly fill?: string;
  /** Stroke color understood by the browser. */
  readonly stroke?: string;
  /** Stroke width in CSS pixels. */
  readonly strokeWidth?: number;
  /** Opacity from zero to one. */
  readonly opacity?: number;
}

/** Consumer-owned connection point exposed by a node view. */
export interface CanvasPortDefinition {
  /** Stable identifier referenced by edge terminals. */
  readonly id: string;
  /** Boundary side or custom position of the port. */
  readonly position: CanvasPortPosition;
  /**
   * Endpoint role used when a user draws a connection.
   * @default "both"
   */
  readonly direction?: CanvasPortDirection;
  /**
   * Opaque caller-owned value kind carried by this port.
   *
   * The canvas never interprets it; it is reported back to the consumer so a
   * product can decide whether two ports are compatible.
   */
  readonly dataType?: string;
  /**
   * Maximum number of connections this port accepts.
   *
   * Omit for no limit. A user-drawn connection that would exceed the limit is
   * refused before the consumer is consulted.
   */
  readonly capacity?: number;
  /** Whether the port may participate in user-drawn connections. */
  readonly magnet?: boolean;
  /** Optional visible treatment; omitted ports remain technically available. */
  readonly presentation?: CanvasPortPresentation;
}

/** Immutable presentation data for one canvas node. */
export interface CanvasNode {
  /** Stable caller-owned identity preserved by the adapter. */
  readonly id: string;
  /** Identifier of a node view supplied in the canvas options. */
  readonly view: string;
  /** Horizontal presentation coordinate supplied by the caller. */
  readonly x: number;
  /** Vertical presentation coordinate supplied by the caller. */
  readonly y: number;
  /** Optional rendered width in CSS pixels. */
  readonly width?: number;
  /** Optional rendered height in CSS pixels. */
  readonly height?: number;
  /** Optional layer used only for presentation ordering. */
  readonly zIndex?: number;
  /** Opaque consumer-owned data delivered unchanged to the selected node view. */
  readonly data?: unknown;
  /** Optional per-node port replacement for the selected view defaults. */
  readonly ports?: readonly CanvasPortDefinition[];
}

/** Context delivered to a consumer-supplied node mount. */
export interface CanvasNodeRenderContext {
  /** Complete immutable consumer-owned node. */
  readonly node: CanvasNode;
  /** Whether the canvas currently selects this node. */
  readonly selected: boolean;
}

/** Lifecycle owned by a mounted consumer-supplied node view. */
export interface CanvasNodeRenderHandle {
  /** Updates the mounted view after node data or selection changes. */
  update(context: CanvasNodeRenderContext): void;
  /** Releases every resource created by the mount. */
  dispose(): void;
}

/** Consumer-supplied node renderer registered for one canvas instance. */
export interface CanvasNodeViewDefinition {
  /** Stable identifier referenced by `CanvasNode.view`. */
  readonly id: string;
  /** Default rendered width when a node does not override it. */
  readonly defaultWidth: number;
  /** Default rendered height when a node does not override it. */
  readonly defaultHeight: number;
  /** Optional replaceable connection ports shared by this view. */
  readonly ports?: readonly CanvasPortDefinition[];
  /** Mounts any DOM-based implementation without exposing its UI runtime. */
  mount(host: HTMLElement, context: CanvasNodeRenderContext): CanvasNodeRenderHandle;
}

/** Consumer-owned endpoint of a rendered edge. */
export interface CanvasEdgeTerminal {
  /** Stable identity of the endpoint node. */
  readonly nodeId: string;
  /** Optional port identity defined by the endpoint node view. */
  readonly portId?: string;
}

/** Immutable presentation data for one directed canvas edge. */
export interface CanvasEdge {
  /** Stable caller-owned identity preserved by the adapter. */
  readonly id: string;
  /** Identifier of an edge view supplied in the canvas options. */
  readonly view: string;
  /** Source node and optional port. */
  readonly source: CanvasEdgeTerminal;
  /** Target node and optional port. */
  readonly target: CanvasEdgeTerminal;
  /** Opaque consumer-owned data delivered unchanged to the edge presenter. */
  readonly data?: unknown;
}

/** Connector geometry selected by a consumer without exposing renderer-specific names. */
export type CanvasEdgeConnector =
  | { readonly kind: "straight" }
  | {
      readonly kind: "smooth";
      readonly direction?: "horizontal" | "vertical";
    }
  | { readonly kind: "rounded"; readonly radius?: number };

/** Optional marker rendered at one end of an edge. */
export interface CanvasEdgeMarkerPresentation {
  /** Marker geometry, or `none` to suppress it explicitly. */
  readonly kind: "none" | "block" | "classic";
  /** Marker width in CSS pixels. */
  readonly width?: number;
  /** Marker height in CSS pixels. */
  readonly height?: number;
  /** Marker fill color. */
  readonly fill?: string;
  /** Marker stroke color. */
  readonly stroke?: string;
}

/** Product-supplied appearance of the rendered edge path. */
export interface CanvasEdgeLinePresentation {
  /** Stroke color. */
  readonly color?: string;
  /** Stroke width in CSS pixels. */
  readonly width?: number;
  /** SVG dash pattern. */
  readonly dash?: string;
  /** Stroke opacity from zero to one. */
  readonly opacity?: number;
  /** Optional product CSS class used for effects and animation. */
  readonly className?: string;
  /** Optional SVG attributes that are not already represented above. */
  readonly attributes?: Readonly<Record<string, string | number>>;
  /** Optional source marker. */
  readonly sourceMarker?: CanvasEdgeMarkerPresentation;
  /** Optional target marker. */
  readonly targetMarker?: CanvasEdgeMarkerPresentation;
}

/** Product-supplied label rendered along an edge. */
export interface CanvasEdgeLabelPresentation {
  /** Human-readable text. */
  readonly text: string;
  /** Relative position from zero at the source to one at the target. */
  readonly position?: number;
  /** Text color. */
  readonly color?: string;
  /** Font size in CSS pixels. */
  readonly fontSize?: number;
  /** Numeric font weight. */
  readonly fontWeight?: number;
  /** Label background color. */
  readonly backgroundColor?: string;
  /** Label boundary color. */
  readonly borderColor?: string;
  /** Rounded-corner radius in CSS pixels. */
  readonly borderRadius?: number;
  /** Optional product CSS class used for effects and typography. */
  readonly className?: string;
}

/** Complete consumer-owned visual projection for an edge. */
export interface CanvasEdgePresentation {
  /** Optional path geometry; omitted values use the adapter's neutral default. */
  readonly connector?: CanvasEdgeConnector;
  /** Optional line treatment. */
  readonly line?: CanvasEdgeLinePresentation;
  /** Optional labels rendered along the path. */
  readonly labels?: readonly CanvasEdgeLabelPresentation[];
  /** Optional transparent interaction width around the visible path. */
  readonly hitAreaWidth?: number;
  /** Optional layer used only for presentation ordering. */
  readonly zIndex?: number;
}

/** Context delivered to a consumer-supplied edge presenter. */
export interface CanvasEdgeRenderContext {
  /** Complete immutable consumer-owned edge. */
  readonly edge: CanvasEdge;
  /** Whether the canvas currently selects this edge. */
  readonly selected: boolean;
}

/** Consumer-supplied edge renderer registered for one canvas instance. */
export interface CanvasEdgeViewDefinition {
  /** Stable identifier referenced by `CanvasEdge.view`. */
  readonly id: string;
  /** Projects product data and selection into a vendor-neutral edge presentation. */
  present(context: CanvasEdgeRenderContext): CanvasEdgePresentation;
}

/** Stable reference to one caller-owned entity rendered on the canvas. */
export interface CanvasEntityReference {
  /** Kind of rendered entity referenced by the caller-owned identifier. */
  readonly kind: "node" | "edge";
  /** Stable caller-owned identifier preserved by the adapter. */
  readonly id: string;
}

/** Optional grid rendered by the canvas surface. */
export interface CanvasGridPresentation {
  /** Grid geometry. */
  readonly kind: "dot" | "mesh";
  /** Distance between grid marks in CSS pixels. */
  readonly size: number;
  /** Grid color. */
  readonly color?: string;
  /** Grid mark or line thickness. */
  readonly thickness?: number;
}

/** Consumer-owned canvas background and grid treatment. */
export interface CanvasSurfacePresentation {
  /** Optional background color; omission leaves the surface transparent. */
  readonly backgroundColor?: string;
  /** Optional grid, or `false` to suppress it explicitly. */
  readonly grid?: CanvasGridPresentation | false;
}

/** Modifier used by the optional canvas zoom interaction. */
export type CanvasInteractionModifier = "control" | "meta" | "alt" | "shift";

/** Consumer-owned wheel zoom behavior. */
export interface CanvasZoomOptions {
  /** Required modifier keys; an empty list permits an unmodified wheel. */
  readonly modifiers?: readonly CanvasInteractionModifier[];
  /** Multiplicative zoom factor. */
  readonly factor?: number;
  /** Minimum permitted scale. */
  readonly minScale?: number;
  /** Maximum permitted scale. */
  readonly maxScale?: number;
}

/** Consumer-owned interaction policy for a read-only canvas. */
export interface CanvasInteractionOptions {
  /** Whether ordinary primary-button dragging pans the surface. */
  readonly panning?: boolean;
  /** Whether users may reposition nodes locally without changing graph structure or caller data. */
  readonly movableNodes?: boolean;
  /** Movement tolerance that separates activation from panning. */
  readonly clickThreshold?: number;
  /** Optional wheel zoom behavior, or `false` to disable it. */
  readonly zoom?: CanvasZoomOptions | false;
  /** Whether activation also selects the activated entity. */
  readonly selectOnActivate?: boolean;
}

/** Consumer-owned fit-to-content behavior. */
export interface CanvasViewportOptions {
  /** Whether content is fit and centered when the canvas is created. */
  readonly fitOnCreate?: boolean;
  /** Padding used by fit and `center` operations. */
  readonly padding?: number;
  /** Maximum scale used by fit and `center` operations. */
  readonly maxScale?: number;
}

/** One endpoint of a connection a user is attempting to draw. */
export interface CanvasConnectionEndpoint {
  /** Stable identity of the endpoint node. */
  readonly nodeId: string;
  /** Identity of the port under the pointer. */
  readonly portId: string;
  /** The port's opaque caller-owned value kind, when it declares one. */
  readonly dataType?: string;
}

/** A user-drawn connection awaiting a consumer's compatibility decision. */
export interface CanvasConnectionRequest {
  /** Endpoint the connection was drawn from. */
  readonly source: CanvasConnectionEndpoint;
  /** Endpoint the connection was dropped on. */
  readonly target: CanvasConnectionEndpoint;
}

/**
 * A consumer's answer to a connection request.
 *
 * Accepting requires supplying the new edge, because identity, view selection,
 * and edge data are caller-owned and the canvas cannot invent them.
 */
export type CanvasConnectionDecision =
  | { readonly accepted: false; readonly reason?: string }
  | { readonly accepted: true; readonly edge: CanvasEdge };

/**
 * Consumer-owned authoring policy.
 *
 * Omitting this whole option leaves the surface read-only to users; the
 * programmatic mutation methods on {@link CanvasHandle} remain available
 * regardless, since those are the caller acting on its own data.
 */
export interface CanvasEditingOptions {
  /** Whether users may draw new connections between ports. */
  readonly connectable?: boolean;
  /** Whether users may remove an existing connection by activating it with the removal gesture. */
  readonly removableEdges?: boolean;
  /**
   * Decides whether a user-drawn connection is allowed, and supplies the edge.
   *
   * The canvas has already verified direction, capacity, self-connection, and
   * duplicate endpoints before calling this. Omitting it refuses every
   * user-drawn connection, because only a product knows whether two value
   * kinds are compatible.
   */
  readonly onConnectRequest?: (request: CanvasConnectionRequest) => CanvasConnectionDecision;
  /** Receives the accepted edge once it has been added to the surface. */
  readonly onConnected?: (edge: CanvasEdge) => void;
  /** Receives the identity of a connection removed by a user. */
  readonly onDisconnected?: (edgeId: string) => void;
  /** Receives a node's new coordinates after a user finishes moving it. */
  readonly onNodeMoved?: (nodeId: string, x: number, y: number) => void;
}

/** Composition and optional read-only callbacks for a canvas instance. */
export interface CanvasOptions {
  /** Node view implementations available to this canvas instance. */
  readonly nodeViews: readonly CanvasNodeViewDefinition[];
  /** Edge presenters available to this canvas instance. */
  readonly edgeViews?: readonly CanvasEdgeViewDefinition[];
  /** Optional background and grid treatment. */
  readonly surface?: CanvasSurfacePresentation;
  /** Optional replaceable interaction policy. */
  readonly interaction?: CanvasInteractionOptions;
  /** Optional replaceable fit-to-content behavior. */
  readonly viewport?: CanvasViewportOptions;
  /** Optional authoring policy; omission leaves the surface read-only to users. */
  readonly editing?: CanvasEditingOptions;
  /** Receives an immutable entity reference when a rendered entity is activated. */
  readonly onActivate?: (entity: CanvasEntityReference) => void;
}

/** Controls returned to a canvas consumer. */
export interface CanvasHandle {
  /** Number of nodes currently rendered. */
  readonly nodeCount: number;
  /** Number of edges currently rendered. */
  readonly edgeCount: number;
  /** Fits and centers the current rendered content in the viewport. */
  center(): void;
  /**
   * Changes the current viewport scale by a multiplicative factor.
   *
   * Values above one zoom in and values below one zoom out. The result is
   * clamped to the canvas zoom limits around the viewport center.
   *
   * @throws If `factor` is not a finite positive number.
   */
  zoomBy(factor: number): void;
  /** Restores the viewport to 100% scale around its center. */
  resetZoom(): void;
  /** Selects one rendered entity by its caller-owned identity, or clears the selection. */
  setSelection(selection: CanvasEntityReference | null): void;
  /**
   * Adds one caller-owned node.
   *
   * @throws If the identifier is already rendered or the view is not registered.
   */
  addNode(node: CanvasNode): void;
  /**
   * Replaces one rendered node's data, coordinates, and ports in place.
   *
   * The node keeps its identity and its connections, so this is how a product
   * applies a changed parameter without rebuilding the surface.
   *
   * @throws If the identifier is not rendered or the view is not registered.
   */
  updateNode(node: CanvasNode): void;
  /**
   * Removes one node and every edge attached to it.
   *
   * @throws If the identifier is not rendered.
   */
  removeNode(nodeId: string): void;
  /**
   * Adds one caller-owned edge between two rendered ports.
   *
   * @throws If the identifier is already rendered, an endpoint is missing, or
   * the view is not registered.
   */
  addEdge(edge: CanvasEdge): void;
  /**
   * Removes one edge.
   *
   * @throws If the identifier is not rendered.
   */
  removeEdge(edgeId: string): void;
  /** Releases the canvas resources owned by this adapter instance. */
  dispose(): void;
}

