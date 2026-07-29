import { Graph, type EventArgs } from "@antv/x6";
import { createReadOnlyCanvasHandle } from "./internal/read-only-canvas.js";
import {
  setX6NodeSelection,
  toX6EdgeMetadata,
  toX6NodeMetadata,
  toX6ReadOnlyInteractionOptions,
  X6_EDGE_SELECTION_HIGHLIGHT,
} from "./internal/visual-style.js";

/** Generic visual role for a canvas node, independent of the rendering vendor. */
export type CanvasNodeRole = "group" | "item" | "note";

/** Generic visual role for a canvas relation, independent of connector names. */
export type CanvasEdgeRole = "hierarchy" | "dependency" | "reference";

/** Immutable presentation data for one canvas node. */
export interface CanvasNode {
  /** Stable caller-owned identity preserved by the adapter. */
  readonly id: string;
  /** Human-readable text rendered inside the node. */
  readonly label: string;
  /** Optional secondary text rendered beneath the main node label. */
  readonly caption?: string;
  /** Optional generic role used to select a reusable node treatment. */
  readonly role?: CanvasNodeRole;
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
  /** Optional generic role used to select a reusable relation treatment. */
  readonly role?: CanvasEdgeRole;
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

  const setCellHighlight = (cellId: string, highlighted: boolean) => {
    const cell = graph.getCellById(cellId);
    if (cell === null) return;

    const view = graph.findViewByCell(cell);
    if (view === null) return;

    if (cell.isNode()) {
      setX6NodeSelection(view, highlighted);
    } else if (highlighted) {
      view.highlight(undefined, X6_EDGE_SELECTION_HIGHLIGHT);
    } else {
      view.unhighlight(undefined, X6_EDGE_SELECTION_HIGHLIGHT);
    }
  };

  const clearSelection = () => {
    if (selectedCellId !== undefined) {
      setCellHighlight(selectedCellId, false);
      selectedCellId = undefined;
    }
  };

  return {
    centerContent: () => {
      graph.zoomToFit({ padding: 64, maxScale: 1 });
      graph.centerContent();
    },
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

      setCellHighlight(selection.id, true);
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
    ...toX6ReadOnlyInteractionOptions(),
    autoResize: true,
    background: { color: "#f8fafc" },
    grid: {
      visible: true,
      type: "dot",
      size: 16,
      args: { color: "#cbd5e1", thickness: 1 },
    },
    mousewheel: {
      enabled: true,
      modifiers: ["ctrl", "meta"],
      factor: 1.08,
      minScale: 0.3,
      maxScale: 2.4,
    },
  });

  graph.fromJSON({
    nodes: nodes.map(toX6NodeMetadata),
    edges: edges.map(toX6EdgeMetadata),
  });
  graph.zoomToFit({ padding: 64, maxScale: 1 });
  graph.centerContent();

  return createReadOnlyCanvasHandle(
    createCanvasController(graph),
    nodes.length,
    edges.length,
    options.onActivate,
  );
}
