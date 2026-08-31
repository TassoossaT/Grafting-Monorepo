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
import {
  createRandom,
  ortho,
  pairTriangles,
  buildTriangleHex,
  relax,
  weld as weldQuadGrid,
  type QuadMesh,
  type Vec2,
} from "../../topology/irregular-grid.ts";
import type { CutFallout } from "../structure-type.ts";

/**
 * Edge length of one lattice cell -- the same scale `terrain-sculpt-tool.ts`
 * builds fresh terrain at (`HEX_TRIANGLE_SIDE`), so a cut's own repaired
 * patch reads as the same kind of ground as anything freshly painted, not a
 * visibly different texture stitched in.
 */
const LATTICE_TRIANGLE_SIDE = 2;

/**
 * How close (world units, XZ) one of the lattice's own *outer boundary*
 * vertices must land to a real candidate point -- the hole's own rim, or the
 * painter's own registered nodes -- before {@link buildCutRepairLattice}
 * pins it there for `relax` to hold exactly, rather than letting it settle
 * wherever the lattice's own square-fitting would otherwise put it.
 *
 * Generous relative to a lattice cell (measured ~0.6-1.3 world units at this
 * `triangleSide`): the *un-relaxed* boundary is still coarse, and a pin that
 * lands slightly off its true counterpart only nudges local shape a little
 * -- {@link MAX_EDGE_LENGTH} is the actual backstop against a bad match, not
 * this radius.
 */
const PIN_RADIUS = LATTICE_TRIANGLE_SIDE * 0.75;

/**
 * How close (world units, XZ) a lattice vertex's own *final*, post-relax
 * position must land to a real node before {@link planOrganicCutRepair}
 * reuses that node's id instead of minting one.
 *
 * Tight on purpose -- the same tolerance `contour-patch.ts`'s own
 * `WELD_TOLERANCE` uses for the same reason: once {@link buildCutRepairLattice}
 * has pinned a boundary vertex, its final position *is* the candidate's own
 * position, exactly, not merely nearby. A generous radius here is what used
 * to let an unrelated vertex from the *surrounding* standing terrain --
 * never pinned, just incidentally close -- get pulled into a quad it does
 * not actually border, producing a face that bridges across ground (a road
 * it should have stopped at) instead of filling the hole next to it.
 */
const WELD_RADIUS = 1e-3;

/**
 * The longest a fresh quad's own edge may be, measured from its *resolved*
 * (post-weld) corners, before the quad is dropped as malformed rather than
 * submitted.
 *
 * A backstop, not the primary defence ({@link PIN_RADIUS} guiding relax and
 * {@link WELD_RADIUS} being tight are that): even a well-pinned lattice can
 * mismatch on an oddly-shaped or very thin hole, and a quad whose corners
 * end up this far apart is not filling the hole any more, it is bridging
 * across it -- dropped rather than committed as a corrupt face.
 *
 * Sized from what a *legitimately* welded edge can actually reach, not a
 * round guess: an unwelded edge runs up to roughly `0.7 * LATTICE_TRIANGLE_SIDE`
 * (measured on this generator), and each of its two corners can
 * independently move up to {@link PIN_RADIUS} away from that -- in opposite
 * directions, in the worst real case. A flat `LATTICE_TRIANGLE_SIDE * 1.5`
 * cap here undercut that by nearly a full `PIN_RADIUS` and was rejecting
 * the very quads pinning had just welded *correctly*: once most of a hole's
 * boundary actually starts finding real candidates, most of its edges land
 * somewhere in that legitimately-stretched range, and a cap this tight threw
 * almost all of them away, leaving real holes in the ground instead of the
 * fill they should have been.
 */
const MAX_EDGE_LENGTH = LATTICE_TRIANGLE_SIDE * 0.7 + 2 * PIN_RADIUS;

/**
 * How far apart {@link densifyPaintedEdges} spaces the real anchor nodes it
 * mints along one of the painter's own edges.
 *
 * Tighter than {@link LATTICE_TRIANGLE_SIDE} on purpose, not equal to it. A
 * lattice cell's own edge measures roughly `0.6`-`1.3` at this triangle
 * side; anchors spaced a full cell apart are *farther apart than a single
 * quad edge can span*, so two adjacent corners of the same lattice quad
 * essentially never land on two consecutive anchors at once -- each welds
 * to its own anchor independently, with a minted, unconnected corner
 * between them, and the two faces touch at isolated points without ever
 * sharing a real edge. Halving the spacing puts multiple anchors within one
 * quad edge's own reach, which is what actually lets a shared node-id pair
 * (`sharedEdgeId` names an edge by its node pair alone) land on the *same*
 * edge the painter's own contour already declared there.
 */
const ANCHOR_SPACING = LATTICE_TRIANGLE_SIDE * 0.5;

