import type { ApplyPatchReplacementRequest, ConstructionGraphSnapshot, ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import { hasTrait } from "../structure-types/index.ts";
import { floorsWeldedBy, reweldFloors, type WeldRung } from "../topology/floor-weld.ts";
import { releasableFace, structureEndRungs } from "./free-end-welds.ts";

/**
 * A weld paused for one edit: a structure's end comes off the floor it is
 * welded into, the edit reshapes one of the two alone, and the end is welded
 * back into that floor wherever it then lies. An edit that would otherwise
 * reshape both -- a floor widened along a ramp's end, a ramp's end widened
 * inside a floor's edge -- leaves the other as it was, and the two joined.
 */

/** One structure end welded into floors. */
export interface WeldLink {
  readonly rung: WeldRung;
  readonly floors: readonly ConstructionSurfaceKey[];
}

const keyOf = (surfaceKey: ConstructionSurfaceKey) => surfaceKey.join("\u0000");

/** Every weld `face` takes part in: an end of its own welded into a floor, or another structure's end welded into it. */
export function weldsOf(graph: ConstructionGraphSnapshot, topologies: readonly ConstructionRegionTopology[], face: ConstructionRegionTopology): readonly WeldLink[] {
  // Only floors are what an end is welded into; the ground laid against them follows them.
  const floors = topologies.filter((topology) => hasTrait(topology.surfaceType, "floor"));
  const own = new Set([...face.outerLoops, ...face.holes].flat().map((use) => use.edgeId));
  return structureEndRungs(graph, topologies).flatMap((rung): WeldLink[] => {
    const holding = floorsWeldedBy(floors, rung);
    if (holding.length === 0) return [];
    const mine = own.has(rung.edgeId);
    const intoMe = holding.some((floor) => keyOf(floor.surfaceKey) === keyOf(face.surfaceKey));
    return mine || intoMe ? [{ rung, floors: holding.map((floor) => floor.surfaceKey) }] : [];
  });
}

/** The welds among `links` an edit placing nodes at `moves` would reshape: its two nodes moved unlike each other. */
export function reshapedWelds(links: readonly WeldLink[], positions: ReadonlyMap<string, ConstructionPosition>, moves: ReadonlyMap<string, ConstructionPosition>): readonly WeldLink[] {
  return links.filter(({ rung }) => {
    const a0 = positions.get(rung.startNodeId), b0 = positions.get(rung.endNodeId);
    if (!a0 || !b0) return false;
    const a1 = moves.get(rung.startNodeId) ?? a0, b1 = moves.get(rung.endNodeId) ?? b0;
    const da = { x: a1.x - a0.x, y: a1.y - a0.y, z: a1.z - a0.z }, db = { x: b1.x - b0.x, y: b1.y - b0.y, z: b1.z - b0.z };
    return Math.hypot(da.x - db.x, da.y - db.y, da.z - db.z) > 1e-6;
  });
}

const replacement = (operationId: string, welds: ReturnType<typeof reweldFloors>): ApplyPatchReplacementRequest | undefined =>
  welds.sourceSurfaceKeys.length === 0 ? undefined : { operationId, sourceSurfaceKeys: welds.sourceSurfaceKeys, patch: { nodes: welds.nodes, edges: welds.edges, regions: welds.regions } };

/** Every end among `links` taken off its floors -- and the ground against them -- as one replacement; `undefined` when none holds it. */
export function unweld(topologies: readonly ConstructionRegionTopology[], links: readonly WeldLink[], operationId: string): ApplyPatchReplacementRequest | undefined {
  const positions = new Map(topologies.flatMap((topology) => topology.nodes.map((node) => [node.id, node.position] as const)));
  return replacement(operationId, reweldFloors(topologies, { detach: links.map((link) => link.rung), attach: [] }, positions, operationId, releasableFace));
}

/**
 * Every end among `links` welded back into the floor it was welded into,
 * where it now lies -- one replacement, and how many of them went back.
 * An end the edit left off its floor's edge stays off it.
 */
export function reweld(topologies: readonly ConstructionRegionTopology[], links: readonly WeldLink[], operationId: string): { readonly request: ApplyPatchReplacementRequest | undefined; readonly welded: number } {
  const positions = new Map(topologies.flatMap((topology) => topology.nodes.map((node) => [node.id, node.position] as const)));
  const welds = reweldFloors(topologies, {
    detach: [],
    attach: links.flatMap((link) => link.floors.map((floor) => ({ rung: link.rung, floor }))),
  }, positions, operationId);
  return { request: replacement(operationId, welds), welded: welds.attached.length };
}
