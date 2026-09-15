import type { ConstructionEdgeGeometry, ConstructionPosition } from "@/ports"; // Generic stroke geometry capability.

/**
 * One fitted edge of a stroke: an endpoint pair plus the contour geometry
 * that actually explains the samples between them -- a straight chord, or a
 * true circular arc through them. This is the graph's own edge vocabulary
 * (`ConstructionEdgeGeometry`), not a private tag a generator has to
 * translate, so a fitted edge is already the thing that gets declared.
 */
export interface FittedEdge {
  readonly start: ConstructionPosition;
  readonly end: ConstructionPosition;
  readonly geometry: ConstructionEdgeGeometry;
}

/**
 * What a caller may vary about a fit. `curves` defaults to `"arc"` (this
 * module's original behavior, kept for every existing caller). Only the
 * wall brush opts into `"bezier"` -- see `wall-shared.ts` -- so a platform's
 * or a path's own contour keeps fitting true circular arcs exactly as it
 * always has.
 */
export interface FitOptions {
  /**
   * Which curved-span family to try for a span that is not already
   * explained by a straight chord, if any. `"none"` fits every span as a
   * chord and never considers a curve at all.
   */
  readonly curves?: "arc" | "bezier" | "none";
}

/**
 * Perpendicular distance (XZ only) from `point` to the infinite line through
 * `a`/`b` -- the classic Ramer-Douglas-Peucker measure, not a distance to
 * the clamped segment (a corner just past `b` still needs to register as
 * "off the line" to be found).
 */
function perpendicularDistance(point: ConstructionPosition, a: ConstructionPosition, b: ConstructionPosition): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return Math.hypot(point.x - a.x, point.z - a.z);
  return Math.abs((point.x - a.x) * dz - (point.z - a.z) * dx) / length;
}

/** Angle of `point` around `center`, in the same XZ convention the graph's own arc evaluation uses (`atan2(z, x)`). */
function angleAround(center: readonly [number, number], point: ConstructionPosition): number {
  return Math.atan2(point.z - center[1], point.x - center[0]);
}

/** Counter-clockwise sweep from `from` to `to`, always in `[0, 2*PI)`. */
function counterClockwiseSweep(from: number, to: number): number {
  const sweep = (to - from) % (Math.PI * 2);
  return sweep < 0 ? sweep + Math.PI * 2 : sweep;
}

/**
 * The center of the unique circle through three XZ points, or `undefined`
 * when they are collinear (no circle, or one of infinite radius -- either
 * way the span is a straight chord, not an arc).
 */
