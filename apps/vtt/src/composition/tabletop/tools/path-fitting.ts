import type { ConstructionPosition } from "@/ports";

/** One fitted edge of a stroke: an endpoint pair plus which of the engine's own known curvatures (never a free curve) it was classified as. */
export interface FittedEdge {
  readonly start: ConstructionPosition;
  readonly end: ConstructionPosition;
  readonly curvature: "straight" | "arc-left" | "arc-right";
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

/**
 * How well `points[startIndex..endIndex]` is explained by treating `start`
 * (`points[startIndex]`) and `end` (`points[endIndex]`) as one edge --
 * `straightResidual` (worst perpendicular distance from the chord) and
 * `arcResidual` (worst distance from the *exact* semicircle the chord
 * determines, per `extrusion.rs`'s own doc: radius is half the chord,
 * center is its midpoint, never a free parameter). `bulge` is which side of
 * the chord the interior points actually lean toward, meaningful only when
 * `arcResidual` ends up the better fit. Shared by {@link cornerIndices}
 * (deciding *where* a real corner is) and {@link classifySegment} (deciding
 * straight vs. arc for one already-corner-bounded span) so the two never
 * disagree about what "fits" means.
 */
function computeResiduals(
  points: readonly ConstructionPosition[],
  startIndex: number,
  endIndex: number,
): { straightResidual: number; arcResidual: number; radius: number; bulge: "arc-left" | "arc-right" } {
  const start = points[startIndex];
  const end = points[endIndex];
  if (start === undefined || end === undefined) return { straightResidual: 0, arcResidual: Infinity, radius: 0, bulge: "arc-left" };

  let straightResidual = 0;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const point = points[index];
    if (point === undefined) continue;
    straightResidual = Math.max(straightResidual, perpendicularDistance(point, start, end));
  }

  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const chordLength = Math.hypot(dx, dz);
  if (chordLength < 1e-6) return { straightResidual, arcResidual: Infinity, radius: 0, bulge: "arc-left" };

  const nx = -dz / chordLength;
  const nz = dx / chordLength;
  const center: ConstructionPosition = { x: (start.x + end.x) / 2, y: start.y, z: (start.z + end.z) / 2 };
  const radius = chordLength / 2;

  let bulgeSum = 0;
  let arcResidual = 0;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const point = points[index];
    if (point === undefined) continue;
    bulgeSum += (point.x - start.x) * nx + (point.z - start.z) * nz;
    const distanceFromCenter = Math.hypot(point.x - center.x, point.z - center.z);
    arcResidual = Math.max(arcResidual, Math.abs(distanceFromCenter - radius));
  }

  return { straightResidual, arcResidual, radius, bulge: bulgeSum >= 0 ? "arc-left" : "arc-right" };
}

/**
 * Ramer-Douglas-Peucker corner detection, extended to accept a curved span
 * as a single edge: `points[startIndex..endIndex]` needs no split at all if
 * it's already well explained by *either* a straight chord or the exact
 * semicircle that chord determines ({@link computeResiduals}) -- plain RDP
 * (straight-only) would otherwise slice a genuinely smooth arc into many
 * false corners, since a curve's own interior points routinely sit far from
 * its straight chord even though no real corner is there. Only when
 * *neither* shape explains the span within `epsilon` does this fall back to
 * classic RDP's own corner-finding (split at the point of max
 * chord-deviation, recurse both halves). Always keeps the first and last
 * index.
 */
function cornerIndices(points: readonly ConstructionPosition[], epsilon: number): readonly number[] {
  function recurse(startIndex: number, endIndex: number): number[] {
    if (endIndex - startIndex < 2) return [startIndex, endIndex];

    const { straightResidual, arcResidual } = computeResiduals(points, startIndex, endIndex);
    if (straightResidual <= epsilon || arcResidual <= epsilon) return [startIndex, endIndex];

    const start = points[startIndex];
    const end = points[endIndex];
    if (start === undefined || end === undefined) return [startIndex, endIndex];

    let maxDistance = -1;
    let maxIndex = -1;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const point = points[index];
      if (point === undefined) continue;
      const distance = perpendicularDistance(point, start, end);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = index;
      }
    }
    if (maxIndex === -1) return [startIndex, endIndex];

    const left = recurse(startIndex, maxIndex);
    const right = recurse(maxIndex, endIndex);
    return [...left.slice(0, -1), ...right];
  }

  return recurse(0, points.length - 1);
}

