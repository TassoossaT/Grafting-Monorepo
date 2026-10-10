import type { ConstructionGridConstraintPoint, ConstructionNodeId, ConstructionRegionEdge } from "@/ports";

import type { ConstraintRing, ConstraintTable } from "./terrain-constraints.ts";

/**
 * A structure's outline as the rings the ground meets it along, and what each
 * corner and side of them is: which node a corner is, which standing edge a
 * side runs along -- so the ground laid comes back meeting what stands at its
 * real nodes and edges, never at coincident positions.
 */

/**
 * A structure's outline as constraint rings where a corner carries its node
 * only when `anchored` names it. Sealed, the ground meets it without sharing it
 * -- no edge to split, and a node only where another structure holds it too,
 * a ramp's end welded into a floor. Otherwise (`withEdges`) its sides stay
 * edges the ground may split, and `anchored` is the nodes resting on the ground.
 */
export function anchoredConstraints(
  rings: readonly (readonly ConstructionRegionEdge[])[],
  positionOf: ReadonlyMap<ConstructionNodeId, { readonly x: number; readonly z: number }>,
  startingIndex: number,
  anchored: ReadonlySet<ConstructionNodeId>,
  /** Sources numbered just before, from `startingIndex` on: a node already among them keeps its number. */
  before: readonly ConstructionNodeId[] = [],
  withEdges = false,
): ConstraintTable {
  const sources: ConstructionNodeId[] = [];
  const index = new Map<ConstructionNodeId, number>(before.map((id, i) => [id, startingIndex + i]));
  startingIndex += before.length;
  const built: ConstraintRing[] = [];
  for (const ring of rings) {
    const points: ConstructionGridConstraintPoint[] = [];
    for (const edge of ring) {
      const position = positionOf.get(edge.startNodeId);
      if (!position) break;
      let source: number | undefined;
      if (anchored.has(edge.startNodeId)) {
        source = index.get(edge.startNodeId);
        if (source === undefined) {
          source = startingIndex + sources.length;
          sources.push(edge.startNodeId);
          index.set(edge.startNodeId, source);
        }
      }
      points.push(source === undefined ? { x: position.x, z: position.z } : { x: position.x, z: position.z, source });
    }
    if (points.length === ring.length && points.length >= 3) built.push({ points, edges: withEdges ? ring : ring.map(() => undefined) });
  }
  return { rings: built, sources };
}
