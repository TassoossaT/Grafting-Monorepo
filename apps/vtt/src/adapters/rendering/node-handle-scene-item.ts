import type { SceneItem, Transform } from "@grafting/render-3d";

import type { ConstructionPosition, RenderHandleGlyph } from "@/ports";

export const NODE_HANDLE_LAYER_ID = "construction-handles";
export const NODE_HANDLE_VISUAL_KIND = "vtt-construction-node-handle";

/** Opaque per-item data a pick result echoes back, letting the adapter recover which node a hit handle belongs to without parsing its scene item id. */
export interface NodeHandlePickData {
  readonly entity: "construction-node-handle";
  readonly nodeId: string;
}

export function nodeHandleSceneItemId(nodeId: string): string {
  return `construction-node-handle:${nodeId}`;
}

/** Large enough to stay a comfortable pointer/touch target at typical table-view camera distances, small enough not to obscure the geometry it marks. */
const HANDLE_SCALE = 0.32;
/** A control for a whole structure reads a little larger than a point on it. */
const GLYPH_SCALE = 0.44;

export interface NodeHandleVisualParams {
  readonly glyph: RenderHandleGlyph;
}

export function nodeHandleTransform(position: ConstructionPosition, glyph: RenderHandleGlyph = "point"): Transform {
  return { position, scale: glyph === "point" ? HANDLE_SCALE : GLYPH_SCALE };
}

export function nodeHandleSceneItem(
  nodeId: string,
  position: ConstructionPosition,
  glyph: RenderHandleGlyph = "point",
): SceneItem<NodeHandleVisualParams> {
  return {
    id: nodeHandleSceneItemId(nodeId),
    layer: NODE_HANDLE_LAYER_ID,
    visual: { kind: NODE_HANDLE_VISUAL_KIND, params: { glyph } },
    transform: nodeHandleTransform(position, glyph),
    data: Object.freeze({ entity: "construction-node-handle", nodeId }) satisfies NodeHandlePickData,
  };
}
