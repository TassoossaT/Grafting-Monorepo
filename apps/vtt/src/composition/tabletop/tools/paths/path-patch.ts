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
}

/**
 * Converts graph-neutral Rust geometry into the exact nodes, shared edges,
 * and faces the construction graph must register. This mirrors `wallPatch`:
 * the application defines what the product is; Rust only validates and
 * executes the resulting patch.
 *
 * Edges are named after the table and the pair of nodes they run between,
 * exactly as `wallPatch` names them, because that shared name is the whole
 * mechanism by which two independently declared faces agree on one edge.
 * Namespacing them per operation instead would guarantee that no path could
 * ever share an edge with anything -- the interior edges of one sweep would
 * still be shared, since they carry the same prefix, which is precisely what
 * made the mistake invisible.
 *
 * `refuse-when-full` is the right rule here, and only becomes meaningful now
 * that the name can actually collide: two faces to an edge is the true limit
 * for ground, so an edge with no room left means something is already there,
 * and the overlay refusing the patch is that fact arriving where it is
 * precise. A wall shares `private-when-full` for the opposite reason -- any
 * number of walls may legitimately stand on one column.
 */
export function pathPatch(
  tableId: string,
  operationId: string,
  surfaceType: string,
  plan: ConstructionSweepPlan,
): PathPatchFormation {
  const nodeIds = plan.vertices.map((_vertex, index) => `${operationId}:path-node:${index}`);
  const nodes = plan.vertices.map((position, index) => ({ id: nodeIds[index]!, position }));
  const edges = createBoundaryEdges(tableId, { kind: "refuse-when-full" });

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

  return { patch: { nodes, edges: edges.all(), regions }, outline, boundary };
}
