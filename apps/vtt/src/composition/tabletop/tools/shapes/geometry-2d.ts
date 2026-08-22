import type { ConstructionPosition } from "@/ports";

/**
 * Shared 2D geometry algorithms in the tabletop's ground plane (XZ).
 * On the tabletop, X and Z represent the ground plane where Y represents height.
 */

export interface PointXZ {
  readonly x: number;
  readonly z: number;
}

/** 2D Euclidean distance on the XZ plane. */
export function xzDistance(a: PointXZ, b: PointXZ): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/** Squared 2D Euclidean distance on the XZ plane (avoids square root for comparisons). */
export function xzDistanceSq(a: PointXZ, b: PointXZ): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/**
 * Projects `point` onto the infinite line through `a` and `b` on the XZ plane.
 * - `t`: normalized position along the segment (0 at `a`, 1 at `b`, can be <0 or >1 outside the segment).
 * - `perp`: perpendicular distance from `point` to the infinite line.
 * - `x`, `z`: coordinates of the projected point on the line.
 */
export function projectOntoLineXZ(
  point: PointXZ,
  a: PointXZ,
  b: PointXZ,
): { readonly t: number; readonly perp: number; readonly x: number; readonly z: number } {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  if (lengthSq < 1e-9) {
    return { t: 0, perp: xzDistance(point, a), x: a.x, z: a.z };
  }

  const apx = point.x - a.x;
  const apz = point.z - a.z;
  const t = (apx * abx + apz * abz) / lengthSq;
  const x = a.x + t * abx;
  const z = a.z + t * abz;
  return { t, perp: Math.hypot(point.x - x, point.z - z), x, z };
}

/**
 * Shortest distance from `point` to the clamped finite segment `[a, b]` on the XZ plane.
 */
export function distanceToSegmentXZ(point: PointXZ, a: PointXZ, b: PointXZ): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  if (lengthSq < 1e-9) return Math.hypot(point.x - a.x, point.z - a.z);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.z - a.z) * abz) / lengthSq));
  return Math.hypot(point.x - (a.x + t * abx), point.z - (a.z + t * abz));
}

/**
 * Ray-casting algorithm to test if a 2D point lies inside a polygon on the XZ plane.
 */
export function pointInPolygonXZ(point: PointXZ, polygon: readonly PointXZ[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (pi === undefined || pj === undefined) continue;
    const crosses = pi.z > point.z !== pj.z > point.z;
    if (!crosses) continue;
    const xAtPointZ = ((pj.x - pi.x) * (point.z - pi.z)) / (pj.z - pi.z) + pi.x;
    if (point.x < xAtPointZ) inside = !inside;
  }
  return inside;
}

/**
 * Minimum distance from `point` to the boundary edges of a polygon on the XZ plane.
 */
export function distanceToPolygonBoundaryXZ(point: PointXZ, polygon: readonly PointXZ[]): number {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a === undefined || b === undefined) continue;
    best = Math.min(best, distanceToSegmentXZ(point, a, b));
  }
  return best;
}

/**
 * Angle in radians from point `a` to point `b` on the XZ plane (-PI to PI).
 */
export function angleFromToXZ(a: PointXZ, b: PointXZ): number {
  return Math.atan2(b.z - a.z, b.x - a.x);
}

/**
 * 2D polygon area on the XZ plane via Shoelace formula.
 */
export function polygonAreaXZ(polygon: readonly PointXZ[]): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (pi === undefined || pj === undefined) continue;
    sum += (pj.x + pi.x) * (pj.z - pi.z);
  }
  return Math.abs(sum) / 2;
}

/**
 * Pins `point`'s Y coordinate to `baseline`'s Y coordinate.
 */
export function pinnedToBaseline<T extends ConstructionPosition>(
  baseline: { readonly y: number },
  point: T,
): T {
  return { ...point, y: baseline.y };
}
