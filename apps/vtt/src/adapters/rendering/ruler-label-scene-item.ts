import type { SceneItem } from "@grafting/render-3d";

import type { RenderPreviewLabel } from "../../ports/scene-render-port.ts";

/**
 * A number the ruler writes on the map: a camera-facing sprite on the preview
 * layer -- never pickable, drawn above everything, like the ruler's own lines
 * -- whose texture is the text. This module is only the item: where it stands
 * and how big it is. The texture is drawn in `marker-textures.ts`, from the
 * same {@link rulerLabelAspect}, so the sprite is never stretched.
 */

export const RULER_LABEL_LAYER_ID = "construction-preview";
export const RULER_LABEL_VISUAL_KIND = "vtt-ruler-label";

export function rulerLabelSceneItemId(channel: string, index: number): string {
  return `ruler-label:${channel}:${index}`;
}

export interface RulerLabelVisualParams {
  readonly text: string;
}

/** How wide a written text is against its height: the one rule the sprite's size and its texture both follow. */
export function rulerLabelAspect(text: string): number {
  return Math.max(1.2, text.length * 0.62 + 0.7);
}

/** `label` as a scene item: standing where it is written, as tall as it is asked and as wide as its text. */
export function rulerLabelSceneItem(label: RenderPreviewLabel, index: number, channel: string): SceneItem<RulerLabelVisualParams> {
  return {
    id: rulerLabelSceneItemId(channel, index),
    layer: RULER_LABEL_LAYER_ID,
    visual: { kind: RULER_LABEL_VISUAL_KIND, params: { text: label.text } },
    transform: { position: label.position, scale: { x: label.height * rulerLabelAspect(label.text), y: label.height, z: 1 } },
    data: Object.freeze({ entity: "construction-preview" }),
  };
}
