import type { SceneItem } from "@grafting/render-3d";

import type { RenderPreviewDescriptor } from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import { TOOL_GHOST_PREVIEW_CHANNEL } from "../../ports/index.ts";

export const CONSTRUCTION_PREVIEW_LAYER_ID = "construction-preview";
export const CONSTRUCTION_PREVIEW_VISUAL_KIND = "vtt-construction-preview";
/** The channel a caller that names none is drawn on -- the single tool ghost. */
export const DEFAULT_PREVIEW_CHANNEL = TOOL_GHOST_PREVIEW_CHANNEL;

/** One id per channel, so `put` replaces within a channel and never across. */
export function constructionPreviewSceneItemId(channel: string): string {
  return `construction-preview:${channel}`;
}

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
  channel: string = DEFAULT_PREVIEW_CHANNEL,
): SceneItem<ConstructionPreviewVisualParams> {
  return {
    id: constructionPreviewSceneItemId(channel),
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
