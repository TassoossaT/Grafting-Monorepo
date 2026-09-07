/**
 * Generic Structural Cut & Regeneration Operations
 *
 * Defines the contract and pure profile calculations for cutting, excavating,
 * and regrowing structures (such as terrain or walls).
 *
 * Operations follow the unified cycle:
 * 1. Delete / replace affected faces within the cut volume or area.
 * 2. Regenerate the mesh pinned to the surviving boundary with a target profile:
 *    - `concave`: excavation / hole / depression (crying down into a crater)
 *    - `convex`: matter addition / mound (rising up into a hill)
 *    - `regenerate`: mending and connecting to another structure (e.g. road)
 *    - `hole`: leaving a void with a cleanly closed boundary
 */

export type CutProfile =
  | {
      readonly kind: "concave";
      /** How deep the center of the cut goes below surrounding terrain (positive world units). */
      readonly depth: number;
      /** Curvature exponent: 1 = smooth cosine/spherical, <1 = steeper/conical, >1 = flatter bowl. Default: 1. */
      readonly curvature?: number;
    }
  | {
      readonly kind: "convex";
      /** How high the center rises above surrounding terrain (positive world units). */
      readonly height: number;
      /** Curvature exponent: 1 = smooth dome, <1 = peak, >1 = mesa. Default: 1. */
      readonly curvature?: number;
    }
  | {
      readonly kind: "regenerate";
      /** Optional structure to connect/weld onto. */
      readonly connectTo?: {
        readonly surfaceType: string;
        readonly surfaceKeys?: readonly string[];
      };
    }
  | {
      readonly kind: "hole";
    };

import type { MultiPolygon } from "polygon-clipping";

export interface StructuralCutArea {
  /** The 2D outline of the cut area on the XZ plane. */
  readonly outline?: readonly (readonly [number, number])[];
  /** Optional pre-computed MultiPolygon for the cut or brush area. */
  readonly sweptPolygon?: MultiPolygon;
  /** 3D center point of the cut/brush/explosion in world coordinates. */
  readonly center?: { readonly x: number; readonly y: number; readonly z: number };
  /** Stroke path / polyline trajectory in world coordinates (for brush strokes, trenches, mountain ridges). */
  readonly path?: readonly { readonly x: number; readonly y?: number; readonly z: number }[];
  /** Radius of influence around center or stroke path. */
  readonly radius?: number;
}

export interface StructuralCutRequest {
  readonly area: StructuralCutArea;
  readonly targetSurfaceType: string;
  readonly profile: CutProfile;
  readonly causeId: string;
  readonly tableId: string;
  readonly faceSide?: number;
  readonly seed?: number;
  readonly irregularity?: number;
  /** Pre-computed covered regions from tool gesture or brush. */
  readonly coveredRegions?: readonly {
    readonly surfaceKey: readonly string[];
    readonly surfaceType: string;
  }[];
  /** Optional noise function for base terrain when expanding onto empty ground. */
  readonly noiseAt?: (point: { readonly x: number; readonly z: number }) => number;
}

export interface StructuralCutOutcome {
  readonly builtFaces: number;
  readonly removedFaces: number;
  readonly refusedFaces: number;
  readonly success: boolean;
  readonly message?: string;
}

/**
 * Calculates the squared distance and projection parameter `t` from a 2D point
 * `(px, pz)` to the line segment from `(ax, az)` to `(bx, bz)`.
 */
export function distanceSqToSegment2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { readonly distSq: number; readonly t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq <= 1e-9) {
    const dpx = px - ax;
    const dpz = pz - az;
    return { distSq: dpx * dpx + dpz * dpz, t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  const projX = ax + t * dx;
  const projZ = az + t * dz;
  const dpx = px - projX;
  const dpz = pz - projZ;
  return { distSq: dpx * dpx + dpz * dpz, t };
}

/**
 * Calculates the minimum 2D distance from a point `(px, pz)` to a 3D polyline path,
 * and the linearly interpolated elevation `pathY` at the projected point on the path.
 */
export function distanceAndElevationOnPath(
  px: number,
  pz: number,
  path: readonly { readonly x: number; readonly y?: number; readonly z: number }[],
): { readonly distance: number; readonly pathY?: number } {
  if (path.length === 0) return { distance: Infinity };
  if (path.length === 1) {
    const p0 = path[0]!;
    return { distance: Math.hypot(px - p0.x, pz - p0.z), pathY: p0.y };
  }
  let minDistSq = Infinity;
  let bestT = 0;
  let bestIdx = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const { distSq, t } = distanceSqToSegment2D(px, pz, a.x, a.z, b.x, b.z);
    if (distSq < minDistSq) {
      minDistSq = distSq;
      bestT = t;
      bestIdx = i;
    }
  }
  const a = path[bestIdx]!;
  const b = path[bestIdx + 1]!;
  let bestPathY: number | undefined;
  if (a.y !== undefined && b.y !== undefined) {
    bestPathY = a.y + bestT * (b.y - a.y);
  } else {
    bestPathY = a.y ?? b.y;
  }
  return { distance: Math.sqrt(minDistSq), pathY: bestPathY };
}

/**
 * Calculates the target elevation for a point given the base height, the profile,
 * a center point or polyline stroke path, and radius.
 *
 * Uses smooth cosine falloff along the center point or entire stroke path trajectory
 * so the cut meets the surrounding rim with zero derivative (no crease or seam at the perimeter).
 */
export function calculateProfileHeight(
  point: { readonly x: number; readonly z: number },
  baseHeight: number,
  profile: CutProfile,
  centerOrPath:
    | { readonly x: number; readonly z: number }
    | readonly { readonly x: number; readonly y?: number; readonly z: number }[],
  radius: number,
): number {
  if (radius <= 1e-6) return baseHeight;
  if (profile.kind === "regenerate" || profile.kind === "hole") return baseHeight;

  let dist: number;
  if (Array.isArray(centerOrPath)) {
    const path = centerOrPath as readonly { readonly x: number; readonly y?: number; readonly z: number }[];
    if (path.length === 0) return baseHeight;
    const { distance } = distanceAndElevationOnPath(point.x, point.z, path);
    dist = distance;
  } else {
    const center = centerOrPath as { readonly x: number; readonly z: number };
    const dx = point.x - center.x;
    const dz = point.z - center.z;
    dist = Math.hypot(dx, dz);
  }

  if (dist >= radius) return baseHeight;

  const normalized = dist / radius;
  // Cosine bell: 1 at center/spine, 0 at perimeter, horizontal tangent at both ends
  const rawFalloff = (Math.cos(normalized * Math.PI) + 1) / 2;
  const curvature = profile.curvature ?? 1;
  const falloff = curvature === 1 ? rawFalloff : Math.pow(rawFalloff, Math.max(0.1, curvature));

  if (profile.kind === "concave") {
    return baseHeight - profile.depth * falloff;
  }
  if (profile.kind === "convex") {
    return baseHeight + profile.height * falloff;
  }

  return baseHeight;
}
