import { createPathBrushEffect, pathFormationFor, pathHalfWidth, DEFAULT_TOOL_PARAMS, PATH_SURFACE_TYPE } from "../../../../features/edit-construction/index.ts";
import type { PathBrushParams } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition, CubicBezier } from "../../../../ports/index.ts";
import { commitPathCloudIntent } from "../../path/path-cloud-transaction.ts";
import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import { withSpineEditing } from "../core/spine-edit-behavior.ts";
import { createSpineSketchTool } from "../core/spine-sketch.ts";
import { pathStroke } from "./path-stroke-tool.ts";
import { roadAnchorSnap, showRoadSnap } from "./road-body-target.ts";
import { createRoadMeshPreview, showRoadSpinePreview, ROAD_ERROR_COLOR, ROAD_ERROR_OPACITY } from "./road-preview-mesh.ts";

const CHANNEL = "road-span";
const xyz = (p: ConstructionPosition) => [p.x, p.y, p.z] as const;
const isPath = (surfaceType: string) => surfaceType === PATH_SURFACE_TYPE;

function curves(ctx: ToolContext, points: readonly ConstructionPosition[]): readonly CubicBezier[] {
  return ctx.runtime.curveBatch({ tolerance: 0.025, commands: [{ kind: "automatic", points: points.map(xyz) }] })[0]!.curves;
}

function clearSpan(ctx: ToolContext): void {
  ctx.runtime.clearPreview(CHANNEL);
  ctx.runtime.clearPreview("road-draft-spine");
}

function showSpan(ctx: ToolContext, from: ConstructionPosition, to: ConstructionPosition | undefined, params: PathBrushParams): void {
  const points = to ? [from, to] : [from];
  const halfWidth = pathHalfWidth(params);
  const options = { anchors: points, bedWidth: halfWidth * 2 };
  try {
    const authored = points.length < 2 ? [] : curves(ctx, points);
    showRoadSpinePreview(ctx, authored, "road-draft-spine");
    const ribbons = ctx.runtime.curveBatch({ tolerance: 0.025, commands: authored.map((curve) => ({ kind: "ribbon" as const, curve, offsets: [-halfWidth, halfWidth] as const })) });
    ctx.runtime.showPreview(createRoadMeshPreview({ ...options, ribbons }), CHANNEL);
  } catch {
    // An invalid span is shown, never laid; the click validates again.
    ctx.runtime.clearPreview("road-draft-spine");
    ctx.runtime.showPreview(createRoadMeshPreview({ ...options, fallbackPoints: points, color: ROAD_ERROR_COLOR, opacity: ROAD_ERROR_OPACITY }), CHANNEL);
  }
}

function commitSpan(ctx: ToolContext, from: ConstructionPosition, to: ConstructionPosition, params: PathBrushParams): boolean {
  try {
    const points = [from, to];
    const operationId = scopedToolId(ctx, "road-span", ctx.nextSequence());
    const effect = createPathBrushEffect({
      brushShape: { kind: "circle", radius: 0.025 }, brushRegion: { samples: points },
      authoredCurves: curves(ctx, points), curveMode: "automatic", parameters: pathFormationFor(params),
    }, { operationId, tableId: ctx.tableId, initiatedBy: "road-span" });
    return commitPathCloudIntent(ctx, effect, 0.025);
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: `Trecho não aplicado: ${String(error)}` });
    return false;
  }
}

const sketch = createSpineSketchTool({
  id: "path-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["path-brush"],
  snap: roadAnchorSnap,
  showSpan,
  clearSpan,
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
  ownsSpine: isPath,
  snap: roadAnchorSnap,
  panelActions: false,
  drafting: sketch.drafting,
});
