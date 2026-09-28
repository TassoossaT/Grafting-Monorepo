import type { ApplyPatchReplacementRequest, ConstructionRegionTopology } from "@/ports";

import { faceKey } from "../topology/plan-geometry.ts";
import { renamedPiece, rewriteFaces } from "../topology/face-rewrite.ts";

/**
 * Letting go: the structure `members` makes gets nodes of its own wherever
 * it shares one with another structure -- a wall's feet on a platform's
 * outline, a ramp's end in a floor's edge -- so each stands on its own from
 * then on. The other structure keeps its nodes and its shape; the ground,
 * which is only ever cut round what stands, is never counted as holding
 * anything. Any type may let go this way: nothing here asks what it is.
 */


/** The nodes `members` shares with any other structure but the ground. */
export function sharedNodes(topologies: readonly ConstructionRegionTopology[], members: readonly ConstructionRegionTopology[], isGround: (surfaceType: string) => boolean): ReadonlySet<string> {
  const own = new Set(members.map(faceKey));
  const mine = new Set(members.flatMap((member) => member.nodes.map((node) => node.id)));
  const shared = new Set<string>();
  for (const topology of topologies) {
    if (own.has(faceKey(topology)) || isGround(topology.surfaceType)) continue;
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
  // An edge through a node let go of is a new edge of its own; the rest stay as they are.
  const { edges, regions } = rewriteFaces(members, (use) => [renamedPiece(use, own, operationId)], operationId);
  return {
    operationId,
    sourceSurfaceKeys: members.map((member) => member.surfaceKey),
    patch: { nodes: [...shared].map((id) => ({ id: own(id), position: positions.get(id)! })), edges, regions },
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
