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
 * far one would come back as "standing" too.
 *
 * **This call is never skipped even when there is nothing to seed with.** An
 * earlier version returned `[]` outright in that case, on the reasoning that
 * an empty seed list only ever means "nothing nearby is worth this call" --
 * wrong the one time it matters most: a stroke landing in a small gap
 * between two *already-touching* pieces of ground routinely covers neither
 * directly, yet still needs both handed back as retained so their shared
 * seam is carved out as a hole rather than regenerated over. Skipping the
 * call there dropped that hole, and the fresh grid then planted a face on an
 * edge two existing faces already shared -- "already used 2 times" -- a
 * crash, not a cosmetic slip. The caller seeds with the halo's own coverage
 * (wider than the brush's), which is what actually keeps the far-cloud case
 * above rare in practice; there is no bounds-only way to rule it out that
 * does not also risk ruling out a real seam.
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
