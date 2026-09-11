import {
  createPathBrushEffect,
  DEFAULT_TOOL_PARAMS,
  offsetBands,
  pathFormationFor,
  pathHalfWidth,
} from "@/features/edit-construction";
import type { PathBrushParams } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext, type ToolGesture } from "../core/tool-context.ts";
import { polylineSegmentsPreview } from "../shapes/preview-shapes.ts";
import { commitPathCloudIntent } from "../../path/path-cloud-transaction.ts";
import { PATH_COLOR } from "./path-brush-tool.ts";

/**
 * Shortest span worth committing, in world units. Below this the two clicks
 * are the same click: committing would hand the engine a spine with no
 * extent, and the run it produced would have no direction to be offset
 * along.
 *
 * It doubles as the gesture that ends a chain. Clicking the anchor again is
 * the one click that unambiguously means "no further", costs no modifier
 * key, and is what a double-click already does on its own -- the second
 * press lands on the point the first just committed to.
 */
const MINIMUM_SPAN = 0.25;

/**
 * How far from a standing road an endpoint still counts as meeting it.
 *
 * Deliberately not the brush radius. A painted road's snap reach is the
 * width of the thing that painted it, because the stroke's own uncertainty
 * is that wide; a clicked endpoint carries no such uncertainty, so the
 * question is only "did the user mean this junction", and half a metre is
 * the answer at any road width.
 */
const SNAP_REACH = 0.5;

/** How closely the committed spine must follow the authored line. Straight spans need almost nothing. */
const TOLERANCE = 0.025;

/**
 * Where the next span starts, or `undefined` between chains.
 *
 * Module-level for the same reason `wall-line-tool.ts`'s anchor is: a tool
 * is a singleton the dispatcher looks up per event, and it holds no
 * instance of its own to keep this on.
 */
let anchor: ConstructionPosition | undefined;

function xzDistance(a: ConstructionPosition, b: ConstructionPosition): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * The outline of the road the pending span would lay down -- the real band,
 * mitred the way the contour will mitre it, not a centreline hint.
 *
 * The preview is a promise about what the click produces, so it is built
 * from the same offsetting the commit runs. What it deliberately cannot
 * show is the rounding a weld will apply at the far end, since that is
 * decided by geometry that does not exist until the span is committed; the
 * span itself lands exactly here.
 */
function spanPreview(from: ConstructionPosition, to: ConstructionPosition, params: PathBrushParams) {
  const half = pathHalfWidth(params);
  const [ribbon] = offsetBands([from, to], [-half, half], params.miterLimit);
  if (ribbon === undefined) return undefined;
  return polylineSegmentsPreview([...ribbon.outer, ribbon.outer[0]!], PATH_COLOR);
}

/**
 * A road drawn click by click: press once for the origin, once for each
 * turn, and again on the last point to finish.
 *
 * **Why this exists next to the brush.** A painted road's shape is a
 * *fitting artifact* -- the stroke is a gesture, and curve fitting decides
 * from it how many anchors the run deserves and where they sit, so the road
 * that reaches the graph is the fit's reading of the hand rather than the
 * hand. Here the anchors are the clicks. Nothing is inferred, so nothing can
 * be inferred wrongly, and the same two clicks produce the same road every
 * time.
 *
 * **Why each click commits.** The alternative is accumulating a whole chain
 * and committing it at the end, which makes the work per gesture depend on
 * how long the chain got. Committing per span keeps the change set at one
 * edge, plus whatever it welds onto -- bounded by construction rather than
 * by a budget someone has to tune, which is the whole cost argument for
 * drawing this way.
 *
 * **What makes the corner smooth.** Nothing here. Each span is authored
 * straight, and `curveNetwork`'s own weld smoothing gives the two spans
 * meeting at a turn a shared tangent, exactly as it does for two separate
 * strokes. An L drawn with three clicks and an L drawn as one gesture round
 * the same way because they end up in the same code.
 *
 * Junctions are likewise not this tool's business: an endpoint landing on a
 * standing road is snapped, and split into a T, by the same network plan any
 * other road goes through.
 */
export const pathLineTool: ConstructionTool<"path-line"> = {
  id: "path-line",
  defaultParams: () => DEFAULT_TOOL_PARAMS["path-line"],
  previewOnHover: true,

  previewFor(gesture: ToolGesture, params: PathBrushParams) {
    if (anchor === undefined) return undefined;
    return spanPreview(anchor, gesture.current.point, params);
  },

  onClick(ctx: ToolContext, sample: PointerSample, params: PathBrushParams): void {
    if (anchor === undefined) {
      anchor = sample.point;
      ctx.reportFeedback({ tone: "info", message: "Início da rua definido. Clique no destino; clique de novo no mesmo ponto para encerrar." });
      return;
    }
    if (xzDistance(anchor, sample.point) < MINIMUM_SPAN) {
      anchor = undefined;
      ctx.reportFeedback({ tone: "info", message: "Rua encerrada." });
      return;
    }

    const operationId = scopedToolId(ctx, "path-line", ctx.nextSequence());
    const effect = createPathBrushEffect(
      {
        // The reach a *snap* is decided at, which is all the shape is used
        // for here: no brush swept this road, so there is no painted area
        // for one to describe.
        brushShape: { kind: "circle", radius: SNAP_REACH },
        brushRegion: { samples: [anchor, sample.point] },
        referenceLine: "authored",
        parameters: pathFormationFor(params),
      },
      { operationId, tableId: ctx.tableId, initiatedBy: "path-line" },
    );
    // The chain carries on from the click either way. A refusal has already
    // been reported by name, and dropping the anchor on top of it would make
    // the user re-place a start they never moved.
    commitPathCloudIntent(ctx, effect, TOLERANCE);
    anchor = sample.point;
  },

  onCancel(): void {
    anchor = undefined;
  },
};
