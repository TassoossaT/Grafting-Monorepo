import type { ConstructionEdgeGeometry, ConstructionPosition } from "@/ports";

/**
 * The one place any `ConstructionEdgeGeometry` (line, arc, or bezier) is
 * turned into "where is this edge at parameter/travel X" -- angle math,
 * cubic evaluation, and arc-length walking, each written once.
 *
 * Before this module existed, `stroke-fitting.ts` (fitting a stroke),
 * `panel-rail.ts` (reading an upright panel back to place an opening), and
 * `platform-contour-merge.ts` (welding a stroke onto a platform's own
 * contour) each carried their own copy of `angleAround`/sweep-angle math,
 * with their own sign conventions to keep in sync by hand. Only one of the
 * three ever grew a Bezier case, which is exactly the trap centralizing
 * this closes: a caller reaching for "how far along this edge is this
 * point" now gets every geometry kind for free, instead of silently falling
 * back to treating a curved edge as its own straight chord.
 */

const TAU = Math.PI * 2;

function wrapPositive(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

/** Angle of `(x, z)` around `center`, in the graph's own XZ convention (`atan2(z, x)`). */
export function angleAround(center: readonly [number, number], x: number, z: number): number {
  return Math.atan2(z - center[1], x - center[0]);
}

/**
 * The signed angle actually swept walking from angle `from` to angle `to`
 * in the direction `clockwise` says, magnitude always in `[0, 2*PI)`.
 * Positive/counter-clockwise unless `clockwise` is set.
 */
export function arcSweep(from: number, to: number, clockwise: boolean): number {
  return clockwise ? -wrapPositive(from - to) : wrapPositive(to - from);
}

/** XZ position on the cubic Bezier `start -> handle1 -> handle2 -> end` at parameter `t`. */
