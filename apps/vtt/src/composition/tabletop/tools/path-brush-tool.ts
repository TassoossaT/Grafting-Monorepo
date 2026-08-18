import { createPathBrushEffect, DEFAULT_TOOL_PARAMS, resolveBrushShape, surfaceEditModeFor } from "@/features/edit-construction";
import type { PathBrushEffect, PathBrushParams } from "@/features/edit-construction";

import type { ConstructionTool, ToolContext, ToolGesture } from "./tool-context.ts";
import { brushStrokeOutline } from "./preview-shapes.ts";

const PATH_PREVIEW_COLOR = 0xc084fc;

function effectFor(
  ctx: ToolContext,
  gesture: ToolGesture,
  params: PathBrushParams,
  operationId: string,
): PathBrushEffect {
  return createPathBrushEffect(
    {
      brushShape: resolveBrushShape(params),
      brushRegion: { samples: gesture.samples.map((sample) => sample.point) },
      parameters: { width: params.radius * 2, depth: params.depth, falloff: 1, strength: 1 },
    },
    { operationId, tableId: ctx.tableId, initiatedBy: "local" },
  );
}

function commit(ctx: ToolContext, gesture: ToolGesture, params: PathBrushParams): void {
  const sequence = ctx.nextSequence();
  const effect = effectFor(ctx, gesture, params, `${ctx.tableId}:path-brush:${sequence}`);
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
}

/** Preview during the drag; publish exactly one semantic operation on release. */
export const pathBrushTool: ConstructionTool<"path-brush"> = {
  id: "path-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["path-brush"],

  previewFor(gesture: ToolGesture, params: PathBrushParams, ctx: ToolContext) {
    const outline = brushStrokeOutline(
      gesture.samples.map((sample) => sample.point),
      params.shape === "circle"
        ? { kind: "circle", radius: params.radius }
        : { kind: params.shape, radius: params.radius, rotationRadians: (params.rotationDegrees * Math.PI) / 180 },
      PATH_PREVIEW_COLOR,
      0.75,
    );
    const surfaceRef = gesture.current.surfaceRef;
    const surface = surfaceRef === undefined ? undefined : ctx.runtime.getSnapshot().map.byId.get(surfaceRef);
    if (surface === undefined) {
      ctx.reportFeedback({ tone: "info", message: "Posicione o pincel sobre uma superfície de terreno." });
      return outline;
    }
    const mode = surfaceEditModeFor(surface.type);
    if (mode === undefined || !mode.effectKinds.includes("surface.path-brush@1")) {
      ctx.reportFeedback({ tone: "info", message: `Superfície “${surface.type}” não possui modo de caminho.`, surfaceRef });
      return outline;
    }

    const previewEffect = effectFor(ctx, gesture, params, `${ctx.tableId}:path-brush-preview`);
    try {
      const preview = ctx.runtime.previewPathBrush(previewEffect);
      ctx.reportFeedback({
        tone: "info",
        message: preview === undefined ? `Modo ${mode.label}: nenhuma alteração prevista.` : `Modo ${mode.label}: recorte, topologia e depressão previstos.`,
        surfaceRef,
      });
      return preview ?? outline;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.reportFeedback({ tone: "error", message: `Prévia indisponível: ${message}`, surfaceRef });
      return outline;
    }
  },

  // Presence of this hook makes the generic dispatcher capture and sample the drag.
  onPointerMove(): void {},

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: PathBrushParams): void {
    commit(ctx, gesture, params);
  },
};