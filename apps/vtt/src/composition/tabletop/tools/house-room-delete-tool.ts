import type { ConstructionSurfaceKey } from "@/ports";

import type { ConstructionTool, PointerSample, ToolContext } from "./tool-context.ts";
import { findEnclosingRoom, type DerivedRoom } from "./room-lookup.ts";

/**
 * Every surface key belonging to `room`: its floor, its ceiling, and each
 * bounding wall panel (one per consecutive pair of `bottomCycle` corners,
 * plus that pair's own `topCycle` counterparts). There is no dedicated
 * "delete a room" primitive in the construction engine -- see
 * `editing::remove_surface`'s own doc -- so this is exactly the
 * composition the front is expected to do: know which surfaces make up
 * the room it just found, then remove each one outright. A wall panel
 * that was split by a notch (a door) is *not* recovered here -- this walks
 * `bottomCycle`/`topCycle` corner pairs, not the live surface registry, so
 * a notched run's own remainder/notch/remainder pieces (different node
 * sets than the raw 4-corner span) are left standing; "Apagar Cômodo" on a
 * plain, unnotched room is this tool's only exercised path so far.
 */
function roomSurfaceKeys(room: DerivedRoom): readonly ConstructionSurfaceKey[] {
  const keys: ConstructionSurfaceKey[] = [room.bottomCycle, room.topCycle];
  for (let index = 0; index < room.bottomCycle.length; index += 1) {
    const nextIndex = (index + 1) % room.bottomCycle.length;
    const bottomA = room.bottomCycle[index];
    const bottomB = room.bottomCycle[nextIndex];
    const topA = room.topCycle[index];
    const topB = room.topCycle[nextIndex];
    if (bottomA === undefined || bottomB === undefined || topA === undefined || topB === undefined) continue;
    keys.push([bottomA, bottomB, topB, topA]);
  }
  return keys;
}

/**
 * Click inside a room and remove it whole -- floor, ceiling, and every
 * bounding wall. Reuses `findEnclosingRoom` (extracted from
 * `room-derive-tool.ts`) to turn a click into the room's own corner loop,
 * then removes each surface that loop implies through the engine's raw
 * `removeSurface` primitive -- one call per surface, no composite
 * "delete a room" call anywhere in the stack. See `roomSurfaceKeys`'s own
 * doc for what "every surface" covers.
 */
export const houseRoomDeleteTool: ConstructionTool<"house-room-delete"> = {
  id: "house-room-delete",
  defaultParams: () => ({}),

  onClick(ctx: ToolContext, sample: PointerSample): void {
    const found = findEnclosingRoom(ctx, sample.point);
    if (found === undefined) return;

    const sequence = ctx.nextSequence();
    for (const [index, surfaceKey] of roomSurfaceKeys(found).entries()) {
      ctx.runtime.removeSurface(
        { surfaceKey },
        "local",
        `${ctx.tableId}:room-delete:${sequence}:${index}`,
      );
    }
  },
};
