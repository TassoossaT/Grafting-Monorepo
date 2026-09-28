import { describeSpineChain, planSpineChainEdit, planSpineTransform, spineGlobalHandles, type SpineGlobalHandle } from "../../spine/index.ts";
import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import { hasTrait, structureTypeFor } from "../../structure-types/index.ts";
import { floorsWeldedBy } from "../../topology/floor-weld.ts";
import { rotateInPlan } from "../../topology/plan-rotation.ts";
import { joinedStructures } from "../rigid-carry.ts";
import type { GlobalHandleProvider } from "../../global-handles/index.ts";

/** The narrowest a spiral is pushed in to by its radius handle. */
const MIN_RADIUS = 0.5;

/**
 * Global handles of structures built from a spine: every intent becomes a
 * spine graph patch the spine's owner regenerates from.
 */
export const spineHandleProvider: GlobalHandleProvider = {
  name: "spine",
  handles: (scene) => spineGlobalHandles(scene.graph).filter((handle) => structureTypeFor(handle.owner)?.spine !== undefined),
  plan(scene, generic, intent, port, operationId) {
    const handle = generic as SpineGlobalHandle;
    const graphPatch = (() => {
      switch (intent.kind) {
        case "move": return planSpineTransform(scene.graph, handle, { delta: intent.delta });
        case "rotate": return planSpineTransform(scene.graph, handle, { rotation: { pivot: handle.pivot, angle: intent.angle } });
        case "height": return planSpineTransform(scene.graph, handle, { delta: { x: 0, y: intent.dy, z: 0 } });
        case "lift": {
          // The handle's own end alone; the owner regrades between the ends.
          const id = handle.ends?.[handle.kind === "originHeight" ? 0 : 1];
          const at = id && scene.graph.nodes.find((node) => node.id === id);
          return at ? { nodes: [{ id: at.id, position: { ...at.position, y: at.position.y + intent.dy } }], edges: [] } : undefined;
        }
        case "radius": {
          const shape = describeSpineChain(scene.graph, handle.id);
          if (!shape?.spiral) return undefined;
          return planSpineChainEdit(scene.graph, port, handle.id, { ...shape, spiral: { ...shape.spiral, radius: Math.max(MIN_RADIUS, shape.spiral.radius + intent.delta) } }, operationId);
        }
        case "wind": {
          const shape = describeSpineChain(scene.graph, handle.id);
          if (!shape?.spiral) return undefined;
          // Round the way the spiral already turns winds it on; the other way, back.
          const turns = Math.max(0.05, shape.spiral.turns + (shape.spiral.positive ? intent.angle : -intent.angle) / (2 * Math.PI));
          const keeps = structureTypeFor(handle.owner)?.spine?.windKeeps ?? "grade";
          const endHeight = keeps === "height" ? shape.endHeight : shape.startHeight + ((shape.endHeight - shape.startHeight) * turns) / shape.spiral.turns;
          return planSpineChainEdit(scene.graph, port, handle.id, { ...shape, endHeight, spiral: { ...shape.spiral, turns } }, operationId);
        }
      }
    })();
    if (!graphPatch) return undefined;
    // Moving, turning or raising the spine as a whole carries what is welded
    // to the ends that move -- solid floors and all they hold -- the same way.
    const carry = intent.kind === "move" ? { ends: handle.ends ?? [], place: (p: ConstructionPosition) => ({ x: p.x + intent.delta.x, y: p.y + intent.delta.y, z: p.z + intent.delta.z }) }
      : intent.kind === "rotate" ? { ends: handle.ends ?? [], place: (p: ConstructionPosition) => ({ ...rotateInPlan(p, handle.pivot, intent.angle), y: p.y }) }
      : intent.kind === "height" ? { ends: handle.ends ?? [], place: (p: ConstructionPosition) => ({ ...p, y: p.y + intent.dy }) }
      : undefined;
    const carried = carry && carriedByEnds(scene.topologies, handle.owner, carry.ends, carry.place);
    if (!carried || carried.faces.length === 0) return { kind: "spine", owner: handle.owner, graphPatch };
    const moves = new Map(graphPatch.nodes.map((node) => [node.id, node]));
    for (const node of carried.nodes) if (!moves.has(node.id)) moves.set(node.id, node);
    return { kind: "spine", owner: handle.owner, graphPatch: { ...graphPatch, nodes: [...moves.values()] }, carries: carried.faces.map((face) => face.surfaceKey) };
  },
};

/**
 * What is welded to the spine's `ends` -- the floors their rungs splice
 * into, and everything joined to those -- with every node taken by `place`.
 * Spine-built faces are left out: their own spines regenerate them.
 */
function carriedByEnds(topologies: readonly ConstructionRegionTopology[], owner: string, ends: readonly string[], place: (p: ConstructionPosition) => ConstructionPosition) {
  const endRung = structureTypeFor(owner)?.spine?.endRung;
  if (!endRung) return undefined;
  // Floors welded to those ends, and structures that took an end over (a straight ramp run on from it).
  const holders = topologies.filter((topology) => hasTrait(topology.surfaceType, "floor") || structureTypeFor(topology.surfaceType)?.ends?.adopt !== undefined);
  const welded = ends.flatMap((id) => floorsWeldedBy(holders, endRung(id)));
  const faces = joinedStructures(topologies, welded, (surfaceType) => hasTrait(surfaceType, "ground") || structureTypeFor(surfaceType)?.spine !== undefined);
  const nodes = new Map(faces.flatMap((face) => face.nodes.map((node) => [node.id, { id: node.id, position: place(node.position) }] as const)));
  return { faces, nodes: [...nodes.values()] };
}
