import type { CanvasEdge, CanvasEdgeViewDefinition } from "../index.js";
import { resolveCanvasView } from "../canvas/view-catalog.js";
import { toX6EdgePresentation } from "./presentation.js";

/** Converts a neutral edge into metadata for its consumer-supplied presenter. */
export function toX6EdgeMetadata(
  edge: CanvasEdge,
  catalog: ReadonlyMap<string, CanvasEdgeViewDefinition>,
) {
  const definition = resolveCanvasView("edge", catalog, edge.view);
  const presentation = definition.present(Object.freeze({ edge, selected: false }));
  const mapped = toX6EdgePresentation(presentation);
  return {
    id: edge.id,
    source: { cell: edge.source.nodeId, port: edge.source.portId },
    target: { cell: edge.target.nodeId, port: edge.target.portId },
    data: Object.freeze({ edge, definition, selected: false }),
    ...mapped,
  };
}
