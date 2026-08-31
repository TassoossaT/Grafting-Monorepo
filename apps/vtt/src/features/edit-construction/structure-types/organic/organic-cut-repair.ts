import polygonClipping from "polygon-clipping";
import type { MultiPolygon, Polygon, Ring } from "polygon-clipping";

import type {
  ConstructionEdgeId,
  ConstructionNodeId,
  ConstructionPatch,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import type { AtomicEditOp } from "../../orchestration/atomic-edit.ts";
import { createBoundaryEdges, sharedEdgeId } from "../../topology/boundary-edges.ts";
import type { CutFallout } from "../structure-type.ts";

/**
 * How close (world units, XZ) a fill vertex must sit to a node already on
 * the table before it reuses that node's id instead of minting a fresh one.
 *
 * Exact, deliberately -- the same tolerance, for the same reason, as
 * `contour-patch.ts`'s own `WELD_TOLERANCE`. This fill's own vertices are
 * *derived from* real geometry (the deleted area's own boundary, and the
 * painter's own contour), never invented independently of it, so a vertex
 * that should weld sits exactly where its counterpart already is -- there is
 * nothing to be generous about. An earlier version of this repair generated
 * an independent lattice and tried to weld it onto real geometry afterwards
 * by proximity; every tolerance it picked was either too tight to connect or
 * loose enough to connect the wrong things, because the two sides had no
 * reason to agree. Computing the fill *from* the real boundary removes the
 * disagreement rather than tuning it.
 */
const WELD_TOLERANCE = 1e-3;

/**
 * Below this area (world units squared) a shape is a sliver, not a face --
 * the same filter, for the same reason, as `contour-patch.ts`'s own
 * `MIN_SHAPE_AREA`: `polygon-clipping` normalises rather than refuses a
 * degenerate input, and a near-zero-area artifact at a crossing point is
 * still a structurally valid ring nothing downstream would catch.
 */
const MIN_SHAPE_AREA = 1e-4;

/**
 * Edge length of one cell the fill is cut into -- the same scale
 * `terrain-sculpt-tool.ts` builds fresh terrain at (`HEX_TRIANGLE_SIDE`).
 *
 * The difference itself is one polygon per piece of leftover ground, and
 * registering that verbatim gives one enormous face where the terrain around
 * it is a mesh of cells -- structurally valid, visibly not terrain. Clipping
 * that polygon against a grid at terrain's own scale gives cells back
 * without inventing any geometry: `polygon-clipping` keeps the fill's own
 * boundary vertices exactly where they were along the seam, and every
 * interior cut runs along a grid line two neighbouring cells both name, so
 * they share it rather than each minting their own.
 */
const FILL_CELL_SIZE = 2;

/**
 * How far apart two fill vertices may sit and still be the same node.
 *
 * Two cells clipped out of the same fill meet exactly on a grid line, so
 * their shared corners are the *same* coordinates -- but only to within what
 * `polygon-clipping`'s own arithmetic leaves behind. Quantising to this grid
 * before minting is what makes those two corners resolve to one id, which is
 * what makes the cells a mesh rather than a pile of separate faces.
 */
const POSITION_KEY_PRECISION = 1e6;

/** One real, already-live node this repair may weld a fill vertex onto. */
export interface CutRepairWeldCandidate {
  readonly id: ConstructionNodeId;
  readonly position: ConstructionPosition;
}

/** One real, already-live edge of the painter's own contour -- see `CutFallout.paintedEdges`'s own doc. */
export interface CutRepairPaintedEdge {
  readonly edgeId: ConstructionEdgeId;
  readonly startNodeId: ConstructionNodeId;
  readonly endNodeId: ConstructionNodeId;
}

function boundsOf(points: readonly ConstructionPosition[]): { readonly centerX: number; readonly centerZ: number; readonly radius: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return { centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2, radius: Math.max(maxX - minX, maxZ - minZ, 0) / 2 };
}

function signedRingArea(ring: Ring): number {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, z1] = ring[index]!;
    const [x2, z2] = ring[(index + 1) % ring.length]!;
    total += z1 * x2 - x1 * z2;
  }
  return total / 2;
}

/** Ensures an outer ring is wound with its normal facing up (+Y), a hole the other way -- `contour-patch.ts` does the same for the same renderer. */
function ensureUpwardWinding(ring: Ring, isHole: boolean): Ring {
  const area = signedRingArea(ring);
  const shouldReverse = isHole ? area > 0 : area < 0;
  return shouldReverse ? [...ring].reverse() : ring;
}

