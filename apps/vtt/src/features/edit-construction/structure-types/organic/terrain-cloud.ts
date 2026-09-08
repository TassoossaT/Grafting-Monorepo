import type {
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
  ConstructionTopologyBoundsQuery,
} from "@/ports";

import type { CloudTopology } from "../../topology/construction-cloud.ts";
import { perimeterOf, type PerimeterLoop } from "../../topology/surface-perimeter.ts";

/**
 * Checks whether a surface type is an organic terrain surface.
 */
export function isTerrainSurface(surfaceType: string): boolean {
  return (
    surfaceType === "terrain" ||
    surfaceType === "terrain-grass" ||
    surfaceType.startsWith("terrain")
  );
}

/**
 * Extracts the outer and hole perimeter loops of a whole terrain cloud.
 */
export function terrainCloudPerimeter(cloud: CloudTopology): readonly PerimeterLoop[] {
  return perimeterOf(cloud.members);
}

/**
 * Computes the 2D bounding query covering a set of terrain topologies.
 */
export function terrainTopologiesBounds(
  topologies: readonly ConstructionRegionTopology[],
  margin = 4.0,
): ConstructionTopologyBoundsQuery {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const topology of topologies) {
    for (const node of topology.nodes) {
      if (node.position.x < minX) minX = node.position.x;
      if (node.position.x > maxX) maxX = node.position.x;
      if (node.position.z < minZ) minZ = node.position.z;
      if (node.position.z > maxZ) maxZ = node.position.z;
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  }

  return {
    minX: minX - margin,
    minZ: minZ - margin,
    maxX: maxX + margin,
    maxZ: maxZ + margin,
  };
}

/**
 * Fast spatial bucketing for proximity queries against cutter positions.
 */
