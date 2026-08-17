import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { WallBrushParams } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { findEnclosingRoom } from "./room-lookup.ts";
import { WALL_COLOR, WALL_HEIGHT, idPrefixFor, pinnedToBaseline, resolveWallCrossing } from "./wall-shared.ts";

/** Same two-click, never-chains anchor shape as `wall-line-tool.ts` -- see that file's own doc. */
let anchor: ConstructionPosition | undefined;

/**
 * Click-to-click straight interior walls, gated to only start inside an
 * already-enclosed exterior: the first click of a pair is accepted only if
 * `findEnclosingRoom` (`room-lookup.ts`) finds a closed wall loop
 * containing it -- any shape, any number of sides, nothing hardcoded about
 * "4 walls" (that lookup's own wall-follower algorithm handles an
 * arbitrary polygon already). A click outside any enclosure is a plain
 * no-op: it neither plants an anchor nor clears one already pending, so a
 * stray miss doesn't throw away progress.
 *
 * The second click is NOT independently re-checked against the same
 * enclosure -- once already drawing from inside, its natural endpoint is
 * either another interior point or exactly on the boundary wall itself (a
 * T-junction), and a boundary point sits ambiguously on the polygon's own
 * edge for a plain point-in-polygon test. `resolveWallCrossing` still runs
 * on both clicks, so a segment ending on an exterior (or another interior)
 * wall welds onto it, same as `wall-line-tool.ts`.
 *
 * Otherwise identical to `wall-line-tool.ts`: always exactly two clicks per
 * segment, never chains, no floor/ceiling generated (not implemented yet).
 */
export const interiorWallTool: ConstructionTool<"interior-wall"> = {
  id: "interior-wall",
  defaultParams: () => DEFAULT_TOOL_PARAMS["interior-wall"],

  previewFor(gesture: ToolGesture, params: WallBrushParams) {
    if (anchor === undefined) return undefined;
    return {
      kind: "segments",
      color: WALL_COLOR[params.wallType],
      opacity: 0.7,
      positions: Float32Array.from([
        anchor.x, anchor.y, anchor.z,
        gesture.current.point.x, gesture.current.point.y, gesture.current.point.z,
      ]),
    };
  },

  onClick(ctx: ToolContext, sample: PointerSample, params: WallBrushParams): void {
    if (anchor === undefined) {
      if (findEnclosingRoom(ctx, sample.point) === undefined) return;
      anchor = resolveWallCrossing(ctx, sample.point, `${ctx.tableId}:wall-crossing:${ctx.nextSequence()}`);
      return;
    }

    const pinned = pinnedToBaseline(anchor, sample.point);
    const end = resolveWallCrossing(ctx, pinned, `${ctx.tableId}:wall-crossing:${ctx.nextSequence()}`);
    const sequence = ctx.nextSequence();
    ctx.runtime.generatePathExtrusion(
      {
        edges: [{ start: anchor, end, curvature: "straight" }],
        height: WALL_HEIGHT,
        arcFacets: 1,
        idPrefix: idPrefixFor(ctx),
        surfaceType: params.wallType,
      },
      "local",
      `${ctx.tableId}:interior-wall:${sequence}`,
    );

    anchor = undefined;
  },
};
