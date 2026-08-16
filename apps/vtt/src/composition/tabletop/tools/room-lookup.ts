import type { ConstructionNodeId, ConstructionPosition } from "@/ports";

import type { ToolContext } from "./tool-context.ts";

/**
 * Finds the smallest closed wall loop containing a click point -- extracted
 * from `room-derive-tool.ts` once a second genuine call site
 * (`house-room-delete-tool.ts`, "Apagar Cômodo") needed the identical
 * lookup: given a point inside walls already on the table (hand-drawn or
 * `house-stamp`-generated, both use `wall-white`/`wall-gray` surfaces),
 * derive the room boundary there. See {@link findEnclosingRoom}'s own doc
 * for the algorithm.
 */
interface Vec2 {
  readonly x: number;
  readonly z: number;
}

interface WallSpan {
  readonly bottomA: ConstructionNodeId;
  readonly bottomB: ConstructionNodeId;
  readonly topA: ConstructionNodeId;
  readonly topB: ConstructionNodeId;
  readonly a: Vec2;
  readonly b: Vec2;
}

/** Recovers a wall's two vertical posts from its surface's node positions -- grouped by matching XZ, not by array order (a `ConstructionSurfaceKey` is an unordered node-set identity, per `ports/construction-session-port.ts`). Mirrors `wall-brush-tool.ts`'s own `wallPostsFromNodes`, kept separate since the two tools' input shapes differ enough that sharing would need its own seam. */
function wallSpans(ctx: ToolContext): readonly WallSpan[] {
  const map = ctx.runtime.getSnapshot().map;
  const spans: WallSpan[] = [];

  for (const surface of map.byId.values()) {
    if (surface.type !== "wall-white" && surface.type !== "wall-gray") continue;
    if (surface.orderedNodeRefs.length !== 4) continue;
    const nodes = surface.orderedNodeRefs
      .map((id) => map.nodePositions.get(id))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    if (nodes.length !== 4) continue;

    const [first, ...rest] = nodes;
    if (first === undefined) continue;
    const sameXz = (a: (typeof nodes)[number], b: (typeof nodes)[number]) =>
      Math.abs(a.position.x - b.position.x) < 1e-3 && Math.abs(a.position.z - b.position.z) < 1e-3;
    const groupA = [first, ...rest.filter((node) => sameXz(node, first))];
    const groupB = rest.filter((node) => !sameXz(node, first));
    if (groupA.length !== 2 || groupB.length !== 2) continue;

    const [a0, a1] = groupA.sort((x, y) => x.position.y - y.position.y) as [(typeof nodes)[number], (typeof nodes)[number]];
    const [b0, b1] = groupB.sort((x, y) => x.position.y - y.position.y) as [(typeof nodes)[number], (typeof nodes)[number]];
    spans.push({
      bottomA: a0.nodeRef,
      topA: a1.nodeRef,
      bottomB: b0.nodeRef,
      topB: b1.nodeRef,
      a: { x: a0.position.x, z: a0.position.z },
      b: { x: b0.position.x, z: b0.position.z },
    });
  }
  return spans;
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
 * The smallest closed wall loop containing `click`, or `undefined` if no
 * enclosed area was found there. Algorithm: every wall is an edge between
 * its two bottom corner nodes (`wallSpans`). Tracing a planar graph's
 * faces from a directed edge by always continuing to the next neighbour
 * (sorted by angle) immediately after the reverse of the edge just
 * arrived on is the standard "wall-follower" construction for extracting
 * bounded regions from a straight-line graph -- but getting its
 * clockwise/counter-clockwise convention right by construction is easy to
 * get backwards. Rather than rely on that, this tries *both* directions
 * of every wall as a starting edge, keeps whichever closed loops actually
 * contain the click point (point-in-polygon), and picks the smallest one
 * -- correct regardless of winding convention, and "smallest enclosing
 * loop" is also just the right answer if rooms are ever nested. Robust to
 * a T-junction on one side (the loop just gets an extra colinear vertex
 * there, which doesn't change area/containment).
 */
export function findEnclosingRoom(ctx: ToolContext, click: ConstructionPosition): DerivedRoom | undefined {
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
      if (best === undefined || area < best.area) best = { loop, polygon, area };
    }
  }
  if (best === undefined) return undefined;

  const topCycle = best.loop.map((id) => bottomToTop.get(id)).filter((id): id is ConstructionNodeId => id !== undefined);
  if (topCycle.length !== best.loop.length) return undefined;
  return { bottomCycle: best.loop, topCycle, polygon: best.polygon };
}
