import { lerp, mulberry32 } from "../../ui/seeded-random.ts";

import { buildGenerateWallOperation } from "./default-map-seed.ts";
import type { ConstructionOperationContext, GenerateWallOperation } from "../../features/edit-construction/index.ts";
import type { ConstructionPosition, DoorOpening } from "@/ports";

/** A rectangular room's footprint in the XZ plane, walls rising along Y. */
export interface RoomLayout {
  readonly origin: ConstructionPosition;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

/** One generated room's shape and door placement, independent of where it sits on the table. */
export interface RoomVariant {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly door: DoorOpening;
}

const MIN_ROOM_WIDTH = 4;
const MAX_ROOM_WIDTH = 6;
const MIN_ROOM_DEPTH = 4;
const MAX_ROOM_DEPTH = 6;
const MIN_ROOM_HEIGHT = 2.5;
const MAX_ROOM_HEIGHT = 3.5;

/** Half the door opening's width, as a fraction of the south wall's length. */
const DOOR_HALF_WIDTH = 0.1;
/** How far the door's center may drift from the wall's midpoint, so it never touches a corner. */
const DOOR_CENTER_MIN = 0.3;
const DOOR_CENTER_MAX = 0.7;

/**
 * Distance between a placed room's origin and the next one's, along X.
 * Fixed at `MAX_ROOM_WIDTH` plus a gap wide enough that no room, whatever
 * width {@link roomVariantForIndex} gives it, can reach its neighbor --
 * layoutNextRoomOrigin stays a pure function of `index` alone rather than
 * needing to know every prior room's actual width.
 */
const ROOM_STRIDE = MAX_ROOM_WIDTH + 2;

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
 * Derives a deterministic, bounded room shape and door placement for the
 * `index`-th generated room, seeded via `@grafting/render-3d`'s `mulberry32`
 * rather than `Math.random` so the same click count always reshapes into the
 * same room -- reproducible in tests instead of flaky, and lets a GM
 * regenerate the same table's layout on reload. Width/depth stay within
 * [{@link MIN_ROOM_WIDTH}/{@link MIN_ROOM_DEPTH}, {@link ROOM_STRIDE}'s
 * bound] so {@link layoutNextRoomOrigin}'s fixed stride still guarantees no
 * two rooms overlap.
 */
export function roomVariantForIndex(index: number): RoomVariant {
  const random = mulberry32(index);
  const width = lerp(MIN_ROOM_WIDTH, MAX_ROOM_WIDTH, random());
  const depth = lerp(MIN_ROOM_DEPTH, MAX_ROOM_DEPTH, random());
  const height = lerp(MIN_ROOM_HEIGHT, MAX_ROOM_HEIGHT, random());
  const doorCenter = lerp(DOOR_CENTER_MIN, DOOR_CENTER_MAX, random());
  return {
    width,
    depth,
    height,
    door: { opensAt: doorCenter - DOOR_HALF_WIDTH, closesAt: doorCenter + DOOR_HALF_WIDTH },
  };
}

/**
 * Builds (but does not apply) the 4 `construction.generate-wall@1`
 * operations forming one rectangular room at `origin` shaped by `variant`:
 * 3 plain walls and one wall with `variant.door` cut into it (the south
 * wall, starting at `origin`), each with a `salt`-namespaced id set via
 * {@link buildGenerateWallOperation} so the 4 calls never collide with each
 * other or with any other generated geometry on the table.
 */
export function buildGenerateRoomOperations(
  tableId: string,
  salt: string,
  context: ConstructionOperationContext,
  origin: ConstructionPosition,
  variant: RoomVariant,
  wallType: string,
  doorType: string,
): readonly [GenerateWallOperation, GenerateWallOperation, GenerateWallOperation, GenerateWallOperation] {
  const { width, depth, height, door } = variant;
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
      hasDoor ? door : undefined,
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
