// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import type {
  ApplyPatchReplacementRequest,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionSurfaceKey,
} from "@/ports";
import {
  resolveCoverage,
  resolveCutRepair,
  repairOrganicCut,
  type CutFallout,
  type OrganicCutRepairRuntime,
} from "../../../features/edit-construction/index.ts";

import type { TabletopRuntime } from "../tabletop-runtime.ts";
import { reportToolFailure } from "./core/tool-diagnostics.ts";

/**
 * One covered type's own answer to being cut -- `resolveCutRepair`'s
 * `"regenerate"`, made real. The type itself owns the whole thing, decision
 * and execution both (`repairOrganicCut`, `structure-types/organic/organic-cut-repair.ts`);
 * this only needs to know it by a runtime-shaped signature, never a
 * concrete `TabletopRuntime` import, so this table stays as thin as the
 * types it points at.
 */
export type CutRepairExecutor = (runtime: OrganicCutRepairRuntime, fallout: CutFallout, causeId: string) => number;

/**
 * Every structure type that has actually implemented `resolveCutRepair`'s
 * `"regenerate"` answer, keyed by `surfaceType`.
 *
 * `dispatchCutRepairs` is this table's only reader: it already knows, from
 * `resolveCutRepair` itself, which consumed region's type is entitled to a
 * repair -- this is only where it finds *whose* code to call for one. A
 * type absent here despite `resolveCutRepair` answering `"regenerate"` for
 * it is a declaration nobody has built yet, not a contradiction; a missing
 * entry is treated as nothing to do.
 */
export const CUT_REPAIR_EXECUTORS: Readonly<Record<string, CutRepairExecutor>> = Object.freeze({
  terrain: repairOrganicCut,
  "terrain-grass": repairOrganicCut,
});

/**
 * Resolves what `request`'s own footprint cuts into, and dispatches each
 * covered type's own repair -- called once `TabletopRuntime.applyPatchReplacement`
 * has already landed `request`, so a painted node a repair wants to weld
 * onto is real and live by the time this runs.
 *
 * Neither side is named here: coverage is resolved fresh from
 * `request.footprintOutline` and `resolveCutRepair` decides who is
 * entitled, the same table any other caller of `resolveCoverage` reads.
 * This is the runtime's own choke point for `CUT`'s repair half, so any
 * caller of `applyPatchReplacement` gets it, not only whichever tool
 * happens to import a repair function by name.
 *
 * Deliberately does not read `request.sourceSurfaceKeys` at all: that list
 * is `request.patch`'s own painter consuming its own kind (a road absorbing
 * an adjoining road), never another type's regions. A covered type this
 * cuts into deletes those itself, inside its own executor -- this only
 * tells it which ones and hands it real nodes to weld onto, never deletes
 * on its behalf.
 *
 * A repair that throws is reported, never rethrown: by the time this runs,
 * `request` itself already landed -- the painter's own stroke succeeded.
 * A covered type's best-effort repair failing is that repair's own problem,
 * not a reason to tell the person at the table their stroke did not land
 * when it did. One covered type's failure does not stop another's repair
 * either, for the same reason.
 */
