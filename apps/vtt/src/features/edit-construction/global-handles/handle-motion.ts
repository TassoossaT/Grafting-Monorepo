import type { PlanPoint } from "../topology/plan-rotation.ts";

/**
 * How a handle may move while dragged -- a property of the handle, never of
 * the type it belongs to. The gesture keeps the handle on this path, and
 * only a handle that moves freely carries the scene's 3D arrows:
 *
 * - free: anywhere -- along the ground, up and down in elevation mode, or
 *   anywhere with the arrows;
 * - plane: along the ground, keeping its height;
 * - vertical: straight up and down;
 * - orbit: round `center` in plan, at its own distance and height.
 */
export type HandleMotion =
  | { readonly kind: "free" }
  | { readonly kind: "plane" }
  | { readonly kind: "vertical" }
  | { readonly kind: "orbit"; readonly center: PlanPoint };

/** Whether a handle with `motion` carries the scene's free 3D arrows. */
export function carriesArrows(motion: HandleMotion): boolean {
  return motion.kind === "free";
}