/** `polygon-clipping` repeats a ring's first point as its last (GeoJSON); a region boundary is a cycle of distinct nodes, so that duplicate is dropped once here. */
function openRing(ring: Ring): Ring {
  if (ring.length < 2) return ring;
  const [firstX, firstZ] = ring[0]!;
  const [lastX, lastZ] = ring[ring.length - 1]!;
  return Math.hypot(firstX - lastX, firstZ - lastZ) < 1e-9 ? ring.slice(0, -1) : ring;
}

/** The `y` of whichever candidate is nearest `(x, z)` -- a vertex the difference itself minted (a crossing point no original boundary vertex sits on) has no height of its own. */
function nearestHeight(x: number, z: number, candidates: readonly CutRepairWeldCandidate[]): number {
  let bestY = candidates[0]?.position.y ?? 0;
  let bestDistanceSq = Infinity;
  for (const candidate of candidates) {
    const dx = candidate.position.x - x;
    const dz = candidate.position.z - z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestY = candidate.position.y;
    }
  }
  return bestY;
}

/**
 * Walks `paintedEdges` into closed rings of the painter's own real contour.
 *
 * The painter's own area has to be subtracted from the deleted area to leave
 * the ground this repair is actually responsible for, and it has to be
 * subtracted *as the painter's own real nodes describe it* -- not as the
 * sampled outline its footprint query used. A ring built from the real nodes
 * puts every vertex of the resulting difference exactly on a real node's own
 * position wherever it follows the painter's side, which is what lets the
 * weld below be exact instead of approximate, and what makes the seam a
 * genuinely shared edge rather than two coincident ones.
 */
function paintedRings(
  paintedNodes: readonly CutRepairWeldCandidate[],
  paintedEdges: readonly CutRepairPaintedEdge[],
): readonly Ring[] {
  const positionOf = new Map(paintedNodes.map((node) => [node.id, node.position]));
  const neighbours = new Map<ConstructionNodeId, ConstructionNodeId[]>();
  for (const edge of paintedEdges) {
    if (!positionOf.has(edge.startNodeId) || !positionOf.has(edge.endNodeId)) continue;
    (neighbours.get(edge.startNodeId) ?? neighbours.set(edge.startNodeId, []).get(edge.startNodeId)!).push(edge.endNodeId);
    (neighbours.get(edge.endNodeId) ?? neighbours.set(edge.endNodeId, []).get(edge.endNodeId)!).push(edge.startNodeId);
  }

  const rings: Ring[] = [];
  const visited = new Set<ConstructionNodeId>();
  for (const start of neighbours.keys()) {
    if (visited.has(start)) continue;
    const walk: ConstructionNodeId[] = [];
    let current: ConstructionNodeId | undefined = start;
    let previous: ConstructionNodeId | undefined;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      walk.push(current);
      const next: ConstructionNodeId | undefined = (neighbours.get(current) ?? []).find(
        (candidate) => candidate !== previous && !visited.has(candidate),
      );
      previous = current;
      current = next;
    }
    if (walk.length < 3) continue;
    rings.push(walk.map((id) => {
      const position = positionOf.get(id)!;
      return [position.x, position.z] as [number, number];
    }));
  }
  return rings;
}

/**
 * Cuts `shapes` into cells at terrain's own scale -- see
 * {@link FILL_CELL_SIZE}'s own doc for why the fill is not registered as the
 * one big polygon the difference produces.
 *
 * Every cut runs along a grid line, so two neighbouring cells derive the
 * same coordinates for the corners they share; nothing here has to weld
 * them, they are already identical. The fill's own boundary is untouched by
 * this: a cell straddling it is clipped *to* it, keeping its vertices.
 */
function cellsOf(shapes: MultiPolygon): MultiPolygon {
  if (shapes.length === 0) return shapes;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const shape of shapes) {
    for (const ring of shape) {
      for (const [x, z] of ring) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
  }
  if (!Number.isFinite(minX)) return shapes;

  const firstX = Math.floor(minX / FILL_CELL_SIZE) * FILL_CELL_SIZE;
  const firstZ = Math.floor(minZ / FILL_CELL_SIZE) * FILL_CELL_SIZE;
  const cells: MultiPolygon = [];
  for (let x = firstX; x < maxX; x += FILL_CELL_SIZE) {
    for (let z = firstZ; z < maxZ; z += FILL_CELL_SIZE) {
      const cell: Polygon = [[
        [x, z],
        [x + FILL_CELL_SIZE, z],
        [x + FILL_CELL_SIZE, z + FILL_CELL_SIZE],
        [x, z + FILL_CELL_SIZE],
      ]];
      for (const piece of polygonClipping.intersection(shapes, cell)) cells.push(piece);
    }
  }
  return cells;
}

