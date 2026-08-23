import type { ConstructionPosition } from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time.
import { pointInPolygonXZ, segmentCrossingXZ, type PointXZ } from "../shapes/geometry-2d.ts";

/**
 * Fusing one rim into another where the two cross.
 *
 * Two faces that overlap are not joined by overlapping: a rim drawn straight
 * over another rim leaves two lines crossing in mid-air, with a loose end of
 * each sitting inside the other face bounding nothing. The fix is the one a
 * mitre makes inside a single sweep -- the two rims meet at a point and
 * continue as one -- except that here the two rims belong to different
 * operations, so the meeting point has to be *made*: minted on the standing
 * rim by splitting the edge it fell on, and then referenced by the rim being
 * committed. Referencing the same node is the whole of being joined;
 * coincident is not connected.
 *
 * Deliberately geometric and nameless. Nothing here knows about paths, or
 * about which side of a road a rim is: it takes two polylines and the
 * footprint the standing one bounds, and reports where they meet. Roads are
 * simply the first caller that has two rims to reconcile.
 */

/** One polyline of a rim, with the edge standing between each pair of points. */
export interface FusionPolyline {
  readonly points: readonly ConstructionPosition[];
  /** The edge between consecutive points; one shorter than `points`. */
  readonly edgeIds: readonly (string | undefined)[];
}

/** One place a rim being committed must fuse into a standing one. */
export interface ContourFusion {
  /** The point of the committed rim that moves onto the meeting point. */
  readonly ownIndex: number;
  /** Where the two rims meet, at the height the committed rim carries there. */
  readonly position: ConstructionPosition;
  /** The standing edge that gains the meeting point. */
  readonly edgeId: string;
  /** Where along that edge the meeting point falls, from 0 to 1. */
  readonly along: number;
  /** Which segment of the standing rim that was. */
  readonly standingIndex: number;
}

function lerp(from: ConstructionPosition, to: ConstructionPosition, t: number): ConstructionPosition {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  };
}

/**
 * Every meeting point between a rim being committed and one already standing.
 *
 * A crossing counts when it cuts off an **end** of the committed rim: the
 * first or last point, sitting inside `standingFootprint` with nothing of the
 * rim beyond it. That is the loose end -- the stub poking into the other face
 * -- and it is the one that moves onto the meeting point, which both cuts the
 * stub and fuses the rims in a single stroke.
 *
 * An interior point inside the footprint is a rim passing clean **through**
 * rather than arriving, and is left alone. Pulling it back would fold the rim
 * over on itself; cutting it properly means splitting the committed rim in
 * two and filling the gap with a face, and nothing here is allowed to invent
 * that face. So a true through-crossing still leaves two rims crossing, and
 * closing it is the junction face this does not build.
 *
 * At most one fusion per committed point and one per standing edge: a point
 * can only be in one place, and an edge split twice would name a second time
 * the edge the first split has already replaced.
 */
export function contourFusionsAgainst(
  own: FusionPolyline,
  standing: FusionPolyline,
  standingFootprint: readonly PointXZ[],
): readonly ContourFusion[] {
  const best = new Map<number, ContourFusion & { readonly distance: number }>();

  const last = own.points.length - 1;
  for (let index = 0; index + 1 < own.points.length; index += 1) {
    const from = own.points[index]!;
    const to = own.points[index + 1]!;
    const fromInside = index === 0 && pointInPolygonXZ(from, standingFootprint);
    const toInside = index + 1 === last && pointInPolygonXZ(to, standingFootprint);
    if (fromInside === toInside) continue;
    const loose = fromInside ? index : index + 1;
    const loosePoint = fromInside ? from : to;

    for (let other = 0; other + 1 < standing.points.length; other += 1) {
      const edgeId = standing.edgeIds[other];
      if (edgeId === undefined) continue;
      const crossing = segmentCrossingXZ(
        from,
        to,
        standing.points[other]!,
        standing.points[other + 1]!,
      );
      if (crossing === undefined) continue;
      const position = lerp(from, to, crossing.along);
      const distance = Math.hypot(position.x - loosePoint.x, position.z - loosePoint.z);
      const previous = best.get(loose);
      // The nearest meeting point wins: moving the loose end the shortest way
      // is the one that leaves the rim's own shape alone.
      if (previous !== undefined && previous.distance <= distance) continue;
      best.set(loose, {
        ownIndex: loose,
        position,
        edgeId,
        along: crossing.across,
        standingIndex: other,
        distance,
      });
    }
  }

  const claimed = new Set<string>();
  const fusions: ContourFusion[] = [];
  for (const fusion of [...best.values()].sort((left, right) => left.distance - right.distance)) {
    if (claimed.has(fusion.edgeId)) continue;
    claimed.add(fusion.edgeId);
    fusions.push({
      ownIndex: fusion.ownIndex,
      position: fusion.position,
      edgeId: fusion.edgeId,
      along: fusion.along,
      standingIndex: fusion.standingIndex,
    });
  }
  return fusions.sort((left, right) => left.ownIndex - right.ownIndex);
}

/** The closed footprint a pair of rims bounds, walked as one ring. */
export function footprintOf(
  left: readonly ConstructionPosition[],
  right: readonly ConstructionPosition[],
): readonly ConstructionPosition[] {
  return [...left, ...[...right].reverse()];
}
