import type {
  ApplyPatchReplacementRequest,
  CloudRequest,
  ConstructionIrregularQuadGrid,
  ConstructionIrregularQuadGridRequest,
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPatch,
  ConstructionPatchOutcome,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import type { AtomicEditOp } from "@/features/edit-construction";

import {
  SHORTEST_USEFUL_FRACTION,
  adoptContourNodes,
  resolveAdoptions,
  type ConstraintRing,
} from "./terrain-constraints.ts";
import { logTerrainCommit } from "./terrain-diagnostics.ts";
import { createBoundaryEdges, sharedEdgeId } from "../core/boundary-edges.ts";

/**
 * Laying ground into an area bounded by what is already standing.
 *
 * **One path, two callers.** A stroke that paints new terrain and a repair
 * that regrows terrain a road just cut through are the same operation with
 * different rings: an area to fill, holes somebody already holds, and a rule
 * for how high the result sits. Creation and regeneration used to be separate
 * code -- a lattice welded by proximity on one side, a polygon difference
 * triangulated by ear clipping on the other -- and they failed in different
 * ways for the same underlying reason: each computed a shape independently of
 * the graph and then had to make the result agree with it. There is nothing
 * here for the two to disagree about any more.
 *
 * That is also what makes a road reversible without leaving a hole: erasing
 * one is a cut in reverse, and the ground comes back through this same call.
 * It does not come back *identical* -- the mesh is regenerated, not restored
 * -- which is the trade the owner accepted rather than keeping a shadow copy
 * of what stood there before.
 */

/** What {@link fillTerrain} needs of the runtime, structurally. */
export interface TerrainFillRuntime {
  generateIrregularQuadGrid(
    request: ConstructionIrregularQuadGridRequest,
  ): ConstructionIrregularQuadGrid | undefined;
  addPatch(patch: ConstructionPatch, origin: "local", causeId: string): ConstructionPatchOutcome;
  applyPatchReplacement(
    request: ApplyPatchReplacementRequest,
    origin: "local",
    causeId: string,
  ): ConstructionPatchOutcome;
  getRegionTopologiesInBounds(bounds: FillBounds & { readonly seeds?: readonly CloudRequest[] }): readonly ConstructionRegionTopology[];
  applyRegionEdit(ops: readonly AtomicEditOp[], origin: "local", causeId: string): unknown;
  getSnapshot(): {
    readonly map: {
      readonly nodePositions: ReadonlyMap<ConstructionNodeId, { readonly position: ConstructionPosition }>;
    };
  };
}

/** The extent of the generated grid, for a height rule that wants to span it. */
export interface FillBounds {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export interface TerrainFillRequest {
  /**
   * Prefix every node and edge this fill mints is named under. Whatever the
   * caller passes has to be unique to this fill: two fills sharing a prefix
   * would mint the same node id for different ground.
   */
  readonly mint: string;
  /** Which table the shared boundary edges belong to. */
  readonly tableId: string;
  readonly causeId: string;
  readonly seed: number;
  /** How wide one finished face should be; see the port's own `faceSide`. */
  readonly faceSide: number;
  /** Passed straight through; see the port's own `relaxStrength`. */
  readonly relaxStrength?: number;
  readonly surfaceType: string;
  /** The area to fill. */
  readonly boundary: readonly ConstraintRing[];
  /** Ground inside that area somebody already holds: met, never regenerated. */
  readonly holes: readonly ConstraintRing[];
  /** `sources[i]` is the node id the rings handed out as `source: i`, across both lists. */
  readonly sources: readonly ConstructionNodeId[];
  /**
   * How high a corner sits, for the corners this fill has to invent. A corner
   * that arrived carrying a source is never asked -- it is a node already
   * standing, and moving it would drag the ground it already belongs to.
   */
  readonly heightAt: (point: { readonly x: number; readonly z: number }, bounds: FillBounds) => number;
  /**
   * Called once the generator has answered and before anything is registered.
   *
   * This is where a caller that is *replacing* ground takes the old ground
   * away. The ordering is the point: a caller that deletes first and then
   * discovers the generator will not accept its rings has destroyed ground and
   * has nothing to put back. Generating first makes a refusal cost nothing.
   */
  /**
   * Run once the generator has answered and before anything is registered.
   *
   * Returns what it managed to clear, because the caller's own count is what
   * it *meant* to clear. Those two silently diverging is indistinguishable
   * from every other cause of a refused face -- ground that was supposed to
   * be gone is excluded from the hole rings on purpose, so a face landing on
   * it is neither inside a hole nor wound wrongly. It just collides.
   */
  readonly onGenerated?: () => { readonly deleted: number; readonly failed: readonly string[] } | void;
  /** Existing faces replaced atomically with this fill. An empty list still makes the patch all-or-nothing. */
  readonly replaceSurfaceKeys?: readonly ConstructionSurfaceKey[];
  /** Retained clouds whose post-adoption edge directions this fill can meet. */
  readonly topologySeeds?: readonly CloudRequest[];
  /** Names this commit in the console log -- "pincelada", "reparo de corte". */
  readonly what: string;
  /** Faces this fill replaced, for the log only. */
  readonly regenerated?: number;
}

export interface TerrainFillOutcome {
  readonly built: number;
  /** Faces the engine refused: ground that already has a face on both sides. */
  readonly refused: number;
  /** Nodes that wanted a neighbour's edge split and did not get it -- one T-junction each. */
  readonly unadopted: number;
  /** `false` when refinement hit its vertex ceiling and part of the area came back coarser. */
  readonly refinementComplete: boolean;
  /**
   * Set when registering the generated grid was refused outright, rather
   * than merely losing some faces to it -- see {@link fillTerrain}'s own
   * comment on why a replacement can throw where a plain add cannot.
   * `built`/`refused`/`unadopted` are all `0` alongside this: nothing this
   * fill generated was registered, so nothing standing changed.
   */
  readonly rejected?: string;
}

/**
 * The face size terrain is laid at when nobody says otherwise.
 *
 * A repair has no brush params to read -- it is regrowing ground somebody else
 * cut -- so it takes this. Keeping it here rather than in either caller is
 * what stops the sculpted ground and the regrown ground from drifting to
 * different scales.
 */
export const DEFAULT_FACE_SIDE = 2;

/**
 * Hard ceiling on the extra vertices one fill's own refinement may invent.
 *
 * The generator's own standard (50,000) is sized for a whole-map generation,
 * not one stroke. Reproduced against the real engine: two boundary rings
 * meeting at a shallow, near-tangent angle -- the exact shape a halo draws
 * around a neighbour it barely reaches -- made the refinement invent over
 * 23,000 points for a contour of 10, and adopting that many, one failed
 * batch away from one `applyRegionEdit` per node, is what actually stalled
 * the stroke; the points themselves generate fast. A ceiling here trades
 * mesh quality in that one pathological wedge for a stroke that always
 * returns -- `refinementComplete: false` already reports exactly this
 * degradation to the person at the table, so this is not a silent trade.
 * Comfortably above what any ordinary stroke's own boundary asks for.
 */
const MAX_ADDITIONAL_VERTICES = 1000;

/** Nothing to do, reported as an outcome rather than as a failure. */
const NOTHING: TerrainFillOutcome = { built: 0, refused: 0, unadopted: 0, refinementComplete: true };

/** Summed winding of a ring set at one point -- the ground rule's own test. */
function windingOf(rings: readonly ConstraintRing[], x: number, z: number): number {
  let winding = 0;
  for (const ring of rings) {
    for (let index = 0; index < ring.points.length; index += 1) {
      const from = ring.points[index]!;
      const to = ring.points[(index + 1) % ring.points.length]!;
      if (from.z <= z) {
        if (to.z > z && (to.x - from.x) * (z - from.z) - (x - from.x) * (to.z - from.z) > 0) winding += 1;
      } else if (to.z <= z && (to.x - from.x) * (z - from.z) - (x - from.x) * (to.z - from.z) < 0) {
        winding -= 1;
      }
    }
  }
  return winding;
}

function nodeId(mint: string, vertex: number): ConstructionNodeId {
  return `${mint}:v${vertex}`;
}

type FreeEdgeUse = ConstructionOrientedEdgeUse & {
  readonly startNodeId: ConstructionNodeId;
  readonly endNodeId: ConstructionNodeId;
};

/**
 * Turns the generated grid into a patch whose neighbours share their boundary
 * edges.
 *
 * The edge between two nodes is named after the *pair*, in a fixed order, so
 * both faces that meet on it derive the same name and end up referencing one
 * edge used twice. Letting each face mint its own produces two coincident
 * edges used once each: visually identical, structurally unconnected.
 *
 * `refuse-when-full` because a boundary with a face on both sides is interior
 * ground, and terrain is never laid above anything -- a face that finds its
 * edge full is meant to be refused, not rescued with an edge of its own.
 */
function gridPatch(
  tableId: string,
  grid: ConstructionIrregularQuadGrid,
  idFor: (vertex: number) => ConstructionNodeId | undefined,
  nodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[],
  surfaceType: string,
  edgeRooms: ReadonlyMap<string, FreeEdgeUse | null>,
  quadOf?: Map<string, readonly number[]>,
): ConstructionPatch {
  const edges = createBoundaryEdges(tableId, { kind: "refuse-when-full" });
  const regions: ConstructionPatchRegion[] = [];

  quad: for (const quad of grid.quads) {
    const cycle = quad.map(idFor).filter((id): id is ConstructionNodeId => id !== undefined);
    if (cycle.length !== quad.length) continue;
    if (new Set(cycle).size !== cycle.length) continue;

    // A constrained cell can occasionally survive on the occupied side of a
    // retained contour. Its node pair names the real split fragment, but that
    // fragment's free walk runs opposite to this cell's step. Overwriting only
    // `reversed` used to turn `a -> b -> c -> d` into `b -> a, b -> c...`, a
    // loop which cannot close. The cell is already covered by retained ground,
    // so it belongs outside the replacement patch.
    for (let index = 0; index < cycle.length; index += 1) {
      const from = cycle[index]!;
      const to = cycle[(index + 1) % cycle.length]!;
      const edgeId = sharedEdgeId(tableId, from, to);
      if (!edgeRooms.has(edgeId)) continue;
      const free = edgeRooms.get(edgeId);
      if (free === null || free === undefined || free.startNodeId !== from || free.endNodeId !== to) continue quad;
    }

    const boundary: ConstructionOrientedEdgeUse[] = [];
    for (let index = 0; index < cycle.length; index += 1) {
      const from = cycle[index]!;
      const to = cycle[(index + 1) % cycle.length]!;
      const use = edges.use(from, to);
      boundary.push({ ...use, reversed: edgeRooms.get(use.edgeId)?.reversed ?? use.reversed });
    }
    regions.push({ regionId: cycle.join("|"), boundary, surfaceType, physical: true });
    quadOf?.set(cycle.join("|"), quad);
  }

  const patchEdges = edges.all();
  const usedNodes = new Set(patchEdges.flatMap((edge) => [edge.startNodeId, edge.endNodeId]));
  return { nodes: nodes.filter((node) => usedNodes.has(node.id)), edges: patchEdges, regions };
}

/**
 * Generates ground for `boundary` minus `holes`, adopts the nodes it lands on
 * the neighbours' edges, and registers the result.
 *
 * The order is not arbitrary: adoption runs **before** the patch, because a
 * face about to be registered names a node partway along a neighbour's edge,
 * and that node does not exist until the split creates it.
 */
export function fillTerrain(runtime: TerrainFillRuntime, request: TerrainFillRequest): TerrainFillOutcome {
  if (request.boundary.length === 0) return NOTHING;

  const grid = runtime.generateIrregularQuadGrid({
    seed: request.seed,
    faceSide: request.faceSide,
    relaxStrength: request.relaxStrength,
    boundary: request.boundary.map((ring) => ring.points),
    holes: request.holes.map((ring) => ring.points),
    maxAdditionalVertices: MAX_ADDITIONAL_VERTICES,
  });
  if (grid === undefined) {
    logTerrainCommit({
      what: request.what,
      faceSideAsked: request.faceSide,
      boundary: request.boundary,
      holes: request.holes,
      grid: undefined,
      adopted: 0,
      unadopted: 0,
      built: 0,
      refusedFaces: 0,
      refusals: [],
      declaredNodes: 0,
    });
    return NOTHING;
  }
  const clearedBeforePatch = request.replaceSurfaceKeys === undefined ? request.onGenerated?.() : undefined;

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const vertex of grid.vertices) {
    minX = Math.min(minX, vertex.x);
    minZ = Math.min(minZ, vertex.z);
    maxX = Math.max(maxX, vertex.x);
    maxZ = Math.max(maxZ, vertex.z);
  }
  const bounds: FillBounds = { minX, minZ, maxX, maxZ };

  // A corner being adopted onto a neighbour's edge takes the height of that
  // edge rather than the height rule's, so the seam has no vertical kink.
  const live = runtime.getSnapshot().map.nodePositions;
  const { adoptions, snaps } = resolveAdoptions(
    request.holes,
    request.boundary,
    grid.onContour,
    (vertex) => grid.vertices[vertex],
    request.faceSide * SHORTEST_USEFUL_FRACTION,
  );
  // A corner that landed too near an existing node *is* that node. Resolving
  // it here rather than splitting is what keeps sliver edges out of the graph
  // -- and it has to happen before anything is declared, or the fill mints a
  // second node a hundredth of a face from a real one.
  //
  // **One corner per node, and never a node some corner already carries.** Two
  // corners resolving to one id is not a harmless duplicate: it collapses two
  // distinct edges of the mesh into one, so two faces of this same fill end up
  // walking it the same way and the engine refuses the second -- "no room on
  // edge, its one free side faces the other way". The node a snap aims at is a
  // *ring corner*, and a ring corner is itself a constraint point the
  // triangulation keeps as a vertex, so the collision is the common case
  // rather than the rare one. A snap that loses the claim is declared as
  // ordinary new geometry instead, which is what it was before snapping
  // existed.
  const claimed = new Set<ConstructionNodeId>();
  for (const vertex of grid.vertices) {
    const id = vertex.source !== undefined ? request.sources[vertex.source] : undefined;
    if (id !== undefined) claimed.add(id);
  }
  const snapped = new Map<number, ConstructionNodeId>();
  const effectiveAdoptions = [...adoptions];
  for (const snap of snaps) {
    const id = request.sources[snap.source];
    if (id === undefined || claimed.has(id)) {
      if (snap.fallback !== undefined) effectiveAdoptions.push(snap.fallback);
      continue;
    }
    claimed.add(id);
    snapped.set(snap.vertex, id);
  }
  const adoptionPositions = new Map<number, ConstructionPosition>();
  for (const adoption of effectiveAdoptions) {
    const vertex = grid.vertices[adoption.vertex];
    if (vertex === undefined) continue;
    const from = live.get(adoption.edge.startNodeId)?.position;
    const to = live.get(adoption.edge.endNodeId)?.position;
    const y =
      from !== undefined && to !== undefined
        ? from.y + (to.y - from.y) * adoption.along
        : request.heightAt(vertex, bounds);
    adoptionPositions.set(adoption.vertex, { x: vertex.x, y, z: vertex.z });
  }

  const adoption = adoptContourNodes(
    runtime,
    request.tableId,
    request.causeId,
    effectiveAdoptions,
    (vertex) => nodeId(request.mint, vertex),
    (vertex) => adoptionPositions.get(vertex),
  );

  // Which node id every corner resolves to, and which of those this fill still
  // has to declare. A corner that arrived with a source is a node already
  // standing; one just adopted onto a neighbour's edge was created by that
  // split. Declaring either again would be a second node at the same identity.
  const idFor = (vertex: number): ConstructionNodeId | undefined => {
    const source = grid.vertices[vertex]?.source;
    if (source !== undefined) return request.sources[source];
    const snap = snapped.get(vertex);
    if (snap !== undefined) return snap;
    return nodeId(request.mint, vertex);
  };
  const nodes: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[] = [];
  for (let vertex = 0; vertex < grid.vertices.length; vertex += 1) {
    const point = grid.vertices[vertex]!;
    if (point.source !== undefined || snapped.has(vertex) || adoption.adopted.has(vertex)) continue;
    const id = idFor(vertex);
    if (id === undefined) continue;
    // A refused adoption still needs its node, or the face referencing it has
    // no corner. It lands as ordinary new geometry -- one T-junction instead
    // of one missing cell.
    nodes.push({
      id,
      position: adoptionPositions.get(vertex) ?? { x: point.x, y: request.heightAt(point, bounds), z: point.z },
    });
  }

  const quadOf = new Map<string, readonly number[]>();
  // Read after adoption: splitting a contour replaces one edge with fragments,
  // and only live topology knows which side of every fragment remains free.
  // Query only the generated extent instead of serializing the entire map.
  const replaced = new Set((request.replaceSurfaceKeys ?? []).map((key) => key.join("\u0000")));
  const occupied = new Map<string, ConstructionRegionTopology["outerLoops"][number][number][]>();
  const reach = request.faceSide;
  const nearbyTopologies = request.topologySeeds?.length === 0
    ? []
    : runtime.getRegionTopologiesInBounds({
        minX: bounds.minX - reach,
        minZ: bounds.minZ - reach,
        maxX: bounds.maxX + reach,
        maxZ: bounds.maxZ + reach,
        seeds: request.topologySeeds,
      });
  for (const topology of nearbyTopologies) {
    if (replaced.has(topology.surfaceKey.join("\u0000"))) continue;
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const use of loop) {
        const uses = occupied.get(use.edgeId) ?? [];
        uses.push(use);
        occupied.set(use.edgeId, uses);
      }
    }
  }
  const edgeRooms = new Map<string, FreeEdgeUse | null>();
  for (const [edgeId, uses] of occupied) {
    const occupiedUse = uses[0];
    if (uses.length === 1 && occupiedUse !== undefined) {
      edgeRooms.set(edgeId, {
        edgeId,
        reversed: !occupiedUse.reversed,
        startNodeId: occupiedUse.endNodeId,
        endNodeId: occupiedUse.startNodeId,
      });
    } else edgeRooms.set(edgeId, null);
  }
  const patch = gridPatch(request.tableId, grid, idFor, nodes, request.surfaceType, edgeRooms, quadOf);

  // **Does the patch itself already contain the clash?**
  //
  // The engine refuses a face with "no room on edge -- its one free side faces
  // the other way", and that has exactly two possible causes: two faces of
  // *this* patch walking one edge the same way, or an edge that was already
  // standing with a face on it. Those need opposite fixes, and guessing
  // between them has cost this branch a wrong fix already. So the fill asks
  // the question itself, before handing anything over.
  const walkedBy = new Map<string, string>();
  const clashes: string[] = [];
  for (const region of patch.regions) {
    for (const use of region.boundary) {
      const walk = `${use.edgeId}:${use.reversed}`;
      const already = walkedBy.get(walk);
      if (already !== undefined) clashes.push(`${use.edgeId} walked ${use.reversed} by ${already} and ${region.regionId}`);
      else walkedBy.set(walk, region.regionId);
    }
  }

  // **A replacement can refuse the whole patch; a plain add never does.**
  //
  // `addPatch` skips a face that finds no room and reports it -- the graceful
  // path `report()` already reads as "N faces perdidas". `applyPatchReplacement`
  // is transactional (it clones the graph, tries every face, and only
  // publishes if all of them land), so the one case this branch cannot avoid
  // -- quadrangulation occasionally minting two faces of one fill that both
  // want the same edge, a self-collision distinct from and rarer than an
  // ordinary refusal -- comes back not as a skip but as a hard `Err`, which
  // the wasm boundary throws as a JS exception. Nothing upstream of here ever
  // caught that: it reached the tool's own caller as an uncaught exception,
  // which is a crashed table, not a failed stroke. The transaction itself
  // already did its job by never publishing -- every face this fill would
  // have replaced is still exactly where it was. All that is missing is
  // treating that thrown rejection as the same kind of outcome a refusal
  // already is, instead of letting it escape.
  let outcome: ConstructionPatchOutcome;
  try {
    outcome = request.replaceSurfaceKeys === undefined
      ? runtime.addPatch(patch, "local", request.causeId)
      : runtime.applyPatchReplacement(
          {
            operationId: `${request.causeId}:terrain-fill`,
            sourceSurfaceKeys: request.replaceSurfaceKeys,
            patch,
          },
          "local",
          request.causeId,
        );
  } catch (error) {
    logTerrainCommit({
      what: request.what,
      faceSideAsked: request.faceSide,
      boundary: request.boundary,
      holes: request.holes,
      grid,
      adopted: adoption.adopted.size,
      unadopted: adoption.refused.length,
      built: 0,
      refusedFaces: 0,
      refusals: [String(error instanceof Error ? error.message : error)],
      declaredNodes: nodes.length,
      regenerated: request.regenerated,
      selfClashes: clashes,
    });
    return {
      built: 0,
      refused: 0,
      unadopted: 0,
      refinementComplete: grid.refinementComplete,
      rejected: error instanceof Error ? error.message : String(error),
    };
  }
  const cleared = request.replaceSurfaceKeys === undefined
    ? clearedBeforePatch
    : { deleted: outcome.removedSurfaceKeys.length, failed: [] };

  // **Which of the two remaining causes is it?**
  //
  // A refused face was either laid where ground already stood -- the ground
  // rule failed, and its centroid sits inside a hole ring -- or it is wound
  // against its neighbours, in which case it walks a shared edge the same way
  // the standing face does while sitting correctly beside it. The two are
  // mutually exclusive and need opposite fixes, and this branch has already
  // shipped one wrong fix from guessing between them.
  //
  // Note the winding count only means something next to the built faces': a
  // patch of uniform winding that clashes anyway is the first case, and a
  // split reading is the second. Faces wound against the grain would not show
  // up as self-clashes if they only ever touch standing ground, which is
  // exactly where every refusal in the log lands.
  let refusedInHole = 0;
  let refusedClockwise = 0;
  let builtClockwise = 0;
  const refused = new Set(outcome.skippedRegionIds);
  for (const [regionId, quad] of quadOf) {
    let twice = 0;
    let cx = 0;
    let cz = 0;
    let ok = true;
    for (let index = 0; index < quad.length; index += 1) {
      const from = grid.vertices[quad[index]!];
      const to = grid.vertices[quad[(index + 1) % quad.length]!];
      if (from === undefined || to === undefined) { ok = false; break; }
      twice += from.x * to.z - to.x * from.z;
      cx += from.x;
      cz += from.z;
    }
    if (!ok || quad.length === 0) continue;
    if (!refused.has(regionId)) { if (twice < 0) builtClockwise += 1; continue; }
    if (twice < 0) refusedClockwise += 1;
    if (windingOf(request.holes, cx / quad.length, cz / quad.length) !== 0) refusedInHole += 1;
  }
  logTerrainCommit({
    what: request.what,
    faceSideAsked: request.faceSide,
    boundary: request.boundary,
    holes: request.holes,
    grid,
    adopted: adoption.adopted.size,
    unadopted: adoption.refused.length,
    built: outcome.createdSurfaceKeys.length,
    refusedFaces: outcome.skippedRegionIds.length,
    refusals: outcome.skippedRegionReasons,
    declaredNodes: nodes.length,
    regenerated: request.regenerated,
    selfClashes: clashes,
    regeneratedCleared: cleared?.deleted,
    regenerateFailures: cleared?.failed,
    refusedInHole,
    refusedClockwise,
    builtClockwise,
  });
  return {
    built: outcome.createdSurfaceKeys.length,
    refused: outcome.skippedRegionIds.length,
    unadopted: adoption.refused.length,
    refinementComplete: grid.refinementComplete,
  };
}
