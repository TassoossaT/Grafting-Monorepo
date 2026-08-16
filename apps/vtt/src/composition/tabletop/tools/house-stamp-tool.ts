import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { HouseStampParams } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { footprintQuad } from "./preview-shapes.ts";

const WALL_COLOR = 0xe2e8f0;
/** Uniform cell size for v1 (see `structure-generation::RoomGridLayout`'s own doc) -- matches `room-seed.ts`'s standalone-room size range. */
const CELL_WIDTH = 4;
const CELL_DEPTH = 4;
const WALL_HEIGHT = 3;

function footprintCorners(
  origin: ConstructionPosition,
  rows: number,
  cols: number,
): readonly [ConstructionPosition, ConstructionPosition, ConstructionPosition, ConstructionPosition] {
  const width = cols * CELL_WIDTH;
  const depth = rows * CELL_DEPTH;
  return [
    origin,
    { x: origin.x + width, y: origin.y, z: origin.z },
    { x: origin.x + width, y: origin.y, z: origin.z + depth },
    { x: origin.x, y: origin.y, z: origin.z + depth },
  ];
}

/**
 * Townscaper-style batch generation, same shape as `room-stamp-tool.ts`:
 * click a spot, get a whole grid of connected rooms in one commit. Unlike
 * `room-stamp`, every bit of grid/weld math (which corners are shared,
 * which walls get doors) happens on the Rust side
 * (`ConstructionSessionPort.generateRoomGrid` ->
 * `grafting_procgen_structure_generation::generate_room_grid`) -- this tool
 * only resolves where to place the grid and how big, then hands the whole
 * request to the engine in one call.
 */
export const houseStampTool: ConstructionTool<"house-stamp"> = {
  id: "house-stamp",
  defaultParams: () => DEFAULT_TOOL_PARAMS["house-stamp"],

  previewFor(gesture: ToolGesture, params: HouseStampParams) {
    return footprintQuad(footprintCorners(gesture.current.point, params.rows, params.cols), WALL_COLOR);
  },

  onClick(ctx: ToolContext, sample: PointerSample, params: HouseStampParams): void {
    const sequence = ctx.nextSequence();
    // Rows/cols come from a UI slider (`construction-tool-params-panel.tsx`)
    // that should already only offer whole numbers >= 1, but the engine
    // itself rejects 0 -- clamp here rather than surface that as a runtime
    // error from a stray fractional/zero value.
    const rows = Math.max(1, Math.round(params.rows));
    const cols = Math.max(1, Math.round(params.cols));

    ctx.runtime.generateRoomGrid(
      {
        layout: { origin: sample.point, rows, cols, cellWidth: CELL_WIDTH, cellDepth: CELL_DEPTH, wallHeight: WALL_HEIGHT },
        idPrefix: `${ctx.tableId}:brush-house-${sequence}`,
        wallType: "wall-white",
        doorType: "door",
        floorType: "floor",
        ceilingType: "ceiling",
      },
      "local",
      `${ctx.tableId}:brush-house:${sequence}`,
    );
  },
};
