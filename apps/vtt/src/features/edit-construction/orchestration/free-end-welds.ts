import type { ApplyPatchReplacementRequest, ConstructionGraphSnapshot, ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import { isSpineEdge, spineOwnerOf } from "../spine/index.ts";
import { hasTrait, structureTypeFor } from "../structure-types/index.ts";
import { floorsWeldedBy, LANDING_REACH, reweldFloors, type EndJoint, type WeldRung } from "../topology/floor-weld.ts";

/** What a detach takes off an end's nodes: floors and the ground laid against them, never a structure that continues the end. */
export const releasableFace = (face: ConstructionRegionTopology): boolean => hasTrait(face.surfaceType, "floor") || hasTrait(face.surfaceType, "ground");

/**
 * Every end of every structure that nothing else holds -- not welded into a
 * floor, not taken over by another structure: a region
 * structure's declared ends (`StructureTypeDefinition.ends`), and a spine's
 * free ends whose owner says where their cross-section is
 * (`SpineGeneration.endRung`).
 */
export function freeStructureEnds(graph: ConstructionGraphSnapshot, topologies: readonly ConstructionRegionTopology[]): readonly WeldRung[] {
  const regionEnds = topologies.flatMap((topology) => structureTypeFor(topology.surfaceType)?.ends?.ends(topology).map((end) => end.rung) ?? []);
  const degree = new Map<string, { count: number; owner?: string }>();
  for (const span of graph.edges.filter(isSpineEdge)) {
    const owner = spineOwnerOf(span);
    for (const id of [span.startNodeId, span.endNodeId]) {
      const entry = degree.get(id) ?? { count: 0, owner };
      entry.count += 1;
      degree.set(id, entry);
    }
  }
  const spineEnds = [...degree].flatMap(([id, { count, owner }]) => {
    const endRung = count === 1 && owner !== undefined ? structureTypeFor(owner)?.spine?.endRung : undefined;
    return endRung ? [endRung(id)] : [];
  });
  return [...regionEnds, ...spineEnds].filter((rung) => floorsWeldedBy(topologies, rung).length === 0);
}

/**
 * Welds every free structure end whose end edge lies along the outline of
 * one of the floors `floorKeys` names -- a floor drawn against a ramp's end
 * joins it without the corners having to be picked. `undefined` when none
 * does.
 */
export function weldFreeEndsOnto(
  graph: ConstructionGraphSnapshot,
  topologies: readonly ConstructionRegionTopology[],
  floorKeys: readonly ConstructionSurfaceKey[],
  operationId: string,
): ApplyPatchReplacementRequest | undefined {
  const rungs = freeStructureEnds(graph, topologies);
  if (rungs.length === 0 || floorKeys.length === 0) return undefined;
  const positions = new Map<string, ConstructionPosition>();
  for (const topology of topologies) for (const node of topology.nodes) positions.set(node.id, node.position);
  const welds = reweldFloors(topologies, {
    detach: [],
    attach: floorKeys.flatMap((floor) => rungs.filter((rung) => positions.has(rung.startNodeId) && positions.has(rung.endNodeId)).map((rung) => ({ rung, floor }))),
  }, positions, operationId);
  if (welds.attached.length === 0) return undefined;
  // The rung nodes already stand, as the structure's own: nothing to declare for them.
  return { operationId, sourceSurfaceKeys: welds.sourceSurfaceKeys, patch: { nodes: welds.nodes, edges: welds.edges, regions: welds.regions } };
}

/**
 * The free structure end nearest `point` in plan, within `reach` of its
 * middle, as something to run on from: the way on points away from the
 * face that owns the end's edge. Ends among `own` -- the structure asking --
 * are never offered.
 */
export function endJointNear(
  graph: ConstructionGraphSnapshot,
  topologies: readonly ConstructionRegionTopology[],
  /** Where the pointer is -- at a given height, when it can say, so a raised end is aimed at where it is drawn. */
  point: ConstructionPosition | ((height: number) => ConstructionPosition),
  options: { readonly reach?: number; readonly own?: ReadonlySet<string> } = {},
): EndJoint | undefined {
  const aim = typeof point === "function" ? point : () => point;
  const reach = options.reach ?? LANDING_REACH;
  const positions = new Map<string, ConstructionPosition>();
  for (const topology of topologies) for (const node of topology.nodes) positions.set(node.id, node.position);
  let best: { joint: EndJoint; distance: number } | undefined;
  for (const rung of freeStructureEnds(graph, topologies)) {
    if (options.own?.has(rung.startNodeId) || options.own?.has(rung.endNodeId)) continue;
    const a = positions.get(rung.startNodeId), b = positions.get(rung.endNodeId);
    if (!a || !b) continue;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    const aimed = aim(mid.y);
    const distance = Math.hypot(aimed.x - mid.x, aimed.z - mid.z);
    const width = Math.hypot(b.x - a.x, b.z - a.z);
    if (distance > reach || !(width > 1e-6) || (best && best.distance <= distance)) continue;
    const face = topologies.find((topology) => [...topology.outerLoops, ...topology.holes].flat().some((use) => use.edgeId === rung.edgeId));
    if (!face) continue;
    const centre = face.nodes.reduce((sum, node) => ({ x: sum.x + node.position.x / face.nodes.length, z: sum.z + node.position.z / face.nodes.length }), { x: 0, z: 0 });
    let out = { x: -(b.z - a.z) / width, z: (b.x - a.x) / width };
    if (out.x * (centre.x - mid.x) + out.z * (centre.z - mid.z) > 0) out = { x: -out.x, z: -out.z };
    best = { joint: { rung, a, b, mid, out, height: mid.y, width }, distance };
  }
  return best?.joint;
}
