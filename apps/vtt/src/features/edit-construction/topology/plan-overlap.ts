import type { ConstructionEdgeGeometry, ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import type { PlanPoint } from "./plan-rotation.ts";

/**
 * Whether two outlines share area in plan, rather than only meeting along
 * their edges. Two floors of one kind that only touch may become one; two
 * that overlap never may -- one cloud's faces lying over each other are
 * meshed with holes where they cross -- so they are kept apart instead.
 */


/** How far inside an outline a point must be to count as inside it, not on its edge. */
const EPSILON = 1e-4;
/** How many straight pieces a curved edge is followed with. */
const ARC_STEPS = 16;

/** The points along an edge from `a` to `b`, `a` included and `b` not: itself, or a curved one followed closely. */
function edgePoints(a: ConstructionPosition, b: ConstructionPosition, geometry: ConstructionEdgeGeometry): PlanPoint[] {
  if (geometry.kind !== "arc") return [{ x: a.x, z: a.z }];
  const [cx, cz] = geometry.center;
  const radius = Math.hypot(a.x - cx, a.z - cz);
  const from = Math.atan2(a.z - cz, a.x - cx), to = Math.atan2(b.z - cz, b.x - cx);
  const turn = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sweep = geometry.clockwise ? -(turn(from - to) || 2 * Math.PI) : (turn(to - from) || 2 * Math.PI);
  return Array.from({ length: ARC_STEPS }, (_, i) => {
    const angle = from + (sweep * i) / ARC_STEPS;
    return { x: cx + Math.cos(angle) * radius, z: cz + Math.sin(angle) * radius };
  });
}

/** An outline as points in plan, from its edges in order. */
export function outlineOf(edges: readonly { readonly start: ConstructionPosition; readonly end: ConstructionPosition; readonly geometry: ConstructionEdgeGeometry }[]): readonly PlanPoint[] {
  return edges.flatMap((edge) => edgePoints(edge.start, edge.end, edge.geometry));
}

/** A face's outer outlines as points in plan. */
export function faceOutlines(topology: ConstructionRegionTopology): readonly (readonly PlanPoint[])[] {
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  return topology.outerLoops.map((loop) => outlineOf(loop.map((use) => ({ start: at.get(use.startNodeId)!, end: at.get(use.endNodeId)!, geometry: use.geometry }))));
}

function distanceToOutline(ring: readonly PlanPoint[], p: PlanPoint): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz;
    const t = lengthSq < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)));
  }
  return best;
}

/** Whether `p` is inside `ring` and clear of its edges. */
function strictlyInside(ring: readonly PlanPoint[], p: PlanPoint): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside && distanceToOutline(ring, p) > EPSILON;
}

/** Whether segments `a`-`b` and `c`-`d` cross each other at a point inside both, not merely touch or run along each other. */
function cross(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): boolean {
  const side = (p: PlanPoint, q: PlanPoint, r: PlanPoint) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d);
  const scale = Math.max(Math.hypot(b.x - a.x, b.z - a.z), Math.hypot(d.x - c.x, d.z - c.z), 1);
  const tolerance = EPSILON * scale;
  return ((d1 > tolerance && d2 < -tolerance) || (d1 < -tolerance && d2 > tolerance))
    && ((d3 > tolerance && d4 < -tolerance) || (d3 < -tolerance && d4 > tolerance));
}

/** Points just inside `ring`, one off the middle of each of its edges -- what lies over another outline when the two share area. */
function justInside(ring: readonly PlanPoint[]): readonly PlanPoint[] {
  const points: PlanPoint[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-9) continue;
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const normal = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
    const reach = Math.min(0.01, length / 4);
    for (const sign of [1, -1]) {
      const p = { x: mid.x + normal.x * reach * sign, z: mid.z + normal.z * reach * sign };
      if (strictlyInside(ring, p)) { points.push(p); break; }
    }
  }
  return points;
}

/** Whether outlines `a` and `b` share any area in plan -- not only edges or corners. */
export function outlinesOverlap(a: readonly PlanPoint[], b: readonly PlanPoint[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (cross(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  if (a.some((p) => strictlyInside(b, p)) || b.some((p) => strictlyInside(a, p))) return true;
  return justInside(a).some((p) => strictlyInside(b, p)) || justInside(b).some((p) => strictlyInside(a, p));
}

/** Whether `topology` shares area in plan with the outline `drawn`. */
export function faceOverlapsOutline(topology: ConstructionRegionTopology, drawn: readonly PlanPoint[]): boolean {
  return faceOutlines(topology).some((outline) => outlinesOverlap(outline, drawn));
}
