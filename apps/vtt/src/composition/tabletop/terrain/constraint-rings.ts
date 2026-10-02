import type { ConstructionGridConstraintPoint, ConstructionNodeId, ConstructionRegionEdge } from "@/ports";
import type { PlanarArea } from "@/features/edit-construction";

import type { ConstraintRing, ConstraintTable } from "./terrain-constraints.ts";

/**
 * The rings a repair hands the grid generator, and what each corner and side
 * of them is: which node a corner is, which standing edge a side runs along --
 * so the ground laid comes back meeting what stands at its real nodes and
 * edges, never at coincident positions. Read from the boolean's bare output
 * (`buildConstraintRings`) and from a structure's own outline
 * (`anchoredConstraints`).
 */

/**
 * A structure's outline as constraint rings where a corner carries its node
 * only when `anchored` names it. Sealed, the ground meets it without sharing it
 * -- no edge to split, and a node only where another structure holds it too,
 * a ramp's end welded into a floor. Otherwise (`withEdges`) its sides stay
 * edges the ground may split, and `anchored` is the nodes resting on the ground.
 */
export function anchoredConstraints(
  rings: readonly (readonly ConstructionRegionEdge[])[],
  positionOf: ReadonlyMap<ConstructionNodeId, { readonly x: number; readonly z: number }>,
  startingIndex: number,
  anchored: ReadonlySet<ConstructionNodeId>,
  /** Sources numbered just before, from `startingIndex` on: a node already among them keeps its number. */
  before: readonly ConstructionNodeId[] = [],
  withEdges = false,
): ConstraintTable {
  const sources: ConstructionNodeId[] = [];
  const index = new Map<ConstructionNodeId, number>(before.map((id, i) => [id, startingIndex + i]));
  startingIndex += before.length;
  const built: ConstraintRing[] = [];
  for (const ring of rings) {
    const points: ConstructionGridConstraintPoint[] = [];
    for (const edge of ring) {
      const position = positionOf.get(edge.startNodeId);
      if (!position) break;
      let source: number | undefined;
      if (anchored.has(edge.startNodeId)) {
        source = index.get(edge.startNodeId);
        if (source === undefined) {
          source = startingIndex + sources.length;
          sources.push(edge.startNodeId);
          index.set(edge.startNodeId, source);
        }
      }
      points.push(source === undefined ? { x: position.x, z: position.z } : { x: position.x, z: position.z, source });
    }
    if (points.length === ring.length && points.length >= 3) built.push({ points, edges: withEdges ? ring : ring.map(() => undefined) });
  }
  return { rings: built, sources };
}

/** Two nodes name one edge whichever way round they are given. */
function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Dropping corners the boolean invented in the middle of an edge that already
 * existed.
 *
 * Where the ground's own rim crosses the painter's contour, the boolean
 * splits both and hands back a vertex at the crossing. That vertex names no
 * node -- it never was one -- and its presence breaks one segment into two,
 * *neither* of which runs between a pair of adjacent nodes any more. So neither
 * knows which edge it lies on, and every corner the generator later lands there
 * is discarded with nothing split: the ground meets the painter at a coincident
 * position instead of at a node, once per crossing. That is the tooth.
 *
 * A corner sitting on the straight line between two nodes that really are
 * joined by an edge adds nothing the ring did not already say. Removing it
 * restores the segment to the pair it belongs to, and the split lands where it
 * should. Only a corner that is genuinely *on* that line goes -- one where the
 * rim leaves the contour is a real corner and stays.
 */
/** Whether `point` sits on the span `from`-`to`, ends included, within `tolerance`. */
function onSpan(
  point: { readonly x: number; readonly z: number },
  from: { readonly x: number; readonly z: number },
  to: { readonly x: number; readonly z: number },
  tolerance: number,
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 1e-12) return false;
  const along = ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSq;
  if (along < -1e-9 || along > 1 + 1e-9) return false;
  const length = Math.sqrt(lengthSq);
  return Math.abs((point.x - from.x) * dz - (point.z - from.z) * dx) / length <= tolerance;
}

