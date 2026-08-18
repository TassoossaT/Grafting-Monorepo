import type { SceneItem } from "@grafting/render-3d";

import type { RenderMeshData } from "@/ports";

export const MAP_SURFACE_PICK_LAYER_ID = "map-surface-picks";
export const MAP_SURFACE_PICK_VISUAL_KIND = "vtt-map-surface-pick";

export interface MapSurfacePickVisualParams {
  readonly mesh: RenderMeshData;
}

export interface MapSurfacePickData {
  readonly entity: "map-surface-pick";
  readonly surfaceRef: string;
}

export function mapSurfacePickSceneItemId(surfaceRef: string): string {
  return `map-surface-pick:${surfaceRef}`;
}

/** Invisible pick proxy retaining one canonical SurfaceRef per render item. */
export function mapSurfacePickSceneItem(
  surfaceRef: string,
  mesh: RenderMeshData,
): SceneItem<MapSurfacePickVisualParams> {
  return {
    id: mapSurfacePickSceneItemId(surfaceRef),
    layer: MAP_SURFACE_PICK_LAYER_ID,
    visual: { kind: MAP_SURFACE_PICK_VISUAL_KIND, params: { mesh } },
    data: Object.freeze({ entity: "map-surface-pick", surfaceRef }) satisfies MapSurfacePickData,
  };
}