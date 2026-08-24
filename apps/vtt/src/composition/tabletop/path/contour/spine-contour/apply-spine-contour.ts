import type { ConstructionPatchOutcome } from "@/ports";

import type { ToolContext } from "../../../tools/core/tool-context.ts";
import type { PlanSpineContourResult } from "./plan-spine-contour.ts";

/**
 * Registers a planned spine contour patch against the live session: the
 * standing regions it replaces come out first, then the freshly unioned
 * ones go in -- one operation after the planner has resolved the spine
 * effect, driven by {@link PlanSpineContourResult.consumedSurfaceKeys}
 * instead of a hand-built wedge list.
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
  onRemovalFailure?: (surfaceKey: string, error: unknown) => void,
): ConstructionPatchOutcome {
  const stillStanding = new Set(
    ctx.runtime.getAllRegionTopologies().map((topology) => topology.surfaceKey.join(":")),
  );
  for (const surfaceKey of result.consumedSurfaceKeys) {
    const key = surfaceKey.join(":");
    if (!stillStanding.has(key)) {
      onRemovalFailure?.(key, new Error("the standing band was already gone"));
      continue;
    }
    try {
      ctx.runtime.applyRegionEdit([{ kind: "delete-region" as const, surfaceKey }], "local", operationId);
    } catch (error) {
      onRemovalFailure?.(surfaceKey.join(":"), error);
    }
  }
  return ctx.runtime.addPatch(result.patch, "local", operationId);
}
