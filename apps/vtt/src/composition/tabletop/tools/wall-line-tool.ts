import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { WallBrushParams } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { WALL_COLOR, WALL_HEIGHT, idPrefixFor, pinnedToBaseline, resolveWallCrossing } from "./wall-shared.ts";

/**
 * The pressed drag's own anchor, or `undefined` before a press. Cleared the
 * instant a line commits on release -- a line is always exactly one
 * press-drag-release, never a chain: the release point is never reused as
 * the next press's anchor, so the next press after a commit is always a
 * fresh, unrelated line's own first point.
 */
let anchor: ConstructionPosition | undefined;

/**
 * A straight wall drawn by press-drag-release, the same gesture as
 * `wall-brush-tool.ts`'s free-form stroke -- the pointer's own path is
 * followed live for the preview, exactly like the brush -- but wherever the
 * drag wanders, only `anchor` (the press point) and the release point ever
 * reach the graph: one exact straight segment between them, corrected
 * straight regardless of how the mouse wobbled in between. That correction
 * is this tool's entire reason to exist, distinct from the brush, which
 * commits every wobble as its own panel. Shares wall height/color/id-prefix
 * (`wall-shared.ts`) so a straight run welds onto a free-form stroke (or
 * another straight run) wherever their corners happen to coincide -- welding
 * is still automatic by position. Either endpoint landing on the side of an
 * existing wall (not near one of its own corners) splits it and snaps that
 * endpoint onto the split, forming a T-junction -- see `resolveWallCrossing`'s
 * own doc.
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

  onPointerDown(ctx: ToolContext, sample: PointerSample): void {
    anchor = resolveWallCrossing(ctx, sample.point, `${ctx.tableId}:wall-crossing:${ctx.nextSequence()}`);
  },

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: WallBrushParams): void {
    if (anchor === undefined) return;

    const pinned = pinnedToBaseline(anchor, gesture.current.point);
    const end = resolveWallCrossing(ctx, pinned, `${ctx.tableId}:wall-crossing:${ctx.nextSequence()}`);
    const sequence = ctx.nextSequence();
    ctx.runtime.generatePathExtrusion(
      {
        edges: [{ start: anchor, end, curvature: "straight" }],
        height: WALL_HEIGHT,
        idPrefix: idPrefixFor(ctx),
        surfaceType: params.wallType,
      },
      "local",
      `${ctx.tableId}:wall-line:${sequence}`,
    );

    anchor = undefined;
  },
};
