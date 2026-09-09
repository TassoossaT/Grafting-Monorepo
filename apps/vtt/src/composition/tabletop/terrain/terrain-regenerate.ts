import type {
  ConstructionGridConstraintPoint,
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
import { outwardPerimeterRings } from "../../../features/edit-construction/index.ts";
import { constraintsFromRings, type ConstraintRing } from "./terrain-constraints.ts";
import { DEFAULT_FACE_SIDE, fillTerrain, type TerrainFillRuntime } from "./terrain-fill.ts";
import polygonClipping, { type Polygon } from "polygon-clipping";

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

/** Shoelace area of a ring's own points, ignoring winding direction. */
function ringArea(points: readonly { readonly x: number; readonly z: number }[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}

function ringToPolygon(ring: ConstraintRing): Polygon | undefined {
  if (ring.points.length < 3) return undefined;
  const closed: [number, number][] = ring.points.map((point) => [point.x, point.z]);
  closed.push([ring.points[0]!.x, ring.points[0]!.z]);
  return [closed];
}

/**
 * Whether a connecting structure's hole (e.g. a road loop) actually belongs to
 * *this* patch of ground, checked by real overlap rather than a bounding-box
 * guess.
 *
 * The rim and a road's loop are produced by two unrelated walks of the graph
 * -- one from the faces just deleted, one from whatever the road happens to
 * stand on nearby -- so nothing before this point ever confirmed the two
 * agree. A loop that only grazes this rim's box (two road segments meeting
 * near, not inside, this cut) used to be handed to the generator as if it
 * were fully interior, which is the shape of "no room on edge" and duplicated
 * faces the commits on this cut kept re-discovering under different names.
 *
 * `0.5` rather than exact equality: the rim and a road loop are decimated
 * independently, so their shared border is never bit-identical, only close.
 * A loop mostly outside this rim is a foreign loop, not an imprecise one.
 */
function isMostlyContained(hole: Polygon, boundaries: readonly Polygon[]): boolean {
  if (boundaries.length === 0) return false;
  const holePoints = hole[0]!.slice(0, -1).map(([x, z]) => ({ x, z }));
  const holeArea = ringArea(holePoints);
  if (holeArea <= 1e-6) return false;
  let overlap = 0;
  try {
    const result = polygonClipping.intersection(hole, boundaries[0]!, ...boundaries.slice(1));
    for (const polygon of result) {
      overlap += ringArea(polygon[0]!.slice(0, -1).map(([x, z]) => ({ x, z })));
    }
  } catch {
    // A degenerate rim (self-touching, from faces the deletion left in a
    // strange shape) cannot be checked -- fall through rather than discard a
    // loop that was never actually shown to be wrong.
    return true;
  }
  return overlap >= holeArea * 0.5;
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
  const directlyConsumed = request.consumedSurfaceKeys
    .map((surfaceKey) => runtime.getRegionTopology(surfaceKey))
    .filter((topology): topology is ConstructionRegionTopology => topology !== undefined);
  if (directlyConsumed.length === 0) return 0;
  const surfaceType = directlyConsumed[0]!.surfaceType;

  // Grown to the faces bordering the hole, not just the hole itself, the same
  // way a stroke's own affected set is read through a padded box
  // (`terrainStandingAround`) rather than exactly the footprint it swept.
  // A repair that regenerates only the torn face has to fit its new mesh
  // into that exact, tightly bounded shape -- there is no room in it to lay
  // a face the size the rest of the ground uses, so the patch comes back
  // smaller and more irregular than anything the brush would produce. Tearing
  // down a ring of standing neighbours too gives the generator a boundary big
  // enough to lay ground the same way it lays ground anywhere else: one
  // contiguous surface regenerated in mass, not a sliver patched into a hole
  // the shape of what a road happened to remove.
  let directMinX = Infinity;
  let directMinZ = Infinity;
  let directMaxX = -Infinity;
  let directMaxZ = -Infinity;
  for (const topology of directlyConsumed) {
    for (const node of topology.nodes) {
      directMinX = Math.min(directMinX, node.position.x);
      directMinZ = Math.min(directMinZ, node.position.z);
      directMaxX = Math.max(directMaxX, node.position.x);
      directMaxZ = Math.max(directMaxZ, node.position.z);
    }
  }
  const growReach = Math.max(request.faceSide * 2, DEFAULT_FACE_SIDE * 2);
  const directKeys = new Set(request.consumedSurfaceKeys.map((key) => key.join(":")));
  const neighbourTopologies =
    typeof runtime.getRegionTopologiesInBounds === "function"
      ? runtime
          .getRegionTopologiesInBounds({
            minX: directMinX - growReach,
            minZ: directMinZ - growReach,
            maxX: directMaxX + growReach,
            maxZ: directMaxZ + growReach,
          })
          .filter(
            (topology) =>
              topology.surfaceType === surfaceType && !directKeys.has(topology.surfaceKey.join(":")),
          )
      : [];
  const grown = neighbourTopologies.slice(
    0,
    Math.max(0, MOST_FACES_WORTH_REGENERATING - directlyConsumed.length),
  );
  const consumed = [...directlyConsumed, ...grown];
  const consumedSurfaceKeys = consumed.map((topology) => topology.surfaceKey);

  const consumedPositions = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const topology of consumed) {
    for (const node of topology.nodes) consumedPositions.set(node.id, node.position);
  }
  const otherPositions = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const node of request.otherNodes) otherPositions.set(node.id, node.position);

  // One numbering across both lists, because the generator answers with a
  // single `source` index per corner and knows nothing of which ring it came
  // from.
  const liveMap = runtime.getSnapshot().map.nodePositions;
  let rimRings = outwardPerimeterRings(consumed);
  if (rimRings.length === 0 && consumed.length > 0) {
    rimRings = consumed.flatMap((t) =>
      t.outerLoops.filter((loop) => loop.length >= 3 && loop[loop.length - 1]!.endNodeId === loop[0]!.startNodeId),
    );
  }
  const rim = constraintsFromRings(
    rimRings,
    (nodeId) => consumedPositions.get(nodeId) ?? liveMap.get(nodeId)?.position,
    0,
  );
  if (rim.rings.length === 0) return 0;
  const others = constraintsFromRings(
    request.otherLoops,
    (nodeId) => otherPositions.get(nodeId) ?? liveMap.get(nodeId)?.position,
    rim.sources.length,
  );
  const sources = [...rim.sources, ...others.sources];

  // Derive faceSide naturally from the consumed terrain topologies to preserve
  // the organic scale of the terrain and prevent micro-face fragmentation.
  let effectiveFaceSide = Math.max(request.faceSide, DEFAULT_FACE_SIDE);
  if (consumed.length > 0) {
    let totalArea = 0;
    for (const t of consumed) {
      if (t.nodes.length >= 3) {
        let area = 0;
        for (let i = 0; i < t.nodes.length; i++) {
          const p1 = t.nodes[i]!.position;
          const p2 = t.nodes[(i + 1) % t.nodes.length]!.position;
          area += p1.x * p2.z - p2.x * p1.z;
        }
        totalArea += Math.abs(area) / 2;
      }
    }
    const avgFaceArea = totalArea / consumed.length;
    if (avgFaceArea > 1.0) {
      effectiveFaceSide = Math.max(effectiveFaceSide, Math.sqrt(avgFaceArea));
    }
  }

  const heights = heightFieldOf(
    [...consumedPositions.values(), ...otherPositions.values()],
    effectiveFaceSide * 2,
  );

  // Identify nodes that belong to surviving ground (surviving topologies or nodes outside consumed)
  const consumedKeysSet = new Set(consumedSurfaceKeys.map((k) => k.join(":")));
  const allTopologies = typeof runtime.getAllRegionTopologies === "function" ? runtime.getAllRegionTopologies() : [];
  const survivingNodes = new Set<string>();
  for (const topology of allTopologies) {
    if (!consumedKeysSet.has(topology.surfaceKey.join(":"))) {
      for (const node of topology.nodes) survivingNodes.add(node.id);
    }
  }
  if (survivingNodes.size === 0) {
    for (const [id] of liveMap) {
      if (!consumedPositions.has(id)) survivingNodes.add(id);
    }
  }

  // Filter hole rings so we don't pass far-away road loops into local terrain fill
  let cMinX = Infinity, cMaxX = -Infinity, cMinZ = Infinity, cMaxZ = -Infinity;
  for (const pos of consumedPositions.values()) {
    if (pos.x < cMinX) cMinX = pos.x;
    if (pos.x > cMaxX) cMaxX = pos.x;
    if (pos.z < cMinZ) cMinZ = pos.z;
    if (pos.z > cMaxZ) cMaxZ = pos.z;
  }
  const cMargin = Math.max(4.0, effectiveFaceSide * 2.0);
  const nearbyHoleRings = others.rings.filter((ring) =>
    ring.points.some(
      (p) => p.x >= cMinX - cMargin && p.x <= cMaxX + cMargin && p.z >= cMinZ - cMargin && p.z <= cMaxZ + cMargin,
    ),
  );
  // The bounding-box pass above is cheap and only ever over-includes; this one
  // resolves the cases it can't: two road loops whose boxes both graze this
  // rim, only one of which the rim's real shape encloses. See isMostlyContained.
  const rimPolygons = rim.rings.map(ringToPolygon).filter((polygon): polygon is Polygon => polygon !== undefined);
  const relevantHoleRings = nearbyHoleRings.filter((ring) => {
    const holePolygon = ringToPolygon(ring);
    return holePolygon !== undefined && isMostlyContained(holePolygon, rimPolygons);
  });

  const supportsPatchReplacement = typeof (runtime as unknown as { applyPatchReplacement?: unknown }).applyPatchReplacement === "function";

  if (!supportsPatchReplacement) {
    let deleted = 0;
    for (const surfaceKey of consumedSurfaceKeys) {
      try {
        runtime.applyRegionEdit([{ kind: "delete-region", surfaceKey }], "local", request.causeId);
        deleted += 1;
      } catch {}
    }
    if (deleted === 0) return 0;
  }

  const live = runtime.getSnapshot().map.nodePositions;
  const isLive = (nodeId: ConstructionNodeId): boolean => {
    if (!live.has(nodeId)) return false;
    if (supportsPatchReplacement && survivingNodes.size > 0) {
      return survivingNodes.has(nodeId);
    }
    return true;
  };

  const stamp = Math.abs(hashOf(consumedSurfaceKeys));
  const topologySeeds = allTopologies
    .filter((t) => !consumedKeysSet.has(t.surfaceKey.join(":")) && t.surfaceType === surfaceType)
    .slice(0, 8)
    .map((t) => ({ seed: t.surfaceKey, surfaceType: t.surfaceType }));

  return fillTerrain(runtime, {
    // Deterministic in the ground itself rather than in the clock, so the same
    // neighbourhood regenerated twice comes back the same: replayable from the
    // same log.
    what: "reparo de corte",
    mint: `${request.causeId}:regen-${stamp}`,
    tableId: request.tableId,
    causeId: request.causeId,
    seed: Math.max(1, stamp),
    faceSide: effectiveFaceSide,
    relaxStrength: 0.7,
    // The consumed type, so ground made of slate comes back slate without this
    // side having to know that.
    surfaceType,
    boundary: pruneToLive(rim.rings, sources, isLive),
    holes: relevantHoleRings.length > 0 ? relevantHoleRings : others.rings,
    sources,
    replaceSurfaceKeys: supportsPatchReplacement ? consumedSurfaceKeys : undefined,
    topologySeeds,
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
