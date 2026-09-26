import type { ConstructionRegionTopology } from "@/ports";

import type { GlobalHandleScene } from "../../global-handles/index.ts";

/**
 * The node a structure's global handles are named after: its lowest node
 * that no other structure holds, so two structures welded together never
 * name their handles alike; its lowest node when every one is shared.
 */
export function handleNodeName(scene: GlobalHandleScene, own: readonly ConstructionRegionTopology[], sortedNodeIds: readonly string[]): string {
  const ownKeys = new Set(own.map((topology) => topology.surfaceKey.join("\u0000")));
  const foreign = new Set(scene.topologies.filter((topology) => !ownKeys.has(topology.surfaceKey.join("\u0000"))).flatMap((topology) => topology.nodes.map((node) => node.id)));
  return sortedNodeIds.find((id) => !foreign.has(id)) ?? sortedNodeIds[0]!;
}
