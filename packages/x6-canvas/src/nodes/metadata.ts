import type { CanvasNode, CanvasNodeViewDefinition } from "../index.js";
import { resolveCanvasView } from "../canvas/view-catalog.js";
import { createNodePorts } from "./ports.js";
import { X6_NODE_HOST_SHAPE } from "./shape.js";

/** Converts a neutral node into metadata for the private generic host. */
export function toX6NodeMetadata(
  node: CanvasNode,
  catalog: ReadonlyMap<string, CanvasNodeViewDefinition>,
) {
  const definition = resolveCanvasView("node", catalog, node.view);
  return {
    id: node.id,
    shape: X6_NODE_HOST_SHAPE,
    x: node.x,
    y: node.y,
    width: node.width ?? definition.defaultWidth,
    height: node.height ?? definition.defaultHeight,
    zIndex: node.zIndex,
    data: Object.freeze({ node, definition, selected: false }),
    ports: createNodePorts(node.ports ?? definition.ports ?? []),
  };
}
