import type { ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import { globalHandleId } from "../../global-handles/index.ts";
import type { GlobalHandle, GlobalHandleEdit, GlobalHandleProvider, GlobalHandleScene } from "../../global-handles/index.ts";
import { hasTrait, structureTypeFor, type StructureEnd, type StructureEndName, type StructureEnds } from "../../structure-types/index.ts";
import { handleNodeName } from "./handle-name.ts";
import { endJointNear, releasableFace } from "../free-end-welds.ts";
import { floorLandingNear, floorsWeldedBy, floorsWithout, reweldFloors, type EndJoint } from "../../topology/floor-weld.ts";
import { faceKey } from "../../topology/plan-geometry.ts";

/** Where an end's own tilt handle stands: this far on past the end, the way the structure runs out there, and this high. */
const TILT_OUT = 1;
const TILT_UP = 0.5;

/** How close an end must still stand to a floor's edge to count as staying welded there. */
const KEPT_REACH = 1e-2;

/** An end handle: the generic handle, with the structure it moves and which end. */
export interface EndGlobalHandle extends GlobalHandle {
  readonly topology: ConstructionRegionTopology;
  readonly end: StructureEndName;
}


function capabilityOf(topology: ConstructionRegionTopology): StructureEnds | undefined {
  return structureTypeFor(topology.surfaceType)?.ends;
}

/** Every floor of the scene -- what an end can land on. */
const floorsOf = (scene: GlobalHandleScene) => scene.topologies.filter((topology) => hasTrait(topology.surfaceType, "floor"));

/** The floor `end` is welded into, if any. */
function weldedFloor(scene: GlobalHandleScene, end: StructureEnd): ConstructionRegionTopology | undefined {
  return floorsWeldedBy(floorsOf(scene), end.rung)[0];
}


/**
 * The other structure the standing end `standing` continues, as a joint to
 * keep running on from -- `undefined` when that end holds only its own
 * nodes or a floor's. The way on is the structure's own, from that end to
 * its other one.
 */
function continued(scene: GlobalHandleScene, handle: EndGlobalHandle, standing: StructureEnd, ends: readonly StructureEnd[]): EndJoint | undefined {
  const holders = floorsWeldedBy(scene.topologies.filter((face) => faceKey(face) !== faceKey(handle.topology) && !releasableFace(face)), standing.rung);
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
function placed(scene: GlobalHandleScene, handle: EndGlobalHandle, ends: readonly StructureEnd[], at: ConstructionPosition, under: ConstructionSurfaceKey | undefined, operationId: string, lifted = false): GlobalHandleEdit {
  const capability = capabilityOf(handle.topology)!;
  const rungs = ends.map((end) => end.rung);
  const released = floorsWithout(floorsOf(scene), rungs);
  const standing = ends.find((end) => end.name !== handle.end)!;
  const standingFloor = weldedFloor(scene, standing);
  const kept = standingFloor && floorLandingNear(released.filter((floor) => faceKey(floor) === faceKey(standingFloor)), standing.position, { reach: KEPT_REACH });
  // Another structure's free end within reach is run on from, before any floor's edge.
  const own = new Set(handle.topology.nodes.map((node) => node.id));
  // A lifted end stays where it is in plan: it lands nowhere, and comes off whatever held it.
  const joint = lifted ? undefined : endJointNear(scene.graph, scene.topologies, at, { own });
  const landing = joint || lifted ? undefined : floorLandingNear(standingFloor ? released.filter((floor) => faceKey(floor) !== faceKey(standingFloor)) : released, at, under ? { under } : {});
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
 * on, and takes it off the one it left. What the structure becomes is
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
      const ends = capability.ends(topology);
      return ends.flatMap((end): EndGlobalHandle[] => {
        // On past the end, away from the other one: clear of the middle's handles.
        const far = ends.find((other) => other !== end)?.position ?? end.position;
        const span = Math.hypot(end.position.x - far.x, end.position.z - far.z) || 1;
        const on = { x: (end.position.x - far.x) / span, z: (end.position.z - far.z) / span };
        const base = { pivot: end.position, owner: topology.surfaceType, provider: "ends", nodeIds, faces: [faceKey(topology)], topology, end: end.name };
        const lift = end.name === "origin" ? "originHeight" : "destinationHeight";
        return [
          { ...base, id: globalHandleId(end.name, name), kind: end.name, position: end.position, motion: { kind: "plane" } },
          // Above the end: raising or lowering it alone is how steeply the structure climbs.
          { ...base, id: globalHandleId(lift, name), kind: lift, motion: { kind: "vertical" },
            position: { x: end.position.x + on.x * TILT_OUT, y: end.position.y + TILT_UP, z: end.position.z + on.z * TILT_OUT } },
        ];
      });
    });
  },
  plan(scene, generic, intent, _port, operationId) {
    const handle = generic as EndGlobalHandle;
    const ends = capabilityOf(handle.topology)?.ends(handle.topology) ?? [];
    const end = ends.find((candidate) => candidate.name === handle.end);
    if (!end) return undefined;
    if (intent.kind === "place") return placed(scene, handle, ends, intent.at, intent.under, operationId);
    if (intent.kind === "lift") return placed(scene, handle, ends, { ...end.position, y: end.position.y + intent.dy }, undefined, operationId, true);
    return undefined;
  },
};
