import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { WallBrushParams } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { WALL_COLOR, WALL_HEIGHT, idPrefixFor, pinnedToBaseline } from "./wall-shared.ts";

/**
 * The pending first click of the current two-click line, or `undefined`
 * before it. Cleared the instant a line commits -- a line is always exactly
 * two clicks, never a chain: the second click's own point is never reused
 * as a third click's anchor, so the next click after a commit is always a
 * fresh, unrelated line's own first point.
 */
let anchor: ConstructionPosition | undefined;

/**
 * Click-to-click straight walls, always exactly two clicks per line: the
 * first click plants `anchor`, the second draws one exact straight segment
 * from `anchor` to itself and commits immediately, then clears `anchor` --
 * the third click starts an unrelated new line, not a continuation. The
 * precise counterpart to `wall-brush-tool.ts`'s free-form drag, sharing its
 * same wall height/color/id-prefix (`wall-shared.ts`) so a straight run
 * welds onto a free-form stroke (or another straight run) wherever their
 * corners happen to coincide -- welding is still automatic by position,
 * this tool just never *assumes* the next line continues from the last.
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

    anchor = undefined;
  },
};
