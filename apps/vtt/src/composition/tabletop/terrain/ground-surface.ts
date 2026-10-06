import type { ConstructionRegionTopology } from "@/ports";

import { DEFAULT_FACE_SIDE } from "./terrain-fill.ts";

/**
 * The ground as a surface: which faces are reached from which, over the edges
 * they share -- never by lying over the same point of the plane. A cave's
 * ceiling stands right over its floor and is no neighbour of it; the wall
 * between them is, and a walk that only takes faces within a structure's
 * height band never climbs it.
 */

const keyOf = (face: ConstructionRegionTopology) => face.surfaceKey.join("\u0000");

/** A face's extent in height. */
export function heightRangeOf(face: ConstructionRegionTopology): { readonly low: number; readonly high: number } {
  let low = Infinity, high = -Infinity;
  for (const node of face.nodes) {
    low = Math.min(low, node.position.y);
    high = Math.max(high, node.position.y);
  }
  return { low, high };
}

/**
 * Every face of `faces` reached from `seeds` over shared edges, taking only
 * faces `accept` admits -- the seeds included. In the order reached, from the
 * seeds in the order given, so the same input walks the same way.
 */
export function walkSurface(
  faces: readonly ConstructionRegionTopology[],
  seeds: readonly ConstructionRegionTopology[],
  accept: (face: ConstructionRegionTopology) => boolean,
): ConstructionRegionTopology[] {
  const byEdge = new Map<string, ConstructionRegionTopology[]>();
  for (const face of faces) {
    for (const use of [...face.outerLoops, ...face.holes].flat()) {
      const list = byEdge.get(use.edgeId);
      if (list) list.push(face);
      else byEdge.set(use.edgeId, [face]);
    }
  }
  const reached = new Set<string>();
  const order: ConstructionRegionTopology[] = [];
  const queue: ConstructionRegionTopology[] = [];
  for (const seed of seeds) {
    if (reached.has(keyOf(seed)) || !accept(seed)) continue;
    reached.add(keyOf(seed));
    order.push(seed);
    queue.push(seed);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const face = queue[head]!;
    for (const use of [...face.outerLoops, ...face.holes].flat()) {
      for (const next of byEdge.get(use.edgeId) ?? []) {
        if (reached.has(keyOf(next)) || !accept(next)) continue;
        reached.add(keyOf(next));
        order.push(next);
        queue.push(next);
      }
    }
  }
  return order;
}

/** `faces` split into pieces joined by shared edges, each in walk order. */
export function surfaceComponents(faces: readonly ConstructionRegionTopology[]): ConstructionRegionTopology[][] {
  const left = new Set(faces.map(keyOf));
  const pieces: ConstructionRegionTopology[][] = [];
  for (const face of faces) {
    if (!left.has(keyOf(face))) continue;
    const piece = walkSurface(faces, [face], (candidate) => left.has(keyOf(candidate)));
    for (const member of piece) left.delete(keyOf(member));
    pieces.push(piece);
  }
  return pieces;
}

/** The coarsest face a repair lays, whatever it replaces. */
const COARSEST_REGROWN_FACE = 6;

/**
 * The size of face ground is laid again at: the median, over `faces`, of the
 * side of a square with each face's area -- measured on the surface, so a
 * hillside reads as the faces it holds. Never finer than the default: faces
 * round a contour are smaller, and read back as the size to lay they shrank
 * the ground with every repair of the same structure.
 */
export function regrowFaceSide(faces: readonly ConstructionRegionTopology[]): number {
  const sides = faces.flatMap((face) => {
    const at = new Map(face.nodes.map((node) => [node.id, node.position]));
    const ring = (face.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId)).filter((p): p is NonNullable<typeof p> => p !== undefined);
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    const area = Math.hypot(nx, ny, nz) / 2;
    return area > 0 ? [Math.sqrt(area)] : [];
  }).sort((a, b) => a - b);
  const size = sides[sides.length >> 1] ?? DEFAULT_FACE_SIDE;
  return Math.min(COARSEST_REGROWN_FACE, Math.max(DEFAULT_FACE_SIDE, size));
}

/** How many faces an enclosed island may hold and still be taken into a patch. */
const MOST_ISLAND_FACES = 600;

/**
 * `patch` closed into ground an engine can lay as one piece: a disk.
 *
 * - **Pinched corners.** Where the patch's faces meet at a corner without
 *   sharing a side there, its border touches itself; every face of `ground`
 *   at that corner is taken in.
 * - **Islands.** Ground the patch rings round without holding -- a border
 *   loop other than the outermost, with ground on its far side -- is taken in
 *   whole, so the engine never caps over standing ground.
 *
 * A hole with no ground on its far side -- where a structure stood or rests --
 * stays a hole.
 */
