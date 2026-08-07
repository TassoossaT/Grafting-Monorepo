import type { Easing } from "../contracts/animation.js";

/**
 * Replaceable easing defaults.
 *
 * These are conveniences, not policy: a track supplies its own curve whenever
 * the product's motion language calls for one, and nothing here is applied
 * unless a track asks for it.
 */
export const easings: Readonly<Record<"linear" | "easeIn" | "easeOut" | "easeInOut", Easing>> =
  Object.freeze({
    linear: (t: number) => t,
    easeIn: (t: number) => t * t,
    easeOut: (t: number) => t * (2 - t),
    easeInOut: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  });
