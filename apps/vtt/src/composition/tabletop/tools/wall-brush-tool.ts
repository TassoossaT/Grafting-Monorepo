import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { WallBrushParams } from "@/features/edit-construction";

import { buildGenerateWallOperation } from "../default-map-seed.ts";
import type { ConstructionTool, ToolContext, ToolGesture } from "./tool-context.ts";
import { segmentBetween } from "./preview-shapes.ts";

/** Fixed wall height for a brush-drawn segment -- matches `room-seed.ts`'s own generated-room wall height range. */
const WALL_HEIGHT = 3;
const WALL_COLOR: Record<WallBrushParams["wallType"], number> = { "wall-white": 0xe2e8f0, "wall-gray": 0x64748b };
/** Centered door, one third of the segment's own length -- a fixed default for v1, not yet a parameter. */
const DOOR_OPENING = { opensAt: 0.33, closesAt: 0.67 };

/**
 * Click-drag to draw one wall segment: `onPointerDown` marks the start,
 * `onPointerMove` only updates the ghost (no commit -- closes the gap
 * `0005-edit-mode-interaction.md` flagged: "generate wall auto-places, does
 * not offer click-to-choose placement"), `onPointerUp` commits the real
 * segment from start to release point.
 */
export const wallBrushTool: ConstructionTool<"wall-brush"> = {
  id: "wall-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["wall-brush"],

  previewFor(gesture: ToolGesture, params: WallBrushParams) {
    return segmentBetween(gesture.start.point, gesture.current.point, WALL_COLOR[params.wallType]);
  },

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: WallBrushParams): void {
    const sequence = ctx.nextSequence();
    const operation = buildGenerateWallOperation(
      ctx.tableId,
      `brush-wall-${sequence}`,
      { operationId: `${ctx.tableId}:brush-wall:${sequence}`, tableId: ctx.tableId, initiatedBy: "local" },
      { start: gesture.start.point, end: gesture.current.point, height: WALL_HEIGHT },
      params.withDoor ? DOOR_OPENING : undefined,
      params.wallType,
      params.withDoor ? "door" : params.wallType,
    );
    ctx.runtime.generateWall(operation.payload, "local", operation.operationId);
  },
};
