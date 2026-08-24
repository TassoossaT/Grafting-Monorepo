import type { AtomicEditOp, PathRun } from "@/features/edit-construction";
import type { ConstructionNodeId, ConstructionPosition, ConstructionSweepPlan } from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time.
import { contourCrossingsAgainst, contourFusionsAgainst, footprintOf } from "../core/contour-fusion.ts";
import { sharedEdgeId } from "../core/boundary-edges.ts";
import type { SweptArc } from "../core/sweep-formation.ts";
import { stationNodeId } from "../../../../features/edit-construction/index.ts";

/**
 * Preparing a road that runs clean **through** another.
 *
 * The T was the easy shape: a road that stops inside another has a loose end
 * at every rim, and an end can be pulled onto whatever it met. A crossing has
 * no end to pull. Its rims run straight across the other road and out the far
 * side, so the four corners of the junction fall in the middle of edges that
 * belong to neither run -- and a corner in the middle of an edge is not a
 * node, which is to say it is not anywhere at all as far as the graph is
 * concerned.
 *
 * So a crossing is *prepared* rather than fused: before the road is swept for
 * real, stations are put at the parameters where its rims meet the standing
 * road, and then the corners are nodes because every station is. That is the
 * whole idea here. What it costs is one extra sweep, which is cheap, and what
 * it buys is that every later step -- the mouth, the flank rebuild, the seam
 * -- is the same code the T already uses.
 *
 * Two kinds of meeting matter, and they are different:
 *
 * - **rim against rim** is a corner of the junction: where the crossing road
 *   stops being under the standing road's surface.
 * - **rim against spine** is where a rebuilt piece of the standing road's
 *   flank closes. A flank piece runs along one rim and back along the spine,
 *   and it must leave the spine where the crossing road's rim cuts it --
 *   never further in, or the piece would lie across the crossing road.
 *
 * The second needs a node on the standing spine as well, which means
 * splitting it, which is why those are reported separately.
 */

/** Where one rim of the run being committed cuts a standing spine. */
export interface SpineMeeting {
  /** Where the meeting falls along the committed reference line. */
  readonly at: number;
  /** Which rim of the committed run, as its slot. */
  readonly across: number;
  /** The node both runs share there. */
  readonly nodeId: ConstructionNodeId;
  readonly position: ConstructionPosition;
  /**
   * The cut that mints it, or `undefined` when the meeting landed on a
   * station the standing spine already has.
   *
   * Landing on an end of an edge is not a split; it is arriving at the node
   * that is already there. Cutting anyway asks for a node id that exists and
   * names one half after the very edge being cut.
   */
  readonly split: SpineSplit | undefined;
}

/** One point a standing spine has to be cut at, wherever it came from. */
export interface SpineSplit {
  readonly nodeId: ConstructionNodeId;
  readonly position: ConstructionPosition;
  readonly edgeId: string;
  /** Where along the edge, so several cuts of one edge can be ordered. */
  readonly along: number;
  readonly startNodeId: ConstructionNodeId;
  readonly endNodeId: ConstructionNodeId;
}

/** How near an existing station a crossing may fall before it needs no new one. */
const ALREADY_A_STATION = 0.02;

/** How near an end of a standing edge a cut may fall before it is that end. */
const END_OF_EDGE = 1e-4;

/**
 * Everywhere the run being committed passes clean through a standing one.
 *
 * Read off a first, throwaway sweep: the rims only exist once the profile has
 * been swept, and where they fall is the question being asked. A run that
 * *arrives* at the standing road is left out entirely -- it has a loose end,
 * so `contourFusionsAgainst` will fuse it, and adding stations under it would
 * only put a sliver of a band beside the corner.
 */
