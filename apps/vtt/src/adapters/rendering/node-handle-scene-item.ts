import type { SceneItem, Transform } from "@grafting/render-3d";

import type { ConstructionPosition } from "@/ports";

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

export function nodeHandleTransform(position: ConstructionPosition): Transform {
  return { position, scale: 0.18 };
}

export function nodeHandleSceneItem(
  nodeId: string,
  position: ConstructionPosition,
): SceneItem<Record<string, never>> {
  return {
    id: nodeHandleSceneItemId(nodeId),
    layer: NODE_HANDLE_LAYER_ID,
    visual: { kind: NODE_HANDLE_VISUAL_KIND, params: {} },
    transform: nodeHandleTransform(position),
    data: Object.freeze({ entity: "construction-node-handle", nodeId }) satisfies NodeHandlePickData,
  };
}
