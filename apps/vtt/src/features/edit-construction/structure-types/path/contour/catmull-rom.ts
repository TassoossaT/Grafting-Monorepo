import type { ConstructionPosition } from "@/ports";

/**
 * TS mirror of `grafting-procgen-curve-offset`'s `sample_catmull_rom` (Estágio
 * 1). Kept as a TS port rather than an actual Rust/WASM call for now -- wiring
 * the crate through `construction-wasm`'s wasm-bindgen boundary needs a
 * `wasm-pack build` and a verified load path through this repo's Node test
 * runner, neither of which this stage risks without checking first.
 *
 * Uses a *centripetal* parametrization (see `catmullRomPoint`'s own doc for
 * why), matching `curve-offset/src/curve.rs` -- keep the two in step if
 * either changes; this file is the one real strokes exercise today, but the
 * crate is what a future wasm wiring would call instead.
 *
 * Height included: a spine control point carries `y`, and every lerp in
 * `catmullRomPoint` moves all three components together, so height rides
 * along for free instead of needing a second interpolation pass. Only the
 * *sagitta test* that decides where to subdivide looks at XZ alone, matching
 * how every other tolerance in this codebase (`ARC_TESSELLATION_TOLERANCE`,
 * the fit tolerances in `stroke-fitting.ts`) is a ground-plane precision,
 * not a height one.
 */

const MAX_DEPTH = 16; // PathCloud curve flattening guard.

function add(a: ConstructionPosition, b: ConstructionPosition): ConstructionPosition {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: ConstructionPosition, factor: number): ConstructionPosition {
  return { x: a.x * factor, y: a.y * factor, z: a.z * factor };
}

