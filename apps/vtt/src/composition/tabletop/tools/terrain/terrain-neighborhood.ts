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
  cloudFor(request: {
    readonly seed: ConstructionSurfaceKey;
    readonly surfaceType: string;
  }): { readonly surfaceKeys: readonly ConstructionSurfaceKey[] };
  getRegionTopologiesInBounds(bounds: TerrainStrokeBounds): readonly ConstructionRegionTopology[];
}

function surfaceKeyId(surfaceKey: readonly string[]): string {
  return surfaceKey.join("\u0000");
}

/** Local topology belonging only to connected terrain the stroke touched. */
export function terrainStandingAround(
  runtime: TerrainNeighbourhoodRuntime,
  covered: readonly ConstructionCoveredRegion[],
  within: TerrainStrokeBounds,
  reach: number,
): readonly ConstructionRegionTopology[] {
  const allowed = new Set<string>();
  for (const region of covered) {
    if (allowed.has(surfaceKeyId(region.surfaceKey))) continue;
    const cloud = runtime.cloudFor({ seed: region.surfaceKey, surfaceType: region.surfaceType });
    for (const surfaceKey of cloud.surfaceKeys) allowed.add(surfaceKeyId(surfaceKey));
    allowed.add(surfaceKeyId(region.surfaceKey));
  }

  return runtime.getRegionTopologiesInBounds({
    minX: within.minX - reach,
    minZ: within.minZ - reach,
    maxX: within.maxX + reach,
    maxZ: within.maxZ + reach,
  }).filter((topology) => allowed.has(surfaceKeyId(topology.surfaceKey)));
}
