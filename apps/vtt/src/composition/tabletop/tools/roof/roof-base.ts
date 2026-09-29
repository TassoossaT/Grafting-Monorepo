import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import { hasTrait, outlineOf, uprightPosts, type RoofBaseRef } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition, ConstructionRegionEdge, ConstructionRegionTopology } from "@/ports";
import type { RoofFootprint } from "../../../../ports/cap-port.ts";
import type { PointerSample } from "../core/tool-context.ts";

/** What a roof stands on: a footprint at one elevation, and how to find it again. */
export interface RoofBase {
  readonly footprint: RoofFootprint;
  readonly elevation: number;
  readonly ref: RoofBaseRef;
}

const LEVEL = 1e-3;

/**
 * The base under a click: a floor's outline and holes, or -- clicking a
 * wall -- the loop its tops close round the room it bounds. Curved sides are
 * followed by short straight ones. Throws a message for the user when what
 * was clicked cannot carry a roof.
 */
export function roofBaseAt(topologies: readonly ConstructionRegionTopology[], sample: PointerSample): RoofBase {
  const clicked = topologies.find((face) => (
    sample.surfaceRef ? surfaceRefFromNodeSet(face.surfaceKey) === sample.surfaceRef : sample.nodeId !== undefined && face.nodes.some((node) => node.id === sample.nodeId)));
  if (clicked && hasTrait(clicked.surfaceType, "floor")) return floorBase(clicked);
  if (clicked && hasTrait(clicked.surfaceType, "partition")) {
    try { return wallLoopBase(topologies, clicked); }
    catch (error) {
      const platform = floorAboveWall(topologies, clicked);
      if (platform) return platform;
      throw error;
    }
  }
  throw new Error("Clique numa plataforma ou numa parede que feche um cômodo.");
}

/**
 * The base `ref` names, as it stands now: its own face if that still
 * stands, else the face of its kind now holding its outline's nodes -- a
 * floor made again when it was widened, a wall split. `undefined` once
 * nothing of it is left to stand on.
 */
export function roofBaseOf(topologies: readonly ConstructionRegionTopology[], ref: RoofBaseRef): RoofBase | undefined {
  const key = ref.surfaceKey.join("\u0000");
  const trait = ref.kind === "floor" ? "floor" : "partition";
  const nodes = new Set(ref.nodeIds);
  const face = topologies.find((t) => t.surfaceKey.join("\u0000") === key && hasTrait(t.surfaceType, trait))
    ?? topologies.find((t) => hasTrait(t.surfaceType, trait) && t.nodes.some((node) => nodes.has(node.id)));
  if (!face) return undefined;
  try {
    if (ref.kind === "floor") {
      const floor = floorBase(face);
      return { ...floor, elevation: floor.elevation + (ref.offset ?? 0), ref };
    }
    return wallLoopBase(topologies, face, ref.nodeIds);
  } catch {
    return undefined;
  }
}

/** A loop of a face as plan corners, curved sides followed by short straight ones. */
function ringOf(loop: readonly ConstructionRegionEdge[], at: ReadonlyMap<string, ConstructionPosition>): (readonly [number, number])[] {
  return outlineOf(loop.map((use) => ({ start: at.get(use.startNodeId)!, end: at.get(use.endNodeId)!, geometry: use.geometry }))).map((p) => [p.x, p.z] as const);
}

function floorBase(source: ConstructionRegionTopology): RoofBase {
  if (source.outerLoops.length !== 1) throw new Error("Selecione uma plataforma de um só contorno.");
  const elevation = source.nodes[0]!.position.y;
  if (!source.nodes.every((node) => Math.abs(node.position.y - elevation) < LEVEL)) throw new Error("A base do telhado precisa estar no mesmo nível.");
  const at = new Map(source.nodes.map((node) => [node.id, node.position]));
  const ref: RoofBaseRef = { kind: "floor", surfaceKey: source.surfaceKey, nodeIds: source.outerLoops[0]!.map((use) => use.startNodeId) };
  return { footprint: { outer: ringOf(source.outerLoops[0]!, at), holes: source.holes.map((hole) => ringOf(hole, at)) }, elevation, ref };
}

/** A level wall top on a platform rim can cover that platform without a closed room. */
function floorAboveWall(topologies: readonly ConstructionRegionTopology[], wall: ConstructionRegionTopology): RoofBase | undefined {
  const posts = uprightPosts(wall);
  const tops = wall.nodes.filter((node) => posts.some((post) => post.top === node.id));
  if (tops.length < 2 || !tops.every((node) => Math.abs(node.position.y - tops[0]!.position.y) < LEVEL)) return undefined;
  const feet = new Set(posts.map((post) => post.foot));
  for (const face of topologies.filter((candidate) => hasTrait(candidate.surfaceType, "floor"))) {
    if (face.nodes.filter((node) => feet.has(node.id)).length < 2) continue;
    try {
      const floor = floorBase(face);
      const offset = tops[0]!.position.y - floor.elevation;
      if (offset <= LEVEL) continue;
      return { ...floor, elevation: tops[0]!.position.y, ref: { ...floor.ref, offset } };
    } catch { /* A different floor may share the wall's vertices. */ }
  }
  return undefined;
}

