import type { ConstructionSurfaceKey } from "@/ports";

import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { findEnclosingRoom, type DerivedRoom } from "./room-lookup.ts";
import { findWallSurfaceAt } from "../walls/wall-shared.ts";

/**
 * Every bounding wall panel's surface key for `room` (one per consecutive
 * pair of `bottomCycle` corners, plus that pair's own `topCycle`
 * counterparts). No floor/ceiling key here -- nothing generates those yet
 * (see `wall-brush-tool.ts`'s own note on why closing a loop caps
 * nothing), and `removeSurface` throws on an unknown key, so including one
 * would abort this whole click before any wall got removed. There is no
 * dedicated "delete a room" primitive in the construction engine -- see
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
  const keys: ConstructionSurfaceKey[] = [];
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
 * Two behaviors, picked by what the click actually landed on: a click
 * directly on a wall panel (within `findWallSurfaceAt`'s own tolerance)
 * removes just that one surface -- the raw `removeSurface` primitive,
 * nothing else touched. A click anywhere else inside an enclosed room
 * removes every wall bounding it, via `findEnclosingRoom` (`room-lookup.ts`)
 * turning the click into the room's own corner loop and
 * {@link roomSurfaceKeys} turning that loop into one `removeSurface` call
 * per wall -- no composite "delete a room" call anywhere in the stack. A
 * click that hits neither (open exterior space) is a no-op.
 */
export const houseRoomDeleteTool: ConstructionTool<"house-room-delete"> = {
  id: "house-room-delete",
  defaultParams: () => ({}),

  onClick(ctx: ToolContext, sample: PointerSample): void {
    const directHit = findWallSurfaceAt(ctx, sample.point);
    if (directHit !== undefined) {
      ctx.runtime.removeSurface({ surfaceKey: directHit }, "local", scopedToolId(ctx, "demolish-surface", ctx.nextSequence()));
      return;
    }

    const found = findEnclosingRoom(ctx, sample.point);
    if (found === undefined) return;

    const sequence = ctx.nextSequence();
    for (const [index, surfaceKey] of roomSurfaceKeys(found).entries()) {
      ctx.runtime.removeSurface(
        { surfaceKey },
        "local",
        scopedToolId(ctx, "room-delete", `${sequence}:${index}`),
      );
    }
  },
};
