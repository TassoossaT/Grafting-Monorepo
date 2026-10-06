import type { ConstructionRegionTopology } from "@/ports";

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

/** The median side of `faces`, measured in 3D, clamped to what ground is laid at. */
export function medianFaceSide(faces: readonly ConstructionRegionTopology[]): number {
  const sides: number[] = [];
  for (const face of faces) {
    const at = new Map(face.nodes.map((node) => [node.id, node.position]));
    for (const use of face.outerLoops.flat()) {
      const a = at.get(use.startNodeId), b = at.get(use.endNodeId);
      if (a && b) sides.push(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }
  sides.sort((a, b) => a - b);
  return Math.max(0.75, Math.min(6, sides[sides.length >> 1] ?? 2));
}
