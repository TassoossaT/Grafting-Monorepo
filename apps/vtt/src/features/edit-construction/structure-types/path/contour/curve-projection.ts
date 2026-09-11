import type { ConstructionPosition } from "@/ports";

/**
 * TS mirror of `grafting-graph-core`'s `curve_offset::ReferenceField` -- see
 * `offset-bands.ts`'s own header for why a mirror rather than a wasm call
 * for now, and `field.rs` for the full argument. The short version is that
 * this is the same question answered the same way on both sides of the
 * boundary, and the two must not drift: the Rust field elevates the mesh's
 * interior, this one elevates the contour the mesh is built on, and a
 * disagreement between them would be a seam exactly at the margin.
 *
 * **What it replaces and why.** The band union works in `[x, z]` and
 * discards height, so every vertex it hands back needs one from somewhere.
 * That somewhere used to be the nearest ribbon sample, which is wrong in the
 * way nearest-neighbour is always wrong: the sample nearest a point on the
 * left margin is regularly one on the *right* margin, or on another chain
 * entirely, and the vertex came back at that unrelated station's height.
 * Along a run crossing a slope, adjacent boundary vertices could pick
 * samples from opposite sides and end up several stations apart in
 * elevation -- which is one of the two things that dented a road.
 *
 * Projecting onto the curve asks the question that was actually meant: the
 * curve is what the surface was swept from, so a point's height is the
 * curve's height at the station it projects onto.
 */

/** One curve the contour was swept from, flattened to segments and carrying height. */
export interface ReferenceCurve {
  readonly points: readonly ConstructionPosition[];
}

/**
 * The height of whichever curve in `curves` runs nearest `(x, z)`, at the
 * station the point projects onto.
 *
 * A point past a curve's end reads that end's height rather than an
 * extrapolation, which is what a surface overshooting its curve -- an end
 * cap, a mitre past a corner -- should get.
 *
 * Falls back to `fallback` when no curve has a segment to project onto, so a
 * degenerate chain mid-edit produces a flat vertex rather than a NaN.
 */
export function heightOnCurves(
  x: number,
  z: number,
  curves: readonly ReferenceCurve[],
  fallback = 0,
): number {
  let bestDistanceSq = Infinity;
  let bestY = fallback;
  for (const curve of curves) {
    const { points } = curve;
    for (let index = 0; index + 1 < points.length; index += 1) {
      const from = points[index]!;
      const to = points[index + 1]!;
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq < 1e-12) continue;
      const along = Math.min(1, Math.max(0, ((x - from.x) * dx + (z - from.z) * dz) / lengthSq));
      const offsetX = x - (from.x + dx * along);
      const offsetZ = z - (from.z + dz * along);
      const distanceSq = offsetX * offsetX + offsetZ * offsetZ;
      if (distanceSq >= bestDistanceSq) continue;
      bestDistanceSq = distanceSq;
      bestY = from.y + (to.y - from.y) * along;
    }
  }
  return bestY;
}
