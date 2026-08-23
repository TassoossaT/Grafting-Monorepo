import {
  createPathBrushEffect,
  firstRefusal,
  pathFormationFor,
  resolveCoverage,
} from "@/features/edit-construction";
import type { BrushShape, PathBrushParams } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import { pathPatch } from "./path-patch.ts";

export const PATH_COLOR = 0xc084fc;

/**
 * Commits one path run, in one transaction.
 *
 * This is the only path a path is ever built by, the way
 * `walls/wall-shared.ts`'s `commitWallContour` is the only path a wall is
 * built by. A free stroke, and any straight drag or preset that comes
 * later, differ in nothing but the reference line they hand over: they all
 * resolve their formation the same way, claim their edges the same way, and
 * declare the same faces. Nothing here knows which tool called it.
 *
 * The reference line is still a plain polyline rather than the contour-edge
 * vocabulary a wall speaks, because the sweep planner only samples a
 * polyline. That is the one thing this funnel does not yet fix -- but it is
 * now the single place that would have to change.
 */
export function commitPathContour(
  ctx: ToolContext,
  referenceLine: readonly ConstructionPosition[],
  brushShape: BrushShape,
  params: PathBrushParams,
  domain: string,
): void {
  if (referenceLine.length === 0) return;
  const sequence = ctx.nextSequence();
  const operationId = scopedToolId(ctx, domain, sequence);

  try {
    const effect = createPathBrushEffect(
      {
        brushShape,
        brushRegion: { samples: referenceLine },
        parameters: pathFormationFor(params),
      },
      { operationId, tableId: ctx.tableId, initiatedBy: "local" },
    );
    const formation = pathPatch(
      ctx.tableId,
      effect.operationId,
      effect.targetType,
      ctx.runtime.planPathFormation(effect),
    );

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
}
