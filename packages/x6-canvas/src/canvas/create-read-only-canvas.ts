import { Graph } from "@antv/x6";

import type {
  CanvasEdge,
  CanvasNode,
  CanvasSurfacePresentation,
  ReadOnlyCanvas,
  ReadOnlyCanvasOptions,
} from "../index.js";
import { toX6EdgeMetadata } from "../edges/metadata.js";
import { toX6NodeMetadata } from "../nodes/metadata.js";
import { ensureNodeHostRegistered } from "../nodes/registry.js";
import { createCanvasController } from "./controller.js";
import { createReadOnlyCanvasHandle } from "./handle.js";
import { toX6ReadOnlyInteractionOptions } from "./interaction-options.js";
import { createEdgeViewCatalog, createNodeViewCatalog } from "./view-catalog.js";

const toX6SurfaceOptions = (surface: CanvasSurfacePresentation | undefined) => ({
  ...(surface?.backgroundColor === undefined
    ? {}
    : { background: { color: surface.backgroundColor } }),
  ...(surface?.grid === undefined || surface.grid === false
    ? { grid: { visible: false } }
    : {
        grid: {
          visible: true,
          type: surface.grid.kind,
          size: surface.grid.size,
          args: {
            color: surface.grid.color,
            thickness: surface.grid.thickness,
          },
        },
      }),
});

/** Creates the private X6 graph and exposes only the immutable public handle. */
export function createReadOnlyCanvasAdapter(
  container: HTMLElement,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  options: ReadOnlyCanvasOptions,
): ReadOnlyCanvas {
  ensureNodeHostRegistered();
  const nodeViews = createNodeViewCatalog(options.nodeViews);
  const edgeViews = createEdgeViewCatalog(options.edgeViews ?? []);
  const graph = new Graph({
    container,
    ...toX6ReadOnlyInteractionOptions(options.interaction),
    ...toX6SurfaceOptions(options.surface),
    autoResize: true,
  });

  graph.fromJSON({
    nodes: nodes.map((node) => toX6NodeMetadata(node, nodeViews)),
    edges: edges.map((edge) => toX6EdgeMetadata(edge, edgeViews)),
  });

  const controller = createCanvasController(graph, options.viewport);
  if (options.viewport?.fitOnCreate === true) controller.centerContent();

  return createReadOnlyCanvasHandle(
    controller,
    nodes.length,
    edges.length,
    options.onActivate,
    options.interaction?.selectOnActivate ?? false,
  );
}
