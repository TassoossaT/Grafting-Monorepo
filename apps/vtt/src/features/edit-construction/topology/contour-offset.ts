import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

/**
 * Resizing a flat contour by its sides, the way a drafting tool pushes and
 * pulls them: a side moves square to itself, and the corners at its ends
 * slide along the sides next to it, so every side keeps its direction and
 * the shape only changes size. Heights never change.
 *
 * A side is a run of straight edges in one line -- a platform's edge split
 * where a ramp is welded into it is still one side, and moves whole.
 */

/** Two edges are one side when their directions differ by less than this (sine of the angle). */
const COLLINEAR = 1e-4;

interface Side {
  /** Nodes along the side, in the loop's order, from its first corner to its last. */
  readonly nodes: readonly string[];
  readonly edgeIds: readonly string[];
  /** Unit normal in plan -- which way does not matter, only that it is used throughout. */
  readonly n: { readonly x: number; readonly z: number };
  /** The side's line: n . p = c. */
  readonly c: number;
}

/** The outer loop's sides, each a maximal run of collinear edges; `undefined` when the loop is too small to have any. */
function sidesOf(topology: ConstructionRegionTopology): readonly Side[] | undefined {
  const loop = topology.outerLoops[0] ?? [];
  if (loop.length < 3) return undefined;
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const dir = (i: number) => {
    const use = loop[i]!;
    const a = at.get(use.startNodeId)!, b = at.get(use.endNodeId)!;
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
  };
  const bends = (i: number) => {
    const p = dir((i - 1 + loop.length) % loop.length), q = dir(i);
    return Math.abs(p.x * q.z - p.z * q.x) > COLLINEAR || p.x * q.x + p.z * q.z < 0;
  };
  const start = loop.findIndex((_, i) => bends(i));
  if (start < 0) return undefined;
  const sides: { nodes: string[]; edgeIds: string[]; n: Side["n"]; c: number }[] = [];
  for (let k = 0; k < loop.length; k += 1) {
    const i = (start + k) % loop.length;
    if (bends(i)) {
      const d = dir(i);
      const n = { x: -d.z, z: d.x };
      const a = at.get(loop[i]!.startNodeId)!;
      sides.push({ nodes: [loop[i]!.startNodeId], edgeIds: [], n, c: n.x * a.x + n.z * a.z });
    }
    const side = sides.at(-1)!;
    side.edgeIds.push(loop[i]!.edgeId);
    side.nodes.push(loop[i]!.endNodeId);
  }
  return sides;
}

/** Where two side lines cross; `undefined` when they are parallel. */
function crossing(p: Side, pc: number, q: Side, qc: number): { readonly x: number; readonly z: number } | undefined {
  const det = p.n.x * q.n.z - p.n.z * q.n.x;
  if (Math.abs(det) < 1e-9) return undefined;
  return { x: (pc * q.n.z - p.n.z * qc) / det, z: (p.n.x * qc - pc * q.n.x) / det };
}

/**
 * Every node that moves when the sides of `topology` at `offsets` (by side
 * index) move square to themselves by that much, and where it goes.
 * Throws when a side would turn over.
 */
function offsetSides(topology: ConstructionRegionTopology, sides: readonly Side[], offsets: ReadonlyMap<number, number>): readonly { readonly nodeId: string; readonly position: ConstructionPosition }[] {
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const c = (i: number) => sides[i]!.c + (offsets.get(i) ?? 0);
  const placed = new Map<string, ConstructionPosition>();
  sides.forEach((side, i) => {
    const next = (i + 1) % sides.length;
    // The corner this side shares with the next one.
    const corner = side.nodes.at(-1)!;
    if ((offsets.has(i) || offsets.has(next)) && !placed.has(corner)) {
      const p = at.get(corner)!;
      const cross = crossing(side, c(i), sides[next]!, c(next));
      placed.set(corner, cross ? { x: cross.x, y: p.y, z: cross.z } : { x: p.x + side.n.x * (offsets.get(i) ?? 0), y: p.y, z: p.z + side.n.z * (offsets.get(i) ?? 0) });
    }
    const offset = offsets.get(i);
    if (offset === undefined) return;
    for (const id of side.nodes.slice(1, -1)) {
      const p = at.get(id)!;
      placed.set(id, { x: p.x + side.n.x * offset, y: p.y, z: p.z + side.n.z * offset });
    }
  });
  // A side that turned over has pushed past its neighbours.
  for (const side of sides) {
    const a = at.get(side.nodes[0]!)!, b = at.get(side.nodes.at(-1)!)!;
    const a2 = placed.get(side.nodes[0]!) ?? a, b2 = placed.get(side.nodes.at(-1)!) ?? b;
    if ((b.x - a.x) * (b2.x - a2.x) + (b.z - a.z) * (b2.z - a2.z) <= 1e-9) throw new Error("Um lado da plataforma encolheria ate sumir.");
  }
  return [...placed].filter(([id, position]) => {
    const p = at.get(id)!;
    return Math.hypot(position.x - p.x, position.z - p.z) > 1e-12;
  }).map(([nodeId, position]) => ({ nodeId, position }));
}

const planDot = (n: { readonly x: number; readonly z: number }, d: ConstructionPosition) => n.x * d.x + n.z * d.z;

/** The side `edgeId` belongs to moved square to itself by the part of `delta` across it; `undefined` when the edge is not on the outer loop. */
export function pushContourSide(topology: ConstructionRegionTopology, edgeId: string, delta: ConstructionPosition) {
  const sides = sidesOf(topology);
  const i = sides?.findIndex((side) => side.edgeIds.includes(edgeId)) ?? -1;
  if (!sides || i < 0) return undefined;
  return offsetSides(topology, sides, new Map([[i, planDot(sides[i]!.n, delta)]]));
}

/**
 * The corner `nodeId` taken by `delta` in plan by moving both sides meeting
 * there, each square to itself; a node in the middle of a side moves that
 * side alone. `undefined` when the node is not on the outer loop.
 */
export function pushContourCorner(topology: ConstructionRegionTopology, nodeId: string, delta: ConstructionPosition) {
  const sides = sidesOf(topology);
  if (!sides) return undefined;
  const offsets = new Map<number, number>();
  sides.forEach((side, i) => {
    if (side.nodes.at(-1) === nodeId) offsets.set(i, planDot(side.n, delta)).set((i + 1) % sides.length, planDot(sides[(i + 1) % sides.length]!.n, delta));
    else if (side.nodes.slice(1, -1).includes(nodeId)) offsets.set(i, planDot(side.n, delta));
  });
  return offsets.size === 0 ? undefined : offsetSides(topology, sides, offsets);
}

/** `delta` kept only across the side `edgeId` belongs to, in plan -- how far a push moves it. */
export function acrossContourSide(topology: ConstructionRegionTopology, edgeId: string, delta: ConstructionPosition): ConstructionPosition {
  const side = sidesOf(topology)?.find((candidate) => candidate.edgeIds.includes(edgeId));
  if (!side) return { x: delta.x, y: 0, z: delta.z };
  const amount = planDot(side.n, delta);
  return { x: side.n.x * amount, y: 0, z: side.n.z * amount };
}
