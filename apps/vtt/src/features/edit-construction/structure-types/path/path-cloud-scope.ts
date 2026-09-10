import type { ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import { chainsOf, parseSpineControlNodeId, spineGraphFromSnapshot } from "./spine-graph/index.ts";

const OWNED_CONTOUR = "road-cloud:";
function surfaceCorridors(regionId: string): readonly string[] | undefined {
  if (!regionId.startsWith(OWNED_CONTOUR)) return undefined;
  try {
    const ids: unknown = JSON.parse(decodeURIComponent(regionId.slice(OWNED_CONTOUR.length).split(":")[0]!));
    return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? ids : undefined;
  } catch { return undefined; }
}

/** Persistent regeneration membership, independent of the latest gesture or a disconnect. */
export function bezierContourId(corridorIds: ReadonlySet<string>, operationId: string): string {
  return `road-cloud:${encodeURIComponent(JSON.stringify([...corridorIds].sort()))}:${encodeURIComponent(operationId)}`;
}

/** The connected spine component changed by this stroke, after its graph patch, and every node id in it. */
export interface ChangedSpineCloud {
  readonly snapshot: ConstructionGraphSnapshot;
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
export function changedSpineCloud(snapshot: ConstructionGraphSnapshot, patch: ConstructionGraphPatch, topologies: readonly ConstructionRegionTopology[] = []): ChangedSpineCloud {
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
  const connected = new Set([...patch.nodes.map((node) => node.id), ...patch.edges.flatMap((edge) => [edge.startNodeId, edge.endNodeId])]);
  // A surface may contain disconnected remnants of one authored corridor
  // after deleting a segment. Regenerate all of those remnants together:
  // their shared surface ownership outlives graph connectivity.
  const corridorNodes = new Map<string, string[]>();
  const corridorOf = (id: string): string | undefined => parseSpineControlNodeId(id)?.operationId;
  for (const node of graph.nodes) {
    const corridor = corridorOf(node.nodeId);
    if (corridor !== undefined) corridorNodes.set(corridor, [...(corridorNodes.get(corridor) ?? []), node.nodeId]);
  }
  const coOwners = new Map<string, Set<string>>();
  for (const topology of topologies) {
    if (topology.surfaceType !== "path") continue;
    const owners = surfaceCorridors(topology.surfaceKey[1] ?? "") ?? [];
    for (const owner of owners) {
      const peers = coOwners.get(owner) ?? new Set<string>();
      for (const peer of owners) peers.add(peer);
      coOwners.set(owner, peers);
    }
  }
  // Alias the base operation used by legacy corridor ids with a #road suffix.
  for (const [corridor, ids] of [...corridorNodes]) {
    const at = corridor.lastIndexOf("#");
    if (at >= 0) {
      const base = corridor.slice(0, at);
      corridorNodes.set(base, [...(corridorNodes.get(base) ?? []), ...ids]);
    }
  }
  const visitedCorridors = new Set<string>();
  const pending = [...connected];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    const corridor = corridorOf(nodeId);
    const owners = corridor === undefined ? [] : [corridor, ...(coOwners.get(corridor) ?? [])];
    const siblings = owners.flatMap((owner) => visitedCorridors.has(owner) ? [] : corridorNodes.get(owner) ?? []);
    for (const owner of owners) visitedCorridors.add(owner);
    if (corridor !== undefined) visitedCorridors.add(corridor);
    for (const neighbor of [...(adjacent.get(nodeId) ?? []), ...siblings]) {
      if (connected.has(neighbor)) continue;
      connected.add(neighbor);
      pending.push(neighbor);
    }
  }
  for (const id of connected) if (!adjacent.has(id)) connected.delete(id);
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

  return { snapshot: { nodes: [...nodes.values()].filter((n) => connected.has(n.id)), edges: [...edges.values()].filter((e) => connected.has(e.startNodeId) && connected.has(e.endNodeId)) }, chains, positions: clusterNodes.map((node) => node.position), corridorIds };
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
  spineOwned = false,
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

  // Identify seed topologies directly touched by the corridorIds
  const seeds = new Set<ConstructionRegionTopology>();
  for (const topology of pathTopologies) {
    const regionId = topology.surfaceKey[1] ?? "";
    const owners = surfaceCorridors(regionId);
    if (owners !== undefined) {
      if (owners.some((id) => corridorIds.has(id))) seeds.add(topology);
      continue;
    }
    let matched = false;
    for (const corridorId of corridorIds) {
      if (
        regionId === corridorId ||
        regionId.startsWith(`${corridorId}:`) ||
        regionId.startsWith(`${corridorId}#`)
      ) {
        matched = true;
        break;
      }
    }
    if (!matched && !spineOwned) {
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

  // Explicit roads are owned by the spine, not by incidental contour welding.
  if (spineOwned) return [...seeds];

  // BFS across shared nodes to find the entire connected component of path faces
  const visited = new Set<ConstructionRegionTopology>(seeds);
  const queue: ConstructionRegionTopology[] = [...seeds];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const node of current.nodes) {
      const neighbors = topologiesByNodeId.get(node.id) ?? [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  return [...visited];
}
