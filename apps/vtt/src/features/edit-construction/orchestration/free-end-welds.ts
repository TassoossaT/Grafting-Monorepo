import type { ApplyPatchReplacementRequest, ConstructionGraphSnapshot, ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import { isSpineEdge, spineOwnerOf } from "../spine/index.ts";
import { hasTrait, structureTypeFor } from "../structure-types/index.ts";
import { floorsWeldedBy, reweldFloors, type WeldRung } from "../topology/floor-weld.ts";

/**
 * Every end of every structure that is not welded into a floor: a region
 * structure's declared ends (`StructureTypeDefinition.ends`), and a spine's
 * free ends whose owner says where their cross-section is
 * (`SpineGeneration.endRung`).
 */
export function freeStructureEnds(graph: ConstructionGraphSnapshot, topologies: readonly ConstructionRegionTopology[]): readonly WeldRung[] {
  const floors = topologies.filter((topology) => hasTrait(topology.surfaceType, "floor"));
  const regionEnds = topologies.flatMap((topology) => structureTypeFor(topology.surfaceType)?.ends?.ends(topology).map((end) => end.rung) ?? []);
  const degree = new Map<string, { count: number; owner?: string }>();
  for (const span of graph.edges.filter(isSpineEdge)) {
    const owner = spineOwnerOf(span);
    for (const id of [span.startNodeId, span.endNodeId]) {
      const entry = degree.get(id) ?? { count: 0, owner };
      entry.count += 1;
      degree.set(id, entry);
    }
  }
  const spineEnds = [...degree].flatMap(([id, { count, owner }]) => {
    const endRung = count === 1 && owner !== undefined ? structureTypeFor(owner)?.spine?.endRung : undefined;
    return endRung ? [endRung(id)] : [];
  });
  return [...regionEnds, ...spineEnds].filter((rung) => floorsWeldedBy(floors, rung).length === 0);
}

/**
 * Welds every free structure end whose end edge lies along the outline of
 * one of the floors `floorKeys` names -- a floor drawn against a ramp's end
 * joins it without the corners having to be picked. `undefined` when none
 * does.
 */
export function weldFreeEndsOnto(
  graph: ConstructionGraphSnapshot,
  topologies: readonly ConstructionRegionTopology[],
  floorKeys: readonly ConstructionSurfaceKey[],
  operationId: string,
): ApplyPatchReplacementRequest | undefined {
  const rungs = freeStructureEnds(graph, topologies);
  if (rungs.length === 0 || floorKeys.length === 0) return undefined;
  const positions = new Map<string, ConstructionPosition>();
  for (const topology of topologies) for (const node of topology.nodes) positions.set(node.id, node.position);
  const welds = reweldFloors(topologies, {
    detach: [],
    attach: floorKeys.flatMap((floor) => rungs.filter((rung) => positions.has(rung.startNodeId) && positions.has(rung.endNodeId)).map((rung) => ({ rung, floor }))),
  }, positions, operationId);
  if (welds.attached.length === 0) return undefined;
  // The rung nodes already stand, as the structure's own: nothing to declare for them.
  return { operationId, sourceSurfaceKeys: welds.sourceSurfaceKeys, patch: { nodes: welds.nodes, edges: welds.edges, regions: welds.regions } };
}
