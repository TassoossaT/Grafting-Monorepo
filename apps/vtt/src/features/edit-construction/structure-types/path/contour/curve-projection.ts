import type { ConstructionFieldQuery, ConstructionFieldSample, ConstructionPosition } from "@/ports";

/**
 * Elevating what a planar union handed back flat -- asked of the engine's own
 * reference field, never recomputed here.
 *
 * **Why the question exists.** The band union works in `[x, z]` and discards
 * height, so every vertex it hands back needs one from somewhere. That
 * somewhere used to be the nearest ribbon sample, which is wrong in the way
 * nearest-neighbour is always wrong: the sample nearest a point on the left
 * margin is regularly one on the *right* margin, or on another chain
 * entirely, and the vertex came back at that unrelated station's height.
 *
 * **Why it is the engine's.** The curve is what the surface was swept from,
 * and the same field elevates the mesh's interior inside the engine while
 * this elevates the contour the mesh is built on. Two implementations of one
 * projection would disagree exactly at the margin, which is a seam; so there
 * is one, in `curve_offset::field`, and this asks it.
 */

/** What answering a projection needs: the engine's own reference field. */
export interface FieldPort {
  queryField(query: ConstructionFieldQuery): readonly ConstructionFieldSample[];
}

/** One curve the contour was swept from, flattened to segments and carrying height. */
export interface ReferenceCurve {
  readonly points: readonly ConstructionPosition[];
  /** How far off this curve the surface it generated reaches; omitted means "just read the nearest". */
  readonly reach?: number;
}

/**
 * The height of whichever curve runs nearest each `[x, z]` point, at the
 * station that point projects onto, in one crossing.
 *
 * A point past a curve's end reads that end's height rather than an
 * extrapolation, which is what a surface overshooting its curve -- an end
 * cap, a mitre past a corner -- should get. A point with no curve to project
 * onto reads `fallback`, so a degenerate chain mid-edit produces a flat
 * vertex rather than a NaN.
 */
export function heightsOnCurves(
  port: FieldPort,
  curves: readonly ReferenceCurve[],
  points: readonly (readonly [number, number])[],
  fallback = 0,
): readonly number[] {
  if (points.length === 0) return [];
  if (curves.length === 0) return points.map(() => fallback);
  return port.queryField({ curves, points }).map((sample) => sample?.y ?? fallback);
}
