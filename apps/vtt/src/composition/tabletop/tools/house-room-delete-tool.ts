import type { ConstructionTool, PointerSample, ToolContext } from "./tool-context.ts";
import { findEnclosingRoom } from "./room-lookup.ts";

const REPLACEMENT_WALL_TYPE = "wall-white";

/**
 * Click inside a room and remove it whole -- floor, ceiling, and every
 * bounding wall. A side still shared with a standing neighbor is
 * preserved (and door-stripped, since there is no room to walk into
 * anymore) rather than removed with the rest -- see
 * `ConstructionSessionPort.removeRoom`/`room_removal::remove_room` for the
 * actual policy. Reuses `findEnclosingRoom` (extracted from
 * `room-derive-tool.ts`) to turn a click into the room's own corner loop;
 * this tool never re-derives geometry itself.
 */
export const houseRoomDeleteTool: ConstructionTool<"house-room-delete"> = {
  id: "house-room-delete",
  defaultParams: () => ({}),

  onClick(ctx: ToolContext, sample: PointerSample): void {
    const found = findEnclosingRoom(ctx, sample.point);
    if (found === undefined) return;
    ctx.runtime.removeRoom(
      { bottomCycle: found.bottomCycle, topCycle: found.topCycle, wallType: REPLACEMENT_WALL_TYPE },
      "local",
      `${ctx.tableId}:room-delete:${ctx.nextSequence()}`,
    );
  },
};
