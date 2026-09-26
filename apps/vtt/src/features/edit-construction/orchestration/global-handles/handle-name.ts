import type { ConstructionRegionTopology } from "@/ports";

import type { GlobalHandleScene } from "../../global-handles/index.ts";
import { hasTrait } from "../../structure-types/index.ts";

/**
 * What a structure's global handles are named after: its lowest node that
 * no other structure holds -- ground aside, which rims whatever it was cut
 * round -- so two structures welded together never name their handles
 * alike. When every node is shared, its lowest node and its own type, which
 * two structures joined at every node never have in common.
 */
export function handleNodeName(scene: GlobalHandleScene, own: readonly ConstructionRegionTopology[], sortedNodeIds: readonly string[]): { readonly name: string; readonly nodeId: string } {
  const ownKeys = new Set(own.map((topology) => topology.surfaceKey.join("\u0000")));
  const foreign = new Set(scene.topologies
    .filter((topology) => !ownKeys.has(topology.surfaceKey.join("\u0000")) && !hasTrait(topology.surfaceType, "ground"))
    .flatMap((topology) => topology.nodes.map((node) => node.id)));
  const unshared = sortedNodeIds.find((id) => !foreign.has(id));
  return unshared !== undefined ? { name: unshared, nodeId: unshared } : { name: `${sortedNodeIds[0]!}#${own[0]!.surfaceType}`, nodeId: sortedNodeIds[0]! };
}
