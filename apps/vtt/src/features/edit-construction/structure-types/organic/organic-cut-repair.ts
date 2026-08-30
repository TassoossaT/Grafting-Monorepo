import type {
  ConstructionNodeId,
  ConstructionPatch,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
  ConstructionUnfilledLoop,
} from "@/ports";

import type { AtomicEditOp } from "../../orchestration/atomic-edit.ts";
import { createBoundaryEdges } from "../../topology/boundary-edges.ts";
import type { CutFallout } from "../structure-type.ts";

/**
 * How close (world units, XZ) an exposed terrain rim node must land to one
 * of the painter's own nodes to be welded onto it, rather than left as its
 * own node at its own unrelated position.
 *
 * Terrain's lattice and a road's own contour are two independently
 * generated meshes that were never built to align -- the road's stations
 * sit wherever its own curve-flattening put them, terrain's rim wherever
 * its own relax settled. This is a first-pass heuristic, roughly one
 * terrain cell wide, wide enough to catch a genuine correspondence across
 * that mismatch without reaching across an unrelated gap and welding onto
 * the wrong side of a curve.
 */
const WELD_SEARCH_RADIUS = 2;

interface PaintedNode {
  readonly id: ConstructionNodeId;
  readonly position: ConstructionPosition;
}

/** One region a candidate for this repair to touch -- already resolved to a plain corner cycle, no engine calls left to make. */
export interface SurvivingFace {
  readonly surfaceKey: ConstructionSurfaceKey;
  readonly surfaceType: string;
  readonly physical: boolean;
  readonly cycle: readonly ConstructionNodeId[];
}

export interface OrganicCutRepairInput {
  readonly tableId: string;
  /** Every node the cut's deletion exposed -- `ConstructionSessionPort.getUnfilledLoops`'s own report, already fetched. */
  readonly rimNodeIds: readonly ConstructionNodeId[];
  /** Every node currently on the table, by id -- enough to resolve both a rim node's own position and an unmapped corner's. */
  readonly nodePositions: ReadonlyMap<ConstructionNodeId, ConstructionPosition>;
  /** The painter's own real registered nodes -- see `CutFallout`. */
  readonly paintedNodes: readonly PaintedNode[];
  /** Every candidate face that might reference a rim node -- already fetched, already filtered to a single outer loop and no holes. */
  readonly survivingFaces: readonly SurvivingFace[];
}

export interface OrganicCutRepairPlan {
  /** Exactly the surviving faces this repair rebuilds -- delete these first, then register `patch`. */
  readonly affectedSurfaceKeys: readonly ConstructionSurfaceKey[];
  readonly patch: ConstructionPatch;
}

/** The painter's own node nearest `position`, or `undefined` if none land within {@link WELD_SEARCH_RADIUS}. */
function nearestPaintedNode(position: ConstructionPosition, paintedNodes: readonly PaintedNode[]): PaintedNode | undefined {
  let best: PaintedNode | undefined;
  let bestDistanceSq = WELD_SEARCH_RADIUS * WELD_SEARCH_RADIUS;
  for (const node of paintedNodes) {
    const dx = node.position.x - position.x;
    const dz = node.position.z - position.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = node;
    }
  }
  return best;
}

/**
 * Organic's own repair *decision* for `resolveCutRepair`'s `"regenerate"`
 * answer -- no runtime, no engine call, only what to delete and what patch
 * to register in its place. Kept as its own pure step within
 * {@link repairOrganicCut} (not a separate file) because the weld-matching
 * and cycle-rebuild math is worth being able to call, and test, with plain
 * data alone.
 *
 * **The whole point: a weld is a shared node id, not a shared position.**
 * `ConstructionSessionPort.addPatch`'s own node handling skips minting a
 * node whose id already exists and reuses the live one instead
 * (`region_editing.rs`, `apply_add_patch`) -- so a face that declares one of
 * the painter's own node ids as one of its own corners becomes the *same*
 * node the painter's face uses, sharing a real edge with it. Moving an
 * existing terrain node to a nearby position instead -- which an earlier
 * version of this repair did -- never achieves that: two nodes at the same
 * spot are still two nodes, "coincident, never connected" the way
 * `ConstructionPatch` itself already warns two independently generated
 * faces can end up.
 *
 * **What this decides, in order:**
 * 1. Match each rim node to the nearest painted node close enough to call
 *    the same seam ({@link WELD_SEARCH_RADIUS}), building a node-id remap.
 *    A rim node with nothing close enough is left out -- no repair is
 *    decided for that one corner, rather than welding onto a match too far
 *    away to mean anything.
 * 2. Every surviving face that names a remapped rim node in one of its own
 *    corners has to be rebuilt to name the welded id instead -- a face is a
 *    fixed cycle of ids, and nothing short of rebuilding it changes which
 *    ids it names. A face whose remap would collapse two of its own
 *    corners onto one id (two rim nodes landing on the same painted node)
 *    is left alone rather than decided degenerate.
 * 3. The replacement patch reuses whichever ids -- painted or terrain's own
 *    -- were already live, minting nothing but the boundary edges the new
 *    seam itself needs.
 *
 * Returns `undefined` when nothing welded and nothing needs rebuilding.
 */
