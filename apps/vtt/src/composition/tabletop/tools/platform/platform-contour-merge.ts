import type { ConstructionEdgeGeometry } from "@/ports";

import {
  arcSweepsOf,
  closestOnContours,
  sameGeometry,
  type ContourPort,
  type ContourSpan,
} from "../../../../features/edit-construction/index.ts";

/**
 * Replaces the analytic curved-boolean engine platform extend/cut used to
 * run against. That engine could combine any two crossing shapes, arcs
 * included, but paid for it with 350+ lines of exact-geometry intersection
 * math no other tool in this codebase needed -- and let a stroke redraw a
 * platform's shape by crossing its interior anywhere, which is exactly the
 * "too free for a controlled edit mode" behavior the owner asked to remove
 * (2026-09-08 review of #242).
 *
 * The replacement never computes an intersection. A stroke may only extend
 * or cut a platform by welding onto its existing boundary -- reusing the
 * same node wherever a drawn point lands within tolerance, the same way a
 * wall run welds onto an existing column. Where the new stroke and the old
 * boundary then share an edge walked in opposite directions, that edge
 * cancels (it is now interior); what survives assembles back into the
 * result loop(s) by simple endpoint matching, no angle sorting or
 * interior/exterior sampling required, because a clean weld never leaves a
 * node with more than one surviving outgoing edge. A node that *does* end
 * up ambiguous (the stroke only touched the boundary at a single point
 * without running along a real edge) is refused rather than guessed --
 * see {@link WeldedMergeResult}'s `error` case.
 */

export interface DirectedContourEdge {
  readonly a: string;
  readonly b: string;
  readonly geometry: ConstructionEdgeGeometry;
}

export type WeldedMergeResult =
  | { readonly kind: "ok"; readonly loops: readonly (readonly DirectedContourEdge[])[] }
  | { readonly kind: "error"; readonly message: string };

/** One edge, phrased the way a contour question is asked; height plays no part in a weld. */
function spanOf(
  edge: DirectedContourEdge,
  positionOf: (id: string) => readonly [number, number],
): ContourSpan {
  const [ax, az] = positionOf(edge.a);
  const [bx, bz] = positionOf(edge.b);
  return { geometry: edge.geometry, start: { x: ax, y: 0, z: az }, end: { x: bx, y: 0, z: bz } };
}

/**
 * Where `point` falls along each edge, as a fraction in (0, 1) -- `undefined`
 * for an edge the point is not on, or one it only meets at an endpoint (an
 * endpoint is a weld, not a split).
 *
 * The engine answers where the point sits on each curve; the tolerance and the
 * endpoint exclusion are this merge's own judgement about what counts as a
 * weld, which is the part that belongs here.
 */
function paramsOnEdges(
  port: ContourPort,
  edges: readonly DirectedContourEdge[],
  positionOf: (id: string) => readonly [number, number],
  point: readonly [number, number],
  tolerance: number,
): readonly (number | undefined)[] {
  const closest = closestOnContours(
    port,
    edges.map((edge) => spanOf(edge, positionOf)),
    { x: point[0], y: 0, z: point[1] },
  );
  return closest.map(({ t, position }, index) => {
    // A split keeps each half's own geometry, which is true of a chord and of
    // an arc (any two points on a circle bound an arc of that same circle) but
    // never of a Bezier, whose handles belong to its own endpoints. A
    // platform's contour is only ever fitted as line or arc, so rather than
    // split a curve wrongly here, a Bezier edge simply offers no weld.
    if (edges[index]!.geometry.kind === "bezier") return undefined;
    if (!(t > 1e-4 && t < 1 - 1e-4)) return undefined;
    return Math.hypot(point[0] - position[0], point[1] - position[1]) <= tolerance ? t : undefined;
  });
}

/**
 * Subdivides every edge in `edges` at any of `points` that lands on its span
 * (not at either endpoint) -- the mid-edge counterpart to node welding.
 *
 * Without this, a stroke that welds onto a boundary vertex at one end and a
 * point *along* an untouched standing edge at the other would cancel nothing
 * there (that standing edge has no node to match), and the surviving edges
 * would reconnect through the standing edge's own far corner instead of the
 * weld point -- a valid-looking loop that silently traces the wrong shape.
 * Splitting first turns every weld, corner or mid-span, into a real shared
 * node before {@link weldedMerge} ever compares edges.
 */
