import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { RoomStampParams } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import { buildGenerateRoomOperations, roomVariantForIndex, type RoomVariant } from "../room-seed.ts";
import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { footprintQuad } from "./preview-shapes.ts";

const WALL_COLOR = 0xe2e8f0;
/** `complexity` in `[0, 1]` scales `roomVariantForIndex`'s own seeded shape -- 0.6x at the low end, 1.4x at the high end. */
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.4;

function variantFor(params: RoomStampParams): RoomVariant {
  const base = roomVariantForIndex(Math.floor(params.seed) || 1);
  const scale = MIN_SCALE + params.complexity * (MAX_SCALE - MIN_SCALE);
  return { ...base, width: base.width * scale, depth: base.depth * scale };
}

function footprintCorners(
  origin: ConstructionPosition,
  variant: RoomVariant,
): readonly [ConstructionPosition, ConstructionPosition, ConstructionPosition, ConstructionPosition] {
  return [
    origin,
    { x: origin.x + variant.width, y: origin.y, z: origin.z },
    { x: origin.x + variant.width, y: origin.y, z: origin.z + variant.depth },
    { x: origin.x, y: origin.y, z: origin.z + variant.depth },
  ];
}

/**
 * Townscaper-style batch generation: click a spot on the map, get a whole
 * room (4 walls + a door) in one commit -- no drag, `onClick` only. The
 * footprint ghost tracks the hover position before the click confirms it.
 */
export const roomStampTool: ConstructionTool<"room-stamp"> = {
  id: "room-stamp",
  defaultParams: () => DEFAULT_TOOL_PARAMS["room-stamp"],

  previewFor(gesture: ToolGesture, params: RoomStampParams) {
    return footprintQuad(footprintCorners(gesture.current.point, variantFor(params)), WALL_COLOR);
  },

  onClick(ctx: ToolContext, sample: PointerSample, params: RoomStampParams): void {
    const sequence = ctx.nextSequence();
    const variant = variantFor(params);
    const operations = buildGenerateRoomOperations(
      ctx.tableId,
      `brush-room-${sequence}`,
      { operationId: `${ctx.tableId}:brush-room:${sequence}`, tableId: ctx.tableId, initiatedBy: "local" },
      sample.point,
      variant,
      "wall-white",
      "door",
    );
    for (const operation of operations) {
      ctx.runtime.generatePathExtrusion(operation.payload, "local", operation.operationId);
    }
  },
};