/** One real, already-live node this repair may weld a fresh lattice vertex onto. */
export interface CutRepairWeldCandidate {
  readonly id: ConstructionNodeId;
  readonly position: ConstructionPosition;
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

/**
 * A deterministic 32-bit seed from `causeId` -- `buildIrregularQuadGrid`
 * needs a number, and two hosts repairing "the same" cut (replicated
 * authoritative state, same as `createRandom`'s own reasoning) must derive
 * the same seed from the same cause, never `Math.random`.
 */
function seedFromCauseId(causeId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < causeId.length; index += 1) {
    hash ^= causeId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

/** Ray-casting point-in-polygon, XZ plane. */
function insideRing(x: number, z: number, ring: readonly ConstructionPosition[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    const crosses = a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function insideHole(x: number, z: number, holeLoops: readonly (readonly ConstructionPosition[])[]): boolean {
  return holeLoops.some((ring) => insideRing(x, z, ring));
}

/** Signed twice-the-area cross product of `o->a` and `o->b`, XZ plane. */
function cross(o: ConstructionPosition, a: ConstructionPosition, b: ConstructionPosition): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

/** Whether segment `a1-a2` properly crosses segment `b1-b2` -- ignores merely touching or collinear cases, which never arise between a quad's own opposite edges unless it has already collapsed (caught separately by the duplicate-corner check). */
function segmentsCross(a1: ConstructionPosition, a2: ConstructionPosition, b1: ConstructionPosition, b2: ConstructionPosition): boolean {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  return (d1 > 0 !== d2 > 0) && (d3 > 0 !== d4 > 0);
}

/**
 * Whether `corners` (in cyclic order) forms a bowtie -- one pair of opposite
 * edges crossing -- rather than a simple quad. See {@link planOrganicCutRepair}'s
 * own doc for how each corner welding independently onto its own nearest
 * real candidate can produce exactly this.
 */
function quadCrossesItself(corners: readonly ConstructionPosition[]): boolean {
  return segmentsCross(corners[0]!, corners[1]!, corners[2]!, corners[3]!) || segmentsCross(corners[1]!, corners[2]!, corners[3]!, corners[0]!);
}

/** Whether any of `corners`' own consecutive edges exceeds {@link MAX_EDGE_LENGTH} -- the coarser backstop for a quad that stayed simple but still ended up implausibly stretched. */
function quadEdgeTooLong(corners: readonly ConstructionPosition[]): boolean {
  for (let position = 0; position < corners.length; position += 1) {
    const a = corners[position]!;
    const b = corners[(position + 1) % corners.length]!;
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    if (dx * dx + dz * dz > MAX_EDGE_LENGTH * MAX_EDGE_LENGTH) return true;
  }
  return false;
}

function nearestWithin(
  x: number,
  z: number,
  candidates: readonly CutRepairWeldCandidate[],
  exclude: ReadonlySet<ConstructionNodeId>,
  radius: number,
): CutRepairWeldCandidate | undefined {
  let best: CutRepairWeldCandidate | undefined;
  let bestDistanceSq = radius * radius;
  for (const candidate of candidates) {
    if (exclude.has(candidate.id)) continue;
    const dx = candidate.position.x - x;
    const dz = candidate.position.z - z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq <= bestDistanceSq) {
      best = candidate;
      bestDistanceSq = distanceSq;
    }
  }
  return best;
}

/** The `y` of whichever candidate is nearest `(x, z)` -- a freshly minted vertex has no height of its own, so it borrows whatever the closest real point on the rim or the painter's own contour already settled on. */
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

/** One real, already-live edge of the painter's own contour -- see `CutFallout.paintedEdges`'s own doc. */
export interface CutRepairPaintedEdge {
  readonly edgeId: ConstructionEdgeId;
  readonly startNodeId: ConstructionNodeId;
  readonly endNodeId: ConstructionNodeId;
}

/**
 * Splits every one of the painter's own edges that is both near this hole
 * and long enough to matter into real interior anchor nodes, spaced
 * {@link ANCHOR_SPACING} apart -- deliberately *tighter* than one lattice
 * cell, see that constant's own doc for why -- via the generic
 * `"insert-vertex"` op (`ConstructionSessionPort.insertVertex`'s own doc:
 * "subdivides one boundary edge, minting a new node on it" -- the same
 * primitive a wall crossing already uses, applied here to a straight or
 * gently-curved run rather than an intersection).
 *
 * **Why this exists at all.** A road is flattened to a handful of points
 * along a straight or gently curved stretch -- by design; redundant
 * collinear points would serve no purpose of the road's own. A hole
 * bordering ten or more meters of that stretch may see only two or three of
 * the painter's own nodes anywhere nearby, which starves
 * {@link buildCutRepairLattice}'s own pinning of anything to find along most
 * of that run: "close to the painter's edge" stayed merely close, never an
 * actual shared vertex. Subdividing the edge itself, not just reading its
 * existing nodes, is what turns the whole run into real anchor points.
 *
 * Mutates the live graph (through `runtime.applyRegionEdit`); returns the
 * freshly created nodes so the caller can fold them into its own weld
 * candidates immediately, in the same call.
 */
export function densifyPaintedEdges(
  runtime: OrganicCutRepairRuntime,
  tableId: string,
  causeId: string,
  holeShapeRings: readonly (readonly ConstructionPosition[])[],
  paintedNodes: readonly CutRepairWeldCandidate[],
  paintedEdges: readonly CutRepairPaintedEdge[],
): readonly CutRepairWeldCandidate[] {
  if (paintedEdges.length === 0) return [];
  const positionOf = new Map(paintedNodes.map((node) => [node.id, node.position]));
  const { centerX, centerZ, radius } = boundsOf(holeShapeRings.flat());
  const reach = radius + PIN_RADIUS;
  const nearHole = (position: ConstructionPosition): boolean =>
    Math.abs(position.x - centerX) <= reach && Math.abs(position.z - centerZ) <= reach;

  const created: CutRepairWeldCandidate[] = [];
  let mintedCounter = 0;

  for (const edge of paintedEdges) {
    const start = positionOf.get(edge.startNodeId);
    const end = positionOf.get(edge.endNodeId);
    if (start === undefined || end === undefined) continue;
    if (!nearHole(start) && !nearHole(end)) continue;

    const length = Math.hypot(end.x - start.x, end.z - start.z);
    const segments = Math.round(length / ANCHOR_SPACING);
    if (segments < 2) continue; // already short enough to weld onto its own endpoints

    let currentEdgeId = edge.edgeId;
    let fromId = edge.startNodeId;
    for (let index = 1; index < segments; index += 1) {
      const t = index / segments;
      const position: ConstructionPosition = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        z: start.z + (end.z - start.z) * t,
      };
      const nodeId: ConstructionNodeId = `terrain-cut:${causeId}:path-anchor:${mintedCounter}`;
      mintedCounter += 1;
      const firstEdgeId = sharedEdgeId(tableId, fromId, nodeId);
      const secondEdgeId = sharedEdgeId(tableId, nodeId, edge.endNodeId);
      runtime.applyRegionEdit(
        [{ kind: "insert-vertex", edgeId: currentEdgeId, nodeId, position, firstEdgeId, secondEdgeId }],
        "local",
        causeId,
      );
      created.push({ id: nodeId, position });
      currentEdgeId = secondEdgeId;
      fromId = nodeId;
    }
  }
  return created;
}

/** A fresh lattice sized and placed to cover every point `holeLoops` names -- terrain's own generator, seeded deterministically from the cause that needs it. */
export interface OrganicCutRepairLattice {
  readonly mesh: QuadMesh;
  readonly originX: number;
  readonly originZ: number;
}

/**
 * Sizes and generates the lattice a cut repair fills its hole from, its own
 * outer boundary pinned onto real geometry wherever one lands close enough --
 * the hole's own rim, or the painter's own contour.
 *
 * **Why pin instead of welding after the fact.** A plain `buildIrregularQuadGrid`
 * call relaxes its boundary toward *itself* (`pinBoundary`'s default) --
 * nothing pulls it toward the real rim it is meant to close, so its final
 * shape is wherever that independent lattice's own square-fitting happened
 * to land. Welding by proximity afterward against a hole tightly surrounded
 * by standing terrain on every side then has nothing reliable to go on: an
 * *interior* vertex, not just a boundary one, can land within the weld
 * radius of some unrelated real node from the surrounding mesh, producing a
 * quad that bridges across ground it was never meant to touch (this is what
 * `unknown analytic region` traced back to -- a submitted face naming four
 * real nodes that do not actually border each other). Pinning fixes the
 * *generation* itself: every boundary vertex that finds a real counterpart
 * is held exactly there through every relax pass (`RelaxOptions.pinnedTargets`),
 * so the lattice's own shape bends to close the hole, and the id-weld this
 * feeds into ({@link planOrganicCutRepair}) can then use a near-zero
 * tolerance ({@link WELD_RADIUS}) instead of gambling on proximity.
 *
 * **Every vertex is a pin candidate, not only the lattice's own topological
 * boundary.** A hole this fills is rarely round: a road cut is long and
 * narrow, and the lattice this generates is sized from its bounding circle
 * -- a hexagon wide enough to cover the whole span. For a thin hole, the
 * true seam (the hole's own rim, and the painter's own contour running down
 * the middle) cuts *through* that hexagon's interior, not along its outer
 * rim; restricting pins to `boundaryVertices` left every one of those seam
 * vertices unpinned and this repair fell back to a near-zero-tolerance
 * proximity match that essentially never fired. Checking every vertex costs
 * one more nearest-neighbour scan and is a no-op for a vertex genuinely deep
 * inside a large hole, where nothing real is ever close enough to matter.
 *
 * `holeShapeRings`' own bounding circle decides the radius -- generous by
 * one whole ring (`+ 1`) so the lattice's own boundary clears every point of
 * it with room to spare. Deliberately *not* sized from `candidates` too:
 * that list can include the painter's *whole* patch (a long road's every
 * node, not only the stretch next to this one hole), and sizing the lattice
 * from it would make one small cut generate an enormous lattice for a
 * stroke that merely happens to run nearby. `candidates` still narrows
 * which pins actually find a real counterpart -- it only does not decide
 * how big to build.
 */
export function buildCutRepairLattice(
  holeShapeRings: readonly (readonly ConstructionPosition[])[],
  candidates: readonly CutRepairWeldCandidate[],
  causeId: string,
): OrganicCutRepairLattice {
  const { centerX, centerZ, radius } = boundsOf(holeShapeRings.flat());
  const trianglesPerSide = Math.max(1, Math.ceil(radius / LATTICE_TRIANGLE_SIDE) + 1);

  const random = createRandom(seedFromCauseId(causeId));
  const triangles = buildTriangleHex({ trianglesPerSide, triangleSide: LATTICE_TRIANGLE_SIDE });
  const preRelax = weldQuadGrid(ortho(pairTriangles(triangles, random)));

  // `candidates` can include the painter's *whole* patch (a long road's
  // every node), so it is filtered to this hole's own neighbourhood before
  // pairing -- otherwise every one of a long road's thousand-odd contour
  // samples would be tested against every lattice vertex.
  const reach = radius + PIN_RADIUS;
  const nearby = (point: ConstructionPosition): boolean =>
    Math.abs(point.x - centerX) <= reach && Math.abs(point.z - centerZ) <= reach;
  const pinCandidates: CutRepairWeldCandidate[] = candidates.filter((candidate) => nearby(candidate.position));

  // A stable, distance-sorted greedy match, not "whichever vertex happens
  // to be resolved first claims the nearest candidate": two *different*
  // lattice vertices can both be nearest the very same real candidate
  // whenever the lattice is finer than that candidate's own spacing (a
  // sparse rim, or a coarsely-sampled contour), and index-order pinning let
  // the truly-closest vertex lose that candidate to a merely-nearby one
  // that happened to come first. Sorting every (vertex, candidate) pair
  // within reach by distance and assigning greedily gives each candidate to
  // its actual nearest vertex, and each vertex at most one candidate, before
  // any weaker pairing gets a chance to claim either. Without this, a
  // vertex that lost its candidate to a same-position duplicate had nothing
  // else within a near-zero final-weld tolerance to match and minted its
  // own id right where a real one already stood -- coincident, never
  // connected, the very failure mode real graph welding exists to avoid,
  // reintroduced one layer up.
  const pairs: { readonly vertexIndex: number; readonly candidate: CutRepairWeldCandidate; readonly distanceSq: number }[] = [];
  preRelax.vertices.forEach((local, vertexIndex) => {
    const x = centerX + local.x;
    const z = centerZ + local.y;
    for (const candidate of pinCandidates) {
      const dx = candidate.position.x - x;
      const dz = candidate.position.z - z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq <= PIN_RADIUS * PIN_RADIUS) pairs.push({ vertexIndex, candidate, distanceSq });
    }
  });
  pairs.sort((a, b) => a.distanceSq - b.distanceSq);

  const claimedVertices = new Set<number>();
  const claimedCandidates = new Set<ConstructionNodeId>();
  const pins = new Map<number, Vec2>();
  for (const pair of pairs) {
    if (claimedVertices.has(pair.vertexIndex) || claimedCandidates.has(pair.candidate.id)) continue;
    claimedVertices.add(pair.vertexIndex);
    claimedCandidates.add(pair.candidate.id);
    pins.set(pair.vertexIndex, { x: pair.candidate.position.x - centerX, y: pair.candidate.position.z - centerZ });
  }

  const mesh = relax(preRelax, { pinnedTargets: pins });
  return { mesh, originX: centerX, originZ: centerZ };
}

/** Every lattice quad's own world-space centroid, index-aligned with `lattice.mesh.quads` -- what a caller classifies in one batched `classifyPoints` call before {@link planOrganicCutRepair} decides which quads to keep. */
export function cutRepairQuadCentroids(lattice: OrganicCutRepairLattice): readonly (readonly [number, number])[] {
  return lattice.mesh.quads.map((quad) => {
    let x = 0;
    let z = 0;
    let count = 0;
    for (const vertexIndex of quad) {
      const local = lattice.mesh.vertices[vertexIndex];
      if (local === undefined) continue;
      x += lattice.originX + local.x;
      z += lattice.originZ + local.y;
      count += 1;
    }
    return count === 0 ? [Number.NaN, Number.NaN] : [x / count, z / count];
  });
}

export interface OrganicCutRepairPlanInput {
  readonly tableId: string;
  readonly causeId: string;
  readonly surfaceType: string;
  readonly physical: boolean;
  readonly lattice: OrganicCutRepairLattice;
  /**
   * The hole's own true shape, one ring per consumed region -- from what
   * the cut consumed, known before any deletion happened, not from
   * whatever boundary the deletion happens to leave exposed. Positions
   * only, deliberately: these ids belong to whichever regions were just
   * deleted and may no longer be live nodes at all (the engine's own
   * zero-orphan cleanup can reclaim one nothing else still references), so
   * this shape is never itself a weld source -- see `input.candidates` for
   * that.
   */
  readonly holeShapeRings: readonly (readonly ConstructionPosition[])[];
  /** Every real, live node this repair may weld a lattice vertex onto -- the hole's own surviving rim (only where a neighbour still stands) together with the painter's own real registered nodes. See `CutFallout`. */
  readonly candidates: readonly CutRepairWeldCandidate[];
  /** Lattice quad indices (into `lattice.mesh.quads`) whose centroid already lands on ground something else claims -- one batched `classifyPoints` call, resolved by the caller before this runs. */
  readonly occupiedQuads: ReadonlySet<number>;
}

/**
 * Organic's own repair *decision* for `resolveCutRepair`'s `"regenerate"`
 * answer -- no runtime, no engine call, only which quads of an
 * already-generated lattice survive and what patch they become. Kept
 * separate from {@link repairOrganicCut} (which builds the lattice and calls
 * the engine) so the weld-matching, hole-membership and quad-culling logic is
 * callable, and testable, with a hand-built lattice and plain data alone.
 *
 * **What this decides, in order, for every quad of `input.lattice.mesh`:**
 * 1. Drop it if `input.occupiedQuads` marked its centroid occupied -- ground
 *    something else (surviving terrain, or the painter's own new patch)
 *    already claims. This is what makes the repair stop exactly at the
 *    painter's own edge, generically: nothing here names a path, only
 *    "already occupied."
 * 2. Drop it if its centroid falls outside every ring in `input.holeShapeRings` --
 *    the lattice is sized generously and would otherwise spill new terrain
 *    onto open ground the cut never touched.
 * 3. Resolve each of its four corners to a real node id: the nearest
 *    candidate (hole rim, or a painted node) within {@link WELD_RADIUS}, or a
 *    freshly minted one. **A weld is the same node id, never a moved
 *    position** -- `ConstructionSessionPort.addPatch`'s own node handling
 *    already skips minting a node whose id already exists and reuses the
 *    live one instead (`region_editing.rs`, `apply_add_patch`), so a quad
 *    corner that names one of these ids becomes the *same* node, sharing a
 *    real edge with it. Two corners resolving to the same id makes the quad
 *    degenerate and it is dropped.
 *
 * Every surviving quad becomes one region of the same `surfaceType` (and
 * `physical`) the cut consumed. Returns `undefined` when nothing survives.
 */
export function planOrganicCutRepair(input: OrganicCutRepairPlanInput): ConstructionPatch | undefined {
  const candidates = input.candidates;
  const holeRings = input.holeShapeRings;
  const centroids = cutRepairQuadCentroids(input.lattice);

  const resolvedId: (ConstructionNodeId | undefined)[] = new Array(input.lattice.mesh.vertices.length).fill(undefined);
  const resolvedPosition: (ConstructionPosition | undefined)[] = new Array(input.lattice.mesh.vertices.length).fill(undefined);
  const claimedExternal = new Set<ConstructionNodeId>();
  let mintedCounter = 0;

  const resolveVertex = (vertexIndex: number): ConstructionNodeId | undefined => {
    const already = resolvedId[vertexIndex];
    if (already !== undefined) return already;
    const local = input.lattice.mesh.vertices[vertexIndex];
    if (local === undefined) return undefined;
    const x = input.lattice.originX + local.x;
    const z = input.lattice.originZ + local.y;

    const welded = nearestWithin(x, z, candidates, claimedExternal, WELD_RADIUS);
    if (welded !== undefined) {
      claimedExternal.add(welded.id);
      resolvedId[vertexIndex] = welded.id;
      resolvedPosition[vertexIndex] = welded.position;
      return welded.id;
    }
    const id: ConstructionNodeId = `terrain-cut:${input.causeId}:v${mintedCounter}`;
    mintedCounter += 1;
    resolvedId[vertexIndex] = id;
    resolvedPosition[vertexIndex] = { x, y: nearestHeight(x, z, candidates), z };
    return id;
  };

  const edges = createBoundaryEdges(input.tableId, { kind: "refuse-when-full" });
  const nodePositions = new Map<ConstructionNodeId, ConstructionPosition>();
  const regions: ConstructionPatchRegion[] = [];

  // TEMP DIAGNOSTIC -- remove once the live fill dropout is understood.
  // Tallies *why* an otherwise-inside-hole quad never made it into
  // `regions`, so a real session's own numbers say which check is actually
  // responsible instead of another guess.
  const rejected = { occupied: 0, outsideHole: 0, unresolvedOrDuplicate: 0, crossingOrTooLong: 0 };

  input.lattice.mesh.quads.forEach((quad, quadIndex) => {
    if (input.occupiedQuads.has(quadIndex)) {
      rejected.occupied += 1;
      return;
    }
    const centroid = centroids[quadIndex];
    const [cx, cz] = centroid ?? [Number.NaN, Number.NaN];
    if (!Number.isFinite(cx) || !insideHole(cx, cz, holeRings)) {
      rejected.outsideHole += 1;
      return;
    }

    const cycle = quad.map((vertexIndex) => resolveVertex(vertexIndex)).filter((id): id is ConstructionNodeId => id !== undefined);
    if (cycle.length !== quad.length || new Set(cycle).size !== cycle.length) {
      rejected.unresolvedOrDuplicate += 1;
      return;
    }

    const corners = quad.map((vertexIndex) => resolvedPosition[vertexIndex]);
    if (corners.some((corner) => corner === undefined)) {
      rejected.unresolvedOrDuplicate += 1;
      return;
    }
    const sane = corners as ConstructionPosition[];

    // Each corner pinned/welded independently onto its own *nearest* real
    // candidate -- correct for that one corner in isolation, but nothing
    // stops two DIFFERENT corners of the same quad from each latching onto
    // real geometry from two DIFFERENT, non-adjacent parts of an irregular
    // or densely-packed rim (two unrelated terrain-sculpt strokes bordering
    // the same hole, say). That produces a bowtie -- two opposite edges
    // crossing -- which is not a real quad and is what `unknown analytic
    // region` traced back to a second time. A crossing check catches this
    // regardless of *why* the mismatch happened; MAX_EDGE_LENGTH is the
    // cheaper, coarser backstop for a quad that stayed simple but still
    // ended up implausibly stretched.
    if (quadCrossesItself(sane) || quadEdgeTooLong(sane)) {
      rejected.crossingOrTooLong += 1;
      return;
    }

    const boundary = cycle.map((id, position) => edges.use(id, cycle[(position + 1) % cycle.length]!));
    quad.forEach((vertexIndex, position) => {
      const id = cycle[position];
      const resolved = resolvedPosition[vertexIndex];
      if (id !== undefined && resolved !== undefined) nodePositions.set(id, resolved);
    });
    regions.push({ regionId: cycle.join("|"), boundary, surfaceType: input.surfaceType, physical: input.physical });
  });

  console.warn(
    `[terrain-cut-repair] planOrganicCutRepair rejections ${JSON.stringify({
      causeId: input.causeId,
      totalQuads: input.lattice.mesh.quads.length,
      kept: regions.length,
      ...rejected,
    })}`,
  );

  if (regions.length === 0) return undefined;
  return { nodes: [...nodePositions].map(([id, position]) => ({ id, position })), edges: edges.all(), regions };
}

/**
 * The minimal runtime capability {@link repairOrganicCut} needs, declared
 * here rather than imported from `composition/tabletop/tabletop-runtime.ts`
 * -- this module depends on composition for nothing at all. `TabletopRuntime`
 * satisfies this structurally, with room to spare; nothing here names it,
 * so a future runtime with the same handful of methods works exactly as
 * well without this file changing at all.
 */
export interface OrganicCutRepairRuntime {
  getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined;
  getUnfilledLoops(scope: readonly ConstructionNodeId[]): readonly { readonly nodeIds: readonly ConstructionNodeId[] }[];
  getSnapshot(): {
    readonly tableId: string;
    readonly map: { readonly nodePositions: ReadonlyMap<ConstructionNodeId, { readonly position: ConstructionPosition }> };
  };
  /**
   * One batched occupancy check for every candidate lattice quad centroid at
   * once -- never one call per quad. `terrain-sculpt-tool.ts`'s own
   * `blockOccupiedQuads` already establishes why: the point of asking is
   * "which of these does *something else* already claim," a question the
   * engine answers once for the whole set exactly as cheaply as for one.
   */
  classifyPoints(points: readonly (readonly [number, number])[]): readonly { readonly index: number; readonly surfaceType: string }[];
  applyRegionEdit(ops: readonly AtomicEditOp[], origin: "local", causeId: string): unknown;
  /**
   * `addPatch`, not `applyPatchReplacement`, and deliberately so now.
   *
   * An earlier version of this fill used `applyPatchReplacement` for its
   * all-or-nothing guarantee -- load-bearing back when the fill was still
   * swapping *existing* survivors for rebuilt ones (a real "replacement"),
   * where a refused region partway through really could have left a
   * survivor half gone. This fill replaces nothing (`sourceSurfaceKeys` is
   * always empty -- the consumed regions were already deleted, separately,
   * above) -- it only *adds* brand new quads to a hole, the exact shape of
   * operation `terrain-sculpt-tool.ts`'s own `addPatch` call already
   * exists for. Two independently-generated boundary vertices of this
   * lattice can weld onto two real nodes that happen to already share an
   * edge somewhere else in the standing mesh (unrelated to this hole, and
   * already full there) -- {@link planOrganicCutRepair}'s own crossing and
   * edge-length guards do not catch this, since neither corner is
   * individually wrong and the two are not necessarily near each other on
   * screen. `applyPatchReplacement` would have thrown that one region's
   * refusal away as a reason to commit *nothing at all* from a batch that
   * can easily be ten-plus regions; `addPatch` keeps every region that
   * *did* find room and reports the rest in `skippedRegionIds`, which is
   * strictly the better outcome for a hole that only needs filling, not
   * replacing.
   */
  addPatch(patch: ConstructionPatch, origin: "local", causeId: string): { readonly createdSurfaceKeys: readonly unknown[]; readonly skippedRegionIds: readonly string[] };
}

/**
 * Terrain's own complete answer to `resolveCutRepair`'s `"regenerate"`:
 * fetches what it needs from the live table, decides its own repair
 * ({@link planOrganicCutRepair}), and performs it -- entirely inside the
 * organic type's own module, not a "decides" half here and an "acts" half
 * in `composition/`. The type manages this because it is the type's own
 * operation, the same way `terrain-restack.ts`'s `restackTerrain` is
 * terrain's own operation when terrain paints over terrain.
 *
 * Called from `composition/tabletop/tools/cut-repair-dispatch.ts`, the
 * runtime's own choke point for `CUT`'s repair half (`TabletopRuntime.applyPatchReplacement`)
 * -- that caller supplies the live runtime and the `CutFallout` a stroke's
 * own footprint resolved, and knows nothing past that about how terrain
 * repairs itself.
 *
 * **Not a corner-patch.** An earlier version of this repair kept every
 * surviving neighbour's own quads standing and surgically remapped one
 * corner of whichever ones touched the cut's rim onto the painter's nearest
 * node. Forcing one corner of an otherwise-untouched quad to jump to an
 * arbitrary, possibly distant position while its other three corners stay
 * fixed is what kept producing degenerate geometry and unexplained engine
 * refusals (`SurfaceError::UnknownRegion`) -- the wrong shape of operation,
 * not a bug within it. This version never touches a surviving quad at all:
 * it deletes exactly what the cut consumed, then **regenerates only that
 * hole** with a fresh lattice from terrain's own generator
 * (`buildIrregularQuadGrid`), welding the lattice's own boundary onto real
 * ids wherever it meets standing terrain or the painter's own contour, and
 * stopping wherever it meets ground the painter's own patch already covers.
 *
 * **The steps:**
 * 1. Read every consumed region's own topology before deleting it -- this
 *    is also where the hole's own true shape comes from (its outer loops'
 *    positions), a fact of the cut itself, not of whatever the deletion
 *    happens to leave exposed. Once gone, there is nothing left to ask.
 * 2. Delete the consumed regions. Terrain's own call, not the painter's.
 * 3. `getUnfilledLoops`, scoped to what those regions stood on, reports
 *    whichever part of the hole's rim survives as real, live nodes --
 *    optional, not required: empty means every side of this hole borders
 *    the painter's own contour instead of surviving terrain.
 * 4. {@link densifyPaintedEdges} subdivides the painter's own edges near
 *    this hole into real anchor nodes -- a long straight or gently curved
 *    run has almost no nodes of its own to weld onto otherwise.
 * 5. Build a fresh lattice sized to cover that hole ({@link buildCutRepairLattice}).
 * 6. One batched `classifyPoints` call over every lattice quad's centroid
 *    reports which already sit on ground something else claims (surviving
 *    terrain, or the painter's own new patch) -- terrain's fill has to stop
 *    exactly there, for any type that cuts it, not only a road.
 * 7. {@link planOrganicCutRepair} decides which quads survive and welds them.
 * 8. Register the surviving quads via `addPatch` -- a region the engine
 *    still finds no room for (see {@link OrganicCutRepairRuntime.addPatch}'s
 *    own doc) costs only itself, not the rest of the batch.
 */
export function repairOrganicCut(runtime: OrganicCutRepairRuntime, fallout: CutFallout, causeId: string): number {
  if (fallout.consumedSurfaceKeys.length === 0) return 0;

  const consumedTopologies = fallout.consumedSurfaceKeys
    .map((surfaceKey) => runtime.getRegionTopology(surfaceKey))
    .filter((topology): topology is ConstructionRegionTopology => topology !== undefined);
  // TEMP DIAGNOSTIC -- remove once the live weld/occupancy bug is found.
  // A single string, not a (tag, object) pair: copying the console as plain
  // text collapses an object argument to the literal word "Object".
  console.warn(
    `[terrain-cut-repair] entry ${JSON.stringify({
      causeId,
      consumedRequested: fallout.consumedSurfaceKeys.length,
      consumedResolved: consumedTopologies.length,
      paintedNodeCount: fallout.paintedNodes.length,
      paintedBounds: boundsOf(fallout.paintedNodes.map((n) => n.position)),
    })}`,
  );
  if (consumedTopologies.length === 0) return 0;
  const surfaceType = consumedTopologies[0]!.surfaceType;
  const physical = consumedTopologies[0]!.physical;

  const preScope = new Set<ConstructionNodeId>();
  for (const topology of consumedTopologies) for (const node of topology.nodes) preScope.add(node.id);
  if (preScope.size === 0) return 0;

  // The hole's own true shape -- from what the cut consumed, known before
  // any deletion happens, never from whatever `getUnfilledLoops` finds
  // exposed afterward. That query only ever reveals a boundary against
  // *surviving terrain*, because it walks this same type's own edges: a cut
  // that consumes every last cell in an area, leaving nothing but the
  // painter's own geometry (a different, unconnected node set) bordering it
  // on every side, exposes nothing there at all, and this repair used to
  // silently do nothing -- the cut itself, and the shape it leaves, is a
  // fact of the type interaction that already happened; it was never the
  // tool's, and it must not depend on a survivor happening to still stand
  // nearby.
  const consumedPositions = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const topology of consumedTopologies) for (const node of topology.nodes) consumedPositions.set(node.id, node.position);
  const holeShapeRings: ConstructionPosition[][] = [];
  for (const topology of consumedTopologies) {
    for (const loop of topology.outerLoops) {
      const ring = loop
        .map((edge) => consumedPositions.get(edge.startNodeId))
        .filter((position): position is ConstructionPosition => position !== undefined);
      if (ring.length >= 3) holeShapeRings.push(ring);
    }
  }
  if (holeShapeRings.length === 0) return 0;

