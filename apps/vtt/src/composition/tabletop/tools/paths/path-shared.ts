import {
  createPathBrushEffect,
  firstRefusal,
  pathFormationFor,
  resolveCoverage,
} from "@/features/edit-construction";
import type { BrushShape, PathBrushParams } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import { fitPath, type FittedEdge } from "../core/stroke-fitting.ts";
import { pathPatch } from "./path-patch.ts";

export const PATH_COLOR = 0xc084fc;

/**
 * How far a flattened arc may sit from the true circle, in world units.
 *
 * This is a smoothness knob, not a fidelity one: the fit has already decided
 * where the road goes, and this only controls how finely that decision is
 * spelled out for a sweep planner that cannot yet read an arc. It disappears
 * the moment the planner takes contour geometry directly.
 */
const ARC_FLATTENING_TOLERANCE = 0.05;

/**
 * The fitted contour as a plain polyline, arcs sampled by angle.
 *
 * Temporary, and deliberately kept in one function so it is obvious what to
 * delete: `plan_sweep_formation` only samples a polyline, so a true arc has
 * no way to reach it intact. Until it accepts contour geometry, a curve is
 * handed over as chords close enough that the difference is invisible --
 * which is still a world apart from handing over the raw hand.
 */
function flattenToPolyline(fitted: readonly FittedEdge[]): readonly ConstructionPosition[] {
  const first = fitted[0];
  if (first === undefined) return [];

  const polyline: ConstructionPosition[] = [first.start];
  for (const edge of fitted) {
    if (edge.geometry.kind === "arc") {
      const [centerX, centerZ] = edge.geometry.center;
      const radius = Math.hypot(edge.start.x - centerX, edge.start.z - centerZ);
      const startAngle = Math.atan2(edge.start.z - centerZ, edge.start.x - centerX);
      const endAngle = Math.atan2(edge.end.z - centerZ, edge.end.x - centerX);
      const counterClockwise = (endAngle - startAngle + Math.PI * 2) % (Math.PI * 2);
      const swept = edge.geometry.clockwise ? Math.PI * 2 - counterClockwise : counterClockwise;

      // Sagitta: a chord deviating by `t` from a circle of radius `r`
      // subtends 2*acos(1 - t/r). A radius under the tolerance has no
      // meaningful arc left to sample, so one chord is the whole of it.
      const maxStep =
        radius > ARC_FLATTENING_TOLERANCE
          ? 2 * Math.acos(1 - ARC_FLATTENING_TOLERANCE / radius)
          : Math.PI;
      const steps = Math.max(1, Math.ceil(swept / maxStep));
      for (let step = 1; step < steps; step += 1) {
        const angle = edge.geometry.clockwise
          ? startAngle - (swept * step) / steps
          : startAngle + (swept * step) / steps;
        polyline.push({
          x: centerX + radius * Math.cos(angle),
          y: edge.start.y,
          z: centerZ + radius * Math.sin(angle),
        });
      }
    }
    polyline.push(edge.end);
  }
  return polyline;
}

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
 * The raw stroke is fitted before anything else, exactly as
 * `commitWallStroke` fits one: `tolerance` is whatever of the brush's reach
 * the road itself does not occupy, so the committed road always lands inside
 * the ghost that was drawn. At zero slack -- a brush no wider than the road
 * -- the stroke is committed literally.
 *
 * What reaches Rust is still a polyline, because the sweep planner cannot
 * read an arc yet. But it is now a polyline of decisions rather than of hand
 * samples, and this is the single place that changes when the planner learns
 * contour geometry.
 */
export function commitPathContour(
  ctx: ToolContext,
  stroke: readonly ConstructionPosition[],
  brushShape: BrushShape,
  tolerance: number,
  params: PathBrushParams,
  domain: string,
): void {
  if (stroke.length === 0) return;
  const sequence = ctx.nextSequence();
  const operationId = scopedToolId(ctx, domain, sequence);

  const fitted = fitPath(stroke, tolerance, { arcs: !ctx.snapToGrid });
  const referenceLine = fitted.length === 0 ? stroke : flattenToPolyline(fitted);
  if (referenceLine.length === 0) return;

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