/**
 * The room a wall bounds: the tops of every wall form a plan graph, and the
 * room is the smallest face of it along the clicked wall's top -- traced by
 * always taking the next top clockwise, which keeps the face on the left.
 * Found again, the room is the one along two of the tops it had.
 */
function wallLoopBase(topologies: readonly ConstructionRegionTopology[], clicked: ConstructionRegionTopology, known?: readonly string[]): RoofBase {
  const at = new Map<string, ConstructionPosition>();
  const next = new Map<string, Set<string>>();
  const tops = new Map<string, ConstructionRegionEdge>();
  const pair = (a: string, b: string) => `${a}\u0000${b}`;
  let seed: readonly [string, string] | undefined;
  for (const wall of topologies.filter((face) => hasTrait(face.surfaceType, "partition"))) {
    const posts = new Set(uprightPosts(wall).map((post) => post.top));
    for (const node of wall.nodes) at.set(node.id, node.position);
    for (const use of wall.outerLoops.flat()) {
      if (!posts.has(use.startNodeId) || !posts.has(use.endNodeId)) continue;
      for (const [a, b] of [[use.startNodeId, use.endNodeId], [use.endNodeId, use.startNodeId]] as const) {
        if (!next.has(a)) next.set(a, new Set());
        next.get(a)!.add(b);
      }
      tops.set(pair(use.startNodeId, use.endNodeId), use);
      if (wall === clicked) seed ??= [use.startNodeId, use.endNodeId];
    }
  }
  const along = known?.findIndex((id, i) => next.get(id)?.has(known[(i + 1) % known.length]!));
  if (known && along !== undefined && along >= 0) seed = [known[along]!, known[(along + 1) % known.length]!];
  if (!seed) throw new Error("Esta parede não tem topo para apoiar o telhado.");
  const angle = (from: string, to: string) => Math.atan2(at.get(to)!.z - at.get(from)!.z, at.get(to)!.x - at.get(from)!.x);
  const trace = (start: string, second: string): string[] | undefined => {
    const loop = [start];
    let [previous, current] = [start, second];
    while (current !== start) {
      if (loop.length > next.size) return undefined;
      loop.push(current);
      const back = angle(current, previous);
      const clockwise = (to: string) => {
        const turn = (back - angle(current, to) + 4 * Math.PI) % (2 * Math.PI);
        return turn < 1e-12 ? 2 * Math.PI : turn;
      };
      const following = [...next.get(current)!].reduce((best, to) => (clockwise(to) < clockwise(best) ? to : best));
      [previous, current] = [current, following];
    }
    return loop;
  };
  const signedArea = (loop: readonly string[]) => loop.reduce((sum, id, i) => {
    const a = at.get(id)!, b = at.get(loop[(i + 1) % loop.length]!)!;
    return sum + a.x * b.z - b.x * a.z;
  }, 0) / 2;
  const rooms = [trace(seed[0], seed[1]), trace(seed[1], seed[0])]
    .filter((loop): loop is string[] => loop !== undefined && signedArea(loop) > 1e-9)
    .sort((a, b) => signedArea(a) - signedArea(b));
  const room = rooms[0];
  if (!room) throw new Error("As paredes precisam fechar um cômodo para receber o telhado.");
  const elevation = at.get(room[0]!)!.y;
  if (!room.every((id) => Math.abs(at.get(id)!.y - elevation) < LEVEL)) throw new Error("O topo das paredes precisa estar nivelado para receber o telhado.");
  // Each top as its wall runs it, curved or straight, walked the way the room goes.
  const edges = room.map((a, i) => {
    const b = room[(i + 1) % room.length]!;
    const forward = tops.get(pair(a, b));
    const geometry = forward?.geometry ?? tops.get(pair(b, a))!.geometry;
    return { start: at.get(a)!, end: at.get(b)!, geometry: !forward && geometry.kind === "arc" ? { ...geometry, clockwise: !geometry.clockwise } : geometry };
  });
  return { footprint: { outer: outlineOf(edges).map((p) => [p.x, p.z] as const), holes: [] }, elevation, ref: { kind: "walls", surfaceKey: clicked.surfaceKey, nodeIds: room } };
}
