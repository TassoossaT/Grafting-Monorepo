import { createPathBrushEffect, DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { PathBrushEffect, PathBrushParams } from "@/features/edit-construction";

import type { ToolContext } from "./tool-context.ts";
import type { BrushRegion } from "./brush-tool.ts";
import { createBrushTool } from "./brush-tool.ts";

const PATH_PREVIEW_COLOR = 0xc084fc;

function effectFor(ctx: ToolContext, region: BrushRegion, params: PathBrushParams, operationId: string): PathBrushEffect {
  return createPathBrushEffect(
    {
      brushShape: region.shape,
      brushRegion: { samples: region.samples },
      parameters: { width: params.radius * 2, depth: params.depth, falloff: 1, strength: 1 },
    },
    { operationId, tableId: ctx.tableId, initiatedBy: "local" },
  );
}

/**
 * Path-brush's own effect: the brush hands it a region, it decides that
 * means "form a path here" and calls the analytic Rust plan for the whole
 * region -- once, on commit, never incrementally. Preview is the plain
 * generic swept-region outline every brush tool gets (no custom
 * `previewRegion`) -- a path is a structure like any other, not a special
 * case that needs to inspect what's underneath before it can even be
 * drawn. What surface type ends up under the brush is something `applyRegion`
 * (and the Rust plan it calls) sorts out at commit time, the same way
 * terrain generation already does, not something the preview needs to
 * pre-validate.
 */
export const pathBrushTool = createBrushTool<"path-brush">({
  id: "path-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["path-brush"],
  previewColor: () => PATH_PREVIEW_COLOR,

  applyRegion(region, ctx, params) {
    const sequence = ctx.nextSequence();
    const effect = effectFor(ctx, region, params, `${ctx.tableId}:path-brush:${sequence}`);
    try {
      const outcome = ctx.runtime.applyPathBrush(effect, "local");
      const changedSurfaceCount = outcome.surfaceIds.created.length + outcome.surfaceIds.replaced.length;
      if (changedSurfaceCount === 0 && outcome.surfaceIds.removed.length === 0) {
        ctx.reportFeedback({ tone: "info", message: "Nenhum terreno elegível foi alterado." });
        return;
      }
      ctx.history.record({ kind: "path-brush", operationId: effect.operationId });
      ctx.reportFeedback({
        tone: "success",
        message: `Caminho aplicado: ${changedSurfaceCount} superfícies alteradas, ${outcome.nodeIds.created.length} nós novos e ${outcome.nodeIds.replaced.length} atualizados.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.reportFeedback({ tone: "error", message: `Caminho não aplicado: ${message}` });
    }
  },
});