  // One `applyRegionEdit` call *per region*, not one batched call naming
  // every consumed region at once. Each call is wrapped for the same reason
  // as before -- the runtime's own post-mutation step re-fetches a mesh for
  // every affected region to keep rendering in sync, and a region can
  // legitimately be reported "affected" by its own sibling's removal in the
  // same batch, throwing `unknown analytic region` for a region that was
  // never meant to survive this call anyway. What changed: a *batched* call
  // that threw for that reason silently left every region *after* the
  // throwing one still standing -- undeleted, not just unrendered -- which
  // then showed up later as "occupied" ground `classifyPoints` correctly
  // reported, starving the fill of most of its own hole. One call per
  // region means a throw only ever costs that one region's own delete, and
  // the loop below still tries every one of the rest.
  const failedDeletes: ConstructionSurfaceKey[] = [];
  for (const surfaceKey of fallout.consumedSurfaceKeys) {
    try {
      runtime.applyRegionEdit([{ kind: "delete-region", surfaceKey }], "local", causeId);
    } catch {
      failedDeletes.push(surfaceKey);
    }
  }
  // TEMP DIAGNOSTIC -- remove once the live occupied-quad dropout is confirmed fixed.
  const stillStanding = fallout.consumedSurfaceKeys.filter((surfaceKey) => runtime.getRegionTopology(surfaceKey) !== undefined);
  console.warn(
    `[terrain-cut-repair] delete ${JSON.stringify({
      causeId,
      requested: fallout.consumedSurfaceKeys.length,
      threw: failedDeletes.length,
      stillStanding: stillStanding.length,
    })}`,
  );

