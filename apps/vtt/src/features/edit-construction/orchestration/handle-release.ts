import type { ApplyPatchReplacementRequest, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import type { GlobalHandle, GlobalHandleEdit, GlobalHandleScene } from "../global-handles/index.ts";
import { hasTrait, isGroundType, isSolidType } from "../structure-types/index.ts";
import { faceKey, surfaceKeyText } from "../topology/plan-geometry.ts";
import { releaseFromSolid } from "./detach.ts";
import { collectLinks, type RulerLinks } from "../ruler/index.ts";
import type { SnapAnchor } from "../ruler/index.ts";
import { joinedStructures } from "./rigid-carry.ts";
import { rejoinNodes, endJoinsOf } from "./weld-pause.ts";

/**
 * What a handle's drag lets go of, snaps and joins -- the structural half of
 * dragging a handle, apart from the gesture that turns the pointer into an
 * intent. Every answer is read from the handle's own declaration and the
 * structures' shapes and traits, never from which kind of handle or type it
 * is.
 */

type RegionPart = Extract<GlobalHandleEdit, { kind: "region-part" }>;

/** The nodes of the part `target` names -- a corner, or a side's two ends; none for the whole. */
export function partNodes(topologies: readonly ConstructionRegionTopology[], target: GlobalHandle["target"]): readonly string[] {
  if (target?.kind === "vertex") return [target.nodeId];
  if (target?.kind !== "edge") return [];
  const use = topologies.flatMap((topology) => topology.outerLoops.flat()).find((candidate) => candidate.edgeId === target.edgeId);
  return use ? [use.startNodeId, use.endNodeId] : [];
}

/** What of `handle`'s drag snaps: the nodes of the part it drags, or -- dragging the whole -- the lowest of its structure's. */
export function snapAnchorsOf(scene: GlobalHandleScene, handle: GlobalHandle): readonly SnapAnchor[] {
  const at = new Map(scene.graph.nodes.map((node) => [node.id, node.position]));
  let ids = partNodes(scene.topologies, handle.target);
  if (ids.length === 0) {
    const low = Math.min(...handle.nodeIds.map((id) => at.get(id)?.y ?? Infinity));
    ids = handle.nodeIds.filter((id) => Math.abs((at.get(id)?.y ?? Infinity) - low) < 0.05);
  }
  return ids.flatMap((id) => { const position = at.get(id); return position ? [{ id, position }] : []; });
}

/** What `handle`'s drag snaps onto: every other structure's outline -- but, dragging the whole, not what goes with it. */
export function snapLinksOf(scene: GlobalHandleScene, handle: GlobalHandle): RulerLinks {
  const faces = scene.topologies.filter((topology) => handle.faces?.includes(faceKey(topology)));
  const moving = handle.target === undefined ? joinedStructures(scene.topologies, faces, isGroundType) : faces;
  return collectLinks(scene.topologies, { skip: new Set(moving.map(faceKey)), isGround: isGroundType });
}

/**
 * A part of a structure that is not solid -- a wall's foot, its foot run --
 * held with a solid one -- the platform it stands on -- is let go of for the
 * drag, so it slides along instead of carrying the solid one whole; where it
 * lands on an outline it is joined again (`joinWhereLanded`). A structure
 * joined by a weld has its own pause instead. `undefined` when there is
 * nothing to let go.
 */
export function releasePart(topologies: readonly ConstructionRegionTopology[], graph: GlobalHandleScene["graph"], part: RegionPart, operationId: string): ApplyPatchReplacementRequest | undefined {
  const face = topologies.find((topology) => faceKey(topology) === surfaceKeyText(part.seed));
  if (!face || isSolidType(face.surfaceType) || endJoinsOf(graph, topologies, face).length > 0) return undefined;
  return releaseFromSolid(topologies, new Set(partNodes(topologies, part.target)), isGroundType, isSolidType, operationId);
}

/**
 * The nodes among `ids` that stand on a floor's outline without being its,
 * joined to it there -- the floor passes through them, cut where they stand
 * partway along a side -- as one replacement; `undefined` when none does.
 * Nothing is moved to join.
 */
export function joinWhereLanded(topologies: readonly ConstructionRegionTopology[], ids: readonly string[], operationId: string): ApplyPatchReplacementRequest | undefined {
  const floors = topologies.filter((topology) => hasTrait(topology.surfaceType, "floor"));
  const onFloor = new Set(floors.flatMap((floor) => floor.nodes.map((node) => node.id)));
  const loose = [...new Set(ids)].filter((id) => !onFloor.has(id));
  if (loose.length === 0) return undefined;
  const floorKeys: readonly ConstructionSurfaceKey[] = floors.map((floor) => floor.surfaceKey);
  const links = loose.map((id) => ({ rung: { edgeId: id, startNodeId: id, endNodeId: id }, floors: floorKeys, welded: false }));
  return rejoinNodes(topologies, links, operationId).request;
}
