import type { PathBrushParams, PathKind } from "./tool-types.ts";

/**
 * The lateral offset the spine sits at.
 *
 * Every path profile carries a point here, which is what makes the travel
 * line a real seam in the graph: the two bands either side of it meet along
 * one shared edge chain, so the line is stored, shared and editable rather
 * than being a number the generator forgot. Any further line a product wants
 * to be first-class -- a lane, a rail -- is just another profile point, and
 * needs no machinery of its own.
 */
export const PATH_SPINE_OFFSET = 0;

/** One VTT-owned sample of the cross-section the generic Rust sweep executes. */
export interface PathProfilePoint {
  readonly lateralOffset: number;
  readonly elevation: number;
}

/** Product recipe forwarded unchanged to the construction-session boundary. */
export interface PathFormationRecipe {
  readonly kind: PathKind;
  readonly profile: readonly PathProfilePoint[];
  readonly miterLimit: number;
}

/**
 * Resolves the VTT's named path recipe without constructing any mesh or graph.
 *
 * `street` is a flat bed, while `road` and `trail` carry a non-negative U
 * profile, measured from the reference line's own height rather than from
 * the world floor. The Rust sweep owns frames, vertices and quads; where the
 * stations go, and how high each one sits, stays on this side.
 */
export function pathFormationFor(params: PathBrushParams): PathFormationRecipe {
  const halfBed = params.bedWidth / 2;
  const outer = halfBed + params.shoulderWidth;
  const spine = { lateralOffset: PATH_SPINE_OFFSET, elevation: 0 };
  const profile = params.pathKind === "street"
    ? [{ lateralOffset: -halfBed, elevation: 0 }, spine, { lateralOffset: halfBed, elevation: 0 }]
    : [
        { lateralOffset: -outer, elevation: params.shoulderHeight },
        { lateralOffset: -halfBed, elevation: 0 },
        spine,
        { lateralOffset: halfBed, elevation: 0 },
        { lateralOffset: outer, elevation: params.shoulderHeight },
      ];
  return Object.freeze({
    kind: params.pathKind,
    profile: Object.freeze(profile.map((point) => Object.freeze(point))),
    miterLimit: params.miterLimit,
  });
}

/**
 * Which profile slot is the spine -- the index of the point at
 * {@link PATH_SPINE_OFFSET}, or `-1` for a profile that declares none.
 *
 * Node identity is minted relative to this slot, so that "outward" is a fact
 * an id carries rather than something a later edit has to infer from
 * geometry that has since moved.
 */
export function pathSpineSlot(profile: readonly PathProfilePoint[]): number {
  return profile.findIndex((point) => point.lateralOffset === PATH_SPINE_OFFSET);
}

/**
 * How far this recipe's own product reaches from the reference line -- the
 * outermost lateral offset of the profile it produces.
 *
 * Read off the profile rather than recomputed from the parameters, so the
 * width the brush is sized against and the width actually swept can never
 * drift apart. A `street` has no shoulder and a `road` does; that difference
 * lives in one place, and this follows it.
 */
export function pathHalfWidth(params: PathBrushParams): number {
  return pathFormationFor(params).profile.reduce(
    (widest, point) => Math.max(widest, Math.abs(point.lateralOffset)),
    0,
  );
}
