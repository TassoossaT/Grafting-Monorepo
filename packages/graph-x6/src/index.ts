import { createReadOnlyCanvas, type ReadOnlyCanvas } from "@grafting/x6-canvas";
import { toCanvasModel, type GraphIrCandidate } from "./model.js";

export type { GraphIrCandidate, GraphIrEdge, GraphIrNode } from "./model.js";

export function renderGraphIr(container: HTMLElement, ir: GraphIrCandidate): ReadOnlyCanvas {
  if (ir.schemaVersion !== "0.1-spike") {
    throw new Error(`unsupported Graph IR candidate version: ${String(ir.schemaVersion)}`);
  }
  const model = toCanvasModel(ir);
  return createReadOnlyCanvas(container, model.nodes, model.edges);
}