function sub(a: ConstructionPosition, b: ConstructionPosition): ConstructionPosition {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function distanceXZ(a: ConstructionPosition, b: ConstructionPosition): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function lerpPos(a: ConstructionPosition, b: ConstructionPosition, fraction: number): ConstructionPosition {
  return add(a, scale(sub(b, a), fraction));
}

/**
 * `lerpPos(a, b, numerator / denominator)`, except a near-zero denominator
 * (two coincident control points -- `reflect()` can produce one when the
 * original neighbours were already close together) returns `a` outright
 * instead of dividing by it. `a` and `b` are the same point in that case
 * anyway, so this changes nothing about the curve, only avoids the `NaN`.
 */
function safeLerp(a: ConstructionPosition, b: ConstructionPosition, numerator: number, denominator: number): ConstructionPosition {
  if (Math.abs(denominator) < 1e-9) return a;
  return lerpPos(a, b, numerator / denominator);
}

/**
 * One point on the **centripetal** Catmull-Rom curve running from `p1` to
 * `p2`, at `localT` (`0` at `p1`, `1` at `p2`), shaped by the neighbours
 * `p0`/`p3` on either side.
 *
 * **Why centripetal, not uniform.** The control points this curve runs
 * through are not evenly spaced -- `referenceLineFrom` deliberately spaces
 * them by how much the road actually needs (a long straight stretch is two
 * points, a corner is a cluster close together), and *uniform* Catmull-Rom
 * assumes every span takes the same parameter distance regardless of how
 * far apart its points actually are. On an uneven spacing that assumption
 * is wrong exactly where a long straight run meets a tight corner, and the
 * curve overshoots into a cusp or a loop right at the transition -- the
 * "toda torta" the fix for this exists to answer.
 *
 * The centripetal parametrization (`t` growing by the *square root* of the
 * XZ distance between consecutive points, per Barry & Goldman 1988 -- the
 * standard fix, and the one the Catlike Coding tutorial this whole spine
 * model is styled on arrives at after showing the uniform version's own
 * overshoot) does not have that failure mode: a short span between close
 * points gets a short parameter interval, so the curve is not asked to
 * travel through it at the same "speed" a long span gets. Evaluated via
 * Barry-Goldman's repeated-lerp construction rather than a fixed matrix,
 * since the matrix form only exists for the uniform case.
 *
 * The exponent uses XZ distance only, matching every other tolerance in
 * this file -- height still interpolates along for free (`lerpPos` moves
 * every component together), it just is not what decides how the parameter
 * spaces itself out.
 */
function catmullRomPoint(
  p0: ConstructionPosition,
  p1: ConstructionPosition,
  p2: ConstructionPosition,
  p3: ConstructionPosition,
  localT: number,
): ConstructionPosition {
  const t0 = 0;
  const t1 = t0 + Math.sqrt(distanceXZ(p0, p1));
  const t2 = t1 + Math.sqrt(distanceXZ(p1, p2));
  const t3 = t2 + Math.sqrt(distanceXZ(p2, p3));
  const t = t1 + localT * (t2 - t1);

  const a1 = safeLerp(p0, p1, t - t0, t1 - t0);
  const a2 = safeLerp(p1, p2, t - t1, t2 - t1);
  const a3 = safeLerp(p2, p3, t - t2, t3 - t2);
  const b1 = safeLerp(a1, a2, t - t0, t2 - t0);
  const b2 = safeLerp(a2, a3, t - t1, t3 - t1);
  return safeLerp(b1, b2, t - t1, t2 - t1);
}

/**
 * The point that would sit before `p1` if the run continued the way it
 * arrived at `p1` from `p2` -- a linear reflection, not a duplicate. See
 * `curve-offset/src/curve.rs`'s own `reflect` doc for why duplicating an
 * end's own control point as its neighbour curves a perfectly straight,
 * evenly spaced run right at its own two ends.
 */
function reflect(known: ConstructionPosition, neighbour: ConstructionPosition): ConstructionPosition {
  return { x: 2 * known.x - neighbour.x, y: 2 * known.y - neighbour.y, z: 2 * known.z - neighbour.z };
}

/**
 * The perpendicular XZ distance from `point` to the infinite line through
 * `a`/`b` -- the true sagitta, and not the same thing as `point`'s distance
 * to `a`/`b`'s arithmetic midpoint.
 *
 * Those two coincide only when the parameter halfway between `from` and
 * `to` also lands the curve halfway between `a` and `b` in space -- true
 * for a *uniform* parametrization, false for the centripetal one this file
 * uses on purpose (`catmullRomPoint`'s own doc): a straight but unevenly
 * spaced stretch has its midpoint parameter land closer to whichever
 * neighbour is spaced tighter, off-centre from `a`/`b` even though the
 * curve itself never leaves the line. Measuring against the arithmetic
 * midpoint read that as curvature and subdivided a perfectly straight
 * stretch down to its individual control points for nothing; measuring
 * perpendicular distance from the line reads it for what it is -- zero.
 */
function perpendicularDistanceXZ(point: ConstructionPosition, a: ConstructionPosition, b: ConstructionPosition): number {
  const length = distanceXZ(a, b);
  if (length < 1e-9) return distanceXZ(point, a);
  const cross = (point.x - a.x) * (b.z - a.z) - (point.z - a.z) * (b.x - a.x);
  return Math.abs(cross) / length;
}

function sagittaXZ(
  p0: ConstructionPosition,
  p1: ConstructionPosition,
  p2: ConstructionPosition,
  p3: ConstructionPosition,
  from: number,
  to: number,
): number {
  const midT = (from + to) / 2;
  const mid = catmullRomPoint(p0, p1, p2, p3, midT);
  const a = catmullRomPoint(p0, p1, p2, p3, from);
  const b = catmullRomPoint(p0, p1, p2, p3, to);
  return perpendicularDistanceXZ(mid, a, b);
}

function flatten(
  p0: ConstructionPosition,
  p1: ConstructionPosition,
  p2: ConstructionPosition,
  p3: ConstructionPosition,
  from: number,
  to: number,
  tolerance: number,
  depth: number,
  out: ConstructionPosition[],
): void {
  if (depth < MAX_DEPTH && sagittaXZ(p0, p1, p2, p3, from, to) > tolerance) {
    const mid = (from + to) / 2;
    flatten(p0, p1, p2, p3, from, mid, tolerance, depth + 1, out);
    flatten(p0, p1, p2, p3, mid, to, tolerance, depth + 1, out);
  } else {
    out.push(catmullRomPoint(p0, p1, p2, p3, to));
  }
}

/**
 * Samples a centripetal Catmull-Rom curve through `controlPoints`,
 * flattened so no chord strays from the true curve (in XZ) by more than
 * `tolerance`. Collinear control points flatten to their own straight
 * chords regardless of how unevenly they are spaced -- collinear is
 * collinear under any parametrization -- so the result is exactly
 * `controlPoints` back.
 */
export function sampleCatmullRom(
  controlPoints: readonly ConstructionPosition[],
  tolerance: number,
): readonly ConstructionPosition[] {
  if (controlPoints.length < 2) return controlPoints;
  const last = controlPoints.length - 1;
  const clampedTolerance = Math.max(tolerance, 1e-6);
  const points: ConstructionPosition[] = [controlPoints[0]!];
  for (let index = 0; index < last; index += 1) {
    const p1 = controlPoints[index]!;
    const p2 = controlPoints[index + 1]!;
    const p0 = index === 0 ? reflect(p1, p2) : controlPoints[index - 1]!;
    const p3 = index + 1 === last ? reflect(p2, p1) : controlPoints[index + 2]!;
    flatten(p0, p1, p2, p3, 0, 1, clampedTolerance, 0, points);
  }
  return points;
}
