import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { HouseBrushParams } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { quadAround } from "./preview-shapes.ts";

const WALL_COLOR = 0xe2e8f0;
const WALL_HEIGHT = 3;

interface CellCoord {
  readonly x: number;
  readonly z: number;
}

function cellKey(cell: CellCoord): string {
  return `${cell.x},${cell.z}`;
}

function cellFromKey(key: string): CellCoord {
  const [x, z] = key.split(",").map(Number);
  return { x: x ?? 0, z: z ?? 0 };
}

function cellAt(point: ConstructionPosition, cellSize: number): CellCoord {
  return { x: Math.floor(point.x / cellSize), z: Math.floor(point.z / cellSize) };
}

/** Same position-derived id format as `cell_partition::corner_id` -- must stay byte-identical so a live node lookup here matches what the Rust side minted. */
function cornerId(idPrefix: string, x: number, z: number, top: boolean): string {
  return `${idPrefix}:corner:${x.toFixed(3)}:${z.toFixed(3)}:${top ? "top" : "bottom"}`;
}

/** The cell's own bottom-left corner's live Y, or `undefined` if that corner (and so the cell) was never painted under `idPrefix`. Checking one corner is enough: `cell_partition` always mints all 4 of a painted cell's bottom corners together. */
function paintedCellY(ctx: ToolContext, idPrefix: string, cell: CellCoord, cellSize: number): number | undefined {
  const id = cornerId(idPrefix, cell.x * cellSize, cell.z * cellSize, false);
  return ctx.runtime.getSnapshot().map.nodePositions.get(id)?.position.y;
}

const NEIGHBOR_OFFSETS: readonly CellCoord[] = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

/**
 * Flood-fills outward from `start` over already-painted cells (a live
 * query against the current snapshot, same "no client-side memory of
 * prior structures" principle `findEnclosingRoom` uses) -- this is what
 * lets continuing to paint over a house built in an earlier stroke
 * reformulate it, instead of only ever growing from an empty table.
 * `start` itself unpainted returns an empty set and no `originY` (a fresh
 * structure, nothing to inherit).
 */
function existingStructureNear(
  ctx: ToolContext,
  idPrefix: string,
  start: CellCoord,
  cellSize: number,
): { readonly cells: ReadonlySet<string>; readonly originY: number | undefined } {
  const startY = paintedCellY(ctx, idPrefix, start, cellSize);
  if (startY === undefined) return { cells: new Set(), originY: undefined };

  const cells = new Set<string>([cellKey(start)]);
  const stack: CellCoord[] = [start];
  while (stack.length > 0) {
    const cell = stack.pop();
    if (cell === undefined) continue;
    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = { x: cell.x + offset.x, z: cell.z + offset.z };
      const key = cellKey(neighbor);
      if (cells.has(key)) continue;
      if (paintedCellY(ctx, idPrefix, neighbor, cellSize) === undefined) continue;
      cells.add(key);
      stack.push(neighbor);
    }
  }
  return { cells, originY: startY };
}

interface BrushSession {
  readonly idPrefix: string;
  readonly cellSize: number;
  readonly maxRoomCells: number;
  readonly seed: number;
  readonly originY: number;
  readonly cells: Set<string>;
}

/** The current gesture's own accumulated cell set -- dies with the gesture, same lifetime as `irregular-terrain-tool.ts`'s own `activeSession`. Every tick resends the whole set (see `GenerateCellPartitionRequest`'s own doc for why that's cheap), so no state needs to survive past `onPointerUp`. */
let activeSession: BrushSession | undefined;

function commit(ctx: ToolContext, session: BrushSession): void {
  const sequence = ctx.nextSequence();
  ctx.runtime.generateCellPartition(
    {
      cells: [...session.cells].map(cellFromKey),
      cellSize: session.cellSize,
      origin: { x: 0, y: session.originY, z: 0 },
      wallHeight: WALL_HEIGHT,
      maxRoomCells: session.maxRoomCells,
      seed: session.seed,
      idPrefix: session.idPrefix,
      wallType: "wall-white",
      doorType: "door",
      floorType: "floor",
      ceilingType: "ceiling",
    },
    "local",
    `${ctx.tableId}:brush-house:${sequence}`,
  );
}

function paint(ctx: ToolContext, point: ConstructionPosition, params: HouseBrushParams): void {
  const idPrefix = `${ctx.tableId}:house-brush`;
  const cellSize = params.cellSize;
  const cell = cellAt(point, cellSize);

  if (activeSession === undefined) {
    const { cells, originY } = existingStructureNear(ctx, idPrefix, cell, cellSize);
    activeSession = {
      idPrefix,
      cellSize,
      maxRoomCells: Math.max(1, Math.round(params.maxRoomCells)),
      seed: params.seed,
      originY: originY ?? point.y,
      cells: new Set(cells),
    };
  }
  activeSession.cells.add(cellKey(cell));
  commit(ctx, activeSession);
}

/**
 * Paint cells continuously, same feel as `terrain-brush-tool.ts`, and let
 * the Rust side decide every tick whether the painted region grows the
 * current room, splits into more, or starts a new one -- "Pintar Casa,"
 * replacing the old one-shot `house-stamp`/drag-a-fixed-rectangle
 * `house-room-add`. All partition/wall/id math happens on the Rust side
 * (`ConstructionSessionPort.generateCellPartition` ->
 * `grafting_procgen_construction_wasm::cell_partition::generate_and_apply_cell_partition`);
 * this tool only resolves which cell the pointer is over and which cells
 * an existing structure nearby already owns.
 */
export const houseBrushTool: ConstructionTool<"house-brush"> = {
  id: "house-brush",
  defaultParams: () => DEFAULT_TOOL_PARAMS["house-brush"],

  previewFor(gesture: ToolGesture, params: HouseBrushParams) {
    const cell = cellAt(gesture.current.point, params.cellSize);
    const center: ConstructionPosition = {
      x: (cell.x + 0.5) * params.cellSize,
      y: gesture.current.point.y,
      z: (cell.z + 0.5) * params.cellSize,
    };
    return quadAround(center, params.cellSize / 2, WALL_COLOR);
  },

  onPointerDown(ctx: ToolContext, sample: PointerSample, params: HouseBrushParams): void {
    paint(ctx, sample.point, params);
  },

  // The dispatcher throttles how often this fires during an active drag,
  // same safety net terrain-brush-tool.ts already relies on.
  onPointerMove(ctx: ToolContext, gesture: ToolGesture, params: HouseBrushParams): void {
    paint(ctx, gesture.current.point, params);
  },

  onPointerUp(): void {
    activeSession = undefined;
  },
};
