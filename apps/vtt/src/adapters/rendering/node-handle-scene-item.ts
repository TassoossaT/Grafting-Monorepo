import type { SceneItem, Transform } from "@grafting/render-3d";

import type { ConstructionPosition } from "@/ports";

export const NODE_HANDLE_LAYER_ID = "construction-handles";
export const NODE_HANDLE_VISUAL_KIND = "vtt-construction-node-handle";
export const NODE_HEIGHT_HANDLE_VISUAL_KIND = "vtt-construction-node-height-handle";
export const NODE_STEM_VISUAL_KIND = "vtt-construction-node-stem";
export const NODE_HANDLE_STEM_VISUAL_KIND = NODE_STEM_VISUAL_KIND;
export const HEIGHT_GIZMO_OFFSET_Y = 0.4;

/** Opaque per-item data a pick result echoes back, letting the adapter recover which node a hit handle belongs to without parsing its scene item id. */
export interface NodeHandlePickData {
  readonly entity: "construction-node-handle";
  readonly nodeId: string;
  readonly axis: "xz-planar" | "y-height";
}

export interface NodeStemVisualParams {
  readonly positions: Float32Array;
}

export function nodeHandleSceneItemId(nodeId: string): string {
  return `construction-node-handle:${nodeId}`;
}

export function nodeHeightHandleSceneItemId(nodeId: string): string {
  return `construction-node-handle-height:${nodeId}`;
}

export function nodeHandleStemSceneItemId(nodeId: string): string {
  return `construction-node-handle-stem:${nodeId}`;
}

/** Large enough to stay a comfortable pointer/touch target at typical table-view camera distances, small enough not to obscure the geometry it marks. */
const HANDLE_SCALE = 0.32;

export function nodeHandleTransform(position: ConstructionPosition): Transform {
  return { position, scale: HANDLE_SCALE };
}

export function nodeHeightHandleTransform(position: ConstructionPosition): Transform {
  return {
    position: {
      x: position.x,
      y: position.y + HEIGHT_GIZMO_OFFSET_Y,
      z: position.z,
    },
    scale: HANDLE_SCALE,
  };
}

export function nodeHandleStemPositions(
  position: ConstructionPosition,
  groundY: number = 0,
): Float32Array {
  void groundY;
  return new Float32Array([
    position.x,
    position.y,
    position.z,
    position.x,
    position.y + HEIGHT_GIZMO_OFFSET_Y,
    position.z,
  ]);
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
    data: Object.freeze({
      entity: "construction-node-handle",
      nodeId,
      axis: "xz-planar",
    }) satisfies NodeHandlePickData,
  };
}

export function nodeHeightHandleSceneItem(
  nodeId: string,
  position: ConstructionPosition,
): SceneItem<Record<string, never>> {
  return {
    id: nodeHeightHandleSceneItemId(nodeId),
    layer: NODE_HANDLE_LAYER_ID,
    visual: { kind: NODE_HEIGHT_HANDLE_VISUAL_KIND, params: {} },
    transform: nodeHeightHandleTransform(position),
    data: Object.freeze({
      entity: "construction-node-handle",
      nodeId,
      axis: "y-height",
    }) satisfies NodeHandlePickData,
  };
}

export function nodeHandleStemSceneItem(
  nodeId: string,
  position: ConstructionPosition,
  groundY: number = 0,
): SceneItem<NodeStemVisualParams> {
  return {
    id: nodeHandleStemSceneItemId(nodeId),
    layer: NODE_HANDLE_LAYER_ID,
    visual: {
      kind: NODE_STEM_VISUAL_KIND,
      params: { positions: nodeHandleStemPositions(position, groundY) },
    },
    transform: { position: { x: 0, y: 0, z: 0 } },
    data: Object.freeze({ entity: "construction-node-stem", nodeId }),
  };
}

export function nodeHeightGizmoSceneItems(
  nodeId: string,
  position: ConstructionPosition,
  groundY: number = 0,
): readonly [SceneItem<Record<string, never>>, SceneItem<NodeStemVisualParams>] {
  return [
    nodeHeightHandleSceneItem(nodeId, position),
    nodeHandleStemSceneItem(nodeId, position, groundY),
  ];
}
