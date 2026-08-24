import type { ConstructionPosition } from "@/ports";

import type { PathSpineEndpointCandidates } from "../../modes/surface-edit-contract.ts";

/** The minimum graph information the path cloud needs to resolve one end of a new stroke. */
export interface PathSpineConnectionNode {
  readonly nodeId: string;
  readonly position: ConstructionPosition;
  readonly degree: number;
  readonly surfaceRefs: readonly string[];
}

export interface PathSpineConnectionEdge {
  readonly edgeId: string;
  readonly from: ConstructionPosition;
  readonly to: ConstructionPosition;
  readonly surfaceRefs: readonly string[];
}

export interface PathSpineEndpointResolution {
  readonly kind: "continue" | "node" | "union" | "free";
  readonly nodeId?: string;
  readonly edgeId?: string;
}

/** Squared XZ distance from a point to a finite segment. */
function distanceToSegmentSquared(
  point: ConstructionPosition,
  from: ConstructionPosition,
  to: ConstructionPosition,
): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-9) return (point.x - from.x) ** 2 + (point.z - from.z) ** 2;
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSquared));
  const x = from.x + dx * t;
  const z = from.z + dz * t;
  return (point.x - x) ** 2 + (point.z - z) ** 2;
}

function closestNode(
  nodes: readonly PathSpineConnectionNode[],
  point: ConstructionPosition,
): PathSpineConnectionNode | undefined {
  let result: { readonly node: PathSpineConnectionNode; readonly distance: number } | undefined;
  for (const node of nodes) {
    const distance = (node.position.x - point.x) ** 2 + (node.position.z - point.z) ** 2;
    if (result === undefined || distance < result.distance) result = { node, distance };
  }
  return result?.node;
}

/**
 * Resolves an endpoint according to the path-cloud connection policy.
 *
 * A direct continuation wins only when its target remains a free end
 * (`degree <= 1`); otherwise the same target can still become a proper
 * junction through the next `node` rule. A candidate union is deliberately
 * last: only the cloud may decide to split that edge and weld a new node.
 */
export function resolvePathSpineEndpoint(
  candidates: PathSpineEndpointCandidates,
  point: ConstructionPosition,
  nodes: readonly PathSpineConnectionNode[],
  edges: readonly PathSpineConnectionEdge[],
  unionTolerance: number,
): PathSpineEndpointResolution {
  const continuation = candidates.continuation;
  if (continuation !== undefined) {
    const direct =
      continuation.nodeId === undefined
        ? undefined
        : nodes.find((node) => node.nodeId === continuation.nodeId);
    const bySurface =
      direct ??
      (continuation.surfaceRef === undefined
        ? undefined
        : closestNode(
            nodes.filter((node) => node.surfaceRefs.includes(continuation.surfaceRef!)),
            point,
          ));
    if (bySurface !== undefined && bySurface.degree <= 1) return { kind: "continue", nodeId: bySurface.nodeId };
  }

  if (candidates.nodeId !== undefined) {
    const node = nodes.find((candidate) => candidate.nodeId === candidates.nodeId);
    if (node !== undefined) return { kind: "node", nodeId: node.nodeId };
  }

  if (candidates.unionSurfaceRef !== undefined) {
    const toleranceSquared = unionTolerance * unionTolerance;
    const candidatesOnSurface = edges.filter((edge) => edge.surfaceRefs.includes(candidates.unionSurfaceRef!));
    let closest: { readonly edge: PathSpineConnectionEdge; readonly distance: number } | undefined;
    for (const edge of candidatesOnSurface) {
      const distance = distanceToSegmentSquared(point, edge.from, edge.to);
      if (distance > toleranceSquared || (closest !== undefined && distance >= closest.distance)) continue;
      closest = { edge, distance };
    }
    if (closest !== undefined) return { kind: "union", edgeId: closest.edge.edgeId };
  }

  return { kind: "free" };
}