/**
 * Splits the painter's own edges wherever the fill's boundary lands on one
 * but no node stands there, and returns the real nodes that created.
 *
 * The grid cut above puts a vertex wherever a grid line crosses the fill's
 * boundary, and where that boundary follows the painter's own contour, the
 * crossing generally lands *along* one of its edges rather than on either
 * end of it. Registering that vertex as a fresh node would leave the fill
 * touching the painter's edge at a point the painter's own edge does not
 * have -- coincident, never connected, the exact thing this repair exists to
 * avoid. Splitting the edge there instead (`"insert-vertex"`, the same
 * primitive a wall crossing already uses) gives both sides one real node to
 * share.
 *
 * Sequenced per edge, nearest-to-start first: `insert-vertex` splits the one
 * edge it is given into two, so three or more splits along the same original
 * run consume the remainder each previous split left.
 */
function splitSeamEdgesAt(
  runtime: OrganicCutRepairRuntime,
  tableId: string,
  causeId: string,
  shapes: MultiPolygon,
  seamNodes: readonly CutRepairWeldCandidate[],
  seamEdges: readonly CutRepairPaintedEdge[],
): { readonly nodes: readonly CutRepairWeldCandidate[]; readonly fragments: readonly CutRepairPaintedEdge[]; readonly consumed: ReadonlySet<ConstructionEdgeId> } {
  const positionOf = new Map(seamNodes.map((node) => [node.id, node.position]));
  const runs = seamEdges
    .map((edge) => {
      const start = positionOf.get(edge.startNodeId);
      const end = positionOf.get(edge.endNodeId);
      return start !== undefined && end !== undefined ? { edge, start, end } : undefined;
    })
    .filter((run): run is { edge: CutRepairPaintedEdge; start: ConstructionPosition; end: ConstructionPosition } => run !== undefined);
  if (runs.length === 0) return { nodes: [], fragments: [], consumed: new Set() };

  const onNode = (x: number, z: number): boolean =>
    seamNodes.some((node) => Math.hypot(node.position.x - x, node.position.z - z) <= WELD_TOLERANCE);

  // Every distinct point the fill puts on a painted run, keyed per run.
  const wanted = new Map<ConstructionEdgeId, { readonly run: (typeof runs)[number]; readonly points: Map<string, { readonly t: number; readonly x: number; readonly z: number }> }>();
  for (const shape of shapes) {
    for (const ring of shape) {
      for (const [x, z] of ring) {
        if (onNode(x, z)) continue;
        for (const run of runs) {
          const dx = run.end.x - run.start.x;
          const dz = run.end.z - run.start.z;
          const lengthSq = dx * dx + dz * dz;
          if (lengthSq <= 1e-12) continue;
          const t = ((x - run.start.x) * dx + (z - run.start.z) * dz) / lengthSq;
          if (t <= 0 || t >= 1) continue;
          if (Math.hypot(run.start.x + dx * t - x, run.start.z + dz * t - z) > WELD_TOLERANCE) continue;
          const entry = wanted.get(run.edge.edgeId) ?? { run, points: new Map() };
          entry.points.set(`${Math.round(x * POSITION_KEY_PRECISION)}:${Math.round(z * POSITION_KEY_PRECISION)}`, { t, x, z });
          wanted.set(run.edge.edgeId, entry);
          break;
        }
      }
    }
  }

  const created: CutRepairWeldCandidate[] = [];
  // Each split replaces the edge it cut with two fragments, in that
  // original's own stored direction (`insert_vertex` keeps it for both).
  // The original id is gone once that happens, so the caller has to stop
  // prescribing it and prescribe these instead.
  const fragments: CutRepairPaintedEdge[] = [];
  const consumed = new Set<ConstructionEdgeId>();
  let failed = 0;
  for (const { run, points } of wanted.values()) {
    const ordered = [...points.values()].sort((left, right) => left.t - right.t);
    let currentEdgeId = run.edge.edgeId;
    let fromId = run.edge.startNodeId;
    for (const point of ordered) {
      const nodeId: ConstructionNodeId = `terrain-cut:${causeId}:seam-${created.length}`;
      const position: ConstructionPosition = {
        x: point.x,
        y: run.start.y + (run.end.y - run.start.y) * point.t,
        z: point.z,
      };
      const firstEdgeId = sharedEdgeId(tableId, fromId, nodeId);
      const secondEdgeId = sharedEdgeId(tableId, nodeId, run.edge.endNodeId);
      // Best-effort, never fatal. A seam edge named here can legitimately be
      // gone by now -- the cut deleted the regions that stood on it moments
      // ago, and the engine's own zero-orphan cleanup reclaims an edge
      // nothing references any more -- and `insert-vertex` on an id that no
      // longer resolves throws. That is one split not happening, which costs
      // this one vertex its shared node (it mints instead, exactly as it did
      // before splitting existed); it is never a reason to abandon the whole
      // repair and leave the hole empty.
      try {
        runtime.applyRegionEdit(
          [{ kind: "insert-vertex", edgeId: currentEdgeId, nodeId, position, firstEdgeId, secondEdgeId }],
          "local",
          causeId,
        );
      } catch {
        failed += 1;
        continue;
      }
      created.push({ id: nodeId, position });
      consumed.add(run.edge.edgeId);
      fragments.push({ edgeId: firstEdgeId, startNodeId: fromId, endNodeId: nodeId });
      currentEdgeId = secondEdgeId;
      fromId = nodeId;
    }
    // Whatever remains of this run, from its last new node to the original's
    // own end, is a fragment too -- never split again, and carrying the
    // original's own direction exactly as the earlier ones do.
    if (consumed.has(run.edge.edgeId)) {
      fragments.push({ edgeId: currentEdgeId, startNodeId: fromId, endNodeId: run.edge.endNodeId });
    }
  }
  if (failed > 0) {
    console.warn(`[terrain-cut-repair] seam splits refused ${JSON.stringify({ causeId, failed, created: created.length })}`);
  }
  return { nodes: created, fragments, consumed };
}

