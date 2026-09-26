import { structureTypeFor } from "../../../../features/edit-construction/index.ts";
import type { SpineRegeneration } from "../../../../features/edit-construction/index.ts";
import type { ApplyPatchReplacementRequest, ConstructionGraphPatch, ConstructionGraphSnapshot } from "../../../../ports/index.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";
import type { ToolContext } from "./tool-context.ts";

/**
 * The two steps every spine edit ends with, whichever gesture or panel made
 * it: the spine's owner regenerates its surface from the edited spine, and
 * the result is committed as one undoable transaction.
 */

/** What `owner` makes of `graphPatch` applied to `snapshot`; `undefined` when it has no spine or makes nothing. */
export function regenerateSpine(ctx: ToolContext, snapshot: ConstructionGraphSnapshot, owner: string | undefined, graphPatch: ConstructionGraphPatch, operationId: string): SpineRegeneration | undefined {
  const generation = owner === undefined ? undefined : structureTypeFor(owner)?.spine;
  return generation?.regenerate({
    snapshot, graphPatch, topologies: ctx.runtime.getAllRegionTopologies(), port: ctx.runtime, field: ctx.runtime, operationId, tableId: ctx.tableId,
  });
}

/** Commits `request` -- its effects dispatched -- and records it for undo. */
export function commitSpineRegeneration(ctx: ToolContext, request: ApplyPatchReplacementRequest, operationId: string): void {
  const { recorded } = commitPatchReplacement(ctx.runtime, request, { transactionId: operationId });
  if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
}