export function throughCrossings(
  plan: ConstructionSweepPlan,
  profileLength: number,
  spineSlot: number,
  joined: readonly PathRun[],
): { readonly stations: readonly number[]; readonly meetings: readonly SpineMeeting[] } {
  const stations: number[] = [];
  const meetings: SpineMeeting[] = [];
  if (profileLength < 3) return { stations, meetings };

  const stationCount = Math.floor(plan.vertices.length / profileLength);
  const at = (station: number, across: number): number =>
    station * profileLength + across + spineSlot;
  const outerSlots = [...new Set([-spineSlot, profileLength - 1 - spineSlot])].filter(
    (across) => across !== 0,
  );

  for (const run of joined) {
    const spine = run.spine;
    if (spine === undefined || run.contours.length < 2) continue;
    const footprint = footprintOf(
      run.contours[0]!.nodes.map((node) => node.position),
      run.contours[1]!.nodes.map((node) => node.position),
    );
    const rims = outerSlots.map((across) => ({
      across,
      polyline: {
        points: Array.from({ length: stationCount }, (_unused, index) => plan.vertices[at(index, across)]!),
        edgeIds: [],
      },
    }));

    // An arrival is somebody else's job. Asked of the whole run rather than
    // of one rim, because a road arriving at another arrives as a whole: one
    // rim fusing and the other being prepared as a crossing would cut the
    // same end twice, by two different rules.
    const arrives = rims.some((rim) =>
      run.contours.some(
        (chain) =>
          contourFusionsAgainst(
            rim.polyline,
            { points: chain.nodes.map((node) => node.position), edgeIds: chain.edgeIds },
            footprint,
          ).length > 0,
      ),
    );
    if (arrives) continue;

    for (const rim of rims) {
      for (const chain of run.contours) {
        for (const crossing of contourCrossingsAgainst(rim.polyline, {
          points: chain.nodes.map((node) => node.position),
          edgeIds: chain.edgeIds,
        })) {
          stations.push(crossing.at);
        }
      }
      for (const crossing of contourCrossingsAgainst(rim.polyline, {
        points: spine.nodes.map((node) => node.position),
        edgeIds: spine.edgeIds,
      })) {
        const from = spine.nodes[crossing.standingIndex]!;
        const to = spine.nodes[crossing.standingIndex + 1]!;
        const atEnd =
          crossing.along <= END_OF_EDGE ? from : crossing.along >= 1 - END_OF_EDGE ? to : undefined;
        const station = Number(
          (from.station + (to.station - from.station) * crossing.along).toFixed(3),
        );
        const nodeId = atEnd?.nodeId ?? stationNodeId(run.corridorId, station, 0);
        stations.push(crossing.at);
        meetings.push({
          at: crossing.at,
          across: rim.across,
          nodeId,
          position: atEnd?.position ?? crossing.position,
          split:
            atEnd !== undefined
              ? undefined
              : {
                  nodeId,
                  position: crossing.position,
                  edgeId: crossing.edgeId,
                  along: crossing.along,
                  startNodeId: from.nodeId,
                  endNodeId: to.nodeId,
                },
        });
      }
    }
  }

  return { stations: stations.sort((left, right) => left - right), meetings };
}

