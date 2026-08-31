import polygonClipping from "polygon-clipping";
import type { MultiPolygon, Polygon, Ring } from "polygon-clipping";

import type {
  ConstructionEdgeId,
  ConstructionNodeId,
  ConstructionPatch,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import type { AtomicEditOp } from "../../orchestration/atomic-edit.ts";
import { createBoundaryEdges } from "../../topology/boundary-edges.ts";
import type { CutFallout } from "../structure-type.ts";

/**
 * How close (world units, XZ) a fill vertex must sit to a node already on
 * the table before it reuses that node's id instead of minting a fresh one.
 *
 * Exact, deliberately -- the same tolerance, for the same reason, as
 * `contour-patch.ts`'s own `WELD_TOLERANCE`. This fill's own vertices are
 * *derived from* real geometry (the deleted area's own boundary, and the
 * painter's own contour), never invented independently of it, so a vertex
 * that should weld sits exactly where its counterpart already is -- there is
 * nothing to be generous about. An earlier version of this repair generated
 * an independent lattice and tried to weld it onto real geometry afterwards
 * by proximity; every tolerance it picked was either too tight to connect or
 * loose enough to connect the wrong things, because the two sides had no
 * reason to agree. Computing the fill *from* the real boundary removes the
 * disagreement rather than tuning it.
 */
const WELD_TOLERANCE = 1e-3;

/**
 * Below this area (world units squared) a shape is a sliver, not a face --
 * the same filter, for the same reason, as `contour-patch.ts`'s own
 * `MIN_SHAPE_AREA`: `polygon-clipping` normalises rather than refuses a
 * degenerate input, and a near-zero-area artifact at a crossing point is
 * still a structurally valid ring nothing downstream would catch.
 */
const MIN_SHAPE_AREA = 1e-4;

/** One real, already-live node this repair may weld a fill vertex onto. */
export interface CutRepairWeldCandidate {
  readonly id: ConstructionNodeId;
  readonly position: ConstructionPosition;
}

function boundsOf(points: readonly ConstructionPosition[]): { readonly centerX: number; readonly centerZ: number; readonly radius: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return { centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2, radius: Math.max(maxX - minX, maxZ - minZ, 0) / 2 };
}

function signedRingArea(ring: Ring): number {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, z1] = ring[index]!;
    const [x2, z2] = ring[(index + 1) % ring.length]!;
    total += z1 * x2 - x1 * z2;
  }
  return total / 2;
}

/** Ensures an outer ring is wound with its normal facing up (+Y), a hole the other way -- `contour-patch.ts` does the same for the same renderer. */
function ensureUpwardWinding(ring: Ring, isHole: boolean): Ring {
  const area = signedRingArea(ring);
  const shouldReverse = isHole ? area > 0 : area < 0;
  return shouldReverse ? [...ring].reverse() : ring;
}

/** `polygon-clipping` repeats a ring's first point as its last (GeoJSON); a region boundary is a cycle of distinct nodes, so that duplicate is dropped once here. */
function openRing(ring: Ring): Ring {
  if (ring.length < 2) return ring;
  const [firstX, firstZ] = ring[0]!;
  const [lastX, lastZ] = ring[ring.length - 1]!;
  return Math.hypot(firstX - lastX, firstZ - lastZ) < 1e-9 ? ring.slice(0, -1) : ring;
}

/** The `y` of whichever candidate is nearest `(x, z)` -- a vertex the difference itself minted (a crossing point no original boundary vertex sits on) has no height of its own. */
function nearestHeight(x: number, z: number, candidates: readonly CutRepairWeldCandidate[]): number {
  let bestY = candidates[0]?.position.y ?? 0;
  let bestDistanceSq = Infinity;
  for (const candidate of candidates) {
    const dx = candidate.position.x - x;
    const dz = candidate.position.z - z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestY = candidate.position.y;
    }
  }
  return bestY;
}

