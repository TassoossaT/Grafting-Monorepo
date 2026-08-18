import { createPathBrushEffect, DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { PathBrushParams } from "@/features/edit-construction";

import type { ConstructionTool, ToolContext, ToolGesture } from "./tool-context.ts";
import { circleOutline } from "./preview-shapes.ts";

const PATH_PREVIEW_COLOR = 0xc084fc;

/**
 * One confirmed circular footprint becomes exactly one semantic PathBrushEffect.
 * The current Rust transformer intentionally accepts a single footprint; a
 * swept multi-sample path remains unavailable until that domain capability lands.
 */
export const pathBrushTool: ConstructionTool<"path-brush"> = {
  id: "path-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["path-brush"],

  previewFor(gesture: ToolGesture, params: PathBrushParams) {
    return circleOutline(gesture.current.point, params.radius, PATH_PREVIEW_COLOR, 0.75);
  },

  onClick(ctx: ToolContext, sample, params: PathBrushParams): void {
    const sequence = ctx.nextSequence();
    const effect = createPathBrushEffect(
      {
        brushShape: { kind: "circle", radius: params.radius },
        brushRegion: { samples: [sample.point] },
        parameters: { width: params.radius * 2, depth: params.depth, falloff: 1, strength: 1 },
      },
      { operationId: `${ctx.tableId}:path-brush:${sequence}`, tableId: ctx.tableId, initiatedBy: "local" },
    );
    ctx.runtime.applyPathBrush(effect, "local");
  },
};