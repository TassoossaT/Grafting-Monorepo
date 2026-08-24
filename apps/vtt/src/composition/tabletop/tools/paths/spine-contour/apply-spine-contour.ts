import type { ConstructionPatchOutcome } from "@/ports";

import type { ToolContext } from "../../core/tool-context.ts";
import type { PlanSpineContourResult } from "./plan-spine-contour.ts";

/**
 * Registers a planned spine contour patch against the live session.
 *
 * Deliberately thin, and deliberately not wired into any tool yet -- this
 * stage adds the *derivation*, not the commit path. `master` today has no
 * X-crossing preparation and no rollback of its own beyond what
 * `applyRegionOverlay`'s refusal already gives it for free, so this mirrors
 * exactly that much: one `addPatch` call, its outcome returned unchanged.
 * Whatever rollback or coverage-refusal discipline `commitPathContour`
 * still needs is Estágio 4's decision, made once that function's own
 * mouth/wedge/mitre machinery is what this replaces -- inventing it here
 * ahead of that call would be complexity the current `master` does not ask
 * for.
 */
export function applySpineContour(ctx: ToolContext, result: PlanSpineContourResult): ConstructionPatchOutcome {
  return ctx.runtime.addPatch(result.patch);
}
