import { createPathBrushEffect, DEFAULT_TOOL_PARAMS, surfaceEditModeFor } from "@/features/edit-construction";
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

/** Path-brush's own effect: the brush hands it a region, it decides that means "form a path here" and calls the analytic Rust plan for the whole region -- once, on preview and once more on commit, never incrementally. */
export const pathBrushTool = createBrushTool<"path-brush">({
  id: "path-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["path-brush"],
  previewColor: () => PATH_PREVIEW_COLOR,

  previewRegion(region, ctx, gesture, params) {
    const surfaceRef = gesture.current.surfaceRef;
    const surface = surfaceRef === undefined ? undefined : ctx.runtime.getSnapshot().map.byId.get(surfaceRef);
    if (surface === undefined) {
      ctx.reportFeedback({ tone: "info", message: "Posicione o pincel sobre uma superfície de terreno." });
      return undefined;
    }
    const mode = surfaceEditModeFor(surface.type);
    if (mode === undefined || !mode.effectKinds.includes("surface.path-brush@1")) {
      ctx.reportFeedback({ tone: "info", message: `Superfície “${surface.type}” não possui modo de caminho.`, surfaceRef });
      return undefined;
    }

    const previewEffect = effectFor(ctx, region, params, `${ctx.tableId}:path-brush-preview`);
    try {
      const preview = ctx.runtime.previewPathBrush(previewEffect);
      ctx.reportFeedback({
        tone: "info",
        message: preview === undefined ? `Modo ${mode.label}: nenhuma alteração prevista.` : `Modo ${mode.label}: recorte, topologia e depressão previstos.`,
        surfaceRef,
      });
      return preview;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.reportFeedback({ tone: "error", message: `Prévia indisponível: ${message}`, surfaceRef });
      return undefined;
    }
  },

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