/**
 * The edge a segment runs *along* when no edge runs exactly between its two
 * endpoints.
 *
 * A boolean that preserves a structural corner hands back a vertex partway
 * along an edge, and that vertex can name a node -- one a neighbouring face
 * already owns there. {@link dropInventedCorners} cannot help then: it only
 * removes corners naming no node, and this one is real and must stay, because
 * the edge it sits on is exactly what a landing there needs to split.
 *
 * So the segment names the edge that contains it instead of the edge between
 * its own endpoints. Found through the edges meeting the segment's own start
 * node, so a node's handful of edges is all that is ever examined.
 */
function edgeAlongSegment(
  spansAtNode: ReadonlyMap<number, readonly { readonly edge: ConstructionRegionEdge; readonly from: ConstructionGridConstraintPoint; readonly to: ConstructionGridConstraintPoint }[]>,
  cur: ConstructionGridConstraintPoint,
  next: ConstructionGridConstraintPoint,
  tolerance: number,
): ConstructionRegionEdge | undefined {
  for (const node of [cur.source, next.source]) {
    if (node === undefined) continue;
    for (const span of spansAtNode.get(node) ?? []) {
      if (onSpan(cur, span.from, span.to, tolerance) && onSpan(next, span.from, span.to, tolerance)) return span.edge;
    }
  }
  return undefined;
}

/**
 * Putting back the standing nodes a straight run of the boolean's output
 * walked past.
 *
 * A node partway along a straight side adds no shape, so the boolean may hand
 * the side back without it. The engine re-inserts input points it finds on an
 * output segment, but it does so in `f32` against a fixed `1e-5`, and a point
 * the overlay snapped even slightly misses that -- which is why it happens in
 * some places and not others.
 *
 * Missing, it is a T-junction: the ground walks from one neighbour straight to
 * the other past a node the standing side still has. Flat, the two coincide
 * and nothing shows. Where that node is not at the height of the line between
 * its neighbours -- ground in a depression, on a slope -- the seam opens.
 *
 * Only a node genuinely *on* the segment, strictly between its ends, and not
 * already in this ring comes back.
 */
function restoreSkippedNodes(
  points: readonly ConstructionGridConstraintPoint[],
  candidateAt: ReadonlyMap<number, { readonly x: number; readonly z: number }>,
  buckets: ReadonlyMap<string, readonly number[]>,
  cell: number,
  tolerance: number,
): readonly ConstructionGridConstraintPoint[] {
  const inRing = new Set<number>();
  for (const point of points) if (point.source !== undefined) inRing.add(point.source);

  const result: ConstructionGridConstraintPoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const from = points[index]!;
    const to = points[(index + 1) % points.length]!;
    result.push(from);

    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq <= 1e-12) continue;
    const length = Math.sqrt(lengthSq);

    const found: { readonly along: number; readonly source: number }[] = [];
    const minColumn = Math.floor((Math.min(from.x, to.x) - tolerance) / cell);
    const maxColumn = Math.floor((Math.max(from.x, to.x) + tolerance) / cell);
    const minRow = Math.floor((Math.min(from.z, to.z) - tolerance) / cell);
    const maxRow = Math.floor((Math.max(from.z, to.z) + tolerance) / cell);
    for (let column = minColumn; column <= maxColumn; column += 1) {
      for (let row = minRow; row <= maxRow; row += 1) {
        for (const source of buckets.get(`${column}:${row}`) ?? []) {
          if (inRing.has(source)) continue;
          const at = candidateAt.get(source)!;
          const along = ((at.x - from.x) * dx + (at.z - from.z) * dz) / lengthSq;
          if (along * length <= tolerance || (1 - along) * length <= tolerance) continue;
          if (Math.abs((at.x - from.x) * dz - (at.z - from.z) * dx) / length > tolerance) continue;
          found.push({ along, source });
        }
      }
    }
    found.sort((a, b) => a.along - b.along);
    for (const { source } of found) {
      if (inRing.has(source)) continue;
      inRing.add(source);
      const at = candidateAt.get(source)!;
      result.push({ x: at.x, z: at.z, source });
    }
  }
  return result;
}

