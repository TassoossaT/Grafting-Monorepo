import type {
  ConstructionCoveredRegion,
  ConstructionGridConstraintPoint,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";
import type {
  StructuralCutRequest,
  StructuralCutOutcome,
  StructuralCutArea,
} from "@/features/edit-construction";
import {
  calculateProfileDisplacement,
  calculateProfileHeight,
  distanceAndElevationOnPath,
} from "../../../features/edit-construction/index.ts";
import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";

import {
  constraintsFromRings,
  perimeterConstraints,
  type ConstraintRing,
  type ConstraintTable,
} from "./terrain-constraints.ts";
import { DEFAULT_FACE_SIDE, fillTerrain } from "./terrain-fill.ts";
import {
  heightFieldOf,
  terrainStandingAround,
  type TerrainCutRuntime,
  type TerrainStrokeBounds,
} from "./terrain-neighborhood.ts";
import { paintedFalloutOf, paintedTopologiesOf } from "../interference/painted-topologies.ts";

function centroidOf(nodes: readonly { readonly position: ConstructionPosition }[]): { x: number; y: number; z: number } {
  if (nodes.length === 0) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const n of nodes) {
    x += n.position.x;
    y += n.position.y;
    z += n.position.z;
  }
  return { x: x / nodes.length, y: y / nodes.length, z: z / nodes.length };
}

