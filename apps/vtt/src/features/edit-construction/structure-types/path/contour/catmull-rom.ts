import type { ConstructionPosition } from "@/ports";
import type { SweptArc } from "../../../topology/index.ts";

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

/**
 * The angular sweep and radius of the true circle `start` -> `end` runs on,
 * per `arc` -- the same reading `referenceLineFrom`'s own arc walk takes of
 * a {@link FittedEdge}, just off two plain points instead of one.
 * `undefined` for a degenerate (zero-radius) circle, which has no arc left
 * to sample.
 */
function arcSweep(
  start: ConstructionPosition,
  end: ConstructionPosition,
  arc: SweptArc,
): { readonly centerX: number; readonly centerZ: number; readonly radius: number; readonly startAngle: number; readonly sweep: number } | undefined {
  const [centerX, centerZ] = arc.center;
  const radius = Math.hypot(start.x - centerX, start.z - centerZ);
  if (!Number.isFinite(radius) || radius < 1e-6) return undefined;
  const startAngle = Math.atan2(start.z - centerZ, start.x - centerX);
  const endAngle = Math.atan2(end.z - centerZ, end.x - centerX);
  const counterClockwise = (endAngle - startAngle + Math.PI * 2) % (Math.PI * 2);
  const sweep = arc.clockwise ? Math.PI * 2 - counterClockwise : counterClockwise;
  return { centerX, centerZ, radius, startAngle, sweep };
}

/**
 * Appends `start` -> `end`'s own true arc to `out` (never `start` itself,
 * matching `flatten`'s convention), stepped so no chord strays from the
 * circle by more than `tolerance` -- same sagitta formula
 * `referenceLineFrom` already tessellates a fitted arc with. Returns `false`
 * for a degenerate circle, leaving `out` untouched so the caller can fall
 * back to a straight chord instead.
 */
function sampleArcSpan(
  start: ConstructionPosition,
  end: ConstructionPosition,
  arc: SweptArc,
  tolerance: number,
  out: ConstructionPosition[],
): boolean {
  const resolved = arcSweep(start, end, arc);
  if (resolved === undefined) return false;
  const { centerX, centerZ, radius, startAngle, sweep } = resolved;
  const maxStep = radius > tolerance ? 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / radius))) : Math.PI;
  const steps = Math.max(1, Math.ceil(sweep / Math.max(maxStep, 1e-6)));
  for (let step = 1; step <= steps; step += 1) {
    if (step === steps) {
      out.push(end);
      continue;
    }
    const t = step / steps;
    const angle = arc.clockwise ? startAngle - sweep * t : startAngle + sweep * t;
    out.push({
      x: centerX + radius * Math.cos(angle),
      y: start.y + (end.y - start.y) * t,
      z: centerZ + radius * Math.sin(angle),
    });
  }
  return true;
}

/**
 * Samples one spine chain's curve honoring real fitted arcs where the
 * caller has them, and falling back to {@link sampleCatmullRom}'s own
 * Catmull-Rom window everywhere else.
 *
 * A curve the stroke fitter already recognised as a true circle
 * (`stroke-fitting.ts`'s `fitPath`) stays that circle here instead of being
 * re-approximated into chords every time its contour regenerates -- the
 * same "one arc, not fifty chords" property `sweep-formation.ts` already
 * gives a wall. `arcs[index]` describes the span from `controlPoints[index]`
 * to `controlPoints[index + 1]`; `undefined` there (an ordinary bend, a
 * corrected/welded endpoint, ground the fit never saw) falls back to the
 * Catmull-Rom window that span already used. `segmentArcs` mirrors the
 * output points the same way, one entry per consecutive pair -- `undefined`
 * unless that pair still lies on a real arc, which is what
 * {@link offsetBands} and the contour patch need to keep the geometry past
 * this point.
 */
export function sampleSpineCurve(
  controlPoints: readonly ConstructionPosition[],
  arcs: readonly (SweptArc | undefined)[],
  tolerance: number,
): { readonly points: readonly ConstructionPosition[]; readonly segmentArcs: readonly (SweptArc | undefined)[] } {
  if (controlPoints.length < 2) return { points: controlPoints, segmentArcs: [] };
  const last = controlPoints.length - 1;
  const clampedTolerance = Math.max(tolerance, 1e-6);
  const points: ConstructionPosition[] = [controlPoints[0]!];
  const segmentArcs: (SweptArc | undefined)[] = [];
  for (let index = 0; index < last; index += 1) {
    const p1 = controlPoints[index]!;
    const p2 = controlPoints[index + 1]!;
    const arc = arcs[index];
    const before = points.length;
    if (arc !== undefined && sampleArcSpan(p1, p2, arc, clampedTolerance, points)) {
      for (let added = points.length - before; added > 0; added -= 1) segmentArcs.push(arc);
      continue;
    }
    const p0 = index === 0 ? reflect(p1, p2) : controlPoints[index - 1]!;
    const p3 = index + 1 === last ? reflect(p2, p1) : controlPoints[index + 2]!;
    flatten(p0, p1, p2, p3, 0, 1, clampedTolerance, 0, points);
    for (let added = points.length - before; added > 0; added -= 1) segmentArcs.push(undefined);
  }
  return { points, segmentArcs };
}
