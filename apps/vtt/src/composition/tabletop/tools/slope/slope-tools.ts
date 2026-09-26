import { DEFAULT_TOOL_PARAMS, hasTrait, RAMP_SURFACE_TYPE, rampOutline, SLOPE_SURFACE_TYPE } from "../../../../features/edit-construction/index.ts";
import type { ToolParamsByTool } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import type { ConstructionTool, PointerSample, ToolContext } from "../core/tool-context.ts";
import { withStructureEditing } from "../core/structure-edit-behavior.ts";
import { withSpineEditing } from "../core/spine-edit-behavior.ts";
import { polylineSegmentsPreview } from "../shapes/preview-shapes.ts";
import { commitPlatformSlope } from "./slope-commit.ts";
import { createCurveDraftTool, type FinishedCurveDraft } from "../core/curve-draft.ts";
import { slopeSelection } from "./slope-selection.ts";
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

/** A finished draft, committed as a sloped platform: laid-out spans as they are, points as a smooth run through them. */
function commitDraft(ctx: ToolContext, draft: FinishedCurveDraft, params: { readonly width: number }): void {
  if (draft.kind === "points") commitPlatformSlope(ctx, draft.points, params);
  else commitPlatformSlope(ctx, [], params, draft.spans);
}

/**
 * A spiral, laid out as a centre-ends spiral run: centre, start, then turned
 * round the centre to its end -- see `curve-draft.ts`.
 */
const rawSlopeSpiralTool = createCurveDraftTool({
  id: "slope-spiral",
  defaultParams: () => DEFAULT_TOOL_PARAMS["slope-spiral"],
  modeOf: () => "spiral",
  riseOf: (params) => params.rise,
  widthOf: (params) => params.width,
  commit: commitDraft,
  color: COLOR,
});

const spiralSelection = slopeSelection("slope-spiral");

/**
 * Also edits an existing spiral by its spine points, exactly as a road is
 * edited -- see `spine-edit-behavior.ts` -- and as a whole from the panel,
 * once one of its points is picked -- see `slope-selection.ts`.
 */
export const slopeSpiralTool = withSpineEditing({ ...rawSlopeSpiralTool, onParamsChange: spiralSelection.onParamsChange }, {
  ownsSpine: ownsSlope, drafting: rawSlopeSpiralTool.drafting, onSelect: spiralSelection.onSelect,
});

/** A curved ramp, drawn in any of the shared spine creation modes; R cycles them. */
const rawSlopeCurveTool = createCurveDraftTool({
  id: "slope-curve",
  defaultParams: () => DEFAULT_TOOL_PARAMS["slope-curve"],
  modeOf: (params) => params.mode ?? "points",
  withMode: (params, mode) => ({ ...params, mode }),
  riseOf: (params) => params.rise,
  widthOf: (params) => params.width,
  commit: commitDraft,
  color: COLOR,
});

const curveSelection = slopeSelection("slope-curve");

/** Edits an existing curved ramp by its spine points, as the spiral and the road are edited, and as a whole from the panel. */
export const slopeCurveTool = withSpineEditing({ ...rawSlopeCurveTool, onParamsChange: curveSelection.onParamsChange }, {
  ownsSpine: ownsSlope, drafting: rawSlopeCurveTool.drafting, onSelect: curveSelection.onSelect,
});
