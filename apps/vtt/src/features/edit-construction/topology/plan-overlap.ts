import type { ConstructionEdgeGeometry, ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import { insideRing, nearestOnSegment, segmentsCross } from "./plan-geometry.ts";
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
  return ringsOf(topology, topology.outerLoops);
}

function ringsOf(topology: ConstructionRegionTopology, loops: ConstructionRegionTopology["outerLoops"]): readonly (readonly PlanPoint[])[] {
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  return loops.map((loop) => outlineOf(loop.map((use) => ({ start: at.get(use.startNodeId)!, end: at.get(use.endNodeId)!, geometry: use.geometry }))));
}

/** An area in plan: its outer outlines, less its holes. */
export interface PlanArea {
  readonly outers: readonly (readonly PlanPoint[])[];
  readonly holes: readonly (readonly PlanPoint[])[];
}

/** A face as an area -- its holes left out of it. */
export function faceArea(topology: ConstructionRegionTopology): PlanArea {
  return { outers: faceOutlines(topology), holes: ringsOf(topology, topology.holes) };
}

function distanceToOutline(ring: readonly PlanPoint[], p: PlanPoint): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) best = Math.min(best, nearestOnSegment(p, ring[i]!, ring[(i + 1) % ring.length]!).distance);
  return best;
}

/** Whether `p` is inside `ring` and clear of its edges. */
function strictlyInside(ring: readonly PlanPoint[], p: PlanPoint): boolean {
  return insideRing(ring, p) && distanceToOutline(ring, p) > EPSILON;
}

/** Whether segments `a`-`b` and `c`-`d` cross each other at a point inside both, not merely touch or run along each other. */
function cross(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): boolean {
  return segmentsCross(a, b, c, d, EPSILON * Math.max(Math.hypot(b.x - a.x, b.z - a.z), Math.hypot(d.x - c.x, d.z - c.z), 1));
}

/** Whether `p` is inside `ring` or on its edge. */
const insideOrOn = (ring: readonly PlanPoint[], p: PlanPoint) => strictlyInside(ring, p) || distanceToOutline(ring, p) <= EPSILON;

/** Whether `p` is inside `area` and clear of its edges -- neither out of it nor in or on one of its holes. */
function strictlyInsideArea(area: PlanArea, p: PlanPoint): boolean {
  return area.outers.some((ring) => strictlyInside(ring, p)) && !area.holes.some((ring) => insideOrOn(ring, p));
}

/** Points of `area` to test against another: every corner, and a point just off the middle of each edge on the area's own side. */
function samplesOf(area: PlanArea): readonly PlanPoint[] {
  const points: PlanPoint[] = [];
  for (const ring of [...area.outers, ...area.holes]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      points.push(a);
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 1e-9) continue;
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const normal = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
      const reach = Math.min(0.01, length / 4);
      for (const sign of [1, -1]) {
        const p = { x: mid.x + normal.x * reach * sign, z: mid.z + normal.z * reach * sign };
        if (strictlyInsideArea(area, p)) { points.push(p); break; }
      }
    }
  }
  return points;
}

const edgesOf = (area: PlanArea) => [...area.outers, ...area.holes].flatMap((ring) => ring.map((a, i) => [a, ring[(i + 1) % ring.length]!] as const));

/**
 * Whether areas `a` and `b` share any area in plan -- not only edges or
 * corners. A hole is no part of its area: an outline lying in a floor's
 * hole, even along the hole's edge, does not overlap the floor.
 */
export function areasOverlap(a: PlanArea, b: PlanArea): boolean {
  // Two outlines crossing each other always leave some of each on the same side.
  const edgesB = edgesOf(b);
  for (const [p, q] of edgesOf(a)) for (const [r, t] of edgesB) if (cross(p, q, r, t)) return true;
  return samplesOf(a).some((p) => strictlyInsideArea(b, p)) || samplesOf(b).some((p) => strictlyInsideArea(a, p));
}

/** Whether outlines `a` and `b` share any area in plan -- not only edges or corners. */
export function outlinesOverlap(a: readonly PlanPoint[], b: readonly PlanPoint[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  return areasOverlap({ outers: [a], holes: [] }, { outers: [b], holes: [] });
}

/** Whether `topology` shares area in plan with the outline `drawn` -- its holes are none of it. */
export function faceOverlapsOutline(topology: ConstructionRegionTopology, drawn: readonly PlanPoint[]): boolean {
  return drawn.length >= 3 && areasOverlap(faceArea(topology), { outers: [drawn], holes: [] });
}

/** Whether `topology` meets the outline `drawn` -- shares area with it, or comes within `reach` of it, holes' edges included. */
export function faceTouchesOutline(topology: ConstructionRegionTopology, drawn: readonly PlanPoint[], reach: number): boolean {
  if (faceOverlapsOutline(topology, drawn)) return true;
  const face = faceArea(topology), mine = { outers: [drawn], holes: [] };
  const near = (points: readonly PlanPoint[], edges: readonly (readonly [PlanPoint, PlanPoint])[]) =>
    points.some((p) => edges.some(([a, b]) => distanceToOutline([a, b], p) <= reach));
  return near([...face.outers, ...face.holes].flat(), edgesOf(mine)) || near(drawn, edgesOf(face));
}
