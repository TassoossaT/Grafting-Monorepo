import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { WallBrushParams } from "@/features/edit-construction";
import type { ConstructionNodeId, ConstructionPosition } from "@/ports";

import { buildGenerateWallOperation, type WallCornerRole } from "../default-map-seed.ts";
import type { ConstructionTool, ToolContext, ToolGesture } from "./tool-context.ts";
import { segmentBetween } from "./preview-shapes.ts";

/** Fixed wall height for a brush-drawn segment -- matches `room-seed.ts`'s own generated-room wall height range. */
const WALL_HEIGHT = 3;
const WALL_COLOR: Record<WallBrushParams["wallType"], number> = { "wall-white": 0xe2e8f0, "wall-gray": 0x64748b };
/** Centered door, one third of the segment's own length -- a fixed default for v1, not yet a parameter. */
const DOOR_OPENING = { opensAt: 0.33, closesAt: 0.67 };

/**
 * Walls have no thickness (`structure-generation/wall.rs`'s own doc: "the
 * fix is dropping the box extrusion, not adding anything"), so two walls
 * meeting at a corner is not a miter-geometry problem -- it is a shared-node
 * problem: if both walls' corner nodes are the *same* `NodeId`, the two flat
 * planes already meet exactly, for free, by the same graph-identity
 * principle `irregular-terrain-tool.ts`'s own weld already relies on. This
 * is the E7.3 "recognize shared edges/corners" mechanism: how close (3D --
 * unlike terrain's XZ-only weld, a wall's top and bottom must not cross-weld)
 * a new corner must land to an existing node before reusing its id instead
 * of minting a fresh one.
 *
 * v1 scope, deliberate: only the corner case (two walls sharing an
 * endpoint). A new wall's endpoint landing on the *middle* of an existing
 * wall (a T/X junction) is not detected here -- that needs `splitSurface` to
 * insert a node into the crossed wall's own surface, a bigger follow-up.
 */
const WALL_WELD_EPSILON = 0.5;

interface ExistingWallNode {
  readonly id: ConstructionNodeId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function nearestExistingCorner(
  point: ConstructionPosition,
  existing: readonly ExistingWallNode[],
): ConstructionNodeId | undefined {
  let best: ExistingWallNode | undefined;
  let bestDistanceSq = WALL_WELD_EPSILON * WALL_WELD_EPSILON;
  for (const candidate of existing) {
    const dx = candidate.x - point.x;
    const dy = candidate.y - point.y;
    const dz = candidate.z - point.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq <= bestDistanceSq) {
      best = candidate;
      bestDistanceSq = distanceSq;
    }
  }
  return best?.id;
}

function weldCornerOverrides(
  ctx: ToolContext,
  start: ConstructionPosition,
  end: ConstructionPosition,
): Partial<Record<WallCornerRole, ConstructionNodeId>> {
  const existing: readonly ExistingWallNode[] = [...ctx.runtime.getSnapshot().map.nodePositions.values()].map(
    (entry) => ({ id: entry.nodeRef, x: entry.position.x, y: entry.position.y, z: entry.position.z }),
  );
  const startTop = { x: start.x, y: start.y + WALL_HEIGHT, z: start.z };
  const endTop = { x: end.x, y: end.y + WALL_HEIGHT, z: end.z };

  const overrides: Partial<Record<WallCornerRole, ConstructionNodeId>> = {};
  const startBottom = nearestExistingCorner(start, existing);
  if (startBottom !== undefined) overrides.startBottom = startBottom;
  const topOfStart = nearestExistingCorner(startTop, existing);
  if (topOfStart !== undefined) overrides.startTop = topOfStart;
  const endBottom = nearestExistingCorner(end, existing);
  if (endBottom !== undefined) overrides.endBottom = endBottom;
  const topOfEnd = nearestExistingCorner(endTop, existing);
  if (topOfEnd !== undefined) overrides.endTop = topOfEnd;
  return overrides;
}

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
    const cornerOverrides = weldCornerOverrides(ctx, gesture.start.point, gesture.current.point);
    const operation = buildGenerateWallOperation(
      ctx.tableId,
      `brush-wall-${sequence}`,
      { operationId: `${ctx.tableId}:brush-wall:${sequence}`, tableId: ctx.tableId, initiatedBy: "local" },
      { start: gesture.start.point, end: gesture.current.point, height: WALL_HEIGHT },
      params.withDoor ? DOOR_OPENING : undefined,
      params.wallType,
      params.withDoor ? "door" : params.wallType,
      cornerOverrides,
    );
    ctx.runtime.generateWall(operation.payload, "local", operation.operationId);
  },
};
