import type { ConstructionEdgeGeometry, ConstructionPosition } from "@/ports";

/**
 * Drops every vertex of a closed ring that carries no shape of its own -- a
 * straight-chord point sitting exactly on the line either side of it, or an
 * arc sample sitting on the same circle either side of it -- so a curve some
 * upstream step tessellated into many small chords comes back out as the one
 * arc it always was. The same property a wall's own sweep already has (one
 * edge per uninterrupted curve, not one per station); a road's union output
 * is simply the first ring dense enough for the difference to show.
 *
 * Deliberately geometric and type-agnostic: it takes plain points and
 * whatever `geometryFor` says two of them run on, and returns which indices
 * still carry information. Any future patch built by walking a ring of
 * points with declared per-edge geometry -- not just `contour-patch.ts`'s
 * own union output -- can reuse this instead of writing its own version of
 * the same collapse.
 */

const COLLINEAR_COSINE_EPSILON = 2e-4;
const COLLINEAR_HEIGHT_EPSILON = 0.03;
const ARC_CENTER_EPSILON = 1e-3;

function perpendicularDistanceSq(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-9) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
  const num = (b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0];
  return (num * num) / lenSq;
}

function rdpRecursive(
  points: readonly (readonly [number, number])[],
  start: number,
  end: number,
  epsilonSq: number,
  keep: boolean[],
): void {
  if (end <= start + 1) return;
  const a = points[start]!;
  const b = points[end]!;
  let maxDistSq = 0;
  let maxIndex = start;
  for (let i = start + 1; i < end; i++) {
    const distSq = perpendicularDistanceSq(points[i]!, a, b);
    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      maxIndex = i;
    }
  }
  if (maxDistSq > epsilonSq) {
    keep[maxIndex] = true;
    rdpRecursive(points, start, maxIndex, epsilonSq, keep);
    rdpRecursive(points, maxIndex, end, epsilonSq, keep);
  }
}

/**
 * Simplifies a closed planar ring using the Ramer-Douglas-Peucker (RDP) algorithm.
 * Drops vertices that deviate from the chord by less than `epsilon` meters,
 * dramatically reducing vertex and edge count while preserving the visual curve.
 */
export function simplifyPolygonRdp(
  ring: readonly (readonly [number, number])[],
  epsilon = 0.06,
): (readonly [number, number])[] {
  if (ring.length <= 4) return [...ring];
  const isClosed =
    Math.hypot(ring[0]![0] - ring.at(-1)![0], ring[0]![1] - ring.at(-1)![1]) < 1e-6;
  const pts = isClosed ? ring.slice(0, -1) : [...ring];
  if (pts.length <= 3) return [...ring];

  let maxDistSq = 0;
  let farIndex = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length; i++) {
    const dSq = (pts[i]![0] - pts[0]![0]) ** 2 + (pts[i]![1] - pts[0]![1]) ** 2;
    if (dSq > maxDistSq) {
      maxDistSq = dSq;
      farIndex = i;
    }
  }

  const epsilonSq = epsilon * epsilon;
  const keep = new Array(pts.length).fill(false);
  keep[0] = true;
  keep[farIndex] = true;

  rdpRecursive(pts, 0, farIndex, epsilonSq, keep);

  const secondHalf: (readonly [number, number])[] = [];
  const secondIndices: number[] = [];
  for (let i = farIndex; i < pts.length; i++) {
    secondHalf.push(pts[i]!);
    secondIndices.push(i);
  }
  secondHalf.push(pts[0]!);
  secondIndices.push(0);

  const secondKeep = new Array(secondHalf.length).fill(false);
  secondKeep[0] = true;
  secondKeep[secondHalf.length - 1] = true;
  rdpRecursive(secondHalf, 0, secondHalf.length - 1, epsilonSq, secondKeep);
  for (let i = 1; i < secondHalf.length - 1; i++) {
    if (secondKeep[i]) keep[secondIndices[i]!] = true;
  }

  const simplified = pts.filter((_, i) => keep[i]);
  if (simplified.length < 3) return [...ring];
  if (isClosed) simplified.push(simplified[0]!);
  return simplified;
}