export function planOrganicCutRepair(input: OrganicCutRepairInput): OrganicCutRepairPlan | undefined {
  const remap = new Map<ConstructionNodeId, ConstructionNodeId>();
  const weldedPositions = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const rimNodeId of input.rimNodeIds) {
    const position = input.nodePositions.get(rimNodeId);
    if (position === undefined) continue;
    const nearest = nearestPaintedNode(position, input.paintedNodes);
    if (nearest === undefined) continue;
    remap.set(rimNodeId, nearest.id);
    weldedPositions.set(nearest.id, nearest.position);
  }
  if (remap.size === 0) return undefined;

  const affected = input.survivingFaces
    .filter((face) => face.cycle.some((id) => remap.has(id)))
    .map((face) => ({ ...face, cycle: face.cycle.map((id) => remap.get(id) ?? id) }))
    .filter((face) => new Set(face.cycle).size === face.cycle.length);
  if (affected.length === 0) return undefined;

  const edges = createBoundaryEdges(input.tableId, { kind: "refuse-when-full" });
  const nodes = new Map<ConstructionNodeId, ConstructionPosition>();
  const positionOf = (id: ConstructionNodeId): ConstructionPosition | undefined =>
    weldedPositions.get(id) ?? input.nodePositions.get(id);

  const regions: ConstructionPatchRegion[] = affected.map((face) => {
    const boundary = face.cycle.map((id, index) => edges.use(id, face.cycle[(index + 1) % face.cycle.length]!));
    for (const id of face.cycle) {
      const position = positionOf(id);
      if (position !== undefined) nodes.set(id, position);
    }
    return { regionId: face.cycle.join("|"), boundary, surfaceType: face.surfaceType, physical: face.physical };
  });

  return {
    affectedSurfaceKeys: affected.map((face) => face.surfaceKey),
    patch: { nodes: [...nodes].map(([id, position]) => ({ id, position })), edges: edges.all(), regions },
  };
}

/**
 * The minimal runtime capability {@link repairOrganicCut} needs, declared
 * here rather than imported from `composition/tabletop/tabletop-runtime.ts`
 * -- this module depends on composition for nothing at all. `TabletopRuntime`
 * satisfies this structurally, with room to spare; nothing here names it,
 * so a future runtime with the same handful of methods works exactly as
 * well without this file changing at all.
 */
export interface OrganicCutRepairRuntime {
  getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined;
  getAllRegionTopologies(): readonly ConstructionRegionTopology[];
  getUnfilledLoops(scope: readonly ConstructionNodeId[]): readonly ConstructionUnfilledLoop[];
  getSnapshot(): {
    readonly tableId: string;
    readonly map: { readonly nodePositions: ReadonlyMap<ConstructionNodeId, { readonly position: ConstructionPosition }> };
  };
  applyRegionEdit(ops: readonly AtomicEditOp[], origin: "local", causeId: string): unknown;
  addPatch(patch: ConstructionPatch, origin: "local", causeId: string): { readonly skippedRegionIds: readonly string[] };
}