/**
 * One face-boundary ring per entry, unioned into the true area they cover
 * between them -- the one conversion both sides of this repair need.
 *
 * Both the ground the cut removed and the ground the painter now occupies
 * arrive the same way: as each face's own boundary loop, in the engine's own
 * order, of real node positions. Neither side is ever re-derived by walking
 * loose edges: adjoining faces share interior edges, so such a walk picks an
 * arbitrary path rather than an outline, and a different one each run. The
 * union collapses adjoining faces into the single area they really form.
 */
function areaOfRings(rings: readonly (readonly ConstructionPosition[])[]): MultiPolygon {
  const polygons: Polygon[] = rings
    .filter((ring) => ring.length >= 3)
    .map((ring) => [ring.map((point) => [point.x, point.z] as [number, number])]);
  if (polygons.length === 0) return [];
  const [first, ...rest] = polygons;
  return polygonClipping.union(first!, ...rest);
}

/**
 * Turns the fill's own shapes into a `ConstructionPatch`, welding every
 * vertex that sits on a real node onto that node's own id.
 *
 * The same conversion `contour-patch.ts`'s own `buildContourPatch` performs
 * for the painter's side, with terrain's own edge-sharing rule
 * (`"refuse-when-full"`: a boundary with a face on both sides is interior
 * ground, and terrain is never created above anything) instead of the
 * painter's `"private-when-full"`.
 */
function buildFillPatch(
  tableId: string,
  causeId: string,
  surfaceType: string,
  physical: boolean,
  shapes: MultiPolygon,
  candidates: readonly CutRepairWeldCandidate[],
): ConstructionPatch | undefined {
  const edges = createBoundaryEdges(tableId, { kind: "refuse-when-full" });
  const nodePositions = new Map<ConstructionNodeId, ConstructionPosition>();
  const claimed = new Set<ConstructionNodeId>();

  const weldOrMint = (() => {
    let mintedCounter = 0;
    return (x: number, z: number): ConstructionNodeId => {
      let best: { readonly candidate: CutRepairWeldCandidate; readonly distance: number } | undefined;
      for (const candidate of candidates) {
        const distance = Math.hypot(candidate.position.x - x, candidate.position.z - z);
        if (distance > WELD_TOLERANCE) continue;
        if (best === undefined || distance < best.distance) best = { candidate, distance };
      }
      if (best !== undefined) {
        nodePositions.set(best.candidate.id, best.candidate.position);
        claimed.add(best.candidate.id);
        return best.candidate.id;
      }
      const id: ConstructionNodeId = `terrain-cut:${causeId}:v${mintedCounter}`;
      mintedCounter += 1;
      nodePositions.set(id, { x, y: nearestHeight(x, z, candidates), z });
      return id;
    };
  })();

  const regions: ConstructionPatchRegion[] = [];
  shapes.forEach((shape, shapeIndex) => {
    const [outerRing, ...holeRings] = shape;
    if (outerRing === undefined || Math.abs(signedRingArea(outerRing)) < MIN_SHAPE_AREA) return;

    const idsFor = (ring: Ring, isHole: boolean): readonly ConstructionNodeId[] => {
      const ids = openRing(ensureUpwardWinding(ring, isHole)).map(([x, z]) => weldOrMint(x, z));
      // A ring that folded back onto the same node twice is not a face --
      // `polygon-clipping` can leave one at a self-touching pinch point.
      return new Set(ids).size === ids.length ? ids : [];
    };

    const outerIds = idsFor(outerRing, false);
    if (outerIds.length < 3) return;
    const boundary = outerIds.map((id, index) => edges.use(id, outerIds[(index + 1) % outerIds.length]!));
    const holes = holeRings
      .map((holeRing) => idsFor(holeRing, true))
      .filter((ids) => ids.length >= 3)
      .map((ids) => ids.map((id, index) => edges.use(id, ids[(index + 1) % ids.length]!)));

    regions.push({
      regionId: `terrain-cut:${causeId}:fill-${shapeIndex}`,
      boundary,
      ...(holes.length > 0 ? { holes } : {}),
      surfaceType,
      physical,
    });
  });

  if (regions.length === 0) return undefined;
  const declared = edges.all();
  const referenced = new Set<ConstructionNodeId>();
  for (const edge of declared) {
    referenced.add(edge.startNodeId);
    referenced.add(edge.endNodeId);
  }
  return {
    nodes: [...nodePositions].filter(([id]) => referenced.has(id)).map(([id, position]) => ({ id, position })),
    edges: declared,
    regions,
  };
}

