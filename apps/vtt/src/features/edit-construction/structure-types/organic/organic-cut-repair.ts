import earcut from "earcut";
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
import { createBoundaryEdges, sharedEdgeId } from "../../topology/boundary-edges.ts";
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

/**
 * Below this area (world units squared) a *triangle* carries no ground at
 * all -- three points on one line. Far below {@link MIN_SHAPE_AREA} on
 * purpose: reinstating the vertices `polygon-clipping` simplified away
 * leaves legitimately thin triangles along a straight seam, and dropping
 * those would leave the neighbour's own edges walked by nothing, which is
 * the very gap this repair exists to close.
 */
const MIN_FACE_AREA = 1e-9;

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

/** The XZ extent a multipolygon occupies -- `undefined` when it holds no ring at all. */
function boundsOfShapes(shapes: MultiPolygon): { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number } | undefined {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const shape of shapes) {
    for (const ring of shape) {
      for (const [x, z] of ring) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
  }
  return minX === Infinity ? undefined : { minX, maxX, minZ, maxZ };
}

/** A whole multipolygon's area, openings taken out -- how much ground a shape really is. */
function areaOf(shapes: MultiPolygon): number {
  let total = 0;
  for (const [outer, ...holes] of shapes) {
    if (outer === undefined) continue;
    total += Math.abs(signedRingArea(outer));
    for (const hole of holes) total -= Math.abs(signedRingArea(hole));
  }
  return Math.round(total * 100) / 100;
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
 *
 * **Which way round a face is wound is not this side's to choose.** An edge
 * that already has a face on one side has exactly one free side left, facing
 * one way, and a face that walks it the other way is refused outright.
 * Picking a winding from the ring's own signed area (which is all a polygon
 * has to offer) is a coin flip against whatever convention the neighbouring
 * faces were built with, and it landed on the wrong side: every fill was
 * refused, on a real shared edge, with correct geometry.
 *
 * So the direction is read rather than chosen. `prescribed` is the engine's
 * own answer -- `getUnfilledLoops` reports each free edge already oriented
 * for the face that would fill that hole -- and the fill is wound to agree
 * with it wherever the two speak about the same edge. That holds no matter
 * what convention the rim, the painter, or a future third type were built
 * with, because it is never this module's convention being applied: it is
 * the neighbour's own, reported by the graph that holds both.
 */
