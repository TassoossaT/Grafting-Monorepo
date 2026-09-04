import type {
  ConstructionIrregularQuadGrid,
  ConstructionIrregularQuadGridRequest,
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPatch,
  ConstructionPatchOutcome,
  ConstructionPatchRegion,
  ConstructionPosition,
} from "@/ports";

import type { AtomicEditOp } from "@/features/edit-construction";

import { adoptContourNodes, resolveAdoptions, type ConstraintRing } from "./terrain-constraints.ts";
import { createBoundaryEdges } from "../core/boundary-edges.ts";

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
  readonly onGenerated?: () => void;
}

export interface TerrainFillOutcome {
  readonly built: number;
  /** Faces the engine refused: ground that already has a face on both sides. */
  readonly refused: number;
  /** Nodes that wanted a neighbour's edge split and did not get it -- one T-junction each. */
  readonly unadopted: number;
  /** `false` when refinement hit its vertex ceiling and part of the area came back coarser. */
  readonly refinementComplete: boolean;
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

/** Nothing to do, reported as an outcome rather than as a failure. */
const NOTHING: TerrainFillOutcome = { built: 0, refused: 0, unadopted: 0, refinementComplete: true };

function nodeId(mint: string, vertex: number): ConstructionNodeId {
  return `${mint}:v${vertex}`;
}

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
): ConstructionPatch {
  const edges = createBoundaryEdges(tableId, { kind: "refuse-when-full" });
  const regions: ConstructionPatchRegion[] = [];

  for (const quad of grid.quads) {
    const cycle = quad.map(idFor).filter((id): id is ConstructionNodeId => id !== undefined);
    if (cycle.length !== quad.length) continue;
    // A cell whose corners resolved to the same node twice carries no ground.
    // With nothing welding by proximity any more this should not happen at
    // all; it is cheaper to skip than to have the engine reject the batch.
    if (new Set(cycle).size !== cycle.length) continue;

    const boundary: ConstructionOrientedEdgeUse[] = [];
    for (let index = 0; index < cycle.length; index += 1) {
      boundary.push(edges.use(cycle[index]!, cycle[(index + 1) % cycle.length]!));
    }
    regions.push({ regionId: cycle.join("|"), boundary, surfaceType, physical: true });
  }

  return { nodes, edges: edges.all(), regions };
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
  });
  if (grid === undefined) return NOTHING;
  request.onGenerated?.();

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
  const adoptions = resolveAdoptions(request.holes, request.boundary, grid.onContour, (vertex) => grid.vertices[vertex]);
  const adoptionPositions = new Map<number, ConstructionPosition>();
  for (const adoption of adoptions) {
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
    adoptions,
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
    return nodeId(request.mint, vertex);
  };
  const nodes: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[] = [];
  for (let vertex = 0; vertex < grid.vertices.length; vertex += 1) {
    const point = grid.vertices[vertex]!;
    if (point.source !== undefined || adoption.adopted.has(vertex)) continue;
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

  const outcome = runtime.addPatch(
    gridPatch(request.tableId, grid, idFor, nodes, request.surfaceType),
    "local",
    request.causeId,
  );
  return {
    built: outcome.createdSurfaceKeys.length,
    refused: outcome.skippedRegionIds.length,
    unadopted: adoption.refused.length,
    refinementComplete: grid.refinementComplete,
  };
}
