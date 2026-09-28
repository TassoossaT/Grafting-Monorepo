import type { ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import type { PlanPoint } from "./plan-rotation.ts";

/**
 * The plan geometry every structure, handle and repair reads -- one answer
 * each, so they never disagree about what "inside" or "nearest" means.
 */

/** A face's key as one string: its surface key's parts joined by NUL, which no part contains. */
export const surfaceKeyText = (surfaceKey: ConstructionSurfaceKey | readonly string[]): string => surfaceKey.join("\u0000");

/** A face's key as one string -- see {@link surfaceKeyText}. */
export const faceKey = (topology: Pick<ConstructionRegionTopology, "surfaceKey">): string => surfaceKeyText(topology.surfaceKey);

/** Whether `p` lies inside `ring` in plan, by the even-odd rule; a point on an edge may fall either way. */
export function insideRing(ring: readonly PlanPoint[], p: PlanPoint): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Where on the segment `a`-`b` the point `p` is nearest, in plan: how far along it (`t`, 0 to 1), the point, and how far off. */
export function nearestOnSegment(p: PlanPoint, a: PlanPoint, b: PlanPoint): { readonly t: number; readonly x: number; readonly z: number; readonly distance: number } {
  const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz;
  const t = lengthSq < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq));
  const x = a.x + dx * t, z = a.z + dz * t;
  return { t, x, z, distance: Math.hypot(p.x - x, p.z - z) };
}

/** Twice the signed area of a ring in plan, closed or not: positive one way round, negative the other. */
export function twiceSignedArea(ring: readonly PlanPoint[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    twice += a.x * b.z - b.x * a.z;
  }
  return twice;
}

/** The same, for a ring given as `[x, z]` pairs. */
export const twiceSignedAreaXZ = (ring: readonly (readonly [number, number])[]): number => twiceSignedArea(ring.map(([x, z]) => ({ x, z })));

/** The best plane through a ring of positions, by Newell's method: its unit normal and a point on it; `undefined` for a degenerate ring. */
export function planeOf(ring: readonly ConstructionPosition[]): { readonly normal: ConstructionPosition; readonly centre: ConstructionPosition } | undefined {
  if (ring.length < 3) return undefined;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-12) return undefined;
  const centre = { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length, z: ring.reduce((s, p) => s + p.z, 0) / ring.length };
  return { normal: { x: nx / length, y: ny / length, z: nz / length }, centre };
}

/** A face's outer loops as rings of its node positions. */
export function faceRings(topology: ConstructionRegionTopology, loops: ConstructionRegionTopology["outerLoops"] = topology.outerLoops): readonly (readonly ConstructionPosition[])[] {
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  return loops.map((loop) => loop.map((use) => at.get(use.startNodeId)).filter((p): p is ConstructionPosition => p !== undefined));
}

/** Whether `p` lies inside the face in plan: in an outer loop and out of its holes. */
export function insideFace(topology: ConstructionRegionTopology, p: PlanPoint): boolean {
  return faceRings(topology).some((ring) => insideRing(ring, p)) && !faceRings(topology, topology.holes).some((ring) => insideRing(ring, p));
}

/**
 * Whether segments `a`-`b` and `c`-`d` cross each other at a point inside
 * both -- not merely touch or run along each other -- in plan. `tolerance`
 * is how far clear of the other's line each end must lie to count.
 */
export function segmentsCross(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint, tolerance = 0): boolean {
  const side = (o: PlanPoint, u: PlanPoint, v: PlanPoint) => (u.x - o.x) * (v.z - o.z) - (u.z - o.z) * (v.x - o.x);
  const d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d);
  return ((d1 > tolerance && d2 < -tolerance) || (d1 < -tolerance && d2 > tolerance))
    && ((d3 > tolerance && d4 < -tolerance) || (d3 < -tolerance && d4 > tolerance));
}

/** How far apart, in plan, the segments `p`-`q` and `a`-`b` come: zero where they cross. */
export function segmentGap(p: PlanPoint, q: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  if (segmentsCross(p, q, a, b)) return 0;
  return Math.min(nearestOnSegment(p, a, b).distance, nearestOnSegment(q, a, b).distance, nearestOnSegment(a, p, q).distance, nearestOnSegment(b, p, q).distance);
}

/** Whether two sides of a ring that do not meet at a corner cross each other, in plan. */
export function ringCrossesItself(ring: readonly PlanPoint[]): boolean {
  const closed = ring.length > 1 && ring[0]!.x === ring[ring.length - 1]!.x && ring[0]!.z === ring[ring.length - 1]!.z;
  const points = closed ? ring.slice(0, -1) : ring;
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 2; j < count; j += 1) {
      if (i === 0 && j === count - 1) continue;
      if (segmentsCross(points[i]!, points[(i + 1) % count]!, points[j]!, points[(j + 1) % count]!)) return true;
    }
  }
  return false;
}
