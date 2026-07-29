import { Graph } from "@antv/x6";
import { createReadOnlyCanvasHandle } from "./internal/read-only-canvas.js";

/** Immutable presentation data for one canvas node. */
export interface CanvasNode {
  /** Stable caller-owned identity preserved by the adapter. */
  readonly id: string;
  /** Human-readable text rendered inside the node. */
  readonly label: string;
  /** Horizontal presentation coordinate supplied by the caller. */
  readonly x: number;
  /** Vertical presentation coordinate supplied by the caller. */
  readonly y: number;
  /** Optional rendered width in CSS pixels. */
  readonly width?: number;
  /** Optional rendered height in CSS pixels. */
  readonly height?: number;
  /** Optional CSS color used to fill the node body. */
  readonly color?: string;
}

/** Immutable presentation data for one directed canvas edge. */
export interface CanvasEdge {
  /** Stable caller-owned identity preserved by the adapter. */
  readonly id: string;
  /** Identity of the rendered source node. */
  readonly source: string;
  /** Identity of the rendered target node. */
  readonly target: string;
  /** Optional human-readable text rendered on the edge. */
  readonly label?: string;
}

/** Read-only controls returned to a canvas consumer. */
export interface ReadOnlyCanvas {
  /** Number of nodes supplied when the canvas was created. */
  readonly nodeCount: number;
  /** Number of edges supplied when the canvas was created. */
  readonly edgeCount: number;
  /** Centers the current rendered content in the viewport. */
  center(): void;
  /** Releases the canvas resources owned by this adapter instance. */
  dispose(): void;
}

/**
 * Creates a non-editable graph canvas from caller-owned presentation data.
 *
 * This adapter preserves identifiers and coordinates; it does not calculate a
 * graph layout or expose the mutable vendor graph.
 *
 * @param container - Browser element that will own the rendered canvas.
 * @param nodes - Immutable node presentation data.
 * @param edges - Immutable edge presentation data.
 * @returns A frozen Grafting-owned handle with read-only canvas operations.
 * @throws When the browser canvas cannot be initialized from the supplied data.
 */
export function createReadOnlyCanvas(
  container: HTMLElement,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): ReadOnlyCanvas {
  const graph = new Graph({
    container,
    background: { color: "#f7f9fc" },
    grid: { visible: true, size: 10 },
    interacting: false,
    panning: true,
    mousewheel: { enabled: true, modifiers: ["ctrl", "meta"], minScale: 0.35, maxScale: 2 },
  });

  graph.fromJSON({
    nodes: nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width ?? 220,
      height: node.height ?? 48,
      label: node.label,
      attrs: {
        body: { fill: node.color ?? "#ffffff", stroke: "#5b6b88", rx: 8, ry: 8 },
        label: { fill: "#172033", fontSize: 12 },
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      attrs: { line: { stroke: "#8795ad", targetMarker: "classic" } },
    })),
  });
  graph.centerContent();

  return createReadOnlyCanvasHandle(graph, nodes.length, edges.length);
}