export function splitContourAtPoints(
  port: ContourPort,
  edges: readonly DirectedContourEdge[],
  points: readonly { readonly id: string; readonly position: readonly [number, number] }[],
  positionOf: (id: string) => readonly [number, number],
  tolerance: number,
): readonly DirectedContourEdge[] {
  let result = edges;
  for (const point of points) {
    const params = paramsOnEdges(port, result, positionOf, point.position, tolerance);
    const next: DirectedContourEdge[] = [];
    result.forEach((edge, index) => {
      const t = edge.a === point.id || edge.b === point.id ? undefined : params[index];
      if (t === undefined) { next.push(edge); return; }
      next.push({ a: edge.a, b: point.id, geometry: edge.geometry });
      next.push({ a: point.id, b: edge.b, geometry: edge.geometry });
    });
    result = next;
  }
  return result;
}

function reverseGeometry(geometry: ConstructionEdgeGeometry): ConstructionEdgeGeometry {
  if (geometry.kind === "line") return geometry;
  if (geometry.kind === "bezier") return { kind: "bezier", handle1: geometry.handle2, handle2: geometry.handle1 };
  return { kind: "arc", center: geometry.center, clockwise: !geometry.clockwise };
}

/**
 * Cancels every edge the two edge sets share in opposite directions (an
 * edge welded onto by both the old boundary and the new stroke), then
 * reassembles what is left into closed loops by following each edge's `b`
 * to the next edge's `a`.
 *
 * Refuses -- rather than guessing -- whenever cancellation leaves any node
 * with more than one surviving outgoing or incoming edge (an ambiguous
 * branch: the stroke only touched the boundary at a point, not along a
 * shared run), or when the survivors do not close into whole loops.
 */
export function weldedMerge(
  standing: readonly DirectedContourEdge[],
  stroke: readonly DirectedContourEdge[],
): WeldedMergeResult {
  const declared = [...standing, ...stroke];
  const pairGroups = new Map<string, { readonly canonical: ConstructionEdgeGeometry; readonly edges: DirectedContourEdge[] }[]>();
  const ambiguous = "O traço encontra a borda existente de um jeito ambíguo. Desenhe emendando uma aresta inteira, não só tocando um vértice.";
  for (const edge of declared) {
    const forwardOrder = edge.a < edge.b;
    const [lo, hi] = forwardOrder ? [edge.a, edge.b] : [edge.b, edge.a];
    const canonical = forwardOrder ? edge.geometry : reverseGeometry(edge.geometry);
    const key = `${lo}~${hi}`;
    const groups = pairGroups.get(key) ?? [];
    if (!pairGroups.has(key)) pairGroups.set(key, groups);
    const group = groups.find((candidate) => sameGeometry(candidate.canonical, canonical));
    if (group === undefined) groups.push({ canonical, edges: [edge] });
    else group.edges.push(edge);
  }

  // Direction is deliberately not part of the match: whichever way the new
  // stroke happens to trace a span it shares with the standing boundary, two
  // declarations of the same span mean it is now interior. The kept span's
  // own direction (there is only ever one left once a pair cancels) is what
  // the later walk actually uses. A distinct edge over the same two nodes
  // (a lens of two arcs, say) groups separately via `sameGeometry`, so it
  // never collides with an unrelated edge here.
  const kept: DirectedContourEdge[] = [];
  for (const groups of pairGroups.values()) {
    for (const { edges: instances } of groups) {
      if (instances.length === 1) kept.push(instances[0]!);
      else if (instances.length !== 2) return { kind: "error", message: ambiguous };
    }
  }

  const outFrom = new Map<string, DirectedContourEdge>();
  const intoNode = new Map<string, number>();
  for (const edge of kept) {
    if (outFrom.has(edge.a)) return { kind: "error", message: ambiguous };
    outFrom.set(edge.a, edge);
    intoNode.set(edge.b, (intoNode.get(edge.b) ?? 0) + 1);
  }
  for (const count of intoNode.values()) {
    if (count > 1) return { kind: "error", message: ambiguous };
  }

  const visited = new Set<DirectedContourEdge>();
  const loops: DirectedContourEdge[][] = [];
  for (const start of kept) {
    if (visited.has(start)) continue;
    const loop: DirectedContourEdge[] = [];
    let current: DirectedContourEdge | undefined = start;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      loop.push(current);
      current = outFrom.get(current.b);
    }
    if (current !== start) {
      return { kind: "error", message: "O contorno não fechou depois da solda. Desenhe encostando na borda existente de ponta a ponta." };
    }
    loops.push(loop);
  }
  return { kind: "ok", loops };
}

