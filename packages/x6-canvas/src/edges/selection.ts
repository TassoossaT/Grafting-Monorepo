import type { Edge } from "@antv/x6";

import { applyEdgePresentation, type EdgeHostData } from "./presentation.js";

/** Reprojects an edge with the consumer presenter after selection changes. */
export function setEdgeSelection(edge: Edge, selected: boolean): boolean {
  const data = edge.getData<EdgeHostData>();
  if (
    typeof data !== "object" ||
    data === null ||
    typeof data.edge !== "object" ||
    data.edge === null ||
    typeof data.edge.id !== "string"
  ) {
    return false;
  }
  const next = Object.freeze({ ...data, selected });
  edge.setData(next);
  applyEdgePresentation(
    edge,
    data.definition.present(Object.freeze({ edge: data.edge, selected })),
  );
  return true;
}
