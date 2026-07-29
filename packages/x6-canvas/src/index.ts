import { Graph, type EventArgs } from "@antv/x6";
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

/** Stable reference to one caller-owned entity rendered on the canvas. */
export interface CanvasEntityReference {
  /** Kind of rendered entity referenced by the caller-owned identifier. */
  readonly kind: "node" | "edge";
  /** Stable caller-owned identifier preserved by the adapter. */
  readonly id: string;
}

/** Optional read-only interaction callbacks for a canvas instance. */
export interface ReadOnlyCanvasOptions {
  /** Receives the immutable entity reference when a rendered entity is activated. */
  readonly onActivate?: (entity: CanvasEntityReference) => void;
}

/** Read-only controls returned to a canvas consumer. */
export interface ReadOnlyCanvas {
  /** Number of nodes supplied when the canvas was created. */
  readonly nodeCount: number;
  /** Number of edges supplied when the canvas was created. */
  readonly edgeCount: number;
  /** Centers the current rendered content in the viewport. */
  center(): void;
  /** Selects one rendered entity by its caller-owned identity, or clears the selection. */
  setSelection(selection: CanvasEntityReference | null): void;
  /** Releases the canvas resources owned by this adapter instance. */
  dispose(): void;
}

const createCanvasController = (graph: Graph) => {
  let selectedCellId: string | undefined;

  const clearSelection = () => {
    if (selectedCellId !== undefined) {
      graph.findViewByCell(selectedCellId)?.unhighlight();
      selectedCellId = undefined;
    }
  };

  return {
    centerContent: () => graph.centerContent(),
    setSelection: (selection: CanvasEntityReference | null) => {
      clearSelection();
      if (selection === null) return;

      const cell = graph.getCellById(selection.id);
      const matchesKind =
        cell !== null &&
        ((selection.kind === "node" && cell.isNode()) ||
          (selection.kind === "edge" && cell.isEdge()));
      if (!matchesKind) {
        throw new Error(`canvas ${selection.kind} was not found: ${selection.id}`);
      }

      const view = graph.findViewByCell(cell);
      if (view === null) {
        throw new Error(`canvas ${selection.kind} is not rendered: ${selection.id}`);
      }

      view.highlight();
      selectedCellId = selection.id;
    },
    subscribeActivation: (listener: (entity: CanvasEntityReference) => void) => {
      const onNodeClick = ({ node }: EventArgs["node:click"]) =>
        listener({ kind: "node", id: node.id });
      const onEdgeClick = ({ edge }: EventArgs["edge:click"]) =>
        listener({ kind: "edge", id: edge.id });

      graph.on("node:click", onNodeClick);
      graph.on("edge:click", onEdgeClick);

      return () => {
        graph.off("node:click", onNodeClick);
        graph.off("edge:click", onEdgeClick);
      };
    },
    dispose: () => {
      clearSelection();
      graph.dispose();
    },
  };
};

/**
 * Creates a non-editable graph canvas from caller-owned presentation data.
 *
 * This adapter preserves identifiers and coordinates; it does not calculate a
 * graph layout or expose the mutable vendor graph.
 *
 * @param container - Browser element that will own the rendered canvas.
 * @param nodes - Immutable node presentation data.
 * @param edges - Immutable edge presentation data.
 * @param options - Optional callbacks for read-only canvas interactions.
 * @returns A frozen Grafting-owned handle with read-only canvas operations.
 * @throws When the browser canvas cannot be initialized from the supplied data.
 */
export function createReadOnlyCanvas(
  container: HTMLElement,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  options: ReadOnlyCanvasOptions = {},
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

  return createReadOnlyCanvasHandle(
    createCanvasController(graph),
    nodes.length,
    edges.length,
    options.onActivate,
  );
}
