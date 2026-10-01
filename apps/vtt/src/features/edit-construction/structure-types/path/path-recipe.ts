import type { PathBrushParams, PathKind } from "../../tools/tool-types.ts";

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
 * **Flat, and three slots wide, on purpose.** A run is exactly its outer
 * contour, its spine, and the rib linking them -- the same three parts the
 * junction work is about to be written against. A raised U edge is a detail
 * that goes back on top once those connections work, and while the central
 * logic is being settled it only gets in the way: a lifted rim drags the
 * terrain's own hole up with it, because the hole reuses the rim's very
 * nodes, which reads as a berm running the whole length of the road.
 *
 * `shoulderWidth` still widens the run; `shoulderHeight` is deliberately
 * unread until the U returns.
 *
 * Elevations are measured from the reference line's own height rather than
 * from the world floor. The Rust sweep owns frames, vertices and quads;
 * where the stations go, and how high each one sits, stays on this side.
 */
export function pathFormationFor(params: PathBrushParams): PathFormationRecipe {
  const halfBed = params.bedWidth / 2;
  const halfWidth = params.pathKind === "street" ? halfBed : halfBed + params.shoulderWidth;
  const profile = [
    { lateralOffset: -halfWidth, elevation: 0 },
    { lateralOffset: PATH_SPINE_OFFSET, elevation: 0 },
    { lateralOffset: halfWidth, elevation: 0 },
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
 * The steepest a road climbs, as rise per plan length -- the road-building
 * games' ceiling for a local road (Transport Fever keeps roads to 20 %). A
 * road drawn to meet one higher than that allows stops short of it.
 */
export const PATH_MAX_GRADE = 0.2;

/**
 * The tightest a road turns, as the radius of its centre line: its own
 * width. Tighter, the inner edge folds over itself -- it must stay clear of
 * half the width -- and the curve reads as a knot, not a road.
 */
export function pathMinRadius(params: PathBrushParams): number {
  return pathHalfWidth(params) * 2;
}

/**
 * How far a road's fitted height may stray from the ground it was drawn over
 * before a span is split: the ground rises or falls to meet a road where it
 * rests on it, so a road need not trace every bump -- only a hill.
 */
export const PATH_HEIGHT_TOLERANCE = 0.5;

/** Everything a drawn road is held to before it is laid, as the engine's stroke shape. */
export function pathStrokeShape(params: PathBrushParams): { readonly simple: true; readonly minRadius: number; readonly maxGrade: number; readonly heightTolerance: number } {
  return { simple: true, minRadius: pathMinRadius(params), maxGrade: PATH_MAX_GRADE, heightTolerance: PATH_HEIGHT_TOLERANCE };
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
