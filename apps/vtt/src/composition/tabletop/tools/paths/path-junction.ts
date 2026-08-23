import type { AtomicEditOp } from "@/features/edit-construction";
import type {
  ConstructionNodeId,
  ConstructionPatch,
  ConstructionPosition,
  ConstructionSurfaceKey,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time.
import { createBoundaryEdges } from "../core/boundary-edges.ts";
import { stationNodeId } from "../../../../features/edit-construction/index.ts";
import type { PathMouth, PathMouthSide } from "./path-shared.ts";

/**
 * Closing the mouth a run makes when it arrives in the flank of another.
 *
 * A T is two L bends and a hole. The bends are the easy half: each arriving
 * rim runs on until it meets the standing rim, and there it turns and becomes
 * that rim. The hole is the half that was missing -- the stretch of standing
 * rim *between* the two bends is no longer rim at all. It is the mouth of the
 * road that just arrived, and drawing it is what makes a junction read as a
 * kerb laid across the road rather than as a junction.
 *
 * That stretch cannot simply be deleted: it bounds the standing run's band,
 * and taking it away leaves the band open. So the band goes too, and what
 * replaces it is two wedges -- one either side of the arriving road, each
 * running from the arriving road's corner along the old rim to where the band
 * used to end, and back along the spine.
 *
 * The seam falls out of it. The arriving road's end rib is the edge between
 * its corner and the junction node, and each wedge walks that very edge from
 * the other side; named after the pair of nodes it runs between, as every
 * edge here is, it is one edge with a face on each side. The two roads are
 * joined because they bound the same edges, not because they touch.
 */

/** What closing one mouth costs and produces. */
export interface JunctionWedges {
  /** Faces of the standing run that the mouth opens into, and so must go. */
  readonly removed: readonly ConstructionSurfaceKey[];
  /** Their replacement, either side of the arriving road. */
  readonly patch: ConstructionPatch;
}

/** The XZ shoelace, positive for the winding a sweep's own faces are built in. */
function signedArea(ring: readonly ConstructionPosition[]): number {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    total += current.x * next.z - next.x * current.z;
  }
  return total;
}

/**
 * Rebuilds the standing run's flank around one mouth.
 *
 * `undefined` when the mouth spans nothing the standing run actually has --
 * a graze at the very end of a run, or a corner that landed outside every
 * band. Closing nothing is better than declaring a face over a hole that is
 * not there.
 */
export function junctionWedges(
  tableId: string,
  operationId: string,
  arrivingCorridorId: string,
  mouth: PathMouth,
  /** The junction node on the standing spine, which both wedges pivot on. */
  junction: { readonly nodeId: ConstructionNodeId; readonly station: number },
): JunctionWedges | undefined {
  const run = mouth.run;
  const spine = run.spine;
  const rim = run.contours.find((contour) => contour.across === mouth.through);
  if (spine === undefined || rim === undefined || mouth.sides.length < 2) return undefined;

  const [left, right] = mouth.sides as readonly [PathMouthSide, PathMouthSide];
  // The faces the mouth opens into: this side of the run, over the stretch
  // the two corners bracket.
  const removed = run.bands.filter(
    (band) =>
      band.slots.includes(mouth.through) &&
      band.slots.includes(0) &&
      band.stations[0]! < right.standingStation &&
      band.stations[band.stations.length - 1]! > left.standingStation,
  );
  if (removed.length === 0) return undefined;

  const first = Math.min(...removed.map((band) => band.stations[0]!));
  const last = Math.max(...removed.map((band) => band.stations[band.stations.length - 1]!));

  const positionOf = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const node of [...spine.nodes, ...rim.nodes]) positionOf.set(node.nodeId, node.position);
  const rimAt = (station: number) => rim.nodes.find((node) => node.station === station);
  const spineAt = (station: number) => spine.nodes.find((node) => node.station === station);
  const between = (low: number, high: number) =>
    spine.nodes.filter((node) => node.station > low && node.station < high).map((node) => node.station);

  const cornerId = (side: PathMouthSide) =>
    stationNodeId(arrivingCorridorId, mouth.station, side.across);

  /** Station numbers of the standing run this wedge walks, rim then spine. */
  const wedge = (
    side: PathMouthSide,
    rimStations: readonly number[],
    spineStations: readonly number[],
    cornerFirst: boolean,
  ): readonly ConstructionNodeId[] | undefined => {
    const rimIds = rimStations.map((station) => rimAt(station)?.nodeId);
    const spineIds = spineStations.map((station) => spineAt(station)?.nodeId);
    if ([...rimIds, ...spineIds].some((id) => id === undefined)) return undefined;
    const corner = cornerId(side);
    const walk = cornerFirst
      ? [junction.nodeId, corner, ...(rimIds as string[]), ...(spineIds as string[])]
      : [...(rimIds as string[]), corner, junction.nodeId, ...(spineIds as string[])];
    // A ring has to be a ring: two of the same node in a row would declare an
    // edge from a node to itself.
    return walk.filter((id, index) => id !== walk[index - 1]) as readonly ConstructionNodeId[];
  };

  const leftRing = wedge(
    left,
    [first, ...between(first, left.standingStation)].filter(
      (station, index, all) => all.indexOf(station) === index && station <= left.standingStation,
    ),
    [...between(first, junction.station)].reverse().concat(first),
    false,
  );
  const rightRing = wedge(
    right,
    [...between(right.standingStation, last), last].filter(
      (station, index, all) => all.indexOf(station) === index && station >= right.standingStation,
    ),
    // Back down the spine from the far end of the rebuilt stretch to the
    // junction, which is where the wedge closes.
    [last, ...[...between(junction.station, last)].reverse()].filter(
      (station, index, all) => all.indexOf(station) === index,
    ),
    true,
  );
  if (leftRing === undefined || rightRing === undefined) return undefined;

  const positionAt = (nodeId: ConstructionNodeId): ConstructionPosition => {
    const known = positionOf.get(nodeId);
    if (known !== undefined) return known;
    const side = mouth.sides.find((candidate) => cornerId(candidate) === nodeId);
    return side?.position ?? { x: 0, y: 0, z: 0 };
  };

  const edges = createBoundaryEdges(tableId, { kind: "refuse-when-full" });
  const regions = [
    { ring: leftRing, name: "left" },
    { ring: rightRing, name: "right" },
  ]
    .filter((entry) => entry.ring.length >= 3)
    .map((entry) => {
      // Wound the way the sweep winds its own faces, so a wedge and the band
      // beside it agree on which side of a shared edge each of them is on.
      const ring = entry.ring.map(positionAt);
      const walk = signedArea(ring) >= 0 ? entry.ring : [...entry.ring].reverse();
      return {
        regionId: `${operationId}:junction-${entry.name}`,
        boundary: walk.map((nodeId, index) => edges.use(nodeId, walk[(index + 1) % walk.length]!)),
        surfaceType: "path",
        physical: true,
      };
    });
  if (regions.length === 0) return undefined;

  return {
    removed: removed.map((band) => band.surfaceKey),
    patch: { nodes: [], edges: edges.all(), regions },
  };
}

/** The edits that take the faces a mouth opens into out of the graph. */
export function junctionRemovals(wedges: readonly JunctionWedges[]): readonly AtomicEditOp[] {
  const seen = new Set<string>();
  const ops: AtomicEditOp[] = [];
  for (const wedge of wedges) {
    for (const surfaceKey of wedge.removed) {
      const key = surfaceKey.join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      ops.push({ kind: "delete-region", surfaceKey });
    }
  }
  return ops;
}
