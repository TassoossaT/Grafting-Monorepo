import type { ConstructionPatchOutcome } from "@/ports";

import type { ToolContext } from "../../core/tool-context.ts";
import type { PlanSpineContourResult } from "./plan-spine-contour.ts";

/**
 * Registers a planned spine contour patch against the live session: the
 * standing regions it replaces come out first, then the freshly unioned
 * ones go in -- the same two-step shape `commitPathContour` already used
 * for a mouth (`junctionRemovals` then `addPatch`), just driven by
 * {@link PlanSpineContourResult.consumedSurfaceKeys} instead of a hand-built
 * wedge list.
 *
 * No rollback of its own beyond what `addPatch`'s own refusal already gives
 * for free: `master` today has no rollback beyond that either for the
 * mouth/wedge path this replaces, so this mirrors exactly that much rather
 * than inventing more.
 */
export function applySpineContour(
  ctx: ToolContext,
  operationId: string,
  result: PlanSpineContourResult,
): ConstructionPatchOutcome {
  if (result.consumedSurfaceKeys.length > 0) {
    ctx.runtime.applyRegionEdit(
      result.consumedSurfaceKeys.map((surfaceKey) => ({ kind: "delete-region" as const, surfaceKey })),
      "local",
      operationId,
    );
  }
  return ctx.runtime.addPatch(result.patch, "local", operationId);
}