/**
 * How much smaller a segment's own best-fit-semicircle residual must be
 * than its best-fit-straight-line residual before it's worth calling a
 * curve at all -- below this, a straight edge already reads as intentional
 * and a curve would just be fitting hand tremor.
 */
const ARC_MUST_BEAT_STRAIGHT_RATIO = 0.6;
/**
 * How far (as a fraction of the semicircle's own radius) the raw samples
 * may sit from the exact arc and still count as a genuine semicircle, not
 * a free-form wobble the engine's fixed vocabulary (see `extrusion.rs`'s
 * own doc) has no shape for -- if even the best-fit semicircle's own
 * residual exceeds this, the segment falls back to straight rather than
 * committing a curve that doesn't actually match what was drawn.
 */
const ARC_RESIDUAL_MAX_RATIO = 0.3;

/**
 * Classifies one already-corner-bounded run of raw samples as `"straight"`
 * or the exact semicircle ({@link computeResiduals}) that best matches it --
 * never a free curve. The fit is accepted only if that exact semicircle's
 * own worst-case residual is both small in absolute terms
 * ({@link ARC_RESIDUAL_MAX_RATIO}) and meaningfully better than treating the
 * same run as straight ({@link ARC_MUST_BEAT_STRAIGHT_RATIO}) -- otherwise
 * this falls back to straight, since the engine has no shape between the
 * two.
 */
function classifySegment(points: readonly ConstructionPosition[], startIndex: number, endIndex: number): FittedEdge {
  const start = points[startIndex];
  const end = points[endIndex];
  if (start === undefined || end === undefined) throw new Error("classifySegment: index out of range");
  if (endIndex - startIndex < 2) return { start, end, curvature: "straight" };

  const { straightResidual, arcResidual, radius, bulge } = computeResiduals(points, startIndex, endIndex);
  const arcFitsWellEnough = arcResidual < radius * ARC_RESIDUAL_MAX_RATIO && arcResidual < straightResidual * ARC_MUST_BEAT_STRAIGHT_RATIO;
  return { start, end, curvature: arcFitsWellEnough ? bulge : "straight" };
}

/**
 * Turns a raw, hand-drawn stroke (every pointer sample, wobble included)
 * into a short list of fitted edges drawn only from the engine's own known
 * vocabulary (`"straight" | "arc-left" | "arc-right"`, see `wall-shared.ts`'s
 * own `PathEdgeSpec` doc) -- this is `wall-brush-tool.ts`'s "fragmentar em
 * contornos conhecidos" step: corners are found first (Ramer-Douglas-Peucker,
 * {@link cornerIndices}), then each run between corners is classified
 * ({@link classifySegment}) as whichever known shape actually matches it.
 * `cornerEpsilon` (world units) is the RDP tolerance -- how far the raw
 * stroke must wander off *both* a straight line and the best-fit semicircle
 * before that counts as a real corner rather than hand tremor or ordinary
 * curvature. Fewer than 2 points fits to nothing.
 *
 * Known v1 limitation: a stroke that genuinely mixes a straight run with a
 * true semicircular turn (not just a straight run alone, or a curve alone)
 * finds the straight/curve boundary correctly, but the curved remainder can
 * fall back to several short straight chords instead of being recognized as
 * one arc -- {@link cornerIndices}'s top-down splitting picks its first cut
 * at the point of maximum deviation from the *whole* stroke's own outer
 * chord (usually the curve's own apex), which can land before the full
 * curved span is ever tested as one candidate arc in its own right. Still a
 * large improvement over one straight panel per raw pointer sample; see
 * `path-fitting.test.mjs`'s own test for this exact case.
 */
export function fitPath(points: readonly ConstructionPosition[], cornerEpsilon: number): readonly FittedEdge[] {
  if (points.length < 2) return [];
  const indices = cornerIndices(points, cornerEpsilon);
  const edges: FittedEdge[] = [];
  for (let index = 0; index + 1 < indices.length; index += 1) {
    const startIndex = indices[index];
    const endIndex = indices[index + 1];
    if (startIndex === undefined || endIndex === undefined || startIndex === endIndex) continue;
    edges.push(classifySegment(points, startIndex, endIndex));
  }
  return edges;
}
