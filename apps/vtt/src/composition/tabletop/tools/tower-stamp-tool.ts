import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { TowerStampParams } from "@/features/edit-construction";

import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { circleEdges, previewOutline } from "./tower-geometry.ts";
import { WALL_COLOR, WALL_HEIGHT, idPrefixFor } from "./wall-shared.ts";

/** How many straight chords the *preview* ghost's circle outline uses -- a rendering-only approximation, never fed to the engine (the committed geometry is two true semicircle edges, not a facetted polygon). */
const PREVIEW_SEGMENTS = 24;
/** How many straight chords each committed semicircle edge tessellates into -- see `extrusion.rs`'s own doc on why the edge itself stays exactly one `Surface` regardless of this. */
const ARC_FACETS = 16;

/**
 * One click stamps a closed circular wall footprint at a known radius (one
 * of {@link TOWER_RADIUS_PRESETS}, never a freehand drag) -- the "buildings
 * get known geometry" half of the owner's own split between this and the
 * free-form brush's own curve-fitting (`wall-brush-tool.ts`,
 * `path-fitting.ts`). Committed as exactly two `"arc-left"` semicircle
 * edges ({@link circleEdges}, `tower-geometry.ts`), so the footprint reaches
 * the graph as two true-circle `Surface`s (per `extrusion.rs`'s
 * one-`Surface`-per-curved-edge fix), not a polygon approximation. Shares
 * the same wall id-prefix (`idPrefixFor`) every other wall tool uses, so a
 * tower stamped against an existing structure still welds by position
 * wherever its own circle happens to touch it.
 */
export const towerStampTool: ConstructionTool<"tower-stamp"> = {
  id: "tower-stamp",
  defaultParams: () => DEFAULT_TOOL_PARAMS["tower-stamp"],

  previewFor(gesture: ToolGesture, params: TowerStampParams) {
    return {
      kind: "segments",
      color: WALL_COLOR[params.wallType],
      opacity: 0.7,
      positions: previewOutline(gesture.current.point, params.radius, PREVIEW_SEGMENTS),
    };
  },

  onClick(ctx: ToolContext, sample: PointerSample, params: TowerStampParams): void {
    const edges = circleEdges(sample.point, params.radius);
    ctx.runtime.generatePathExtrusion(
      {
        edges,
        height: WALL_HEIGHT,
        arcFacets: ARC_FACETS,
        idPrefix: idPrefixFor(ctx),
        surfaceType: params.wallType,
      },
      "local",
      `${ctx.tableId}:tower-stamp:${ctx.nextSequence()}`,
    );
  },
};
