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

/** One convex footprint of a roof; side `i` runs from corner `i` to corner `i + 1`. */
export interface RoofBlock {
  readonly contour: readonly (readonly [number, number])[];
  /** Relative steepness per side; zero makes that side a gable. */
  readonly slopes: readonly number[];
  readonly overhangs: readonly number[];
}

/** Wire data for the native roof generator: convex blocks joined into one roof. */
export interface RoofRequest {
  readonly elevation: number;
  /** Rise of the roof's highest point above its eaves. */
  readonly height: number;
  readonly blocks: readonly RoofBlock[];
}

/** The engine's roof generator. */
export interface RoofPort {
  generateRoof(request: RoofRequest): RoofPatch;
  /** A footprint as the convex blocks a roof is raised over; throws for a concave plan without square corners. */
  roofFootprintBlocks(contour: readonly (readonly [number, number])[]): readonly (readonly [number, number])[][];
}

export interface RoofPatch {
  readonly preview: readonly (readonly [number, number, number, number, number, number])[];
  readonly nodes: readonly (readonly [number, number, number])[];
  readonly edges: readonly { readonly start: number; readonly end: number; readonly center: null }[];
  readonly faces: readonly {
    readonly block: number;
    readonly side: number;
    readonly gable: boolean;
    readonly boundary: readonly (readonly [number, boolean])[];
    readonly holes: readonly (readonly (readonly [number, boolean])[])[];
  }[];
}
