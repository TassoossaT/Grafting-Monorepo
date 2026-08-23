import type { PathBrushParams, PathKind } from "./tool-types.ts";

/** One VTT-owned sample of the cross-section the generic Rust sweep executes. */
export interface PathProfilePoint {
  readonly lateralOffset: number;
  readonly elevation: number;
}

/** Product recipe forwarded unchanged to the construction-session boundary. */
export interface PathFormationRecipe {
  readonly kind: PathKind;
  readonly profile: readonly PathProfilePoint[];
  readonly maxSegmentLength: number;
  readonly miterLimit: number;
}

/**
 * Resolves the VTT's named path recipe without constructing any mesh or graph.
 *
 * `street` is a flat bed, while `road` and `trail` carry a non-negative U
 * profile. The Rust sweep owns all sampling, frames, vertices, and quads.
 */
export function pathFormationFor(params: PathBrushParams): PathFormationRecipe {
  const halfBed = params.bedWidth / 2;
  const outer = halfBed + params.shoulderWidth;
  const profile = params.pathKind === "street"
    ? [{ lateralOffset: -halfBed, elevation: 0 }, { lateralOffset: halfBed, elevation: 0 }]
    : [
        { lateralOffset: -outer, elevation: params.shoulderHeight },
        { lateralOffset: -halfBed, elevation: 0 },
        { lateralOffset: halfBed, elevation: 0 },
        { lateralOffset: outer, elevation: params.shoulderHeight },
      ];
  return Object.freeze({
    kind: params.pathKind,
    profile: Object.freeze(profile.map((point) => Object.freeze(point))),
    maxSegmentLength: params.maxSegmentLength,
    miterLimit: params.miterLimit,
  });
}