/** A point on an arc between two of its own points, kept on the circle. */
function onArc(
  from: ConstructionPosition,
  to: ConstructionPosition,
  arc: SweptArc,
  fraction: number,
): ConstructionPosition {
  const radius = Math.hypot(from.x - arc.center[0], from.z - arc.center[1]);
  if (radius < 1e-6) return from;
  const startAngle = Math.atan2(from.z - arc.center[1], from.x - arc.center[0]);
  const endAngle = Math.atan2(to.z - arc.center[1], to.x - arc.center[0]);
  const turn = arc.clockwise ? startAngle - endAngle : endAngle - startAngle;
  const swept = ((turn % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const angle = arc.clockwise ? startAngle - swept * fraction : startAngle + swept * fraction;
  return {
    x: arc.center[0] + radius * Math.cos(angle),
    y: from.y + (to.y - from.y) * fraction,
    z: arc.center[1] + radius * Math.sin(angle),
  };
}

/**
 * The same reference line with a station at each of `at`.
 *
 * `origins` says where every station of the result came from in the line
 * handed in, or `-1` for one this minted -- which is what lets a caller carry
 * anything it had indexed by station across the splice: which node a station
 * welded to, which drawn station it came from, where a terminal was.
 *
 * A station minted on a curved stretch is placed **on the curve**, not on the
 * chord between the two it falls between. The difference is under a
 * centimetre at the flattening this uses, and it is still the difference
 * between a rim that meets the standing road where it appears to and one that
 * misses by the sagitta.
 */
export function withStationsAt(
  line: readonly ConstructionPosition[],
  arcs: readonly (SweptArc | undefined)[],
  at: readonly number[],
): {
  readonly line: readonly ConstructionPosition[];
  readonly arcs: readonly (SweptArc | undefined)[];
  readonly origins: readonly number[];
  /** The station each requested parameter became, in the order asked. */
  readonly indexOf: readonly number[];
} {
  // One parameter per station, however many crossings landed on it. Both
  // rims of a road cross a rim of another at the same parameter whenever the
  // two meet squarely, and inserting a station per crossing would put two on
  // one spot -- which the sweep then drops as coincident, sliding every
  // station index after it and unwelding the whole run.
  const wanted = [...at]
    .sort((left, right) => left - right)
    .filter((parameter, index, all) => index === 0 || parameter - all[index - 1]! > ALREADY_A_STATION);
  const spliced: ConstructionPosition[] = [];
  const splicedArcs: (SweptArc | undefined)[] = [];
  const origins: number[] = [];
  const indexOf = new Map<number, number>();

  let next = 0;
  for (let index = 0; index < line.length; index += 1) {
    spliced.push(line[index]!);
    origins.push(index);
    if (index + 1 >= line.length) break;
    const arc = arcs[index];
    splicedArcs.push(arc);
    while (next < wanted.length && wanted[next]! < index + 1) {
      const parameter = wanted[next]!;
      next += 1;
      const fraction = parameter - index;
      // A crossing that already has a station under it needs no second one:
      // two stations a hair apart make a band of no length, which is a sliver
      // face running the width of the road.
      if (fraction < ALREADY_A_STATION) {
        indexOf.set(parameter, spliced.length - 1);
        continue;
      }
      if (fraction > 1 - ALREADY_A_STATION) {
        indexOf.set(parameter, spliced.length);
        continue;
      }
      const from = line[index]!;
      const to = line[index + 1]!;
      indexOf.set(parameter, spliced.length);
      spliced.push(
        arc === undefined
          ? {
              x: from.x + (to.x - from.x) * fraction,
              y: from.y + (to.y - from.y) * fraction,
              z: from.z + (to.z - from.z) * fraction,
            }
          : onArc(from, to, arc, fraction),
      );
      origins.push(-1);
      splicedArcs.push(arc);
    }
  }

  return {
    line: spliced,
    arcs: splicedArcs,
    origins,
    // Answered for every parameter asked about, including the ones folded
    // into a neighbour: two crossings on one station are still two crossings,
    // and each of them needs to know which station it became.
    indexOf: at.map((parameter) => {
      const nearest = wanted.find((kept) => Math.abs(kept - parameter) <= ALREADY_A_STATION);
      return nearest === undefined ? -1 : indexOf.get(nearest) ?? -1;
    }),
  };
}

/**
 * The edits that cut a standing spine at every point something needs one.
 *
 * Ordered, because a second cut of the same edge is a cut of one of the
 * halves the first left behind -- naming the original again asks the graph
 * for an edge that no longer exists, which is how a crossing used to take the
 * whole stroke down with it. The halves are named after the pair of nodes
 * they run between, exactly as a declared edge is, so a face laid later over
 * one of those pairs finds the edge already standing.
 */
export function spineSplitOps(tableId: string, splits: readonly SpineSplit[]): readonly AtomicEditOp[] {
  const byEdge = new Map<string, SpineSplit[]>();
  for (const split of splits) {
    const into = byEdge.get(split.edgeId) ?? [];
    byEdge.set(split.edgeId, into);
    into.push(split);
  }

  const ops: AtomicEditOp[] = [];
  for (const [edgeId, cuts] of byEdge) {
    const ordered = [...cuts].sort((left, right) => left.along - right.along);
    let edge = edgeId;
    let start = ordered[0]!.startNodeId;
    const end = ordered[0]!.endNodeId;
    const minted = new Set<string>();
    for (const cut of ordered) {
      // One node, one cut: two crossings landing on the same point of the
      // same edge is one meeting seen twice.
      if (minted.has(cut.nodeId)) continue;
      minted.add(cut.nodeId);
      const first = sharedEdgeId(tableId, start, cut.nodeId);
      const second = sharedEdgeId(tableId, cut.nodeId, end);
      ops.push({
        kind: "insert-vertex",
        edgeId: edge,
        nodeId: cut.nodeId,
        position: cut.position,
        firstEdgeId: first,
        secondEdgeId: second,
      });
      // The next cut falls in the far half, which is what the last one named.
      edge = second;
      start = cut.nodeId;
    }
  }
  return ops;
}
