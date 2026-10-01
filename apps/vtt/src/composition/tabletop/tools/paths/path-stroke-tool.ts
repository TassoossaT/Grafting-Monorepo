import type { PathBrushParams } from "../../../../features/edit-construction/index.ts";
import type { ToolContext, ToolGesture } from "../core/tool-context.ts";
import { samePlace, type SpineDraftStroke } from "../core/spine-draft.ts";
import { roadSnapTarget, showRoadSnap } from "./road-body-target.ts";
import { clearRoadPreview, layRoad, previewRoad, previewRoadError, shapeRoad, type ShapedRoad } from "./road-lay.ts";

const CHANNEL = "road-stroke";

/**
 * The road a stroke draws, its last sample snapped onto a road it ends on.
 * A road too steep to climb to that target stops short of it and does not
 * join it, so the snap only shows when the road reaches it.
 */
function draft(ctx: ToolContext, g: ToolGesture, params: PathBrushParams): ShapedRoad {
  const samples = [...g.samples, g.current].filter((sample, index, all) => index === 0 || !samePlace(sample.point, all[index - 1]!.point));
  const target = roadSnapTarget(ctx, g.current);
  if (target) samples[samples.length - 1] = target;
  const road = shapeRoad(ctx, samples.map((sample) => sample.point), params, true);
  showRoadSnap(ctx, target && road.end && samePlace(road.end, target.point) ? target : undefined);
  return road;
}

/**
 * A road's centre line drawn by dragging, laid on release as one fitted
 * curve transaction. The sketch owns the gesture; this only shapes, shows
 * and lays what it is handed.
 */
export const pathStroke: SpineDraftStroke<"path-brush"> = {
  begin(ctx) { showRoadSnap(ctx); },
  move(ctx, g, params) {
    try {
      previewRoad(ctx, draft(ctx, g, params).curves, params, CHANNEL);
    } catch {
      showRoadSnap(ctx);
      previewRoadError(ctx, g.samples.map((sample) => sample.point).filter((p) => Object.values(p).every(Number.isFinite)), params, CHANNEL);
    }
  },
  finish(ctx, g, params) {
    clearRoadPreview(ctx, CHANNEL);
    try {
      return layRoad(ctx, draft(ctx, g, params).curves, params, "road-stroke");
    } catch (error) {
      ctx.reportFeedback({ tone: "error", message: `Traçado não aplicado: ${String(error)}` });
      return false;
    } finally {
      showRoadSnap(ctx);
    }
  },
  cancel(ctx) { clearRoadPreview(ctx, CHANNEL); showRoadSnap(ctx); },
};
