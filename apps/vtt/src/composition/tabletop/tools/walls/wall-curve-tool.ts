import { DEFAULT_TOOL_PARAMS, planWallCurveCreation } from "@/features/edit-construction";
import type { WallBrushParams } from "@/features/edit-construction";

import { createBrushTool, type BrushRegion } from "../core/brush-tool.ts";
import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import { WALL_COLOR } from "./wall-shared.ts";

/**
 * A wall drawn as a persistent Bezier axis instead of a straight/arc
 * contour: press, drag, and on release the stroke is fit into a smooth
 * curve whose nodes and handles stay in the graph, editable afterward with
 * the same gesture a road's spine already uses (`edit-region`). What the
 * curve *makes* is still an ordinary wall panel run, generated in
 * `wall-curve-spine.ts` -- this tool only chooses the interaction.
 */
export const wallCurveTool = createBrushTool<"wall-curve">({
  id: "wall-curve",
  defaultParams: () => DEFAULT_TOOL_PARAMS["wall-curve"],
  previewColor: (params: WallBrushParams) => WALL_COLOR[params.wallType],
  // Zero thickness in plan, same as the other wall tools: the whole brush
  // reach is the curve's own fitting tolerance.
  halfWidth: () => 0,

  applyRegion(region: BrushRegion, ctx: ToolContext, params: WallBrushParams): void {
    const operationId = scopedToolId(ctx, "wall-curve", ctx.nextSequence());
    try {
      const plan = planWallCurveCreation({
        snapshot: ctx.runtime.getGraphSnapshot(),
        topologies: ctx.runtime.getAllRegionTopologies(),
        port: ctx.runtime,
        stroke: region.samples,
        operationId,
        tableId: ctx.tableId,
        height: params.height,
        tolerance: region.tolerance,
        wallType: params.wallType === "wall-gray" ? "wall-curve-gray" : "wall-curve-white",
      });
      if (!plan) {
        ctx.reportFeedback({ tone: "info", message: "Desenhe um trecho para criar a parede." });
        return;
      }
      ctx.runtime.applyPatchReplacement(plan.request, "local", operationId);
      ctx.history.record({ kind: "path-brush", operationId });
      ctx.reportFeedback({ tone: "success", message: "Parede criada. Edite pelos nos e alcas do eixo." });
    } catch (error) {
      ctx.reportFeedback({ tone: "error", message: `Parede nao aplicada: ${String(error)}` });
    }
  },
});
