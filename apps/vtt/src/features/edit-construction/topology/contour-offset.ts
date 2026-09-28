import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

/**
 * Resizing a flat contour by its sides, the way a drafting tool pushes and
 * pulls them: a side moves square to itself, and the corners at its ends
 * slide along the sides next to it, so every side keeps its direction and
 * the shape only changes size. Heights never change.
 *
 * A side is a run of edges in one line, give or take a slight bend -- a
 * platform's edge split where a ramp is welded into it, or drawn by hand a
 * little crooked, is still one side, and moves whole. Where two sides meet
 * at a shallow angle, sliding the corner along the neighbour would throw it
 * far away; the corner follows the pushed side instead.
 */

/** Two edges are one side when they bend by less than this (sine of the angle): about 3 degrees. */
const COLLINEAR = 0.05;
/** Sides meeting at less than this (sine of the angle, about 20 degrees) are too shallow to slide a corner along. */
const SHALLOW = 0.34;

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
    if (bends(i)) sides.push({ nodes: [loop[i]!.startNodeId], edgeIds: [], n: { x: 0, z: 0 }, c: 0 });
    const side = sides.at(-1)!;
    side.edgeIds.push(loop[i]!.edgeId);
    side.nodes.push(loop[i]!.endNodeId);
  }
  // Each side's line runs through its two corners.
  for (const side of sides) {
    const a = at.get(side.nodes[0]!)!, b = at.get(side.nodes.at(-1)!)!;
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    side.n = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
    side.c = side.n.x * a.x + side.n.z * a.z;
  }
  return sides;
}

/** Where two side lines cross; `undefined` when they meet too shallow for the crossing to stay near. */
function crossing(p: Side, pc: number, q: Side, qc: number): { readonly x: number; readonly z: number } | undefined {
  const det = p.n.x * q.n.z - p.n.z * q.n.x;
  if (Math.abs(det) < SHALLOW) return undefined;
  return { x: (pc * q.n.z - p.n.z * qc) / det, z: (p.n.x * qc - pc * q.n.x) / det };
}

/**
 * Every node that moves when the sides of `topology` at `offsets` (by side
 * index) move square to themselves by that much, and where it goes.
 * Throws when a side would turn over.
 */
function offsetSides(
  topology: ConstructionRegionTopology,
  sides: readonly Side[],
  offsets: ReadonlyMap<number, number>,
  /** A corner that goes exactly here, whatever its sides' angle -- the one being dragged. */
  pinned?: { readonly nodeId: string; readonly delta: ConstructionPosition },
): readonly { readonly nodeId: string; readonly position: ConstructionPosition }[] {
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
      // Too shallow to slide along: the corner follows whichever side is pushed.
      const pushed = offsets.has(i) ? side : sides[next]!;
      const by = offsets.get(offsets.has(i) ? i : next)!;
      placed.set(corner, pinned?.nodeId === corner ? { x: p.x + pinned.delta.x, y: p.y, z: p.z + pinned.delta.z }
        : cross ? { x: cross.x, y: p.y, z: cross.z } : { x: p.x + pushed.n.x * by, y: p.y, z: p.z + pushed.n.z * by });
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
  return offsets.size === 0 ? undefined : offsetSides(topology, sides, offsets, { nodeId, delta });
}

/** `delta` kept only across the side `edgeId` belongs to, in plan -- how far a push moves it. */
export function acrossContourSide(topology: ConstructionRegionTopology, edgeId: string, delta: ConstructionPosition): ConstructionPosition {
  const side = sidesOf(topology)?.find((candidate) => candidate.edgeIds.includes(edgeId));
  if (!side) return { x: delta.x, y: 0, z: delta.z };
  const amount = planDot(side.n, delta);
  return { x: side.n.x * amount, y: 0, z: side.n.z * amount };
}

/**
 * Whether `topology` at `positions` keeps its outline: its corners where
 * they stand, and any node between two corners still on that side, between
 * them. A node sliding along its own side -- where something welded into
 * the side meets it -- changes nothing a rigid structure cares about.
 */
export function keepsOutline(topology: ConstructionRegionTopology, positions: ReadonlyMap<string, ConstructionPosition>): boolean {
  const sides = sidesOf(topology);
  if (!sides) return true;
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const now = (id: string) => positions.get(id) ?? at.get(id)!;
  const still = (a: ConstructionPosition, b: ConstructionPosition) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6;
  for (const side of sides) {
    const first = side.nodes[0]!, last = side.nodes.at(-1)!;
    if (!still(now(first), at.get(first)!) || !still(now(last), at.get(last)!)) return false;
    const a = at.get(first)!, b = at.get(last)!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    for (const id of side.nodes.slice(1, -1)) {
      const p = now(id);
      if (Math.abs(p.y - at.get(id)!.y) > 1e-6 || Math.abs(side.n.x * p.x + side.n.z * p.z - side.c) > 1e-6) return false;
      const along = ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / (length || 1);
      if (along <= 0 || along >= length) return false;
    }
  }
  return true;
}
