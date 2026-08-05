import type { CanvasInteractionOptions, CanvasZoomOptions } from "./contracts.js";

/** Fully resolved interaction policy used by the private canvas renderer. */
export interface ResolvedCanvasInteractionPolicy {
  readonly panning: boolean;
  readonly movableNodes: boolean;
  readonly clickThreshold: number;
  readonly zoom: CanvasZoomOptions | false;
  readonly selectOnActivate: boolean;
}

/** Keeps every interaction disabled unless a consumer opts in explicitly. */
export function resolveCanvasInteractionPolicy(
  options: CanvasInteractionOptions | undefined,
): ResolvedCanvasInteractionPolicy {
  return Object.freeze({
    panning: options?.panning ?? false,
    movableNodes: options?.movableNodes ?? false,
    clickThreshold: options?.clickThreshold ?? 0,
    zoom: options?.zoom ?? false,
    selectOnActivate: options?.selectOnActivate ?? false,
  });
}