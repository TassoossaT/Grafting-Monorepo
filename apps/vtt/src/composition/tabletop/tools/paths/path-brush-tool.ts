import {
  createPathBrushEffect,
  DEFAULT_TOOL_PARAMS,
  pathFormationFor,
  pathHalfWidth,
} from "@/features/edit-construction";

import { createBrushTool } from "../core/brush-tool.ts";
import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import type { PathBrushParams } from "@/features/edit-construction";
import { PATH_COLOR, applyPathBrushEffect } from "../../path/path-effect-executor.ts";

/**
 * A free path stroke, built on the same brush every other brush uses: press,
 * drag, and on release the whole swept region is handed over once.
 *
 * Path creation follows the same ownership split as walls: this tool only
 * chooses the interaction and emits a `PathBrushEffect`. The path effect
 * executor owns the single commit every path goes through;
 * `spine-contour/` derives the contour from the spine and declares the
 * graph, while Rust executes the resolved overlay without ever being told
 * any of it is a path.
 */
export const pathBrushTool = createBrushTool<"path-brush">({
  id: "path-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["path-brush"],
  previewColor: () => PATH_COLOR,
  // Bed plus shoulders: the road occupies this much of the brush, and only
  // what is left over may be spent straightening the stroke.
  halfWidth: pathHalfWidth,

  applyRegion(region: BrushRegion, ctx: ToolContext, params: PathBrushParams): void {
    const operationId = scopedToolId(ctx, "path-brush", ctx.nextSequence());
    const effect = createPathBrushEffect(
      {
        brushShape: region.shape,
        brushRegion: { samples: region.samples },
        observedElements: region.observations,
        parameters: pathFormationFor(params),
      },
      { operationId, tableId: ctx.tableId, initiatedBy: "path-brush" },
    );
    applyPathBrushEffect(ctx, effect, region.tolerance);
  },
});
