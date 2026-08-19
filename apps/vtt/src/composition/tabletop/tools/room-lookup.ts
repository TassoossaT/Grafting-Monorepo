import type { ConstructionNodeId, ConstructionPosition } from "@/ports";

import type { ToolContext } from "./tool-context.ts";
import { wallSpans, type WallSpan } from "./wall-spans.ts";

/**
 * Finds the smallest closed wall loop containing a click point -- used by
 * `house-room-delete-tool.ts` ("Apagar Cômodo"): given a point inside
 * hand-drawn walls already on the table (`wall-white`/`wall-gray`
 * surfaces), derive the room boundary there. See {@link findEnclosingRoom}'s
 * own doc for the algorithm.
 */
interface Vec2 {
  readonly x: number;
  readonly z: number;
}



function angleFromTo(a: Vec2, b: Vec2): number {
  return Math.atan2(b.z - a.z, b.x - a.x);
}

/** Every vertex's neighbours, sorted by the angle of the edge leaving that vertex -- what face-tracing turns on at each step. */
function buildAdjacency(
  spans: readonly WallSpan[],
): Map<ConstructionNodeId, { readonly to: ConstructionNodeId; readonly angle: number }[]> {
  const adjacency = new Map<ConstructionNodeId, { readonly to: ConstructionNodeId; readonly angle: number }[]>();
  const add = (from: ConstructionNodeId, to: ConstructionNodeId, fromPoint: Vec2, toPoint: Vec2) => {
    const list = adjacency.get(from) ?? [];
    list.push({ to, angle: angleFromTo(fromPoint, toPoint) });
    adjacency.set(from, list);
  };
  for (const span of spans) {
    add(span.bottomA, span.bottomB, span.a, span.b);
    add(span.bottomB, span.bottomA, span.b, span.a);
  }
  for (const list of adjacency.values()) list.sort((left, right) => left.angle - right.angle);
  return adjacency;
}

/** Traces one face starting at directed edge `startFrom -> startTo`, returning the closed vertex loop, or `undefined` if it never closes within `maxSteps` (a malformed/open graph). */
function traceFace(
  adjacency: ReadonlyMap<ConstructionNodeId, { readonly to: ConstructionNodeId; readonly angle: number }[]>,
  startFrom: ConstructionNodeId,
  startTo: ConstructionNodeId,
  maxSteps: number,
): ConstructionNodeId[] | undefined {
  const loop: ConstructionNodeId[] = [startFrom];
  let cameFrom = startFrom;
  let current = startTo;
  for (let step = 0; step < maxSteps; step += 1) {
    if (current === startFrom) return loop;
    loop.push(current);
    const neighbors = adjacency.get(current);
    if (neighbors === undefined || neighbors.length === 0) return undefined;
    const reverseIndex = neighbors.findIndex((entry) => entry.to === cameFrom);
    if (reverseIndex === -1) return undefined;
    const next = neighbors[(reverseIndex + 1) % neighbors.length];
    if (next === undefined) return undefined;
    cameFrom = current;
    current = next.to;
  }
  return undefined;
}

function pointInPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (pi === undefined || pj === undefined) continue;
    const crosses = pi.z > point.z !== pj.z > point.z;
    if (!crosses) continue;
    const xAtPointZ = ((pj.x - pi.x) * (point.z - pi.z)) / (pj.z - pi.z) + pi.x;
    if (point.x < xAtPointZ) inside = !inside;
  }
  return inside;
}

function polygonArea(polygon: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (pi === undefined || pj === undefined) continue;
    sum += (pj.x + pi.x) * (pj.z - pi.z);
  }
  return Math.abs(sum) / 2;
}

export interface DerivedRoom {
  readonly bottomCycle: readonly ConstructionNodeId[];
  readonly topCycle: readonly ConstructionNodeId[];
  readonly polygon: readonly Vec2[];
}

/**
 * The smallest (or, with `preference: "largest"`, the largest) closed wall
 * loop containing `click`, or `undefined` if no enclosed area was found
 * there. Algorithm: every wall is an edge between its two bottom corner
 * nodes (`wallSpans`). Tracing a planar graph's faces from a directed edge
 * by always continuing to the next neighbour (sorted by angle) immediately
 * after the reverse of the edge just arrived on is the standard
 * "wall-follower" construction for extracting bounded regions from a
 * straight-line graph -- but getting its clockwise/counter-clockwise
 * convention right by construction is easy to get backwards. Rather than
 * rely on that, this tries *both* directions of every wall as a starting
 * edge and keeps whichever closed loops actually contain the click point
 * (point-in-polygon) -- correct regardless of winding convention. Robust
 * to a T-junction on one side (the loop just gets an extra colinear vertex
 * there, which doesn't change area/containment).
 *
 * `preference` picks which of those candidate loops to return when more
 * than one contains the click (nested rooms, or a room already subdivided
 * by interior walls): `"smallest"` (the default -- right for
 * `house-room-delete-tool.ts`'s "Apagar Cômodo," which must only ever
 * touch the one room actually clicked) picks the innermost. `"largest"` is
 * right for `interior-wall-tool.ts`'s "Gerar Interiores": a click inside a
 * room it already subdivided must still resolve to that structure's own
 * *outermost* boundary, not whatever smaller cell the click happens to
 * land in after a prior generation -- otherwise regenerating (e.g. after
 * changing the seed) only ever re-subdivides an already-subdivided sliver
 * instead of the whole footprint again.
 */
export function findEnclosingRoom(ctx: ToolContext, click: ConstructionPosition, preference: "smallest" | "largest" = "smallest"): DerivedRoom | undefined {
  const spans = wallSpans(ctx);
  if (spans.length === 0) return undefined;

  const adjacency = buildAdjacency(spans);
  const positions = new Map<ConstructionNodeId, Vec2>();
  const bottomToTop = new Map<ConstructionNodeId, ConstructionNodeId>();
  for (const span of spans) {
    positions.set(span.bottomA, span.a);
    positions.set(span.bottomB, span.b);
    bottomToTop.set(span.bottomA, span.topA);
    bottomToTop.set(span.bottomB, span.topB);
  }
  const maxSteps = positions.size + 1;
  const clickXz: Vec2 = { x: click.x, z: click.z };

  let best: { readonly loop: readonly ConstructionNodeId[]; readonly polygon: readonly Vec2[]; readonly area: number } | undefined;
  for (const span of spans) {
    for (const [from, to] of [
      [span.bottomA, span.bottomB],
      [span.bottomB, span.bottomA],
    ] as const) {
      const loop = traceFace(adjacency, from, to, maxSteps);
      if (loop === undefined || loop.length < 3) continue;
      const polygon = loop.map((id) => positions.get(id)).filter((point): point is Vec2 => point !== undefined);
      if (polygon.length !== loop.length) continue;
      if (!pointInPolygon(clickXz, polygon)) continue;
      const area = polygonArea(polygon);
      if (area < 1e-6) continue;
      const better = best === undefined || (preference === "smallest" ? area < best.area : area > best.area);
      if (better) best = { loop, polygon, area };
    }
  }
  if (best === undefined) return undefined;

  const topCycle = best.loop.map((id) => bottomToTop.get(id)).filter((id): id is ConstructionNodeId => id !== undefined);
  if (topCycle.length !== best.loop.length) return undefined;
  return { bottomCycle: best.loop, topCycle, polygon: best.polygon };
}
