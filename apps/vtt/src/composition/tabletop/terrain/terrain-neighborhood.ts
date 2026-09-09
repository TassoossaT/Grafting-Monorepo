import type {
  ConstructionCoveredRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import type { TerrainFillRuntime } from "./terrain-fill.ts";

export interface TerrainStrokeBounds {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export interface TerrainNeighbourhoodRuntime {
  getRegionTopologiesInBounds(bounds: TerrainStrokeBounds & {
    readonly seeds?: readonly { readonly seed: ConstructionSurfaceKey; readonly surfaceType: string }[];
  }): readonly ConstructionRegionTopology[];
}

/**
 * What laying ground over standing ground needs of the runtime, structurally.
 *
 * Lives here rather than beside either caller because both the sculpt brush
 * and a cut's repair go through one executor now, and the executor is what
 * reads the neighbourhood.
 */
export interface TerrainCutRuntime extends TerrainFillRuntime {
  getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined;
}

/**
 * Local topology belonging only to connected terrain the stroke touched.
 *
 * **`seeds` is the whole point.** Bounds alone answer "every region in this
 * box", which on a real table is most of the map: an unrelated field two
 * metres away comes back and is treated as ground to reconcile with. Seeded by
 * the regions the area actually covers, the query answers the narrower and
 * correct question -- the ground *connected to* what was touched.
 */
export function terrainStandingAround(
  runtime: TerrainNeighbourhoodRuntime,
  covered: readonly ConstructionCoveredRegion[],
  within: TerrainStrokeBounds,
  reach: number,
): readonly ConstructionRegionTopology[] {
  return runtime.getRegionTopologiesInBounds({
    minX: within.minX - reach,
    minZ: within.minZ - reach,
    maxX: within.maxX + reach,
    maxZ: within.maxZ + reach,
    seeds: covered.map((region) => ({ seed: region.surfaceKey, surfaceType: region.surfaceType })),
  });
}

/**
 * Heights sampled from the ground around an area, so what is laid inside it
 * lands at the height of what surrounds it.
 *
 * Bucketed by a cell the size of the query radius, so a lookup reads nine
 * buckets rather than every anchor. Locality is the point and not only the
 * speed: a global inverse-distance blend drags every new corner toward the
 * mean height of the whole neighbourhood, which flattens relief that was
 * there. Only anchors within a couple of faces get a say, and the relief
 * survives.
 */
export interface HeightField {
  at(point: { readonly x: number; readonly z: number }): number | undefined;
}

export function heightFieldOf(anchors: readonly ConstructionPosition[], reach: number): HeightField {
  const buckets = new Map<string, ConstructionPosition[]>();
  const key = (x: number, z: number) => `${Math.floor(x / reach)}:${Math.floor(z / reach)}`;
  for (const anchor of anchors) {
    const at = key(anchor.x, anchor.z);
    const bucket = buckets.get(at);
    if (bucket === undefined) buckets.set(at, [anchor]);
    else bucket.push(anchor);
  }

  return {
    at(point) {
      const column = Math.floor(point.x / reach);
      const row = Math.floor(point.z / reach);
      let weighted = 0;
      let total = 0;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const anchor of buckets.get(`${column + dx}:${row + dz}`) ?? []) {
            const ax = anchor.x - point.x;
            const az = anchor.z - point.z;
            const distanceSq = ax * ax + az * az;
            // Sitting on an anchor is that anchor's height, not a division by zero.
            if (distanceSq < 1e-9) return anchor.y;
            if (distanceSq > reach * reach) continue;
            const weight = 1 / distanceSq;
            weighted += anchor.y * weight;
            total += weight;
          }
        }
      }
      // Nothing near enough to have an opinion -- this is new ground, and the
      // caller's own rule decides.
      return total > 0 ? weighted / total : undefined;
    },
  };
}
