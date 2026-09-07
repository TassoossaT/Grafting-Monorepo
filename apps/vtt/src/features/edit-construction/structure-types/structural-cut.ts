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

export interface StructuralCutArea {
  /** The 2D outline of the cut area on the XZ plane. */
  readonly outline: readonly (readonly [number, number])[];
  /** 3D center point of the cut/brush/explosion in world coordinates. */
  readonly center?: { readonly x: number; readonly y: number; readonly z: number };
  /** Radius of influence around center. */
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
}

export interface StructuralCutOutcome {
  readonly builtFaces: number;
  readonly removedFaces: number;
  readonly refusedFaces: number;
  readonly success: boolean;
  readonly message?: string;
}

/**
 * Calculates the target elevation for a point given the base height, the profile,
 * center and radius.
 *
 * Uses smooth cosine falloff so the cut meets the surrounding rim with zero derivative
 * (no crease or seam at the perimeter).
 */
export function calculateProfileHeight(
  point: { readonly x: number; readonly z: number },
  baseHeight: number,
  profile: CutProfile,
  center: { readonly x: number; readonly z: number },
  radius: number,
): number {
  if (radius <= 1e-6) return baseHeight;
  if (profile.kind === "regenerate" || profile.kind === "hole") return baseHeight;

  const dx = point.x - center.x;
  const dz = point.z - center.z;
  const dist = Math.hypot(dx, dz);
  if (dist >= radius) return baseHeight;

  const normalized = dist / radius;
  // Cosine bell: 1 at center, 0 at perimeter, horizontal tangent at both ends
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
