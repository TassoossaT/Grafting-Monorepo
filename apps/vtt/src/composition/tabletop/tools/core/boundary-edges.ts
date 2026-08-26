import type { ConstructionEdgeId } from "@/ports";

import type { ToolContext } from "./tool-context.ts";

export {
  createBoundaryEdges,
  reverseGeometry,
  sharedEdgeId,
  type BoundaryEdges,
  type EdgeSharing,
} from "../../../../features/edit-construction/index.ts";

/** Reads live edge use; the geometry policy itself remains feature-owned. */
export function boundaryUsage(ctx: ToolContext): ReadonlyMap<ConstructionEdgeId, readonly boolean[]> {
  const uses = new Map<ConstructionEdgeId, boolean[]>();
  for (const topology of ctx.runtime.getAllRegionTopologies()) {
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const use of loop) {
        const recorded = uses.get(use.edgeId);
        if (recorded === undefined) uses.set(use.edgeId, [use.reversed]);
        else recorded.push(use.reversed);
      }
    }
  }
  return uses;
}
