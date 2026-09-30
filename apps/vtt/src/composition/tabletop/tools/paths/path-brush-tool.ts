import { DEFAULT_TOOL_PARAMS, PATH_SURFACE_TYPE } from "../../../../features/edit-construction/index.ts";
import type { PathBrushParams } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import type { ToolContext } from "../core/tool-context.ts";
import { withSpineEditing } from "../core/spine-edit-behavior.ts";
import { createSpineSketchTool } from "../core/spine-sketch.ts";
import { pathStroke } from "./path-stroke-tool.ts";
import { roadAnchorSnap, showRoadSnap } from "./road-body-target.ts";
import { clearRoadPreview, layRoad, previewRoad, previewRoadError, shapeRoad } from "./road-lay.ts";

const CHANNEL = "road-span";

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

/** Lays the straight span from `from` toward `to`, answering where it ended; undefined when nothing was laid. */
function commitSpan(ctx: ToolContext, from: ConstructionPosition, to: ConstructionPosition, params: PathBrushParams): ConstructionPosition | undefined {
  try {
    const road = shapeRoad(ctx, [from, to], params, false);
    return layRoad(ctx, road.curves, params, "road-span", "automatic") ? road.end : undefined;
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: `Trecho não aplicado: ${String(error)}` });
    return undefined;
  }
}

const sketch = createSpineSketchTool({
  id: "path-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["path-brush"],
  snap: roadAnchorSnap,
  showSpan,
  clearSpan: (ctx) => clearRoadPreview(ctx, CHANNEL),
  commitSpan,
  stroke: pathStroke,
});

/**
 * A road is laid by gesture -- a click and a click for a straight span, a
 * drag for a freehand one -- beginning wherever the press lands, a standing
 * road included. It is edited only by its handles; the panel only sets up
 * the next road.
 */
export const pathBrushTool = withSpineEditing({
  ...sketch,
  useGridSnap: false,
  onCancel(ctx) { sketch.onCancel?.(ctx); showRoadSnap(ctx); },
}, {
  ownsSpine: (surfaceType) => surfaceType === PATH_SURFACE_TYPE,
  snap: roadAnchorSnap,
  panelActions: false,
  drafting: sketch.drafting,
});
