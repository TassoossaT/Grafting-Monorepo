import type { SpineControlNode, SpineGraph } from "./spine-graph.ts";

/**
 * One continuous, ordered walk of control nodes -- the unit a curve is
 * sampled along.
 *
 * A chain starts and ends at a **boundary** node: one whose degree is not 2,
 * which is either a free end (degree 1) or a real junction (degree 3+). A
 * degree-2 node in the middle carries the curve through, never splits it.
 * This is what lets a junction be one shared control node reached by
 * several chains, rather than something a curve has to special-case: the
 * chain simply stops there, exactly as it stops at a free end.
 */
export interface SpineChain {
  readonly nodes: readonly SpineControlNode[];
}

/**
 * Every chain in `graph`, split at every node whose degree is not 2.
 *
 * Does not walk a closed loop with no boundary node at all (a ring with no
 * free end and no junction) -- nothing in this codebase draws one yet, and
 * guessing a start point on a cycle is a decision this function should not
 * make silently. Such a loop is left out rather than mis-chained.
 */
export function chainsOf(graph: SpineGraph): readonly SpineChain[] {
  const byId = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    adjacency.set(edge.fromNodeId, [...(adjacency.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    adjacency.set(edge.toNodeId, [...(adjacency.get(edge.toNodeId) ?? []), edge.fromNodeId]);
  }
  const degreeOf = (nodeId: string): number => adjacency.get(nodeId)?.length ?? 0;
  const isBoundary = (nodeId: string): boolean => degreeOf(nodeId) !== 2;
  const edgeKey = (a: string, b: string): string => (a < b ? `${a}~${b}` : `${b}~${a}`);

  const visited = new Set<string>();
  const chains: SpineChain[] = [];

  for (const node of graph.nodes) {
    if (!isBoundary(node.nodeId)) continue;
    for (const neighborId of adjacency.get(node.nodeId) ?? []) {
      const startKey = edgeKey(node.nodeId, neighborId);
      if (visited.has(startKey)) continue;
      visited.add(startKey);

      const nodeIds = [node.nodeId, neighborId];
      let previous = node.nodeId;
      let current = neighborId;
      while (!isBoundary(current)) {
        const neighbors = adjacency.get(current) ?? [];
        const next = neighbors.find((candidate) => candidate !== previous);
        if (next === undefined) break;
        const key = edgeKey(current, next);
        if (visited.has(key)) break;
        visited.add(key);
        nodeIds.push(next);
        previous = current;
        current = next;
      }

      const nodes = nodeIds
        .map((id) => byId.get(id))
        .filter((candidate): candidate is SpineControlNode => candidate !== undefined);
      if (nodes.length >= 2) chains.push({ nodes });
    }
  }

  return chains;
}