/**
 * The minimal runtime capability {@link repairOrganicCut} needs, declared
 * here rather than imported from `composition/tabletop/tabletop-runtime.ts`
 * -- this module depends on composition for nothing at all. `TabletopRuntime`
 * satisfies this structurally, with room to spare.
 */
export interface OrganicCutRepairRuntime {
  getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined;
  getUnfilledLoops(scope: readonly ConstructionNodeId[]): readonly {
    readonly nodeIds: readonly ConstructionNodeId[];
    readonly boundary: readonly { readonly edgeId: ConstructionEdgeId; readonly reversed: boolean }[];
  }[];
  getSnapshot(): {
    readonly tableId: string;
    readonly map: { readonly nodePositions: ReadonlyMap<ConstructionNodeId, { readonly position: ConstructionPosition }> };
  };
  applyRegionEdit(ops: readonly AtomicEditOp[], origin: "local", causeId: string): unknown;
  /**
   * `addPatch`, not `applyPatchReplacement`: this fill replaces nothing --
   * the consumed regions were already deleted, separately, above -- it only
   * adds the ground that was left over once the painter's own area is taken
   * out of what the cut removed. A region the engine still finds no room for
   * costs only itself, never the rest of the batch.
   */
  addPatch(patch: ConstructionPatch, origin: "local", causeId: string): { readonly createdSurfaceKeys: readonly unknown[]; readonly skippedRegionIds: readonly string[] };
}

/**
 * Terrain's own complete answer to `resolveCutRepair`'s `"regenerate"`.
 *
 * **What this is, in one line:** the ground this repair owes back is exactly
 * *what the cut removed, minus what the painter now occupies* -- a polygon
 * difference -- and the faces to register are that shape's own rings, welded
 * onto the real nodes their vertices already sit on.
 *
 * **Why it is computed rather than generated.** Every earlier version of
 * this repair generated fresh geometry of its own (a lattice from terrain's
 * own generator, sized to the hole) and then tried to reconcile it with the
 * real boundary afterwards -- pinning it during relax, welding it by
 * proximity, guarding against corners that welded onto real ids with no real
 * edge between them, demoting the ones that did, rejecting quads whose own
 * corners wandered past the boundary. Every one of those mechanisms existed
 * to paper over the same gap: geometry invented independently of the real
 * boundary has no reason to agree with it, and each tolerance that made one
 * case connect made another connect wrongly. Deriving the fill *from* the
 * real boundary removes the gap instead of tuning it -- a vertex that should
 * weld sits exactly on its counterpart, because it came from it.
 *
 * `polygon-clipping` and `earcut`-style ring handling are already how the
 * painter's own contour is built (`contour/contour-patch.ts`,
 * `contour/union-bands.ts`); this is the same shape of computation for the
 * covered type's own side of the same seam.
 *
 * **The steps:**
 * 1. Read every consumed region's own topology before deleting it -- the
 *    shape of what is being removed is a fact of the cut, knowable only
 *    while those regions still stand.
 * 2. Delete the consumed regions. Terrain's own call, not the painter's.
 * 3. `getUnfilledLoops`, scoped to what those regions stood on, reports
 *    whichever part of the rim survives as real, live nodes -- weld targets,
 *    together with the painter's own registered nodes.
 * 4. Subtract the area of the painter's own faces from the area of the
 *    consumed ones. What remains is the ground to give back.
 * 5. Register it, welding every vertex that sits on a real node onto it.
 */
