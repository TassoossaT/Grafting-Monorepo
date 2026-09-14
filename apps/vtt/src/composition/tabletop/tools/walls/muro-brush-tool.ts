import { DEFAULT_TOOL_PARAMS, planMuroCreation } from "../../../../features/edit-construction/index.ts";
import { createBrushTool } from "../core/brush-tool.ts";
import { scopedToolId } from "../core/tool-context.ts";

export const muroBrushTool = createBrushTool<"muro-brush">({
  id: "muro-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["muro-brush"],
  previewColor: () => 0xb6a18c,
  halfWidth: (params) => params.thickness / 2,
  applyRegion(region, ctx, params) {
    const operationId = scopedToolId(ctx, "muro-brush", ctx.nextSequence());
    try {
      const plan = planMuroCreation({ snapshot: ctx.runtime.getGraphSnapshot(), topologies: ctx.runtime.getAllRegionTopologies(), port: ctx.runtime, stroke: region.samples, operationId, height: params.height, thickness: params.thickness, tolerance: region.tolerance });
      if (!plan) { ctx.reportFeedback({ tone: "info", message: "Desenhe um trecho para criar o muro." }); return; }
      ctx.runtime.applyPatchReplacement(plan.request, "local", operationId);
      ctx.history.record({ kind: "path-brush", operationId });
      ctx.reportFeedback({ tone: "success", message: "Muro criado. Edite pelos nós e alças do eixo." });
    } catch (error) {
      ctx.reportFeedback({ tone: "error", message: `Muro não aplicado: ${String(error)}` });
    }
  },
});
