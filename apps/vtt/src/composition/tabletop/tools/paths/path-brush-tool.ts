import { DEFAULT_TOOL_PARAMS, PATH_SURFACE_TYPE } from "../../../../features/edit-construction/index.ts";
import type { PathBrushParams } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import type { PointerSample, ToolContext } from "../core/tool-context.ts";
import { withSpineEditing } from "../core/spine-edit-behavior.ts";
import { createSpineDraftTool, samePlace, type DraftEnd, type SpineDraftMode } from "../core/spine-draft.ts";
import { pathStroke } from "./path-stroke-tool.ts";
import { roadAnchorSnap, roadSnapIsCurrent, roadSnapTarget, showRoadSnap, type RoadSnapTarget } from "./road-body-target.ts";
import { clearRoadPreview, layRoad, previewRoad, previewRoadError, shapeRoad } from "./road-lay.ts";

const CHANNEL = "road-span";

/** What a road draft keeps between hovers: where the last preview was drawn from and to, so a pointer that has not moved costs nothing. */
interface RoadDraftState {
  hovered?: { readonly origin: DraftEnd; readonly at: ConstructionPosition };
}

/** Where a click lands: on the road it snaps onto, when it does, else where it was made. */
function landing(ctx: ToolContext, sample: PointerSample): DraftEnd {
  const target = roadSnapTarget(ctx, sample);
  return target ? { point: target.point, sample: target, target } : { point: sample.point, sample };
}

/** The waiting origin, and the straight span from it toward `to`; answers where that span ends -- short of `to` when the grade stops it. */
function showSpan(ctx: ToolContext, from: ConstructionPosition, to: ConstructionPosition | undefined, params: PathBrushParams): ConstructionPosition | undefined {
  if (!to) { previewRoad(ctx, [], params, CHANNEL, from); return undefined; }
  try {
    const road = shapeRoad(ctx, [from, to], params, false);
    previewRoad(ctx, road.curves, params, CHANNEL, from);
    return road.end;
  } catch {
    // An invalid span is shown, never laid; the click validates again.
    previewRoadError(ctx, [from, to], params, CHANNEL);
    return undefined;
  }
}

/** A road's one click mode: from the waiting origin, a straight span to the click. */
const span: SpineDraftMode<"path-brush", RoadDraftState> = {
  label: "Trecho",
  needs: 1,
  plan(kit, cursor) {
    const origin = kit.draft.ends[0];
    if (!origin) return undefined;
    const end = landing(kit.ctx, cursor);
    if (samePlace(origin.point, end.point)) return undefined;
    return { kind: "points", points: [origin.point, end.point], ...(end.target ? { joins: end.target } : {}) };
  },
};

const draft = createSpineDraftTool<"path-brush", RoadDraftState>({
  id: "path-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["path-brush"],
  modes: { span },
  modeOf: () => "span",
  begin: () => ({}),
  endAt: (ctx, _state, sample) => landing(ctx, sample),
  holds: (ctx, end) => !end.target || roadSnapIsCurrent(ctx, end.target as RoadSnapTarget),
  preview(kit, current) {
    const state = kit.draft.tool;
    const origin = kit.draft.ends[0]!;
    if (state.hovered?.origin === origin && samePlace(state.hovered.at, current.point)) return undefined;
    state.hovered = { origin, at: current.point };
    const end = landing(kit.ctx, current);
    const reached = showSpan(kit.ctx, origin.point, end.point, kit.params);
    // A target the span cannot reach is not shown as joined.
    showRoadSnap(kit.ctx, end.target && reached && samePlace(reached, end.point) ? end.target : undefined);
    return undefined;
  },
  shown(kit) {
    showRoadSnap(kit.ctx);
    showSpan(kit.ctx, kit.draft.ends.at(-1)!.point, undefined, kit.params);
  },
  cleared(ctx) {
    clearRoadPreview(ctx, CHANNEL);
    showRoadSnap(ctx);
  },
  commit(ctx, finished, params) {
    try {
      if (finished.kind !== "points") return undefined;
      const road = shapeRoad(ctx, finished.points, params, false);
      if (!road.end || !layRoad(ctx, road.curves, params, "road-span", "automatic")) return undefined;
      return { end: road.end, joined: finished.joins !== undefined && samePlace(road.end, finished.joins.point) };
    } catch (error) {
      ctx.reportFeedback({ tone: "error", message: `Trecho não aplicado: ${String(error)}` });
      return undefined;
    }
  },
  chain: true,
  stroke: pathStroke,
});

/**
 * A road is laid by gesture -- a click and a click for a straight span, a
 * drag for a freehand one -- beginning wherever the press lands, a standing
 * road included. It is edited only by its handles; the panel only sets up
 * the next road.
 */
export const pathBrushTool = withSpineEditing({ ...draft, usesRuler: false }, {
  ownsSpine: (surfaceType) => surfaceType === PATH_SURFACE_TYPE,
  snap: roadAnchorSnap,
  panelActions: false,
  drafting: draft.drafting,
});
