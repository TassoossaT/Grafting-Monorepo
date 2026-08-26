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

const COLLINEAR_COSINE_EPSILON = 1e-6;
const ARC_CENTER_EPSILON = 1e-3;

function isStraight(geometry: ConstructionEdgeGeometry | undefined): boolean {
  return geometry === undefined || geometry.kind === "line";
}

/** Whether `a` and `b` are the same circle, run the same way. */
function sameArc(a: ConstructionEdgeGeometry | undefined, b: ConstructionEdgeGeometry | undefined): boolean {
  if (a === undefined || b === undefined || a.kind !== "arc" || b.kind !== "arc") return false;
  if (a.clockwise !== b.clockwise) return false;
  return Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]) <= ARC_CENTER_EPSILON;
}

/** Whether `current` sits on the straight line through `previous` and `after` -- a scale-invariant angular check, not a distance one. */
function collinear(previous: ConstructionPosition, current: ConstructionPosition, after: ConstructionPosition): boolean {
  const inX = current.x - previous.x;
  const inZ = current.z - previous.z;
  const outX = after.x - current.x;
  const outZ = after.z - current.z;
  const inLength = Math.hypot(inX, inZ);
  const outLength = Math.hypot(outX, outZ);
  if (inLength < 1e-9 || outLength < 1e-9) return true; // a coincident neighbour carries no shape either.
  const cross = inX * outZ - inZ * outX;
  return Math.abs(cross) / (inLength * outLength) <= COLLINEAR_COSINE_EPSILON;
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
