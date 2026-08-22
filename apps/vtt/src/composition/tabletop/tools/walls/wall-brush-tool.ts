import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { WallBrushParams } from "@/features/edit-construction";

import { brushReach, createBrushTool, type BrushRegion } from "../core/brush-tool.ts";
import type { ToolContext } from "../core/tool-context.ts";
import { WALL_COLOR, commitWallStroke } from "./wall-shared.ts";

/**
 * A free wall stroke, built on the same brush every other brush uses: press,
 * drag, and on release the whole swept region is handed over once. Nothing
 * is committed mid-drag and nothing is resent per tick -- what the pointer
 * traced is corrected into contour edges and declared as one patch.
 *
 * The brush footprint is the correction dial rather than a footprint to
 * paint. Its reach is fed straight to the fitter as tolerance: at radius 0
 * the drawn contour is committed literally, and the wider the brush the more
 * freely a shaky stroke is straightened into clean runs and true arcs. That
 * is why a wall brush is meant to be a small circle -- it is not covering
 * ground, it is saying how literally to take the hand.
 *
 * Everything a wall is lives in TypeScript from here down (`wall-shared.ts`,
 * `wall-patch.ts`): corners resolve to columns, columns share edges, and the
 * engine is handed nodes, edges and faces without ever being told they are a
 * wall.
 */
export const wallBrushTool = createBrushTool<"wall-brush">({
  id: "wall-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["wall-brush"],
  previewColor: (params: WallBrushParams) => WALL_COLOR[params.wallType],

  applyRegion(region: BrushRegion, ctx: ToolContext, params: WallBrushParams): void {
    commitWallStroke(ctx, region.samples, brushReach(region.shape), params, "wall-brush");
  },
});
