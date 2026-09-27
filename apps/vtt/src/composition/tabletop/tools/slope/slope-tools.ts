import { DEFAULT_TOOL_PARAMS, hasTrait, RAMP_SURFACE_TYPE, SLOPE_SURFACE_TYPE } from "../../../../features/edit-construction/index.ts";
import type { ToolParamsByTool } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import type { ConstructionTool, PointerSample, ToolContext } from "../core/tool-context.ts";
import { withStructureEditing } from "../core/structure-edit-behavior.ts";
import { withSpineEditing } from "../core/spine-edit-behavior.ts";
import { appendNodeDisk, PREVIEW_ELEVATION } from "../shapes/ribbon-mesh-preview.ts";
import type { RampCorners } from "../../../../features/edit-construction/index.ts";
import { commitPlatformSlope } from "./slope-commit.ts";
import { createCurveDraftTool, type FinishedCurveDraft } from "../core/curve-draft.ts";
import { commitStraightRamp, plannedRamp, straightRampPoints } from "./ramp-commit.ts";

const ownsSlope = (surfaceType: string) => surfaceType === SLOPE_SURFACE_TYPE;
const ownsRamp = (surfaceType: string) => surfaceType === RAMP_SURFACE_TYPE;

const COLOR = 0x79b8e8;
/** Radius of the mark on a corner that will be welded. */
const WELD_MARK = 0.18;
const READOUT_INTERVAL_MS = 150;
let lastReadout = 0;

