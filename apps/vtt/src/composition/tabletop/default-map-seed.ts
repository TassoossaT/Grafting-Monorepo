import {
  createGenerateTerrainCellOperation,
  createGenerateWallOperation,
  type ConstructionOperationContext,
  type GenerateTerrainCellOperation,
  type GenerateWallOperation,
} from "../../features/edit-construction/index.ts";
import type { CornerHeightModule, DoorOpening, GenerateWallRequest, WallSegment } from "@/ports";

/**
 * Every `WallNodeRole` wire name `grafting-procgen-construction-wasm`'s
 * `dto.rs` defines. Duplicated here (not derived from the Wasm ABI, which
 * exposes no role vocabulary as data) purely to build a seed wall's
 * `nodeIds`/`edgeIds` maps -- the same full-table approach
 * `construction-wasm`'s own Rust tests use, since only `generate_wall`
 * itself knows which subset a given door configuration actually reads.
 */
const WALL_NODE_ROLES = [
  "startBottom",
  "startTop",
  "endBottom",
  "endTop",
  "doorStartBottom",
  "doorStartTop",
  "doorEndBottom",
  "doorEndTop",
] as const;

function wallNodeIds(tableId: string, salt: string): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const role of WALL_NODE_ROLES) ids[role] = `${tableId}:${salt}:wall:${role}`;
  return ids;
}

function wallEdgeIds(tableId: string, salt: string): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const a of WALL_NODE_ROLES) {
    for (const b of WALL_NODE_ROLES) {
      if (a === b) continue;
      ids[`${a}->${b}`] = `${tableId}:${salt}:wall:${a}-${b}`;
    }
  }
  return ids;
}

/**
 * Builds (but does not apply) a `construction.generate-wall@1` operation
 * with ids namespaced by `salt`, so two calls for the same table never
 * collide -- shared by {@link defaultMapSeed}'s one-time bootstrap wall and
 * the edit-mode UI's "generate wall" trigger, which needs a fresh id
 * namespace per click.
 */
export function buildGenerateWallOperation(
  tableId: string,
  salt: string,
  context: ConstructionOperationContext,
  wall: WallSegment,
  door: DoorOpening | undefined,
  wallType: string,
  doorType: string,
): GenerateWallOperation {
  const payload: GenerateWallRequest = {
    wall,
    door,
    wallType,
    doorType,
    nodeIds: wallNodeIds(tableId, salt),
    edgeIds: wallEdgeIds(tableId, salt),
  };
  return createGenerateWallOperation(payload, context);
}

/**
 * Builds (but does not apply) a `construction.generate-terrain-cell@1`
 * operation with ids namespaced by `salt`, mirroring
 * {@link buildGenerateWallOperation}.
 */
export function buildGenerateTerrainCellOperation(
  tableId: string,
  salt: string,
  context: ConstructionOperationContext,
  cell: number,
  module: CornerHeightModule,
  surfaceType: string,
): GenerateTerrainCellOperation {
  return createGenerateTerrainCellOperation(
    {
      cell,
      module,
      surfaceType,
      nodeIds: [
        `${tableId}:${salt}:terrain:n0`,
        `${tableId}:${salt}:terrain:n1`,
        `${tableId}:${salt}:terrain:n2`,
        `${tableId}:${salt}:terrain:n3`,
      ],
      edgeIds: [
        `${tableId}:${salt}:terrain:e0`,
        `${tableId}:${salt}:terrain:e1`,
        `${tableId}:${salt}:terrain:e2`,
        `${tableId}:${salt}:terrain:e3`,
      ],
    },
    context,
  );
}

export interface DefaultMapSeed {
  readonly terrainCell: GenerateTerrainCellOperation;
  readonly wall: GenerateWallOperation;
}

/**
 * Builds (but does not apply) one generated terrain cell and one
 * wall-with-door, so a fresh table has visible map geometry to render
 * without waiting on `E3.7`'s pointer/edit-mode UI -- the same role the
 * guide token plays for `entities/token`. Every id is namespaced by
 * `tableId` so two tables never collide inside one `ConstructionSession`.
 */
export function defaultMapSeed(tableId: string, initiatedBy: string): DefaultMapSeed {
  const terrainCell = buildGenerateTerrainCellOperation(
    tableId,
    "seed",
    { operationId: `${tableId}:seed:terrain-cell`, tableId, initiatedBy },
    0,
    { name: "flat", cornerHeights: [1, 1, 1, 1] },
    "terrain",
  );

  const wall = buildGenerateWallOperation(
    tableId,
    "seed",
    { operationId: `${tableId}:seed:wall`, tableId, initiatedBy },
    { start: { x: 2, y: 0, z: 0 }, end: { x: 2, y: 0, z: 4 }, height: 3 },
    { opensAt: 0.25, closesAt: 0.75 },
    "wall",
    "door",
  );

  return { terrainCell, wall };
}
