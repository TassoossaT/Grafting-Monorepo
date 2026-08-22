import type { SceneItem } from "@grafting/render-3d";

import type { RenderMapChunk, RenderMeshData } from "@/ports";

export const MAP_LAYER_ID = "map";
export const MAP_SURFACE_VISUAL_KIND = "vtt-map-surface";

export interface MapChunkVisualParams {
  readonly mesh: RenderMeshData;
  readonly color: number;
}

/**
 * Translates one already-classified map chunk into a scene item.
 *
 * Deciding what a surface looks like is not this module's job: the chunk
 * arrives with its covering already resolved by `entities/map`, and this
 * function only carries it across the renderer boundary. It used to derive the
 * color itself from `surfaceType`, which put product presentation policy
 * downstream of the port meant to feed it -- see
 * `docs/architecture/vtt-surface-covering-transformation-plan.md`.
 */
export function mapChunkSceneItem(chunk: RenderMapChunk): SceneItem<MapChunkVisualParams> {
  return {
    id: `map-chunk:${chunk.chunkId}`,
    layer: MAP_LAYER_ID,
    visual: {
      kind: MAP_SURFACE_VISUAL_KIND,
      params: { mesh: chunk.mesh, color: chunk.covering.color },
    },
    data: Object.freeze({ entity: "map-chunk", chunkId: chunk.chunkId }),
  };
}
