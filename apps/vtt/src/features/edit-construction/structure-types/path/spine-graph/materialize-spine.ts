import type { ConstructionGraphPatch, ConstructionGraphSnapshot, ConstructionPosition } from "@/ports";

import type { pathSpineDraftFor } from "../path-spine-draft.ts";
import { spineControlNodeId } from "./spine-node-id.ts";

interface SpineEdgeCandidate {
  readonly edge: ConstructionGraphPatch["edges"][number];
  readonly from: ConstructionPosition & { readonly id: string };
  readonly to: ConstructionPosition & { readonly id: string };
}

interface SpineEdgeCut {
  readonly nodeId: string;
  readonly position: ConstructionPosition;
  readonly t: number;
}

interface SpineIntersection {
  readonly t: number;
  readonly u: number;
}

const SPINE_INTERSECTION_EPSILON = 1e-6;

/** The proper crossing of two XZ line segments, with both segment parameters. */
function segmentIntersection(
  from: ConstructionPosition,
  to: ConstructionPosition,
  otherFrom: ConstructionPosition,
  otherTo: ConstructionPosition,
): SpineIntersection | undefined {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const otherDx = otherTo.x - otherFrom.x;
  const otherDz = otherTo.z - otherFrom.z;
  const determinant = dx * otherDz - dz * otherDx;
  if (Math.abs(determinant) < SPINE_INTERSECTION_EPSILON) return undefined;
  const betweenX = otherFrom.x - from.x;
  const betweenZ = otherFrom.z - from.z;
  const t = (betweenX * otherDz - betweenZ * otherDx) / determinant;
  const u = (betweenX * dz - betweenZ * dx) / determinant;
  if (
    t <= SPINE_INTERSECTION_EPSILON ||
    t >= 1 - SPINE_INTERSECTION_EPSILON ||
    u < -SPINE_INTERSECTION_EPSILON ||
    u > 1 + SPINE_INTERSECTION_EPSILON
  ) {
    return undefined;
  }
  return { t, u: Math.max(0, Math.min(1, u)) };
}

export interface MaterializedSpine {
  readonly graphPatch: ConstructionGraphPatch;
  readonly controlPoints: readonly ConstructionPosition[];
}

