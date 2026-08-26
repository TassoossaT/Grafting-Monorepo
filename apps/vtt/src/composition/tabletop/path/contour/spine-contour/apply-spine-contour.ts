import type { ConstructionGraphPatch, ConstructionPatchOutcome } from "@/ports";

import type { ToolContext } from "../../../tools/core/tool-context.ts";
import type { PlanSpineContourResult } from "./plan-spine-contour.ts";

/**
 * Registers a planned spine contour patch against the live session: the
 * standing regions it replaces and the freshly unioned patch are committed
 * by the generic runtime replacement transaction. The clone-and-publish
 * executor validates the target first, so a refused face cannot make a
 * nearby standing road disappear.
 */
export function applySpineContour(
  ctx: ToolContext,
  operationId: string,
  result: PlanSpineContourResult,
  graphPatch?: ConstructionGraphPatch,
): ConstructionPatchOutcome {
  return ctx.runtime.applyPatchReplacement(
    {
      operationId,
      sourceSurfaceKeys: result.consumedSurfaceKeys,
      patch: result.patch,
      graphPatch,
    },
    "local",
    operationId,
  );
}
