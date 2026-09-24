import { DEFAULT_TOOL_PARAMS, hasTrait } from "@/features/edit-construction";
import type { WallBrushParams } from "@/features/edit-construction";

import { createBrushTool, type BrushRegion } from "../core/brush-tool.ts";
import { withStructureEditing } from "../core/structure-edit-behavior.ts";
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
 * freely a shaky stroke is straightened into clean runs and cubic Béziers.
 * That is why a wall brush is meant to be a small circle -- it is not
 * covering ground, it is saying how literally to take the hand.
 *
 * Everything a wall is lives in TypeScript from here down (`wall-shared.ts`,
 * `wall-patch.ts`): corners resolve to columns, columns share edges, and the
 * engine is handed nodes, edges and faces without ever being told they are a
 * wall.
 */
const rawWallBrushTool = createBrushTool<"wall-brush">({
  id: "wall-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["wall-brush"],
  previewColor: (params: WallBrushParams) => WALL_COLOR[params.wallType],
  // A wall is columns and shared edges, with no thickness in plan, so it
  // occupies none of the brush and the whole reach is correction budget.
  halfWidth: () => 0,

  applyRegion(region: BrushRegion, ctx: ToolContext, params: WallBrushParams): void {
    commitWallStroke(ctx, region.samples, region.tolerance, params, "wall-brush");
  },

  // No `previewContour` override: the corrected/fitted result is only
  // decided once, on release. Refitting it every frame while the stroke is
  // still growing let already-drawn stretches change shape retroactively as
  // later samples came in -- an RDP/Bézier fit runs over the whole point
  // list, so one more sample at the end can move where an earlier corner
  // was found. The generic fallback below is the honest preview instead:
  // the literal swept mouse trail, its width the correction/snap budget the
  // eventual fit may spend, exactly what `path-brush` already shows.
});

/** Also grabs and edits an existing wall's own vertex, curve and height-widget handles -- see `structure-edit-behavior.ts`. */
export const wallBrushTool = withStructureEditing(rawWallBrushTool, { ownsType: (surfaceType) => hasTrait(surfaceType, "partition") });
