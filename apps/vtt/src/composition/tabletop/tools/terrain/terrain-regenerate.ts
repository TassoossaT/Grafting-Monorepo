import type {
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";
import type { CutFallout } from "@/features/edit-construction";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. The type-only
// `@/` imports above are fine -- those are erased.
import { outwardPerimeterRings } from "../../../../features/edit-construction/index.ts";
import { constraintsFromRings, type ConstraintRing } from "./terrain-constraints.ts";
import { DEFAULT_FACE_SIDE, fillTerrain, type TerrainFillRuntime } from "./terrain-fill.ts";

/**
 * Throwing a neighbourhood of ground away and generating it again as one
 * piece.
 *
 * Used by one caller: repairing terrain a cut consumed. It was briefly used by
 * a second -- a pass that relaid the neighbourhood of every stroke, to erase
 * the seam where new ground met old and to shed the nodes that accumulate
 * there. That was tried and reverted, and the reason is worth keeping so it is
 * not tried again the same way.
 *
 * **Why regenerating a neighbourhood does not shed accumulated nodes.** The
 * rim of the regenerated patch is a hard constraint built from the *existing*
 * mesh's edges, so whatever fineness that boundary had is imprinted on the new
 * mesh exactly -- and then the ortho step puts a midpoint on every one of
 * those segments, doubling it again. The seam is not removed, it is moved
 * outward onto a longer rim and made finer. Measured against expectation, this
 * made every symptom worse: more nodes, tighter cells clustered along the new
 * join, and two generations of cost per stroke.
 *
 * The second failure was worse than slow. The faces are deleted before the
 * generator is asked, so a rim it refuses -- disjoint components, degenerate
 * segments, a self-touching perimeter -- costs the ground outright: deleted,
 * with nothing laid back. Any future version has to generate first and delete
 * only on success, or hold the deletion in the same transaction.
 *
 * Accumulation has to be attacked where it starts: the contour handed to the
 * generator, decimated to the target face size *before* it becomes a
 * constraint. `remove-vertex` already exists for that and dissolves a node
 * into the edge that spans it.
 */

/** What {@link regenerateNeighbourhood} needs of the runtime, structurally. */
export interface TerrainRegenerateRuntime extends TerrainFillRuntime {
  getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined;
}

/**
 * A neighbourhood is bounded by the brush, not by the terrain, so it should
 * stay small however large the map grows. A stroke that names more faces than
 * this is not a normal stroke, and regenerating that much ground would cost
 * more than the seam it removes.
 */
const MOST_FACES_WORTH_REGENERATING = 4000;

/**
 * Heights sampled from ground that is about to be deleted, so what replaces it
 * lands at the same height.
 *
 * Bucketed by a cell the size of the query radius, so a lookup reads nine
 * buckets rather than every anchor. Locality is the point and not only the
 * speed: a global inverse-distance blend drags every new corner toward the
 * mean height of the whole neighbourhood, which flattens relief that was
 * there. Only anchors within a couple of faces get a say, and the relief
 * survives.
 */
export interface HeightField {
  at(point: { readonly x: number; readonly z: number }): number | undefined;
}

export function heightFieldOf(anchors: readonly ConstructionPosition[], reach: number): HeightField {
  const buckets = new Map<string, ConstructionPosition[]>();
  const key = (x: number, z: number) => `${Math.floor(x / reach)}:${Math.floor(z / reach)}`;
  for (const anchor of anchors) {
    const at = key(anchor.x, anchor.z);
    const bucket = buckets.get(at);
    if (bucket === undefined) buckets.set(at, [anchor]);
    else bucket.push(anchor);
  }

  return {
    at(point) {
      const column = Math.floor(point.x / reach);
      const row = Math.floor(point.z / reach);
      let weighted = 0;
      let total = 0;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const anchor of buckets.get(`${column + dx}:${row + dz}`) ?? []) {
            const ax = anchor.x - point.x;
            const az = anchor.z - point.z;
            const distanceSq = ax * ax + az * az;
            // Sitting on an anchor is that anchor's height, not a division by zero.
            if (distanceSq < 1e-9) return anchor.y;
            if (distanceSq > reach * reach) continue;
            const weight = 1 / distanceSq;
            weighted += anchor.y * weight;
            total += weight;
          }
        }
      }
      // Nothing near enough to have an opinion -- this is new ground, and the
      // caller's own rule decides.
      return total > 0 ? weighted / total : undefined;
    },
  };
}

/**
 * Drops what the deletion took with it.
 *
 * A rim node shared with ground that survived is still there; one belonging
 * only to faces just deleted is gone. The *position* stays either way -- the
 * shape of the hole did not change -- but a point that no longer names a live
 * node is an ordinary point, and an edge missing an endpoint is an edge
 * nothing can split.
 */
function pruneToLive(
  rings: readonly ConstraintRing[],
  sources: readonly ConstructionNodeId[],
  isLive: (nodeId: ConstructionNodeId) => boolean,
): readonly ConstraintRing[] {
  const livePoint = (source: number | undefined): boolean => {
    if (source === undefined) return false;
    const nodeId = sources[source];
    return nodeId !== undefined && isLive(nodeId);
  };
  return rings.map((ring) => ({
    points: ring.points.map((point) => (livePoint(point.source) ? point : { x: point.x, z: point.z })),
    edges: ring.edges.map((edge, index) =>
      edge !== undefined &&
      livePoint(ring.points[index]?.source) &&
      livePoint(ring.points[(index + 1) % ring.points.length]?.source)
        ? edge
        : undefined,
    ),
  }));
}

