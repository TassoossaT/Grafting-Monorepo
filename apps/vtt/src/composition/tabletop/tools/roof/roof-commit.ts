import type { ConstructionPatch, ConstructionSurfaceKey } from "@/ports";

import { roofGraphPatch, type RoofSource } from "../../../../features/edit-construction/index.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";
import { keepFaceProps, pinnedToRoles } from "../core/face-props.ts";
import { scopedToolId, type ToolContext } from "../core/tool-context.ts";

/*
 * Committing roofs made from their recipes: every roof edit -- a stroke, a
 * handle's recipe, a dormer raised for an opening -- ends here, the faces
 * replaced and what was pinned to them carried to their successors.
 */

/**
 * Makes the roofs `requests` describe in place of the faces `replaces` names,
 * under transaction `transactionId` -- joining it when it is already under
 * way -- and returns the new faces' group name and whether it was recorded.
 * What was pinned to a replaced face moves to the new face of the same role.
 */
export function replaceRoofs(
  ctx: ToolContext,
  requests: readonly RoofSource[],
  replaces: readonly ConstructionSurfaceKey[],
  transactionId?: string,
): { readonly group: string; readonly recorded: boolean } {
  const operationId = scopedToolId(ctx, "roof", ctx.nextSequence());
  const standing = ctx.runtime.getAllRegionTopologies();
  const made = requests.map((request, i) => roofGraphPatch(ctx.runtime, request, requests.length === 1 ? operationId : `${operationId}:${i}`, standing));
  const patch: ConstructionPatch = {
    nodes: made.flatMap(({ patch }) => patch.nodes),
    edges: made.flatMap(({ patch }) => patch.edges),
    regions: made.flatMap(({ patch }) => patch.regions),
  };
  const faceProps = new Map(made.flatMap(({ faceProps }) => [...faceProps]));
  const pinned = pinnedToRoles(ctx.runtime.getAllRegionTopologies(), replaces);
  const { recorded } = commitPatchReplacement(ctx.runtime, { operationId, sourceSurfaceKeys: replaces, patch }, {
    transactionId: transactionId ?? operationId,
    afterward: (outcome) => keepFaceProps(ctx.runtime, operationId, outcome.createdSurfaceKeys, faceProps, pinned),
  });
  return { group: operationId, recorded };
}

export function commitRoofRecipes(ctx: ToolContext, requests: readonly RoofSource[], replaces: readonly ConstructionSurfaceKey[] = [], done = "Telhado criado."): void {
  try {
    const { group: operationId, recorded } = replaceRoofs(ctx, requests, replaces);
    if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
    ctx.reportFeedback({ tone: "success", message: done });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
