import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { WallParams } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import { segmentBetween } from "../shapes/preview-shapes.ts";
import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "../core/tool-context.ts";
import { WALL_COLOR, commitWallContour, pinnedToBaseline } from "./wall-shared.ts";

/**
 * The pressed drag's own anchor, or `undefined` before a press. Cleared the
 * instant a line commits on release -- a line is always exactly one
 * press-drag-release, never a chain: the release point is never reused as
 * the next press's anchor, so the next press after a commit is always a
 * fresh, unrelated line's own first point.
 */
let anchor: ConstructionPosition | undefined;

/**
 * A straight wall drawn by press-drag-release. Wherever the drag wanders,
 * only the press point and the release point reach the graph: one exact
 * straight contour edge between them. That correction is this tool's entire
 * reason to exist, distinct from the free brush, whose own correction is a
 * fit with a tolerance rather than a guarantee.
 *
 * Beyond that it is the same wall as every other: the same contour commit,
 * the same column resolution, the same shared edges. A run drawn here welds
 * onto a free stroke, or onto another straight run, by resolving its corner
 * onto that run's own column -- by connection, not by landing on the same
 * coordinate.
 */
export const wallLineTool: ConstructionTool<"wall-line"> = {
  id: "wall-line",
  defaultParams: () => DEFAULT_TOOL_PARAMS["wall-line"],

  previewFor(gesture: ToolGesture, params: WallParams) {
    if (anchor === undefined) return undefined;
    return segmentBetween(anchor, gesture.current.point, WALL_COLOR[params.wallType]);
  },

  onPointerDown(_ctx: ToolContext, sample: PointerSample): void {
    anchor = sample.point;
  },

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: WallParams): void {
    if (anchor === undefined) return;
    const end = pinnedToBaseline(anchor, gesture.current.point);
    commitWallContour(ctx, [{ start: anchor, end, geometry: { kind: "line" } }], params, "wall-line");
    anchor = undefined;
  },
};