/** Every consumed region's own outer loop, as one polygon each -- unioned into the true outer boundary of everything this cut removed. */
function deletedAreaShapes(consumedRings: readonly (readonly ConstructionPosition[])[]): MultiPolygon {
  const polygons: Polygon[] = consumedRings
    .filter((ring) => ring.length >= 3)
    .map((ring) => [ring.map((point) => [point.x, point.z] as [number, number])]);
  if (polygons.length === 0) return [];
  const [first, ...rest] = polygons;
  return polygonClipping.union(first!, ...rest);
}

/** A point's own identity as a map key, quantised so two derivations of the same corner agree -- see {@link POSITION_KEY_PRECISION}. */
function positionKey(point: readonly [number, number] | ConstructionPosition): string {
  const [x, z] = Array.isArray(point) ? [point[0] as number, point[1] as number] : [(point as ConstructionPosition).x, (point as ConstructionPosition).z];
  return `${Math.round(x * POSITION_KEY_PRECISION)}:${Math.round(z * POSITION_KEY_PRECISION)}`;
}

/**
 * Turns the fill's own shapes into a `ConstructionPatch`, welding every
 * vertex that sits on a real node onto that node's own id.
 *
 * The same conversion `contour-patch.ts`'s own `buildContourPatch` performs
 * for the painter's side, with terrain's own edge-sharing rule
 * (`"refuse-when-full"`: a boundary with a face on both sides is interior
 * ground, and terrain is never created above anything) instead of the
 * painter's `"private-when-full"`.
 */
