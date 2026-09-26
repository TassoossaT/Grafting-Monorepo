import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import { globalHandleId } from "../../global-handles/index.ts";
import type { GlobalHandle, GlobalHandleProvider, GlobalHandleScene } from "../../global-handles/index.ts";
import { outward, ROTATE_REACH } from "../../spine/spine-global-handles.ts";
import { hasTrait, structureTypeFor } from "../../structure-types/index.ts";
import { joinedStructures } from "../rigid-carry.ts";
import { handleNodeName } from "./handle-name.ts";
import { reverseGeometry } from "../../topology/boundary-edges.ts";
import { rotateInPlan } from "../../topology/plan-rotation.ts";

/** How far above its pivot a cloud's height handle stands. */
const HEIGHT_REACH = 1.5;

/** A global handle placed on a cloud of regions: the generic handle, with the regions it stands for. */
export interface CloudGlobalHandle extends GlobalHandle {
  readonly members: readonly ConstructionRegionTopology[];
}

/** The clouds of the scene whose type is not spine-built and declares handles, as the engine groups them. */
function cloudsOf(scene: GlobalHandleScene): readonly (readonly ConstructionRegionTopology[])[] {
  const candidates = scene.topologies.filter((topology) => {
    const type = structureTypeFor(topology.surfaceType);
    return type !== undefined && type.spine === undefined && (type.globalHandles?.length ?? 0) > 0;
  });
  const byKey = new Map(candidates.map((topology) => [topology.surfaceKey.join("|"), topology]));
  const placed = new Set<string>();
  const clouds: ConstructionRegionTopology[][] = [];
  for (const topology of candidates) {
    const key = topology.surfaceKey.join("|");
    if (placed.has(key)) continue;
    const members = [topology, ...scene.cloudFor({ seed: topology.surfaceKey, surfaceType: topology.surfaceType }).surfaceKeys
      .map((member) => byKey.get(member.join("|")))
      .filter((member): member is ConstructionRegionTopology => member !== undefined && member !== topology)];
    for (const member of members) placed.add(member.surfaceKey.join("|"));
    clouds.push(members);
  }
  return clouds;
}

/**
 * Global handles of structures built from regions -- a platform, a ramp:
 * moving and raising go through the type's own region role (so its solver,
 * transport and validation apply); turning places every node itself, arc
 * centres with them, and turns everything joined to the structure with it.
 */
export const cloudHandleProvider: GlobalHandleProvider = {
  name: "cloud",
  handles(scene) {
    return cloudsOf(scene).flatMap((members): CloudGlobalHandle[] => {
      const positions = new Map(members.flatMap((member) => member.nodes.map((node) => [node.id, node.position] as const)));
      const nodeIds = [...positions.keys()].sort();
      const points = [...positions.values()];
      const mean = (axis: "x" | "y" | "z") => points.reduce((sum, p) => sum + p[axis], 0) / points.length;
      const pivot = { x: mean("x"), y: mean("y"), z: mean("z") };
      const { name, nodeId: anchor } = handleNodeName(scene, members, nodeIds);
      const reach = Math.max(...points.map((p) => Math.hypot(p.x - pivot.x, p.z - pivot.z))) + ROTATE_REACH;
      const base = { owner: members[0]!.surfaceType, provider: "cloud", nodeIds, pivot, members };
      return [
        { ...base, id: globalHandleId("pivot", name), kind: "pivot", position: pivot, motion: { kind: "free" } },
        { ...base, id: globalHandleId("rotate", name), kind: "rotate", position: outward(pivot, positions.get(anchor)!, reach), motion: { kind: "orbit", center: pivot } },
        { ...base, id: globalHandleId("height", name), kind: "height", position: { ...pivot, y: pivot.y + HEIGHT_REACH }, motion: { kind: "vertical" } },
      ];
    });
  },
  plan(scene, generic, intent) {
    const handle = generic as CloudGlobalHandle;
    const seed = handle.members[0]!.surfaceKey;
    if (intent.kind === "move") return { kind: "region-move", seed, delta: intent.delta };
    if (intent.kind === "height") return { kind: "region-move", seed, delta: { x: 0, y: intent.dy, z: 0 } };
    if (intent.kind !== "rotate") return undefined;
    // Everything joined to it turns with it as one piece -- a welded ramp, the
    // floor it lands on, the walls on that floor. The ground is re-cut round
    // where it lands, never carried.
    const turned = joinedStructures(scene.topologies, handle.members, (surfaceType) => hasTrait(surfaceType, "ground"));
    const positions = new Map<string, ConstructionPosition>(turned.flatMap((member) => member.nodes.map((node) => [node.id, node.position] as const)));
    const moves = [...positions].map(([nodeId, position]) => ({ nodeId, position: rotateInPlan(position, handle.pivot, intent.angle) }));
    const after = new Map(moves.map((move) => [move.nodeId, move.position]));
    for (const member of turned) {
      const reason = structureTypeFor(member.surfaceType)?.validateMotion?.(member, after);
      if (reason) throw new Error(reason);
    }
    const retypes = new Map<string, import("@/ports").ConstructionEdgeGeometry>();
    for (const use of turned.flatMap((member) => [...member.outerLoops, ...member.holes].flat())) {
      if (use.geometry.kind !== "arc" || retypes.has(use.edgeId)) continue;
      const own = use.reversed ? reverseGeometry(use.geometry) : use.geometry;
      if (own.kind !== "arc") continue;
      const center = rotateInPlan({ x: own.center[0], z: own.center[1] }, handle.pivot, intent.angle);
      retypes.set(use.edgeId, { ...own, center: [center.x, center.z] });
    }
    return { kind: "vertices", moves, retypes: [...retypes].map(([edgeId, geometry]) => ({ edgeId, geometry })) };
  },
};
