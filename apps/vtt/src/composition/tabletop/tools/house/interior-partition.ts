import type { CellCoordinate, ConstructionNodeId, ConstructionPosition } from "@/ports";

import type { ToolContext } from "../core/tool-context.ts";

import {
  distanceToPolygonBoundaryXZ,
  pointInPolygonXZ,
  type PointXZ,
} from "../shapes/geometry-2d.ts";

export type Vec2 = PointXZ;

const pointInPolygon = pointInPolygonXZ;
const distanceToPolygonBoundary = distanceToPolygonBoundaryXZ;

/** Every integer grid cell (in a local, `origin`-relative grid) whose own center falls inside `polygon`, plus the world-space `origin` that grid is anchored to. */
export function cellsInPolygon(polygon: readonly Vec2[], cellSize: number): { readonly cells: readonly CellCoordinate[]; readonly origin: Vec2 } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  const origin: Vec2 = { x: Math.floor(minX / cellSize) * cellSize, z: Math.floor(minZ / cellSize) * cellSize };
  const columns = Math.ceil((maxX - origin.x) / cellSize);
  const rows = Math.ceil((maxZ - origin.z) / cellSize);

  const cells: CellCoordinate[] = [];
  for (let z = 0; z < rows; z += 1) {
    for (let x = 0; x < columns; x += 1) {
      const center: Vec2 = { x: origin.x + (x + 0.5) * cellSize, z: origin.z + (z + 0.5) * cellSize };
      if (pointInPolygon(center, polygon)) cells.push({ x, z });
    }
  }
  return { cells, origin };
}

/** FNV-1a, base36 -- just needs to be short, deterministic, and (in practice) collision-free, not cryptographic. */
function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** A stable id prefix for one specific enclosed room, derived from its own boundary nodes -- re-clicking the same room regenerates/diffs against its own prior attempt (e.g. after changing `seed`) instead of stacking a duplicate. */
export function idPrefixForRoom(tableId: string, bottomCycle: readonly ConstructionNodeId[]): string {
  return `${tableId}:interior:${hashString([...bottomCycle].sort().join("|"))}`;
}

/**
 * True if a wall panel's own midpoint (between its two vertical posts, not
 * its 4 individual corners) sits within `tolerance` of the room's own true
 * boundary -- see `interior-wall-tool.ts`'s own `BOUNDARY_DUPLICATE_TOLERANCE_CELLS`
 * doc for why the region-partition algorithm's own redrawn perimeter needs
 * filtering back out. The midpoint, not the corners, is what actually
 * distinguishes a redundant duplicate (a short run that itself lies along
 * the boundary) from a genuine interior partition wall that legitimately
 * *starts and ends* on the boundary while cutting across open interior
 * space in between -- checking corners alone would wrongly strip every
 * ordinary wall-to-wall partition, since both its ends are expected to
 * touch the boundary.
 */
export function isRedundantPerimeterWall(ctx: ToolContext, surfaceKey: readonly ConstructionNodeId[], polygon: readonly Vec2[], tolerance: number): boolean {
  const map = ctx.runtime.getSnapshot().map;
  const positions = surfaceKey.map((id) => map.nodePositions.get(id)?.position).filter((position): position is ConstructionPosition => position !== undefined);
  if (positions.length !== 4) return false;

  const [first, ...rest] = positions;
  if (first === undefined) return false;
  const sameXz = (a: ConstructionPosition, b: ConstructionPosition) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.z - b.z) < 1e-3;
  const otherPost = rest.find((position) => !sameXz(position, first));
  if (otherPost === undefined) return false;

  const midpoint: Vec2 = { x: (first.x + otherPost.x) / 2, z: (first.z + otherPost.z) / 2 };
  return distanceToPolygonBoundary(midpoint, polygon) <= tolerance;
}
