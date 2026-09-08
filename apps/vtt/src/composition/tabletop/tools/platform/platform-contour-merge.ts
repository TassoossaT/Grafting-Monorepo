import type { ConstructionEdgeGeometry } from "@/ports";

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

/**
 * Where a point falls along `edge` (line or arc), as a fraction in (0, 1) --
 * `undefined` when it is not on the span at all, or sits at either endpoint
 * (an endpoint is a weld, not a split).
 */
function paramOnEdge(edge: DirectedContourEdge, positionOf: (id: string) => readonly [number, number], point: readonly [number, number], tolerance: number): number | undefined {
  const [ax, az] = positionOf(edge.a);
  const [bx, bz] = positionOf(edge.b);
  if (edge.geometry.kind === "line") {
    const dx = bx - ax, dz = bz - az;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq < 1e-12) return undefined;
    const t = ((point[0] - ax) * dx + (point[1] - az) * dz) / lengthSq;
    if (!(t > 1e-4 && t < 1 - 1e-4)) return undefined;
    const projected: readonly [number, number] = [ax + t * dx, az + t * dz];
    return Math.hypot(point[0] - projected[0], point[1] - projected[1]) <= tolerance ? t : undefined;
  }
  const { center, clockwise } = edge.geometry;
  const radius = Math.hypot(ax - center[0], az - center[1]);
  const pointRadius = Math.hypot(point[0] - center[0], point[1] - center[1]);
  if (Math.abs(pointRadius - radius) > tolerance) return undefined;
  const tau = Math.PI * 2;
  const startAngle = Math.atan2(az - center[1], ax - center[0]);
  const endAngle = Math.atan2(bz - center[1], bx - center[0]);
  const pointAngle = Math.atan2(point[1] - center[1], point[0] - center[0]);
  const sweep = clockwise ? -((startAngle - endAngle + tau) % tau) : (endAngle - startAngle + tau) % tau;
  if (Math.abs(sweep) < 1e-9) return undefined;
  let delta = clockwise ? -((startAngle - pointAngle + tau) % tau) : (pointAngle - startAngle + tau) % tau;
  if (clockwise && delta > 0) delta -= tau;
  if (!clockwise && delta < 0) delta += tau;
  const t = delta / sweep;
  return t > 1e-4 && t < 1 - 1e-4 ? t : undefined;
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
  edges: readonly DirectedContourEdge[],
  points: readonly { readonly id: string; readonly position: readonly [number, number] }[],
  positionOf: (id: string) => readonly [number, number],
  tolerance: number,
): readonly DirectedContourEdge[] {
  let result = edges;
  for (const point of points) {
    const next: DirectedContourEdge[] = [];
    for (const edge of result) {
      const t = edge.a === point.id || edge.b === point.id ? undefined : paramOnEdge(edge, positionOf, point.position, tolerance);
      if (t === undefined) { next.push(edge); continue; }
      next.push({ a: edge.a, b: point.id, geometry: edge.geometry });
      next.push({ a: point.id, b: edge.b, geometry: edge.geometry });
    }
    result = next;
  }
  return result;
}

function reverseGeometry(geometry: ConstructionEdgeGeometry): ConstructionEdgeGeometry {
  if (geometry.kind === "line") return geometry;
  return { kind: "arc", center: geometry.center, clockwise: !geometry.clockwise };
}

/** A distinct edge between the same two nodes (a lens of two arcs, say) never collides with this -- geometry is part of the identity, matching the same rounding `sharedEdgeId`'s own callers already accept. */
function geometrySignature(geometry: ConstructionEdgeGeometry): string {
  return geometry.kind === "line" ? "line" : `arc:${geometry.clockwise}:${geometry.center[0].toFixed(4)}:${geometry.center[1].toFixed(4)}`;
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
  const buckets = new Map<string, DirectedContourEdge[]>();
  const ambiguous = "O traço encontra a borda existente de um jeito ambíguo. Desenhe emendando uma aresta inteira, não só tocando um vértice.";
  for (const edge of declared) {
    const forwardOrder = edge.a < edge.b;
    const [lo, hi] = forwardOrder ? [edge.a, edge.b] : [edge.b, edge.a];
    const canonical = forwardOrder ? edge.geometry : reverseGeometry(edge.geometry);
    const key = `${lo}~${hi}~${geometrySignature(canonical)}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [edge]);
    else bucket.push(edge);
  }

  // Direction is deliberately not part of the match: whichever way the new
  // stroke happens to trace a span it shares with the standing boundary, two
  // declarations of the same span mean it is now interior. The kept span's
  // own direction (there is only ever one left once a pair cancels) is what
  // the later walk actually uses. A distinct edge over the same two nodes
  // (a lens of two arcs, say) carries its own geometry in the bucket key, so
  // it never collides with an unrelated edge here.
  const kept: DirectedContourEdge[] = [];
  for (const instances of buckets.values()) {
    if (instances.length === 1) kept.push(instances[0]!);
    else if (instances.length !== 2) return { kind: "error", message: ambiguous };
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

function sweep(edge: DirectedContourEdge, positionOf: (id: string) => readonly [number, number]): number {
  if (edge.geometry.kind !== "arc") return 0;
  const [cx, cz] = edge.geometry.center;
  const [ax, az] = positionOf(edge.a);
  const [bx, bz] = positionOf(edge.b);
  const start = Math.atan2(az - cz, ax - cx);
  const end = Math.atan2(bz - cz, bx - cx);
  const tau = Math.PI * 2;
  return edge.geometry.clockwise ? -((start - end + tau) % tau) : (end - start + tau) % tau;
}

/** Signed XZ area of a closed directed loop, arcs included -- positive winds counter-clockwise. */
export function loopSignedArea(loop: readonly DirectedContourEdge[], positionOf: (id: string) => readonly [number, number]): number {
  let area = 0;
  for (const edge of loop) {
    const [ax, az] = positionOf(edge.a);
    const [bx, bz] = positionOf(edge.b);
    area += (ax * bz - bx * az) / 2;
    if (edge.geometry.kind === "arc") {
      const [cx, cz] = edge.geometry.center;
      const radius = Math.hypot(ax - cx, az - cz);
      const angle = sweep(edge, positionOf);
      area += (radius * radius * (angle - Math.sin(angle))) / 2;
    }
  }
  return area;
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
  loops: readonly (readonly DirectedContourEdge[])[],
  positionOf: (id: string) => readonly [number, number],
): readonly LoopGroup[] {
  const areas = loops.map((loop) => Math.abs(loopSignedArea(loop, positionOf)));
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
