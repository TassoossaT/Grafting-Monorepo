import { createPathBrushEffect, pathFormationFor, pathHalfWidth, DEFAULT_TOOL_PARAMS, PATH_MAX_GRADE, PATH_SURFACE_TYPE } from "../../../../features/edit-construction/index.ts";
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

/**
 * The straight span from `from` toward `to`, held to the road's grade in
 * Rust: where the climb is too steep, it stops short, at the height it can
 * reach -- `end` says where.
 */
function span(ctx: ToolContext, from: ConstructionPosition, to: ConstructionPosition): { readonly curves: readonly CubicBezier[]; readonly end: ConstructionPosition } {
  const [result] = ctx.runtime.curveBatch({ tolerance: 0.025, commands: [{ kind: "interpretStroke", points: [xyz(from), xyz(to)], correction: 0, curved: false, maxGrade: PATH_MAX_GRADE }] });
  const last = result!.curves.at(-1)?.points[3];
  // Nothing to lay -- straight up, say, which no grade climbs: it ends where it began.
  return { curves: result!.curves, end: last ? { x: last[0], y: last[1], z: last[2] } : from };
}

function clearSpan(ctx: ToolContext): void {
  ctx.runtime.clearPreview(CHANNEL);
  ctx.runtime.clearPreview("road-draft-spine");
}

function showSpan(ctx: ToolContext, from: ConstructionPosition, to: ConstructionPosition | undefined, params: PathBrushParams): ConstructionPosition | undefined {
  const halfWidth = pathHalfWidth(params);
  try {
    const drawn = to ? span(ctx, from, to) : { curves: [], end: undefined };
    const anchors = drawn.end ? [from, drawn.end] : [from];
    showRoadSpinePreview(ctx, drawn.curves, "road-draft-spine");
    const ribbons = ctx.runtime.curveBatch({ tolerance: 0.025, commands: drawn.curves.map((curve) => ({ kind: "ribbon" as const, curve, offsets: [-halfWidth, halfWidth] as const })) });
    ctx.runtime.showPreview(createRoadMeshPreview({ anchors, bedWidth: halfWidth * 2, ribbons }), CHANNEL);
    return drawn.end;
  } catch {
    // An invalid span is shown, never laid; the click validates again.
    const points = to ? [from, to] : [from];
    ctx.runtime.clearPreview("road-draft-spine");
    ctx.runtime.showPreview(createRoadMeshPreview({ anchors: points, bedWidth: halfWidth * 2, fallbackPoints: points, color: ROAD_ERROR_COLOR, opacity: ROAD_ERROR_OPACITY }), CHANNEL);
    return undefined;
  }
}

function commitSpan(ctx: ToolContext, from: ConstructionPosition, to: ConstructionPosition, params: PathBrushParams): ConstructionPosition | undefined {
  try {
    const drawn = span(ctx, from, to);
    if (drawn.curves.length === 0) return undefined;
    const operationId = scopedToolId(ctx, "road-span", ctx.nextSequence());
    const effect = createPathBrushEffect({
      brushShape: { kind: "circle", radius: 0.025 }, brushRegion: { samples: [from, drawn.end] },
      authoredCurves: drawn.curves, curveMode: "automatic", parameters: pathFormationFor(params),
    }, { operationId, tableId: ctx.tableId, initiatedBy: "road-span" });
    return commitPathCloudIntent(ctx, effect, 0.025) ? drawn.end : undefined;
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
