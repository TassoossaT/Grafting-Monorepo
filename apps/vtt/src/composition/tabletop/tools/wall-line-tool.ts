import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { WallBrushParams } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { WALL_COLOR, WALL_HEIGHT, idPrefixFor, pinnedToBaseline } from "./wall-shared.ts";

/**
 * The chain's own pending anchor -- the previous click's (already
 * baseline-pinned) point, or `undefined` before the first click of a new
 * chain. Lives only across clicks of the same unbroken chain; switching
 * tools and back starts a wholly new one.
 */
let anchor: ConstructionPosition | undefined;

/**
 * Click-to-click straight walls: the first click of a chain only plants
 * `anchor`, every click after that draws one exact straight segment from
 * `anchor` to the new click and commits it immediately -- no drag, no
 * accumulated-and-resent path (unlike `wall-brush-tool.ts`, one commit is
 * exactly one segment, since there is never more than one edge in flight).
 * The click just placed becomes the next segment's own anchor, so repeated
 * clicks keep chaining into a connected polyline of exact straight runs --
 * the precise counterpart to `wall-brush-tool.ts`'s free-form drag, sharing
 * its same wall height/color/id-prefix (`wall-shared.ts`) so a straight run
 * welds onto a free-form stroke wherever their corners coincide.
 */
export const wallLineTool: ConstructionTool<"wall-line"> = {
  id: "wall-line",
  defaultParams: () => DEFAULT_TOOL_PARAMS["wall-line"],

  previewFor(gesture: ToolGesture, params: WallBrushParams) {
    if (anchor === undefined) return undefined;
    return {
      kind: "segments",
      color: WALL_COLOR[params.wallType],
      opacity: 0.7,
      positions: Float32Array.from([
        anchor.x, anchor.y, anchor.z,
        gesture.current.point.x, gesture.current.point.y, gesture.current.point.z,
      ]),
    };
  },

  onClick(ctx: ToolContext, sample: PointerSample, params: WallBrushParams): void {
    if (anchor === undefined) {
      anchor = sample.point;
      return;
    }

    const end = pinnedToBaseline(anchor, sample.point);
    const sequence = ctx.nextSequence();
    ctx.runtime.generatePathExtrusion(
      {
        edges: [{ start: anchor, end, curvature: "straight" }],
        height: WALL_HEIGHT,
        arcFacets: 1,
        idPrefix: idPrefixFor(ctx),
        surfaceType: params.wallType,
      },
      "local",
      `${ctx.tableId}:wall-line:${sequence}`,
    );

    anchor = end;
  },
};
