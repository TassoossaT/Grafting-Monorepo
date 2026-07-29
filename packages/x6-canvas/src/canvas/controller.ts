import { type EventArgs, type Graph } from "@antv/x6";

import type { CanvasController } from "../contracts/canvas.js";
import type { CanvasEntityReference, CanvasViewportOptions } from "../index.js";
import { setEdgeSelection } from "../edges/selection.js";
import { setNodeSelection } from "../nodes/selection.js";

/** Adapts X6 lifecycle and events to the internal vendor-neutral controller. */
export function createCanvasController(
  graph: Graph,
  viewport: CanvasViewportOptions = {},
): CanvasController {
  let selectedCellId: string | undefined;

  const setCellSelection = (cellId: string, selected: boolean) => {
    const cell = graph.getCellById(cellId);
    if (cell === null) return;
    if (cell.isNode()) setNodeSelection(cell, selected);
    else if (cell.isEdge()) setEdgeSelection(cell, selected);
  };

  const clearSelection = () => {
    if (selectedCellId === undefined) return;
    setCellSelection(selectedCellId, false);
    selectedCellId = undefined;
  };

  return {
    centerContent: () => {
      graph.zoomToFit({ padding: viewport.padding ?? 0, maxScale: viewport.maxScale });
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
      if (graph.findViewByCell(cell) === null) {
        throw new Error(`canvas ${selection.kind} is not rendered: ${selection.id}`);
      }

      setCellSelection(selection.id, true);
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
}
