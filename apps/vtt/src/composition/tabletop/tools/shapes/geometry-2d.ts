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
 * Where two XZ segments cross, as the parameter along each -- `undefined` for
 * parallel segments, or for a crossing that falls outside either one.
 *
 * Both parameters come back because a caller almost always needs the one it
 * did not ask about: splitting the segment that was crossed needs `across`,
 * while ordering the crossing among a polyline's own points needs `along`.
 */
export function segmentCrossingXZ(
  fromA: PointXZ,
  toA: PointXZ,
  fromB: PointXZ,
  toB: PointXZ,
): { readonly along: number; readonly across: number } | undefined {
  const ax = toA.x - fromA.x;
  const az = toA.z - fromA.z;
  const bx = toB.x - fromB.x;
  const bz = toB.z - fromB.z;
  const denominator = ax * bz - az * bx;
  if (Math.abs(denominator) < 1e-12) return undefined;
  const dx = fromB.x - fromA.x;
  const dz = fromB.z - fromA.z;
  const along = (dx * bz - dz * bx) / denominator;
  const across = (dx * az - dz * ax) / denominator;
  if (along < 0 || along > 1 || across < 0 || across > 1) return undefined;
  return { along, across };
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

/**
 * The points along an arc from `start` to `end`, ends included.
 *
 * The circle is the one through both ends about `center`, turned the way
 * `clockwise` says. Sampled by sagitta: a chord deviating by `tolerance`
 * from a circle of radius `r` subtends `2*acos(1 - tolerance/r)`, so the
 * step is as coarse as it can be while staying that close to the true curve.
 *
 * `y` runs linearly from one end to the other. An arc is a plan-view curve
 * -- it says where the ground track goes, never how it rises -- so the only
 * height it can honestly give a sample is the interpolation between the two
 * heights it was handed.
 */
export function arcPointsXZ<T extends ConstructionPosition>(
  start: T,
  end: T,
  center: readonly [number, number],
  clockwise: boolean,
  tolerance = 0.05,
): readonly ConstructionPosition[] {
  const radius = Math.hypot(start.x - center[0], start.z - center[1]);
  if (!(radius > tolerance)) return [start, end];

  const startAngle = Math.atan2(start.z - center[1], start.x - center[0]);
  const endAngle = Math.atan2(end.z - center[1], end.x - center[0]);
  const turn = clockwise ? startAngle - endAngle : endAngle - startAngle;
  const swept = ((turn % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const steps = Math.max(1, Math.ceil(swept / (2 * Math.acos(1 - tolerance / radius))));
  if (steps === 1) return [start, end];

  const points: ConstructionPosition[] = [start];
  for (let step = 1; step < steps; step += 1) {
    const fraction = step / steps;
    const angle = clockwise ? startAngle - swept * fraction : startAngle + swept * fraction;
    points.push({
      x: center[0] + radius * Math.cos(angle),
      y: start.y + (end.y - start.y) * fraction,
      z: center[1] + radius * Math.sin(angle),
    });
  }
  points.push(end);
  return points;
}
