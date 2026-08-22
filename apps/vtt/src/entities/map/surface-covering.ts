/**
 * What fills a construction surface visually.
 *
 * `ADR-0022`/`DEC-060` layers construction as graph -> mesh -> surface ->
 * asset. This module is the beginning of that last layer: the one place that
 * decides what a surface looks like, separated from the geometry that decides
 * where it is.
 *
 * Before this existed, the answer was derived inside the render adapter, which
 * meant presentation policy lived downstream of the port it was supposed to
 * feed. A surface has exactly one covering, resolved here, and everything
 * downstream only draws what it is handed.
 *
 * See `docs/architecture/vtt-surface-covering-transformation-plan.md`.
 */

/**
 * Which covering fills a surface.
 *
 * Deliberately an open string rather than a union: `DEC-052`/`ADR-0014` forbid
 * baking product concepts into infrastructure, and `ADR-0022` already had to
 * correct one closed enum (`BoundaryKind`). New kinds -- an unfilled opening, a
 * repeated unit asset, a decal -- must cost a registration, never an edit to a
 * type every consumer recompiles against.
 */
export type CoveringKind = string;

/**
 * The only kind this phase ships: the surface mesh is drawn, flat-shaded.
 *
 * Named rather than assumed because it is about to stop being the only
 * possibility. A covering that draws nothing (`"none"`, for a barred gate or an
 * open doorway) and one that places repeated unit geometry are the next two,
 * and neither is a special case of this one.
 */
export const PAINTED_COVERING_KIND: CoveringKind = "painted";

/** A surface's resolved visual fill. */
export interface SurfaceCovering {
  /** Which covering kind fills the surface. */
  readonly kind: CoveringKind;
  /**
   * Batching identity: two surfaces sharing this key may merge into one render
   * buffer, and two that do not share it must not.
   *
   * Spatial bucketing alone is not enough -- a bucket holding a wall and a
   * terrain cell would otherwise merge them and take one of their
   * classifications for both.
   */
  readonly key: string;
  /** Flat classification color, until a real material/asset pipeline exists (`E4.2`). */
  readonly color: number;
}

/**
 * Flat classification color for a surface type.
 *
 * A placeholder, and deliberately so: it exists only to make generated geometry
 * visually distinguishable while nothing else renders it. Moved here from the
 * render adapter unchanged -- same inputs, same colors -- because deciding what
 * a product's surfaces look like is product policy, not renderer translation.
 */
export function colorForSurfaceType(surfaceType: string, physical: boolean): number {
  if (!physical) return 0x3a6b8a;
  switch (surfaceType) {
    case "wall":
    case "wall-white":
      return 0xe2e8f0; // White / light gray block prototype
    case "wall-gray":
      return 0x64748b; // Slate gray block prototype
    case "terrain":
      return 0x334155; // Dark Slate / Construction floor grid
    case "terrain-grass":
      return 0x4a7a4a; // Grass green
    case "path":
      return 0xc084fc; // Purple path formation
    default:
      return 0x94a3b8;
  }
}

/**
 * Resolves the covering for one surface.
 *
 * The single decision point this module exists for. Today every surface
 * resolves to {@link PAINTED_COVERING_KIND}, reproducing the previous
 * behaviour exactly; changing that is a change here and nowhere else.
 */
export function resolveSurfaceCovering(surfaceType: string, physical: boolean): SurfaceCovering {
  const color = colorForSurfaceType(surfaceType, physical);
  return {
    kind: PAINTED_COVERING_KIND,
    key: `${PAINTED_COVERING_KIND}:${color.toString(16)}`,
    color,
  };
}