  // The hole's own surviving rim -- optional now, not required: real, live
  // node ids only where a neighbour still stands, exactly as before, but no
  // longer the thing that decides the hole's own shape or whether this
  // repair runs at all (see `holeShapeRings`'s own doc above). An empty
  // result here just means every side of this particular hole borders the
  // painter's own contour instead of surviving terrain, and the fill below
  // welds entirely to that.
  const loops = runtime.getUnfilledLoops([...preScope]);
  console.warn(
    `[terrain-cut-repair] getUnfilledLoops ${JSON.stringify({
      causeId,
      preScopeSize: preScope.size,
      loopCount: loops.length,
      loopSizes: loops.map((loop) => loop.nodeIds.length),
    })}`,
  );

  const snapshot = runtime.getSnapshot();
  const positionOf = (id: ConstructionNodeId): ConstructionPosition | undefined => snapshot.map.nodePositions.get(id)?.position;

  const liveRimCandidates: CutRepairWeldCandidate[] = [];
  for (const loop of loops) {
    for (const nodeId of loop.nodeIds) {
      const position = positionOf(nodeId);
      if (position !== undefined) liveRimCandidates.push({ id: nodeId, position });
    }
  }

  const anchorNodes = densifyPaintedEdges(runtime, snapshot.tableId, causeId, holeShapeRings, fallout.paintedNodes, fallout.paintedEdges);
  const paintedNodes = anchorNodes.length === 0 ? fallout.paintedNodes : [...fallout.paintedNodes, ...anchorNodes];
  console.warn(
    `[terrain-cut-repair] densifyPaintedEdges ${JSON.stringify({
      causeId,
      paintedEdgeCount: fallout.paintedEdges.length,
      anchorsCreated: anchorNodes.length,
    })}`,
  );