/** Twice the signed area of `p`, `q`, `r` in plan. */
function turn(p: { readonly x: number; readonly z: number }, q: { readonly x: number; readonly z: number }, r: { readonly x: number; readonly z: number }): number {
  return (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
}

/** The first pair of segments of `points` that properly cross, as the indices of their starts. */
function firstCrossing(points: readonly ConstructionGridConstraintPoint[]): readonly [number, number] | undefined {
  const count = points.length;
  const strictly = (value: number) => (value > 1e-12 ? 1 : value < -1e-12 ? -1 : 0);
  for (let i = 0; i < count; i += 1) {
    const a = points[i]!, b = points[(i + 1) % count]!;
    for (let j = i + 2; j < count; j += 1) {
      if (i === 0 && j === count - 1) continue;
      const c = points[j]!, d = points[(j + 1) % count]!;
      const d1 = strictly(turn(c, d, a)), d2 = strictly(turn(c, d, b)), d3 = strictly(turn(a, b, c)), d4 = strictly(turn(a, b, d));
      if (d1 * d2 < 0 && d3 * d4 < 0) return [i, j];
    }
  }
  return undefined;
}

/**
 * A ring that crosses itself, made sound by dropping the corners that cross
 * it -- each time the one whose loss changes the shape least.
 *
 * Snapping and restoring corners onto standing nodes can do this: a node a
 * centimetre inside a structure's side, left there by an earlier repair, is
 * walked to and back from, and the walk folds over the side. The generator
 * refuses a crossed ring outright, so the whole repair was lost and the ground
 * stayed under the structure. A dropped corner costs at most one seam met at a
 * coincident position instead of at a shared node.
 */
function untangled(points: readonly ConstructionGridConstraintPoint[]): readonly ConstructionGridConstraintPoint[] {
  let ring = [...points];
  for (let guard = points.length; guard > 0 && ring.length > 3; guard -= 1) {
    const crossing = firstCrossing(ring);
    if (crossing === undefined) return ring;
    const [i, j] = crossing;
    const count = ring.length;
    const candidates = [i, (i + 1) % count, j, (j + 1) % count];
    let best: { index: number; loss: number } | undefined;
    for (const index of candidates) {
      const loss = Math.abs(turn(ring[(index - 1 + count) % count]!, ring[index]!, ring[(index + 1) % count]!));
      if (best === undefined || loss < best.loss) best = { index, loss };
    }
    ring = ring.filter((_, index) => index !== best!.index);
  }
  return firstCrossing(ring) === undefined ? ring : [];
}

function dropInventedCorners(
  points: readonly ConstructionGridConstraintPoint[],
  hasEdge: (a: number, b: number) => boolean,
  tolerance: number,
): readonly ConstructionGridConstraintPoint[] {
  const total = points.length;
  const named: number[] = [];
  for (let index = 0; index < total; index += 1) {
    if (points[index]!.source !== undefined) named.push(index);
  }
  if (named.length < 2) return points;

  const keep = new Array<boolean>(total).fill(true);
  for (let step = 0; step < named.length; step += 1) {
    const from = named[step]!;
    const to = named[(step + 1) % named.length]!;
    const between: number[] = [];
    for (let index = (from + 1) % total; index !== to; index = (index + 1) % total) between.push(index);
    if (between.length === 0) continue;

    const a = points[from]!;
    const b = points[to]!;
    if (a.source === undefined || b.source === undefined || !hasEdge(a.source, b.source)) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length <= 1e-9) continue;

    let allOnTheEdge = true;
    for (const index of between) {
      const point = points[index]!;
      const along = ((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length);
      const off = Math.abs((point.x - a.x) * dz - (point.z - a.z) * dx) / length;
      if (along <= 0 || along >= 1 || off > tolerance) {
        allOnTheEdge = false;
        break;
      }
    }
    if (!allOnTheEdge) continue;
    for (const index of between) keep[index] = false;
  }

  const kept = points.filter((_, index) => keep[index]);
  return kept.length >= 3 ? kept : points;
}

/**
 * Giving the boolean's output its identity back.
 *
 * The boolean answers in bare floats: a corner that was a node going in
 * comes out as a pair of numbers with nothing attached. So every corner of the
 * result is matched against the corners that *did* carry a node -- the retained
 * terrain's rim and the painter's contour -- and takes that node's id.
 *
 * **This is the one place a position is matched back to a node, and it is here
 * under protest.** `terrain-constraints.ts` states the invariant it breaks. It
 * survives because the alternative is threading identity through a third-party
 * boolean that has no room for it; what it must not do is *guess badly*, and
 * three things it used to do were guesses:
 *
 * 1. **Two corners could take the same node.** Nothing checked. The engine's
 *    answer to that is not a duplicate but a collapse -- two distinct mesh
 *    edges become one, two faces walk it the same way, and the second is
 *    refused ("no room on edge"), or the cell is dropped outright for naming
 *    one node twice. Every road junction puts more nodes within snapping
 *    distance of each other, so this went from rare to routine as the network
 *    grew. Each node is now claimed at most once.
 * 2. **First come, first served.** Corners were matched in ring order, so a
 *    corner a third of a face away could take a node before the corner sitting
 *    exactly on it was ever considered. Matching is now global and ordered by
 *    distance: the true coincidence always wins, whatever order it is in.
 * 3. **Welding ran first and threw corners away before they could be
 *    matched.** A corner dropped for being close to its neighbour took its
 *    identity with it. Welding now runs last and never drops a corner that
 *    names a node.
 *
 * The search is bucketed rather than exhaustive, which is why the whole thing
 * stays linear as the road network grows instead of squaring with it.
 */
export function buildConstraintRings(
  targetPolygon: PlanarArea,
  faceSize: number,
  perimeters: ConstraintTable,
  /**
   * Whether a corner lies on a structure's side -- where the ground meets it,
   * a place a cut gave way partway along it. Such a corner is exactly where
   * the ground must meet that side, so it takes a node only standing right
   * there, never one snapped to from beside it.
   */
  pinned: (point: { readonly x: number; readonly z: number }) => boolean = () => false,
): readonly (ConstraintRing & { readonly isHole: boolean })[] {
  const snapDist = Math.max(0.25, faceSize * 0.18);

  // One position per node, and a bucket index over them. A node appearing in
  // two rings is one candidate, not two.
  const candidateAt = new Map<number, { readonly x: number; readonly z: number }>();
  for (const ring of perimeters.rings) {
    for (const point of ring.points) {
      if (point.source !== undefined && !candidateAt.has(point.source)) {
        candidateAt.set(point.source, { x: point.x, z: point.z });
      }
    }
  }
  const cell = Math.max(snapDist, 1e-6);
  const buckets = new Map<string, number[]>();
  for (const [source, position] of candidateAt) {
    const key = `${Math.floor(position.x / cell)}:${Math.floor(position.z / cell)}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [source]);
    else bucket.push(source);
  }

  // The edge standing between two nodes, looked up once rather than searched
  // for per corner. A pair appearing in more than one ring is the same edge
  // seen from both sides, so the first answer is the answer.
  const edgeBetween = new Map<string, ConstructionRegionEdge>();
  /**
   * The same edges, reachable from either end and carrying the span they run
   * along, so a segment that is only *part* of an edge can still find it.
   *
   * Indexed by node rather than searched, and a node's degree is a handful, so
   * this stays linear in the network's size the way the pair lookup does.
   */
  const spansAtNode = new Map<number, { readonly edge: ConstructionRegionEdge; readonly from: ConstructionGridConstraintPoint; readonly to: ConstructionGridConstraintPoint }[]>();
  /** Where each standing node sits, so a pair can be tested against a span it may lie within. */
  const positionOfSource = new Map<number, ConstructionGridConstraintPoint>();
  for (const ring of perimeters.rings) {
    for (const point of ring.points) {
      if (point.source !== undefined && !positionOfSource.has(point.source)) positionOfSource.set(point.source, point);
    }
  }
  for (const ring of perimeters.rings) {
    for (let index = 0; index < ring.points.length; index += 1) {
      const fromPoint = ring.points[index]!;
      const toPoint = ring.points[(index + 1) % ring.points.length]!;
      const from = fromPoint.source;
      const to = toPoint.source;
      const edge = ring.edges[index];
      // A side with only one end the ground may take -- a structure's side
      // running from where it rests out to where it stands clear -- is still
      // a side a corner partway along it can split.
      if (edge === undefined || (from === undefined && to === undefined)) continue;
      if (from !== undefined && to !== undefined) {
        const key = pairKey(from, to);
        if (!edgeBetween.has(key)) edgeBetween.set(key, edge);
      }
      const span = { edge, from: fromPoint, to: toPoint };
      for (const node of [from, to]) {
        if (node === undefined) continue;
        const held = spansAtNode.get(node);
        if (held === undefined) spansAtNode.set(node, [span]);
        else held.push(span);
      }
    }
  }

  // Every ring of the result, before any identity or welding.
  const raw: { readonly isHole: boolean; readonly points: [number, number][] }[] = [];
  for (const polygon of targetPolygon) {
    for (let rIdx = 0; rIdx < polygon.length; rIdx += 1) {
      const rawRing = polygon[rIdx]!;
      const points = rawRing.slice(0, -1).map(([x, z]) => [x, z] as [number, number]);
      if (points.length >= 3) {
        let area = 0;
        for (let i = 0; i < points.length; i++) {
          const [x1, z1] = points[i]!;
          const [x2, z2] = points[(i + 1) % points.length]!;
          area += x1 * z2 - x2 * z1;
        }
        if (Math.abs(area * 0.5) >= 0.05) {
          raw.push({ isHole: rIdx > 0, points });
        }
      }
    }
  }

  // Every match anyone could make, then the closest ones first, each node and
  // each corner taken at most once.
  const proposals: { ring: number; point: number; source: number; distance: number }[] = [];
  for (let ring = 0; ring < raw.length; ring += 1) {
    const points = raw[ring]!.points;
    for (let point = 0; point < points.length; point += 1) {
      const [x, z] = points[point]!;
      const reach = pinned({ x, z }) ? 1e-3 : snapDist;
      const column = Math.floor(x / cell);
      const row = Math.floor(z / cell);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const source of buckets.get(`${column + dx}:${row + dz}`) ?? []) {
            const at = candidateAt.get(source)!;
            const distance = Math.hypot(x - at.x, z - at.z);
            if (distance < reach) proposals.push({ ring, point, source, distance });
          }
        }
      }
    }
  }
  proposals.sort((a, b) => a.distance - b.distance);

  const takenSourceInRing = new Set<string>();
  const takenPoint = new Set<string>();
  const matched = new Map<string, number>();
  for (const proposal of proposals) {
    const at = `${proposal.ring}:${proposal.point}`;
    const ringSource = `${proposal.ring}:${proposal.source}`;
    if (takenSourceInRing.has(ringSource) || takenPoint.has(at)) continue;
    takenSourceInRing.add(ringSource);
    takenPoint.add(at);
    matched.set(at, proposal.source);
  }

  const rings: (ConstraintRing & { readonly isHole: boolean })[] = [];
  for (let ring = 0; ring < raw.length; ring += 1) {
    const { isHole, points: rawPoints } = raw[ring]!;

    // Welded last, and never over a corner that names a node: the whole reason
    // to shorten a ring is that its segments are far below the face size, and
    // a corner the ground has to meet exactly is not that.
    const minStep = Math.max(0.18, faceSize * 0.1);
    const points: ConstructionGridConstraintPoint[] = [];
    for (let index = 0; index < rawPoints.length; index += 1) {
      const source = matched.get(`${ring}:${index}`);
      const at = source !== undefined ? candidateAt.get(source)! : { x: rawPoints[index]![0], z: rawPoints[index]![1] };
      const previous = points[points.length - 1];
      if (previous !== undefined) {
        const dist = Math.hypot(at.x - previous.x, at.z - previous.z);
        if (dist < minStep) {
          if (source !== undefined && previous.source === undefined) {
            points[points.length - 1] = { x: at.x, z: at.z, source };
            continue;
          }
          if (source === undefined) continue;
          if (source !== undefined && previous.source !== undefined && dist < 0.05 && !edgeBetween.has(pairKey(previous.source, source))) {
            continue;
          }
        }
      }
      points.push(source !== undefined ? { x: at.x, z: at.z, source } : { x: at.x, z: at.z });
    }
    while (points.length >= 3) {
      const last = points[points.length - 1]!;
      const first = points[0]!;
      if (last.source !== undefined) break;
      if (Math.hypot(last.x - first.x, last.z - first.z) >= minStep) break;
      points.pop();
    }
    if (points.length < 3) continue;

    const onEdgeTolerance = Math.max(1e-6, faceSize * 0.01);
    const restored = restoreSkippedNodes(points, candidateAt, buckets, cell, onEdgeTolerance);

    // Drop collinear unnamed points that add no shape
    let collinearCleaned = restored;
    if (restored.length > 3) {
      const cleaned: ConstructionGridConstraintPoint[] = [];
      for (let i = 0; i < restored.length; i++) {
        const prev = restored[(i - 1 + restored.length) % restored.length]!;
        const curr = restored[i]!;
        const next = restored[(i + 1) % restored.length]!;
        if (curr.source === undefined) {
          const dx = next.x - prev.x;
          const dz = next.z - prev.z;
          const len = Math.hypot(dx, dz);
          if (len > 1e-6) {
            const off = Math.abs((curr.x - prev.x) * dz - (curr.z - prev.z) * dx) / len;
            const along = ((curr.x - prev.x) * dx + (curr.z - prev.z) * dz) / (len * len);
            if (off < 0.08 && along > 0 && along < 1) {
              continue;
            }
          }
        }
        cleaned.push(curr);
      }
      if (cleaned.length >= 3) collinearCleaned = cleaned;
    }


    // Two nodes answer for a run between them when an edge joins them, and
    // equally when one edge simply *contains* them both -- a node partway
    // along another edge is still a place that edge can be split. Without the
    // second case the run stayed, and a segment with an unnamed point at each
    // end had nothing to look itself up by: the tooth this dropped to one.
    const joinedOrSpanned = (a: number, b: number): boolean => {
      if (edgeBetween.has(pairKey(a, b))) return true;
      const from = positionOfSource.get(a);
      const to = positionOfSource.get(b);
      return from !== undefined && to !== undefined &&
        edgeAlongSegment(spansAtNode, from, to, onEdgeTolerance) !== undefined;
    };
    const stitched = untangled(dropInventedCorners(collinearCleaned, joinedOrSpanned, onEdgeTolerance));
    if (stitched.length < 3) continue;

    const edges: (ConstructionRegionEdge | undefined)[] = [];
    for (let i = 0; i < stitched.length; i++) {
      const cur = stitched[i]!;
      const next = stitched[(i + 1) % stitched.length]!;
      const paired = cur.source !== undefined && next.source !== undefined
        ? edgeBetween.get(pairKey(cur.source, next.source))
        : undefined;
      edges.push(paired ?? edgeAlongSegment(spansAtNode, cur, next, onEdgeTolerance));
    }
    rings.push({ points: stitched, edges, isHole });
  }
  return rings;
}
