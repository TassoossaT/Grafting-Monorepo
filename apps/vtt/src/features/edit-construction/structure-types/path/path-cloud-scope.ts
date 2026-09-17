import type { ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionRegionTopology } from "@/ports";

import { parseSpineControlNodeId, spineGraphFromSnapshot } from "../../spine/index.ts";
import { isRoadSpan } from "./road-span.ts";
import { PATH_SURFACE_TYPE } from "./path-surface-type.ts";

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
  /** Every corridor/operation id participating in this connected spine cluster. */
  readonly corridorIds: ReadonlySet<string>;
}

export function extractCorridorsFromEdgeId(edgeId: string): readonly string[] {
  const result: string[] = [];
  let current: string | undefined = edgeId;
  while (current) {
    if (current.startsWith("spine-edge:")) {
      const match = /^spine-edge:(.+):\d+$/.exec(current);
      if (match && match[1]) {
        result.push(match[1]);
      }
      break;
    } else if (current.startsWith("spine-split:")) {
      const match = /^spine-split:(.+):\d+$/.exec(current);
      if (match && match[1]) {
        current = match[1];
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return result;
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
  const graph = spineGraphFromSnapshot({ nodes: [...nodes.values()], edges: [...edges.values()] }, isRoadSpan);
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
    if (topology.surfaceType !== PATH_SURFACE_TYPE) continue;
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
  const clusterEdges = graph.edges.filter((edge) => connected.has(edge.fromNodeId) && connected.has(edge.toNodeId));
  const corridorIds = new Set<string>();
  for (const node of clusterNodes) {
    const address = parseSpineControlNodeId(node.nodeId);
    if (address !== undefined) {
      corridorIds.add(address.operationId);
      const at = address.operationId.lastIndexOf("#");
      if (at >= 0) corridorIds.add(address.operationId.slice(0, at));
    }
  }
  for (const edge of clusterEdges) {
    for (const corridorId of extractCorridorsFromEdgeId(edge.edgeId)) {
      corridorIds.add(corridorId);
      const at = corridorId.lastIndexOf("#");
      if (at >= 0) corridorIds.add(corridorId.slice(0, at));
    }
  }
  for (const edge of patch.edges) {
    for (const corridorId of extractCorridorsFromEdgeId(edge.edgeId)) {
      corridorIds.add(corridorId);
      const at = corridorId.lastIndexOf("#");
      if (at >= 0) corridorIds.add(corridorId.slice(0, at));
    }
  }

  return { snapshot: { nodes: [...nodes.values()].filter((n) => connected.has(n.id)), edges: [...edges.values()].filter((e) => connected.has(e.startNodeId) && connected.has(e.endNodeId)) }, corridorIds };
}

/**
 * Every standing path face the touched spine cloud owns: the faces whose
 * contour id names one of its corridors. Ownership comes from the spine, never
 * from incidental welding or proximity, so a neighbouring road's faces are
 * never taken along.
 */
export function standingRegionsForCloud(
  topologies: readonly ConstructionRegionTopology[],
  corridorIds: ReadonlySet<string>,
): readonly ConstructionRegionTopology[] {
  if (corridorIds.size === 0) return [];
  return topologies.filter((topology) => {
    if (topology.surfaceType !== PATH_SURFACE_TYPE) return false;
    const owners = surfaceCorridors(topology.surfaceKey[1] ?? "");
    return owners !== undefined && owners.some((id) => corridorIds.has(id));
  });
}
