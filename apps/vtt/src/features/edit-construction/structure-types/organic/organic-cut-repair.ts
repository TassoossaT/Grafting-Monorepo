import type {
  ConstructionNodeId,
  ConstructionPatch,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import type { AtomicEditOp } from "../../orchestration/atomic-edit.ts";
import { createBoundaryEdges } from "../../topology/boundary-edges.ts";
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
 */
const MAX_EDGE_LENGTH = LATTICE_TRIANGLE_SIDE * 1.5;

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
 * `holeLoops`' own bounding circle decides the radius -- generous by one
 * whole ring (`+ 1`) so the lattice's own boundary clears every rim point
 * with room to spare. Deliberately *not* sized from `paintedNodes` too: that
 * list is the painter's *whole* patch (a long road's every node, not only
 * the stretch next to this one hole), and sizing the lattice from it would
 * make one small cut generate an enormous lattice for a stroke that merely
 * happens to run nearby. `paintedNodes` still narrows which pins actually
 * find a real counterpart -- it only does not decide how big to build.
 */
export function buildCutRepairLattice(
  holeLoops: readonly (readonly CutRepairWeldCandidate[])[],
  paintedNodes: readonly CutRepairWeldCandidate[],
  causeId: string,
): OrganicCutRepairLattice {
  const { centerX, centerZ, radius } = boundsOf(holeLoops.flat().map((point) => point.position));
  const trianglesPerSide = Math.max(1, Math.ceil(radius / LATTICE_TRIANGLE_SIDE) + 1);

  const random = createRandom(seedFromCauseId(causeId));
  const triangles = buildTriangleHex({ trianglesPerSide, triangleSide: LATTICE_TRIANGLE_SIDE });
  const preRelax = weldQuadGrid(ortho(pairTriangles(triangles, random)));

  const pinCandidates: CutRepairWeldCandidate[] = [...holeLoops.flat(), ...paintedNodes];
  const noExclusions: ReadonlySet<ConstructionNodeId> = new Set();
  const pins = new Map<number, Vec2>();
  preRelax.vertices.forEach((local, vertexIndex) => {
    const nearest = nearestWithin(centerX + local.x, centerZ + local.y, pinCandidates, noExclusions, PIN_RADIUS);
    if (nearest !== undefined) pins.set(vertexIndex, { x: nearest.position.x - centerX, y: nearest.position.z - centerZ });
  });

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
  /** The hole's own exposed rim, one ring per disjoint loop the deletion left -- real, live node ids, already fetched via `getUnfilledLoops`. */
  readonly holeLoops: readonly (readonly CutRepairWeldCandidate[])[];
  /** The painter's own real registered nodes -- see `CutFallout`. */
  readonly paintedNodes: readonly CutRepairWeldCandidate[];
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
 * 2. Drop it if its centroid falls outside every ring in `input.holeLoops` --
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
  const rimCandidates = input.holeLoops.flat();
  const candidates: CutRepairWeldCandidate[] = [...rimCandidates, ...input.paintedNodes];
  const holeRings = input.holeLoops.map((loop) => loop.map((point) => point.position));
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

  input.lattice.mesh.quads.forEach((quad, quadIndex) => {
    if (input.occupiedQuads.has(quadIndex)) return;
    const centroid = centroids[quadIndex];
    if (centroid === undefined) return;
    const [cx, cz] = centroid;
    if (!Number.isFinite(cx) || !insideHole(cx, cz, holeRings)) return;

    const cycle = quad.map((vertexIndex) => resolveVertex(vertexIndex)).filter((id): id is ConstructionNodeId => id !== undefined);
    if (cycle.length !== quad.length || new Set(cycle).size !== cycle.length) return;

    const corners = quad.map((vertexIndex) => resolvedPosition[vertexIndex]);
    if (corners.some((corner) => corner === undefined)) return;
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
    if (quadCrossesItself(sane) || quadEdgeTooLong(sane)) return;

    const boundary = cycle.map((id, position) => edges.use(id, cycle[(position + 1) % cycle.length]!));
    quad.forEach((vertexIndex, position) => {
      const id = cycle[position];
      const resolved = resolvedPosition[vertexIndex];
      if (id !== undefined && resolved !== undefined) nodePositions.set(id, resolved);
    });
    regions.push({ regionId: cycle.join("|"), boundary, surfaceType: input.surfaceType, physical: input.physical });
  });

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
  classifyPoints(points: readonly (readonly [number, number])[]): readonly { readonly index: number }[];
  applyRegionEdit(ops: readonly AtomicEditOp[], origin: "local", causeId: string): unknown;
  /**
   * Deliberately not `addPatch`: `addPatch` mutates the live graph directly
   * with no clone and no rollback (`apply_add_patch`, `region_editing.rs`) --
   * a refused region among several would leave the rest committed and that
   * one simply missing, a real hole. `applyPatchReplacement`
   * (`apply_patch_replacement`, `patch_replacement.rs`) runs on a clone and
   * only publishes when every target region registers, so a refused
   * regeneration commits nothing at all rather than half a mesh.
   */
  applyPatchReplacement(
    request: {
      readonly operationId: string;
      readonly sourceSurfaceKeys: readonly ConstructionSurfaceKey[];
      readonly patch: ConstructionPatch;
    },
    origin: "local",
    causeId: string,
  ): unknown;
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
 * 1. Read every consumed region's own topology before deleting it -- once
 *    gone, there is nothing left to ask.
 * 2. Delete the consumed regions. Terrain's own call, not the painter's.
 * 3. `getUnfilledLoops`, scoped to what those regions stood on, reports
 *    exactly the rim the deletion exposed -- the hole's own boundary.
 * 4. Build a fresh lattice sized to cover that hole ({@link buildCutRepairLattice}).
 * 5. One batched `classifyPoints` call over every lattice quad's centroid
 *    reports which already sit on ground something else claims (surviving
 *    terrain, or the painter's own new patch) -- terrain's fill has to stop
 *    exactly there, for any type that cuts it, not only a road.
 * 6. {@link planOrganicCutRepair} decides which quads survive and welds them.
 * 7. Register the surviving quads as one atomic `applyPatchReplacement` --
 *    every one of them or none, never some.
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
  for (const topology of consumedTopologies) for (const node of topology.nodes) preScope.add(node.id);
  if (preScope.size === 0) return 0;

  // Not wrapped for the delete itself -- the WASM mutation this performs
  // either lands or throws before anything below runs. It *is* wrapped here
  // because the runtime's own post-mutation step re-fetches a mesh for
  // every affected region to keep rendering in sync, and one batch commonly
  // deletes several consumed regions that border each other -- a region
  // this same call is also deleting can legitimately be reported as
  // "affected" by its sibling's removal, and by the time that mesh refetch
  // runs, it is *also* already gone, throwing `unknown analytic region` for
  // a region that was never meant to survive this call anyway. The graph
  // mutation itself already committed by then; only that redundant refetch
  // failed, so the repair continues into the fill below rather than
  // aborting before it ever attempted one -- exactly the "terrain deletes
  // but nothing reconnects" symptom this was traced from.
  try {
    runtime.applyRegionEdit(
      fallout.consumedSurfaceKeys.map((surfaceKey): AtomicEditOp => ({ kind: "delete-region", surfaceKey })),
      "local",
      causeId,
    );
  } catch {
    // Deliberately swallowed -- see the comment above.
  }

  const loops = runtime.getUnfilledLoops([...preScope]);
  if (loops.length === 0) return 0;

  const snapshot = runtime.getSnapshot();
  const positionOf = (id: ConstructionNodeId): ConstructionPosition | undefined => snapshot.map.nodePositions.get(id)?.position;

  const holeLoops: CutRepairWeldCandidate[][] = [];
  for (const loop of loops) {
    const ring: CutRepairWeldCandidate[] = [];
    for (const nodeId of loop.nodeIds) {
      const position = positionOf(nodeId);
      if (position === undefined) continue;
      ring.push({ id: nodeId, position });
    }
    if (ring.length >= 3) holeLoops.push(ring);
  }
  if (holeLoops.length === 0) return 0;

  const lattice = buildCutRepairLattice(holeLoops, fallout.paintedNodes, causeId);
  const centroids = cutRepairQuadCentroids(lattice);
  const occupiedQuads = new Set(runtime.classifyPoints(centroids).map((hit) => hit.index));

  const patch = planOrganicCutRepair({
    tableId: snapshot.tableId,
    causeId,
    surfaceType,
    physical,
    lattice,
    holeLoops,
    paintedNodes: fallout.paintedNodes,
    occupiedQuads,
  });
  if (patch === undefined) return 0;

  // One atomic add, not a manual delete-then-add: see
  // OrganicCutRepairRuntime.applyPatchReplacement's own doc for why
  // addPatch is wrong here. `sourceSurfaceKeys` is empty -- the consumed
  // regions were already deleted above -- so a refusal here commits nothing
  // new rather than leaving a half-built mesh.
  try {
    runtime.applyPatchReplacement({ operationId: causeId, sourceSurfaceKeys: [], patch }, "local", causeId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `terrain cut repair's regenerated fill was refused, nothing new was committed -- ${message}. Submitted regions: ${JSON.stringify(
        patch.regions.map((region) => ({ regionId: region.regionId, edges: region.boundary.length })),
      )}`,
      { cause: error },
    );
  }
  return patch.regions.length;
}
