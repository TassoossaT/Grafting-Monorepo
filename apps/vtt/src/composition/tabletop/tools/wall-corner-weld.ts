import type { ConstructionNodeId, ConstructionPosition } from "@/ports";

import type { WallCornerRole } from "../default-map-seed.ts";
import type { ToolContext } from "./tool-context.ts";

/**
 * How close (3D -- unlike terrain's XZ-only weld, a wall's top and bottom
 * must not cross-weld) a new corner must land to an existing node before
 * reusing its id instead of minting a fresh one. Walls have no thickness
 * (`structure-generation/wall.rs`'s own doc: "dropping the box extrusion,
 * not adding anything"), so welding two walls' corners onto the same node
 * id is enough for their flat planes to meet exactly, by the same
 * graph-identity principle `irregular-terrain-tool.ts`'s own weld relies
 * on -- no miter geometry needed.
 *
 * Shared by `wall-brush-tool.ts` (E7.3, hand-drawn corners) and
 * `house-seed.ts` (procedural cells sharing an interior wall) -- extracted
 * here once a second genuine call site needed the identical logic.
 */
export const WALL_WELD_EPSILON = 0.5;

export interface ExistingWallNode {
  readonly id: ConstructionNodeId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function nearestExistingCorner(
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

/**
 * Weld candidates for a new wall's 4 corners against every node already on
 * the table, resolved from `ctx.runtime`'s live snapshot. `height` is the
 * new wall's own rise above `start`/`end` (both assumed to share one base
 * Y) -- a caller argument rather than a module constant, since callers
 * other than `wall-brush-tool.ts`'s fixed-height brush (e.g. a house
 * layout's own configurable `wallHeight`) need this to vary.
 */
export function weldCornerOverrides(
  ctx: ToolContext,
  start: ConstructionPosition,
  end: ConstructionPosition,
  height: number,
): Partial<Record<WallCornerRole, ConstructionNodeId>> {
  const existing: readonly ExistingWallNode[] = [...ctx.runtime.getSnapshot().map.nodePositions.values()].map(
    (entry) => ({ id: entry.nodeRef, x: entry.position.x, y: entry.position.y, z: entry.position.z }),
  );
  const startTop = { x: start.x, y: start.y + height, z: start.z };
  const endTop = { x: end.x, y: end.y + height, z: end.z };

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
