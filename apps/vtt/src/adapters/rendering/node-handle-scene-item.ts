import type { SceneItem, Transform } from "@grafting/render-3d";

import type { ConstructionPosition } from "@/ports";

export const NODE_HANDLE_LAYER_ID = "construction-handles";
export const NODE_HANDLE_VISUAL_KIND = "vtt-construction-node-handle";

/** Opaque per-item data a pick result echoes back, letting the adapter recover which node a hit handle belongs to without parsing its scene item id. */
export interface NodeHandlePickData {
  readonly entity: "construction-node-handle";
  readonly nodeId: string;
}

/** The handle's placeholder look; the visual registry decides what each state draws. */
export interface NodeHandleVisualParams {
  readonly highlighted: boolean;
}

export function nodeHandleSceneItemId(nodeId: string): string {
  return `construction-node-handle:${nodeId}`;
}

/** Screen-constant sizes (see render-3d's `screenConstant` sprite): about 16px, and larger under the pointer, at the table view's field of view. */
const HANDLE_SCALE = 0.014;
const HIGHLIGHTED_HANDLE_SCALE = 0.02;

export function nodeHandleTransform(position: ConstructionPosition, highlighted = false): Transform {
  return { position, scale: highlighted ? HIGHLIGHTED_HANDLE_SCALE : HANDLE_SCALE };
}

export function nodeHandleSceneItem(
  nodeId: string,
  position: ConstructionPosition,
  highlighted = false,
): SceneItem<NodeHandleVisualParams> {
  return {
    id: nodeHandleSceneItemId(nodeId),
    layer: NODE_HANDLE_LAYER_ID,
    visual: { kind: NODE_HANDLE_VISUAL_KIND, params: { highlighted } },
    transform: nodeHandleTransform(position, highlighted),
    data: Object.freeze({ entity: "construction-node-handle", nodeId }) satisfies NodeHandlePickData,
  };
}