function circumcenterXz(
  a: ConstructionPosition,
  b: ConstructionPosition,
  c: ConstructionPosition,
): readonly [number, number] | undefined {
  const determinant = 2 * ((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
  if (Math.abs(determinant) < 1e-9) return undefined;
  const aLengthSq = a.x * a.x + a.z * a.z;
  const bLengthSq = b.x * b.x + b.z * b.z;
  const cLengthSq = c.x * c.x + c.z * c.z;
  const x = ((bLengthSq - aLengthSq) * (c.z - a.z) - (cLengthSq - aLengthSq) * (b.z - a.z)) / determinant;
  const z = ((cLengthSq - aLengthSq) * (b.x - a.x) - (bLengthSq - aLengthSq) * (c.x - a.x)) / determinant;
  return [x, z];
}

/** A candidate arc for one span: the true circle through its endpoints and one interior point, plus which way it must sweep to actually pass through that point. */
interface ArcCandidate {
  readonly center: readonly [number, number];
  readonly radius: number;
  readonly clockwise: boolean;
}

/**
 * The circular arc running `start` to `end` **through** `via`.
 *
 * The sweep direction is not a preference to be guessed from which side a
 * stroke leans: an arc either passes through the point that was drawn or it
 * does not, and only one of the two ways around the circle does. That makes
 * this general to any included angle -- a quarter turn, a semicircle, a
 * nearly-closed loop -- rather than only the 180-degree case a
 * chord-midpoint center can express.
 */
function arcThrough(
  start: ConstructionPosition,
  via: ConstructionPosition,
  end: ConstructionPosition,
): ArcCandidate | undefined {
  const center = circumcenterXz(start, via, end);
  if (center === undefined) return undefined;
  const radius = Math.hypot(start.x - center[0], start.z - center[1]);
  if (!Number.isFinite(radius) || radius < 1e-6) return undefined;

  const startAngle = angleAround(center, start);
  const toEnd = counterClockwiseSweep(startAngle, angleAround(center, end));
  const toVia = counterClockwiseSweep(startAngle, angleAround(center, via));
  return { center, radius, clockwise: toVia > toEnd };
}

/** A candidate single-segment cubic Bézier for one span: its two off-curve control points, in XZ. */
interface BezierCandidate {
  readonly handle1: readonly [number, number];
  readonly handle2: readonly [number, number];
}

/** Unit vector from `(fromX, fromZ)` to `(toX, toZ)`, or `undefined` when the two coincide. */
function unitDirection(fromX: number, fromZ: number, toX: number, toZ: number): readonly [number, number] | undefined {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const length = Math.hypot(dx, dz);
  return length < 1e-9 ? undefined : [dx / length, dz / length];
}

/** Every sample's own chord-length parameter in `[0, 1]` across `points[startIndex..endIndex]`, plus the run's total chord length. */
function chordLengthParameters(
  points: readonly ConstructionPosition[],
  startIndex: number,
  endIndex: number,
): { readonly parameters: readonly number[]; readonly total: number } {
  const cumulative: number[] = [0];
  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    cumulative.push(cumulative[cumulative.length - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const total = cumulative[cumulative.length - 1]!;
  return { parameters: total < 1e-6 ? cumulative.map(() => 0) : cumulative.map((c) => c / total), total };
}

/**
 * Single-segment least-squares cubic Bézier through `points[startIndex..endIndex]`,
 * its two endpoints fixed -- the single-segment case of Schneider's
 * curve-fitting algorithm (Graphics Gems). Tangent *directions* at each end
 * are estimated from the immediately neighboring sample; only their two
 * scalar reach magnitudes are actually fit, via the standard 2x2
 * least-squares normal-equations system this reduces to. Falls back to a
 * plain one-third-chord placement (the ordinary default control points for a
 * cubic with no better information) whenever that system is degenerate
 * (near-collinear tangents) or produces a magnitude that would pull a
 * handle behind its own endpoint instead of forward along the curve.
 */
function bezierThrough(
  points: readonly ConstructionPosition[],
  startIndex: number,
  endIndex: number,
): BezierCandidate | undefined {
  const start = points[startIndex];
  const end = points[endIndex];
  if (start === undefined || end === undefined) return undefined;
  const chordLength = Math.hypot(end.x - start.x, end.z - start.z);
  if (chordLength < 1e-6) return undefined;

  const fallback = (): BezierCandidate | undefined => {
    const forward = unitDirection(start.x, start.z, end.x, end.z);
    if (forward === undefined) return undefined;
    const reach = chordLength / 3;
    return {
      handle1: [start.x + forward[0] * reach, start.z + forward[1] * reach],
      handle2: [end.x - forward[0] * reach, end.z - forward[1] * reach],
    };
  };

  const next = points[startIndex + 1];
  const previous = points[endIndex - 1];
  const t1 = next !== undefined ? unitDirection(start.x, start.z, next.x, next.z) : undefined;
  const t2 = previous !== undefined ? unitDirection(end.x, end.z, previous.x, previous.z) : undefined;
  if (t1 === undefined || t2 === undefined) return fallback();

  const { parameters, total } = chordLengthParameters(points, startIndex, endIndex);
  if (total < 1e-6) return fallback();

  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let c1 = 0;
  let c2 = 0;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const u = parameters[index - startIndex]!;
    const oneMinusU = 1 - u;
    const b1 = 3 * u * oneMinusU * oneMinusU;
    const b2 = 3 * u * u * oneMinusU;
    const weightStart = oneMinusU * oneMinusU * oneMinusU + b1;
    const weightEnd = b2 + u * u * u;
    const point = points[index]!;
    const rx = point.x - (weightStart * start.x + weightEnd * end.x);
    const rz = point.z - (weightStart * start.z + weightEnd * end.z);
    const tangentDot = t1[0] * t2[0] + t1[1] * t2[1];
    a11 += b1 * b1;
    a12 += b1 * b2 * tangentDot;
    a22 += b2 * b2;
    c1 += b1 * (rx * t1[0] + rz * t1[1]);
    c2 += b2 * (rx * t2[0] + rz * t2[1]);
  }
  const determinant = a11 * a22 - a12 * a12;
  if (Math.abs(determinant) < 1e-9) return fallback();
  const alpha1 = (c1 * a22 - c2 * a12) / determinant;
  const alpha2 = (a11 * c2 - a12 * c1) / determinant;
  const minimumReach = chordLength * 1e-3;
  if (!(alpha1 > minimumReach) || !(alpha2 > minimumReach)) return fallback();

  return {
    handle1: [start.x + t1[0] * alpha1, start.z + t1[1] * alpha1],
    handle2: [end.x + t2[0] * alpha2, end.z + t2[1] * alpha2],
  };
}

/**
 * Worst deviation between `points[startIndex..endIndex]` and `bezier`,
 * evaluated at each sample's own chord-length parameter -- no closest-point
 * search needed, since that parameterization is already assigned.
 */
function bezierResidual(
  points: readonly ConstructionPosition[],
  startIndex: number,
  endIndex: number,
  bezier: BezierCandidate,
): number {
  const start = points[startIndex]!;
  const end = points[endIndex]!;
  const { parameters, total } = chordLengthParameters(points, startIndex, endIndex);
  if (total < 1e-6) return 0;
  let worst = 0;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const u = parameters[index - startIndex]!;
    const oneMinusU = 1 - u;
    const b0 = oneMinusU * oneMinusU * oneMinusU;
    const b1 = 3 * u * oneMinusU * oneMinusU;
    const b2 = 3 * u * u * oneMinusU;
    const b3 = u * u * u;
    const x = b0 * start.x + b1 * bezier.handle1[0] + b2 * bezier.handle2[0] + b3 * end.x;
    const z = b0 * start.z + b1 * bezier.handle1[1] + b2 * bezier.handle2[1] + b3 * end.z;
    const point = points[index]!;
    worst = Math.max(worst, Math.hypot(point.x - x, point.z - z));
  }
  return worst;
}

/** The interior sample that wanders furthest off the span's own chord -- where any real curvature is most visible, and the point an arc has to be made to pass through. */
function furthestFromChord(
  points: readonly ConstructionPosition[],
  startIndex: number,
  endIndex: number,
  start: ConstructionPosition,
  end: ConstructionPosition,
): { readonly point: ConstructionPosition; readonly index: number; readonly distance: number } | undefined {
  let best: { point: ConstructionPosition; index: number; distance: number } | undefined;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const point = points[index];
    if (point === undefined) continue;
    const distance = perpendicularDistance(point, start, end);
    if (best === undefined || distance > best.distance) best = { point, index, distance };
  }
  return best;
}

/**
 * How well `points[startIndex..endIndex]` is explained by treating `start`
 * and `end` as one edge: `straightResidual` (worst perpendicular distance
 * from the chord) and `curveResidual` (worst deviation from whichever curve
 * family `curves` asks for -- radial distance from the true circle through
 * the endpoints and the span's own furthest interior point for `"arc"`, or
 * deviation from the least-squares cubic for `"bezier"`).
 *
 * Shared by {@link cornerIndices} (deciding *where* a real corner is) and
 * {@link classifySegment} (deciding straight vs. curved for one already
 * corner-bounded span) so the two never disagree about what "fits" means.
 */
function computeResiduals(
  points: readonly ConstructionPosition[],
  startIndex: number,
  endIndex: number,
  curves: "arc" | "bezier" | "none",
): { readonly straightResidual: number; readonly curveResidual: number; readonly arc: ArcCandidate | undefined; readonly bezier: BezierCandidate | undefined } {
  const start = points[startIndex];
  const end = points[endIndex];
  if (start === undefined || end === undefined) {
    return { straightResidual: 0, curveResidual: Infinity, arc: undefined, bezier: undefined };
  }

  const apex = furthestFromChord(points, startIndex, endIndex, start, end);
  const straightResidual = apex?.distance ?? 0;

  // A curve is *made* to pass close to the samples, so a span holding a
  // single interior point can be fit almost exactly no matter how the hand
  // actually moved -- for an arc that is literally the circle through three
  // points, which always exists. Curvature has to be corroborated by at
  // least one other sample before it means anything.
  const chordLength = Math.hypot(end.x - start.x, end.z - start.z);
  if (curves === "none" || apex === undefined || chordLength < 1e-6 || endIndex - startIndex < 3) {
    return { straightResidual, curveResidual: Infinity, arc: undefined, bezier: undefined };
  }

  if (curves === "arc") {
    const arc = arcThrough(start, apex.point, end);
    if (arc === undefined) return { straightResidual, curveResidual: Infinity, arc: undefined, bezier: undefined };
    let arcResidual = 0;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const point = points[index];
      if (point === undefined) continue;
      const distanceFromCenter = Math.hypot(point.x - arc.center[0], point.z - arc.center[1]);
      arcResidual = Math.max(arcResidual, Math.abs(distanceFromCenter - arc.radius));
    }
    return { straightResidual, curveResidual: arcResidual, arc, bezier: undefined };
  }

  const bezier = bezierThrough(points, startIndex, endIndex);
  if (bezier === undefined) return { straightResidual, curveResidual: Infinity, arc: undefined, bezier: undefined };
  const curveResidual = bezierResidual(points, startIndex, endIndex, bezier);
  return { straightResidual, curveResidual, arc: undefined, bezier };
}

