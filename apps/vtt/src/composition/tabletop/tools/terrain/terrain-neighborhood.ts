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

/**
 * Local topology belonging only to connected terrain the stroke touched.
 *
 * With no seed at all, the engine falls back to an unfiltered bounds scan --
 * every region of any type whose any node lands in the box, connected to
 * nothing. That box is wider than the brush (`reach` pads it further still),
 * so two separate clouds placed close but never touching can share it: the
 * far one would come back as "standing" and get folded into this stroke's
 * fill boundary and hole rings, picking up stray nodes on its own seam every
 * time this stroke repaints, though it was never touched. Skipping the call
 * when there is nothing to seed with keeps that fallback for callers that
 * actually want it, and out of this one.
 */
export function terrainStandingAround(
  runtime: TerrainNeighbourhoodRuntime,
  covered: readonly ConstructionCoveredRegion[],
  within: TerrainStrokeBounds,
  reach: number,
): readonly ConstructionRegionTopology[] {
  if (covered.length === 0) return [];
  return runtime.getRegionTopologiesInBounds({
    minX: within.minX - reach,
    minZ: within.minZ - reach,
    maxX: within.maxX + reach,
    maxZ: within.maxZ + reach,
    seeds: covered.map((region) => ({ seed: region.surfaceKey, surfaceType: region.surfaceType })),
  });
}
