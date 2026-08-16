import type { ConstructionSurfaceSpec } from "@/ports";

import type { ConstructionTool, PointerSample, ToolContext } from "./tool-context.ts";
import { findEnclosingRoom } from "./room-lookup.ts";

/**
 * Click inside walls already drawn (`wall-brush`) and get their enclosed
 * floor + ceiling -- the opposite direction from `room-stamp`, which
 * generates a brand new room's own walls. This tool never creates a wall;
 * it only *derives* a floor/ceiling surface from a loop of wall corners
 * that already form a closed boundary, per E7.6's own goal ("derive/select
 * room boundaries... without introducing parallel free geometry").
 *
 * No `previewFor`: `ConstructionTool.previewFor` only ever receives a
 * gesture and the tool's own params (`tool-context.ts`), never a
 * `ToolContext` -- deliberately, every other tool's ghost is pure geometry
 * derived from the pointer alone. This tool's "geometry" is a live graph
 * query (`findEnclosingRoom` needs `ctx.runtime.getSnapshot()`), which that
 * signature cannot supply. A hover preview is a real, worthwhile follow-up,
 * but it needs widening `previewFor`'s own signature first -- a
 * cross-cutting change touching every tool, not scoped to this one.
 */
export const roomDeriveTool: ConstructionTool<"room-derive"> = {
  id: "room-derive",
  defaultParams: () => ({}),

  onClick(ctx: ToolContext, sample: PointerSample): void {
    const found = findEnclosingRoom(ctx, sample.point);
    if (found === undefined) return;
    const floor: ConstructionSurfaceSpec = { cycle: found.bottomCycle, surfaceType: "floor", physical: true };
    // The ceiling is the same vertical loop, but viewed from above needs the
    // opposite winding to keep its normal facing outward (down into the
    // room), consistent with how a wall's own bottom/top pair always mirror
    // each other in `structure-generation/wall.rs`'s `quad()` ordering.
    const ceiling: ConstructionSurfaceSpec = { cycle: [...found.topCycle].reverse(), surfaceType: "ceiling", physical: true };
    ctx.runtime.applyIrregularTerrainPatch([], [floor, ceiling], "local", `${ctx.tableId}:room-derive:${ctx.nextSequence()}`);
  },
};
