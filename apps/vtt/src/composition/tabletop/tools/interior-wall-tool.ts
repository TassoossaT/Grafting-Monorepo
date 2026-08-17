import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { InteriorGenerateParams } from "@/features/edit-construction";

import type { ConstructionTool, PointerSample, ToolContext } from "./tool-context.ts";
import { cellsInPolygon, idPrefixForRoom, isRedundantPerimeterWall } from "./interior-partition.ts";
import { findEnclosingRoom } from "./room-lookup.ts";
import { WALL_HEIGHT } from "./wall-shared.ts";

const FLOOR_TYPE = "floor";
const CEILING_TYPE = "ceiling";
const NOTCH_TYPE = "door";
/**
 * How many cell-widths a generated wall panel may sit from the enclosing
 * room's own true (arbitrary-shape) boundary and still count as a redundant
 * copy of that boundary, not a genuine interior partition -- the region-
 * partition algorithm always redraws a wall along a cell set's own outer
 * perimeter too, and that perimeter is only a rectilinear approximation of
 * the room's real (possibly non-axis-aligned) boundary, which the exterior
 * wall tools already built. Filtered back out client-side after the engine
 * call; see `isRedundantPerimeterWall`'s own doc (`interior-partition.ts`).
 */
const BOUNDARY_DUPLICATE_TOLERANCE_CELLS = 0.5;

/**
 * One click inside an already-enclosed space (any shape, any number of
 * sides -- `findEnclosingRoom`'s own wall-follower algorithm, `"largest"`
 * preference so a click still resolves to the structure's own outermost
 * boundary even after it has already been subdivided once, not whatever
 * smaller cell the click happens to land in) rasterizes that footprint
 * into a `cellSize` grid and hands it to `generateRegionPartition` -- the
 * same region-partition Rust algorithm the retired "Pintar Casa" brush
 * drove one painted cell at a time, now driven by one click over an
 * already-drawn footprint instead. A region larger than `maxRegionCells`
 * auto-splits into more than one room; the same footprint reproduces the
 * same layout for a given `seed` (see `idPrefixForRoom`), so clicking the
 * same structure again after changing `seed`/`maxRegionCells` regenerates
 * a different layout in place rather than stacking a duplicate. The
 * engine's own floor/ceiling caps are NOT implemented as a front concept
 * yet, but are not suppressed here either (`generate_and_apply_region_partition`
 * has no opt-out for them -- see `apps/vtt/notes/0008-region-partition-needs-rework.md`,
 * which is the tracked follow-up, not a job for this tool to patch around).
 * Only wall panels that merely duplicate the room's own existing boundary
 * (the algorithm always redraws its own outer perimeter, a rectilinear
 * approximation of a possibly non-rectangular real boundary) get stripped
 * back out client-side -- see `isRedundantPerimeterWall`'s own doc
 * (`interior-partition.ts`). A click outside any enclosed space is a plain
 * no-op.
 */
export const interiorWallTool: ConstructionTool<"interior-wall"> = {
  id: "interior-wall",
  defaultParams: () => DEFAULT_TOOL_PARAMS["interior-wall"],

  onClick(ctx: ToolContext, sample: PointerSample, params: InteriorGenerateParams): void {
    const room = findEnclosingRoom(ctx, sample.point, "largest");
    if (room === undefined) return;

    const firstCorner = room.bottomCycle[0];
    const baselineY = (firstCorner !== undefined ? ctx.runtime.getSnapshot().map.nodePositions.get(firstCorner)?.position.y : undefined) ?? sample.point.y;
    const { cells, origin } = cellsInPolygon(room.polygon, params.cellSize);
    if (cells.length === 0) return;

    const outcome = ctx.runtime.generateRegionPartition(
      {
        cells,
        cellSize: params.cellSize,
        origin: { x: origin.x, y: baselineY, z: origin.z },
        wallHeight: WALL_HEIGHT,
        maxRegionCells: params.maxRegionCells,
        seed: params.seed,
        idPrefix: idPrefixForRoom(ctx.tableId, room.bottomCycle),
        wallType: params.wallType,
        notchType: NOTCH_TYPE,
        floorType: FLOOR_TYPE,
        ceilingType: CEILING_TYPE,
      },
      "local",
      `${ctx.tableId}:interior:${ctx.nextSequence()}`,
    );

    const tolerance = params.cellSize * BOUNDARY_DUPLICATE_TOLERANCE_CELLS;
    for (const surfaceKey of outcome.addedSurfaceKeys) {
      if (!isRedundantPerimeterWall(ctx, surfaceKey, room.polygon, tolerance)) continue;
      ctx.runtime.removeSurface({ surfaceKey }, "local", `${ctx.tableId}:interior-strip:${ctx.nextSequence()}`);
    }
  },
};
