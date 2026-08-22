import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { TowerStampParams } from "@/features/edit-construction";

import { segmentsPreview } from "../shapes/preview-shapes.ts";
import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext, type ToolGesture } from "../core/tool-context.ts";
import { circleEdges, previewOutline } from "./tower-geometry.ts";
import { WALL_COLOR, WALL_HEIGHT, idPrefixFor } from "../walls/wall-shared.ts";

/** How many straight chords the *preview* ghost's circle outline uses -- a rendering-only approximation, never fed to the engine (the committed geometry is 4 true circular arcs, not a facetted polygon). */
const PREVIEW_SEGMENTS = 24;

/**
 * One click stamps a closed circular wall footprint at a known radius (one
 * of {@link TOWER_RADIUS_PRESETS}, never a freehand drag) -- the "buildings
 * get known geometry" half of the owner's own split between this and the
 * free-form brush's own curve-fitting (`wall-brush-tool.ts`,
 * `path-fitting.ts`). Committed as exactly 4 `"arc-right"` quarter-circle
 * edges ({@link circleEdges}, `tower-geometry.ts`) -- not 2 semicircles,
 * which would mint the identical 4 corner nodes for both and collide on one
 * `SurfaceKey` (see `circleEdges`'s own doc) -- so the footprint reaches the
 * graph as 4 distinct true-circle `Surface`s, not a polygon approximation.
 * Shares the same wall id-prefix (`idPrefixFor`) every other wall tool
 * uses, so a tower stamped against an existing structure still welds by
 * position wherever its own circle happens to touch it.
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
    const edges = circleEdges(sample.point, params.radius);
    ctx.runtime.generatePathExtrusion(
      {
        edges,
        height: WALL_HEIGHT,
        idPrefix: idPrefixFor(ctx),
        surfaceType: params.wallType,
      },
      "local",
      scopedToolId(ctx, "tower-stamp", ctx.nextSequence()),
    );
  },
};
