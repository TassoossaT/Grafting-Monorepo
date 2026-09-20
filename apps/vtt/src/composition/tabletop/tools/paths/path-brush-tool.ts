import {
  createPathBrushEffect,
  DEFAULT_TOOL_PARAMS,
  pathFormationFor,
  pathHalfWidth,
} from "@/features/edit-construction";

import { createBrushTool, type BrushRegion } from "../core/brush-tool.ts";
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
const freehandTool = createBrushTool<"path-brush">({
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

import { pathPenTool } from "./path-pen-tool.ts";
import type { ConstructionTool } from "../core/tool-context.ts";
const implementation = (params: PathBrushParams) => params.creationMode === "pen" ? pathPenTool : freehandTool;

/** Both authoring gestures use the same path recipe and transaction pipeline. */
export const pathBrushTool: ConstructionTool<"path-brush"> = {
  id: "path-brush", defaultParams: freehandTool.defaultParams, previewOnHover: (params) => params.creationMode === "pen",
  previewFor(gesture, params, ctx) {
    return implementation(params).previewFor?.(gesture, params, ctx);
  },
  onPointerDown(ctx, sample, params) { implementation(params).onPointerDown?.(ctx, sample, params); },
  onPointerMove(ctx, gesture, params) { implementation(params).onPointerMove?.(ctx, gesture, params); },
  onPointerUp(ctx, gesture, params) { implementation(params).onPointerUp?.(ctx, gesture, params); },
  onKeyDown(ctx, key, params) { return implementation(params).onKeyDown?.(ctx, key, params) ?? false; },
  onCancel(ctx) { pathPenTool.onCancel?.(ctx); },
};
