import { DEFAULT_TOOL_PARAMS } from "../../../../features/edit-construction/index.ts";
import type { ConstructionTool } from "../core/tool-context.ts";
import { polylineSegmentsPreview } from "../shapes/preview-shapes.ts";
import { commitPlatformSlope, slopeControlPoint, spiralControlPoints, straightRampOutline, straightRampPoints } from "./slope-commit.ts";

const COLOR = 0x79b8e8;

/**
 * Two ways of drawing the same structure. A ramp and a spiral are presets
 * choosing control points; both commit an ordinary sloped-platform spine,
 * edited afterwards by the same spine handles.
 */

/** Drag from the start to the end; the ramp climbs the fixed rise. */
export const slopeRampTool: ConstructionTool<"slope-ramp"> = {
  id: "slope-ramp",
  previewOnHover: true,
  defaultParams: () => DEFAULT_TOOL_PARAMS["slope-ramp"],
  previewFor(gesture, params, ctx) {
    const [from, to] = straightRampPoints(ctx, gesture.start, gesture.current, params);
    return polylineSegmentsPreview(straightRampOutline(from, to, params.width), COLOR);
  },
  onClick(ctx) {
    ctx.reportFeedback({ tone: "info", message: "Arraste do início ao fim da rampa; ela sobe a altura escolhida em Subida." });
  },
  onPointerUp(ctx, gesture, params) {
    if (gesture.samples.length < 2) return;
    const [from, to] = straightRampPoints(ctx, gesture.start, gesture.current, params);
    if (Math.hypot(to.x - from.x, to.z - from.z) < 0.5) {
      ctx.reportFeedback({ tone: "error", message: "Arraste mais longe para desenhar a rampa." });
      return;
    }
    commitPlatformSlope(ctx, [from, to], params);
  },
};

/** Click the centre; the spiral climbs the rise over its turns. */
export const slopeSpiralTool: ConstructionTool<"slope-spiral"> = {
  id: "slope-spiral",
  previewOnHover: true,
  defaultParams: () => DEFAULT_TOOL_PARAMS["slope-spiral"],
  previewFor(gesture, params, ctx) {
    try {
      return polylineSegmentsPreview(spiralControlPoints(slopeControlPoint(ctx, gesture.current), params), COLOR);
    } catch {
      return undefined;
    }
  },
  onClick(ctx, sample, params) {
    commitPlatformSlope(ctx, spiralControlPoints(slopeControlPoint(ctx, sample), params), params);
  },
};
