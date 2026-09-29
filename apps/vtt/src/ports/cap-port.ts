/** The plan a roof covers: one outline and the holes through it, as `[x, z]` corners in either winding. */
export interface RoofFootprint {
  readonly outer: readonly (readonly [number, number])[];
  readonly holes: readonly (readonly (readonly [number, number])[])[];
}

/** A dormer raised on the pitched leaf of footprint side `side`. */
export interface RoofDormer {
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

/**
 * Wire data for the native roof generator: its footprints, how steeply each
 * of their sides rises -- footprint by footprint, the outline's, then each hole's, side `i` running from
 * corner `i` to `i + 1`, zero for a gable -- and dormers on its leaves.
 */
export interface RoofRequest {
  readonly elevation: number;
  /** Rise of the roof's highest point above its eaves. */
  readonly height: number;
  /** The plans it covers: one, or several joined at a corner. */
  readonly footprints: readonly RoofFootprint[];
  readonly slopes: readonly number[];
  readonly dormers?: readonly RoofDormer[];
  /** Areas removed from finished roof faces without reshaping its skeleton. */
  readonly cutouts?: readonly RoofFootprint[];
  /** Platform outlines trim only roof surface above the platform level. */
  readonly platform_cuts?: readonly { readonly footprint: RoofFootprint; readonly elevation: number }[];
  /** Smaller roofs joined into this roof's visible envelope. */
  readonly subroofs?: readonly RoofRequest[];
}

/** The engine's roof generator. */
export interface RoofPort {
  generateRoof(request: RoofRequest): RoofPatch;
}

export interface RoofPatch {
  readonly preview: readonly (readonly [number, number, number, number, number, number])[];
  readonly nodes: readonly (readonly [number, number, number])[];
  readonly edges: readonly { readonly start: number; readonly end: number; readonly center: null }[];
  readonly faces: readonly {
    /** The footprint side it rises from -- one past the last for a flat top; a dormer's own side 0-3, or 4 where it meets its leaf. */
    readonly side: number;
    readonly dormer: number | null;
    readonly subroof: number | null;
    /** Under a gable, or a dormer's front and cheeks. */
    readonly upright: boolean;
    readonly boundary: readonly (readonly [number, boolean])[];
    readonly holes: readonly (readonly (readonly [number, boolean])[])[];
  }[];
}