export function repairOrganicCut(runtime: OrganicCutRepairRuntime, fallout: CutFallout, causeId: string): number {
  if (fallout.consumedSurfaceKeys.length === 0) return 0;

  const consumedTopologies = fallout.consumedSurfaceKeys
    .map((surfaceKey) => runtime.getRegionTopology(surfaceKey))
    .filter((topology): topology is ConstructionRegionTopology => topology !== undefined);
  if (consumedTopologies.length === 0) return 0;
  const surfaceType = consumedTopologies[0]!.surfaceType;
  const physical = consumedTopologies[0]!.physical;

  const preScope = new Set<ConstructionNodeId>();
  const consumedPositions = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const topology of consumedTopologies) {
    for (const node of topology.nodes) {
      preScope.add(node.id);
      consumedPositions.set(node.id, node.position);
    }
  }
  if (preScope.size === 0) return 0;

  // The shape of what is being removed, from what the cut consumed -- known
  // before any deletion happens, never from whatever boundary the deletion
  // happens to leave exposed afterwards.
  const consumedRings: ConstructionPosition[][] = [];
  for (const topology of consumedTopologies) {
    for (const loop of topology.outerLoops) {
      const ring = loop
        .map((edge) => consumedPositions.get(edge.startNodeId))
        .filter((position): position is ConstructionPosition => position !== undefined);
      if (ring.length >= 3) consumedRings.push(ring);
    }
  }
  if (consumedRings.length === 0) return 0;

  const failedDeletes: ConstructionSurfaceKey[] = [];
  for (const surfaceKey of fallout.consumedSurfaceKeys) {
    try {
      runtime.applyRegionEdit([{ kind: "delete-region", surfaceKey }], "local", causeId);
    } catch {
      failedDeletes.push(surfaceKey);
    }
  }

  const loops = runtime.getUnfilledLoops([...preScope]);
  const snapshot = runtime.getSnapshot();
  const liveRimCandidates: CutRepairWeldCandidate[] = [];
  for (const loop of loops) {
    for (const nodeId of loop.nodeIds) {
      const position = snapshot.map.nodePositions.get(nodeId)?.position;
      if (position !== undefined) liveRimCandidates.push({ id: nodeId, position });
    }
  }

  const deleted = areaOfRings(consumedRings);
  const painted = areaOfRings(fallout.paintedLoops);
  const fill: MultiPolygon = painted.length === 0 ? deleted : polygonClipping.difference(deleted, painted);

  const candidates: CutRepairWeldCandidate[] = [...liveRimCandidates, ...fallout.paintedNodes];
  const patch = buildFillPatch(snapshot.tableId, causeId, surfaceType, physical, fill, candidates);

  // TEMP DIAGNOSTIC -- remove once the live fill is confirmed. A single
  // string, not a (tag, object) pair: copying the console as plain text
  // collapses an object argument to the literal word "Object".
  console.warn(
    `[terrain-cut-repair] fill ${JSON.stringify({
      causeId,
      consumed: consumedTopologies.length,
      failedDeletes: failedDeletes.length,
      rimCandidates: liveRimCandidates.length,
      paintedNodes: fallout.paintedNodes.length,
      paintedLoops: fallout.paintedLoops.length,
      paintedShapes: painted.length,
      deletedShapes: deleted.length,
      fillShapes: fill.length,
      regions: patch?.regions.length ?? 0,
      nodes: patch?.nodes.length ?? 0,
      welded: patch?.nodes.filter((node) => !node.id.startsWith(`terrain-cut:${causeId}:`)).length ?? 0,
      bounds: patch === undefined ? undefined : boundsOf(patch.nodes.map((node) => node.position)),
    })}`,
  );

  if (patch === undefined) return 0;

  const outcome = runtime.addPatch(patch, "local", causeId);
  console.warn(
    `[terrain-cut-repair] addPatch outcome ${JSON.stringify({
      causeId,
      created: outcome.createdSurfaceKeys.length,
      skipped: outcome.skippedRegionIds.length,
      skippedIds: outcome.skippedRegionIds,
    })}`,
  );
  return outcome.createdSurfaceKeys.length;
}
