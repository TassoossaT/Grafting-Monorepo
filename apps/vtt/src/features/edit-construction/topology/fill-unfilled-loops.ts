import type {
  ConstructionNodeId,
  ConstructionPatch,
  ConstructionUnfilledLoop,
} from "@/ports";

/**
 * Closing a gap by registering the rim the engine already reports, rather
 * than by generating anything to put in it.
 *
 * This is the whole of "make the ground whole again", and it is one call
 * because the engine has already done the hard part: `getUnfilledLoops`
 * returns each closed loop of free boundary that no face fills, with its
 * edges **already oriented for the face that would fill it**. Registering one
 * therefore adds no node and no edge -- it declares a face over boundary that
 * is already there, walked the one way the graph will accept.
 *
 * That is not merely convenient, it is what makes the result correct by
 * construction, and every class of bug a generated fill has to fight is
 * absent rather than handled:
 *
 * - it cannot float, because it introduces no vertex to weld -- every corner
 *   is a node already standing there;
 * - it cannot leave a gap along a seam, because it walks the neighbour's own
 *   edges, all of them, including the collinear ones a clipper would have
 *   simplified away;
 * - it cannot be wound the wrong way, because the direction is reported, not
 *   chosen -- no convention of any type is assumed anywhere;
 * - it cannot pave over the outside of a patch, because the engine tells a
 *   gap's rim from a patch's outline by where the loop's own neighbours lie.
 *
 * `scope` is the whole point and never a speed-up. An edge is considered only
 * when **both** its nodes are named, so a caller has to name every node
 * bounding the gap it means to close -- both sides of a seam, not just its
 * own. A closed loop somewhere the caller never went is somebody else's
 * shape, and paving it over because something happened elsewhere is a bug,
 * not a repair.
 *
 * A hole a region *declared* -- a doorway, a courtyard -- is not reported and
 * so is never sealed; that exclusion lives in the engine.
 */
export interface UnfilledLoopFillRuntime {
  getUnfilledLoops(scope: readonly ConstructionNodeId[]): readonly ConstructionUnfilledLoop[];
  addPatch(
    patch: ConstructionPatch,
    origin: "local",
    causeId: string,
  ): { readonly createdSurfaceKeys: readonly unknown[]; readonly skippedRegionIds: readonly string[] };
}

/**
 * What to make a gap out of: whatever most of the faces around it are made
 * of, falling back to `fallback` when it has no neighbours to copy.
 *
 * Filling with a *chosen* type instead is what leaves a mended gap a
 * different colour from the ground it sits in -- paint grass, pass over an
 * older slate patch to close a hole in it, and the patch comes back with a
 * green tile in the middle. Ground is never retyped just by being passed
 * over, so a gap inside that ground must not be retyped either. A gap inside
 * ground of one type has that type on every side anyway, so the two cases
 * agree.
 */
export function matchTheGroundAround(
  neighbours: readonly { readonly surfaceType: string; readonly physical: boolean }[],
  fallback: string,
): { readonly surfaceType: string; readonly physical: boolean } {
  const tally = new Map<string, { count: number; physical: number }>();
  for (const neighbour of neighbours) {
    const entry = tally.get(neighbour.surfaceType) ?? { count: 0, physical: 0 };
    entry.count += 1;
    if (neighbour.physical) entry.physical += 1;
    tally.set(neighbour.surfaceType, entry);
  }
  let best: { surfaceType: string; count: number; physical: number } | undefined;
  for (const [surfaceType, entry] of tally) {
    if (best === undefined || entry.count > best.count) best = { surfaceType, ...entry };
  }
  if (best === undefined) return { surfaceType: fallback, physical: true };
  // Physical wins a tie: a gap left walk-through in the middle of solid
  // ground is a worse wrong answer than a solid tile in a decorative patch.
  return { surfaceType: best.surfaceType, physical: best.physical * 2 >= best.count };
}

/**
 * Fills every closed loop of free boundary within `scope` -- see
 * {@link UnfilledLoopFillRuntime} for why this is the whole algorithm.
 *
 * Returns how many faces actually landed, not how many gaps were found: a
 * loop the engine then refuses costs itself and nothing else.
 */
export function fillUnfilledLoops(
  runtime: UnfilledLoopFillRuntime,
  scope: readonly ConstructionNodeId[],
  fallbackSurfaceType: string,
  causeId: string,
): number {
  const loops = runtime.getUnfilledLoops(scope);
  if (loops.length === 0) return 0;
  const outcome = runtime.addPatch(
    {
      nodes: [],
      edges: [],
      regions: loops.map((loop: ConstructionUnfilledLoop) => ({
        regionId: loop.nodeIds.join("|"),
        boundary: loop.boundary,
        ...matchTheGroundAround(loop.neighbours, fallbackSurfaceType),
      })),
    },
    "local",
    causeId,
  );
  return outcome.createdSurfaceKeys.length;
}
