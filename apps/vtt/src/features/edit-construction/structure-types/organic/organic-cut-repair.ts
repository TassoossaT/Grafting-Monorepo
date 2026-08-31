import type { ConstructionNodeId, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import type { AtomicEditOp } from "../../orchestration/atomic-edit.ts";
import { fillUnfilledLoops, type UnfilledLoopFillRuntime } from "../../topology/fill-unfilled-loops.ts";
import type { CutFallout } from "../structure-type.ts";

/**
 * The minimal runtime capability {@link repairOrganicCut} needs, declared
 * here rather than imported from `composition/tabletop/tabletop-runtime.ts`
 * -- this module depends on composition for nothing at all. `TabletopRuntime`
 * satisfies this structurally, with room to spare.
 */
export interface OrganicCutRepairRuntime extends UnfilledLoopFillRuntime {
  getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined;
  applyRegionEdit(ops: readonly AtomicEditOp[], origin: "local", causeId: string): unknown;
}

/**
 * Terrain's own complete answer to `resolveCutRepair`'s `"regenerate"`.
 *
 * **What this is, in one line:** delete what the cut consumed, then close the
 * hole that leaves with the rim the engine reports -- the same call the
 * terrain tool already mends its own gaps with (`fillUnfilledLoops`), on the
 * same graph, with nothing of this module's own in between.
 *
 * **Why it generates nothing.** Every earlier version of this repair produced
 * geometry and then tried to reconcile it with the ground already there: a
 * lattice welded by proximity, then a polygon difference triangulated into a
 * mesh. Both computed the shape of the hole independently of the graph and
 * then had to make the result agree with it. They failed differently and for
 * one underlying reason -- vertices minted on top of nodes that already
 * existed (a fill that floats), a seam declaring one edge where the
 * neighbour has three (a gap along the path, because sharing a *vertex* is
 * not sharing an *edge*), a face wound against the one free side its
 * neighbour left (refused outright, all of it at once).
 *
 * None of those are handled here. They are absent, because a face registered
 * over a reported rim adds no node and no edge: every corner is a node
 * already standing there, every edge is the neighbour's own, and the
 * direction is reported rather than chosen from a convention this side would
 * have to guess. That is also what puts the regenerated ground in the same
 * cloud as both the rim it came from and the painter that cut it -- not by
 * welding onto them, but by never having been separate.
 *
 * **The steps:**
 * 1. Read the consumed regions' own nodes -- knowable only while those
 *    regions still stand, and half of the scope in step 3.
 * 2. Delete the consumed regions. The covered type's own call, never the
 *    painter's.
 * 3. Fill what that leaves open, scoped to those nodes *together with the
 *    painter's*. Both halves are needed: the engine considers an edge only
 *    when both of its nodes are named, and the hole a cut leaves is bounded
 *    by the surviving rim on one side and the painter's own contour on the
 *    other. Naming one side alone finds no closed loop at all -- a cut that
 *    visibly happens and never regenerates.
 */
export function repairOrganicCut(runtime: OrganicCutRepairRuntime, fallout: CutFallout, causeId: string): number {
  if (fallout.consumedSurfaceKeys.length === 0) return 0;

  const consumedTopologies = fallout.consumedSurfaceKeys
    .map((surfaceKey) => runtime.getRegionTopology(surfaceKey))
    .filter((topology): topology is ConstructionRegionTopology => topology !== undefined);
  if (consumedTopologies.length === 0) return 0;
  const surfaceType = consumedTopologies[0]!.surfaceType;

  const scope = new Set<ConstructionNodeId>();
  for (const topology of consumedTopologies) {
    for (const node of topology.nodes) scope.add(node.id);
  }
  if (scope.size === 0) return 0;
  for (const node of fallout.paintedNodes) scope.add(node.id);

  // One region at a time: a key the engine no longer knows -- a face some
  // other repair in the same stroke already took -- is that key's own
  // problem, never a reason to leave the rest of the cut standing under the
  // painter.
  const failedDeletes: ConstructionSurfaceKey[] = [];
  for (const surfaceKey of fallout.consumedSurfaceKeys) {
    try {
      runtime.applyRegionEdit([{ kind: "delete-region", surfaceKey }], "local", causeId);
    } catch {
      failedDeletes.push(surfaceKey);
    }
  }
  if (failedDeletes.length === fallout.consumedSurfaceKeys.length) return 0;

  // `islands`, because a cut can leave the painter standing in the middle of
  // the ground it removed: the engine reports the hole's outer rim and never
  // the road inside it, so mending the rim alone joins the two banks straight
  // over the top of the road. `mesh`, because the gap a cut leaves is not the
  // gap a stroke leaves. A
  // stroke's own gap is one cell wide and one face covers it exactly; a cut's
  // spans everything the painter crossed, and one face over that is a single
  // enormous sheet where there should be terrain. Same mend, cut finer.
  //
  // The consumed type is a fallback, not the answer: each gap is made of
  // whatever the faces around it are made of, so a cut through slate comes
  // back slate without this side having to know that.
  return fillUnfilledLoops(runtime, [...scope], surfaceType, causeId, { mesh: true, islands: fallout.paintedLoops });
}
