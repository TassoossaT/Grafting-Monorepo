import type { ConstructionRegionTopology } from "@/ports";

import { globalHandleId } from "../../global-handles/index.ts";
import type { GlobalHandle, GlobalHandleProvider } from "../../global-handles/index.ts";
import { isGroundType, structureTypeFor } from "../../structure-types/index.ts";
import { detachStructure, sharedNodes } from "../detach.ts";
import { handleNodeName } from "./handle-name.ts";
import { faceKey } from "../../topology/plan-geometry.ts";

/**
 * A handle to let go, on every structure joined to another -- a wall on a
 * platform, a ramp in a floor's edge -- whose type declares `detach`:
 * clicked, the structure gets nodes of its own and stands alone
 * (`orchestration/detach.ts`). It stands above the structure, a little to
 * the side of its middle, clear of its other handles.
 */

/** How far above the structure's highest point, and beside its middle, the handle stands. */
const ABOVE = 0.7;
const BESIDE = 0.6;


interface DetachGlobalHandle extends GlobalHandle {
  readonly members: readonly ConstructionRegionTopology[];
}

export const detachHandleProvider: GlobalHandleProvider = {
  name: "detach",
  handles(scene) {
    const candidates = scene.topologies.filter((topology) => structureTypeFor(topology.surfaceType)?.globalHandles?.includes("detach") === true);
    const byKey = new Map(candidates.map((topology) => [faceKey(topology), topology]));
    const placed = new Set<string>();
    const handles: DetachGlobalHandle[] = [];
    for (const topology of candidates) {
      if (placed.has(faceKey(topology))) continue;
      const members = [topology, ...scene.cloudFor({ seed: topology.surfaceKey, surfaceType: topology.surfaceType }).surfaceKeys
        .map((key) => byKey.get(key.join("\u0000")))
        .filter((member): member is ConstructionRegionTopology => member !== undefined && member !== topology)];
      for (const member of members) placed.add(faceKey(member));
      // Only a structure actually holding another's nodes has anything to let go of.
      if (sharedNodes(scene.topologies, members, isGroundType).size === 0) continue;
      const points = members.flatMap((member) => member.nodes.map((node) => node.position));
      const nodeIds = [...new Set(members.flatMap((member) => member.nodes.map((node) => node.id)))].sort();
      const pivot = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length, z: points.reduce((s, p) => s + p.z, 0) / points.length };
      const { name } = handleNodeName(scene, members, nodeIds);
      handles.push({
        id: globalHandleId("detach", name), kind: "detach", owner: topology.surfaceType, provider: "detach", nodeIds, faces: members.map(faceKey), members, pivot,
        position: { x: pivot.x + BESIDE, y: Math.max(...points.map((p) => p.y)) + ABOVE, z: pivot.z },
        motion: { kind: "fixed" },
      });
    }
    return handles;
  },
  plan(scene, generic, intent, _port, operationId) {
    if (intent.kind !== "detach") return undefined;
    const request = detachStructure(scene.topologies, (generic as DetachGlobalHandle).members, isGroundType, operationId);
    if (!request) throw new Error("Nada a soltar: a estrutura já está sozinha.");
    return { kind: "replace", request };
  },
};