function insidePolygon(point: ConstructionPosition, polygon: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i++) {
    const [xi, zi] = polygon[i]!;
    const [xj, zj] = polygon[j]!;
    if (zi > point.z !== zj > point.z && point.x < ((xj - xi) * (point.z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function insideSwept(point: ConstructionPosition, swept: MultiPolygon): boolean {
  const inRing = (ring: readonly (readonly [number, number])[]): boolean => {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const [ax, az] = ring[index]!;
      const [bx, bz] = ring[previous]!;
      if (az > point.z !== bz > point.z && point.x < ((bx - ax) * (point.z - az)) / (bz - az) + ax) {
        inside = !inside;
      }
    }
    return inside;
  };
  for (const polygon of swept) {
    const outer = polygon[0];
    if (outer === undefined || !inRing(outer)) continue;
    if (polygon.slice(1).some((hole) => inRing(hole))) continue;
    return true;
  }
  return false;
}

function faceIntersectsArea(
  topology: ConstructionRegionTopology,
  area: StructuralCutArea,
  outline: readonly (readonly [number, number])[],
): boolean {
  if (area.sweptPolygon && area.sweptPolygon.length > 0) {
    for (const node of topology.nodes) {
      if (insideSwept(node.position, area.sweptPolygon)) return true;
    }
    return insideSwept(centroidOf(topology.nodes), area.sweptPolygon);
  }
  for (const node of topology.nodes) {
    if (insidePolygon(node.position, outline)) return true;
  }
  return insidePolygon(centroidOf(topology.nodes), outline);
}

/**
 * How many rings of neighbouring faces a regenerate may take in before it
 * gives up trying to find room, and the ceiling on what it may hold at once.
 *
 * Both are here to bound the cost, not to express a rule: the loop stops as
 * soon as the ground it is about to lay is wide enough to lay in, which on
 * ordinary ground is after one ring or none at all.
 */

/**
 * How much of a face has to fit across the ground being laid before it counts
 * as layable, as a fraction of the face size.
 *
 * Calibrated against what {@link widthOf} actually reports rather than against
 * intuition: it answers the strip's true width but only half the side of a
 * square, so asking for a whole face here would demand a region two faces
 * across and grow into ground nothing was wrong with. Three quarters is the
 * point where the corridor a road leaves behind -- about half a face wide --
 * asks for one ring of neighbours and, having got it, stops.
 */

/**
 * One face's boundary as `polygon-clipping` wants it: closed, in walk order.
 *
 * Walk order, not node order. A topology's `nodes` array is a set with an
 * order, not a ring; reading a polygon out of it produces a bowtie for any
 * face whose nodes were not stored in the order its boundary happens to visit
 * them. The oriented edges *are* the walk.
 */
function loopToRing(
  loop: readonly ConstructionRegionEdge[],
  positionOf: ReadonlyMap<ConstructionNodeId, { readonly x: number; readonly z: number }>,
): [number, number][] | undefined {
  const ring: [number, number][] = [];
  for (const edge of loop) {
    const position = positionOf.get(edge.startNodeId);
    if (position === undefined) return undefined;
    ring.push([position.x, position.z]);
  }
  if (ring.length < 3) return undefined;
  ring.push([ring[0]![0], ring[0]![1]]);
  return ring;
}

function loopToPolygon(
  loop: readonly ConstructionRegionEdge[],
  positionOf: ReadonlyMap<ConstructionNodeId, { readonly x: number; readonly z: number }>,
): Polygon {
  const ring = loopToRing(loop, positionOf);
  return ring ? [ring] : [];
}

function topologyToPolygonWithHoles(
  topology: ConstructionRegionTopology,
  positionOf: ReadonlyMap<ConstructionNodeId, { readonly x: number; readonly z: number }>,
): Polygon {
  if (topology.outerLoops.length === 0) return [];
  const outer = loopToRing(topology.outerLoops[0]!, positionOf);
  if (!outer) return [];
  const rings: [number, number][][] = [outer];
  for (const holeLoop of topology.holes) {
    const hole = loopToRing(holeLoop, positionOf);
    if (hole) rings.push(hole);
  }
  return rings;
}


/**
 * Roughly how wide a shape is, in the only sense that matters here: whether a
 * face of a given size fits inside it.
 *
 * `2 * area / perimeter` is the width of a long strip and half the side of a
 * square, so it under-reports a chunky shape and reports a seam honestly --
 * which is the direction to be wrong in when the question is "is this too
 * narrow to lay ground in".
 */
function pieceMetrics(piece: MultiPolygon[number]): { readonly area: number; readonly width: number } {
  let area = 0;
  let perimeter = 0;
  for (const ring of piece) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const [ax, az] = ring[index]!;
      const [bx, bz] = ring[index + 1]!;
      area += ax * bz - bx * az;
      perimeter += Math.hypot(bx - ax, bz - az);
    }
  }
  const absArea = Math.abs(area / 2);
  const width = perimeter > 1e-9 ? (2 * absArea) / perimeter : 0;
  return { area: absArea, width };
}


function topologyToPolygon(topology: ConstructionRegionTopology): Polygon {
  const positions = new Map<ConstructionNodeId, { x: number; z: number }>();
  for (const node of topology.nodes) positions.set(node.id, { x: node.position.x, z: node.position.z });

  // The face's own walk, when it has one. Falling back to node order is only
  // right for a face whose nodes happen to be stored in ring order, which a
  // quad from the generator is and a face the graph rebuilt need not be.
  const loop = topology.outerLoops[0];
  if (loop !== undefined && loop.length >= 3) {
    const walked = loopToPolygon(loop, positions);
    if (walked.length > 0) return walked;
  }

  const nodes = topology.nodes;
  if (nodes.length < 3) return [];
  const ring: [number, number][] = nodes.map((n) => [n.position.x, n.position.z]);
  ring.push([nodes[0]!.position.x, nodes[0]!.position.z]);
  return [ring];
}

/** Two nodes name one edge whichever way round they are given. */
function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Dropping corners the boolean invented in the middle of an edge that already
 * existed.
 *
 * Where the ground's own rim crosses the painter's contour, `polygon-clipping`
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
 * `polygon-clipping` answers in bare floats: a corner that was a node going in
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
  targetPolygon: MultiPolygon,
  faceSize: number,
  perimeters: ConstraintTable,
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
  for (const ring of perimeters.rings) {
    for (let index = 0; index < ring.points.length; index += 1) {
      const from = ring.points[index]!.source;
      const to = ring.points[(index + 1) % ring.points.length]!.source;
      const edge = ring.edges[index];
      if (from === undefined || to === undefined || edge === undefined) continue;
      const key = pairKey(from, to);
      if (!edgeBetween.has(key)) edgeBetween.set(key, edge);
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
      const column = Math.floor(x / cell);
      const row = Math.floor(z / cell);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const source of buckets.get(`${column + dx}:${row + dz}`) ?? []) {
            const at = candidateAt.get(source)!;
            const distance = Math.hypot(x - at.x, z - at.z);
            if (distance < snapDist) proposals.push({ ring, point, source, distance });
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

    // Drop collinear unnamed points that add no shape
    let collinearCleaned = points;
    if (points.length > 3) {
      const cleaned: ConstructionGridConstraintPoint[] = [];
      for (let i = 0; i < points.length; i++) {
        const prev = points[(i - 1 + points.length) % points.length]!;
        const curr = points[i]!;
        const next = points[(i + 1) % points.length]!;
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


    const stitched = dropInventedCorners(
      collinearCleaned,
      (a, b) => edgeBetween.has(pairKey(a, b)),
      Math.max(1e-6, faceSize * 0.01),
    );


    const edges: (ConstructionRegionEdge | undefined)[] = [];
    for (let i = 0; i < stitched.length; i++) {
      const cur = stitched[i]!;
      const next = stitched[(i + 1) % stitched.length]!;
      edges.push(
        cur.source !== undefined && next.source !== undefined
          ? edgeBetween.get(pairKey(cur.source, next.source))
          : undefined,
      );
    }
    rings.push({ points: stitched, edges, isHole });
  }
  return rings;
}

function boundsOfArea(area: StructuralCutArea): TerrainStrokeBounds {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  const update = (x: number, z: number) => {
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  };

  if (area.sweptPolygon) {
    for (const poly of area.sweptPolygon) {
      for (const ring of poly) {
        for (const [x, z] of ring) update(x, z);
      }
    }
  }
  if (area.outline) {
    for (const [x, z] of area.outline) update(x, z);
  }
  if (area.path) {
    const r = area.radius ?? 0;
    for (const p of area.path) {
      update(p.x - r, p.z - r);
      update(p.x + r, p.z + r);
    }
  }
  if (area.center) {
    const r = area.radius ?? 0;
    update(area.center.x - r, area.center.z - r);
    update(area.center.x + r, area.center.z + r);
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minZ = 0;
    maxX = 0;
    maxZ = 0;
  }
  return { minX, minZ, maxX, maxZ };
}

/**
 * Executes a generic structural cut / excavation / addition / hole operation on terrain.
 *
 * Follows the unified operational cycle:
 * 1. Find affected faces inside `request.area.outline` or `request.area.sweptPolygon`.
 * 2. If `profile.kind === "hole"`, directly removes the faces and leaves the boundary intact.
 * 3. For `concave`, `convex`, or `regenerate`, rebuilds the mesh within the boundary:
 *    - `concave`: calculates depression profile (excavating crater/cavity) along center point or path
 *    - `convex`: calculates elevation profile (depositing earth mound or mountain ridge) along center point or path
 *    - `regenerate`: fills seamlessly connecting to surrounding terrain and optional `connectTo` structure
 */
export function executeTerrainCut(
  runtime: TerrainCutRuntime,
  request: StructuralCutRequest,
): StructuralCutOutcome {
  const rawOutline = request.area.outline ?? request.area.sweptPolygon?.[0]?.[0] ?? [];
  const outline = rawOutline.length >= 3 ? rawOutline : [];

  const closedOutlineRing: [number, number][] = outline.map(([x, z]) => [x, z]);
  if (
    closedOutlineRing.length > 0 &&
    (closedOutlineRing[0]![0] !== closedOutlineRing[closedOutlineRing.length - 1]![0] ||
      closedOutlineRing[0]![1] !== closedOutlineRing[closedOutlineRing.length - 1]![1])
  ) {
    closedOutlineRing.push([closedOutlineRing[0]![0], closedOutlineRing[0]![1]]);
  }

  const outlineMultiPolygon: MultiPolygon =
    request.area.sweptPolygon && request.area.sweptPolygon.length > 0
      ? request.area.sweptPolygon
      : closedOutlineRing.length >= 4
        ? [[closedOutlineRing]]
        : [];

  if (outlineMultiPolygon.length === 0 && outline.length < 3) {
    return { builtFaces: 0, removedFaces: 0, refusedFaces: 0, success: false, message: "Área de corte inválida." };
  }

  let effectiveFaceSide = request.faceSide ?? DEFAULT_FACE_SIDE;
  const extent = boundsOfArea(request.area);

  // Ask runtime what surfaces are covered by outline / footprint
  const coveredOutline = outline.length >= 3 ? outline : outlineMultiPolygon[0]?.[0] ?? [];
  const covered: readonly ConstructionCoveredRegion[] =
    (request.coveredRegions as readonly ConstructionCoveredRegion[] | undefined) ??
    (coveredOutline.length >= 3 &&
    typeof (runtime as unknown as { getFootprintCoverage?: (outline: readonly (readonly [number, number])[]) => readonly ConstructionCoveredRegion[] }).getFootprintCoverage === "function"
      ? (runtime as unknown as { getFootprintCoverage: (outline: readonly (readonly [number, number])[]) => readonly ConstructionCoveredRegion[] }).getFootprintCoverage(coveredOutline)
      : []);

  // **The neighbourhood has to contain the ground being replaced.**
  //
  // The area names where the work is, and for a stroke that is the same place
  // as the ground it covers. For a repair it need not be: a path regenerates
  // its whole connected component, so the ground orphaned by one stroke can
  // stand a long way from that stroke's own footprint. A seeded topology query
  // drops any seed that does not reach the bounds it was given, so an extent
  // taken from the area alone would silently discard exactly the faces this
  // call exists to replace.
  const coveredExtent = { ...extent };
  for (const region of covered) {
    const topology =
      typeof runtime.getRegionTopology === "function"
        ? runtime.getRegionTopology(region.surfaceKey as ConstructionSurfaceKey)
        : undefined;
    for (const node of topology?.nodes ?? []) {
      coveredExtent.minX = Math.min(coveredExtent.minX, node.position.x);
      coveredExtent.minZ = Math.min(coveredExtent.minZ, node.position.z);
      coveredExtent.maxX = Math.max(coveredExtent.maxX, node.position.x);
      coveredExtent.maxZ = Math.max(coveredExtent.maxZ, node.position.z);
    }
  }
  if (request.vacatedArea) {
    for (const piece of request.vacatedArea) {
      for (const ring of piece) {
        for (const [x, z] of ring) {
          coveredExtent.minX = Math.min(coveredExtent.minX, x);
          coveredExtent.minZ = Math.min(coveredExtent.minZ, z);
          coveredExtent.maxX = Math.max(coveredExtent.maxX, x);
          coveredExtent.maxZ = Math.max(coveredExtent.maxZ, z);
        }
      }
    }
  }

  // A regenerate has to be able to absorb a ring or two of neighbours (see the
  // growth loop below), so it reaches further out than a stroke needs to.
  const standingReach =
    request.profile.kind === "regenerate" ? effectiveFaceSide * 5 : effectiveFaceSide * 2;
  const standing = terrainStandingAround(runtime, covered, coveredExtent, standingReach);

  const isTerrainMatch = (st: string, target: string): boolean => {
    if (st === target) return true;
    if (st.startsWith("terrain") && target.startsWith("terrain")) return true;
    return false;
  };

  const coveredKeys = new Set(covered.map((c) => c.surfaceKey.join(" ")));

  const terrainStanding = standing.filter((topology) =>
    isTerrainMatch(topology.surfaceType, request.targetSurfaceType),
  );
  let affected = terrainStanding.filter(
    (topology) =>
      coveredKeys.has(topology.surfaceKey.join(" ")) ||
      faceIntersectsArea(topology, request.area, coveredOutline),
  );
  let affectedKeys = new Set(affected.map((t) => t.surfaceKey.join(" ")));
  let retained = standing.filter((t) => !affectedKeys.has(t.surfaceKey.join(" ")));

  // Regeneration must not refine the terrain merely because the replacement
  // grid has a fixed nominal resolution. If the old repair area occupied N
  // faces, choose a face size whose coarse estimate cannot produce more than
  // N cells (with a small allowance for the new boundary). This keeps a
  // repeated cut from turning one large face into an ever-growing cascade of
  // smaller faces while still allowing a genuinely complex boundary to add
  // the few cells it needs.
  if (request.profile.kind === "regenerate" && affected.length > 0) {
    const area = Math.max(1, (coveredExtent.maxX - coveredExtent.minX) * (coveredExtent.maxZ - coveredExtent.minZ));
    const targetCells = Math.max(1, affected.length);
    const minimumSide = Math.sqrt(area / targetCells);
    effectiveFaceSide = Math.max(effectiveFaceSide, minimumSide);
  }

  // If hole profile: simply delete affected faces
  if (request.profile.kind === "hole") {
    if (affected.length === 0) {
      return { builtFaces: 0, removedFaces: 0, refusedFaces: 0, success: false, message: "Nada a furar aqui." };
    }
    let removed = 0;
    for (const f of affected) {
      try {
        runtime.applyRegionEdit([{ kind: "delete-region", surfaceKey: f.surfaceKey }], "local", request.causeId);
        removed++;
      } catch {}
    }
    return {
      builtFaces: 0,
      removedFaces: removed,
      refusedFaces: 0,
      success: removed > 0,
      message: `${removed} faces removidas (furo).`,
    };
  }

  // **The structure standing in this ground, when there is one -- a road.**
  //
  // Read before anything is decided about the shape, because what it occupies
  // is what makes the shape: the ground being laid is the affected faces
  // *minus* this, and how much ground has to be taken in for that remainder to
  // be layable depends on it.
  let connectArea: MultiPolygon = [];
  let connectLoops: readonly (readonly ConstructionRegionEdge[])[] = [];
  const connectPositions = new Map<ConstructionNodeId, { x: number; z: number }>();
  let connectSeeds: { readonly seed: readonly string[]; readonly surfaceType: string }[] = [];
  if (request.profile.kind === "regenerate" && request.profile.connectTo) {
    // Scoped to the work area. Unscoped, this reads every road on the table
    // and constrains a one-metre repair with the whole network's contour.
    const connectReach = Math.max(standingReach, DEFAULT_FACE_SIDE * 2);
    let connMinX = extent.minX;
    let connMaxX = extent.maxX;
    let connMinZ = extent.minZ;
    let connMaxZ = extent.maxZ;
    for (const f of affected) {
      for (const n of f.nodes) {
        if (n.position.x < connMinX) connMinX = n.position.x;
        if (n.position.x > connMaxX) connMaxX = n.position.x;
        if (n.position.z < connMinZ) connMinZ = n.position.z;
        if (n.position.z > connMaxZ) connMaxZ = n.position.z;
      }
    }
    if (request.vacatedArea) {
      for (const piece of request.vacatedArea) {
        for (const ring of piece) {
          for (const [x, z] of ring) {
            connMinX = Math.min(connMinX, x);
            connMinZ = Math.min(connMinZ, z);
            connMaxX = Math.max(connMaxX, x);
            connMaxZ = Math.max(connMaxZ, z);
          }
        }
      }
    }
    const connectTopologies = paintedTopologiesOf(
      runtime as unknown as Parameters<typeof paintedTopologiesOf>[0],
      request.profile.connectTo.surfaceType,
      {
        minX: connMinX - connectReach,
        minZ: connMinZ - connectReach,
        maxX: connMaxX + connectReach,
        maxZ: connMaxZ + connectReach,
      },
    );
    const { paintedNodes, paintedLoops } = paintedFalloutOf(connectTopologies);
    for (const n of paintedNodes) connectPositions.set(n.id, { x: n.position.x, z: n.position.z });

    // **The area it occupies is a union of its faces, never its perimeter
    // rings.** `outwardPerimeterRings` answers with every free-boundary ring
    // of the set undifferentiated -- the cloud's outer contour and any ring
    // around a gap *inside* it, with nothing saying which is which. Subtracting
    // each of those as a solid polygon carves the gaps out of the terrain too,
    // and a gap inside a road that also gets no ground is a hole in the road.
    // Unioning the faces themselves produces the same outline with its holes
    // correctly holes.
    const facePolygons = connectTopologies
      .map((topology) => topologyToPolygonWithHoles(topology, connectPositions))
      .filter((polygon) => polygon.length > 0);
    if (facePolygons.length > 0) {
      try {
        connectArea = polygonClipping.union(facePolygons[0]!, ...facePolygons.slice(1));
      } catch {
        connectArea = [];
      }
    }


    // The loops stay, separately, for identity: they are what the subtraction's
    // bare-float output is matched back against, so the ground comes back
    // meeting the road at its actual nodes and edges rather than at coincident
    // positions. They are numbered later, once, alongside the retained rim --
    // the generator answers with a single index per corner and knows nothing
    // of which ring it came from.
    connectLoops = paintedLoops;
    connectSeeds = connectTopologies.map((topology) => ({
      seed: topology.surfaceKey,
      surfaceType: topology.surfaceType,
    }));
  }

  /** The affected faces as one polygon, with `connectArea` taken out of it. */
  const groundFor = (faces: readonly ConstructionRegionTopology[]): MultiPolygon => {
    const polygons = faces.map(topologyToPolygon).filter((p) => p.length > 0);
    const allPolygons =
      request.vacatedArea && request.vacatedArea.length > 0
        ? [...polygons, ...request.vacatedArea]
        : polygons;
    if (allPolygons.length === 0) return [];
    let merged: MultiPolygon;
    try {
      merged = polygonClipping.union(allPolygons[0]!, ...allPolygons.slice(1));
    } catch {
      return [];
    }
    if (request.profile.kind === "convex") {
      try {
        merged = polygonClipping.union(merged, outlineMultiPolygon);
      } catch {
        // Keep the un-unioned shape rather than losing the stroke.
      }
    }
    if (connectArea.length === 0) return merged;
    try {
      return polygonClipping.difference(merged, connectArea);
    } catch {
      return merged;
    }
  };

  // Keep the repair scope geometric. Earlier versions absorbed neighbouring
  // terrain faces by shared node until the remainder was wide enough for the
  // generator. That topological growth escaped the actual road footprint and
  // made each subsequent repair consume a larger cloud, causing mesh growth.
  // Neighbours remain available below as boundary constraints only.
  let targetPolygon = groundFor(affected);

  // Do not discard pieces: discarding pieces deletes terrain without regenerating it,
  // creating holes and causing the terrain to recede from roads.

  if (targetPolygon.length === 0) {
    if (request.profile.kind === "convex" && affected.length === 0) {
      targetPolygon = outlineMultiPolygon;
    } else {
      return { builtFaces: 0, removedFaces: 0, refusedFaces: 0, success: false, message: "Nada a cortar aqui." };
    }
  }

  // One numbering across the retained rim and the connected structure, because
  // the generator answers with one `source` index per corner.
  const retainedPerimeters = perimeterConstraints(retained, 0);
  const connectTable = constraintsFromRings(
    connectLoops,
    (nodeId) => connectPositions.get(nodeId),
    retainedPerimeters.sources.length,
  );
  const perimeters: ConstraintTable = {
    rings: [...retainedPerimeters.rings, ...connectTable.rings],
    sources: [...retainedPerimeters.sources, ...connectTable.sources],
  };
  const extraHoleRings: ConstraintRing[] = [];

  const targetRings = buildConstraintRings(targetPolygon, effectiveFaceSide, perimeters);
  const boundaryRings = targetRings.filter((r) => !r.isHole && r.points.length >= 3);
  const holeRings = [...targetRings.filter((r) => r.isHole && r.points.length >= 3), ...extraHoleRings];

  if (boundaryRings.length === 0) {
    return { builtFaces: 0, removedFaces: 0, refusedFaces: 0, success: false, message: "Nenhum contorno válido gerado." };
  }

  const affectedNodes = affected.flatMap((t) => t.nodes);
  const center3D =
    request.area.center ??
    centroidOf(affectedNodes.length > 0 ? affectedNodes : coveredOutline.map(([x, z]) => ({ position: { x, y: 0, z } })));
  const center = { x: center3D.x, z: center3D.z };
  const extentRadius = Math.max((coveredExtent.maxX - coveredExtent.minX) / 2, (coveredExtent.maxZ - coveredExtent.minZ) / 2, effectiveFaceSide);
  const radius = request.area.radius ?? extentRadius;

  const standingNodes = standing.flatMap((topology) => topology.nodes.map((node) => node.position));
  const localReach = effectiveFaceSide * 2.0;
  const wideReach = Math.max(effectiveFaceSide * 3, radius);
  const localKept = heightFieldOf(standingNodes, localReach);
  const wideKept = heightFieldOf(standingNodes, wideReach);

  const strokePath = request.area.path;
  const centerOrPath = strokePath && strokePath.length > 0 ? strokePath : center;

  const sampleBase = (point: { readonly x: number; readonly z: number }): number => {
    let base = localKept.at(point);
    if (base === undefined) {
      base = wideKept.at(point);
    }
    if (base === undefined) {
      if (strokePath && strokePath.length > 0) {
        const { pathY } = distanceAndElevationOnPath(point.x, point.z, strokePath);
        base = pathY;
      }
      if (base === undefined) {
        base = center3D.y;
      }
      if (request.noiseAt) {
        base += request.noiseAt(point);
      }
    }
    return base;
  };

  // Determine ONE unified normal direction from the brush stroke center:
  // Uses a wide baseline (1.5x face side) to ignore micro-noise and capture the overall slope.
  const eps = Math.max(1.0, effectiveFaceSide * 1.5);
  const hXPlus = sampleBase({ x: center.x + eps, z: center.z });
  const hXMinus = sampleBase({ x: center.x - eps, z: center.z });
  const hZPlus = sampleBase({ x: center.x, z: center.z + eps });
  const hZMinus = sampleBase({ x: center.x, z: center.z - eps });

  const gx = (hXPlus - hXMinus) / (2 * eps);
  const gz = (hZPlus - hZMinus) / (2 * eps);
  const gradLen = Math.hypot(-gx, 1, -gz);
  const brushNormal: { readonly x: number; readonly y: number; readonly z: number } =
    gradLen > 1e-6 ? { x: -gx / gradLen, y: 1 / gradLen, z: -gz / gradLen } : { x: 0, y: 1, z: 0 };

  const heightAt = (point: { readonly x: number; readonly z: number }): number => {
    const base = sampleBase(point);
    return calculateProfileHeight(point, base, request.profile, centerOrPath, radius);
  };

  const positionAt = (point: { readonly x: number; readonly z: number }): ConstructionPosition => {
    const base = sampleBase(point);
    const disp = calculateProfileDisplacement(point, request.profile, centerOrPath, radius, brushNormal);
    return {
      x: point.x + disp.dx,
      y: base + disp.dy,
      z: point.z + disp.dz,
    };
  };

  const filled = fillTerrain(runtime, {
    what: request.profile.kind === "concave" ? "escavação" : request.profile.kind === "convex" ? "adição" : "regeneração",
    mint: `${request.tableId}:cut-${request.causeId}`,
    tableId: request.tableId,
    causeId: request.causeId,
    seed: request.seed ?? 1,
    faceSide: effectiveFaceSide,
    relaxStrength: request.irregularity ?? 0.7,
    surfaceType:
      affected.length > 0
        ? affected[0]!.surfaceType
        : (retained.length > 0 ? retained[0]!.surfaceType : request.targetSurfaceType),
    boundary: boundaryRings,
    holes: holeRings,
    sources: perimeters.sources,
    replaceSurfaceKeys: affected.length > 0 ? affected.map((f) => f.surfaceKey) : undefined,
    maxGeneratedFaces: request.profile.kind === "regenerate" && affected.length > 0 ? affected.length : undefined,
    // The road belongs here as much as the retained terrain does. These seeds
    // are what `fillTerrain` reads back to learn which edges already have a
    // face on them and which way that face walks; a road left out of them is a
    // road whose contour edges look free, and every cell laid along the bank
    // is refused for walking one the wrong way.
    topologySeeds: [
      ...retained.map((topology) => ({ seed: topology.surfaceKey, surfaceType: topology.surfaceType })),
      ...connectSeeds,
    ],
    avoidArea: connectArea,
    heightAt,
    positionAt,
  });


  return {
    builtFaces: filled.built,
    removedFaces: affected.length,
    refusedFaces: filled.refused,
    success: filled.built > 0,
    message: `${filled.built} faces geradas (${affected.length} substituídas).`,
  };
}