export function dispatchCutRepairs(runtime: TabletopRuntime, request: ApplyPatchReplacementRequest, causeId: string): void {
  const outline = request.footprintOutline;
  if (outline === undefined || outline.length === 0) return;
  const paintedType = request.patch.regions[0]?.surfaceType;
  if (paintedType === undefined) return;

  const coverage = runtime.getFootprintCoverage(outline);

  // Both `"centroid"` and `"overlap"` are consumed for a `"cut"` -- not
  // `"centroid"` alone. A cell the road only clips (its own centroid still
  // outside the footprint) used to survive untouched, whole, sitting under
  // or beside the road's real rendered edge: real terrain, in real 3D
  // space, occupying ground the road now also occupies -- the "faces still
  // under the road" a cut is supposed to prevent in the first place. This
  // repair's own regeneration already treats "what got consumed" as one
  // hole to fill around, regardless of how ragged its original boundary
  // was; consuming the clipped cells too just hands it the *whole* true
  // hole instead of only the fully-covered middle of it, which is also why
  // a margin that used to be a handful of quads now regenerates as the many
  // more it always should have been.
  const consumedByType = new Map<string, ConstructionSurfaceKey[]>();
  for (const entry of resolveCoverage(paintedType, coverage)) {
    if (entry.interaction.kind !== "cut") continue;
    if (resolveCutRepair(entry.covered.surfaceType).kind !== "regenerate") continue;
    const keys = consumedByType.get(entry.covered.surfaceType) ?? [];
    keys.push(entry.covered.surfaceKey);
    consumedByType.set(entry.covered.surfaceType, keys);
  }
  if (consumedByType.size === 0) return;

  // Every node belonging to the painter's *own* type wherever this
  // footprint reaches -- not `request.patch.nodes`, which is only what
  // *this one submission* happened to (re)declare. A continuous brush
  // stroke resubmits only its latest increment each tick (a handful of
  // nodes), while `outline` -- the same footprint `getFootprintCoverage`
  // above already resolved -- reaches the stroke's whole accumulated area;
  // most of an established path's own boundary near a hole was welded in
  // from an earlier tick and never named again. `getFootprintCoverage`
  // already reports every region of *any* type the footprint touches, with
  // its own node ids, for free -- filtered here to the painter's own type
  // instead of thrown away, which is what starved a repair's own weld
  // candidates down to only the newest few nodes.
  const nodePositions = runtime.getSnapshot().map.nodePositions;
  const paintedNodeIds = new Set<ConstructionNodeId>();
  for (const entry of coverage) {
    if (entry.surfaceType !== paintedType) continue;
    for (const nodeId of entry.nodeIds) paintedNodeIds.add(nodeId);
  }
  const paintedNodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[] = [...paintedNodeIds]
    .map((id) => {
      const position = nodePositions.get(id)?.position;
      return position === undefined ? undefined : { id, position };
    })
    .filter((node): node is { readonly id: ConstructionNodeId; readonly position: ConstructionPosition } => node !== undefined);

  // The area those nodes actually enclose -- one closed ring per painter-type
  // face, in that face's own boundary order, read straight from its live
  // topology. Deliberately whole loops rather than the loose edge set the
  // repair used to walk into rings itself: neighbouring band regions share
  // interior edges, so that graph is no simple cycle and a walk over it
  // returns an arbitrary path (a different one per run, following whatever
  // order the regions were visited in). Subtracting an arbitrary path is what
  // left terrain standing on the road, and left it there only sometimes.
  // See `CutFallout.paintedLoops`.
  const paintedLoops: ConstructionPosition[][] = [];
  const seenRegionKeys = new Set<string>();
  for (const entry of coverage) {
    if (entry.surfaceType !== paintedType) continue;
    const regionKey = entry.surfaceKey.join("|");
    if (seenRegionKeys.has(regionKey)) continue;
    seenRegionKeys.add(regionKey);
    const topology = runtime.getRegionTopology(entry.surfaceKey);
    if (topology === undefined) continue;
    for (const loop of topology.outerLoops) {
      const ring = loop
        .map((edge) => nodePositions.get(edge.startNodeId)?.position)
        .filter((position): position is ConstructionPosition => position !== undefined);
      if (ring.length >= 3) paintedLoops.push(ring);
    }
  }

  for (const [surfaceType, consumedSurfaceKeys] of consumedByType) {
    const executor = CUT_REPAIR_EXECUTORS[surfaceType];
    if (executor === undefined) continue;
    try {
      executor(runtime, { paintedNodes, paintedLoops, consumedSurfaceKeys }, causeId);
    } catch (error) {
      reportToolFailure("cut-repair", `repair ${surfaceType} after a cut`, { causeId, consumedSurfaceKeys }, error);
    }
  }
}
