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

/** A dormer raised on one pitched leaf of a roof: side `side` of block `block`. */
export interface RoofDormer {
  readonly block: number;
  readonly side: number;
  /** Where its middle stands along that side, as a fraction of it. */
  readonly along: number;
  /** How far in from that side its front stands. */
  readonly setback: number;
  readonly width: number;
  /** How high its front wall rises above the leaf. */
  readonly front: number;
  /** Relative steepness of its front, right, back and left sides; zero makes a gable. */
  readonly slopes: readonly [number, number, number, number];
}

/** Wire data for the native roof generator: convex blocks joined into one roof, and dormers on its leaves. */
export interface RoofRequest {
  readonly elevation: number;
  /** Rise of the roof's highest point above its eaves. */
  readonly height: number;
  readonly blocks: readonly RoofBlock[];
  readonly dormers?: readonly RoofDormer[];
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
    /** Under a gable, or a dormer's front and cheeks. */
    readonly upright: boolean;
    readonly boundary: readonly (readonly [number, boolean])[];
    readonly holes: readonly (readonly (readonly [number, boolean])[])[];
  }[];
}
