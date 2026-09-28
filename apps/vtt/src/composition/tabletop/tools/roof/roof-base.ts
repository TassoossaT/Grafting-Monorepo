import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import { hasTrait } from "../../../../features/edit-construction/index.ts";
import { uprightPosts } from "../../../../features/edit-construction/orchestration/global-handles/upright-handle-provider.ts";
import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";
import type { PointerSample } from "../core/tool-context.ts";

type Point = readonly [number, number];

/** What a roof stands on: a closed footprint at one elevation, or the circle of a round floor. */
export type RoofBase =
  | { readonly kind: "contour"; readonly contour: readonly Point[]; readonly elevation: number }
  | { readonly kind: "circle"; readonly center: Point; readonly radius: number; readonly elevation: number };

const LEVEL = 1e-3;

/**
 * The base under a click: a floor's contour, or -- clicking a wall -- the
 * loop its tops close round the room it bounds. Throws a message for the
 * user when what was clicked cannot carry a roof.
 */
export function roofBaseAt(topologies: readonly ConstructionRegionTopology[], sample: PointerSample): RoofBase {
  const clicked = topologies.find((face) => (
    sample.surfaceRef ? surfaceRefFromNodeSet(face.surfaceKey) === sample.surfaceRef : sample.nodeId !== undefined && face.nodes.some((node) => node.id === sample.nodeId)));
  if (clicked && hasTrait(clicked.surfaceType, "floor")) return floorBase(clicked);
  if (clicked && hasTrait(clicked.surfaceType, "partition")) return wallLoopBase(topologies, clicked);
  throw new Error("Clique numa plataforma ou numa parede que feche um cômodo.");
}

function floorBase(source: ConstructionRegionTopology): RoofBase {
  if (source.outerLoops.length !== 1 || source.holes.length) throw new Error("Selecione uma plataforma sem aberturas.");
  const boundary = source.outerLoops[0]!;
  const elevation = source.nodes[0]!.position.y;
  if (!source.nodes.every((node) => Math.abs(node.position.y - elevation) < LEVEL)) throw new Error("A base do telhado precisa estar no mesmo nível.");
  const at = new Map(source.nodes.map((node) => [node.id, node.position]));
  const point = (nodeId: string): Point => {
    const position = at.get(nodeId);
    if (!position) throw new Error("A plataforma contém um contorno incompleto.");
    return [position.x, position.z];
  };
  const centers = boundary.flatMap((use) => (use.geometry.kind === "arc" ? [use.geometry.center] : []));
  const center = centers[0];
  if (center === undefined) return { kind: "contour", contour: boundary.map((use) => point(use.startNodeId)), elevation };
  if (centers.length === boundary.length && centers.every((other) => other[0] === center[0] && other[1] === center[1])) {
    const rim = point(boundary[0]!.startNodeId);
    return { kind: "circle", center, radius: Math.hypot(rim[0] - center[0], rim[1] - center[1]), elevation };
  }
  throw new Error("O telhado cobre plataformas de lados retos ou circulares.");
}

/**
 * The room a wall bounds: the tops of every wall form a plan graph, and the
 * room is the smallest face of it along the clicked wall's top -- traced by
 * always taking the next top clockwise, which keeps the face on the left.
 */
function wallLoopBase(topologies: readonly ConstructionRegionTopology[], clicked: ConstructionRegionTopology): RoofBase {
  const at = new Map<string, ConstructionPosition>();
  const next = new Map<string, Set<string>>();
  const curved = new Set<string>();
  const pair = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  let seed: readonly [string, string] | undefined;
  for (const wall of topologies.filter((face) => hasTrait(face.surfaceType, "partition"))) {
    const tops = new Set(uprightPosts(wall).map((post) => post.top));
    for (const node of wall.nodes) at.set(node.id, node.position);
    for (const use of wall.outerLoops.flat()) {
      if (!tops.has(use.startNodeId) || !tops.has(use.endNodeId)) continue;
      for (const [a, b] of [[use.startNodeId, use.endNodeId], [use.endNodeId, use.startNodeId]] as const) {
        if (!next.has(a)) next.set(a, new Set());
        next.get(a)!.add(b);
      }
      if (use.geometry.kind !== "line") curved.add(pair(use.startNodeId, use.endNodeId));
      if (wall === clicked) seed ??= [use.startNodeId, use.endNodeId];
    }
  }
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
  if (room.some((id, i) => curved.has(pair(id, room[(i + 1) % room.length]!)))) throw new Error("Paredes curvas ainda não recebem telhado.");
  const elevation = at.get(room[0]!)!.y;
  if (!room.every((id) => Math.abs(at.get(id)!.y - elevation) < LEVEL)) throw new Error("O topo das paredes precisa estar nivelado para receber o telhado.");
  return { kind: "contour", contour: room.map((id) => [at.get(id)!.x, at.get(id)!.z] as const), elevation };
}
