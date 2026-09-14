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

/** A branch crosses a junction only when it is visibly the same road. */
const THROUGH_JUNCTION_COSINE = Math.cos(Math.PI / 4);

/**
 * Every chain in `graph`, split at every node whose degree is not 2.
 *
 * A closed component has no natural free end, so it starts deterministically
 * at its lowest graph id and returns to that same control point. Keeping the
 * closing point makes the generated Catmull-Rom contour continuous there.
 */
export function chainsOf(graph: SpineGraph): readonly SpineChain[] {
  const byId = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    adjacency.set(edge.fromNodeId, [...(adjacency.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    adjacency.set(edge.toNodeId, [...(adjacency.get(edge.toNodeId) ?? []), edge.fromNodeId]);
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((a, b) => a.localeCompare(b));
  }
  const degreeOf = (nodeId: string): number => adjacency.get(nodeId)?.length ?? 0;
  const isBoundary = (nodeId: string): boolean => degreeOf(nodeId) !== 2;
  const edgeKey = (a: string, b: string): string => (a < b ? `${a}~${b}` : `${b}~${a}`);
  const continuationFrom = (previousId: string, nodeId: string): string | undefined => {
    const candidates = (adjacency.get(nodeId) ?? []).filter((candidate) => candidate !== previousId);
    if (candidates.length === 0) return undefined;
    // A degree-two point is an ordinary bend: it always remains one smooth
    // curve, however sharp the bend itself is.
    if (degreeOf(nodeId) === 2) return candidates[0];
    const previous = byId.get(previousId)?.position;
    const current = byId.get(nodeId)?.position;
    if (previous === undefined || current === undefined) return undefined;
    const inX = current.x - previous.x;
    const inZ = current.z - previous.z;
    const inLength = Math.hypot(inX, inZ);
    if (inLength < 1e-9) return undefined;
    const best = candidates
      .map((candidate) => {
        const next = byId.get(candidate)?.position;
        if (next === undefined) return undefined;
        const outX = next.x - current.x;
        const outZ = next.z - current.z;
        const outLength = Math.hypot(outX, outZ);
        return outLength < 1e-9 ? undefined : { candidate, cosine: (inX * outX + inZ * outZ) / (inLength * outLength) };
      })
      .filter((candidate): candidate is { candidate: string; cosine: number } => candidate !== undefined)
      .sort((left, right) => right.cosine - left.cosine || left.candidate.localeCompare(right.candidate))[0];
    return best !== undefined && best.cosine >= THROUGH_JUNCTION_COSINE ? best.candidate : undefined;
  };

  const visited = new Set<string>();
  const chains: SpineChain[] = [];

  // Start at free ends before junctions. That lets the two opposite arms of
  // a T/H/X claim the through-route before a short branch is visited.
  for (const node of [...graph.nodes].sort((left, right) => (degreeOf(left.nodeId) - degreeOf(right.nodeId)) || left.nodeId.localeCompare(right.nodeId))) {
    if (!isBoundary(node.nodeId)) continue;
    for (const neighborId of adjacency.get(node.nodeId) ?? []) {
      const startKey = edgeKey(node.nodeId, neighborId);
      if (visited.has(startKey)) continue;
      visited.add(startKey);

      const nodeIds = [node.nodeId, neighborId];
      let previous = node.nodeId;
      let current = neighborId;
      while (true) {
        const next = continuationFrom(previous, current);
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

  // Every edge left over belongs to a component with degree 2 everywhere: a
  // closed spine. Walk it once, including its closing point, so O-shaped
  // roads are regenerated from the same source graph as open roads.
  for (const edge of graph.edges) {
    const startKey = edgeKey(edge.fromNodeId, edge.toNodeId);
    if (visited.has(startKey)) continue;
    const nodeIds = [edge.fromNodeId, edge.toNodeId];
    visited.add(startKey);
    let previous = edge.fromNodeId;
    let current = edge.toNodeId;
    while (current !== edge.fromNodeId) {
      const next = (adjacency.get(current) ?? []).find((candidate) => candidate !== previous);
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
    if (current === edge.fromNodeId && nodes.length >= 4) chains.push({ nodes });
  }

  return chains;
}
