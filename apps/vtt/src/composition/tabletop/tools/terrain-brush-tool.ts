import { lerp, mulberry32 } from "@/ui";
import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { TerrainBrushParams } from "@/features/edit-construction";
import type { CornerHeightModule } from "@/ports";

import { buildGenerateTerrainCellOperation } from "../default-map-seed.ts";
import { TERRAIN_GRID_HEIGHT, TERRAIN_GRID_WIDTH } from "../tabletop-runtime.ts";
import type { ToolContext } from "./tool-context.ts";
import { createBrushTool } from "./brush-tool.ts";

const TERRAIN_COLOR: Record<TerrainBrushParams["targetSurface"], number> = {
  terrain: 0x334155,
  "terrain-grass": 0x4a7a4a,
};

function moduleFor(params: TerrainBrushParams, cell: number): CornerHeightModule {
  const random = mulberry32(Math.floor(params.seed + cell) || 1);
  const base = 1 - params.strength;
  const heights = [0, 1, 2, 3].map(() => lerp(base, 1, random())) as [number, number, number, number];
  return { name: "brush", cornerHeights: heights };
}

function paintCell(ctx: ToolContext, cell: number, params: TerrainBrushParams): void {
  const sequence = ctx.nextSequence();
  const operation = buildGenerateTerrainCellOperation(
    ctx.tableId,
    `brush-terrain-${sequence}`,
    { operationId: `${ctx.tableId}:brush-terrain:${sequence}`, tableId: ctx.tableId, initiatedBy: "local" },
    cell,
    moduleFor(params, cell),
    params.targetSurface,
  );
  try {
    ctx.runtime.generateTerrainCell(operation.payload, "local", operation.operationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.reportFeedback({ tone: "error", message: `Terreno não aplicado: ${message}` });
  }
}

/**
 * Terrain-brush's own effect. The brush hands over one region -- the whole
 * gesture, once, on release, never while dragging. Today this still asks
 * Rust which grid cells that region touches and paints each one with its
 * own call, because Rust has no whole-region terrain generator yet; that's
 * a stand-in for a real region-based paint (owner's own call, tracked
 * separately), not something the brush itself should know or care about.
 */
export const terrainBrushTool = createBrushTool<"terrain-brush">({
  id: "terrain-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["terrain-brush"],
  previewColor: (params) => TERRAIN_COLOR[params.targetSurface],

  applyRegion(region, ctx, params) {
    const cells = ctx.runtime.resolveBrushCells({
      samples: region.samples,
      brushShape: region.shape,
      width: TERRAIN_GRID_WIDTH,
      height: TERRAIN_GRID_HEIGHT,
    });
    const painted = new Set(cells);
    for (const cell of painted) paintCell(ctx, cell, params);
    if (painted.size > 0) {
      ctx.reportFeedback({ tone: "success", message: `Pincel de terreno: ${painted.size} células na footprint Rust.` });
    }
  },
});