/**
 * Ramer-Douglas-Peucker corner detection, extended to accept a curved span
 * as a single edge: `points[startIndex..endIndex]` needs no split at all if
 * it is already well explained by *either* a straight chord or the
 * requested curve family ({@link computeResiduals}) -- plain RDP
 * (straight-only) would otherwise slice a genuinely smooth curve into many
 * false corners, since a curve's own interior points routinely sit far from
 * its straight chord even though no real corner is there. Only when
 * *neither* shape explains the span within `tolerance` does this fall back
 * to classic RDP's own corner-finding (split at the point of max
 * chord-deviation, recurse both halves). Always keeps the first and last
 * index.
 */
function cornerIndices(
  points: readonly ConstructionPosition[],
  tolerance: number,
  curves: "arc" | "bezier" | "none",
): readonly number[] {
  function recurse(startIndex: number, endIndex: number): number[] {
    if (endIndex - startIndex < 2) return [startIndex, endIndex];

    const { straightResidual, curveResidual } = computeResiduals(points, startIndex, endIndex, curves);
    if (straightResidual <= tolerance || curveResidual <= tolerance) return [startIndex, endIndex];

    const start = points[startIndex];
    const end = points[endIndex];
    if (start === undefined || end === undefined) return [startIndex, endIndex];

    const apex = furthestFromChord(points, startIndex, endIndex, start, end);
    if (apex === undefined) return [startIndex, endIndex];

    const left = recurse(startIndex, apex.index);
    const right = recurse(apex.index, endIndex);
    return [...left.slice(0, -1), ...right];
  }

  return recurse(0, points.length - 1);
}

