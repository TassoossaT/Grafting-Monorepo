import type { ConstructionRegionTopology } from "@/ports";

import type { GlobalHandleEdit, GlobalHandleScene } from "../../global-handles/index.ts";
import { hasTrait, structureTypeFor } from "../../structure-types/index.ts";
import { floorsWeldedBy, reweldFloors } from "../../topology/floor-weld.ts";

/**
 * Deleting whole structures built from regions: every end welded into a
 * floor is taken off it first, so the floor's side is whole again, then the
 * faces go. What stood on them -- a ramp welded into a deleted floor --
 * keeps its own nodes and is simply left with a free end.
 */
export function removalOf(scene: GlobalHandleScene, faces: readonly ConstructionRegionTopology[], operationId: string): GlobalHandleEdit {
  const floors = scene.topologies.filter((topology) => hasTrait(topology.surfaceType, "floor"));
  const rungs = faces.flatMap((face) => structureTypeFor(face.surfaceType)?.ends?.ends(face).map((end) => end.rung) ?? [])
    .filter((rung) => floorsWeldedBy(floors, rung).length > 0);
  const surfaceKeys = faces.map((face) => face.surfaceKey);
  if (rungs.length === 0) return { kind: "remove", surfaceKeys };
  const released = reweldFloors(scene.topologies, { detach: rungs, attach: [] }, new Map(), `${operationId}:release`);
  return {
    kind: "remove",
    surfaceKeys,
    release: { operationId, sourceSurfaceKeys: released.sourceSurfaceKeys, patch: { nodes: released.nodes, edges: released.edges, regions: released.regions } },
  };
}
