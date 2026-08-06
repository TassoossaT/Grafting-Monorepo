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

/** Default scale range shared by wheel and caller-driven viewport changes. */
const DEFAULT_ZOOM_RANGE = Object.freeze({ min: 0.1, max: 4 });

/** Resolves a valid scale range from an optional wheel-zoom policy. */
export function resolveCanvasZoomRange(
  options: CanvasZoomOptions | false,
): { readonly min: number; readonly max: number } {
  const configuredMin = options === false ? undefined : options.minScale;
  const configuredMax = options === false ? undefined : options.maxScale;
  const min = configuredMin !== undefined && Number.isFinite(configuredMin) && configuredMin > 0
    ? configuredMin
    : DEFAULT_ZOOM_RANGE.min;
  const candidateMax = configuredMax !== undefined && Number.isFinite(configuredMax)
    ? configuredMax
    : DEFAULT_ZOOM_RANGE.max;
  return Object.freeze({ min, max: Math.max(min, candidateMax) });
}

/** Clamps a viewport scale to the consumer's resolved zoom range. */
export function clampCanvasZoomScale(scale: number, options: CanvasZoomOptions | false): number {
  const range = resolveCanvasZoomRange(options);
  return Math.min(range.max, Math.max(range.min, scale));
}