/**
 * Terrain's own complete answer to `resolveCutRepair`'s `"regenerate"`:
 * fetches what it needs from the live table, decides its own repair
 * ({@link planOrganicCutRepair}), and performs it -- entirely inside the
 * organic type's own module, not a "decides" half here and an "acts" half
 * in `composition/`. The type manages this because it is the type's own
 * operation, the same way `terrain-restack.ts`'s `restackTerrain` is
 * terrain's own operation when terrain paints over terrain.
 *
 * Called from `composition/tabletop/tools/cut-repair-dispatch.ts`, the
 * runtime's own choke point for `CUT`'s repair half (`TabletopRuntime.applyPatchReplacement`)
 * -- that caller supplies the live runtime and the `CutFallout` a stroke's
 * own footprint resolved, and knows nothing past that about how terrain
 * repairs itself.
 *
 * **The steps:**
 * 1. Read every consumed face's own topology before deleting it -- once
 *    gone, there is nothing left to ask.
 * 2. Delete the consumed faces. Terrain's own call, not the painter's.
 * 3. `getUnfilledLoops`, scoped to what those faces stood on, reports
 *    exactly the rim the deletion exposed.
 * 4. Every existing region with a single outer loop and no holes is a
 *    candidate the plan might need to rebuild -- resolved to a plain id
 *    cycle here, so `planOrganicCutRepair` never has to call the engine.
 * 5. `planOrganicCutRepair` decides the weld and the rebuild.
 * 6. Delete every affected survivor, then register the replacement patch.
 */
export function repairOrganicCut(runtime: OrganicCutRepairRuntime, fallout: CutFallout, causeId: string): number {
  if (fallout.consumedSurfaceKeys.length === 0) return 0;

  const preScope = new Set<ConstructionNodeId>();
  for (const surfaceKey of fallout.consumedSurfaceKeys) {
    const topology = runtime.getRegionTopology(surfaceKey);
    if (topology === undefined) continue;
    for (const node of topology.nodes) preScope.add(node.id);
  }
  if (preScope.size === 0) return 0;

  runtime.applyRegionEdit(
    fallout.consumedSurfaceKeys.map((surfaceKey): AtomicEditOp => ({ kind: "delete-region", surfaceKey })),
    "local",
    causeId,
  );

  const loops = runtime.getUnfilledLoops([...preScope]);
  if (loops.length === 0) return 0;
  const rimNodeIds = [...new Set(loops.flatMap((loop) => loop.nodeIds))];
  if (rimNodeIds.length === 0) return 0;

  const survivingFaces: SurvivingFace[] = runtime
    .getAllRegionTopologies()
    .filter((topology) => topology.outerLoops.length === 1 && topology.holes.length === 0)
    .map((topology) => ({
      surfaceKey: topology.surfaceKey,
      surfaceType: topology.surfaceType,
      physical: topology.physical,
      cycle: topology.outerLoops[0]!.map((edge) => edge.startNodeId),
    }));

  const snapshot = runtime.getSnapshot();
  const plan = planOrganicCutRepair({
    tableId: snapshot.tableId,
    rimNodeIds,
    nodePositions: new Map([...snapshot.map.nodePositions].map(([id, entry]) => [id, entry.position])),
    paintedNodes: fallout.paintedNodes,
    survivingFaces,
  });
  if (plan === undefined) return 0;

  runtime.applyRegionEdit(
    plan.affectedSurfaceKeys.map((surfaceKey): AtomicEditOp => ({ kind: "delete-region", surfaceKey })),
    "local",
    causeId,
  );
  // The affected survivors are already deleted by this point -- a region
  // the engine refuses here (an edge with no room left, `boundary_has_room`)
  // is a real hole this repair just caused, not a no-op to shrug off.
  // Surfacing it as a thrown error is deliberate: `dispatchCutRepairs`
  // reports and swallows it rather than failing the whole stroke, but a
  // silently accepted partial rebuild would hide exactly the failure this
  // repair exists to prevent.
  //
  // The try/catch below is diagnostic, not corrective: an engine-side throw
  // here (not just a silent skip) means Rust itself rejected the submitted
  // patch, and the raw error names only the one regionId, not why. Every
  // rebuilt region's own cycle is dumped alongside it so a real occurrence
  // is diagnosable from the console alone, without a live debugger.
  let outcome: { readonly skippedRegionIds: readonly string[] };
  try {
    outcome = runtime.addPatch(plan.patch, "local", causeId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `terrain cut repair's own addPatch rejected the whole batch -- ${message}. Submitted regions: ${JSON.stringify(
        plan.patch.regions.map((region) => ({ regionId: region.regionId, edges: region.boundary.length })),
      )}`,
      { cause: error },
    );
  }
  if (outcome.skippedRegionIds.length > 0) {
    throw new Error(
      `terrain cut repair left ${outcome.skippedRegionIds.length} of ${plan.patch.regions.length} rebuilt face(s) unregistered: ${outcome.skippedRegionIds.join(", ")}`,
    );
  }
  return plan.patch.regions.length;
}
