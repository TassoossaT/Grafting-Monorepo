import type { SceneItem } from "@grafting/render-3d";

import type { RenderPreviewDescriptor } from "@/ports";

export const CONSTRUCTION_PREVIEW_LAYER_ID = "construction-preview";
export const CONSTRUCTION_PREVIEW_VISUAL_KIND = "vtt-construction-preview";
/** Fixed id -- there is only ever one active tool preview at a time, so `put` on this id always replaces it. */
export const CONSTRUCTION_PREVIEW_ITEM_ID = "construction-preview:active";

export interface ConstructionPreviewVisualParams {
  readonly positions: Float32Array;
  readonly indices?: Uint16Array | Uint32Array;
  readonly color: number;
  readonly opacity: number;
  readonly filled: boolean;
}

/**
 * Turns a tool's plain {@link RenderPreviewDescriptor} into a scene item on
 * the dedicated preview layer -- never pickable, drawn above everything
 * (tokens included) so a ghost is never occluded by real geometry.
 */
export function constructionPreviewSceneItem(
  descriptor: RenderPreviewDescriptor,
): SceneItem<ConstructionPreviewVisualParams> {
  return {
    id: CONSTRUCTION_PREVIEW_ITEM_ID,
    layer: CONSTRUCTION_PREVIEW_LAYER_ID,
    visual: {
      kind: CONSTRUCTION_PREVIEW_VISUAL_KIND,
      params: {
        positions: descriptor.positions,
        indices: descriptor.kind === "mesh" ? descriptor.indices : undefined,
        color: descriptor.color,
        opacity: descriptor.opacity ?? 0.5,
        filled: descriptor.kind !== "segments",
      },
    },
    data: Object.freeze({ entity: "construction-preview" }),
  };
}