function buildFillPatch(
  tableId: string,
  causeId: string,
  surfaceType: string,
  physical: boolean,
  shapes: MultiPolygon,
  candidates: readonly CutRepairWeldCandidate[],
  prescribed: ReadonlyMap<ConstructionEdgeId, boolean>,
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

  /**
   * Puts back every real node that lies *along* a ring's own segments.
   *
   * `polygon-clipping` drops collinear vertices: where the neighbour's own
   * boundary runs A-B-C in a straight line, the difference comes back as the
   * single segment A-C, and B is gone. That reads as harmless -- the shape is
   * identical -- and is not: the fill then declares one edge A~C where the
   * neighbour has two, A~B and B~C. Two coincident geometries, no edge in
   * common, and a T-junction standing at B. That is the gap along the seam,
   * and the reason a fill could weld every one of its corners onto a real id
   * and still not join anything: sharing a *vertex* is not sharing an *edge*.
   *
   * So the vertices the clipper simplified away are put back, from the real
   * nodes themselves -- nothing is minted here, and nothing moves; a node is
   * reinstated only where it already sat on the segment. What comes out walks
   * the neighbour's own edges, one for one.
   */
  const densify = (ids: readonly ConstructionNodeId[]): readonly ConstructionNodeId[] => {
    const present = new Set(ids);
    const walked: ConstructionNodeId[] = [];
    for (let index = 0; index < ids.length; index += 1) {
      const from = nodePositions.get(ids[index]!)!;
      const to = nodePositions.get(ids[(index + 1) % ids.length]!)!;
      walked.push(ids[index]!);

      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq < 1e-12) continue;

      const between: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition; readonly t: number }[] = [];
      for (const candidate of candidates) {
        if (present.has(candidate.id)) continue;
        const t = ((candidate.position.x - from.x) * dx + (candidate.position.z - from.z) * dz) / lengthSq;
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        const offX = candidate.position.x - (from.x + dx * t);
        const offZ = candidate.position.z - (from.z + dz * t);
        if (Math.hypot(offX, offZ) > WELD_TOLERANCE) continue;
        between.push({ id: candidate.id, position: candidate.position, t });
      }

      between.sort((left, right) => left.t - right.t);
      for (const node of between) {
        nodePositions.set(node.id, node.position);
        present.add(node.id);
        walked.push(node.id);
      }
    }
    return walked;
  };

  const idsFor = (ring: Ring, isHole: boolean): readonly ConstructionNodeId[] => {
    const ids = openRing(ensureUpwardWinding(ring, isHole)).map(([x, z]) => weldOrMint(x, z));
    // A ring that folded back onto the same node twice is not a face --
    // `polygon-clipping` can leave one at a self-touching pinch point.
    return new Set(ids).size === ids.length ? densify(ids) : [];
  };

  // Welded first, wound second: the weld is what makes a ring's edges
  // nameable at all, and only a named edge can be looked up in `prescribed`.
  interface PreparedShape {
    readonly shapeIndex: number;
    readonly outer: readonly ConstructionNodeId[];
    readonly holes: readonly (readonly ConstructionNodeId[])[];
  }
  const prepared: readonly PreparedShape[] = shapes
    .map((shape, shapeIndex): PreparedShape | undefined => {
      const [outerRing, ...holeRings] = shape;
      if (outerRing === undefined || Math.abs(signedRingArea(outerRing)) < MIN_SHAPE_AREA) return undefined;
      const outer = idsFor(outerRing, false);
      if (outer.length < 3) return undefined;
      const holes = holeRings.map((holeRing) => idsFor(holeRing, true)).filter((ids) => ids.length >= 3);
      return { shapeIndex, outer, holes };
    })
    .filter((entry): entry is PreparedShape => entry !== undefined);

  // One vote per edge the engine has already spoken about. The tally is
  // taken across every ring of every shape rather than per ring: a winding
  // is one convention for the whole fill, and a single ring may touch no
  // prescribed edge at all (an opening entirely inside the hole) while its
  // neighbours settle the question conclusively.
  let net = 0;
  for (const { outer, holes } of prepared) {
    for (const ids of [outer, ...holes]) {
      for (let index = 0; index < ids.length; index += 1) {
        const from = ids[index]!;
        const to = ids[(index + 1) % ids.length]!;
        const wanted = prescribed.get(sharedEdgeId(tableId, from, to));
        if (wanted === undefined) continue;
        net += wanted === !(from < to) ? 1 : -1;
      }
    }
  }
  // The fill lands as a mesh of faces, never as one face per shape.
  //
  // Two reasons, and the second is why every repair so far was lost whole.
  // A face is refused outright when any single edge of its boundary has no
  // room -- so a fill submitted as one face stakes the entire regeneration
  // on its worst edge, and every log of this repair read `created: 0,
  // skipped: 1`: one conflicting edge somewhere along a boundary of fifty,
  // and all the ground came back as nothing. Split, that same edge costs the
  // two triangles that touch it and the rest of the hole still fills.
  //
  // The triangulation adds no vertices: `earcut` only ever connects vertices
  // the rings already have, so every corner is still a real welded node and
  // every interior edge it introduces is new (free on both sides, refused by
  // nothing). It is also what the ground on either side already is -- terrain
  // is a mesh of small faces, not one continuous sheet -- and it is the same
  // library the painter's own preview already triangulates with.
  const regions: ConstructionPatchRegion[] = [];
  for (const { shapeIndex, outer, holes } of prepared) {
    const coordinates: number[] = [];
    const ordered: ConstructionNodeId[] = [];
    const holeStarts: number[] = [];
    for (const ids of [outer, ...holes]) {
      if (ids !== outer) holeStarts.push(ordered.length);
      for (const id of ids) {
        const position = nodePositions.get(id)!;
        coordinates.push(position.x, position.z);
        ordered.push(id);
      }
    }

    const indices = earcut(coordinates, holeStarts);
    for (let cursor = 0; cursor + 2 < indices.length; cursor += 3) {
      const corners = [indices[cursor]!, indices[cursor + 1]!, indices[cursor + 2]!].map((index) => ordered[index]!);
      if (new Set(corners).size !== 3) continue;
      const ring: Ring = corners.map((id) => {
        const position = nodePositions.get(id)!;
        return [position.x, position.z];
      });
      const area = signedRingArea(ring);
      // Not `MIN_SHAPE_AREA`: that filter is for shapes the clipper produced,
      // where a sliver means a degenerate artifact. A triangle is only ever
      // dropped here for being truly flat -- a reinstated collinear vertex
      // leaves genuinely thin triangles along the seam, and those are real
      // ground whose edges the neighbour is waiting to share.
      if (Math.abs(area) < MIN_FACE_AREA) continue;
      // Each triangle is wound the way the whole fill is -- `earcut`'s own
      // output orientation is not part of this decision, and normalising per
      // triangle rather than trusting it keeps the seam's direction the one
      // the engine prescribed.
      const walked = (area > 0) === (net >= 0) ? corners : [...corners].reverse();
      regions.push({
        regionId: `terrain-cut:${causeId}:fill-${shapeIndex}-${regions.length}`,
        boundary: walked.map((id, index) => edges.use(id, walked[(index + 1) % walked.length]!)),
        surfaceType,
        physical,
      });
    }
  }

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
  addPatch(patch: ConstructionPatch, origin: "local", causeId: string): {
    readonly createdSurfaceKeys: readonly unknown[];
    readonly skippedRegionIds: readonly string[];
    readonly skippedRegionReasons?: readonly string[];
  };
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
  // What this answer is read for is the *winding*: `boundary` reports each
  // free edge already oriented for the face that would fill this hole, which
  // is not this side's to guess. It is deliberately no longer read for weld
  // targets -- see `candidates` below.
  const prescribed = new Map<ConstructionEdgeId, boolean>();
  for (const loop of loops) {
    for (const use of loop.boundary) prescribed.set(use.edgeId, use.reversed);
  }

  const deleted = areaOfRings(consumedRings);
  const painted = areaOfRings(fallout.paintedLoops);
  const fill: MultiPolygon = painted.length === 0 ? deleted : polygonClipping.difference(deleted, painted);

  // Every live node standing in the ground this cut removed, whoever it
  // belongs to.
  //
  // The weld used to see only what `getUnfilledLoops` reported plus the
  // painter's own nodes, and a vertex it could not match was minted fresh.
  // That is exactly how a fill ends up floating: a node the loop query did
  // not name is still *there*, so the fill mints a second node at the very
  // same position -- coincident, and connected to nothing. Whether a node
  // should be reused is a question about the graph, not about which loops a
  // scoped query happened to return, so the graph is asked directly.
  //
  // Bounded by the removed area rather than the whole table, and that is
  // exact rather than a heuristic: the fill lies inside what the cut removed,
  // so no node outside those bounds can sit on one of its vertices. Anything
  // still standing inside them is fair game to weld onto whatever its type,
  // which is what keeps the regenerated ground in one cloud with both the rim
  // it came from and the painter that cut it.
  const reach = boundsOfShapes(deleted);
  const byId = new Map<ConstructionNodeId, ConstructionPosition>();
  if (reach !== undefined) {
    for (const [id, entry] of snapshot.map.nodePositions) {
      const { position } = entry;
      if (position.x < reach.minX - WELD_TOLERANCE || position.x > reach.maxX + WELD_TOLERANCE) continue;
      if (position.z < reach.minZ - WELD_TOLERANCE || position.z > reach.maxZ + WELD_TOLERANCE) continue;
      byId.set(id, position);
    }
  }
  // The painter's own nodes on top of that, by name rather than by bounds.
  // They are live nodes and the graph scan above already reaches them, so
  // this adds nothing in practice -- it is what `CutFallout.paintedNodes`
  // promises, kept true independently of how the sweep above is bounded.
  for (const node of fallout.paintedNodes) byId.set(node.id, node.position);
  const candidates: CutRepairWeldCandidate[] = [...byId].map(([id, position]) => ({ id, position }));
  const patch = buildFillPatch(snapshot.tableId, causeId, surfaceType, physical, fill, candidates, prescribed);

  // TEMP DIAGNOSTIC -- remove once the live fill is confirmed. A single
  // string, not a (tag, object) pair: copying the console as plain text
  // collapses an object argument to the literal word "Object".
  console.warn(
    `[terrain-cut-repair] fill ${JSON.stringify({
      causeId,
      consumed: consumedTopologies.length,
      failedDeletes: failedDeletes.length,
      weldCandidates: candidates.length,
      paintedNodes: fallout.paintedNodes.length,
      paintedLoops: fallout.paintedLoops.length,
      prescribedEdges: prescribed.size,
      paintedShapes: painted.length,
      deletedShapes: deleted.length,
      deletedArea: areaOf(deleted),
      paintedArea: areaOf(painted),
      fillArea: areaOf(fill),
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
      why: outcome.skippedRegionReasons ?? [],
    })}`,
  );
  return outcome.createdSurfaceKeys.length;
}
