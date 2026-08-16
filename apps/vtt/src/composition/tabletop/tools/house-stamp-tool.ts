import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { HouseStampParams } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { footprintQuad } from "./preview-shapes.ts";

const WALL_COLOR = 0xe2e8f0;
const WALL_HEIGHT = 3;

function footprintCorners(
  origin: ConstructionPosition,
  width: number,
  depth: number,
): readonly [ConstructionPosition, ConstructionPosition, ConstructionPosition, ConstructionPosition] {
  return [
    origin,
    { x: origin.x + width, y: origin.y, z: origin.z },
    { x: origin.x + width, y: origin.y, z: origin.z + depth },
    { x: origin.x, y: origin.y, z: origin.z + depth },
  ];
}

/**
 * Townscaper-style batch generation, same shape as `room-stamp-tool.ts`:
 * click a spot, get a whole footprint of connected, varied-size rooms in
 * one commit. Every bit of treemap/weld math (room sizes, which corners
 * are shared, which walls get doors) happens on the Rust side
 * (`ConstructionSessionPort.generateRoomGrid` ->
 * `grafting_procgen_structure_generation::generate_room_grid`) -- this tool
 * only resolves where to place the footprint and how big/which seed, then
 * hands the whole request to the engine in one call.
 */
export const houseStampTool: ConstructionTool<"house-stamp"> = {
  id: "house-stamp",
  defaultParams: () => DEFAULT_TOOL_PARAMS["house-stamp"],

  previewFor(gesture: ToolGesture, params: HouseStampParams) {
    return footprintQuad(footprintCorners(gesture.current.point, params.width, params.depth), WALL_COLOR);
  },

  onClick(ctx: ToolContext, sample: PointerSample, params: HouseStampParams): void {
    const sequence = ctx.nextSequence();
    // Width/depth/roomCount come from UI sliders
    // (`construction-tool-params-panel.tsx`) that should already only
    // offer sane values, but the engine itself rejects 0/negative -- clamp
    // here rather than surface that as a runtime error from a stray value.
    const roomCount = Math.max(1, Math.round(params.roomCount));

    ctx.runtime.generateRoomGrid(
      {
        layout: {
          origin: sample.point,
          width: params.width,
          depth: params.depth,
          roomCount,
          wallHeight: WALL_HEIGHT,
          seed: params.seed,
        },
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
