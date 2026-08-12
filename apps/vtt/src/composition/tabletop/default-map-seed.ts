import {
  createGenerateTerrainCellOperation,
  createGenerateWallOperation,
  type GenerateTerrainCellOperation,
  type GenerateWallOperation,
} from "../../features/edit-construction/index.ts";

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

function seededWallNodeIds(tableId: string): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const role of WALL_NODE_ROLES) ids[role] = `${tableId}:seed:wall:${role}`;
  return ids;
}

function seededWallEdgeIds(tableId: string): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const a of WALL_NODE_ROLES) {
    for (const b of WALL_NODE_ROLES) {
      if (a === b) continue;
      ids[`${a}->${b}`] = `${tableId}:seed:wall:${a}-${b}`;
    }
  }
  return ids;
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
  const terrainCell = createGenerateTerrainCellOperation(
    {
      cell: 0,
      module: { name: "flat", cornerHeights: [1, 1, 1, 1] },
      surfaceType: "terrain",
      nodeIds: [
        `${tableId}:seed:terrain:n0`,
        `${tableId}:seed:terrain:n1`,
        `${tableId}:seed:terrain:n2`,
        `${tableId}:seed:terrain:n3`,
      ],
      edgeIds: [
        `${tableId}:seed:terrain:e0`,
        `${tableId}:seed:terrain:e1`,
        `${tableId}:seed:terrain:e2`,
        `${tableId}:seed:terrain:e3`,
      ],
    },
    { operationId: `${tableId}:seed:terrain-cell`, tableId, initiatedBy },
  );

  const wall = createGenerateWallOperation(
    {
      wall: { start: { x: 2, y: 0, z: 0 }, end: { x: 2, y: 0, z: 4 }, height: 3 },
      door: { opensAt: 0.25, closesAt: 0.75 },
      wallType: "wall",
      doorType: "door",
      nodeIds: seededWallNodeIds(tableId),
      edgeIds: seededWallEdgeIds(tableId),
    },
    { operationId: `${tableId}:seed:wall`, tableId, initiatedBy },
  );

  return { terrainCell, wall };
}
