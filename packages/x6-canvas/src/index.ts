import { createReadOnlyCanvasAdapter } from "./canvas/create-read-only-canvas.js";

/** Immutable position for a connection port around a node boundary. */
export type CanvasPortPosition =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | { readonly x: number; readonly y: number };

/** Optional product-supplied appearance of a visible connection port. */
export interface CanvasPortPresentation {
  /** Radius in CSS pixels. */
  readonly radius?: number;
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
  /** Whether the port may participate in future editable connections. */
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

/** Connector geometry selected by a consumer without exposing X6 names. */
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

/** Composition and optional read-only callbacks for a canvas instance. */
export interface ReadOnlyCanvasOptions {
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
  /** Receives an immutable entity reference when a rendered entity is activated. */
  readonly onActivate?: (entity: CanvasEntityReference) => void;
}

/** Read-only controls returned to a canvas consumer. */
export interface ReadOnlyCanvas {
  /** Number of nodes supplied when the canvas was created. */
  readonly nodeCount: number;
  /** Number of edges supplied when the canvas was created. */
  readonly edgeCount: number;
  /** Fits and centers the current rendered content in the viewport. */
  center(): void;
  /** Selects one rendered entity by its caller-owned identity, or clears the selection. */
  setSelection(selection: CanvasEntityReference | null): void;
  /** Releases the canvas resources owned by this adapter instance. */
  dispose(): void;
}

/**
 * Creates a non-editable graph canvas from caller-owned presentation data.
 *
 * The adapter preserves identifiers and coordinates, mounts consumer-supplied
 * views, and never exposes the mutable vendor graph. Graph layout remains an
 * explicit upstream computation.
 *
 * @param container - Browser element that will own the rendered canvas.
 * @param nodes - Immutable node presentation data.
 * @param edges - Immutable edge presentation data.
 * @param options - Consumer-supplied views and replaceable presentation policy.
 * @returns A frozen Grafting-owned handle with read-only canvas operations.
 * @throws When a referenced view is absent, identifiers collide, or the browser canvas cannot initialize.
 */
export function createReadOnlyCanvas(
  container: HTMLElement,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  options: ReadOnlyCanvasOptions,
): ReadOnlyCanvas {
  return createReadOnlyCanvasAdapter(container, nodes, edges, options);
}
