import type { SceneItem, Transform } from "@grafting/render-3d";

import type { ConstructionPosition } from "@/ports";

export const NODE_HANDLE_LAYER_ID = "construction-handles";
export const NODE_HANDLE_VISUAL_KIND = "vtt-construction-node-handle";
export const HEIGHT_GIZMO_VISUAL_KIND = "vtt-construction-height-gizmo";
export const HEIGHT_GIZMO_STEM_VISUAL_KIND = "vtt-construction-height-stem";

export type GizmoAxis = "y-height" | "xz-planar" | "all";

/** Opaque per-item data a pick result echoes back, letting the adapter recover which node a hit handle belongs to without parsing its scene item id. */
export interface NodeHandlePickData {
  readonly entity: "construction-node-handle";
  readonly nodeId: string;
  readonly axis?: GizmoAxis;
}

export function nodeHandleSceneItemId(nodeId: string): string {
  return `construction-node-handle:${nodeId}`;
}

export function heightGizmoSceneItemId(nodeId: string): string {
  return `construction-height-gizmo:${nodeId}`;
}

export function heightGizmoStemSceneItemId(nodeId: string): string {
  return `construction-height-stem:${nodeId}`;
}

/** Large enough to stay a comfortable pointer/touch target at typical table-view camera distances, small enough not to obscure the geometry it marks. */
const HANDLE_SCALE = 0.32;
const HEIGHT_GIZMO_SCALE = 0.34;
export const HEIGHT_GIZMO_OFFSET_Y = 1.25;

export function nodeHandleTransform(position: ConstructionPosition): Transform {
  return { position, scale: HANDLE_SCALE };
}

export function heightGizmoTransform(position: ConstructionPosition): Transform {
  return {
    position: { x: position.x, y: position.y + HEIGHT_GIZMO_OFFSET_Y, z: position.z },
    scale: HEIGHT_GIZMO_SCALE,
  };
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

export function heightGizmoSceneItem(
  nodeId: string,
  position: ConstructionPosition,
): SceneItem<Record<string, never>> {
  return {
    id: heightGizmoSceneItemId(nodeId),
    layer: NODE_HANDLE_LAYER_ID,
    visual: { kind: HEIGHT_GIZMO_VISUAL_KIND, params: {} },
    transform: heightGizmoTransform(position),
    data: Object.freeze({
      entity: "construction-node-handle",
      nodeId,
      axis: "y-height",
    }) satisfies NodeHandlePickData,
  };
}

export function heightGizmoStemSceneItem(
  nodeId: string,
  position: ConstructionPosition,
): SceneItem<{ readonly positions: Float32Array }> {
  const positions = new Float32Array([
    position.x,
    position.y,
    position.z,
    position.x,
    position.y + HEIGHT_GIZMO_OFFSET_Y,
    position.z,
  ]);
  return {
    id: heightGizmoStemSceneItemId(nodeId),
    layer: NODE_HANDLE_LAYER_ID,
    visual: { kind: HEIGHT_GIZMO_STEM_VISUAL_KIND, params: { positions } },
    transform: { position: { x: 0, y: 0, z: 0 } },
    data: Object.freeze({
      entity: "construction-node-handle",
      nodeId,
      axis: "y-height",
    }) satisfies NodeHandlePickData,
  };
}