function pointBucketIndex(points: readonly ConstructionPosition[], cellSize: number) {
  const buckets = new Map<string, ConstructionPosition[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cellSize)}:${Math.floor(z / cellSize)}`;
  for (const pt of points) {
    const k = key(pt.x, pt.z);
    const list = buckets.get(k);
    if (list === undefined) buckets.set(k, [pt]);
    else list.push(pt);
  }
  const maxDistSq = cellSize * cellSize;

  return {
    isNear(x: number, z: number): boolean {
      const col = Math.floor(x / cellSize);
      const row = Math.floor(z / cellSize);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const list = buckets.get(`${col + dx}:${row + dz}`);
          if (list !== undefined) {
            for (const pt of list) {
              const ddx = x - pt.x;
              const ddz = z - pt.z;
              if (ddx * ddx + ddz * ddz <= maxDistSq) return true;
            }
          }
        }
      }
      return false;
    },
  };
}

/**
 * Fast ray-casting point-in-polygon test with boundary tolerance for XZ plane.
 */
export function pointInOrOnPolygon(
  x: number,
  z: number,
  polygon: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]![0];
    const zi = polygon[i]![1];
    const xj = polygon[j]![0];
    const zj = polygon[j]![1];

    const dx = xj - xi;
    const dz = zj - zi;
    const lenSq = dx * dx + dz * dz;
    if (lenSq > 1e-9) {
      const t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / lenSq));
      const projX = xi + t * dx;
      const projZ = zi + t * dz;
      const ddx = x - projX;
      const ddz = z - projZ;
      if (ddx * ddx + ddz * ddz < 1e-4) return true;
    }

    const intersect = (zi > z !== zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface TerrainCloudCutRepairInput {
  /** Candidate terrain topologies in the neighborhood/bounds. */
  readonly candidateTerrain: readonly ConstructionRegionTopology[];
  /** Positions belonging to the cutter (new geometry, replaced geometry, patch nodes, outline). */
  readonly cutterPositions: readonly ConstructionPosition[];
  /** Node IDs belonging to the cutter. */
  readonly cutterNodeIds?: ReadonlySet<string>;
  /** Surface keys already confirmed covered by footprint coverage query. */
  readonly coverageSurfaceKeys?: ReadonlySet<string>;
  /** Footprint outline polygon (XZ) if available. */
  readonly footprintOutline?: readonly (readonly [number, number])[];
  /** Search reach for proximity bucketing in fallback mode (default: 1.2). */
  readonly reach?: number;
}

export interface TerrainCloudCutRepairPlan {
  /** The terrain surface keys grouped by surface type to be consumed and repaired. */
  readonly consumedByType: ReadonlyMap<string, readonly ConstructionSurfaceKey[]>;
  /** Total number of affected terrain faces. */
  readonly affectedTerrainCount: number;
  /** Whether any repair is required. */
  readonly requiresRepair: boolean;
}

/**
 * Plans the terrain cloud repair when an interfering structure (such as a path or wall)
 * cuts into the terrain cloud or modifies an existing cut corridor.
 *
 * Pure domain calculation: determines all terrain faces that share nodes with the cutter,
 * lie inside the footprint coverage, or fall within the cutter corridor.
 */
export function planTerrainCloudCutRepair(
  input: TerrainCloudCutRepairInput,
): TerrainCloudCutRepairPlan {
  const consumedByType = new Map<string, ConstructionSurfaceKey[]>();
  if (input.candidateTerrain.length === 0 || input.cutterPositions.length === 0) {
    return {
      consumedByType,
      affectedTerrainCount: 0,
      requiresRepair: false,
    };
  }

  const cutterNodeIds = input.cutterNodeIds ?? new Set<string>();
  const coverageKeys = input.coverageSurfaceKeys ?? new Set<string>();
  const outline = input.footprintOutline && input.footprintOutline.length >= 3 ? input.footprintOutline : undefined;
  const hasExactTargeting = coverageKeys.size > 0 || outline !== undefined;

  // Proximity bucketing is ONLY used as a tight fallback when neither coverage query
  // nor footprint outline is provided (e.g. synthetic test harnesses).
  // When exact targeting is available, broad proximity bucketing is skipped to avoid
  // deleting innocent terrain faces, which causes fragmentation and lag.
  const reach = input.reach ?? (hasExactTargeting ? 0 : 1.2);
  const indexer = !hasExactTargeting && reach > 0 ? pointBucketIndex(input.cutterPositions, reach) : undefined;

  let totalCount = 0;
  for (const t of input.candidateTerrain) {
    if (!isTerrainSurface(t.surfaceType)) continue;

    // 1. Shares a node with the cutter (or replaced geometry)
    const sharesNode = t.nodes.some((n) => cutterNodeIds.has(n.id));

    // 2. Explicitly covered by the engine's footprint coverage query
    const inCoverage = coverageKeys.has(t.surfaceKey.join("/")) || coverageKeys.has(t.surfaceKey.join(":"));

    // 3. Centroid or any vertex inside or on the footprint outline polygon
    let insideOutline = false;
    if (outline !== undefined && !inCoverage) {
      const cx = t.nodes.length > 0 ? t.nodes.reduce((sum, n) => sum + n.position.x, 0) / t.nodes.length : 0;
      const cz = t.nodes.length > 0 ? t.nodes.reduce((sum, n) => sum + n.position.z, 0) / t.nodes.length : 0;
      insideOutline = pointInOrOnPolygon(cx, cz, outline) || t.nodes.some((n) => pointInOrOnPolygon(n.position.x, n.position.z, outline));
    }

    // 4. Tight fallback proximity (only when neither coverage query nor outline is available)
    let nearCutter = false;
    if (!hasExactTargeting && indexer !== undefined) {
      const cx = t.nodes.length > 0 ? t.nodes.reduce((sum, n) => sum + n.position.x, 0) / t.nodes.length : 0;
      const cz = t.nodes.length > 0 ? t.nodes.reduce((sum, n) => sum + n.position.z, 0) / t.nodes.length : 0;
      nearCutter = indexer.isNear(cx, cz) || t.nodes.some((n) => indexer.isNear(n.position.x, n.position.z));
    }

    if (sharesNode || inCoverage || insideOutline || nearCutter) {
      const keys = consumedByType.get(t.surfaceType) ?? [];
      keys.push(t.surfaceKey);
      consumedByType.set(t.surfaceType, keys);
      totalCount += 1;
    }
  }

  return {
    consumedByType,
    affectedTerrainCount: totalCount,
    requiresRepair: totalCount > 0,
  };
}
