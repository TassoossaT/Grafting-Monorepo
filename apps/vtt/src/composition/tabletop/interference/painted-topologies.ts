// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import type {
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionTopologyBoundsQuery,
} from "@/ports";
import type { CutFallout } from "@/features/edit-construction";

import { outwardPerimeterRings } from "../../../features/edit-construction/index.ts";

/**
 * Reading the painter's own standing ground.
 *
 * **Why this is its own module and not part of the dispatcher.** Two sides need
 * it and they sit on opposite ends of one call chain: the dispatcher hands a
 * cut's fallout to the covered type's repair, and the repair -- now that it
 * goes through the same generator the sculpt brush uses -- has to read the
 * painter again itself, to subtract it from the ground it is about to lay.
 * Leaving this in the dispatcher made that a cycle: dispatch imports the
 * repair, the repair imports the cut executor, the cut executor imports this.
 */

/** What reading the painter needs of a runtime, structurally. */
export interface PaintedTopologyRuntime {
  getAllRegionTopologies(): readonly ConstructionRegionTopology[];
  getRegionTopologiesInBounds?(bounds: ConstructionTopologyBoundsQuery): readonly ConstructionRegionTopology[];
}

/**
 * Every live face of one type, optionally only those within `bounds`.
 *
 * The bounded form is not an optimisation. A repair asking for "every road on
 * the table" gets a contour thousands of segments long, hands all of it to the
 * generator as a constraint, and pays for the whole network on a stroke that
 * touched a metre of it.
 */
export function paintedTopologiesOf(
  runtime: PaintedTopologyRuntime,
  paintedType: string,
  bounds?: ConstructionTopologyBoundsQuery,
): readonly ConstructionRegionTopology[] {
  const topologies =
    bounds !== undefined && typeof runtime.getRegionTopologiesInBounds === "function"
      ? runtime.getRegionTopologiesInBounds(bounds)
      : runtime.getAllRegionTopologies();
  return topologies.filter((topology) => topology.surfaceType === paintedType);
}

/**
 * The painter's own ground, as the repair needs it: its real nodes to weld
 * onto, and one closed ring per face it owns so the area it occupies can be
 * taken out of the ground being laid.
 */
export function paintedFalloutOf(
  painted: readonly ConstructionRegionTopology[],
): Pick<CutFallout, "paintedNodes" | "paintedLoops"> {
  const nodesById = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const topology of painted) {
    for (const node of topology.nodes) nodesById.set(node.id, node.position);
  }

  // A multi-face perimeter walk is the right answer when it closes. When it
  // does not -- a cloud whose faces do not actually share edges yet -- each
  // face's own closed outer loop still names real edges, and losing them costs
  // the repair every hole constraint and every adoption it would have made.
  let rings = outwardPerimeterRings(painted);
  if (rings.length === 0) {
    rings = painted.flatMap((topology) =>
      topology.outerLoops.filter(
        (loop) => loop.length >= 3 && loop[loop.length - 1]!.endNodeId === loop[0]!.startNodeId,
      ),
    );
  }

  return {
    paintedNodes: [...nodesById].map(([id, position]) => ({ id, position })),
    paintedLoops: rings,
  };
}

/**
 * The painter's own ground, read straight from the graph.
 *
 * Read from **every live face of the painter's type**, optionally scoped
 * to bounds.
 */
export function paintedNodesOf(
  runtime: PaintedTopologyRuntime,
  paintedType: string,
  bounds?: ConstructionTopologyBoundsQuery,
): Pick<CutFallout, "paintedNodes" | "paintedLoops"> {
  return paintedFalloutOf(paintedTopologiesOf(runtime, paintedType, bounds));
}
