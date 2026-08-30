// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import type { ConstructionNodeId } from "@/ports";
import { planOrganicCutRepair, type AtomicEditOp, type CutFallout, type SurvivingFace } from "../../../../features/edit-construction/index.ts";

import type { TabletopRuntime } from "../../tabletop-runtime.ts";

/**
 * Terrain's own composition-layer half of `resolveCutRepair`'s
 * `"regenerate"` answer -- fetches what `planOrganicCutRepair`
 * (`structure-types/organic/organic-cut-repair.ts`) needs from the live
 * runtime, and performs the plan it decides. The decision itself -- which
 * rim node welds onto which painted node, which surviving face has to be
 * rebuilt, what the replacement patch looks like -- is not this file's:
 * it lives entirely in the organic type's own module, as a pure function.
 * This is plumbing, not policy.
 *
 * `TabletopRuntime.applyPatchReplacement` is this function's only caller,
 * dispatching to it generically (via `cut-repair-dispatch.ts`) once it
 * resolves that a stroke's own footprint cut into terrain. Nothing upstream
 * of that knows this function exists or how terrain repairs itself.
 */
export function repairTerrainCut(runtime: TabletopRuntime, fallout: CutFallout, causeId: string): number {
  if (fallout.consumedSurfaceKeys.length === 0) return 0;

  // Read every consumed face's own topology before deleting it -- once
  // gone, there is nothing left to ask.
  const preScope = new Set<ConstructionNodeId>();
  for (const surfaceKey of fallout.consumedSurfaceKeys) {
    const topology = runtime.getRegionTopology(surfaceKey);
    if (topology === undefined) continue;
    for (const node of topology.nodes) preScope.add(node.id);
  }
  if (preScope.size === 0) return 0;

  // Terrain deletes its own consumed faces -- its own agency, not the
  // painter's; the painter's own sourceSurfaceKeys never named them.
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
  runtime.addPatch(plan.patch, "local", causeId);
  return plan.patch.regions.length;
}
