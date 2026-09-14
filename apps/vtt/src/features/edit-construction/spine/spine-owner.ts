import type { ConstructionEdgeSnapshot, ConstructionGraphSnapshot } from "@/ports";

import { isSpineControlNodeId } from "./spine-node-id.ts";

/**
 * Which structure type a spine span generates -- a road, a sloped platform,
 * a curved wall. The graph keeps it on the curve (`CurveHandles.surfaceType`)
 * and never reads it; this is where the app does.
 *
 * Spans written before an owner was recorded were all roads, so an absent
 * owner reads as one. That is the only product name this module knows.
 */
export const DEFAULT_SPINE_OWNER = "path";

export function spineOwnerOf(edge: Pick<ConstructionEdgeSnapshot, "curve">): string {
  return edge.curve?.surfaceType || DEFAULT_SPINE_OWNER;
}

/** A predicate selecting the spans one owner generates. */
export function ownedBy(owner: string): (edge: Pick<ConstructionEdgeSnapshot, "curve">) => boolean {
  return (edge) => spineOwnerOf(edge) === owner;
}

/** Whether `edge` is a spine span at all: a curve between two control nodes. */
export function isSpineEdge(edge: ConstructionEdgeSnapshot): boolean {
  return isSpineControlNodeId(edge.startNodeId) && isSpineControlNodeId(edge.endNodeId);
}

/** The owner of the spine a control node or span id belongs to, or `undefined` when it is not on any spine. */
export function spineOwnerAt(snapshot: ConstructionGraphSnapshot, edgeOrNodeId: string): string | undefined {
  const edge = snapshot.edges.find((candidate) => candidate.edgeId === edgeOrNodeId && isSpineEdge(candidate))
    ?? snapshot.edges.find((candidate) => isSpineEdge(candidate) && (candidate.startNodeId === edgeOrNodeId || candidate.endNodeId === edgeOrNodeId));
  return edge === undefined ? undefined : spineOwnerOf(edge);
}

/**
 * Every node and span connected to `seedNodeIds` through spine spans of the
 * prospective graph -- one spine, whichever owner it has.
 */
export function spineComponent(snapshot: ConstructionGraphSnapshot, seedNodeIds: Iterable<string>): ConstructionGraphSnapshot {
  const spans = snapshot.edges.filter(isSpineEdge);
  const adjacent = new Map<string, string[]>();
  for (const span of spans) {
    adjacent.set(span.startNodeId, [...(adjacent.get(span.startNodeId) ?? []), span.endNodeId]);
    adjacent.set(span.endNodeId, [...(adjacent.get(span.endNodeId) ?? []), span.startNodeId]);
  }
  const reached = new Set<string>();
  const pending = [...seedNodeIds];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    pending.push(...(adjacent.get(id) ?? []));
  }
  return {
    nodes: snapshot.nodes.filter((node) => reached.has(node.id)),
    edges: spans.filter((span) => reached.has(span.startNodeId)),
  };
}
