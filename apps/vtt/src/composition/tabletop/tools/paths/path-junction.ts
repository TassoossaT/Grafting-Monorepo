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
import { distanceToSegmentXZ } from "../shapes/geometry-2d.ts";
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

  const rimNodes = rim.nodes;
  if (rimNodes.length < 2 || spine.nodes.length < 2) return undefined;

  /**
   * Where a corner sits on the rim, as the segment of it the corner landed on.
   *
   * Found by projection rather than by station arithmetic, and that is the
   * whole difference between this working and working sometimes. Stations
   * are not a coordinate system a second junction leaves alone: splitting a
   * spine mints a node at a fractional station, so any lookup that asks for
   * "the node at station 2" stops finding one as soon as a 1.5 exists. A
   * position, on the other hand, is still a position.
   */
  const rimSegmentOf = (at: PathMouthSide): number | undefined => {
    let best: { readonly index: number; readonly distance: number } | undefined;
    for (let index = 0; index + 1 < rimNodes.length; index += 1) {
      const distance = distanceToSegmentXZ(
        at.position,
        rimNodes[index]!.position,
        rimNodes[index + 1]!.position,
      );
      if (best === undefined || distance < best.distance) best = { index, distance };
    }
    return best?.index;
  };

  const corners = mouth.sides
    .map((side) => ({ side, segment: rimSegmentOf(side) }))
    .filter((entry): entry is { side: PathMouthSide; segment: number } => entry.segment !== undefined)
    .sort((a, b) => a.segment - b.segment || a.side.standingStation - b.side.standingStation);
  const left = corners[0];
  const right = corners[corners.length - 1];
  if (left === undefined || right === undefined || left === right) return undefined;

  // The stretch of rim the mouth opens through: from the node before the
  // first corner to the node after the last.
  const before = rimNodes[left.segment]!;
  const after = rimNodes[Math.min(right.segment + 1, rimNodes.length - 1)]!;
  if (before.station >= after.station) return undefined;

  // Everything of the spine over that stretch, junction node included -- it
  // is on the chain now, and taking it from the chain rather than computing
  // where it ought to be is what keeps a second junction from breaking this.
  const spineOver = spine.nodes.filter(
    (node) => node.station >= before.station && node.station <= after.station,
  );
  const pivot = spineOver.findIndex((node) => node.nodeId === junction.nodeId);
  if (pivot <= 0 || pivot >= spineOver.length - 1) return undefined;

  // Only faces the two wedges are about to cover completely: a band hanging
  // over the end of the stretch would be removed and not replaced.
  const removed = run.bands.filter(
    (band) =>
      band.slots.includes(mouth.through) &&
      band.slots.includes(0) &&
      band.stations[0]! >= before.station &&
      band.stations[band.stations.length - 1]! <= after.station,
  );
  if (removed.length === 0) return undefined;

  const positionOf = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const node of [...spine.nodes, ...rimNodes]) positionOf.set(node.nodeId, node.position);
  const cornerId = (side: PathMouthSide) =>
    stationNodeId(arrivingCorridorId, mouth.station, side.across);

  /** A ring, with any node repeated back to back folded away. */
  const ring = (walk: readonly ConstructionNodeId[]): readonly ConstructionNodeId[] =>
    walk.filter((id, index) => id !== walk[index - 1] && id !== (index === 0 ? walk[walk.length - 1] : undefined));

  const leftRing = ring([
    before.nodeId,
    cornerId(left.side),
    junction.nodeId,
    ...spineOver.slice(0, pivot).reverse().map((node) => node.nodeId),
  ]);
  const rightRing = ring([
    junction.nodeId,
    cornerId(right.side),
    after.nodeId,
    ...spineOver.slice(pivot + 1).reverse().map((node) => node.nodeId),
  ]);

  const positionAt = (nodeId: ConstructionNodeId): ConstructionPosition | undefined => {
    const known = positionOf.get(nodeId);
    if (known !== undefined) return known;
    return mouth.sides.find((candidate) => cornerId(candidate) === nodeId)?.position;
  };

  const edges = createBoundaryEdges(tableId, { kind: "refuse-when-full" });
  const regions = [
    { ring: leftRing, name: "left" },
    { ring: rightRing, name: "right" },
  ]
    .filter((entry) => new Set(entry.ring).size >= 3)
    .map((entry) => {
      // Wound the way the sweep winds its own faces, so a wedge and the band
      // beside it agree on which side of a shared edge each of them is on.
      const ring = entry.ring.map(positionAt).filter((at) => at !== undefined);
      const walk =
        ring.length === entry.ring.length && signedArea(ring) < 0
          ? [...entry.ring].reverse()
          : entry.ring;
      return {
        regionId: `${operationId}:junction-${entry.name}`,
        boundary: walk.map((nodeId, index) => edges.use(nodeId, walk[(index + 1) % walk.length]!)),
        surfaceType: "path",
        physical: true,
      };
    });
  // Both halves or neither. One wedge alone leaves the flank it replaced
  // half open, which is worse than the kerb it was meant to remove.
  if (regions.length < 2) return undefined;

  // Every node the wedges walk, declared rather than assumed.
  //
  // Assuming was wrong in the one case that matters. Removing the flank
  // prunes any node left bounding nothing, and a rim node at the end of the
  // rebuilt stretch is bounded only by the very bands being removed -- so by
  // the time the wedge is laid, the node it means to hang its corner on is
  // gone. A patch declaring a node that already exists is free, since
  // `apply_add_patch` skips it and keeps the position it had.
  const declared = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const edge of edges.all()) {
    for (const nodeId of [edge.startNodeId, edge.endNodeId]) {
      if (declared.has(nodeId)) continue;
      const position = positionAt(nodeId);
      // Nowhere to put it means the wedge was walking something that is not
      // on this run and not a corner of the mouth either -- better no
      // junction than a node invented at the world origin.
      if (position === undefined) return undefined;
      declared.set(nodeId, position);
    }
  }

  return {
    removed: removed.map((band) => band.surfaceKey),
    patch: {
      nodes: [...declared].map(([id, position]) => ({ id, position })),
      edges: edges.all(),
      regions,
    },
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