/** A flat four-cornered face, as two triangles, just above what it previews. */
function appendQuad(positions: number[], indices: number[], quad: readonly ConstructionPosition[]): void {
  const base = positions.length / 3;
  for (const p of quad) positions.push(p.x, p.y + PREVIEW_ELEVATION, p.z);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Length, rise, grade and welds of the ramp being drawn, at most every few frames. */
function reportRampReadout(ctx: ToolContext, corners: RampCorners, welds: number): void {
  const now = Date.now();
  if (now - lastReadout < READOUT_INTERVAL_MS) return;
  lastReadout = now;
  const mid = (a: ConstructionPosition, b: ConstructionPosition) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
  const from = mid(corners.bottom.min, corners.bottom.max), to = mid(corners.top.min, corners.top.max);
  const run = Math.hypot(to.x - from.x, to.z - from.z), rise = to.y - from.y;
  const grade = run > 0 ? ((Math.abs(rise) / run) * 100).toFixed(0) : "0";
  ctx.reportFeedback({ tone: "info", message: `comprimento ${run.toFixed(1)} m · subida ${rise.toFixed(2)} m · inclinação ${grade}% · ${welds} ponta(s) encaixada(s)` });
}

/**
 * Two structures with two different truths. A straight ramp is a trapezoid
 * edited by its corners, sides and ends; a spiral is a sloped-platform spine
 * edited by its control points and handles, and is what a ramp with curves
 * is drawn as.
 */

/** Drag from the start to the end; the ramp climbs the fixed rise. */
/** A straight ramp being drawn by clicks: where it starts, and a rise set with Shift. */
interface RampDraft {
  readonly start: PointerSample;
  rise?: number;
  shift?: { readonly screenY: number; readonly base: number };
}
const rampDrafts = new WeakMap<ToolContext["runtime"], RampDraft>();

/** The rise a Shift drag has set -- steps of a quarter, 40 screen pixels a unit -- or the tool's own. */
function draftRise(draft: RampDraft, current: PointerSample, params: { readonly rise: number }): number {
  if (current.shiftKey && current.screenY !== undefined) {
    draft.shift ??= { screenY: current.screenY, base: draft.rise ?? params.rise };
    draft.rise = draft.shift.base + Math.round((draft.shift.screenY - current.screenY) / 40 / 0.25) * 0.25;
  } else {
    draft.shift = undefined;
  }
  return draft.rise ?? params.rise;
}

const rawSlopeRampTool: ConstructionTool<"slope-ramp"> = {
  id: "slope-ramp",
  previewOnHover: true,
  defaultParams: () => DEFAULT_TOOL_PARAMS["slope-ramp"],
  previewFor(gesture, toolParams, ctx) {
    // Drawn by clicks: from the start clicked to the pointer.
    const draft = rampDrafts.get(ctx.runtime);
    const params = draft ? { ...toolParams, rise: draftRise(draft, gesture.current, toolParams) } : toolParams;
    const from = draft?.start ?? gesture.start;
    // Nothing stands at the pointer before a ramp is begun, as with a floor: it is built out as it is drawn.
    if (Math.hypot(gesture.current.point.x - from.point.x, gesture.current.point.z - from.point.z) < 0.05) return undefined;
    try {
      const { corners, welds, joints } = plannedRamp(ctx, from, gesture.current, params);
      const positions: number[] = [], indices: number[] = [];
      appendQuad(positions, indices, [corners.bottom.min, corners.bottom.max, corners.top.max, corners.top.min]);
      // A disk at each corner of an end that will be welded into a floor.
      // ... and at each corner of an end that runs on from another structure's end.
      for (const weld of [...welds, ...joints]) {
        const end = corners[weld.end];
        appendNodeDisk(positions, indices, end.min, WELD_MARK);
        appendNodeDisk(positions, indices, end.max, WELD_MARK);
      }
      reportRampReadout(ctx, corners, welds.length + joints.length);
      return { kind: "mesh", positions: Float32Array.from(positions), indices: Uint32Array.from(indices), color: COLOR, opacity: 0.55 };
    } catch {
      return undefined;
    }
  },
  onClick(ctx, sample, params) {
    const draft = rampDrafts.get(ctx.runtime);
    if (!draft) {
      rampDrafts.set(ctx.runtime, { start: sample });
      ctx.reportFeedback({ tone: "info", message: "Clique o fim da rampa (Shift e o mouse na vertical ajustam a subida; Esc cancela)." });
      return;
    }
    rampDrafts.delete(ctx.runtime);
    const [from, to] = straightRampPoints(ctx, draft.start, sample, { ...params, rise: draft.rise ?? params.rise });
    if (Math.hypot(to.x - from.x, to.z - from.z) < 0.5) {
      ctx.reportFeedback({ tone: "error", message: "Clique mais longe do início para desenhar a rampa." });
      return;
    }
    commitStraightRamp(ctx, draft.start, sample, { ...params, rise: draft.rise ?? params.rise });
  },
  onCancel(ctx) {
    rampDrafts.delete(ctx.runtime);
  },
  onPointerUp(ctx, gesture, params) {
    // A press without a drag is a click: `onClick` draws by clicks.
    if (gesture.samples.length < 2 || gesture.moved === false || rampDrafts.has(ctx.runtime)) return;
    const [from, to] = straightRampPoints(ctx, gesture.start, gesture.current, params);
    if (Math.hypot(to.x - from.x, to.z - from.z) < 0.5) {
      ctx.reportFeedback({ tone: "error", message: "Arraste mais longe para desenhar a rampa." });
      return;
    }
    commitStraightRamp(ctx, gesture.start, gesture.current, params);
  },
};

/** Also edits an existing ramp by its handles -- see `structure-edit-behavior.ts`; a press on the ramp itself builds against it. */
export const slopeRampTool = withStructureEditing(rawSlopeRampTool, { ownsType: ownsRamp, drafting: (ctx) => rampDrafts.has(ctx.runtime), handlesOnly: true });

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

/**
 * Also edits an existing spiral by its spine points, exactly as a road is
 * edited -- see `spine-edit-behavior.ts` -- and as a whole by its handles.
 */
export const slopeSpiralTool = withSpineEditing(rawSlopeSpiralTool, { ownsSpine: ownsSlope, drafting: rawSlopeSpiralTool.drafting, handlesOnly: true });

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

/** Edits an existing curved ramp by its spine points, as the spiral and the road are edited, and as a whole by its handles. */
export const slopeCurveTool = withSpineEditing(rawSlopeCurveTool, { ownsSpine: ownsSlope, drafting: rawSlopeCurveTool.drafting, handlesOnly: true });
