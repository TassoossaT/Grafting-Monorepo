import type { SceneItem } from "@grafting/render-3d";

import type { RenderMapChunk, RenderMeshData } from "@/ports";

export const MAP_LAYER_ID = "map";
export const MAP_SURFACE_VISUAL_KIND = "vtt-map-surface";

export interface MapChunkVisualParams {
  readonly mesh: RenderMeshData;
  readonly color: number;
}

/**
 * Flat classification color, no texture -- matches `@grafting/render-3d`'s
 * own `heightfieldVisual` default. A real material/asset pipeline is `E4.2`;
 * this exists only so generated geometry is visually distinguishable while
 * nothing else renders it.
 */
export function colorForSurfaceType(surfaceType: string, physical: boolean): number {
  if (!physical) return 0x3a6b8a;
  switch (surfaceType) {
    case "wall":
      return 0x8a7a6b;
    case "terrain":
      return 0x4a7a4a;
    default:
      return 0x808080;
  }
}

export function mapChunkSceneItem(chunk: RenderMapChunk): SceneItem<MapChunkVisualParams> {
  return {
    id: `map-chunk:${chunk.chunkId}`,
    layer: MAP_LAYER_ID,
    visual: {
      kind: MAP_SURFACE_VISUAL_KIND,
      params: { mesh: chunk.mesh, color: colorForSurfaceType(chunk.surfaceType, chunk.physical) },
    },
    data: Object.freeze({ entity: "map-chunk", chunkId: chunk.chunkId }),
  };
}
