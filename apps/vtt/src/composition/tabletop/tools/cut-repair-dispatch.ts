// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import type {
  ApplyPatchReplacementRequest,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionEdge,
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
 * The painter's own ground, as the repair needs it: its real nodes to weld
 * onto, and one closed ring per face it owns so the area it occupies can be
 * taken out of the hole.
 *
 * Read from **every live face of the painter's type**, not from the stroke's
 * own footprint coverage. `getFootprintCoverage` answers "what does this
 * outline touch", which is a different question: a brush resubmits only its
 * latest increment each tick, and coverage of that increment named as little
 * as one face and four nodes of a road that really had dozens. The area
 * subtracted from the hole was then a fraction of the road, so the fill was
 * computed over ground the road genuinely occupies -- and the engine refused
 * the whole face for trying to take a side of an edge the road already
 * holds, which is the "cut happens but nothing regenerates" the table saw. A
 * face of the same type nowhere near the hole costs nothing here: it cannot
 * intersect what the cut removed, so it cannot change the difference.
 *
 * Loops are whole face boundaries in the engine's own order, never a walk
 * over the painter's loose edge set -- neighbouring band regions share
 * interior edges, so that graph is no simple cycle and a walk returns an
 * arbitrary path, a different one per run. See `CutFallout.paintedLoops`.
 *
 * Exported for its own test: every cut-repair failure so far has come from
 * what this function hands over, never from the repair's own arithmetic.
 */
export function paintedNodesOf(
  runtime: Pick<TabletopRuntime, "getAllRegionTopologies" | "getSnapshot">,
  paintedType: string,
): Pick<CutFallout, "paintedNodes" | "paintedLoops"> {
  const nodesById = new Map<ConstructionNodeId, ConstructionPosition>();
  const paintedLoops: (readonly ConstructionRegionEdge[])[] = [];
  for (const topology of runtime.getAllRegionTopologies()) {
    if (topology.surfaceType !== paintedType) continue;
    for (const node of topology.nodes) nodesById.set(node.id, node.position);
    // Outer loops only: a hole the painter itself declared is the painter's
    // own opening, and a repair has no business filling it in.
    for (const loop of topology.outerLoops) if (loop.length >= 3) paintedLoops.push(loop);
  }
  return {
    paintedNodes: [...nodesById].map(([id, position]) => ({ id, position })),
    paintedLoops,
  };
}

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
  const { paintedNodes, paintedLoops } = paintedNodesOf(runtime, paintedType);

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