function buildFillPatch(
  tableId: string,
  causeId: string,
  surfaceType: string,
  physical: boolean,
  shapes: MultiPolygon,
  candidates: readonly CutRepairWeldCandidate[],
  seamOrientation: readonly CutRepairPaintedEdge[],
  fillDirection: readonly { readonly from: ConstructionPosition; readonly to: ConstructionPosition }[],
): ConstructionPatch | undefined {
  const edges = createBoundaryEdges(tableId, { kind: "refuse-when-full" });
  // Both walk directions of every seam edge, named by its own true stored
  // direction. Whichever way a ring ends up walking one, the id and the
  // `reversed` that go with it are already decided here -- never re-derived
  // from the ids' own lexicographic order, which a split fragment's real
  // storage has no reason to match.
  const prescribedUse = new Map<string, { readonly edgeId: ConstructionEdgeId; readonly reversed: boolean }>();
  for (const seam of seamOrientation) {
    prescribedUse.set(`${seam.startNodeId}>${seam.endNodeId}`, { edgeId: seam.edgeId, reversed: false });
    prescribedUse.set(`${seam.endNodeId}>${seam.startNodeId}`, { edgeId: seam.edgeId, reversed: true });
  }
  const nodePositions = new Map<ConstructionNodeId, ConstructionPosition>();
  const claimed = new Set<ConstructionNodeId>();

  const weldOrMint = (() => {
    let mintedCounter = 0;
    // Keyed by quantised position, not by call: two cells clipped out of the
    // same fill meet on a grid line, and the corner each of them derives
    // there is the same point. Minting per call would give that one point two
    // ids, and the two cells would sit against each other without sharing a
    // node -- the very "coincident, never connected" this repair exists to
    // avoid, reintroduced between its own faces. See POSITION_KEY_PRECISION.
    const mintedByPosition = new Map<string, ConstructionNodeId>();
    return (x: number, z: number): ConstructionNodeId => {
      let best: { readonly candidate: CutRepairWeldCandidate; readonly distance: number } | undefined;
      for (const candidate of candidates) {
        const distance = Math.hypot(candidate.position.x - x, candidate.position.z - z);
        if (distance > WELD_TOLERANCE) continue;
        if (best === undefined || distance < best.distance) best = { candidate, distance };
      }
      if (best !== undefined) {
        nodePositions.set(best.candidate.id, best.candidate.position);
        claimed.add(best.candidate.id);
        return best.candidate.id;
      }
      const key = `${Math.round(x * POSITION_KEY_PRECISION)}:${Math.round(z * POSITION_KEY_PRECISION)}`;
      const already = mintedByPosition.get(key);
      if (already !== undefined) return already;
      const id: ConstructionNodeId = `terrain-cut:${causeId}:v${mintedCounter}`;
      mintedCounter += 1;
      mintedByPosition.set(key, id);
      nodePositions.set(id, { x, y: nearestHeight(x, z, candidates), z });
      return id;
    };
  })();

  // Every real node sitting *on* the segment `a`-`b`, in order along it.
  //
  // `polygon-clipping` drops a vertex that is collinear with its own
  // neighbours, which is exactly what a straight run of the seam is: where
  // the consumed area's own perimeter crossed several terrain cells in a
  // line, the difference comes back with one long segment where the
  // surviving neighbour still has a node (and a face) at every cell corner
  // along it. Registering that long segment declares an edge from end to end
  // -- a different edge from the ones the neighbour walks, so the two meet
  // visually and share nothing, which is the fill coming out detached from
  // the terrain it was supposed to close onto. Putting those nodes back is
  // what makes the seam the neighbour's own edges again.
  const realNodesOnSegment = (a: readonly [number, number], b: readonly [number, number]): readonly CutRepairWeldCandidate[] => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq <= 1e-12) return [];
    const found: { readonly candidate: CutRepairWeldCandidate; readonly t: number }[] = [];
    for (const candidate of candidates) {
      const t = ((candidate.position.x - a[0]) * dx + (candidate.position.z - a[1]) * dz) / lengthSq;
      if (t <= 0 || t >= 1) continue;
      const distance = Math.hypot(a[0] + dx * t - candidate.position.x, a[1] + dz * t - candidate.position.z);
      if (distance > WELD_TOLERANCE) continue;
      found.push({ candidate, t });
    }
    return found.sort((left, right) => left.t - right.t).map((entry) => entry.candidate);
  };

  // Which way round the fill has to walk, decided by the rim rather than by
  // this fill's own idea of a normal.
  //
  // A shared edge is only registrable if the two faces on it walk it in
  // *opposite* directions; walking it the same way its existing neighbour
  // already does is what the engine refuses as no room. `getUnfilledLoops`
  // already hands back every free rim edge oriented for the face that would
  // fill it -- "registrable verbatim" -- so the rim states the answer and
  // this only has to agree with it. Normalising every ring to a fixed
  // winding instead (which an earlier version of this function did) is right
  // exactly half the time: where it disagreed, every cell touching the rim
  // was refused and only the interior landed, leaving the fill an island
  // with its whole seam missing.
  //
  // The vote is global, not per ring: neighbouring cells share edges with
  // each other too, and flipping one alone would put it at odds with its own
  // neighbours. Every ring here comes from one source shape with one
  // winding, so they flip together or not at all.
  const prescribedFrom = new Map<string, string>();
  for (const walk of fillDirection) {
    prescribedFrom.set(`${positionKey(walk.from)}>${positionKey(walk.to)}`, "agree");
    prescribedFrom.set(`${positionKey(walk.to)}>${positionKey(walk.from)}`, "disagree");
  }
  let agree = 0;
  let disagree = 0;
  for (const shape of shapes) {
    for (const [ringIndex, ring] of shape.entries()) {
      const walked = openRing(ensureUpwardWinding(ring, ringIndex > 0));
      for (const [index, point] of walked.entries()) {
        const next = walked[(index + 1) % walked.length]!;
        const verdict = prescribedFrom.get(`${positionKey(point)}>${positionKey(next)}`);
        if (verdict === "agree") agree += 1;
        if (verdict === "disagree") disagree += 1;
      }
    }
  }
  const flip = disagree > agree;

  const regions: ConstructionPatchRegion[] = [];
  // Collected from the rings themselves, not from `edges.all()`: a seam edge
  // is emitted verbatim from the prescription and never goes through
  // `edges`, so deriving the node list from declared edges alone would drop
  // exactly the rim and painter nodes this fill welded onto -- the ones that
  // make it one cloud with them.
  const walkedIds = new Set<ConstructionNodeId>();
  shapes.forEach((shape, shapeIndex) => {
    const [outerRing, ...holeRings] = shape;
    if (outerRing === undefined || Math.abs(signedRingArea(outerRing)) < MIN_SHAPE_AREA) return;

    const idsFor = (ring: Ring, isHole: boolean): readonly ConstructionNodeId[] => {
      const walked = openRing(ensureUpwardWinding(ring, isHole !== flip));
      const ids = walked.flatMap((point, index) => {
        const next = walked[(index + 1) % walked.length]!;
        return [
          weldOrMint(point[0], point[1]),
          // Anything real the clipper collapsed out of this segment, put back
          // -- see `realNodesOnSegment`'s own doc.
          ...realNodesOnSegment(point, next).map((candidate) => {
            nodePositions.set(candidate.id, candidate.position);
            claimed.add(candidate.id);
            return candidate.id;
          }),
        ];
      });
      // A ring that folded back onto the same node twice is not a face --
      // `polygon-clipping` can leave a ring that touches the same point
      // twice (a pinch), and putting real nodes back can land one on a
      // vertex the ring already walks. Dropping the repeat keeps the face --
      // discarding the whole ring over it would leave a hole in the fill for
      // what is, geometrically, one point mentioned twice.
      const deduped = ids.filter((id, index) => ids.indexOf(id) === index);
      return deduped;
    };

    // A seam edge is emitted exactly as the rim handed it over -- same edge
    // id, same `reversed` -- rather than derived again here. Deriving it
    // means guessing which way the neighbour is already walking it; the rim
    // already knows, and reusing its answer is what makes the two faces
    // share the edge instead of colliding on it.
    const useEdge = (from: ConstructionNodeId, to: ConstructionNodeId) =>
      prescribedUse.get(`${from}>${to}`) ?? edges.use(from, to);

    const outerIds = idsFor(outerRing, false);
    if (outerIds.length < 3) return;
    for (const id of outerIds) walkedIds.add(id);
    const boundary = outerIds.map((id, index) => useEdge(id, outerIds[(index + 1) % outerIds.length]!));
    const holes = holeRings
      .map((holeRing) => idsFor(holeRing, true))
      .filter((ids) => ids.length >= 3)
      .map((ids) => {
        for (const id of ids) walkedIds.add(id);
        return ids.map((id, index) => useEdge(id, ids[(index + 1) % ids.length]!));
      });

    regions.push({
      regionId: `terrain-cut:${causeId}:fill-${shapeIndex}`,
      boundary,
      ...(holes.length > 0 ? { holes } : {}),
      surfaceType,
      physical,
    });
  });

  if (regions.length === 0) return undefined;
  return {
    nodes: [...nodePositions].filter(([id]) => walkedIds.has(id)).map(([id, position]) => ({ id, position })),
    edges: edges.all(),
    regions,
  };
}

