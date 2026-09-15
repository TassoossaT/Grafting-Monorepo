import type { ConstructionEdgeSnapshot, ConstructionGraphPatch, ConstructionGraphSnapshot } from "@/ports";

import { isSpineControlNodeId } from "./spine-node-id.ts";


/** The app's prospective construction snapshot, without committing its graph patch. */
export function prospectiveGraph(snapshot: ConstructionGraphSnapshot, patch: ConstructionGraphPatch): ConstructionGraphSnapshot {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  for (const node of patch.nodes) nodes.set(node.id, node);
  const removed = new Set(patch.removedEdgeIds ?? []);
  const edges = new Map(snapshot.edges.filter((edge) => !removed.has(edge.edgeId)).map((edge) => [edge.edgeId, edge]));
  for (const edge of patch.edges) edges.set(edge.edgeId, edge);
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/**
 * Which structure type a spine span generates -- a road, a sloped platform,
 * a curved wall. The graph keeps it on the curve (`CurveHandles.surfaceType`)
 * and never reads it; this is where the app does. Every owner stamps its own
 * spans, so this module names no type; a span with no owner generates nothing.
 */
export function spineOwnerOf(edge: Pick<ConstructionEdgeSnapshot, "curve">): string | undefined {
  return edge.curve?.surfaceType || undefined;
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
