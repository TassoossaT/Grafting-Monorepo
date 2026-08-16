import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { HouseRoomAddParams } from "@/features/edit-construction";
import type { ConstructionPosition, RoomAdditionWeldCandidate } from "@/ports";

import type { ConstructionTool, ToolContext, ToolGesture } from "./tool-context.ts";
import { footprintQuad } from "./preview-shapes.ts";
import { nearestExistingCorner, type ExistingWallNode } from "./wall-corner-weld.ts";

const WALL_COLOR = 0xe2e8f0;
const WALL_HEIGHT = 3;

interface Tile {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
}

/** Normalizes a drag's two diagonal points into a tile, regardless of which corner the user started from. */
function tileFromDrag(start: ConstructionPosition, current: ConstructionPosition, minWidth: number, minDepth: number): Tile {
  const x = Math.min(start.x, current.x);
  const z = Math.min(start.z, current.z);
  const width = Math.max(Math.abs(current.x - start.x), minWidth);
  const depth = Math.max(Math.abs(current.z - start.z), minDepth);
  return { x, z, width, depth };
}

function footprintCorners(
  tile: Tile,
  y: number,
): readonly [ConstructionPosition, ConstructionPosition, ConstructionPosition, ConstructionPosition] {
  return [
    { x: tile.x, y, z: tile.z },
    { x: tile.x + tile.width, y, z: tile.z },
    { x: tile.x + tile.width, y, z: tile.z + tile.depth },
    { x: tile.x, y, z: tile.z + tile.depth },
  ];
}

/**
 * Weld candidates for this tile's 4 XZ corners (bottom + top) against
 * every node already on the table -- the same live-query weld pattern
 * `wall-corner-weld.ts` already proved for a single wall's 2 endpoints,
 * generalized to a room's 4. Corner-to-corner only (v1 scope, same limit
 * `VTT-WALL-CORNER-WELD` already accepted): a tile edge that only
 * partially overlaps an existing wall's length does not weld -- it is
 * still generated, just as new, unwelded geometry alongside it.
 */
function weldCandidatesFor(ctx: ToolContext, tile: Tile, originY: number): readonly RoomAdditionWeldCandidate[] {
  const existing: readonly ExistingWallNode[] = [...ctx.runtime.getSnapshot().map.nodePositions.values()].map((entry) => ({
    id: entry.nodeRef,
    x: entry.position.x,
    y: entry.position.y,
    z: entry.position.z,
  }));

  const corners: readonly [number, number][] = [
    [tile.x, tile.z],
    [tile.x + tile.width, tile.z],
    [tile.x + tile.width, tile.z + tile.depth],
    [tile.x, tile.z + tile.depth],
  ];
  const candidates: RoomAdditionWeldCandidate[] = [];
  for (const [x, z] of corners) {
    for (const top of [false, true]) {
      const y = originY + (top ? WALL_HEIGHT : 0);
      const nodeId = nearestExistingCorner({ x, y, z }, existing);
      if (nodeId !== undefined) candidates.push({ x, z, top, nodeId });
    }
  }
  return candidates;
}

/**
 * Drag a rectangle and get one new room welded onto whatever it touches --
 * "Adicionar Cômodo," the incremental counterpart to `house-stamp`'s
 * whole-footprint generation. All treemap/weld math still happens on the
 * Rust side (`ConstructionSessionPort.generateRoomAddition` ->
 * `grafting_procgen_construction_wasm::room_addition::generate_and_apply_room_addition`);
 * this tool only resolves the dragged rectangle and which nearby nodes to
 * weld onto.
 */
export const houseRoomAddTool: ConstructionTool<"house-room-add"> = {
  id: "house-room-add",
  defaultParams: () => DEFAULT_TOOL_PARAMS["house-room-add"],

  previewFor(gesture: ToolGesture, params: HouseRoomAddParams) {
    const tile = tileFromDrag(gesture.start.point, gesture.current.point, params.width, params.depth);
    return footprintQuad(footprintCorners(tile, gesture.current.point.y), WALL_COLOR);
  },

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: HouseRoomAddParams): void {
    const tile = tileFromDrag(gesture.start.point, gesture.current.point, params.width, params.depth);
    const originY = gesture.start.point.y;
    const sequence = ctx.nextSequence();

    ctx.runtime.generateRoomAddition(
      {
        tile,
        originY,
        wallHeight: WALL_HEIGHT,
        idPrefix: `${ctx.tableId}:brush-room-add-${sequence}`,
        wallType: "wall-white",
        doorType: "door",
        floorType: "floor",
        ceilingType: "ceiling",
        weldCandidates: weldCandidatesFor(ctx, tile, originY),
      },
      "local",
      `${ctx.tableId}:brush-room-add:${sequence}`,
    );
  },
};
