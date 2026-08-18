import {
  createGeneratePathExtrusionOperation,
  createGenerateTerrainCellOperation,
  type ConstructionOperationContext,
  type GeneratePathExtrusionOperation,
  type GenerateTerrainCellOperation,
} from "../../features/edit-construction/index.ts";
import type { CornerHeightModule, EdgeNotchSpec, GeneratePathExtrusionRequest, PathEdgeSpec } from "@/ports";

/**
 * Builds (but does not apply) a `construction.generate-path-extrusion@1`
 * operation with ids namespaced by `salt`, so two calls for the same table
 * never collide -- shared by {@link defaultMapSeed}'s one-time bootstrap
 * wall and the edit-mode UI's "generate wall" trigger, which needs a fresh
 * id namespace per click.
 */
export function buildGeneratePathExtrusionOperation(
  tableId: string,
  salt: string,
  context: ConstructionOperationContext,
  edges: readonly PathEdgeSpec[],
  height: number,
  surfaceType: string,
  notch?: EdgeNotchSpec,
): GeneratePathExtrusionOperation {
  const payload: GeneratePathExtrusionRequest = {
    edges,
    height,
    idPrefix: `${tableId}:${salt}:path`,
    surfaceType,
    notch,
  };
  return createGeneratePathExtrusionOperation(payload, context);
}

/**
 * Builds (but does not apply) a `construction.generate-terrain-cell@1`
 * operation with ids namespaced by `salt`, mirroring
 * {@link buildGeneratePathExtrusionOperation}.
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
  readonly wall: GeneratePathExtrusionOperation;
}

/**
 * Builds (but does not apply) one generated terrain cell and one plain
 * wall, so a fresh table has visible map geometry to render without
 * waiting on `E3.7`'s pointer/edit-mode UI -- the same role the guide
 * token plays for `entities/token`. Every id is namespaced by `tableId` so
 * two tables never collide inside one `ConstructionSession`.
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

  // No notch -- see `WallBrushParams`'s own doc: door generation is a
  // separate concern from a plain wall for now, not wired into this demo
  // seed either.
  const wall = buildGeneratePathExtrusionOperation(
    tableId,
    "seed",
    { operationId: `${tableId}:seed:wall`, tableId, initiatedBy },
    [{ start: { x: 2, y: 0, z: 0 }, end: { x: 2, y: 0, z: 4 }, curvature: "straight" }],
    3,
    "wall",
  );

  return { terrainCell, wall };
}
