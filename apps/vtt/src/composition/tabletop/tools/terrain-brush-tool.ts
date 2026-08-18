import { lerp, mulberry32 } from "@/ui";
import { DEFAULT_TOOL_PARAMS, resolveBrushShape } from "@/features/edit-construction";
import type { TerrainBrushParams } from "@/features/edit-construction";
import type { CornerHeightModule } from "@/ports";

import { buildGenerateTerrainCellOperation } from "../default-map-seed.ts";
import { TERRAIN_GRID_HEIGHT, TERRAIN_GRID_WIDTH } from "../tabletop-runtime.ts";
import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { brushStrokeOutline } from "./preview-shapes.ts";

const TERRAIN_COLOR: Record<TerrainBrushParams["targetSurface"], number> = {
  terrain: 0x334155,
  "terrain-grass": 0x4a7a4a,
};

let paintedCells = new Set<number>();

function moduleFor(params: TerrainBrushParams, cell: number): CornerHeightModule {
  const random = mulberry32(Math.floor(params.seed + cell) || 1);
  const base = 1 - params.strength;
  const heights = [0, 1, 2, 3].map(() => lerp(base, 1, random())) as [number, number, number, number];
  return { name: "brush", cornerHeights: heights };
}

function commitCell(ctx: ToolContext, cell: number, params: TerrainBrushParams): void {
  if (paintedCells.has(cell)) return;
  paintedCells.add(cell);
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

function commitGesture(ctx: ToolContext, samples: readonly PointerSample[], params: TerrainBrushParams): void {
  const cells = ctx.runtime.resolveBrushCells({
    samples: samples.map((sample) => sample.point),
    brushShape: resolveBrushShape(params),
    width: TERRAIN_GRID_WIDTH,
    height: TERRAIN_GRID_HEIGHT,
  });
  for (const cell of cells) commitCell(ctx, cell, params);
  if (cells.length > 0) {
    ctx.reportFeedback({ tone: "success", message: `Pincel de terreno: ${paintedCells.size} células na footprint Rust.` });
  }
}

export const terrainBrushTool: ConstructionTool<"terrain-brush"> = {
  id: "terrain-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["terrain-brush"],

  previewFor(gesture: ToolGesture, params: TerrainBrushParams) {
    const shape = resolveBrushShape(params);
    return brushStrokeOutline(
      gesture.samples.map((sample) => sample.point),
      shape.kind === "square"
        ? { kind: shape.kind, radius: shape.size / 2, rotationRadians: shape.rotationRadians }
        : shape,
      TERRAIN_COLOR[params.targetSurface],
    );
  },

  onPointerDown(ctx: ToolContext, sample: PointerSample, params: TerrainBrushParams): void {
    paintedCells = new Set();
    commitGesture(ctx, [sample], params);
  },

  onPointerMove(ctx: ToolContext, gesture: ToolGesture, params: TerrainBrushParams): void {
    commitGesture(ctx, gesture.samples, params);
  },

  onPointerUp(): void {
    paintedCells = new Set();
  },
};