/**
 * The minimal runtime capability {@link repairOrganicCut} needs, declared
 * here rather than imported from `composition/tabletop/tabletop-runtime.ts`
 * -- this module depends on composition for nothing at all. `TabletopRuntime`
 * satisfies this structurally, with room to spare.
 */
export interface OrganicCutRepairRuntime {
  getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined;
  getUnfilledLoops(scope: readonly ConstructionNodeId[]): readonly {
    readonly nodeIds: readonly ConstructionNodeId[];
    readonly boundary: readonly { readonly edgeId: ConstructionEdgeId; readonly reversed: boolean }[];
  }[];
  getSnapshot(): {
    readonly tableId: string;
    readonly map: { readonly nodePositions: ReadonlyMap<ConstructionNodeId, { readonly position: ConstructionPosition }> };
  };
  applyRegionEdit(ops: readonly AtomicEditOp[], origin: "local", causeId: string): unknown;
  /**
   * `addPatch`, not `applyPatchReplacement`: this fill replaces nothing --
   * the consumed regions were already deleted, separately, above -- it only
   * adds the ground that was left over once the painter's own area is taken
   * out of what the cut removed. A region the engine still finds no room for
   * costs only itself, never the rest of the batch.
   */
  addPatch(patch: ConstructionPatch, origin: "local", causeId: string): { readonly createdSurfaceKeys: readonly unknown[]; readonly skippedRegionIds: readonly string[] };
}