/**
 * How much smaller a span's own best-fit-curve residual must be than its
 * best-fit-straight-line residual before it is worth calling a curve at all
 * -- below this, a straight edge already reads as intentional and a curve
 * would just be fitting hand tremor. Shared by both curve families: neither
 * is a more or less "deliberate" shape than the other.
 */
const CURVE_MUST_BEAT_STRAIGHT_RATIO = 0.6;
/**
 * How far the raw samples may sit from the fitted curve and still count as
 * genuine curvature, as a fraction of whichever is smaller: the curve's own
 * characteristic size (an arc's radius; a Bézier's chord, which has no
 * separate radius of its own), or the span's own chord. Scaling by the
 * smaller of the two is what keeps a nearly-straight span -- which fits an
 * enormous circle, or a nearly-flat cubic -- from being handed an enormous
 * allowance and committed as a curve.
 */
const CURVE_RESIDUAL_MAX_RATIO = 0.3;

const LINE: ConstructionEdgeGeometry = { kind: "line" };

function curveGeometry(arc: ArcCandidate | undefined, bezier: BezierCandidate | undefined): ConstructionEdgeGeometry {
  if (arc !== undefined) return { kind: "arc", center: arc.center, clockwise: arc.clockwise };
  return { kind: "bezier", handle1: bezier!.handle1, handle2: bezier!.handle2 };
}

