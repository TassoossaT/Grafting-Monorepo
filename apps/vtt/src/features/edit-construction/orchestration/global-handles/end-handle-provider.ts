import type { ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import { globalHandleId } from "../../global-handles/index.ts";
import type { GlobalHandle, GlobalHandleAction, GlobalHandleEdit, GlobalHandleProvider, GlobalHandleScene } from "../../global-handles/index.ts";
import { hasTrait, structureTypeFor, type StructureEnd, type StructureEndName, type StructureEnds } from "../../structure-types/index.ts";
import { handleNodeName } from "./handle-name.ts";
import { removalOf } from "./structure-removal.ts";
import { endJointNear, releasableFace } from "../free-end-welds.ts";
import { floorLandingNear, floorsWeldedBy, floorsWithout, reweldFloors, type EndJoint } from "../../topology/floor-weld.ts";

/** How close an end must still stand to a floor's edge to count as staying welded there. */
const KEPT_REACH = 1e-2;

/** An end handle: the generic handle, with the structure it moves and which end. */
export interface EndGlobalHandle extends GlobalHandle {
  readonly topology: ConstructionRegionTopology;
  readonly end: StructureEndName;
}

const keyOf = (topology: ConstructionRegionTopology) => topology.surfaceKey.join("\u0000");

function capabilityOf(topology: ConstructionRegionTopology): StructureEnds | undefined {
  return structureTypeFor(topology.surfaceType)?.ends;
}

/** Every floor of the scene -- what an end can land on. */
const floorsOf = (scene: GlobalHandleScene) => scene.topologies.filter((topology) => hasTrait(topology.surfaceType, "floor"));

/** The floor `end` is welded into, if any. */
function weldedFloor(scene: GlobalHandleScene, end: StructureEnd): ConstructionRegionTopology | undefined {
  return floorsWeldedBy(floorsOf(scene), end.rung)[0];
}

/** Takes one end off whatever it is welded to: only the floors change. */
function detached(scene: GlobalHandleScene, end: StructureEnd, operationId: string): GlobalHandleEdit | undefined {
  if (!weldedFloor(scene, end)) return undefined;
  const floors = reweldFloors(scene.topologies, { detach: [end.rung], attach: [] }, new Map(), operationId, releasableFace);
  return {
    kind: "replace",
    request: {
      operationId,
      sourceSurfaceKeys: floors.sourceSurfaceKeys,
      patch: { nodes: floors.nodes, edges: floors.edges, regions: floors.regions },
    },
  };
}

/**
 * The other structure the standing end `standing` continues, as a joint to
 * keep running on from -- `undefined` when that end holds only its own
 * nodes or a floor's. The way on is the structure's own, from that end to
 * its other one.
 */
function continued(scene: GlobalHandleScene, handle: EndGlobalHandle, standing: StructureEnd, ends: readonly StructureEnd[]): EndJoint | undefined {
  const holders = floorsWeldedBy(scene.topologies.filter((face) => keyOf(face) !== keyOf(handle.topology) && !releasableFace(face)), standing.rung);
  if (holders.length === 0) return undefined;
  const at = new Map(handle.topology.nodes.map((node) => [node.id, node.position]));
  const a = at.get(standing.rung.startNodeId)!, b = at.get(standing.rung.endNodeId)!;
  const far = ends.find((end) => end !== standing)!.position;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  const length = Math.hypot(far.x - mid.x, far.z - mid.z) || 1;
  return { rung: standing.rung, a, b, mid, out: { x: (far.x - mid.x) / length, z: (far.z - mid.z) / length }, height: mid.y, width: Math.hypot(b.x - a.x, b.z - a.z) };
}

/**
 * The structure rebuilt with one end taken to `at`, as one replacement:
 * both ends come off their floors first, the moved end lands on whatever
 * floor edge it now reaches -- never the floor the other end is on -- and
 * the standing end welds back where it stood.
 */
function placed(scene: GlobalHandleScene, handle: EndGlobalHandle, ends: readonly StructureEnd[], at: ConstructionPosition, under: ConstructionSurfaceKey | undefined, operationId: string): GlobalHandleEdit {
  const capability = capabilityOf(handle.topology)!;
  const rungs = ends.map((end) => end.rung);
  const released = floorsWithout(floorsOf(scene), rungs);
  const standing = ends.find((end) => end.name !== handle.end)!;
  const standingFloor = weldedFloor(scene, standing);
  const kept = standingFloor && floorLandingNear(released.filter((floor) => keyOf(floor) === keyOf(standingFloor)), standing.position, { reach: KEPT_REACH });
  // Another structure's free end within reach is run on from, before any floor's edge.
  const own = new Set(handle.topology.nodes.map((node) => node.id));
  const joint = endJointNear(scene.graph, scene.topologies, at, { own });
  const landing = joint ? undefined : floorLandingNear(standingFloor ? released.filter((floor) => keyOf(floor) !== keyOf(standingFloor)) : released, at, under ? { under } : {});
  const target = joint ? { point: joint.mid, joint } : { point: landing ? { ...at, y: landing.height } : at, ...(landing ? { landing } : {}) };
  const rebuilt = capability.rebuild(handle.topology, handle.end, target, kept, continued(scene, handle, standing, ends));
  // Every node of the structure where it will stand -- another structure's included, where an end continues one.
  const positions = new Map(rebuilt.moved.map((node) => [node.id, node.position]));
  const welds = reweldFloors(scene.topologies, {
    detach: rungs,
    attach: rebuilt.rungs.flatMap((rung) => (rung.landing ? [{ rung: rung.rung, floor: rung.landing.topology.surfaceKey }] : [])),
  }, positions, operationId, releasableFace);
  return {
    kind: "replace",
    request: {
      operationId,
      sourceSurfaceKeys: [handle.topology.surfaceKey, ...welds.sourceSurfaceKeys],
      patch: {
        nodes: [...rebuilt.patch.nodes, ...welds.nodes],
        edges: [...rebuilt.patch.edges, ...welds.edges],
        // The structure's own face first: the first region names the type whose change the commit emits.
        regions: [...rebuilt.patch.regions, ...welds.regions],
      },
      // Its nodes already stand: a patch only adds, so the move goes here.
      graphPatch: { nodes: rebuilt.moved, edges: [], removedEdgeIds: [] },
      ...(rebuilt.footprintOutline ? { footprintOutline: rebuilt.footprintOutline } : {}),
    },
  };
}

/**
 * Origin and destination handles of every structure whose type runs
 * between two ends (`StructureTypeDefinition.ends`): dragging one moves
 * that end, the other standing, and connects it to the floor edge it lands
 * on; each offers to disconnect while welded. What the structure becomes is
 * its type's; welding and unwelding is the same for every type.
 */
export const endHandleProvider: GlobalHandleProvider = {
  name: "ends",
  handles(scene) {
    return scene.topologies.flatMap((topology): EndGlobalHandle[] => {
      const capability = capabilityOf(topology);
      if (!capability) return [];
      const nodeIds = topology.nodes.map((node) => node.id).sort();
      const { name } = handleNodeName(scene, [topology], nodeIds);
      return capability.ends(topology).map((end) => ({
        id: globalHandleId(end.name, name),
        kind: end.name,
        position: end.position,
        pivot: end.position,
        owner: topology.surfaceType,
        provider: "ends",
        nodeIds,
        motion: { kind: "plane" },
        topology,
        end: end.name,
      }));
    });
  },
  plan(scene, generic, intent, _port, operationId) {
    const handle = generic as EndGlobalHandle;
    const ends = capabilityOf(handle.topology)?.ends(handle.topology) ?? [];
    const end = ends.find((candidate) => candidate.name === handle.end);
    if (!end) return undefined;
    if (intent.kind === "remove") return removalOf(scene, [handle.topology], operationId);
    if (intent.kind === "detach") return detached(scene, end, operationId);
    if (intent.kind === "place") return placed(scene, handle, ends, intent.at, intent.under, operationId);
    return undefined;
  },
  actions(scene, generic): readonly GlobalHandleAction[] {
    const handle = generic as EndGlobalHandle;
    const end = capabilityOf(handle.topology)?.ends(handle.topology).find((candidate) => candidate.name === handle.end);
    return end && weldedFloor(scene, end) ? [{ id: "disconnect", label: "Desconectar", intent: { kind: "detach" } }] : [];
  },
};
