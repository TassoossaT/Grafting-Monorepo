import { buildGenerateWallOperation } from "./default-map-seed.ts";
import type { ConstructionOperationContext, GenerateWallOperation } from "../../features/edit-construction/index.ts";
import type { ConstructionPosition } from "@/ports";

/** A rectangular room's footprint in the XZ plane, walls rising along Y. */
export interface RoomLayout {
  readonly origin: ConstructionPosition;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

export const ROOM_WIDTH = 6;
export const ROOM_DEPTH = 6;
export const ROOM_HEIGHT = 3;

/**
 * Distance between a placed room's origin and the next one's, along X --
 * `ROOM_WIDTH` plus a gap wide enough that two rooms' walls never touch.
 */
const ROOM_STRIDE = ROOM_WIDTH + 2;

/**
 * The X offset the first generated room starts at, clear of
 * {@link defaultMapSeed}'s own seed wall (which sits at `x: 2`) so a fresh
 * table's first "generate room" click doesn't drop a wall directly on top
 * of it.
 */
const ROOM_LAYOUT_BASE_X = 8;

/**
 * Places the `index`-th generated room (1-based, matching the click counter
 * callers already keep) in a single row along X, so repeated clicks tile
 * rooms next to each other instead of restacking on the same footprint.
 */
export function layoutNextRoomOrigin(index: number): ConstructionPosition {
  return { x: ROOM_LAYOUT_BASE_X + (index - 1) * ROOM_STRIDE, y: 0, z: 0 };
}

/**
 * Builds (but does not apply) the 4 `construction.generate-wall@1`
 * operations forming one rectangular room from `layout`: 3 plain walls and
 * one wall with a centered door (the south wall, at `layout.origin`), each
 * with a `salt`-namespaced id set via {@link buildGenerateWallOperation} so
 * the 4 calls never collide with each other or with any other generated
 * geometry on the table.
 */
export function buildGenerateRoomOperations(
  tableId: string,
  salt: string,
  context: ConstructionOperationContext,
  layout: RoomLayout,
  wallType: string,
  doorType: string,
): readonly [GenerateWallOperation, GenerateWallOperation, GenerateWallOperation, GenerateWallOperation] {
  const { origin, width, depth, height } = layout;
  const sw: ConstructionPosition = origin;
  const se: ConstructionPosition = { x: origin.x + width, y: origin.y, z: origin.z };
  const ne: ConstructionPosition = { x: origin.x + width, y: origin.y, z: origin.z + depth };
  const nw: ConstructionPosition = { x: origin.x, y: origin.y, z: origin.z + depth };

  const wallOp = (side: string, start: ConstructionPosition, end: ConstructionPosition, hasDoor: boolean) =>
    buildGenerateWallOperation(
      tableId,
      `${salt}:${side}`,
      { ...context, operationId: `${context.operationId}:${side}` },
      { start, end, height },
      hasDoor ? { opensAt: 0.4, closesAt: 0.6 } : undefined,
      wallType,
      doorType,
    );

  return [
    wallOp("south", sw, se, true),
    wallOp("east", se, ne, false),
    wallOp("north", ne, nw, false),
    wallOp("west", nw, sw, false),
  ];
}
