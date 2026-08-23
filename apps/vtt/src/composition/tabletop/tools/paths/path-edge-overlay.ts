import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time.
import { pathRunsIn } from "../../../../features/edit-construction/index.ts";
import type { PathRun } from "../../../../features/edit-construction/index.ts";

/**
 * Every edge of every standing path run, grouped by what that edge *is*.
 *
 * Node handles are drawn and edges are not, which leaves the one thing a
 * road is actually made of invisible: you can see where the vertices went
 * but not how they were joined, and a spine, a contour and a rib all look
 * the same when only their endpoints are shown. This groups them so each can
 * be drawn in its own colour.
 *
 * Read from `pathRunsIn`, so it is exactly the structure the rest of the
 * system believes in -- if a contour looks wrong here, it *is* wrong, rather
 * than being drawn wrong.
 */

/** The three parts, each as a flat `[x, y, z, x, y, z, ...]` segment list. */
export interface PathEdgeOverlay {
  readonly spine: Float32Array;
  readonly contour: Float32Array;
  readonly rib: Float32Array;
}

/** Colours chosen to read against the path's own surface, and against each other. */
export const PATH_EDGE_COLORS = {
  spine: 0xfacc15,
  contour: 0x22d3ee,
  rib: 0xf472b6,
} as const;

/** The preview channel each part is drawn on; separate, so one clear never takes the others. */
export const PATH_EDGE_CHANNELS = {
  spine: "path-edges:spine",
  contour: "path-edges:contour",
  rib: "path-edges:rib",
} as const;

function pushSegment(into: number[], from: ConstructionPosition, to: ConstructionPosition): void {
  into.push(from.x, from.y, from.z, to.x, to.y, to.z);
}

function chainSegments(into: number[], nodes: readonly { readonly position: ConstructionPosition }[]): void {
  for (let index = 0; index + 1 < nodes.length; index += 1) {
    pushSegment(into, nodes[index]!.position, nodes[index + 1]!.position);
  }
}

/**
 * Groups the edges of `runs` by role.
 *
 * Drawn from the chains rather than from the edge ids, on purpose: a chain
 * is what the structure *claims*, so a missing edge shows up as a visible
 * gap instead of quietly not being drawn. A spine broken at a crossing --
 * which is exactly what happens today -- therefore looks broken.
 */
export function pathEdgeOverlayOf(runs: readonly PathRun[]): PathEdgeOverlay {
  const spine: number[] = [];
  const contour: number[] = [];
  const rib: number[] = [];

  for (const run of runs) {
    if (run.spine !== undefined) chainSegments(spine, run.spine.nodes);
    for (const chain of run.contours) chainSegments(contour, chain.nodes);
    for (const station of run.ribs) chainSegments(rib, station.nodes);
  }

  return {
    spine: Float32Array.from(spine),
    contour: Float32Array.from(contour),
    rib: Float32Array.from(rib),
  };
}

/** The same, straight from a set of region boundaries. */
export function pathEdgeOverlayIn(
  topologies: readonly ConstructionRegionTopology[],
): PathEdgeOverlay {
  return pathEdgeOverlayOf(pathRunsIn(topologies));
}
