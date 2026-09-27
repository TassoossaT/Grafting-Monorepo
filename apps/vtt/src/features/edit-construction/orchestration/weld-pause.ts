import type { ApplyPatchReplacementRequest, ConstructionGraphSnapshot, ConstructionPatchEdge, ConstructionPatchRegion, ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import { hasTrait } from "../structure-types/index.ts";
import { reverseGeometry } from "../topology/boundary-edges.ts";
import { floorsWeldedBy, reweldFloors, type WeldRung } from "../topology/floor-weld.ts";
import { releasableFace, structureEndRungs } from "./free-end-welds.ts";

/**
 * A weld paused for one edit: a structure's end comes off the floor it is
 * welded into, the edit reshapes one of the two alone, and the end is welded
 * back into that floor wherever it then lies. An edit that would otherwise
 * reshape both -- a floor widened along a ramp's end, a ramp's end widened
 * inside a floor's edge -- leaves the other as it was, and the two joined.
 */

/**
 * One structure end joined to floors: welded into them -- both of its nodes
 * on their outline -- or holding just one node with them, a floor drawn from
 * one of its corners.
 */
export interface WeldLink {
  readonly rung: WeldRung;
  readonly floors: readonly ConstructionSurfaceKey[];
  /** Whether it was welded whole -- both nodes on the floors' outline -- rather than sharing one corner. */
  readonly welded: boolean;
}

const keyOf = (surfaceKey: ConstructionSurfaceKey) => surfaceKey.join("\u0000");

/** Every join `face` takes part in: an end of its own joined to a floor, or another structure's end joined to it. */
export function weldsOf(graph: ConstructionGraphSnapshot, topologies: readonly ConstructionRegionTopology[], face: ConstructionRegionTopology): readonly WeldLink[] {
  // Only floors are what an end is joined to; the ground laid against them follows them.
  const floors = topologies.filter((topology) => hasTrait(topology.surfaceType, "floor"));
  const own = new Set([...face.outerLoops, ...face.holes].flat().map((use) => use.edgeId));
  return structureEndRungs(graph, topologies).flatMap((rung): WeldLink[] => {
    // Welded, or holding one of the end's nodes -- not the structure itself, whose face walks the end's own edge.
    const holding = floors.filter((floor) => floorsWeldedBy([floor], rung).length > 0
      || (!floor.outerLoops.flat().some((use) => use.edgeId === rung.edgeId) && floor.nodes.some((node) => node.id === rung.startNodeId || node.id === rung.endNodeId)));
    if (holding.length === 0) return [];
    const mine = own.has(rung.edgeId);
    const intoMe = holding.some((floor) => keyOf(floor.surfaceKey) === keyOf(face.surfaceKey));
    return mine || intoMe ? [{ rung, floors: holding.map((floor) => floor.surfaceKey), welded: floorsWeldedBy(holding, rung).length > 0 }] : [];
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
 * Every end among `links` welded back into the floor it was joined to, where
 * it now lies -- one replacement, and how many of them went back. An end the
 * edit left off its floor's edge stays off it.
 */
export function reweld(topologies: readonly ConstructionRegionTopology[], links: readonly WeldLink[], operationId: string): { readonly request: ApplyPatchReplacementRequest | undefined; readonly welded: number } {
  const positions = new Map(topologies.flatMap((topology) => topology.nodes.map((node) => [node.id, node.position] as const)));
  const welds = reweldFloors(topologies, {
    detach: [],
    attach: links.flatMap((link) => link.floors.map((floor) => ({ rung: link.rung, floor }))),
  }, positions, operationId);
  return { request: replacement(operationId, welds), welded: welds.attached.length };
}

/**
 * Every end node among `links` shared again with the floors it was joined
 * to: a floor with a node of its own standing exactly there -- the copy a
 * pause gave it, where the edit left it -- passes through the end's node
 * instead; one with a side running through it is split there. Either way the
 * ground against it follows. One replacement, and how many nodes were shared
 * again; `undefined` when none could be.
 */
export function rejoinNodes(topologies: readonly ConstructionRegionTopology[], links: readonly WeldLink[], operationId: string): { readonly request: ApplyPatchReplacementRequest | undefined; readonly joined: number } {
  const floorKeys = new Set(links.flatMap((link) => link.floors.map(keyOf)));
  const positions = new Map(topologies.flatMap((topology) => topology.nodes.map((node) => [node.id, node.position] as const)));
  // Which node each copy standing on an end node becomes.
  const renamed = new Map<string, string>();
  for (const id of new Set(links.flatMap(({ rung }) => [rung.startNodeId, rung.endNodeId]))) {
    const p = positions.get(id);
    if (!p) continue;
    for (const floor of topologies.filter((topology) => floorKeys.has(keyOf(topology.surfaceKey)))) {
      if (floor.nodes.some((node) => node.id === id)) continue;
      const copy = floor.nodes.find((node) => Math.hypot(node.position.x - p.x, node.position.y - p.y, node.position.z - p.z) < 1e-6);
      if (copy) renamed.set(copy.id, id);
    }
  }
  // A floor's straight side an end node stands partway along, by the side's two nodes: it is cut there.
  const cuts = new Map<string, string>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const id of new Set(links.flatMap(({ rung }) => [rung.startNodeId, rung.endNodeId]))) {
    const p = positions.get(id);
    if (!p || [...renamed.values()].includes(id)) continue;
    for (const floor of topologies.filter((topology) => floorKeys.has(keyOf(topology.surfaceKey)))) {
      if (floor.nodes.some((node) => node.id === id)) continue;
      const at = new Map(floor.nodes.map((node) => [node.id, node.position]));
      const side = [...floor.outerLoops, ...floor.holes].flat().find((use) => {
        if (use.geometry.kind !== "line") return false;
        const a = at.get(use.startNodeId)!, b = at.get(use.endNodeId)!;
        const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz;
        if (lengthSq < 1e-12 || Math.abs(p.y - a.y) > 1e-6) return false;
        const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq;
        const length = Math.sqrt(lengthSq);
        return t * length > 1e-4 && (1 - t) * length > 1e-4 && Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)) < 1e-6;
      });
      if (side) cuts.set(pairKey(side.startNodeId, side.endNodeId), id);
    }
  }
  if (renamed.size === 0 && cuts.size === 0) return { request: undefined, joined: 0 };
  const edges = new Map<string, ConstructionPatchEdge>();
  const regions: ConstructionPatchRegion[] = [];
  const sources: ConstructionSurfaceKey[] = [];
  const reaches = (topology: ConstructionRegionTopology) => topology.nodes.some((node) => renamed.has(node.id))
    || [...topology.outerLoops, ...topology.holes].flat().some((use) => cuts.has(pairKey(use.startNodeId, use.endNodeId)));
  for (const face of topologies.filter(reaches)) {
    const put = (edgeId: string, from: string, to: string, use: ConstructionRegionTopology["outerLoops"][number][number]) => {
      edges.set(edgeId, use.reversed
        ? { edgeId, startNodeId: to, endNodeId: from, geometry: reverseGeometry(use.geometry) }
        : { edgeId, startNodeId: from, endNodeId: to, geometry: use.geometry });
      return { edgeId, reversed: use.reversed };
    };
    const walk = (loop: ConstructionRegionTopology["outerLoops"][number]) => loop.flatMap((use) => {
      const from = renamed.get(use.startNodeId) ?? use.startNodeId, to = renamed.get(use.endNodeId) ?? use.endNodeId;
      const cut = cuts.get(pairKey(use.startNodeId, use.endNodeId));
      // Cut at the end node: two edges, each named after the edge it came from.
      if (cut) return [put(`${operationId}:${use.edgeId}:a`, from, cut, use), put(`${operationId}:${use.edgeId}:b`, cut, to, use)];
      const touched = from !== use.startNodeId || to !== use.endNodeId;
      // An edge through a renamed node is a new edge; the face's other edges stay as they are.
      return [put(touched ? `${operationId}:${use.edgeId}` : use.edgeId, from, to, use)];
    });
    sources.push(face.surfaceKey);
    regions.push({
      regionId: face.surfaceKey[0] === "@region" && face.surfaceKey[1] ? face.surfaceKey[1] : `${operationId}:face:${regions.length}`,
      boundary: walk(face.outerLoops[0] ?? []),
      holes: [...face.outerLoops.slice(1), ...face.holes].map(walk),
      surfaceType: face.surfaceType,
      physical: face.physical,
      ...(face.profile ? { profile: face.profile } : {}),
    });
  }
  return { request: { operationId, sourceSurfaceKeys: sources, patch: { nodes: [], edges: [...edges.values()], regions } }, joined: renamed.size + cuts.size };
}