/** Materializes and locally snaps the type-owned spine against its own network. */
export function graphPatchForSpine(
  snapshot: ConstructionGraphSnapshot,
  spine: NonNullable<ReturnType<typeof pathSpineDraftFor>>,
  snapTolerance: number,
): MaterializedSpine {
  const spineNodes = snapshot.nodes.filter((node) => node.id.startsWith("spine:"));
  const nearest = (point: ConstructionPosition) => spineNodes
    .map((node) => ({ node, distance: Math.hypot(node.position.x - point.x, node.position.z - point.z) }))
    .filter((candidate) => candidate.distance <= snapTolerance)
    .sort((left, right) => left.distance - right.distance)[0]?.node;
  const nodeById = new Map(spineNodes.map((node) => [node.id, node]));
  const edges = snapshot.edges
    .flatMap((edge): SpineEdgeCandidate[] => {
      const from = nodeById.get(edge.startNodeId);
      const to = nodeById.get(edge.endNodeId);
      return from === undefined || to === undefined ? [] : [{ edge, from: { ...from.position, id: from.id }, to: { ...to.position, id: to.id } }];
    });
  const nearestEdge = (point: ConstructionPosition) => edges
    .map((candidate) => {
      const dx = candidate.to.x - candidate.from.x;
      const dz = candidate.to.z - candidate.from.z;
      const lengthSquared = dx * dx + dz * dz;
      const t = lengthSquared < 1e-9 ? 0 : Math.max(0, Math.min(1, ((point.x - candidate.from.x) * dx + (point.z - candidate.from.z) * dz) / lengthSquared));
      return {
        ...candidate,
        t,
        position: {
          x: candidate.from.x + dx * t,
          y: candidate.from.y + (candidate.to.y - candidate.from.y) * t,
          z: candidate.from.z + dz * t,
        },
        distance: Math.hypot(point.x - (candidate.from.x + dx * t), point.z - (candidate.from.z + dz * t)),
      };
    })
    .filter((candidate) => candidate.distance <= snapTolerance)
    .sort((left, right) => left.distance - right.distance)[0];
  const cutsByEdge = new Map<string, SpineEdgeCut[]>();
  const cutsByPosition: SpineEdgeCut[] = [];
  let nextMintedIndex = spine.controlPoints.length;
  const mint = (): string => spineControlNodeId(spine.corridorId, nextMintedIndex++);
  const samePosition = (left: ConstructionPosition, right: ConstructionPosition): boolean =>
    Math.hypot(left.x - right.x, left.z - right.z) <= SPINE_INTERSECTION_EPSILON;
  const cutFor = (candidate: SpineEdgeCandidate, position: ConstructionPosition, t: number): SpineEdgeCut => {
    if (t <= SPINE_INTERSECTION_EPSILON) return { nodeId: candidate.from.id, position: candidate.from, t: 0 };
    if (t >= 1 - SPINE_INTERSECTION_EPSILON) return { nodeId: candidate.to.id, position: candidate.to, t: 1 };
    const existing = cutsByPosition.find((cut) => samePosition(cut.position, position));
    const cut = { nodeId: existing?.nodeId ?? mint(), position: existing?.position ?? position, t };
    if (existing === undefined) cutsByPosition.push(cut);
    const edgeCuts = cutsByEdge.get(candidate.edge.edgeId) ?? [];
    if (!edgeCuts.some((other) => other.nodeId === cut.nodeId)) {
      cutsByEdge.set(candidate.edge.edgeId, [...edgeCuts, cut]);
    }
    return cut;
  };
  const resolved = spine.controlPoints.map((point, index) => {
    const minted = spineControlNodeId(spine.corridorId, index);
    const node = nearest(point);
    if (node !== undefined) {
      return { nodeId: node.id, position: node.position };
    }
    const edge = nearestEdge(point);
    if (edge === undefined) {
      return { nodeId: minted, position: point };
    }
    const cut = cutFor(edge, edge.position, edge.t);
    return { nodeId: cut.nodeId, position: cut.position };
  });

  const expanded = resolved.flatMap((point, index) => {
    if (index === 0) return [point];
    const previous = resolved[index - 1]!;
    const crossings = edges
      .flatMap((edge) => {
        const intersection = segmentIntersection(previous.position, point.position, edge.from, edge.to);
        if (intersection === undefined) return [];
        const position = {
          x: previous.position.x + (point.position.x - previous.position.x) * intersection.t,
          y: edge.from.y + (edge.to.y - edge.from.y) * intersection.u,
          z: previous.position.z + (point.position.z - previous.position.z) * intersection.t,
        };
        const cut = cutFor(edge, position, intersection.u);
        return [{ t: intersection.t, nodeId: cut.nodeId, position: cut.position }];
      })
      .sort((left, right) => left.t - right.t)
      .filter((crossing, crossingIndex, all) => crossingIndex === 0 || crossing.nodeId !== all[crossingIndex - 1]!.nodeId);
    return [...crossings, point];
  });

  const splitEdges = [...cutsByEdge.entries()].flatMap(([edgeId, cuts]) => {
    const edge = edges.find((candidate) => candidate.edge.edgeId === edgeId)!;
    const nodes = [
      { nodeId: edge.from.id, position: edge.from, t: 0 },
      ...cuts.sort((left, right) => left.t - right.t),
      { nodeId: edge.to.id, position: edge.to, t: 1 },
    ];
    return nodes.slice(0, -1).flatMap((from, index) => {
      const to = nodes[index + 1]!;
      return from.nodeId === to.nodeId
        ? []
        : [{ edgeId: `spine-split:${edgeId}:${index}`, startNodeId: from.nodeId, endNodeId: to.nodeId }];
    });
  });
  const nodes = new Map(expanded.map((point) => [point.nodeId, point.position]));
  return {
    controlPoints: expanded.map((point) => point.position),
    graphPatch: {
      nodes: [...nodes].map(([id, position]) => ({ id, position })),
      removedEdgeIds: [...cutsByEdge.keys()],
      edges: [
        ...expanded.slice(0, -1).map((from, index) => ({
          edgeId: `spine-edge:${spine.corridorId}:${index}`,
          startNodeId: from.nodeId,
          endNodeId: expanded[index + 1]!.nodeId,
        })).filter((edge) => edge.startNodeId !== edge.endNodeId),
        ...splitEdges,
      ],
    },
  };
}
