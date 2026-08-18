import { lerp, mulberry32 } from "@/ui";
import type { TerrainBrushParams } from "@/features/edit-construction";
import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { ConstructionPosition, CornerHeightModule } from "@/ports";

import { buildGenerateTerrainCellOperation } from "../default-map-seed.ts";
import { TERRAIN_GRID_HEIGHT, TERRAIN_GRID_WIDTH } from "../tabletop-runtime.ts";
import type { ConstructionTool, ToolContext, ToolGesture } from "./tool-context.ts";
import { circleOutline } from "./preview-shapes.ts";

const TERRAIN_COLOR: Record<TerrainBrushParams["targetSurface"], number> = {
  terrain: 0x334155,
  "terrain-grass": 0x4a7a4a,
};

/**
 * `PrismGridMesh`'s own fixed layout: cell `(x, z)` always physically
 * occupies render-space `X ∈ [x, x+1]`, `Z ∈ [z, z+1]` -- there is no
 * offset/origin parameter anywhere in `ConstructionSessionPort`, so a picked
 * world point maps to a cell by a plain floor. Returns `undefined` outside
 * the declared grid (`TERRAIN_GRID_WIDTH` x `TERRAIN_GRID_HEIGHT`, starting
 * at world `(0, 0)` -- see `tabletop-runtime.ts`) rather than clamping to an
 * edge cell: silently generating at the nearest edge whenever the pointer is
 * out of range would reproduce the exact "always builds in the same spot"
 * complaint this file was written to fix, just at the boundary instead of
 * the origin.
 */
function cellIndexAt(point: ConstructionPosition): number | undefined {
  const x = Math.floor(point.x);
  const z = Math.floor(point.z);
  if (x < 0 || x >= TERRAIN_GRID_WIDTH || z < 0 || z >= TERRAIN_GRID_HEIGHT) return undefined;
  return z * TERRAIN_GRID_WIDTH + x;
}

/**
 * Derives one `CornerHeightModule` from `params`: `strength` sets how far
 * corners lift off the base (0 = flat, 1 = full height), `seed` perturbs
 * each corner independently via `mulberry32` (same deterministic-variety
 * approach `composition/tabletop/room-seed.ts` already uses) so repeated
 * strokes at the same strength don't all generate an identical flat slab.
 */
function moduleFor(params: TerrainBrushParams): CornerHeightModule {
  const random = mulberry32(Math.floor(params.seed) || 1);
  const base = 1 - params.strength;
  const heights = [0, 1, 2, 3].map(() => lerp(base, 1, random())) as [number, number, number, number];
  return { name: "brush", cornerHeights: heights };
}

/**
 * Generates the cell under `point` -- one cell per commit, whatever
 * `params.radius` currently is (it still sizes the preview quad, giving
 * honest visual feedback of reach; painting a whole radius' worth of cells
 * per tick is future work, not done here). Dragging across cells (each
 * throttled `onPointerMove` tick lands on wherever the pointer now is)
 * already paints a swath as the stroke moves. A no-op when `point` falls
 * outside the declared terrain grid (see `cellIndexAt`).
 */
function commit(ctx: ToolContext, point: ConstructionPosition, params: TerrainBrushParams): void {
  const cell = cellIndexAt(point);
  if (cell === undefined) return;
  const sequence = ctx.nextSequence();
  const operation = buildGenerateTerrainCellOperation(
    ctx.tableId,
    `brush-terrain-${sequence}`,
    { operationId: `${ctx.tableId}:brush-terrain:${sequence}`, tableId: ctx.tableId, initiatedBy: "local" },
    cell,
    moduleFor(params),
    params.targetSurface,
  );
  ctx.runtime.generateTerrainCell(operation.payload, "local", operation.operationId);
}

export const terrainBrushTool: ConstructionTool<"terrain-brush"> = {
  id: "terrain-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["terrain-brush"],

  previewFor(gesture: ToolGesture, params: TerrainBrushParams) {
    return circleOutline(gesture.current.point, params.radius, TERRAIN_COLOR[params.targetSurface]);
  },

  onPointerDown(ctx: ToolContext, sample, params: TerrainBrushParams): void {
    commit(ctx, sample.point, params);
  },

  // The dispatcher throttles how often this fires during an active drag, so
  // every call here is already spaced out -- no extra rate-limiting needed.
  onPointerMove(ctx: ToolContext, gesture: ToolGesture, params: TerrainBrushParams): void {
    commit(ctx, gesture.current.point, params);
  },
};
