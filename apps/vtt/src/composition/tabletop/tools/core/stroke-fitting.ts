import type { ConstructionEdgeGeometry, ConstructionPosition } from "@/ports";

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

/** What a caller may vary about a fit. `arcs` defaults to on. */
export interface FitOptions {
  /** When false, every span is fitted as a straight chord and no circle is ever considered. */
  readonly arcs?: boolean;
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
 * from the chord) and `arcResidual` (worst radial distance from the true
 * circle through the endpoints and the span's own furthest interior point).
 *
 * Shared by {@link cornerIndices} (deciding *where* a real corner is) and
 * {@link classifySegment} (deciding straight vs. arc for one already
 * corner-bounded span) so the two never disagree about what "fits" means.
 */
function computeResiduals(
  points: readonly ConstructionPosition[],
  startIndex: number,
  endIndex: number,
  arcs: boolean,
): { readonly straightResidual: number; readonly arcResidual: number; readonly arc: ArcCandidate | undefined } {
  const start = points[startIndex];
  const end = points[endIndex];
  if (start === undefined || end === undefined) return { straightResidual: 0, arcResidual: Infinity, arc: undefined };

  const apex = furthestFromChord(points, startIndex, endIndex, start, end);
  const straightResidual = apex?.distance ?? 0;

  // An arc is *made* to pass through the apex, so a span holding a single
  // interior point fits one exactly, at zero residual, no matter how the
  // hand actually moved. That is not evidence of curvature -- it is the
  // circle through three points, which always exists. Curvature has to be
  // corroborated by at least one other sample before it means anything.
  const chordLength = Math.hypot(end.x - start.x, end.z - start.z);
  if (!arcs || apex === undefined || chordLength < 1e-6 || endIndex - startIndex < 3) {
    return { straightResidual, arcResidual: Infinity, arc: undefined };
  }

  const arc = arcThrough(start, apex.point, end);
  if (arc === undefined) return { straightResidual, arcResidual: Infinity, arc: undefined };

  let arcResidual = 0;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const point = points[index];
    if (point === undefined) continue;
    const distanceFromCenter = Math.hypot(point.x - arc.center[0], point.z - arc.center[1]);
    arcResidual = Math.max(arcResidual, Math.abs(distanceFromCenter - arc.radius));
  }
  return { straightResidual, arcResidual, arc };
}

/**
 * Ramer-Douglas-Peucker corner detection, extended to accept a curved span
 * as a single edge: `points[startIndex..endIndex]` needs no split at all if
 * it is already well explained by *either* a straight chord or the true
 * circle through it ({@link computeResiduals}) -- plain RDP (straight-only)
 * would otherwise slice a genuinely smooth arc into many false corners,
 * since a curve's own interior points routinely sit far from its straight
 * chord even though no real corner is there. Only when *neither* shape
 * explains the span within `tolerance` does this fall back to classic RDP's
 * own corner-finding (split at the point of max chord-deviation, recurse
 * both halves). Always keeps the first and last index.
 */
