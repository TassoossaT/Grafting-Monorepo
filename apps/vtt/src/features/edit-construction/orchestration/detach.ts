import type { ApplyPatchReplacementRequest, ConstructionPatchEdge, ConstructionPatchRegion, ConstructionRegionTopology } from "@/ports";

import { reverseGeometry } from "../topology/boundary-edges.ts";

/**
 * Letting go: the structure `members` makes gets nodes of its own wherever
 * it shares one with another structure -- a wall's feet on a platform's
 * outline, a ramp's end in a floor's edge -- so each stands on its own from
 * then on. The other structure keeps its nodes and its shape; the ground,
 * which is only ever cut round what stands, is never counted as holding
 * anything. Any type may let go this way: nothing here asks what it is.
 */

const keyOf = (topology: ConstructionRegionTopology) => topology.surfaceKey.join("\u0000");

/** The nodes `members` shares with any other structure but the ground. */
export function sharedNodes(topologies: readonly ConstructionRegionTopology[], members: readonly ConstructionRegionTopology[], isGround: (surfaceType: string) => boolean): ReadonlySet<string> {
  const own = new Set(members.map(keyOf));
  const mine = new Set(members.flatMap((member) => member.nodes.map((node) => node.id)));
  const shared = new Set<string>();
  for (const topology of topologies) {
    if (own.has(keyOf(topology)) || isGround(topology.surfaceType)) continue;
    for (const node of topology.nodes) if (mine.has(node.id)) shared.add(node.id);
  }
  return shared;
}

/**
 * `members` given nodes of their own for every one they share -- or, with
 * `only`, for those of them only -- as one replacement; `undefined` when they
 * share none.
 */
export function detachStructure(
  topologies: readonly ConstructionRegionTopology[],
  members: readonly ConstructionRegionTopology[],
  isGround: (surfaceType: string) => boolean,
  operationId: string,
  only?: ReadonlySet<string>,
): ApplyPatchReplacementRequest | undefined {
  const shared = new Set([...sharedNodes(topologies, members, isGround)].filter((id) => !only || only.has(id)));
  if (shared.size === 0) return undefined;
  const own = (id: string) => (shared.has(id) ? `${operationId}:own:${id}` : id);
  const positions = new Map(members.flatMap((member) => member.nodes.map((node) => [node.id, node.position] as const)));
  const edges = new Map<string, ConstructionPatchEdge>();
  const regions: ConstructionPatchRegion[] = [];
  for (const member of members) {
    const walk = (loop: ConstructionRegionTopology["outerLoops"][number]) => loop.map((use) => {
      const from = own(use.startNodeId), to = own(use.endNodeId);
      // An edge through a node let go of is a new edge of its own; the rest stay as they are.
      const edgeId = from !== use.startNodeId || to !== use.endNodeId ? `${operationId}:${use.edgeId}` : use.edgeId;
      edges.set(edgeId, use.reversed
        ? { edgeId, startNodeId: to, endNodeId: from, geometry: reverseGeometry(use.geometry) }
        : { edgeId, startNodeId: from, endNodeId: to, geometry: use.geometry });
      return { edgeId, reversed: use.reversed };
    });
    regions.push({
      regionId: member.surfaceKey[0] === "@region" && member.surfaceKey[1] ? member.surfaceKey[1] : `${operationId}:face:${regions.length}`,
      boundary: walk(member.outerLoops[0] ?? []),
      holes: [...member.outerLoops.slice(1), ...member.holes].map(walk),
      surfaceType: member.surfaceType,
      physical: member.physical,
      ...(member.profile ? { profile: member.profile } : {}),
    });
  }
  return {
    operationId,
    sourceSurfaceKeys: members.map((member) => member.surfaceKey),
    patch: { nodes: [...shared].map((id) => ({ id: own(id), position: positions.get(id)! })), edges: [...edges.values()], regions },
  };
}

/**
 * `nodeIds` let go of by every structure holding them that is not solid:
 * those structures get copies of their own, and the solid ones they were
 * shared with -- a platform under a wall's foot -- keep theirs, so moving the
 * copies moves nothing solid. Structures sharing a node that are not solid,
 * a corner column two walls stand on, keep sharing it. `undefined` when no
 * solid structure holds any of them.
 */
export function releaseFromSolid(
  topologies: readonly ConstructionRegionTopology[],
  nodeIds: ReadonlySet<string>,
  isGround: (surfaceType: string) => boolean,
  isSolid: (surfaceType: string) => boolean,
  operationId: string,
): ApplyPatchReplacementRequest | undefined {
  const holds = (topology: ConstructionRegionTopology) => topology.nodes.some((node) => nodeIds.has(node.id));
  const members = topologies.filter((topology) => holds(topology) && !isSolid(topology.surfaceType) && !isGround(topology.surfaceType));
  if (members.length === 0 || !topologies.some((topology) => holds(topology) && isSolid(topology.surfaceType))) return undefined;
  return detachStructure(topologies, members, isGround, operationId, nodeIds);
}
