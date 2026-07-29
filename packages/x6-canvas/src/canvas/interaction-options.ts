import type { CanvasInteractionModifier, CanvasInteractionOptions } from "../index.js";

const toX6Modifier = (modifier: CanvasInteractionModifier) =>
  modifier === "control" ? "ctrl" : modifier;

/** Maps replaceable neutral interaction policy to private X6 options. */
export function toX6ReadOnlyInteractionOptions(options: CanvasInteractionOptions = {}) {
  const zoom = options.zoom === false || options.zoom === undefined ? undefined : options.zoom;
  return {
    interacting: false as const,
    clickThreshold: options.clickThreshold ?? 0,
    panning: {
      enabled: options.panning ?? false,
      eventTypes: ["leftMouseDown" as const],
    },
    mousewheel: {
      enabled: zoom !== undefined,
      modifiers: zoom?.modifiers?.map(toX6Modifier),
      factor: zoom?.factor,
      minScale: zoom?.minScale,
      maxScale: zoom?.maxScale,
    },
  };
}
