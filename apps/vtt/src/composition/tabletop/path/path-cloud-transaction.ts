import type { PathBrushEffect } from "../../../features/edit-construction/index.ts";
import { planPathCloudMutation } from "../../../features/edit-construction/index.ts";

import type { ToolContext } from "../tools/core/tool-context.ts";
import { reportToolFailure, reportToolWarning } from "../tools/core/tool-diagnostics.ts";

/**
 * Runtime boundary for a PathCloud decision. This file deliberately contains
 * no path geometry or topology policy: it reads snapshots, invokes the type,
 * and submits the generic replacement transaction it returns. It has no
 * opinion, and no code, for what happens when that replacement cuts into
 * another type -- `plan.request.footprintOutline` rides along on the request
 * itself, and `TabletopRuntime.applyPatchReplacement` is what notices a
 * consumed region needs repairing and dispatches it, the same for any caller
 * of that method, not a path-specific step this file performs.
 */
export function commitPathCloudIntent(
  ctx: ToolContext,
  effect: PathBrushEffect,
  tolerance: number,
): void {
  try {
    const plan = planPathCloudMutation({
      tableId: ctx.tableId,
      snapToGrid: ctx.snapToGrid,
      graphSnapshot: ctx.runtime.getGraphSnapshot(),
      regionTopologies: ctx.runtime.getAllRegionTopologies(),
      coverageFor: (outline) => ctx.runtime.getFootprintCoverage(outline),
      effect,
      tolerance,
    });
    if (plan.kind === "noop") {
      ctx.reportFeedback({ tone: "info", message: plan.message });
      return;
    }
    if (plan.kind === "refused") {
      ctx.reportFeedback({ tone: "error", message: `Caminho não aplicado: ${plan.reason}` });
      return;
    }

    const outcome = ctx.runtime.applyPatchReplacement(plan.request, "local", effect.operationId);
    if (outcome.skippedRegionIds.length > 0) {
      reportToolWarning("path-cloud", "a band face was refused", {
        operationId: effect.operationId,
        skipped: outcome.skippedRegionIds,
      });
    }
    const changedSurfaceCount = outcome.createdSurfaceKeys.length + outcome.affectedSurfaceKeys.length;
    if (changedSurfaceCount === 0 && outcome.removedSurfaceKeys.length === 0) {
      ctx.reportFeedback({ tone: "info", message: "Nenhuma alteração: o traço não cobriu nenhuma área válida." });
      return;
    }
    ctx.history.record({ kind: "path-brush", operationId: effect.operationId });
    ctx.reportFeedback({
      tone: "success",
      message: `Caminho aplicado: ${changedSurfaceCount} superfícies alteradas e ${outcome.createdNodeIds.length} nós novos.`,
    });
  } catch (error) {
    reportToolFailure("path-cloud", "commit the PathCloud transaction", { operationId: effect.operationId }, error);
    const message = error instanceof Error ? error.message : String(error);
    ctx.reportFeedback({ tone: "error", message: `Caminho não aplicado: ${message}` });
  }
}
