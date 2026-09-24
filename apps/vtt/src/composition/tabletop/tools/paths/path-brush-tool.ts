import {
  createPathBrushEffect,
  DEFAULT_TOOL_PARAMS,
  PATH_SURFACE_TYPE,
  pathFormationFor,
  pathHalfWidth,
} from "@/features/edit-construction";

import { createBrushTool, type BrushRegion } from "../core/brush-tool.ts";
import { withStructureEditing } from "../core/structure-edit-behavior.ts";
import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import type { PathBrushParams } from "@/features/edit-construction";
import { commitPathCloudIntent } from "../../path/path-cloud-transaction.ts";

const PATH_COLOR = 0xc084fc;

/**
 * A free path stroke, built on the same brush every other brush uses: press,
 * drag, and on release the whole swept region is handed over once.
 *
 * Path creation follows the same ownership split as walls: this tool only
 * chooses the interaction and emits a `PathBrushEffect`. The PathCloud owns
 * the resulting graph and contour plan; the composition boundary commits its
 * generic transaction without interpreting path topology.
 */
const rawPathBrushTool = createBrushTool<"path-brush">({
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
    commitPathCloudIntent(ctx, effect, region.tolerance);
  },
});

/** Also grabs and edits an existing path's own vertex and curve handles -- see `structure-edit-behavior.ts`. */
export const pathBrushTool = withStructureEditing(rawPathBrushTool, { ownsType: (surfaceType) => surfaceType === PATH_SURFACE_TYPE });