export function closedPatch(
  patch: readonly ConstructionRegionTopology[],
  ground: readonly ConstructionRegionTopology[],
): ConstructionRegionTopology[] {
  const members = new Map(patch.map((face) => [keyOf(face), face] as const));
  const facesAtNode = new Map<string, ConstructionRegionTopology[]>();
  const facesAtEdge = new Map<string, ConstructionRegionTopology[]>();
  for (const face of ground) {
    for (const node of face.nodes) facesAtNode.set(node.id, [...(facesAtNode.get(node.id) ?? []), face]);
    for (const use of [...face.outerLoops, ...face.holes].flat()) facesAtEdge.set(use.edgeId, [...(facesAtEdge.get(use.edgeId) ?? []), face]);
  }
  for (let round = 0; round < 8; round += 1) {
    const before = members.size;
    const faces = [...members.values()];

    // Pinched corners: the patch's faces at a corner fall into more than one fan.
    const atNode = new Map<string, ConstructionRegionTopology[]>();
    for (const face of faces) for (const node of face.nodes) atNode.set(node.id, [...(atNode.get(node.id) ?? []), face]);
    for (const [node, around] of atNode) {
      if (around.length < 2) continue;
      const sidesAt = (face: ConstructionRegionTopology) => new Set(face.outerLoops.flat().filter((use) => use.startNodeId === node || use.endNodeId === node).map((use) => use.edgeId));
      const joined = new Set<string>();
      // Faces at the corner joined through a side that runs through the corner.
      const queue = [around[0]!];
      joined.add(keyOf(around[0]!));
      for (let head = 0; head < queue.length; head += 1) {
        const sides = sidesAt(queue[head]!);
        for (const other of around) {
          if (joined.has(keyOf(other))) continue;
          if ([...sidesAt(other)].some((edge) => sides.has(edge))) {
            joined.add(keyOf(other));
            queue.push(other);
          }
        }
      }
      if (joined.size < around.length) {
        const atCorner = facesAtNode.get(node) ?? [];
        if (atCorner.some((face) => !members.has(keyOf(face)))) {
          for (const face of atCorner) members.set(keyOf(face), face);
        } else {
          // Every face at the corner is in already: a structure's hole meets
          // the border there. The border steps out a ring of faces round it.
          for (const face of around) for (const corner of face.nodes) for (const next of facesAtNode.get(corner.id) ?? []) members.set(keyOf(next), next);
        }
      }
    }

    // Islands: border loops past the outermost with ground beyond them.
    const current = [...members.values()];
    const uses = new Map<string, number>();
    for (const face of current) for (const use of face.outerLoops.flat()) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
    const next = new Map<string, { readonly to: string; readonly edgeId: string }>();
    const position = new Map<string, { x: number; y: number; z: number }>();
    for (const face of current) {
      for (const node of face.nodes) position.set(node.id, node.position);
      for (const use of face.outerLoops.flat()) if (uses.get(use.edgeId) === 1) next.set(use.startNodeId, { to: use.endNodeId, edgeId: use.edgeId });
    }
    const loops: { readonly edges: string[]; readonly length: number }[] = [];
    const seen = new Set<string>();
    for (const start of [...next.keys()].sort()) {
      if (seen.has(start)) continue;
      const edges: string[] = [];
      let length = 0;
      let here = start;
      while (!seen.has(here) && next.has(here)) {
        seen.add(here);
        const step = next.get(here)!;
        edges.push(step.edgeId);
        const a = position.get(here)!, b = position.get(step.to)!;
        length += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        here = step.to;
      }
      if (edges.length >= 3) loops.push({ edges, length });
    }
    const outermost = loops.reduce((best, loop) => (best === undefined || loop.length > best.length ? loop : best), undefined as (typeof loops)[number] | undefined);
    const beyondOf = (loop: (typeof loops)[number]) => loop.edges.flatMap((edge) => (facesAtEdge.get(edge) ?? []).filter((face) => !members.has(keyOf(face))));
    const outside = new Set((outermost ? beyondOf(outermost) : []).map(keyOf));
    for (const loop of loops) {
      if (loop === outermost) continue;
      const beyond = beyondOf(loop);
      if (beyond.length === 0) continue;
      const island = walkSurface(ground, beyond, (face) => !members.has(keyOf(face)));
      // Ground reaching round to the outside is no island: it is the outside.
      if (island.length > MOST_ISLAND_FACES || island.some((face) => outside.has(keyOf(face)))) continue;
      for (const face of island) members.set(keyOf(face), face);
    }
    if (members.size === before) break;
  }
  return [...members.values()];
}
