import type { ConstructionSheetProfile } from "./construction-session-port.ts";

/** Grafting-owned wire data for the native analytic cap generator. */
export interface CapRequest {
  readonly base: { readonly kind: "rectangle"; readonly min: readonly [number, number]; readonly max: readonly [number, number] }
    | { readonly kind: "circle"; readonly center: readonly [number, number]; readonly radius: number }
    | { readonly kind: "contour"; readonly points: readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]]; readonly centers: readonly [readonly [number, number] | null, readonly [number, number] | null, readonly [number, number] | null, readonly [number, number] | null] };
  readonly elevation: number;
  readonly height: number;
  readonly overhang: number;
  readonly curvatures: readonly [number, number, number, number];
}

export interface CapPatch {
  readonly preview: readonly (readonly [number, number, number, number, number, number])[];
  readonly nodes: readonly (readonly [number, number, number])[];
  readonly edges: readonly { readonly start: number; readonly end: number; readonly center: readonly [number, number] | null }[];
  readonly faces: readonly { readonly boundary: readonly (readonly [number, boolean])[]; readonly profile: ConstructionSheetProfile }[];
}
