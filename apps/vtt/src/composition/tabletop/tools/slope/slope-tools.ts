import { DEFAULT_TOOL_PARAMS, RAMP_SURFACE_TYPE, rampOutline, SLOPE_SURFACE_TYPE } from "../../../../features/edit-construction/index.ts";
import type { ConstructionTool } from "../core/tool-context.ts";
import { withStructureEditing } from "../core/structure-edit-behavior.ts";
import { polylineSegmentsPreview } from "../shapes/preview-shapes.ts";
import { commitPlatformSlope, slopeControlPoint, spiralControlPoints } from "./slope-commit.ts";
import { commitStraightRamp, plannedRamp, straightRampPoints } from "./ramp-commit.ts";

const ownsSlope = (surfaceType: string) => surfaceType === SLOPE_SURFACE_TYPE;
const ownsRamp = (surfaceType: string) => surfaceType === RAMP_SURFACE_TYPE;

const COLOR = 0x79b8e8;

/**
 * Two structures with two different truths. A straight ramp is a trapezoid
 * edited by its corners, sides and ends; a spiral is a sloped-platform spine
 * edited by its control points and handles, and is what a ramp with curves
 * is drawn as.
 */

/** Drag from the start to the end; the ramp climbs the fixed rise. */
const rawSlopeRampTool: ConstructionTool<"slope-ramp"> = {
  id: "slope-ramp",
  previewOnHover: true,
  defaultParams: () => DEFAULT_TOOL_PARAMS["slope-ramp"],
  previewFor(gesture, params, ctx) {
    try {
      return polylineSegmentsPreview(rampOutline(plannedRamp(ctx, gesture.start, gesture.current, params).corners), COLOR);
    } catch {
      return undefined;
    }
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
    commitStraightRamp(ctx, gesture.start, gesture.current, params);
  },
};

/** Also grabs and edits an existing ramp's own corner, side, end or body -- see `structure-edit-behavior.ts`. */
export const slopeRampTool = withStructureEditing(rawSlopeRampTool, { ownsType: ownsRamp });

/** Click the centre; the spiral climbs the rise over its turns. */
const rawSlopeSpiralTool: ConstructionTool<"slope-spiral"> = {
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

/** Also grabs and edits an existing slope spine's own control point/segment -- see `structure-edit-behavior.ts`. */
export const slopeSpiralTool = withStructureEditing(rawSlopeSpiralTool, { ownsType: ownsSlope });
