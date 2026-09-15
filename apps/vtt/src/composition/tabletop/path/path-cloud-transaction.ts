import type { PathBrushEffect } from "../../../features/edit-construction/index.ts";
import { planPathCloudMutation } from "../../../features/edit-construction/index.ts";

import type { ToolContext } from "../tools/core/tool-context.ts";
import { reportToolFailure, reportToolWarning } from "../tools/core/tool-diagnostics.ts";
import { timeCommit, timePhase } from "../commit-timing.ts";
import { commitPatchReplacement } from "../effects/effect-commit.ts";

/**
 * Runtime boundary for a PathCloud decision. This file deliberately contains
 * no path geometry or topology policy: it reads snapshots, invokes the type,
 * and commits the generic replacement it returns. It has no opinion, and no
 * code, for what happens when that replacement cuts into another type: the
 * commit emits the change as an effect, and whatever it reaches answers from
 * its own declared reaction, in the same transaction.
 */
export function commitPathCloudIntent(
  ctx: ToolContext,
  effect: PathBrushEffect,
  tolerance: number,
): void {
  timeCommit("rua", () => commitUntimed(ctx, effect, tolerance));
}

function commitUntimed(
  ctx: ToolContext,
  effect: PathBrushEffect,
  tolerance: number,
): void {
  try {
    const plan = timePhase("plano da nuvem", () => planPathCloudMutation({
      bezier: ctx.runtime,
      tableId: ctx.tableId,
      snapToGrid: ctx.snapToGrid,
      graphSnapshot: timePhase("leitura do grafo", () => ctx.runtime.getGraphSnapshot()),
      regionTopologies: timePhase("leitura de todas as topologias", () => ctx.runtime.getAllRegionTopologies()),
      coverageFor: (outline) => timePhase("cobertura do traço", () => ctx.runtime.getFootprintCoverage(outline)),
      effect,
      tolerance,
    }));
    if (plan.kind === "noop") {
      ctx.reportFeedback({ tone: "info", message: plan.message });
      return;
    }
    if (plan.kind === "refused") {
      ctx.reportFeedback({ tone: "error", message: `Caminho não aplicado: ${plan.reason}` });
      return;
    }

    const { value: outcome, recorded } = commitPatchReplacement(ctx.runtime, plan.request, { transactionId: effect.operationId, subtype: effect.parameters.kind });
    if (recorded) ctx.history.record({ kind: "transaction", transactionId: effect.operationId });
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
