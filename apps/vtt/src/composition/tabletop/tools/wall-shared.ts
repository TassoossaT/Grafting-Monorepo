import type { WallBrushParams } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import type { ToolContext } from "./tool-context.ts";

/** Fixed wall height for a brush/line-drawn segment, shared by both wall tools. */
export const WALL_HEIGHT = 3;
export const WALL_COLOR: Record<WallBrushParams["wallType"], number> = { "wall-white": 0xe2e8f0, "wall-gray": 0x64748b };

/**
 * A single stable prefix for every wall structure on this table, shared by
 * `wall-brush-tool.ts` and `wall-line-tool.ts` -- a wall's corner ids are
 * derived purely from XZ position (`extrude_path`'s own doc), so anything
 * sharing this one prefix welds together for free wherever its corners
 * happen to coincide, without either tool needing to know about the other
 * -- "ligar casas" (E7's own wording) comes for free, and a free-form
 * stroke can weld onto a precise straight run and vice versa.
 */
export function idPrefixFor(ctx: ToolContext): string {
  return `${ctx.tableId}:wall-brush`;
}

/**
 * Pins `point`'s Y to `baseline`'s -- a later drag/click sample landing on a
 * different surface (a step, a sloped terrain tile) must not desync a
 * path's baseline, or `extrude_path` rejects the whole thing as
 * `InconsistentBaseline`.
 */
export function pinnedToBaseline(baseline: ConstructionPosition, point: ConstructionPosition): ConstructionPosition {
  return { ...point, y: baseline.y };
}

export function xzDistance(a: ConstructionPosition, b: ConstructionPosition): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}