  const candidates: CutRepairWeldCandidate[] = [...liveRimCandidates, ...paintedNodes];

  const lattice = buildCutRepairLattice(holeShapeRings, candidates, causeId);
  const centroids = cutRepairQuadCentroids(lattice);
  const hits = runtime.classifyPoints(centroids);
  const occupiedQuads = new Set(hits.map((hit) => hit.index));
  // TEMP DIAGNOSTIC -- remove once the live "occupied inside the hole" source is confirmed.
  // Not just *how many* occupied quads land inside the hole, but *what*
  // classifyPoints says is already there -- the painter's own type
  // (legitimate, the fill correctly stops at it) versus something else
  // (terrain that should have been part of this same hole, or a stray
  // overlap left by an earlier, unrelated stroke).
  const occupiedInsideHoleBySurfaceType = new Map<string, number>();
  for (const hit of hits) {
    const centroid = centroids[hit.index];
    if (centroid === undefined) continue;
    const [cx, cz] = centroid;
    if (!insideHole(cx, cz, holeShapeRings)) continue;
    occupiedInsideHoleBySurfaceType.set(hit.surfaceType, (occupiedInsideHoleBySurfaceType.get(hit.surfaceType) ?? 0) + 1);
  }
  console.warn(
    `[terrain-cut-repair] lattice ${JSON.stringify({
      causeId,
      holeBounds: boundsOf(holeShapeRings.flat()),
      quadCount: lattice.mesh.quads.length,
      vertexCount: lattice.mesh.vertices.length,
      occupiedQuadCount: occupiedQuads.size,
      insideHoleQuadCount: centroids.filter(([x, z]) => insideHole(x, z, holeShapeRings)).length,
      occupiedInsideHoleBySurfaceType: Object.fromEntries(occupiedInsideHoleBySurfaceType),
      liveRimCandidateCount: liveRimCandidates.length,
    })}`,
  );