/**
 * Terrain's own complete answer to `resolveCutRepair`'s `"regenerate"`.
 *
 * **What this is, in one line:** the ground this repair owes back is exactly
 * *what the cut removed, minus what the painter now occupies* -- a polygon
 * difference -- and the faces to register are that shape's own rings, welded
 * onto the real nodes their vertices already sit on.
 *
 * **Why it is computed rather than generated.** Every earlier version of
 * this repair generated fresh geometry of its own (a lattice from terrain's
 * own generator, sized to the hole) and then tried to reconcile it with the
 * real boundary afterwards -- pinning it during relax, welding it by
 * proximity, guarding against corners that welded onto real ids with no real
 * edge between them, demoting the ones that did, rejecting quads whose own
 * corners wandered past the boundary. Every one of those mechanisms existed
 * to paper over the same gap: geometry invented independently of the real
 * boundary has no reason to agree with it, and each tolerance that made one
 * case connect made another connect wrongly. Deriving the fill *from* the
 * real boundary removes the gap instead of tuning it -- a vertex that should
 * weld sits exactly on its counterpart, because it came from it.
 *
 * `polygon-clipping` and `earcut`-style ring handling are already how the
 * painter's own contour is built (`contour/contour-patch.ts`,
 * `contour/union-bands.ts`); this is the same shape of computation for the
 * covered type's own side of the same seam.
 *
 * **The steps:**
 * 1. Read every consumed region's own topology before deleting it -- the
 *    shape of what is being removed is a fact of the cut, knowable only
 *    while those regions still stand.
 * 2. Delete the consumed regions. Terrain's own call, not the painter's.
 * 3. `getUnfilledLoops`, scoped to what those regions stood on, reports
 *    whichever part of the rim survives as real, live nodes -- weld targets,
 *    together with the painter's own registered nodes.
 * 4. Subtract the painter's own real contour rings from the union of the
 *    consumed regions' own rings. What remains is the ground to give back.
 * 5. Register it, welding every vertex that sits on a real node onto it.
 */
