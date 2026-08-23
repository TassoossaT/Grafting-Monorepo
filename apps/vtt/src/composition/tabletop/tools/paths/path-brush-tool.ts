import {
  createPathBrushEffect,
  DEFAULT_TOOL_PARAMS,
  firstRefusal,
  pathFormationFor,
  resolveCoverage,
} from "@/features/edit-construction";
import type { PathBrushEffect, PathBrushParams } from "@/features/edit-construction";

import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import type { BrushRegion } from "../core/brush-tool.ts";
import { createBrushTool } from "../core/brush-tool.ts";
import { pathPatch } from "./path-patch.ts";

const PATH_PREVIEW_COLOR = 0xc084fc;

function effectFor(ctx: ToolContext, region: BrushRegion, params: PathBrushParams, operationId: string): PathBrushEffect {
  return createPathBrushEffect(
    {
      brushShape: region.shape,
      brushRegion: { samples: region.samples },
      parameters: pathFormationFor(params),
    },
    { operationId, tableId: ctx.tableId, initiatedBy: "local" },
  );
}

/**
 * Path creation follows the same ownership split as walls: this tool chooses
 * the product recipe and interactions, `pathPatch` declares its graph, and
 * Rust only supplies reusable geometry and executes the resolved overlay.
 */
export const pathBrushTool = createBrushTool<"path-brush">({
  id: "path-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["path-brush"],
  previewColor: () => PATH_PREVIEW_COLOR,

  applyRegion(region, ctx, params) {
    const sequence = ctx.nextSequence();
    const effect = effectFor(ctx, region, params, scopedToolId(ctx, "path-brush", sequence));
    try {
      const formation = pathPatch(effect.operationId, effect.targetType, ctx.runtime.planPathFormation(effect));
      const resolved = resolveCoverage(effect.targetType, ctx.runtime.getFootprintCoverage(formation.outline));
      const refusal = firstRefusal(resolved);
      if (refusal !== undefined) {
        ctx.reportFeedback({ tone: "error", message: `Caminho não aplicado: ${refusal}` });
        return;
      }
      const sourceSurfaceKeys = resolved
        .filter((entry) => entry.interaction.kind === "cut")
        .map((entry) => entry.covered.surfaceKey);
      const outcome = ctx.runtime.applyRegionOverlay(
        {
          operationId: effect.operationId,
          sourceSurfaceKeys,
          outline: formation.outline,
          boundary: formation.boundary,
          patch: formation.patch,
        },
        "local",
        effect.operationId,
      );
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
      const message = error instanceof Error ? error.message : String(error);
      ctx.reportFeedback({ tone: "error", message: `Caminho não aplicado: ${message}` });
    }
  },
});