function isStraight(geometry: ConstructionEdgeGeometry | undefined): boolean {
  return geometry === undefined || geometry.kind === "line";
}

/** Whether `a` and `b` are the same circle, run the same way. */
function sameArc(a: ConstructionEdgeGeometry | undefined, b: ConstructionEdgeGeometry | undefined): boolean {
  if (a === undefined || b === undefined || a.kind !== "arc" || b.kind !== "arc") return false;
  if (a.clockwise !== b.clockwise) return false;
  return Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]) <= ARC_CENTER_EPSILON;
}

/** Whether `current` sits on the straight line through `previous` and `after` in 3D (XZ collinearity and linear Y height). */
function collinear(previous: ConstructionPosition, current: ConstructionPosition, after: ConstructionPosition): boolean {
  const inX = current.x - previous.x;
  const inZ = current.z - previous.z;
  const outX = after.x - current.x;
  const outZ = after.z - current.z;
  const inLength = Math.hypot(inX, inZ);
  const outLength = Math.hypot(outX, outZ);
  if (inLength < 1e-9 || outLength < 1e-9) return true; // a coincident neighbour carries no shape either.
  const cross = inX * outZ - inZ * outX;
  if (Math.abs(cross) / (inLength * outLength) > COLLINEAR_COSINE_EPSILON) return false;
  const totalLength = inLength + outLength;
  const expectedY = previous.y + (after.y - previous.y) * (inLength / totalLength);
  return Math.abs(current.y - expectedY) <= COLLINEAR_HEIGHT_EPSILON;
}

/**
 * The indices of `points` (a closed ring, no repeated closing vertex) that
 * still carry real shape, in order -- every other index is redundant and
 * may be dropped from the ring without changing what it bounds.
 *
 * `geometryFor(fromIndex, toIndex)` reports the geometry the edge from
 * `points[fromIndex]` to `points[toIndex]` actually runs on (`undefined` a
 * straight chord, the same convention {@link BoundaryEdges.use} already
 * takes) -- indices rather than positions, so a caller that keeps its own
 * parallel array (node ids, say) never has to search `points` back for
 * which entry a position belonged to. Read fresh for each candidate pair
 * rather than cached, since dropping a vertex changes which pairs are
 * adjacent.
 */
export function simplifyClosedRing(
  points: readonly ConstructionPosition[],
  geometryFor: (fromIndex: number, toIndex: number) => ConstructionEdgeGeometry | undefined,
): readonly number[] {
  if (points.length < 3) return points.map((_point, index) => index); // nothing spare to drop below a real edge pair.

  let indices = points.map((_point, index) => index);
  let changed = true;
  while (changed && indices.length > 2) {
    changed = false;
    const kept: number[] = [];
    for (let position = 0; position < indices.length; position += 1) {
      const previousIndex = indices[(position - 1 + indices.length) % indices.length]!;
      const currentIndex = indices[position]!;
      const nextIndex = indices[(position + 1) % indices.length]!;
      const previous = points[previousIndex]!;
      const current = points[currentIndex]!;
      const after = points[nextIndex]!;
      const incoming = geometryFor(previousIndex, currentIndex);
      const outgoing = geometryFor(currentIndex, nextIndex);
      const redundant =
        (isStraight(incoming) && isStraight(outgoing) && collinear(previous, current, after)) ||
        sameArc(incoming, outgoing);
      if (redundant) {
        changed = true;
        continue;
      }
      kept.push(currentIndex);
    }
    // Below 2 survivors there is no edge pair left to re-examine -- a lone
    // point cannot bound anything, so the previous, still-valid `indices`
    // is kept rather than collapsed the rest of the way.
    if (kept.length < 2) break;
    indices = kept;
  }
  return indices;
}