/**
 * Classifies one already-corner-bounded run of raw samples as a straight
 * chord or the requested curve family through it. The curve is accepted
 * only if its own worst-case residual is both small in absolute terms
 * ({@link CURVE_RESIDUAL_MAX_RATIO}) and meaningfully better than treating
 * the same run as straight ({@link CURVE_MUST_BEAT_STRAIGHT_RATIO}).
 */
function classifySegment(
  points: readonly ConstructionPosition[],
  startIndex: number,
  endIndex: number,
  curves: "arc" | "bezier" | "none",
  tolerance: number,
): FittedEdge {
  const start = points[startIndex];
  const end = points[endIndex];
  if (start === undefined || end === undefined) throw new Error("classifySegment: index out of range");
  if (endIndex - startIndex < 2) return { start, end, geometry: LINE };

  const { straightResidual, curveResidual, arc, bezier } = computeResiduals(points, startIndex, endIndex, curves);
  if (arc === undefined && bezier === undefined) return { start, end, geometry: LINE };

  // This span survived {@link cornerIndices} without being split, which
  // means *some* shape explained it within `tolerance`. If a straight chord
  // is not that shape, the ratio heuristics below must not be allowed to
  // pick one anyway: they exist to choose between two shapes that both fit,
  // never to commit one that does not. Without this the span could be held
  // together by its curve and then committed as a chord wandering
  // arbitrarily far outside the brush the user actually drew -- the fit
  // silently breaking the one promise the correction dial makes.
  if (straightResidual > tolerance && curveResidual <= tolerance) {
    return { start, end, geometry: curveGeometry(arc, bezier) };
  }

  const chordLength = Math.hypot(end.x - start.x, end.z - start.z);
  const characteristicSize = arc !== undefined ? arc.radius : chordLength;
  const allowance = Math.min(characteristicSize, chordLength) * CURVE_RESIDUAL_MAX_RATIO;
  const curveFitsWellEnough = curveResidual < allowance && curveResidual < straightResidual * CURVE_MUST_BEAT_STRAIGHT_RATIO;
  if (!curveFitsWellEnough) return { start, end, geometry: LINE };
  return { start, end, geometry: curveGeometry(arc, bezier) };
}

/**
 * Turns a raw, hand-drawn stroke (every pointer sample, wobble included)
 * into a short list of fitted edges: corners are found first
 * (Ramer-Douglas-Peucker, {@link cornerIndices}), then each run between
 * corners is classified ({@link classifySegment}) as a straight chord or
 * the requested curve family through it.
 *
 * `tolerance` (world units) is the whole correction dial -- how far the raw
 * stroke must wander off *both* a straight line and its best-fit curve
 * before that counts as a real corner rather than hand tremor or ordinary
 * curvature. At `0` the contour is committed literally; the larger it gets,
 * the more freely a shaky stroke is straightened into clean runs. Fewer
 * than 2 points fits to nothing.
 *
 * With `curves: "none"` every span is a chord, however round the samples
 * look. That is for a caller whose samples are no longer a hand -- points
 * landing on exact grid intersections, say -- where the circle (or cubic)
 * through any few of them is a shape nobody drew.
 */
export function fitPath(
  points: readonly ConstructionPosition[],
  tolerance: number,
  options: FitOptions = {},
): readonly FittedEdge[] {
  if (points.length < 2) return [];
  const curves = options.curves ?? "arc";
  const budget = Math.max(0, tolerance);
  const indices = cornerIndices(points, budget, curves);
  const edges: FittedEdge[] = [];
  for (let index = 0; index + 1 < indices.length; index += 1) {
    const startIndex = indices[index];
    const endIndex = indices[index + 1];
    if (startIndex === undefined || endIndex === undefined || startIndex === endIndex) continue;
    edges.push(classifySegment(points, startIndex, endIndex, curves, budget));
  }
  return edges;
}
