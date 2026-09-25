import { DEFAULT_TOOL_PARAMS, hasTrait, RAMP_SURFACE_TYPE, rampOutline, SLOPE_SURFACE_TYPE } from "../../../../features/edit-construction/index.ts";
import type { ToolParamsByTool } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import type { ConstructionTool, PointerSample, ToolContext } from "../core/tool-context.ts";
import { withStructureEditing } from "../core/structure-edit-behavior.ts";
import { withSpineEditing } from "../core/spine-edit-behavior.ts";
import { polylineSegmentsPreview } from "../shapes/preview-shapes.ts";
import { commitPlatformSlope, curvesPolyline, slopeControlPoint, spiralPlan } from "./slope-commit.ts";
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

/** A drag shorter than this from the centre is a click: the spiral takes the panel's radius. */
const MIN_DRAG_RADIUS = 0.3;

function spiralFrom(ctx: ToolContext, start: PointerSample, current: PointerSample | undefined, params: ToolParamsByTool["slope-spiral"]) {
  const center = slopeControlPoint(ctx, start);
  const towards = current && Math.hypot(current.point.x - center.x, current.point.z - center.z) >= MIN_DRAG_RADIUS ? current.point : undefined;
  return spiralPlan(ctx, center, params, towards);
}

/**
 * A spiral laid out from its centre, the way a spiral stair is: click for the
 * panel's radius, or drag out from the centre -- the distance is the radius
 * and the spiral starts where the drag ends. Its plan is an exact helix.
 */
const rawSlopeSpiralTool: ConstructionTool<"slope-spiral"> = {
  id: "slope-spiral",
  previewOnHover: true,
  defaultParams: () => DEFAULT_TOOL_PARAMS["slope-spiral"],
  previewFor(gesture, params, ctx) {
    try {
      const dragging = gesture.start !== gesture.current;
      const plan = dragging ? spiralFrom(ctx, gesture.start, gesture.current, params) : spiralFrom(ctx, gesture.current, undefined, params);
      return polylineSegmentsPreview(curvesPolyline(ctx, plan), COLOR);
    } catch {
      return undefined;
    }
  },
  onClick(ctx, sample, params) {
    commitPlatformSlope(ctx, [], params, spiralFrom(ctx, sample, undefined, params));
  },
  onPointerUp(ctx, gesture, params) {
    // A press with no drag is the click above; only a real drag sets the radius here.
    if (gesture.samples.length < 2) return;
    const center = slopeControlPoint(ctx, gesture.start);
    if (Math.hypot(gesture.current.point.x - center.x, gesture.current.point.z - center.z) < MIN_DRAG_RADIUS) return;
    try {
      commitPlatformSlope(ctx, [], params, spiralFrom(ctx, gesture.start, gesture.current, params));
    } catch (error) {
      ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  },
};

/** Also edits an existing spiral by its spine points, exactly as a road is edited -- see `spine-edit-behavior.ts`. */
export const slopeSpiralTool = withSpineEditing(rawSlopeSpiralTool, { ownsSpine: ownsSlope });

/** Where a curved ramp is being drawn: its points in plan, and what the last click landed on. */
interface CurveDraft { readonly points: ConstructionPosition[]; last?: PointerSample }
const curveDrafts = new WeakMap<ToolContext["runtime"], CurveDraft>();

/** The height of the floor `sample` landed on, if it landed on one. */
function floorHeightAt(ctx: ToolContext, sample: PointerSample): number | undefined {
  const floor = ctx.runtime.getAllRegionTopologies().find((topology) => hasTrait(topology.surfaceType, "floor") && (sample.surfaceRef
    ? surfaceRefFromNodeSet(topology.surfaceKey) === sample.surfaceRef
    : sample.nodeId !== undefined && topology.nodes.some((node) => node.id === sample.nodeId)));
  return floor?.nodes[0]?.position.y;
}

/** Commits the draft: it starts at its first point's height and ends on the floor last clicked, or `rise` higher. */
function finishCurve(ctx: ToolContext, params: ToolParamsByTool["slope-curve"]): void {
  const draft = curveDrafts.get(ctx.runtime);
  curveDrafts.delete(ctx.runtime);
  if (!draft || draft.points.length < 2) return;
  const first = draft.points[0]!;
  const floor = draft.last === undefined ? undefined : floorHeightAt(ctx, draft.last);
  const end = floor ?? first.y + params.rise;
  const points = draft.points.map((point, i) => i === draft.points.length - 1 ? { ...point, y: end } : point);
  commitPlatformSlope(ctx, points, params);
}

/**
 * A curved ramp, drawn like a road through points in plan: only its ends
 * carry heights, and it climbs between them at one constant grade.
 */
const rawSlopeCurveTool: ConstructionTool<"slope-curve"> = {
  id: "slope-curve",
  previewOnHover: true,
  defaultParams: () => DEFAULT_TOOL_PARAMS["slope-curve"],
  previewFor(gesture, _params, ctx) {
    const draft = curveDrafts.get(ctx.runtime);
    if (!draft?.points.length) return undefined;
    const cursor = { ...gesture.current.point, y: draft.points.at(-1)!.y };
    return polylineSegmentsPreview([...draft.points, cursor], COLOR);
  },
  onClick(ctx, sample, params) {
    const draft = curveDrafts.get(ctx.runtime) ?? { points: [] };
    const point = draft.points.length === 0 ? slopeControlPoint(ctx, sample) : { ...sample.point, y: draft.points[0]!.y };
    const last = draft.points.at(-1);
    if (last && draft.points.length >= 2 && Math.hypot(point.x - last.x, point.z - last.z) < 0.25) {
      finishCurve(ctx, params);
      return;
    }
    if (last && Math.hypot(point.x - last.x, point.z - last.z) < 0.1) return;
    draft.points.push(point);
    draft.last = sample;
    curveDrafts.set(ctx.runtime, draft);
    ctx.reportFeedback({ tone: "info", message: "Clique para continuar a curva. Clique de novo no último ponto, ou Enter, para terminar." });
  },
  onKeyDown(ctx, key, params) {
    const draft = curveDrafts.get(ctx.runtime);
    if (!draft?.points.length) return false;
    if (key === "Enter") { finishCurve(ctx, params); return true; }
    if (key === "Backspace") {
      draft.points.pop();
      if (draft.points.length === 0) curveDrafts.delete(ctx.runtime);
      return true;
    }
    return false;
  },
  onCancel(ctx) { curveDrafts.delete(ctx.runtime); },
};

/** Edits an existing curved ramp by its spine points, as the spiral and the road are edited. */
export const slopeCurveTool = withSpineEditing(rawSlopeCurveTool, {
  ownsSpine: ownsSlope,
  drafting: (ctx) => (curveDrafts.get(ctx.runtime)?.points.length ?? 0) > 0,
});