  const patch = planOrganicCutRepair({
    tableId: snapshot.tableId,
    causeId,
    surfaceType,
    physical,
    lattice,
    holeShapeRings,
    candidates,
    occupiedQuads,
  });

  if (patch !== undefined) {
    const rimIds = new Set(liveRimCandidates.map((p) => p.id));
    const paintedIds = new Set(paintedNodes.map((p) => p.id));
    let weldedRim = 0;
    let weldedPainted = 0;
    let minted = 0;
    for (const node of patch.nodes) {
      if (rimIds.has(node.id)) weldedRim += 1;
      else if (paintedIds.has(node.id)) weldedPainted += 1;
      else minted += 1;
    }
    console.warn(
      `[terrain-cut-repair] plan ${JSON.stringify({
        causeId,
        regionCount: patch.regions.length,
        nodeCount: patch.nodes.length,
        weldedRim,
        weldedPainted,
        minted,
        patchBounds: boundsOf(patch.nodes.map((n) => n.position)),
      })}`,
    );
  } else {
    console.warn(`[terrain-cut-repair] plan produced nothing ${JSON.stringify({ causeId })}`);
  }
  if (patch === undefined) return 0;

  // See OrganicCutRepairRuntime.addPatch's own doc for why this is a plain
  // add, not applyPatchReplacement: this fill replaces nothing, and a
  // region the engine skips (see its own doc for how two of this fill's
  // own corners can each weld correctly on their own yet still name an edge
  // that is already full elsewhere in the standing mesh) must cost only
  // that one region, never the rest of a batch that can be ten quads deep.
  // A thrown error here is a real failure, not a partial refusal -- addPatch
  // itself only throws for something outside "this face had no room."
  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `terrain cut repair's regenerated fill failed -- ${message}. Submitted regions: ${JSON.stringify(
        patch.regions.map((region) => ({ regionId: region.regionId, edges: region.boundary.length })),
      )}`,
      { cause: error },
    );
  }
}
