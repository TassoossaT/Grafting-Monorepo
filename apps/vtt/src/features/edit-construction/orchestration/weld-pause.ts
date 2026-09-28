import type { ApplyPatchReplacementRequest, ConstructionGraphSnapshot, ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import { hasTrait } from "../structure-types/index.ts";
import { floorsWeldedBy, reweldFloors, type WeldRung } from "../topology/floor-weld.ts";
import { releasableFace, structureEndRungs } from "./free-end-welds.ts";
import { surfaceKeyText } from "../topology/plan-geometry.ts";
import { renamedPiece, rewriteFaces } from "../topology/face-rewrite.ts";

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


/** How near a node must stand to another, or to a side, to be joined there -- positions are held in single precision. */
const JOIN = 1e-4;

/** Every structure end -- a ramp's, a spine's -- joined to a floor that `face` takes part in: an end of its own, or another structure's end joined to it. Joins of any other kind, a wall's feet on a floor, are not ends and are not among them. */
export function endJoinsOf(graph: ConstructionGraphSnapshot, topologies: readonly ConstructionRegionTopology[], face: ConstructionRegionTopology): readonly WeldLink[] {
  // Only floors are what an end is joined to; the ground laid against them follows them.
  const floors = topologies.filter((topology) => hasTrait(topology.surfaceType, "floor"));
  const own = new Set([...face.outerLoops, ...face.holes].flat().map((use) => use.edgeId));
  return structureEndRungs(graph, topologies).flatMap((rung): WeldLink[] => {
    // Holding the end's nodes -- both, welded, or one -- or walking the end's very edge: a floor drawn along it.
    const holding = floors.filter((floor) => floor.nodes.some((node) => node.id === rung.startNodeId || node.id === rung.endNodeId));
    if (holding.length === 0) return [];
    const mine = own.has(rung.edgeId);
    const intoMe = holding.some((floor) => surfaceKeyText(floor.surfaceKey) === surfaceKeyText(face.surfaceKey));
    const whole = (floor: ConstructionRegionTopology) => [rung.startNodeId, rung.endNodeId].every((id) => floor.nodes.some((node) => node.id === id));
    return mine || intoMe ? [{ rung, floors: holding.map((floor) => floor.surfaceKey), welded: holding.some(whole) }] : [];
  });
}

/**
 * The joins among `links` an edit placing nodes at `moves` would reshape:
 * its two nodes moved unlike each other -- or, when `anyMove`, moved at all.
 */
export function reshapedWelds(links: readonly WeldLink[], positions: ReadonlyMap<string, ConstructionPosition>, moves: ReadonlyMap<string, ConstructionPosition>, anyMove = false): readonly WeldLink[] {
  return links.filter(({ rung }) => {
    const a0 = positions.get(rung.startNodeId), b0 = positions.get(rung.endNodeId);
    if (!a0 || !b0) return false;
    const a1 = moves.get(rung.startNodeId) ?? a0, b1 = moves.get(rung.endNodeId) ?? b0;
    const da = { x: a1.x - a0.x, y: a1.y - a0.y, z: a1.z - a0.z }, db = { x: b1.x - b0.x, y: b1.y - b0.y, z: b1.z - b0.z };
    if (anyMove && (Math.hypot(da.x, da.y, da.z) > 1e-6 || Math.hypot(db.x, db.y, db.z) > 1e-6)) return true;
    return Math.hypot(da.x - db.x, da.y - db.y, da.z - db.z) > 1e-6;
  });
}

const replacement = (operationId: string, welds: ReturnType<typeof reweldFloors>): ApplyPatchReplacementRequest | undefined =>
  welds.sourceSurfaceKeys.length === 0 ? undefined : { operationId, sourceSurfaceKeys: welds.sourceSurfaceKeys, patch: { nodes: welds.nodes, edges: welds.edges, regions: welds.regions } };

/**
 * Every end among `links` taken off its floors -- and the ground against
 * them -- as one replacement; `undefined` when none holds it. A floor drawn
 * along the end walks the end's very edge: it is given an edge of its own
 * there first, so the end keeps its edge and the floor lets go of it.
 */
export function unweld(topologies: readonly ConstructionRegionTopology[], links: readonly WeldLink[], operationId: string): ApplyPatchReplacementRequest | undefined {
  const positions = new Map(topologies.flatMap((topology) => topology.nodes.map((node) => [node.id, node.position] as const)));
  const ends = new Set(links.map((link) => link.rung.edgeId));
  const own = (edgeId: string) => (ends.has(edgeId) ? `${operationId}:own:${edgeId}` : edgeId);
  const separated = topologies.map((topology) => {
    if (!hasTrait(topology.surfaceType, "floor") || ![...topology.outerLoops, ...topology.holes].flat().some((use) => ends.has(use.edgeId))) return topology;
    const loops = (list: ConstructionRegionTopology["outerLoops"]) => list.map((loop) => loop.map((use) => ({ ...use, edgeId: own(use.edgeId) })));
    return { ...topology, outerLoops: loops(topology.outerLoops), holes: loops(topology.holes) };
  });
  return replacement(operationId, reweldFloors(separated, { detach: links.map((link) => link.rung), attach: [] }, positions, operationId, releasableFace));
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
  const floorKeys = new Set(links.flatMap((link) => link.floors.map(surfaceKeyText)));
  const positions = new Map(topologies.flatMap((topology) => topology.nodes.map((node) => [node.id, node.position] as const)));
  // Which node each copy standing on an end node becomes.
  const renamed = new Map<string, string>();
  for (const id of new Set(links.flatMap(({ rung }) => [rung.startNodeId, rung.endNodeId]))) {
    const p = positions.get(id);
    if (!p) continue;
    for (const floor of topologies.filter((topology) => floorKeys.has(surfaceKeyText(topology.surfaceKey)))) {
      if (floor.nodes.some((node) => node.id === id)) continue;
      const copy = floor.nodes.find((node) => Math.hypot(node.position.x - p.x, node.position.y - p.y, node.position.z - p.z) < JOIN);
      if (copy) renamed.set(copy.id, id);
    }
  }
  // A floor's straight side an end node stands partway along, by the side's two nodes: it is cut there.
  // Every node cutting one side, with how far along the side -- from the side's lower node id -- it stands.
  const cuts = new Map<string, { readonly id: string; readonly t: number }[]>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const id of new Set(links.flatMap(({ rung }) => [rung.startNodeId, rung.endNodeId]))) {
    const p = positions.get(id);
    if (!p || [...renamed.values()].includes(id)) continue;
    for (const floor of topologies.filter((topology) => floorKeys.has(surfaceKeyText(topology.surfaceKey)))) {
      if (floor.nodes.some((node) => node.id === id)) continue;
      const at = new Map(floor.nodes.map((node) => [node.id, node.position]));
      const side = [...floor.outerLoops, ...floor.holes].flat().find((use) => {
        if (use.geometry.kind !== "line") return false;
        const a = at.get(use.startNodeId)!, b = at.get(use.endNodeId)!;
        const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz;
        if (lengthSq < 1e-12 || Math.abs(p.y - a.y) > JOIN) return false;
        const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq;
        const length = Math.sqrt(lengthSq);
        return t * length > JOIN && (1 - t) * length > JOIN && Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)) < JOIN;
      });
      if (side) {
        const [low, high] = side.startNodeId < side.endNodeId ? [side.startNodeId, side.endNodeId] : [side.endNodeId, side.startNodeId];
        const a = at.get(low)!, b = at.get(high)!;
        const t = ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / ((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
        const key = pairKey(low, high);
        cuts.set(key, [...(cuts.get(key) ?? []), { id, t }].sort((m, n) => m.t - n.t));
      }
    }
  }
  if (renamed.size === 0 && cuts.size === 0) return { request: undefined, joined: 0 };
  const reaches = (topology: ConstructionRegionTopology) => topology.nodes.some((node) => renamed.has(node.id))
    || [...topology.outerLoops, ...topology.holes].flat().some((use) => cuts.has(pairKey(use.startNodeId, use.endNodeId)));
  const faces = topologies.filter(reaches);
  const rename = (id: string) => renamed.get(id) ?? id;
  const { edges, regions } = rewriteFaces(faces, (use) => {
    const cut = cuts.get(pairKey(use.startNodeId, use.endNodeId));
    // An edge through a renamed node is a new edge; the face's other edges stay as they are.
    if (!cut) return [renamedPiece(use, rename, operationId)];
    // Cut at every end node on it, in order along the walk: a piece between each, named after the edge it came from.
    const forward = use.startNodeId < use.endNodeId ? cut : [...cut].reverse();
    const stops = [rename(use.startNodeId), ...forward.map((c) => c.id), rename(use.endNodeId)];
    return stops.slice(1).map((stop, i) => ({ edgeId: `${operationId}:${use.edgeId}:${i}`, from: stops[i]!, to: stop }));
  }, operationId);
  return { request: { operationId, sourceSurfaceKeys: faces.map((face) => face.surfaceKey), patch: { nodes: [], edges, regions } }, joined: renamed.size + [...cuts.values()].reduce((sum, list) => sum + list.length, 0) };
}
