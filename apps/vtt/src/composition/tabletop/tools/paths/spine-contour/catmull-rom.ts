import type { ConstructionPosition } from "@/ports";

/**
 * TS mirror of `grafting-procgen-curve-offset`'s `sample_catmull_rom` (Estágio
 * 1). Kept as a TS port rather than an actual Rust/WASM call for now -- wiring
 * the crate through `construction-wasm`'s wasm-bindgen boundary needs a
 * `wasm-pack build` and a verified load path through this repo's Node test
 * runner, neither of which this stage risks without checking first. The
 * algorithm is identical to `curve-offset/src/curve.rs`, height included: a
 * spine control point carries `y`, and Catmull-Rom's weighted sum applies
 * per component the same as any other, so height rides along for free
 * instead of needing a second interpolation pass. Only the *sagitta test*
 * that decides where to subdivide looks at XZ alone, matching how every
 * other tolerance in this codebase (`ARC_TESSELLATION_TOLERANCE`, the fit
 * tolerances in `stroke-fitting.ts`) is a ground-plane precision, not a
 * height one.
 */

const MAX_DEPTH = 16;

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

function catmullRomPoint(
  p0: ConstructionPosition,
  p1: ConstructionPosition,
  p2: ConstructionPosition,
  p3: ConstructionPosition,
  t: number,
): ConstructionPosition {
  const t2 = t * t;
  const t3 = t2 * t;
  const a = scale(p1, 2);
  const b = scale(sub(p2, p0), t);
  const c = scale(add(scale(p0, 2), add(scale(p1, -5), add(scale(p2, 4), scale(p3, -1)))), t2);
  const d = scale(add(scale(p0, -1), add(scale(p1, 3), add(scale(p2, -3), p3))), t3);
  return scale(add(add(a, b), add(c, d)), 0.5);
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
  const chordMid = scale(add(a, b), 0.5);
  return distanceXZ(mid, chordMid);
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
 * Samples a uniform Catmull-Rom curve through `controlPoints`, flattened so
 * no chord strays from the true curve (in XZ) by more than `tolerance`.
 * Collinear, evenly spaced control points flatten to their own straight
 * chords -- the sagitta is zero everywhere, so the result is exactly
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
