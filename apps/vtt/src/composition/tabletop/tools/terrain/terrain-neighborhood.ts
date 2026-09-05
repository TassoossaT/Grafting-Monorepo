import type {
  ConstructionCoveredRegion,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

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

/** Local topology belonging only to connected terrain the stroke touched. */
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
