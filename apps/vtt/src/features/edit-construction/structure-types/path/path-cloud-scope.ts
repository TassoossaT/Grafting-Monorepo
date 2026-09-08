import type { ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import { chainsOf, parseSpineControlNodeId, spineGraphFromSnapshot } from "./spine-graph/index.ts";

/** The connected spine component changed by this stroke, after its graph patch, and every node id in it. */
export interface ChangedSpineCloud {
  readonly chains: readonly (readonly ConstructionPosition[])[];
  /**
   * Every spine control point position in the touched component -- used to
   * decide which standing contour faces this edit replaces.
   */
  readonly positions: readonly ConstructionPosition[];
  /** Every corridor/operation id participating in this connected spine cluster. */
  readonly corridorIds: ReadonlySet<string>;
}

/**
 * The connected spine component a graph patch touches, walked out from the
 * patch's own nodes across the *prospective* graph (snapshot plus patch) --
 * this is what `planPathCloudMutation` reads to decide which standing
 * contour faces one edit replaces (`standingRegionsForCloud`, below).
 */
export function changedSpineCloud(snapshot: ConstructionGraphSnapshot, patch: ConstructionGraphPatch): ChangedSpineCloud {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  for (const node of patch.nodes) nodes.set(node.id, node);
  const edges = new Map(snapshot.edges.map((edge) => [edge.edgeId, edge]));
  for (const edgeId of patch.removedEdgeIds ?? []) edges.delete(edgeId);
  for (const edge of patch.edges) edges.set(edge.edgeId, edge);
  const graph = spineGraphFromSnapshot({ nodes: [...nodes.values()], edges: [...edges.values()] });
  const adjacent = new Map<string, string[]>();
  for (const edge of graph.edges) {
    adjacent.set(edge.fromNodeId, [...(adjacent.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    adjacent.set(edge.toNodeId, [...(adjacent.get(edge.toNodeId) ?? []), edge.fromNodeId]);
  }
  const connected = new Set(patch.nodes.map((node) => node.id));
  const pending = [...connected];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    for (const neighbor of adjacent.get(nodeId) ?? []) {
      if (connected.has(neighbor)) continue;
      connected.add(neighbor);
      pending.push(neighbor);
    }
  }
  const clusterNodes = graph.nodes.filter((node) => connected.has(node.nodeId));
  const chains = chainsOf({
    nodes: clusterNodes,
    edges: graph.edges.filter((edge) => connected.has(edge.fromNodeId) && connected.has(edge.toNodeId)),
  }).map((chain) => chain.nodes.map((node) => node.position));

  const corridorIds = new Set<string>();
  for (const node of clusterNodes) {
    const address = parseSpineControlNodeId(node.nodeId);
    if (address !== undefined) {
      corridorIds.add(address.operationId);
      const at = address.operationId.lastIndexOf("#");
      if (at >= 0) corridorIds.add(address.operationId.slice(0, at));
    }
  }

  return { chains, positions: clusterNodes.map((node) => node.position), corridorIds };
}

/**
 * Every standing "path" face that belongs to the touched spine cloud.
 * Identified by starting from path regions whose identity or node references
 * match the touched corridor/operation ids, and walking the topological
 * connectivity graph of shared nodes across path faces.
 */
export function standingRegionsForCloud(
  topologies: readonly ConstructionRegionTopology[],
  cloudPositions: readonly ConstructionPosition[] = [],
  corridorIds: ReadonlySet<string> = new Set(),
): readonly ConstructionRegionTopology[] {
  if (corridorIds.size === 0 && cloudPositions.length === 0) return [];

  const pathTopologies = topologies.filter((topology) => topology.surfaceType === "path");
  if (pathTopologies.length === 0) return [];

  // Index path topologies by each node id they reference
  const topologiesByNodeId = new Map<string, ConstructionRegionTopology[]>();
  for (const topology of pathTopologies) {
    for (const node of topology.nodes) {
      const list = topologiesByNodeId.get(node.id);
      if (list !== undefined) {
        list.push(topology);
      } else {
        topologiesByNodeId.set(node.id, [topology]);
      }
    }
  }

  function matchesAnyCorridor(id: string, ids: ReadonlySet<string>): boolean {
    for (const corridorId of ids) {
      if (
        id === corridorId ||
        id.startsWith(`${corridorId}:`) ||
        id.startsWith(`${corridorId}#`) ||
        corridorId.startsWith(`${id}:`) ||
        corridorId.startsWith(`${id}#`)
      ) {
        return true;
      }
    }
    return false;
  }

  function extractCorridorId(regionId: string): string | undefined {
    const bandAt = regionId.indexOf(":band-");
    if (bandAt >= 0) return regionId.slice(0, bandAt);
    const hashAt = regionId.indexOf("#");
    if (hashAt >= 0) return regionId.slice(0, hashAt);
    return regionId.length > 0 ? regionId : undefined;
  }

  function isForeignTopology(topology: ConstructionRegionTopology): boolean {
    if (corridorIds.size === 0) return false;
    const regionId = topology.surfaceKey[1] ?? "";
    const corridor = extractCorridorId(regionId);
    if (corridor !== undefined && corridor !== "adjoining-face" && !matchesAnyCorridor(corridor, corridorIds)) {
      return true;
    }
    return false;
  }

  // Identify seed topologies directly touched by the corridorIds
  const seeds = new Set<ConstructionRegionTopology>();
  for (const topology of pathTopologies) {
    if (isForeignTopology(topology)) continue;

    const regionId = topology.surfaceKey[1] ?? "";
    let matched = matchesAnyCorridor(regionId, corridorIds);
    if (!matched) {
      for (const node of topology.nodes) {
        for (const corridorId of corridorIds) {
          if (
            node.id.startsWith(`contour:${corridorId}:`) ||
            node.id.startsWith(`contour:${corridorId}#`) ||
            node.id.startsWith(`along:${corridorId}:`) ||
            node.id.startsWith(`across:${corridorId}:`) ||
            node.id.startsWith(`${corridorId}:`)
          ) {
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
    }
    if (matched) {
      seeds.add(topology);
    }
  }

  // BFS across shared nodes to find the entire connected component of path faces
  // belonging to the touched cloud. It MUST NOT cross into foreign path corridors.
  const visited = new Set<ConstructionRegionTopology>(seeds);
  const queue: ConstructionRegionTopology[] = [...seeds];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const node of current.nodes) {
      const neighbors = topologiesByNodeId.get(node.id) ?? [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor) && !isForeignTopology(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  return [...visited];
}
