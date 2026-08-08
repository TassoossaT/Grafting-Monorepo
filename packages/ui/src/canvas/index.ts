import { createCanvasAdapter } from "./graph/create-canvas.js";
import type { GeometryCanvas, GeometryCanvasOptions } from "./geometry/contracts.js";
import { createGeometryCanvasAdapter } from "./geometry/create-geometry-canvas.js";
import type {
  CanvasEdge,
  CanvasHandle,
  CanvasNode,
  CanvasOptions,
} from "./graph/contracts.js";
import { createHeightfieldCanvasAdapter } from "./heightfield/create-heightfield-canvas.js";
import type {
  HeightfieldCanvas,
  HeightfieldCanvasOptions,
} from "./heightfield/contracts.js";

export type {
  CanvasConnectionDecision,
  CanvasConnectionEndpoint,
  CanvasConnectionRequest,
  CanvasEdge,
  CanvasEdgeConnector,
  CanvasEdgeLabelPresentation,
  CanvasEdgeLinePresentation,
  CanvasEdgeMarkerPresentation,
  CanvasEdgePresentation,
  CanvasEdgeRenderContext,
  CanvasEdgeTerminal,
  CanvasEdgeViewDefinition,
  CanvasEditingOptions,
  CanvasEntityReference,
  CanvasGridPresentation,
  CanvasHandle,
  CanvasInteractionModifier,
  CanvasInteractionOptions,
  CanvasNode,
  CanvasNodeRenderContext,
  CanvasNodeRenderHandle,
  CanvasNodeViewDefinition,
  CanvasOptions,
  CanvasPortDefinition,
  CanvasPortDirection,
  CanvasPortPosition,
  CanvasPortPresentation,
  CanvasSurfacePresentation,
  CanvasViewportOptions,
  CanvasZoomOptions,
} from "./graph/contracts.js";
export type {
  HeightfieldCanvas,
  HeightfieldCanvasOptions,
} from "./heightfield/contracts.js";

/**
 * Creates a graph canvas from caller-owned presentation data.
 *
 * The UI boundary preserves identifiers and coordinates, mounts
 * consumer-supplied views, and keeps its rendering engine private. Graph
 * layout remains an explicit upstream computation.
 *
 * @param container - Browser element that owns the canvas surface.
 * @param nodes - Immutable node presentation data.
 * @param edges - Immutable connection presentation data.
 * @param options - Consumer-supplied views and replaceable presentation policy.
 * @returns A frozen Grafting-owned lifecycle handle.
 */
export function createCanvas(
  container: HTMLElement,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  options: CanvasOptions,
): CanvasHandle {
  return createCanvasAdapter(container, nodes, edges, options);
}

/**
 * Mounts a real-time heightfield preview while keeping the renderer private.
 *
 * @param container - Browser element that owns the rendered preview.
 * @param options - Grid data and replaceable presentation options.
 * @returns A Grafting-owned update, capture, and disposal handle.
 */
export function createHeightfieldCanvas(
  container: HTMLElement,
  options: HeightfieldCanvasOptions,
): HeightfieldCanvas {
  return createHeightfieldCanvasAdapter(container, options);
}

export type { GeometryCanvas, GeometryCanvasOptions } from "./geometry/contracts.js";

/**
 * Mounts a real-time preview of arbitrary triangle geometry, keeping the
 * renderer private.
 *
 * Separate from {@link createHeightfieldCanvas} rather than a mode of it: a
 * raster holds one height per point, and geometry off the lattice or with a
 * vertical step has more than one.
 *
 * @param container - Browser element that owns the rendered preview.
 * @param options - Geometry and replaceable presentation options.
 * @returns A Grafting-owned update, capture, and disposal handle.
 */
export function createGeometryCanvas(
  container: HTMLElement,
  options: GeometryCanvasOptions,
): GeometryCanvas {
  return createGeometryCanvasAdapter(container, options);
}
