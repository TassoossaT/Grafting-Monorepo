import type {
  ConstructionOrientedEdgeUse,
  ConstructionPatch,
  ConstructionSweepPlan,
} from "@/ports";

import { createBoundaryEdges } from "../core/boundary-edges.ts";

/** Application-owned graph declaration for one generic sweep result. */
export interface PathPatchFormation {
  readonly patch: ConstructionPatch;
  readonly outline: readonly (readonly [number, number])[];
  readonly boundary: readonly ConstructionOrientedEdgeUse[];
  /** Clean navigation reference retained independently from render cells. */
  readonly referenceLine: readonly (readonly [number, number])[];
}

/**
 * Converts graph-neutral Rust geometry into the exact nodes, shared edges,
 * and faces the construction graph must register. This mirrors `wallPatch`:
 * the application defines what the product is; Rust only validates and
 * executes the resulting patch.
 */
export function pathPatch(
  operationId: string,
  surfaceType: string,
  plan: ConstructionSweepPlan,
): PathPatchFormation {
  const nodeIds = plan.vertices.map((_vertex, index) => `${operationId}:path-node:${index}`);
  const nodes = plan.vertices.map((position, index) => ({ id: nodeIds[index]!, position }));
  const edges = createBoundaryEdges(operationId, { kind: "refuse-when-full" });

  const useEdge = (start: number, end: number): ConstructionOrientedEdgeUse => {
    return edges.use(nodeIds[start]!, nodeIds[end]!);
  };

  const regions = plan.quads.map((quad, index) => ({
    regionId: `${operationId}:path-quad:${index}`,
    boundary: quad.map((start, position) => useEdge(start, quad[(position + 1) % quad.length]!)),
    surfaceType,
    physical: true,
  }));
  const boundary = plan.boundary.map((start, position) =>
    useEdge(start, plan.boundary[(position + 1) % plan.boundary.length]!),
  );
  const outline = plan.boundary.map((index) => {
    const vertex = plan.vertices[index]!;
    return [vertex.x, vertex.z] as const;
  });

  return {
    patch: { nodes, edges: edges.all(), regions },
    outline,
    boundary,
    referenceLine: plan.referenceLine,
  };
}