function cornerIndices(
  points: readonly ConstructionPosition[],
  tolerance: number,
  arcs: boolean,
): readonly number[] {
  function recurse(startIndex: number, endIndex: number): number[] {
    if (endIndex - startIndex < 2) return [startIndex, endIndex];

    const { straightResidual, arcResidual } = computeResiduals(points, startIndex, endIndex, arcs);
    if (straightResidual <= tolerance || arcResidual <= tolerance) return [startIndex, endIndex];

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
 * How much smaller a span's own best-fit-arc residual must be than its
 * best-fit-straight-line residual before it is worth calling a curve at all
 * -- below this, a straight edge already reads as intentional and a curve
 * would just be fitting hand tremor.
 */
const ARC_MUST_BEAT_STRAIGHT_RATIO = 0.6;
/**
 * How far the raw samples may sit from the fitted circle and still count as
 * a genuine arc, as a fraction of whichever is smaller: the arc's own
 * radius, or the span's own chord. Scaling by the smaller of the two is
 * what keeps a nearly-straight span -- which fits an enormous circle --
 * from being handed an enormous allowance and committed as a curve.
 */
const ARC_RESIDUAL_MAX_RATIO = 0.3;

const LINE: ConstructionEdgeGeometry = { kind: "line" };

/**
 * Classifies one already-corner-bounded run of raw samples as a straight
 * chord or the true circular arc through it. The arc is accepted only if
 * its own worst-case residual is both small in absolute terms
 * ({@link ARC_RESIDUAL_MAX_RATIO}) and meaningfully better than treating the
 * same run as straight ({@link ARC_MUST_BEAT_STRAIGHT_RATIO}).
 */
function classifySegment(
  points: readonly ConstructionPosition[],
  startIndex: number,
  endIndex: number,
  arcs: boolean,
  tolerance: number,
): FittedEdge {
  const start = points[startIndex];
  const end = points[endIndex];
  if (start === undefined || end === undefined) throw new Error("classifySegment: index out of range");
  if (endIndex - startIndex < 2) return { start, end, geometry: LINE };

  const { straightResidual, arcResidual, arc } = computeResiduals(points, startIndex, endIndex, arcs);
  if (arc === undefined) return { start, end, geometry: LINE };

  // This span survived {@link cornerIndices} without being split, which
  // means *some* shape explained it within `tolerance`. If a straight chord
  // is not that shape, the ratio heuristics below must not be allowed to
  // pick one anyway: they exist to choose between two shapes that both fit,
  // never to commit one that does not. Without this the span could be held
  // together by its arc and then committed as a chord wandering arbitrarily
  // far outside the brush the user actually drew -- the fit silently
  // breaking the one promise the correction dial makes.
  if (straightResidual > tolerance && arcResidual <= tolerance) {
    return { start, end, geometry: { kind: "arc", center: arc.center, clockwise: arc.clockwise } };
  }

  const chordLength = Math.hypot(end.x - start.x, end.z - start.z);
  const allowance = Math.min(arc.radius, chordLength) * ARC_RESIDUAL_MAX_RATIO;
  const arcFitsWellEnough = arcResidual < allowance && arcResidual < straightResidual * ARC_MUST_BEAT_STRAIGHT_RATIO;
  if (!arcFitsWellEnough) return { start, end, geometry: LINE };
  return { start, end, geometry: { kind: "arc", center: arc.center, clockwise: arc.clockwise } };
}

/**
 * Turns a raw, hand-drawn stroke (every pointer sample, wobble included)
 * into a short list of fitted edges: corners are found first
 * (Ramer-Douglas-Peucker, {@link cornerIndices}), then each run between
 * corners is classified ({@link classifySegment}) as a straight chord or
 * the true circle through it.
 *
 * `tolerance` (world units) is the whole correction dial -- how far the raw
 * stroke must wander off *both* a straight line and its best-fit arc before
 * that counts as a real corner rather than hand tremor or ordinary
 * curvature. At `0` the contour is committed literally; the larger it gets,
 * the more freely a shaky stroke is straightened into clean runs. Fewer
 * than 2 points fits to nothing.
 *
 * With `arcs` off every span is a chord, however round the samples look.
 * That is for a caller whose samples are no longer a hand -- points landing
 * on exact grid intersections, say -- where the circle through any three of
 * them is a real circle that nobody drew.
 */
export function fitPath(
  points: readonly ConstructionPosition[],
  tolerance: number,
  options: FitOptions = {},
): readonly FittedEdge[] {
  if (points.length < 2) return [];
  const arcs = options.arcs ?? true;
  const budget = Math.max(0, tolerance);
  const indices = cornerIndices(points, budget, arcs);
  const edges: FittedEdge[] = [];
  for (let index = 0; index + 1 < indices.length; index += 1) {
    const startIndex = indices[index];
    const endIndex = indices[index + 1];
    if (startIndex === undefined || endIndex === undefined || startIndex === endIndex) continue;
    edges.push(classifySegment(points, startIndex, endIndex, arcs, budget));
  }
  return edges;
}
