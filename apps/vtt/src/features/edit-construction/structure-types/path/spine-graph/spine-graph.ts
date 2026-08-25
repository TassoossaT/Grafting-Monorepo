import type { ConstructionGraphSnapshot, ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import type { CloudTopology } from "../../../topology/construction-cloud.ts";
import { isSpineControlNodeId } from "./spine-node-id.ts";

/**
 * The spine as a graph of control points and the curve edges between them,
 * read back from the live construction graph rather than kept anywhere of
 * its own.
 *
 * **Derived, never stored**, for the same reason `PathRun` already is (see
 * `path-cloud.ts`): every fact here is already in the graph, and a second
 * copy would only give the two something to disagree about.
 *
 * **Not necessarily connected.** A cloud is one surface *type*, not one
 * curve -- two disjoint stretches of road can sit in the same cloud (a
 * terrain patch physically between them still shares no node with either),
 * so this reports every control node and edge found, and leaves "which ones
 * form one continuous run" to whatever reads the graph next. Nothing here
 * assumes a single walk covers it.
 *
 * **No curvature data on an edge.** A Catmull-Rom edge needs its two
 * immediate neighbours' positions to know its own shape, and neighbours are
 * exactly what graph adjacency already gives for free -- walking one node
 * out past each endpoint. Storing a duplicate of that on the edge would be
 * one more thing a move-vertex op would have to keep in sync; reading it
 * fresh at generation time never can go stale.
 */

/** One control point of a spine curve. */
export interface SpineControlNode {
  readonly nodeId: string;
  readonly position: ConstructionPosition;
}

/** One curve segment between two control nodes, as it stands in the graph. */
export interface SpineCurveEdge {
  readonly edgeId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
}

export interface SpineGraph {
  readonly nodes: readonly SpineControlNode[];
  readonly edges: readonly SpineCurveEdge[];
}

/**
 * Reads the durable, type-owned spine from the generic construction graph.
 * Face boundaries are deliberately excluded: a contour is a generated view
 * of this graph and must never be mistaken for its source of truth.
 */
export function spineGraphFromSnapshot(snapshot: ConstructionGraphSnapshot): SpineGraph {
  const nodes = snapshot.nodes
    .filter((node) => isSpineControlNodeId(node.id))
    .map((node) => ({ nodeId: node.id, position: node.position }));
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  const edges = snapshot.edges
    .filter((edge) => nodeIds.has(edge.startNodeId) && nodeIds.has(edge.endNodeId))
    .map((edge) => ({ edgeId: edge.edgeId, fromNodeId: edge.startNodeId, toNodeId: edge.endNodeId }));
  return { nodes, edges };
}

/**
 * Every spine control node and curve edge present in `topologies`,
 * deduplicated by id -- a node or edge shared by more than one band (the two
 * faces either side of the travel line, a junction shared by more than one
 * run) is reported once.
 */
export function spineGraphIn(topologies: readonly ConstructionRegionTopology[]): SpineGraph {
  const nodes = new Map<string, SpineControlNode>();
  const edges = new Map<string, SpineCurveEdge>();

  for (const topology of topologies) {
    for (const node of topology.nodes) {
      if (!isSpineControlNodeId(node.id) || nodes.has(node.id)) continue;
      nodes.set(node.id, { nodeId: node.id, position: node.position });
    }
    for (const loop of [...topology.outerLoops, ...topology.holes]) {
      for (const use of loop) {
        if (edges.has(use.edgeId)) continue;
        if (!isSpineControlNodeId(use.startNodeId) || !isSpineControlNodeId(use.endNodeId)) continue;
        edges.set(use.edgeId, {
          edgeId: use.edgeId,
          fromNodeId: use.startNodeId,
          toNodeId: use.endNodeId,
        });
      }
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** {@link spineGraphIn} over one cloud's own members -- the reading a tool should reach for. */
export function spineGraphOf(cloud: CloudTopology): SpineGraph {
  return spineGraphIn(cloud.members);
}

/** Every node id directly joined to `nodeId` by one curve edge -- this node's own degree is `neighborsOf(...).length`. */
export function neighborsOf(graph: SpineGraph, nodeId: string): readonly string[] {
  const found = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.fromNodeId === nodeId) found.add(edge.toNodeId);
    if (edge.toNodeId === nodeId) found.add(edge.fromNodeId);
  }
  return [...found];
}
