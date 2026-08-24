import type { AtomicEditOp } from "@/features/edit-construction";
import type {
  ConstructionNodeId,
  ConstructionPatch,
  ConstructionPatchEdge,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time.
import { createBoundaryEdges } from "../core/boundary-edges.ts";
import { distanceToSegmentXZ, projectOntoLineXZ } from "../shapes/geometry-2d.ts";
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

/** One mouth and the spine node its two bends pivot on. */
export interface JunctionOpening {
  readonly mouth: PathMouth;
  readonly junction: { readonly nodeId: ConstructionNodeId; readonly station: number };
}

/**
 * Rebuilds the standing run's flank around every mouth opened into it.
 *
 * All of them at once, and that is not an optimisation. The flank is rebuilt
 * by removing the bands the mouths open through and laying pieces over the
 * same ground; done one mouth at a time, the second mouth goes looking for
 * bands the first has already removed and finds none -- so a stroke that
 * opens into the same road twice closed one junction and silently dropped
 * the other. One flank, one rebuild.
 *
 * With `m` mouths the flank becomes `m + 1` pieces: a piece runs along the
 * rim from where one mouth ended to where the next begins, down the rib at
 * that end, back along the spine, and up again. The mouths themselves are
 * the gaps between them -- which is the whole point, since a mouth is the
 * stretch of rim that is no longer rim.
 *
 * `undefined` when the mouths span nothing the standing run actually has --
 * a graze at the very end of a run, a corner that landed outside every band,
 * or two mouths overlapping on the rim. Closing nothing is better than
 * declaring a face over a hole that is not there.
 */
export function junctionWedges(
  tableId: string,
  operationId: string,
  arrivingCorridorId: string,
  /** Every mouth through one rim of one standing run. */
  openings: readonly JunctionOpening[],
): JunctionWedges | undefined {
  const first = openings[0];
  if (first === undefined) return undefined;
  const run = first.mouth.run;
  const through = first.mouth.through;
  const spine = run.spine;
  const rim = run.contours.find((contour) => contour.across === through);
  if (spine === undefined || rim === undefined) return undefined;

  const rimNodes = rim.nodes;
  if (rimNodes.length < 2 || spine.nodes.length < 2) return undefined;

  /**
   * Where a corner sits on the rim, as a parameter along it: the index of
   * the segment it landed on plus how far along that segment it sits.
   *
   * Found by projection rather than by station arithmetic, and that is the
   * whole difference between this working and working sometimes. Stations
   * are not a coordinate system a second junction leaves alone: splitting a
   * spine mints a node at a fractional station, so any lookup that asks for
   * "the node at station 2" stops finding one as soon as a 1.5 exists. A
   * position, on the other hand, is still a position.
   */
  const rimSegmentOf = (at: PathMouthSide): number | undefined => {
    let best: { readonly at: number; readonly distance: number } | undefined;
    for (let index = 0; index + 1 < rimNodes.length; index += 1) {
      const from = rimNodes[index]!.position;
      const to = rimNodes[index + 1]!.position;
      const distance = distanceToSegmentXZ(at.position, from, to);
      if (best !== undefined && distance >= best.distance) continue;
      const { t } = projectOntoLineXZ(at.position, from, to);
      best = { at: index + Math.min(1, Math.max(0, t)), distance };
    }
    return best?.at;
  };

  const cornerId = (side: PathMouthSide) =>
    stationNodeId(arrivingCorridorId, side.station, side.across);

  /** One opening as the pair of rim corners it cuts, in rim order. */
  const gaps: {
    readonly left: { readonly side: PathMouthSide; readonly at: number };
    readonly right: { readonly side: PathMouthSide; readonly at: number };
    readonly junction: JunctionOpening["junction"];
  }[] = [];
  for (const opening of openings) {
    if (opening.mouth.through !== through || opening.mouth.run !== run) return undefined;
    const corners = opening.mouth.sides
      .map((side) => ({ side, at: rimSegmentOf(side) }))
      .filter((entry): entry is { side: PathMouthSide; at: number } => entry.at !== undefined)
      .sort((a, b) => a.at - b.at || a.side.standingStation - b.side.standingStation);
    const left = corners[0];
    const right = corners[corners.length - 1];
    // Both halves or neither, per mouth: one corner is a graze rather than an
    // opening, and rebuilding a flank around half of one leaves it open.
    if (left === undefined || right === undefined || left === right) return undefined;
    gaps.push({ left, right, junction: opening.junction });
  }
  gaps.sort((a, b) => a.left.at - b.left.at);
  // Overlapping mouths are two openings claiming one stretch of rim, and
  // there is no flank left between them to lay a piece over.
  for (let index = 1; index < gaps.length; index += 1) {
    if (gaps[index]!.left.at < gaps[index - 1]!.right.at) return undefined;
  }

  // The stretch of rim the mouths open through: from the node before the
  // first corner to the node after the last.
  const beforeIndex = Math.floor(gaps[0]!.left.at);
  const afterIndex = Math.min(Math.floor(gaps[gaps.length - 1]!.right.at) + 1, rimNodes.length - 1);
  const before = rimNodes[beforeIndex]!;
  const after = rimNodes[afterIndex]!;
  if (before.station >= after.station) return undefined;

  // Everything of the spine over that stretch, junction nodes included --
  // they are on the chain now, and taking them from the chain rather than
  // computing where they ought to be is what keeps a later junction from
  // breaking this.
  const spineOver = spine.nodes.filter(
    (node) => node.station >= before.station && node.station <= after.station,
  );
  const pivots = gaps.map((gap) =>
    spineOver.findIndex((node) => node.nodeId === gap.junction.nodeId),
  );
  for (let index = 0; index < pivots.length; index += 1) {
    const pivot = pivots[index]!;
    const previous = index === 0 ? -1 : pivots[index - 1]!;
    // Inside the stretch, and in the order the mouths sit in along the rim: a
    // pivot at either end has no flank on one side of it to rebuild, and one
    // out of order would have two pieces crossing each other.
    if (pivot <= 0 || pivot >= spineOver.length - 1 || pivot <= previous) return undefined;
  }

  // Only faces the pieces are about to cover completely: a band hanging over
  // the end of the stretch would be removed and not replaced.
  const removed = run.bands.filter(
    (band) =>
      band.slots.includes(through) &&
      band.slots.includes(0) &&
      band.stations[0]! >= before.station &&
      band.stations[band.stations.length - 1]! <= after.station,
  );
  if (removed.length === 0) return undefined;

  const positionOf = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const node of [...spine.nodes, ...rimNodes]) positionOf.set(node.nodeId, node.position);

  /** A ring, with any node repeated back to back folded away. */
  const ring = (walk: readonly ConstructionNodeId[]): readonly ConstructionNodeId[] =>
    walk.filter((id, index) => id !== walk[index - 1] && id !== (index === 0 ? walk[walk.length - 1] : undefined));

  /**
   * The `m + 1` pieces, each one stretch of surviving flank.
   *
   * Piece `k` runs along the rim from where mouth `k - 1` ended to where
   * mouth `k` begins -- the first from the node before everything, the last
   * to the node after everything -- and closes back along the spine between
   * the two junction nodes those mouths pivot on.
   */
  const rings = Array.from({ length: gaps.length + 1 }, (_unused, piece) => {
    const opens = gaps[piece - 1];
    const closes = gaps[piece];
    const walk: ConstructionNodeId[] = [];
    if (opens === undefined) walk.push(before.nodeId);
    else {
      walk.push(cornerId(opens.right.side));
      const stop = closes === undefined ? afterIndex : Math.floor(closes.left.at);
      for (let index = Math.floor(opens.right.at) + 1; index <= stop; index += 1) {
        walk.push(rimNodes[index]!.nodeId);
      }
    }
    if (closes !== undefined) walk.push(cornerId(closes.left.side));
    const from = opens === undefined ? 0 : pivots[piece - 1]!;
    const to = closes === undefined ? spineOver.length - 1 : pivots[piece]!;
    for (const node of spineOver.slice(from, to + 1).reverse()) walk.push(node.nodeId);
    return ring(walk);
  });

  const positionAt = (nodeId: ConstructionNodeId): ConstructionPosition | undefined => {
    const known = positionOf.get(nodeId);
    if (known !== undefined) return known;
    for (const gap of gaps) {
      for (const side of [gap.left.side, gap.right.side]) {
        if (cornerId(side) === nodeId) return side.position;
      }
    }
    return undefined;
  };

  const edges = createBoundaryEdges(tableId, { kind: "refuse-when-full" });
  const regions = rings
    .map((walk, piece) => ({ walk, piece }))
    .filter((entry) => new Set(entry.walk).size >= 3)
    .map((entry) => {
      // Wound the way the sweep winds its own faces, so a piece and the band
      // beside it agree on which side of a shared edge each of them is on.
      const positions = entry.walk.map(positionAt).filter((at) => at !== undefined);
      const walk =
        positions.length === entry.walk.length && signedArea(positions) < 0
          ? [...entry.walk].reverse()
          : entry.walk;
      return {
        regionId: `${operationId}:junction-${entry.piece}`,
        boundary: walk.map((nodeId, index) => edges.use(nodeId, walk[(index + 1) % walk.length]!)),
        surfaceType: "path",
        physical: true,
      };
    });
  // Every piece or none. One missing leaves the flank it replaced half open,
  // which is worse than the kerb it was meant to remove.
  if (regions.length !== rings.length) return undefined;

  // Every node the pieces walk, declared rather than assumed.
  //
  // Assuming was wrong in the one case that matters. Removing the flank
  // prunes any node left bounding nothing, and a rim node at the end of the
  // rebuilt stretch is bounded only by the very bands being removed -- so by
  // the time the piece is laid, the node it means to hang its corner on is
  // gone. A patch declaring a node that already exists is free, since
  // `apply_add_patch` skips it and keeps the position it had.
  const declared = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const edge of edges.all()) {
    for (const nodeId of [edge.startNodeId, edge.endNodeId]) {
      if (declared.has(nodeId)) continue;
      const position = positionAt(nodeId);
      // Nowhere to put it means a piece was walking something that is not on
      // this run and not a corner of any mouth either -- better no junction
      // than a node invented at the world origin.
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

/**
 * The patch that puts a set of faces back exactly as they stand.
 *
 * A junction is a swap: the flank comes out and the wedges go in. The two
 * halves are separate calls, and the second one can be refused -- a wedge
 * whose boundary has no room, a node that went with the removal -- which
 * leaves the road with a hole where its flank used to be and nothing on the
 * way to fill it. Faces disappearing when a T is drawn is that, seen from
 * the table.
 *
 * So the swap is made reversible before it is made. Read from live
 * topologies, this re-declares every node, edge and loop of the faces about
 * to go, which is enough to register them again unchanged: an edge keeps its
 * identity and its geometry, and a face keeps the very uses it was walking.
 *
 * Reversible, not transactional -- restoring is a second edit, and it can
 * only bring back what was read. It is the difference between a junction
 * that failed to close and a road with a bite taken out of it.
 */
export function patchRestoring(
  topologies: readonly ConstructionRegionTopology[],
): ConstructionPatch {
  const nodes = new Map<ConstructionNodeId, ConstructionPosition>();
  const edges = new Map<string, ConstructionPatchEdge>();
  const regions: ConstructionPatch["regions"] = topologies.map((topology) => {
    for (const node of topology.nodes) nodes.set(node.id, node.position);
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const use of loop) {
        if (edges.has(use.edgeId)) continue;
        // Declared in the edge's own direction, which is the direction the
        // geometry is stored in: `startNodeId` is where the *walk* began, so
        // a reversed use names the same edge from the other end.
        edges.set(use.edgeId, {
          edgeId: use.edgeId,
          startNodeId: use.reversed ? use.endNodeId : use.startNodeId,
          endNodeId: use.reversed ? use.startNodeId : use.endNodeId,
          geometry: use.geometry,
        });
      }
    }
    const [outer, ...rest] = topology.outerLoops;
    return {
      // A surface key is `[prefix, regionId]`: the id is the last of it.
      regionId: topology.surfaceKey[topology.surfaceKey.length - 1] ?? "",
      boundary: (outer ?? []).map((use) => ({ edgeId: use.edgeId, reversed: use.reversed })),
      holes: [...rest, ...topology.holes].map((loop) =>
        loop.map((use) => ({ edgeId: use.edgeId, reversed: use.reversed })),
      ),
      surfaceType: topology.surfaceType,
      physical: topology.physical,
    };
  });

  return {
    nodes: [...nodes].map(([id, position]) => ({ id, position })),
    edges: [...edges.values()],
    regions,
  };
}
