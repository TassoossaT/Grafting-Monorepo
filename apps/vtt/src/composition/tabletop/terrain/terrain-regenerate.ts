import type { ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";
import type { CutFallout } from "@/features/edit-construction";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. The type-only
// `@/` imports above are fine -- those are erased.
import { executeTerrainCut } from "./terrain-cut-executor.ts";
import { DEFAULT_FACE_SIDE } from "./terrain-fill.ts";
import type { TerrainCutRuntime } from "./terrain-neighborhood.ts";

/**
 * Growing terrain back where something cut through it.
 *
 * **This is not its own generator any more, and that is the whole change.**
 * For a long time a repair had a pipeline of its own: it took the perimeter of
 * the faces it was told to consume straight from the graph, took the painter's
 * contour from a second, independent walk of the graph, and handed the first
 * down as a boundary and the second down as holes. Nothing reconciled the two,
 * because nothing ever put them through one operation. So they disagreed, and
 * the shape of the disagreement was always the same: the painter is a *ribbon*
 * that runs across the ground and out the far side, not an island inside it, so
 * "boundary here, hole there" describes a figure whose hole pierces its own
 * rim. The generator answered that with cells laid over the painter's own
 * contour edges, and the engine refused each of them -- "no room on edge, its
 * one free side faces the other way" -- which, because the replacement is
 * atomic, cost the entire repair while the edge splits its adoption pass had
 * already committed stayed behind. Ground did not come back, and vertices piled
 * up along the rim of the hole that was supposed to have disappeared.
 *
 * The sculpt brush never had that problem, and not because it is luckier: it
 * unions the faces it is replacing into one polygon and derives boundary *and*
 * holes from that single result, so there is nothing for two derivations to
 * disagree about. A repair is the same operation with the painter subtracted
 * rather than nothing subtracted. So it is now literally the same call --
 * {@link executeTerrainCut} with a `regenerate` profile, whose displacement is
 * zero, so the ground comes back at the height of the ground around it.
 *
 * What that buys beyond the bug: the repair gets the brush's connected
 * neighbourhood query for free, so it is constrained by the terrain that
 * survived instead of by the terrain being deleted, and it samples heights
 * from ground that will still be standing afterwards. Both were backwards
 * before.
 *
 * What it still does not do is restore. The mesh is regenerated, so a road
 * drawn and erased leaves terrain of a different shape than before -- the
 * accepted trade rather than keeping a shadow copy of the ground a cut removed.
 */

export type { HeightField } from "./terrain-neighborhood.ts";
export { heightFieldOf } from "./terrain-neighborhood.ts";

/** @deprecated Name kept for existing importers; see {@link TerrainCutRuntime}. */
export type TerrainRegenerateRuntime = TerrainCutRuntime;

/**
 * The extent to work in when the dispatcher had no footprint to give.
 *
 * A removal repair -- ground regrowing because the thing standing in it was
 * deleted -- has no painter and therefore no footprint. The hole itself is the
 * only area there is, so it becomes the area.
 */
function outlineAroundConsumed(
  consumed: readonly ConstructionRegionTopology[],
): readonly (readonly [number, number])[] {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const topology of consumed) {
    for (const node of topology.nodes) {
      if (node.position.x < minX) minX = node.position.x;
      if (node.position.x > maxX) maxX = node.position.x;
      if (node.position.z < minZ) minZ = node.position.z;
      if (node.position.z > maxZ) maxZ = node.position.z;
    }
  }
  if (!Number.isFinite(minX)) return [];
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ];
}

/**
 * Terrain's `CutRepairExecutor`: grow the ground back around the thing that
 * cut it.
 *
 * Everything this decides is which *request* the shared executor gets. The
 * consumed faces become the covered regions, so they are what gets replaced;
 * the painter's footprint becomes the area, so the neighbourhood is gathered
 * around the cut rather than around the hole; and `connectTo` names the
 * painter's type, so its standing contour is subtracted from the ground being
 * laid and its faces go down as seeds the fill can read edge directions from.
 */
export function repairTerrainCut(
  runtime: TerrainRegenerateRuntime,
  fallout: CutFallout,
  causeId: string,
  tableId: string,
): number {
  if (fallout.consumedSurfaceKeys.length === 0) return 0;

  // Read while they still stand: a key the engine no longer knows is a stale
  // key, and repairing on the strength of one deletes ground nobody asked for.
  const consumed = fallout.consumedSurfaceKeys
    .map((surfaceKey) => runtime.getRegionTopology(surfaceKey))
    .filter((topology): topology is ConstructionRegionTopology => topology !== undefined);
  if (consumed.length === 0) return 0;

  const outline =
    fallout.footprintOutline !== undefined && fallout.footprintOutline.length >= 3
      ? fallout.footprintOutline
      : outlineAroundConsumed(consumed);
  if (outline.length < 3) return 0;

  const outcome = executeTerrainCut(runtime, {
    area: { outline },
    // The planner already resolved which ground this cut consumed. Handing it
    // over rather than letting the executor re-derive it from the outline
    // keeps one answer to that question instead of two.
    coveredRegions: consumed.map((topology) => ({
      surfaceKey: topology.surfaceKey,
      surfaceType: topology.surfaceType,
    })),
    targetSurfaceType: consumed[0]!.surfaceType,
    profile: {
      kind: "regenerate",
      connectTo:
        fallout.painterSurfaceType !== undefined
          ? { surfaceType: fallout.painterSurfaceType }
          : undefined,
    },
    causeId,
    tableId,
    faceSide: DEFAULT_FACE_SIDE,
    // Deterministic in the ground itself rather than in the clock, so the same
    // neighbourhood regenerated twice comes back the same: replayable from the
    // same log.
    seed: Math.max(1, Math.abs(hashOf(fallout.consumedSurfaceKeys))),
    irregularity: 0.7,
  });

  return outcome.builtFaces;
}

/** A stable small integer for a set of keys -- a seed, not a checksum. */
function hashOf(keys: readonly ConstructionSurfaceKey[]): number {
  let hash = 2166136261;
  for (const key of keys) {
    for (const part of key) {
      for (let index = 0; index < part.length; index += 1) {
        hash ^= part.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
    }
  }
  return hash | 0;
}
