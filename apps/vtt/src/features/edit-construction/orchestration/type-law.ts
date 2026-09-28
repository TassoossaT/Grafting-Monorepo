import type { ConstructionGraphSnapshot, ConstructionPatch, ConstructionPosition, ConstructionRegionEdge, ConstructionRegionTopology } from "@/ports";

import { structureTypeFor } from "../structure-types/index.ts";

/**
 * A type's own law (`StructureTypeDefinition.settle`) -- what its shape must
 * always be, a wall's posts upright above their feet -- held wherever its
 * nodes are placed: in every edit, once motion is resolved, and in every
 * creation, before a patch reaches the engine, whichever tool made it. A
 * type states its law once; no tool re-implements it, and none can get
 * round it.
 */

/**
 * `moved` with every face it touches settled by its type's law -- the law's
 * placements win, except over `fixed`: the nodes the gesture itself placed.
 * A law that would move one of those is left unsettled there, for the type's
 * own validation to refuse -- a wall is never sheared from its top by quietly
 * undoing what was asked.
 */
export function settleMoves(topologies: readonly ConstructionRegionTopology[], moved: ReadonlyMap<string, ConstructionPosition>, fixed: ReadonlySet<string> = new Set()): Map<string, ConstructionPosition> {
  const settled = new Map(moved);
  for (const topology of topologies) {
    const settle = structureTypeFor(topology.surfaceType)?.settle;
    if (!settle || !topology.nodes.some((node) => settled.has(node.id))) continue;
    const at = new Map(topology.nodes.map((node) => [node.id, settled.get(node.id) ?? node.position]));
    const placed = new Set(topology.nodes.filter((node) => settled.has(node.id)).map((node) => node.id));
    for (const [id, position] of settle(topology, at, placed)) if (!fixed.has(id)) settled.set(id, position);
  }
  return settled;
}

/**
 * `patch` with every face it declares settled by its type's law. Only the
 * nodes the patch declares move: a node it only references already stands,
 * and its own faces hold it.
 */
export function settlePatch(patch: ConstructionPatch, graph: Pick<ConstructionGraphSnapshot, "nodes" | "edges">): ConstructionPatch {
  if (!patch.regions.some((region) => structureTypeFor(region.surfaceType)?.settle)) return patch;
  const declared = new Map(patch.nodes.map((node) => [node.id, node.position]));
  const positions = new Map<string, ConstructionPosition>(graph.nodes.map((node) => [node.id, node.position]));
  for (const [id, position] of declared) positions.set(id, position);
  const edges = new Map<string, { readonly startNodeId: string; readonly endNodeId: string }>(graph.edges.map((edge) => [edge.edgeId, edge]));
  for (const edge of patch.edges) edges.set(edge.edgeId, edge);
  const placed = new Map(declared);
  for (const region of patch.regions) {
    const settle = structureTypeFor(region.surfaceType)?.settle;
    if (!settle) continue;
    const walk = (loop: typeof region.boundary): ConstructionRegionEdge[] => loop.flatMap((use) => {
      const edge = edges.get(use.edgeId);
      if (!edge) return [];
      const [startNodeId, endNodeId] = use.reversed ? [edge.endNodeId, edge.startNodeId] : [edge.startNodeId, edge.endNodeId];
      return [{ ...use, startNodeId, endNodeId, geometry: { kind: "line" } }];
    });
    const loops = [walk(region.boundary), ...(region.holes ?? []).map(walk)];
    const ids = new Set(loops.flat().flatMap((use) => [use.startNodeId, use.endNodeId]));
    const topology = {
      surfaceKey: ["@region", region.regionId],
      surfaceType: region.surfaceType,
      physical: region.physical,
      nodes: [...ids].flatMap((id) => { const position = placed.get(id) ?? positions.get(id); return position ? [{ id, position }] : []; }),
      outerLoops: [loops[0]!],
      holes: loops.slice(1),
    } as unknown as ConstructionRegionTopology;
    const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
    for (const [id, position] of settle(topology, at, new Set(declared.keys()))) if (declared.has(id)) placed.set(id, position);
  }
  return { ...patch, nodes: patch.nodes.map((node) => ({ ...node, position: placed.get(node.id) ?? node.position })) };
}