export interface RegenerateRequest {
  /** The faces to throw away and lay again. */
  readonly consumedSurfaceKeys: readonly ConstructionSurfaceKey[];
  /**
   * Contours of other clouds standing inside that ground -- a road, a wall
   * footing. Met exactly, never regenerated, and never generated over.
   */
  readonly otherLoops: readonly (readonly ConstructionRegionEdge[])[];
  /** Where the positions of {@link otherLoops}' nodes are read from. */
  readonly otherNodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[];
  readonly faceSide: number;
  readonly causeId: string;
  readonly tableId: string;
  /**
   * Height for a corner no anchor of the old ground reaches -- genuinely new
   * ground. A repair has none of that and can pass a constant; a stroke hands
   * over its noise field.
   */
  readonly heightOfNewGround: (point: { readonly x: number; readonly z: number }) => number;
}

/** Faces laid. `0` means nothing was regenerated, for any reason. */
export function regenerateNeighbourhood(
  runtime: TerrainRegenerateRuntime,
  request: RegenerateRequest,
): number {
  if (request.consumedSurfaceKeys.length === 0) return 0;
  if (request.consumedSurfaceKeys.length > MOST_FACES_WORTH_REGENERATING) return 0;

  // Read before deleting: the rim of the hole is the perimeter of the faces
  // about to go, and it is knowable only while they still stand. So are the
  // heights -- every corner of the old ground, not only the rim that survives
  // it, or the relief inside the neighbourhood is blended away.
  const consumed = request.consumedSurfaceKeys
    .map((surfaceKey) => runtime.getRegionTopology(surfaceKey))
    .filter((topology): topology is ConstructionRegionTopology => topology !== undefined);
  if (consumed.length === 0) return 0;
  const surfaceType = consumed[0]!.surfaceType;

  const consumedPositions = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const topology of consumed) {
    for (const node of topology.nodes) consumedPositions.set(node.id, node.position);
  }
  const otherPositions = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const node of request.otherNodes) otherPositions.set(node.id, node.position);

  // One numbering across both lists, because the generator answers with a
  // single `source` index per corner and knows nothing of which ring it came
  // from.
  const rim = constraintsFromRings(
    outwardPerimeterRings(consumed),
    (nodeId) => consumedPositions.get(nodeId),
    0,
  );
  if (rim.rings.length === 0) return 0;
  const others = constraintsFromRings(
    request.otherLoops,
    (nodeId) => otherPositions.get(nodeId),
    rim.sources.length,
  );
  const sources = [...rim.sources, ...others.sources];

  const heights = heightFieldOf(
    [...consumedPositions.values(), ...otherPositions.values()],
    request.faceSide * 2,
  );

  // One region at a time: a key the engine no longer knows -- a face some
  // other pass already took -- is that key's own problem, never a reason to
  // leave the rest standing.
  let deleted = 0;
  for (const surfaceKey of request.consumedSurfaceKeys) {
    try {
      runtime.applyRegionEdit([{ kind: "delete-region", surfaceKey }], "local", request.causeId);
      deleted += 1;
    } catch {
      // Counted by its absence; the rim prune below sees the consequence.
    }
  }
  if (deleted === 0) return 0;

  const stamp = Math.abs(hashOf(request.consumedSurfaceKeys));
  const live = runtime.getSnapshot().map.nodePositions;

  return fillTerrain(runtime, {
    // Deterministic in the ground itself rather than in the clock, so the same
    // neighbourhood regenerated twice comes back the same: replayable from the
    // same log.
    what: "reparo de corte",
    mint: `${request.causeId}:regen-${stamp}`,
    tableId: request.tableId,
    causeId: request.causeId,
    seed: Math.max(1, stamp),
    faceSide: request.faceSide,
    // The consumed type, so ground made of slate comes back slate without this
    // side having to know that.
    surfaceType,
    boundary: pruneToLive(rim.rings, sources, (nodeId) => live.has(nodeId)),
    holes: others.rings,
    sources,
    heightAt: (point) => heights.at(point) ?? request.heightOfNewGround(point),
  }).built;
}

/**
 * Terrain's `CutRepairExecutor`: grow the ground back around the thing that
 * cut it.
 *
 * The hole a cut leaves is bounded on one side by the terrain that survived
 * and on the other by the road standing in the middle of it. Handing the
 * generator only the outer rim lays ground straight across the road -- the two
 * banks joined over the top of the path. Both sides go down carrying their own
 * node ids, so the ground that comes back shares real nodes and real edges
 * with the terrain it grew from *and* with the road it stops at: one graph,
 * terrain-road-terrain, without either side welding onto the other.
 *
 * What comes back is not what was there. The mesh is regenerated, not
 * restored, so a road drawn and erased leaves terrain of a different shape
 * than before. That is the accepted trade rather than keeping a shadow copy of
 * the ground a cut removed.
 */
export function repairTerrainCut(
  runtime: TerrainRegenerateRuntime,
  fallout: CutFallout,
  causeId: string,
  tableId: string,
): number {
  return regenerateNeighbourhood(runtime, {
    consumedSurfaceKeys: fallout.consumedSurfaceKeys,
    otherLoops: fallout.paintedLoops,
    otherNodes: fallout.paintedNodes,
    faceSide: DEFAULT_FACE_SIDE,
    causeId,
    tableId,
    // A repair invents no ground of its own: everything it lays replaces
    // ground that stood there, so the height field always has an opinion.
    // Level is the honest answer for the corner case where it does not.
    heightOfNewGround: () => 0,
  });
}

/** A stable small integer for a set of keys -- a seed, not a checksum. */
function hashOf(keys: readonly ConstructionSurfaceKey[]): number {
  let hash = 2166136261;
  for (const key of keys) {
    for (const part of key) {
      for (let index = 0; index < part.length; index += 1) {
        hash ^= part.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
    }
  }
  return hash | 0;
}