export function repairOrganicCut(runtime: OrganicCutRepairRuntime, fallout: CutFallout, causeId: string): number {
  if (fallout.consumedSurfaceKeys.length === 0) return 0;

  const consumedTopologies = fallout.consumedSurfaceKeys
    .map((surfaceKey) => runtime.getRegionTopology(surfaceKey))
    .filter((topology): topology is ConstructionRegionTopology => topology !== undefined);
  if (consumedTopologies.length === 0) return 0;
  const surfaceType = consumedTopologies[0]!.surfaceType;
  const physical = consumedTopologies[0]!.physical;

  const preScope = new Set<ConstructionNodeId>();
  const consumedPositions = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const topology of consumedTopologies) {
    for (const node of topology.nodes) {
      preScope.add(node.id);
      consumedPositions.set(node.id, node.position);
    }
  }
  if (preScope.size === 0) return 0;

  // The shape of what is being removed, from what the cut consumed -- known
  // before any deletion happens, never from whatever boundary the deletion
  // happens to leave exposed afterwards.
  const consumedRings: ConstructionPosition[][] = [];
  for (const topology of consumedTopologies) {
    for (const loop of topology.outerLoops) {
      const ring = loop
        .map((edge) => consumedPositions.get(edge.startNodeId))
        .filter((position): position is ConstructionPosition => position !== undefined);
      if (ring.length >= 3) consumedRings.push(ring);
    }
  }
  if (consumedRings.length === 0) return 0;

  const failedDeletes: ConstructionSurfaceKey[] = [];
  for (const surfaceKey of fallout.consumedSurfaceKeys) {
    try {
      runtime.applyRegionEdit([{ kind: "delete-region", surfaceKey }], "local", causeId);
    } catch {
      failedDeletes.push(surfaceKey);
    }
  }

  const loops = runtime.getUnfilledLoops([...preScope]);
  const snapshot = runtime.getSnapshot();
  const liveRimCandidates: CutRepairWeldCandidate[] = [];
  // The rim's own edges, in their true stored direction -- `boundary` walks
  // each one already oriented for the face that would fill it, so the walk
  // order and `reversed` together name its real start and end. Needed for
  // the same reason the painter's edges are: a fill vertex can land along
  // one of them where no node stands, and that edge has to be split there
  // rather than met by a fresh node sitting on top of it.
  const rimEdges: CutRepairPaintedEdge[] = [];
  // The same walk, kept as the orientation the fill must use -- `boundary`
  // is already turned for the face that closes the gap, so walking
  // `nodeIds` in order *is* the direction this fill has to take. See
  // `buildFillPatch`'s own winding note for what goes wrong without it.
  const fillDirection: { readonly from: ConstructionPosition; readonly to: ConstructionPosition }[] = [];
  for (const loop of loops) {
    const ids = loop.nodeIds;
    for (let index = 0; index < ids.length; index += 1) {
      const from = ids[index]!;
      const to = ids[(index + 1) % ids.length]!;
      const use = loop.boundary[index];
      if (use === undefined || from === to) continue;
      const [startNodeId, endNodeId] = use.reversed ? [to, from] : [from, to];
      rimEdges.push({ edgeId: use.edgeId, startNodeId, endNodeId });
      const fromPosition = snapshot.map.nodePositions.get(from)?.position;
      const toPosition = snapshot.map.nodePositions.get(to)?.position;
      if (fromPosition !== undefined && toPosition !== undefined) {
        fillDirection.push({ from: fromPosition, to: toPosition });
      }
    }
    for (const nodeId of ids) {
      const position = snapshot.map.nodePositions.get(nodeId)?.position;
      if (position !== undefined) liveRimCandidates.push({ id: nodeId, position });
    }
  }

  const deleted = deletedAreaShapes(consumedRings);
  const painted = paintedRings(fallout.paintedNodes, fallout.paintedEdges);
  // Every geometry stage below is best-effort in the same way: a refusal
  // costs that stage its refinement and falls back to the coarser shape it
  // was given, never the whole repair. `polygon-clipping` is robust for
  // ordinary input but does throw on some degenerate rings, and a stroke
  // that produced one is not a reason to leave the hole empty -- filling it
  // as one face beats filling it not at all.
  let leftover: MultiPolygon = deleted;
  if (painted.length > 0) {
    try {
      leftover = polygonClipping.difference(deleted, ...painted.map((ring): Polygon => [ring]));
    } catch {
      console.warn(`[terrain-cut-repair] difference refused, filling the whole consumed area ${JSON.stringify({ causeId })}`);
    }
  }
  // Registered as cells at terrain's own scale, not as the one big polygon
  // the difference produces -- see FILL_CELL_SIZE's own doc.
  let fill: MultiPolygon = leftover;
  try {
    fill = cellsOf(leftover);
  } catch {
    console.warn(`[terrain-cut-repair] cell cut refused, filling as whole shapes ${JSON.stringify({ causeId })}`);
  }

  // Wherever the fill's own boundary lands along one of the painter's edges
  // rather than on one of its nodes, that edge is split there first, so the
  // seam has a real node for both sides to share -- see
  // `splitPaintedEdgesAt`'s own doc.
  const split = splitSeamEdgesAt(
    runtime,
    snapshot.tableId,
    causeId,
    fill,
    [...liveRimCandidates, ...fallout.paintedNodes],
    [...rimEdges, ...fallout.paintedEdges],
  );
  const seamNodes = split.nodes;
  const candidates: CutRepairWeldCandidate[] = [...liveRimCandidates, ...fallout.paintedNodes, ...seamNodes];
  // Every seam edge still standing, in its own true stored direction: the
  // rim's and the painter's originals, minus the ones the split above
  // replaced, plus the fragments it put in their place.
  const seamEdges = [
    ...[...rimEdges, ...fallout.paintedEdges].filter((edge) => !split.consumed.has(edge.edgeId)),
    ...split.fragments,
  ];
  const patch = buildFillPatch(snapshot.tableId, causeId, surfaceType, physical, fill, candidates, seamEdges, fillDirection);

  // TEMP DIAGNOSTIC -- remove once the live fill is confirmed. A single
  // string, not a (tag, object) pair: copying the console as plain text
  // collapses an object argument to the literal word "Object".
  console.warn(
    `[terrain-cut-repair] fill ${JSON.stringify({
      causeId,
      consumed: consumedTopologies.length,
      failedDeletes: failedDeletes.length,
      rimCandidates: liveRimCandidates.length,
      paintedNodes: fallout.paintedNodes.length,
      paintedRings: painted.length,
      seamNodes: seamNodes.length,
      seamOriented: fillDirection.length,
      deletedShapes: deleted.length,
      leftoverShapes: leftover.length,
      fillCells: fill.length,
      regions: patch?.regions.length ?? 0,
      nodes: patch?.nodes.length ?? 0,
      welded: patch?.nodes.filter((node) => !node.id.startsWith(`terrain-cut:${causeId}:`)).length ?? 0,
      bounds: patch === undefined ? undefined : boundsOf(patch.nodes.map((node) => node.position)),
    })}`,
  );

  if (patch === undefined) return 0;

  const outcome = runtime.addPatch(patch, "local", causeId);
  console.warn(
    `[terrain-cut-repair] addPatch outcome ${JSON.stringify({
      causeId,
      created: outcome.createdSurfaceKeys.length,
      skipped: outcome.skippedRegionIds.length,
      skippedIds: outcome.skippedRegionIds,
    })}`,
  );
  return outcome.createdSurfaceKeys.length;
}
