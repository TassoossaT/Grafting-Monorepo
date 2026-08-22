import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { TowerStampParams } from "@/features/edit-construction";

import { segmentsPreview } from "../shapes/preview-shapes.ts";
import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "../core/tool-context.ts";
import { circleContour, previewOutline } from "./tower-geometry.ts";
import { WALL_COLOR, commitWallContour } from "../walls/wall-shared.ts";

/** How many straight chords the *preview* ghost's circle outline uses -- a rendering-only approximation, never fed to the engine, whose committed geometry is true circular arcs. */
const PREVIEW_SEGMENTS = 24;

/**
 * One click stamps a closed circular wall run at a known radius (one of
 * `TOWER_RADIUS_PRESETS`, never a freehand drag).
 *
 * A tower is not its own kind of structure and has no code of its own: it is
 * the ordinary wall type, committed through the ordinary wall builder, from
 * a contour a preset happened to compute instead of a hand drawing it. That
 * is the entire difference -- so a tower welds onto a drawn wall, gets
 * edited by the same handles, and is subject to the same rules, for free.
 */
export const towerStampTool: ConstructionTool<"tower-stamp"> = {
  id: "tower-stamp",
  defaultParams: () => DEFAULT_TOOL_PARAMS["tower-stamp"],

  previewFor(gesture: ToolGesture, params: TowerStampParams) {
    return segmentsPreview(
      previewOutline(gesture.current.point, params.radius, PREVIEW_SEGMENTS),
      WALL_COLOR[params.wallType],
    );
  },

  onClick(ctx: ToolContext, sample: PointerSample, params: TowerStampParams): void {
    commitWallContour(ctx, circleContour(sample.point, params.radius), params, "tower-stamp");
  },
};