/**
 * Signed XZ area of a closed directed loop, arcs included -- positive winds
 * counter-clockwise.
 *
 * The chord polygon is summed here; each arc adds the circular segment between
 * its chord and its curve, and how far that arc turns is the engine's answer,
 * asked for every arc in the loop in one crossing.
 */
export function loopSignedArea(
  port: ContourPort,
  loop: readonly DirectedContourEdge[],
  positionOf: (id: string) => readonly [number, number],
): number {
  const arcs = loop.filter((edge) => edge.geometry.kind === "arc");
  const answered = arcSweepsOf(port, arcs.map((edge) => spanOf(edge, positionOf)));
  const sweeps = new Map(arcs.map((edge, index) => [edge, answered[index] ?? 0]));
  let area = 0;
  for (const edge of loop) {
    const [ax, az] = positionOf(edge.a);
    const [bx, bz] = positionOf(edge.b);
    area += (ax * bz - bx * az) / 2;
    if (edge.geometry.kind === "arc") {
      const [cx, cz] = edge.geometry.center;
      const radius = Math.hypot(ax - cx, az - cz);
      const angle = sweeps.get(edge) ?? 0;
      area += (radius * radius * (angle - Math.sin(angle))) / 2;
    }
  }
  return area;
}

/**
 * A loop walked the way a face of its kind has to be: a boundary with positive
 * {@link loopSignedArea}, a hole negative.
 *
 * The drawn contour carries whatever direction the gesture happened to have --
 * a rectangle dragged one diagonal winds one way, the other diagonal the other.
 * A face stored the wrong way round is still a face, but it walks every edge
 * the same way as the ground on the other side of it, and two faces walking an
 * edge the same way cannot both have it. The ground laid against it is refused
 * for sitting on ground already there, and that whole side stays empty.
 */
export function windLoop(
  port: ContourPort,
  loop: readonly DirectedContourEdge[],
  positionOf: (id: string) => readonly [number, number],
  role: "boundary" | "hole",
): readonly DirectedContourEdge[] {
  const area = loopSignedArea(port, loop, positionOf);
  if (role === "boundary" ? area >= 0 : area <= 0) return loop;
  return [...loop].reverse().map((edge) => ({ a: edge.b, b: edge.a, geometry: reverseGeometry(edge.geometry) }));
}

/** Whether `point` lies inside `loop` (even-odd ray cast; arc spans are chorded for the test, which is exact enough at the ~1e-3 scale these loops are welded at). */
export function pointInLoop(
  loop: readonly DirectedContourEdge[],
  positionOf: (id: string) => readonly [number, number],
  point: readonly [number, number],
): boolean {
  let inside = false;
  const [px, pz] = point;
  for (const edge of loop) {
    const [ax, az] = positionOf(edge.a);
    const [bx, bz] = positionOf(edge.b);
    if (az > pz !== bz > pz) {
      const x = ax + ((pz - az) / (bz - az)) * (bx - ax);
      if (px < x) inside = !inside;
    }
  }
  return inside;
}

export interface LoopGroup {
  readonly boundary: readonly DirectedContourEdge[];
  readonly holes: readonly (readonly DirectedContourEdge[])[];
}

/**
 * Nests each loop under the smallest other loop that contains it (a hole
 * inside its owning face); a loop nothing contains is its own face.
 *
 * Tested by one representative vertex rather than the whole loop, since a
 * hole produced by this weld model only ever touches its owner at isolated
 * weld points, never runs along its boundary -- an interior span run twice
 * already cancelled out in {@link weldedMerge}.
 */
export function groupLoopsByContainment(
  port: ContourPort,
  loops: readonly (readonly DirectedContourEdge[])[],
  positionOf: (id: string) => readonly [number, number],
): readonly LoopGroup[] {
  const areas = loops.map((loop) => Math.abs(loopSignedArea(port, loop, positionOf)));
  const ownerOf = loops.map((loop, index) => {
    const sample = positionOf(loop[0]!.a);
    let owner = -1;
    let ownerArea = Infinity;
    loops.forEach((candidate, candidateIndex) => {
      if (candidateIndex === index || areas[candidateIndex]! >= ownerArea) return;
      if (pointInLoop(candidate, positionOf, sample)) {
        owner = candidateIndex;
        ownerArea = areas[candidateIndex]!;
      }
    });
    return owner;
  });
  return loops
    .map((boundary, index) => index)
    .filter((index) => ownerOf[index] === -1)
    .map((outerIndex) => ({
      boundary: loops[outerIndex]!,
      holes: loops.filter((_, index) => ownerOf[index] === outerIndex),
    }));
}
