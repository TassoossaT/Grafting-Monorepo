import type { ConstructionPosition } from "@/ports";

/**
 * The XZ box a spine edit can possibly change the contour inside of.
 *
 * Deliberately not the whole cloud: a union is a local operation everywhere
 * nothing overlaps, so a segment whose own reach never enters this box
 * cannot have its band shape altered by the edit and is left standing
 * exactly as it is -- same node ids, zero churn.
 */
export interface DirtyRegion {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** `region`, grown by `reach` on every side -- the margin a road's own half-width needs before a neighbouring segment can be ruled out. */
function grow(region: DirtyRegion, reach: number): DirtyRegion {
  return {
    minX: region.minX - reach,
    maxX: region.maxX + reach,
    minZ: region.minZ - reach,
    maxZ: region.maxZ + reach,
  };
}

/**
 * The dirty region around `changedPoints` (the control points of whichever
 * spine segment(s) were just edited), expanded by `reach` -- the widest
 * half-width any band in the cloud reaches from its own spine, so two bands
 * that could touch are never split across the boundary.
 */
export function dirtyRegionAround(changedPoints: readonly ConstructionPosition[], reach: number): DirtyRegion | undefined {
  if (changedPoints.length === 0) return undefined;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of changedPoints) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return grow({ minX, maxX, minZ, maxZ }, reach);
}

/** Whether any of `points`' own bounding box overlaps `region`. */
export function boundsIntersectRegion(points: readonly ConstructionPosition[], region: DirtyRegion): boolean {
  if (points.length === 0) return false;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return minX <= region.maxX && maxX >= region.minX && minZ <= region.maxZ && maxZ >= region.minZ;
}
