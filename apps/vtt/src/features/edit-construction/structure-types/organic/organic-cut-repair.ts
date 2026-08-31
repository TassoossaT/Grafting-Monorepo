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
 * How close (world units, XZ) a lattice vertex's own *final*, self-relaxed
 * position must land to a real candidate -- an existing node, or the nearest
 * point along one of the painter's own edges -- before it welds onto that
 * candidate instead of minting a fresh id.
 *
 * The same tolerance, and the same reasoning, as `terrain-sculpt-tool.ts`'s
 * own `CROSS_SESSION_WELD_EPSILON`: this repair no longer bends the lattice
 * itself toward the hole's real geometry the way an earlier version's own
 * `PIN_RADIUS`-driven `relax(..., { pinnedTargets })` did (`buildCutRepairLattice`'s
 * own history) -- the lattice self-relaxes exactly like a fresh piece of
 * terrain does, and only *afterward* does each vertex look for real geometry
 * nearby. A generous-enough radius is what makes that connection reliable
 * without ever needing to have shaped the mesh around it; {@link MAX_EDGE_LENGTH}
 * is the backstop against the rare case where that reach still lands wrong.
 */
const WELD_RADIUS = LATTICE_TRIANGLE_SIDE * 0.4;

/**
 * The longest a fresh quad's own edge may be, measured from its *resolved*
 * (post-weld) corners, before the quad is dropped as malformed rather than
 * submitted.
 *
 * A backstop, not the primary defence: even with `WELD_RADIUS` chosen well,
 * a self-relaxed lattice's own boundary can still land oddly against a thin
 * or sharply curved hole, and a quad whose corners end up this far apart is
 * not filling the hole any more, it is bridging across it -- dropped rather
 * than committed as a corrupt face.
 *
 * Sized from what a *legitimately* welded edge can actually reach, not a
 * round guess: an unwelded edge runs up to roughly `0.7 * LATTICE_TRIANGLE_SIDE`
 * (measured on this generator), and each of its two corners can
 * independently move up to {@link WELD_RADIUS} away from that -- in opposite
 * directions, in the worst real case.
 */
const MAX_EDGE_LENGTH = LATTICE_TRIANGLE_SIDE * 0.7 + 2 * WELD_RADIUS;

/**
 * How close a lattice vertex's projection onto one of the painter's own
 * edges must land to that edge's *own* endpoint before {@link buildCutRepairLattice}
 * treats it as that endpoint rather than a fresh split point.
 *
 * The endpoint is already a live node -- one of `candidates` -- so a
 * projection landing this close to it is the same match the plain
 * node-candidate pairing already makes; without this, a vertex naturally
 * closest to an edge's own end would get *both* an ordinary node pin and a
 * near-coincident edge pin competing for it, and the edge pin would go on to
 * `insert-vertex` a second, redundant node right on top of the real one.
 */
const EDGE_PIN_ENDPOINT_SLACK = 1e-3;

/**
 * How far outside the hole's own exact boundary a *freshly minted* quad
 * corner may still land before {@link planOrganicCutRepair} drops the whole
 * quad as having wandered off, rather than merely finished the hole.
 *
 * Not zero, on purpose: a welded corner sits at real geometry and is never
 * wrong for extending past a hand-drawn boundary the rim itself defines, but
 * a lattice cell is a finite size, and the self-relaxed lattice's own square-
 * fitting can legitimately put an *unwelded* corner a little past the exact
 * polygon while the quad it belongs to is still, visibly, closing the hole
 * correctly -- rejecting every one of those on a hole small relative to one
 * cell (this generator's own unit tests included) left nothing able to fill
 * at all. Sized the same way {@link MAX_EDGE_LENGTH} is: half a cell is
 * roughly how far a quad's own corner can legitimately reach past where its
 * centroid already tested as safely inside.
 */
const MINTED_CORNER_HOLE_MARGIN = LATTICE_TRIANGLE_SIDE * 0.5;

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

/** `(x, z)`'s own distance to the nearest point on `ring`'s boundary itself -- not whether it is inside, how far outside (or in) it sits. */
function distanceToRing(x: number, z: number, ring: readonly ConstructionPosition[]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const projected = nearestPointOnSegment(x, z, ring[j]!, ring[i]!);
    const dx = projected.x - x;
    const dz = projected.z - z;
    best = Math.min(best, dx * dx + dz * dz);
  }
  return Math.sqrt(best);
}

/**
 * Whether `(x, z)` is inside `holeLoops`, or close enough to its boundary
 * that a finite-sized quad corner legitimately landing there is not the
 * "wandered off" case {@link MINTED_CORNER_HOLE_MARGIN}'s own doc describes.
 */
function insideOrNearHole(x: number, z: number, holeLoops: readonly (readonly ConstructionPosition[])[], margin: number): boolean {
  return insideHole(x, z, holeLoops) || holeLoops.some((ring) => distanceToRing(x, z, ring) <= margin);
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
 * One real, already-live edge whose *true* direction (as the engine
 * actually stored it) is known and must be trusted verbatim -- never
 * recomputed from `sharedEdgeId`'s own lexicographic convention. See
 * {@link insertLatticeEdgePins}'s own doc for why: `insertVertex` preserves
 * the *original* edge's own direction for both fragments it creates, which
 * has nothing to do with where the freshly minted node's own id happens to
 * sort as a string, so a fragment's true `startNodeId`/`endNodeId` can
 * disagree with what fresh lexicographic comparison would assume.
 */
export interface CutRepairKnownEdge {
  readonly edgeId: ConstructionEdgeId;
  readonly startNodeId: ConstructionNodeId;
  readonly endNodeId: ConstructionNodeId;
}

/**
 * One lattice vertex's own decision to land on a point *along* one of the
 * painter's own edges, rather than on an existing node -- {@link buildCutRepairLattice}'s
 * own output, {@link insertLatticeEdgePins}'s own input.
 *
 * `t` (`0`-`1`, `startNodeId` -> `endNodeId`) is carried so multiple pins
 * landing on the *same* original edge can be split in the right order --
 * `insert-vertex` only ever splits one edge into two, so subdividing a run
 * three or more real anchors deep is a sequence of splits, nearest-to-`start`
 * first.
 */
export interface OrganicCutRepairLatticeEdgePin {
  readonly vertexIndex: number;
  readonly edgeId: ConstructionEdgeId;
  readonly startNodeId: ConstructionNodeId;
  readonly endNodeId: ConstructionNodeId;
  readonly t: number;
  readonly position: ConstructionPosition;
}

/** What {@link insertLatticeEdgePins} both created and learned. */
export interface InsertedLatticeEdgePins {
  /** The freshly minted anchor nodes -- new weld candidates. */
  readonly nodes: readonly CutRepairWeldCandidate[];
  /** Every fragment edge actually created, with its *true* stored direction -- see {@link CutRepairKnownEdge}'s own doc. */
  readonly edges: readonly CutRepairKnownEdge[];
}

/**
 * Performs the `insert-vertex` splits {@link buildCutRepairLattice}'s own
 * edge-pin search decided the painter's edges need, one real node per
 * {@link OrganicCutRepairLatticeEdgePin} -- the same generic op a wall
 * crossing already uses (`ConstructionSessionPort.insertVertex`'s own doc:
 * "subdivides one boundary edge, minting a new node on it"), applied here to
 * a straight or gently-curved run rather than an intersection.
 *
 * **Why this replaces a separate pre-pass.** An earlier version of this
 * repair (`densifyPaintedEdges`) guessed where to split a long edge *before*
 * the lattice existed, spacing anchors evenly and hoping the lattice's own
 * boundary would later land close enough to weld onto one. It usually did,
 * approximately -- two independent decisions (where the guessed anchors
 * are, where the lattice's own vertices land) rarely agree exactly. There is
 * a strictly simpler order: build the lattice first (`buildCutRepairLattice`'s
 * own search already finds, for every one of its own vertices near a painted
 * edge, the *exact* nearest point on it), and only then split the edge at
 * exactly those points. The inserted node does not need to find the lattice
 * vertex; it *is* the lattice vertex, by construction, with nothing left to
 * weld.
 *
 * **Every fragment's own true direction is tracked, not assumed.**
 * `insert_vertex` (`region_edit.rs`) splits by calling the *original* edge's
 * own `.split()`, which keeps that original's own direction for both
 * fragments (`first: original.start -> newNode`, `second: newNode ->
 * original.end`) -- nothing to do with where the freshly minted node's own
 * id happens to sort as a string. `sharedEdgeId`'s canonical (lexicographic)
 * naming convention only agrees with an edge's *actual* stored direction
 * for an edge created the normal way, through `createBoundaryEdges.use()`
 * itself; a split fragment can easily disagree, and `planOrganicCutRepair`'s
 * own fresh `edges.use()` call for reusing it would then submit the wrong
 * `reversed` flag, which is exactly what an engine-side `loop is not
 * closed` refusal traced back to. Every fragment's *true* start/end is
 * returned in {@link InsertedLatticeEdgePins.edges} so the caller can bypass
 * that fresh recomputation for these specific ids.
 *
 * Mutates the live graph (through `runtime.applyRegionEdit`); returns the
 * freshly created nodes so the caller can fold them into its own weld
 * candidates immediately, in the same call.
 */
export function insertLatticeEdgePins(
  runtime: OrganicCutRepairRuntime,
  tableId: string,
  causeId: string,
  edgePins: readonly OrganicCutRepairLatticeEdgePin[],
): InsertedLatticeEdgePins {
  if (edgePins.length === 0) return { nodes: [], edges: [] };

  const byEdge = new Map<ConstructionEdgeId, OrganicCutRepairLatticeEdgePin[]>();
  for (const pin of edgePins) {
    const list = byEdge.get(pin.edgeId);
    if (list === undefined) byEdge.set(pin.edgeId, [pin]);
    else list.push(pin);
  }

  const nodes: CutRepairWeldCandidate[] = [];
  const knownEdges: CutRepairKnownEdge[] = [];

  for (const pins of byEdge.values()) {
    // Nearest-to-`start` first: `insert-vertex` only ever splits the one
    // edge it is given into two, so three or more anchors along the same
    // original run is a sequence of splits, each consuming the *remainder*
    // left by the last -- the same shape `densifyPaintedEdges` used to walk,
    // just now over pins the lattice itself placed instead of an even guess.
    const sorted = [...pins].sort((a, b) => a.t - b.t);
    const first = sorted[0]!;
    let currentEdgeId = first.edgeId;
    let fromId = first.startNodeId;
    for (const pin of sorted) {
      const nodeId: ConstructionNodeId = `terrain-cut:${causeId}:path-anchor:${nodes.length}`;
      const firstEdgeId = sharedEdgeId(tableId, fromId, nodeId);
      const secondEdgeId = sharedEdgeId(tableId, nodeId, pin.endNodeId);
      runtime.applyRegionEdit(
        [{ kind: "insert-vertex", edgeId: currentEdgeId, nodeId, position: pin.position, firstEdgeId, secondEdgeId }],
        "local",
        causeId,
      );
      nodes.push({ id: nodeId, position: pin.position });
      // `first` (fromId -> nodeId) is now a permanent fragment -- only the
      // remainder (`second`) gets split further, next pin or as the loop's
      // own final segment below.
      knownEdges.push({ edgeId: firstEdgeId, startNodeId: fromId, endNodeId: nodeId });
      currentEdgeId = secondEdgeId;
      fromId = nodeId;
    }
    // The final remainder, from the last anchor to the edge's own original
    // end, is never split again -- its own true direction is exactly what
    // it was assigned on the last iteration above.
    knownEdges.push({ edgeId: currentEdgeId, startNodeId: fromId, endNodeId: first.endNodeId });
  }
  return { nodes, edges: knownEdges };
}

/** Point on segment `a`-`b` (XZ) nearest `(x, z)`, clamped to the segment itself -- never extrapolated past either end. `t` is `0` at `a`, `1` at `b`. */
function nearestPointOnSegment(
  x: number,
  z: number,
  a: ConstructionPosition,
  b: ConstructionPosition,
): { readonly t: number; readonly x: number; readonly z: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 1e-12) return { t: 0, x: a.x, z: a.z };
  const t = Math.min(Math.max(((x - a.x) * dx + (z - a.z) * dz) / lengthSq, 0), 1);
  return { t, x: a.x + dx * t, z: a.z + dz * t };
}

/** A fresh lattice sized and placed to cover every point `holeLoops` names -- terrain's own generator, seeded deterministically from the cause that needs it. */
export interface OrganicCutRepairLattice {
  readonly mesh: QuadMesh;
  readonly originX: number;
  readonly originZ: number;
  /** Every vertex this generation pinned onto a point *along* one of the painter's own edges, rather than onto an existing node -- {@link insertLatticeEdgePins}'s own input. */
  readonly edgePins: readonly OrganicCutRepairLatticeEdgePin[];
}

/**
 * Sizes and generates the lattice a cut repair fills its hole from, then
 * reports every one of its own vertices that landed close enough to a point
 * *along* one of the painter's own edges to be worth splitting there.
 *
 * **Self-relaxed, the same way `terrain-sculpt-tool.ts` builds fresh
 * terrain -- never bent toward the hole's own real geometry.** An earlier
 * version of this function pinned every vertex it could match onto a real
 * candidate *during* `relax` (`RelaxOptions.pinnedTargets`), forcing the
 * mesh's own shape to bend toward the hole it was closing. That bought exact
 * positions at the cost of real machinery: a distance-sorted greedy match
 * to decide which vertex won which candidate, a whole second candidate kind
 * for points *along* an edge competing in the same pass, and a near-zero
 * weld tolerance downstream that only worked because pinning had already
 * done the hard part. `terrain-sculpt-tool.ts` never faced any of this --
 * building a `QuadMesh` once and relaxing it toward *itself* is exactly what
 * `buildIrregularQuadGrid` already does, and welding is a plain
 * nearest-candidate search afterward, at a tolerance generous enough
 * (`WELD_RADIUS`) to still find real geometry nearby without needing to
 * have shaped the mesh around it. The same defences that already existed
 * for a bad match -- `quadCrossesItself`, `MAX_EDGE_LENGTH`, the
 * unrelated-real-pair guard -- catch the rare case a self-relaxed lattice's
 * boundary lands somewhere a well-pinned one would not have.
 *
 * `holeShapeRings`' own bounding circle decides the radius -- generous by
 * one whole ring (`+ 1`) so the lattice's own boundary clears every point of
 * it with room to spare, and `planOrganicCutRepair`'s own inside-hole and
 * occupied-quad checks are what actually stop the fill from spilling past
 * the true hole -- this only has to be big enough to cover it, not shaped
 * like it.
 *
 * **A vertex can land on a point *along* one of `paintedEdges`, not only on
 * an existing node.** A road is flattened to a handful of points along a
 * straight or gently curved stretch, by design -- a hole bordering ten or
 * more metres of one may see only two or three of the painter's own nodes
 * anywhere nearby, starving a node-only weld of anything to find along most
 * of that run. For each vertex within `WELD_RADIUS` of a nearby edge,
 * projecting onto its *nearest point* and comparing that against the
 * nearest plain node candidate -- whichever is actually closer wins -- finds
 * a counterpart along the whole run, not only at its sparse ends, without
 * ever preferring a fresh split over a real, already-live node that was
 * closer all along. Reported back as {@link OrganicCutRepairLattice.edgePins}
 * for {@link insertLatticeEdgePins} to turn into a real split.
 */
export function buildCutRepairLattice(
  holeShapeRings: readonly (readonly ConstructionPosition[])[],
  candidates: readonly CutRepairWeldCandidate[],
  paintedEdges: readonly CutRepairPaintedEdge[],
  causeId: string,
): OrganicCutRepairLattice {
  const { centerX, centerZ, radius } = boundsOf(holeShapeRings.flat());
  const trianglesPerSide = Math.max(1, Math.ceil(radius / LATTICE_TRIANGLE_SIDE) + 1);

  const random = createRandom(seedFromCauseId(causeId));
  const triangles = buildTriangleHex({ trianglesPerSide, triangleSide: LATTICE_TRIANGLE_SIDE });
  const mesh = relax(weldQuadGrid(ortho(pairTriangles(triangles, random))));

  // `candidates`/`paintedEdges` can include the painter's *whole* patch (a
  // long road's every node and edge), so both are filtered to this hole's
  // own neighbourhood before any per-vertex search -- otherwise every one of
  // a long road's thousand-odd contour samples would be tested against
  // every lattice vertex.
  const reach = radius + WELD_RADIUS;
  const nearby = (point: ConstructionPosition): boolean =>
    Math.abs(point.x - centerX) <= reach && Math.abs(point.z - centerZ) <= reach;
  const nearbyCandidates = candidates.filter((candidate) => nearby(candidate.position));
  const positionOf = new Map(candidates.map((candidate) => [candidate.id, candidate.position]));
  const nearbyEdges = paintedEdges
    .map((edge) => {
      const start = positionOf.get(edge.startNodeId);
      const end = positionOf.get(edge.endNodeId);
      return start !== undefined && end !== undefined ? { edge, start, end } : undefined;
    })
    .filter((entry): entry is { edge: CutRepairPaintedEdge; start: ConstructionPosition; end: ConstructionPosition } => entry !== undefined)
    .filter((entry) => nearby(entry.start) || nearby(entry.end));

  const edgePins: OrganicCutRepairLatticeEdgePin[] = [];
  mesh.vertices.forEach((local, vertexIndex) => {
    const x = centerX + local.x;
    const z = centerZ + local.y;

    let nearestCandidateDistanceSq = Infinity;
    for (const candidate of nearbyCandidates) {
      const dx = candidate.position.x - x;
      const dz = candidate.position.z - z;
      nearestCandidateDistanceSq = Math.min(nearestCandidateDistanceSq, dx * dx + dz * dz);
    }

    let best: { readonly edge: CutRepairPaintedEdge; readonly t: number; readonly x: number; readonly z: number; readonly distanceSq: number } | undefined;
    for (const { edge, start, end } of nearbyEdges) {
      const projected = nearestPointOnSegment(x, z, start, end);
      // Landing at (or past) either end is the same match the node
      // candidate for that endpoint already makes -- see EDGE_PIN_ENDPOINT_SLACK's own doc.
      if (projected.t <= EDGE_PIN_ENDPOINT_SLACK || projected.t >= 1 - EDGE_PIN_ENDPOINT_SLACK) continue;
      const dx = projected.x - x;
      const dz = projected.z - z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq <= WELD_RADIUS * WELD_RADIUS && (best === undefined || distanceSq < best.distanceSq)) {
        best = { edge, t: projected.t, x: projected.x, z: projected.z, distanceSq };
      }
    }
    // A plain node candidate wins any tie -- welding onto a real, already-
    // live node is strictly simpler than minting a fresh split of an edge
    // that node may itself be one end of.
    if (best === undefined || best.distanceSq >= nearestCandidateDistanceSq) return;

    // Height interpolated along the edge at `t`, the same way a freshly
    // minted (unwelded) vertex borrows the nearest real point's own `y` --
    // there is no lattice-side height of its own to use instead.
    const startY = positionOf.get(best.edge.startNodeId)?.y ?? 0;
    const endY = positionOf.get(best.edge.endNodeId)?.y ?? 0;
    edgePins.push({
      vertexIndex,
      edgeId: best.edge.edgeId,
      startNodeId: best.edge.startNodeId,
      endNodeId: best.edge.endNodeId,
      t: best.t,
      position: { x: best.x, y: startY + (endY - startY) * best.t, z: best.z },
    });
  });

  return { mesh, originX: centerX, originZ: centerZ, edgePins };
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
  /**
   * Every id in `candidates` that came from the hole's own surviving rim,
   * as opposed to the painter's own contour -- every one of them already
   * belongs to the *same* standing neighbour, dense and real, whether or
   * not `knownEdges` happens to record a direct edge between any given
   * pair. See `boundaryPermitted`'s own doc for why this widens the
   * unrelated-real-pair guard specifically for this one set.
   */
  readonly rimIds: ReadonlySet<ConstructionNodeId>;
  /** Every fragment {@link insertLatticeEdgePins} created, plus the rim's own known adjacency, each with its *true* stored direction -- see {@link CutRepairKnownEdge}'s own doc for why this must be trusted instead of recomputed. */
  readonly knownEdges: readonly CutRepairKnownEdge[];
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

  // Every known fragment's own *true* direction, keyed by the same
  // `sharedEdgeId` its id already is -- see `CutRepairKnownEdge`'s own doc
  // for why this must override `edges.use()`'s fresh (and, for a split
  // fragment, potentially wrong) lexicographic guess.
  const knownEdgesById = new Map(input.knownEdges.map((known) => [known.edgeId, known]));

  // Every id `candidates` names -- a *real*, live node, as opposed to one
  // `resolveVertex` had to mint fresh for this hole. Two adjacent lattice
  // corners can each independently weld onto a real node that is close by
  // *in space* without there being any real edge between the two of them at
  // all: the original edge that used to run directly between them may have
  // been the very one `insertLatticeEdgePins` split into a whole chain of
  // anchors, which leaves `sharedEdgeId(tableId, a, b)` for the pre-split
  // pair naming nothing this patch actually knows about. `quadCrossesItself`
  // / `quadEdgeTooLong` catch this when the mismatch also happens to bend or
  // stretch the quad; neither does when the two real nodes simply sit near
  // each other despite being far apart along the graph. Falling through to
  // `edges.use()` in that case does not fail loudly -- it mints a brand new
  // edge id that either collides with a stale, already-pruned original (a
  // dangling reuse) or bridges two real nodes with a chord that was never
  // actually there, and either way the region's own boundary no longer walks
  // a real closed loop, which is what has been surfacing downstream as the
  // engine's own `OpenLoop` refusal. Two real ids may only share a boundary
  // edge here when a known fragment (or rim-adjacency) entry says so.
  const realIds = new Set(candidates.map((candidate) => candidate.id));
  // A weld between a rim id and a painted id is the *entire point* of this
  // repair -- that edge has never existed before and never appears in
  // `knownEdges`, on purpose. Requiring every real-to-real pair to already be
  // a known edge (an earlier version of this guard did exactly that)
  // rejected every one of those genuinely new welds along with the bug it
  // was meant to catch, and could empty a plan entirely. What actually needs
  // catching is narrower: two real ids that already belong to the *same*
  // known chain (one densified painted run, or one rim loop) landing
  // adjacent in a quad without being the chain's own neighbours -- the
  // original edge that used to run directly between them was the one
  // `insertLatticeEdgePins` (or a rim loop) split up, so no known edge names
  // this specific pair, yet a real one, once, genuinely did. A pair from two
  // *different* chains (or two ids with no known chain at all) has no such
  // history to contradict -- there is nothing they could be skipping over --
  // so it is always a legitimate new connection.
  //
  // `componentOf` answers this with union-find over `input.knownEdges`:
  // reject only when both ids are real, no direct known edge names this
  // pair, and they already sit in the same connected component of that
  // known-edge graph.
  const parent = new Map<ConstructionNodeId, ConstructionNodeId>();
  const componentOf = (id: ConstructionNodeId): ConstructionNodeId => {
    let root = parent.get(id) ?? id;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const known of input.knownEdges) {
    const rootA = componentOf(known.startNodeId);
    const rootB = componentOf(known.endNodeId);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }
  // Every rim id is unioned into one shared component outright, regardless
  // of loop adjacency -- `input.rimIds` own doc explains why: they all
  // belong to the *same* dense, standing neighbour, whether or not this
  // repair's own (necessarily partial) `knownEdges` happens to record a
  // direct connection between any two of them. Two rim ids that are not
  // loop-adjacent can still already share a real edge somewhere else in
  // that neighbour's own interior mesh -- one this repair never asked
  // about -- and `edges.use()` naming a "new" edge for that same pair is
  // then not new at all: it collides with whatever that edge already has,
  // which the engine correctly (and silently, since `addPatch` degrades
  // gracefully) refuses as no room. Treating every rim id as one component
  // means such a pair is caught by the exact same demotion this guard
  // already performs for a same-chain painted skip, instead of slipping
  // through as "different component, therefore new."
  let rimRoot: ConstructionNodeId | undefined;
  for (const id of input.rimIds) {
    if (rimRoot === undefined) {
      rimRoot = id;
      continue;
    }
    const rootA = componentOf(rimRoot);
    const rootB = componentOf(id);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }
  // Pure -- no `edges.use()` call, so no side effect on `edges`'s own
  // closure state. Must run over a quad's *entire* cycle before any of that
  // quad's sides are committed via `boundaryUse` below: `edges.use()`
  // unconditionally registers whatever it is given, so checking pair-by-pair
  // *while* committing let an earlier, permitted side of an eventually-
  // rejected quad register a real edge referencing that quad's own freshly
  // minted corner -- a corner that then never made it into `nodePositions`
  // because the quad itself was dropped, leaving a dangling edge in
  // `edges.all()` that named a node `patch.nodes` never declared (the
  // engine's own "edge references unknown node" refusal).
  const boundaryPermitted = (a: ConstructionNodeId, b: ConstructionNodeId): boolean =>
    knownEdgesById.has(sharedEdgeId(input.tableId, a, b)) ||
    !realIds.has(a) ||
    !realIds.has(b) ||
    componentOf(a) !== componentOf(b);
  const boundaryUse = (a: ConstructionNodeId, b: ConstructionNodeId): { readonly edgeId: ConstructionEdgeId; readonly reversed: boolean } => {
    const known = knownEdgesById.get(sharedEdgeId(input.tableId, a, b));
    if (known !== undefined) return { edgeId: known.edgeId, reversed: a !== known.startNodeId };
    return edges.use(a, b);
  };

  // TEMP DIAGNOSTIC -- remove once the live fill dropout is understood.
  // Tallies *why* an otherwise-inside-hole quad never made it into
  // `regions`, so a real session's own numbers say which check is actually
  // responsible instead of another guess.
  const rejected = { occupied: 0, outsideHole: 0, unresolvedOrDuplicate: 0, mintedOutsideHole: 0, crossingOrTooLong: 0, unrelatedRealPair: 0 };

  // Pass 1 -- read-only w.r.t. which lattice vertex resolves onto which real
  // id (only `resolveVertex`'s own weld-vs-mint memoization runs). Every
  // quad that survives occupancy/hole-membership/geometry gets recorded, and
  // every cyclic pair of *this* quad's corners that fails `boundaryPermitted`
  // marks its own *lattice vertex index* (not the quad) for demotion.
  //
  // Demoting per vertex index, once, globally, rather than substituting a
  // fresh id locally within whichever one quad happened to trip the check
  // first: a lattice vertex is shared by every quad around it, and a
  // *local* substitute (an earlier version of this function used exactly
  // that) left the other, untouched quads at that same corner still
  // resolving the original real id -- correct for each quad in isolation,
  // but the fill's own interior quads then no longer shared a node with
  // their own immediate neighbours at that point. Every quad in the fill
  // still looked individually valid, yet the *fill* rendered as a field of
  // disconnected mini-quads rather than one continuous patch -- exactly the
  // "miniquadrados" a live session reported. Demoting the vertex itself,
  // before any region is built, keeps every quad that touches it consistent
  // with every other.
  const survivors: { readonly quad: readonly number[]; readonly cycle: readonly ConstructionNodeId[] }[] = [];
  const demote = new Set<number>();

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

    // A welded corner is real geometry -- the hole's own rim, or the
    // painter's own contour -- so it is never wrong for it to sit at or
    // past the hole's own boundary; that boundary is drawn *from* rim and
    // painted positions in the first place. A *freshly minted* corner is
    // different: nothing constrains where the self-relaxed lattice's own
    // square-fitting put it, only this quad's own centroid was checked
    // against the hole (`outsideHole`, above) before any corner was even
    // resolved. Without pinning bending the mesh toward the hole any more
    // (see `buildCutRepairLattice`'s own doc), a quad whose centroid is
    // comfortably inside can still have one unwelded corner poke past the
    // true boundary -- generated *near* the painter's own edge but visibly
    // outside it, a real face rather than the graph mismatch the other
    // guards here exist for.
    if (cycle.some((id, position) => !realIds.has(id) && !insideOrNearHole(sane[position]!.x, sane[position]!.z, holeRings, MINTED_CORNER_HOLE_MARGIN))) {
      rejected.mintedOutsideHole += 1;
      return;
    }

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

    for (let position = 0; position < cycle.length; position += 1) {
      const a = cycle[position]!;
      const b = cycle[(position + 1) % cycle.length]!;
      if (!boundaryPermitted(a, b)) demote.add(quad[position]!);
    }
    survivors.push({ quad, cycle });
  });

  // Applied once, globally: every demoted vertex index gets exactly one
  // fresh id, at the position it already resolved to (never a new
  // position), reused by every surviving quad that touches it.
  for (const vertexIndex of demote) {
    const freshId: ConstructionNodeId = `terrain-cut:${input.causeId}:v${mintedCounter}`;
    mintedCounter += 1;
    resolvedId[vertexIndex] = freshId;
  }

  // Pass 2 -- rebuild each surviving quad's cycle from the now-demotion-
  // corrected cache and commit. `boundaryPermitted` is re-checked as a
  // backstop, not because demotion is expected to leave anything unresolved.
  for (const { quad, cycle: originalCycle } of survivors) {
    const cycle = demote.size === 0 ? originalCycle : quad.map((vertexIndex) => resolvedId[vertexIndex]!);
    if (cycle.some((id, position) => !boundaryPermitted(id, cycle[(position + 1) % cycle.length]!))) {
      rejected.unrelatedRealPair += 1;
      continue;
    }

    const boundary = cycle.map((id, position) => boundaryUse(id, cycle[(position + 1) % cycle.length]!));
    quad.forEach((vertexIndex, position) => {
      const id = cycle[position];
      const resolved = resolvedPosition[vertexIndex];
      if (id !== undefined && resolved !== undefined) nodePositions.set(id, resolved);
    });
    regions.push({ regionId: cycle.join("|"), boundary, surfaceType: input.surfaceType, physical: input.physical });
  }

  console.warn(
    `[terrain-cut-repair] planOrganicCutRepair rejections ${JSON.stringify({
      causeId: input.causeId,
      totalQuads: input.lattice.mesh.quads.length,
      kept: regions.length,
      demotedVertices: demote.size,
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
  /**
   * `boundary` is each edge's *true* stored direction, already resolved
   * opposite the sole existing user -- "registrable verbatim" per its own
   * doc (`ConstructionUnfilledLoop`). `repairOrganicCut` trusts it verbatim
   * for the same reason {@link insertLatticeEdgePins} trusts its own fragments'
   * true direction instead of `sharedEdgeId`'s lexicographic guess: a rim
   * edge is exactly as likely to have been created start-after-end (a prior
   * `insert-vertex` split, or any edge whose two node ids simply don't sort
   * the way they were declared) as a painted one, and guessing wrong here
   * hands the engine the *same* direction its one existing neighbour already
   * holds -- which reads as "no room," not as the missing weld it actually is.
   */
  getUnfilledLoops(scope: readonly ConstructionNodeId[]): readonly {
    readonly nodeIds: readonly ConstructionNodeId[];
    readonly boundary: readonly { readonly edgeId: ConstructionEdgeId; readonly reversed: boolean }[];
  }[];
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
 * 4. Build a fresh, self-relaxed lattice sized to cover that hole
 *    ({@link buildCutRepairLattice}), which also reports every one of its
 *    own vertices that landed near a point along one of the painter's own
 *    edges rather than an existing node.
 * 5. {@link insertLatticeEdgePins} turns every one of those edge pins into a
 *    real `insert-vertex` split -- the lattice decided *where* a long
 *    painted run needs a real anchor; this is what actually mints one there.
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
  // Every pair `loop.nodeIds` actually walks consecutively (wrap included)
  // -- the rim's own real, pre-existing adjacency, untouched by
  // `insertLatticeEdgePins`. `planOrganicCutRepair` refuses to declare a
  // boundary edge between two real ids unless something here already
  // vouches for them being genuinely connected; without this, two rim ids
  // from non-adjacent stretches of the same (or a different) unfilled loop
  // could still land on adjacent lattice corners purely by proximity, the
  // same failure mode this whole `knownEdges` mechanism exists to close for
  // the painter's own densified edges.
  //
  // Direction is `loop.boundary`'s own -- never recomputed from
  // `sharedEdgeId`'s lexicographic guess. The engine already resolved each
  // edge's true stored direction, opposite whichever single neighbour still
  // holds it (`ConstructionUnfilledLoop.boundary`'s own doc: "registrable
  // verbatim"). A rim edge is no less likely than a painted one to have been
  // created start-after-end -- an earlier `insert-vertex` split, or simply
  // two node ids that do not happen to sort the way they were declared -- and
  // guessing wrong here hands the fill's own new quad the *same* direction
  // its one existing neighbour already holds, which the engine reads as "no
  // room" (`boundary_has_room`, `region_editing.rs`) instead of the missing
  // weld it actually is.
  const rimEdgeKnowledge: CutRepairKnownEdge[] = [];
  for (const loop of loops) {
    const ids = loop.nodeIds;
    for (let i = 0; i < ids.length; i += 1) {
      const from = ids[i]!;
      const to = ids[(i + 1) % ids.length]!;
      if (from === to) continue;
      const use = loop.boundary[i];
      if (use === undefined) continue;
      const [startNodeId, endNodeId] = use.reversed ? [to, from] : [from, to];
      rimEdgeKnowledge.push({ edgeId: use.edgeId, startNodeId, endNodeId });
    }
    for (const nodeId of ids) {
      const position = positionOf(nodeId);
      if (position !== undefined) liveRimCandidates.push({ id: nodeId, position });
    }
  }

  // The lattice is built *before* anything is subdivided on the painter's
  // own edges -- its own self-relaxed vertices already tell us, in
  // `lattice.edgePins`, the exact nearest point on any nearby edge. Only
  // real anchors the lattice actually needs get minted, exactly where it
  // needs them; see `insertLatticeEdgePins`'s own doc for why this replaced
  // a separate pre-guessed densify pass.
  const candidatesBeforeInsertion: CutRepairWeldCandidate[] = [...liveRimCandidates, ...fallout.paintedNodes];
  const lattice = buildCutRepairLattice(holeShapeRings, candidatesBeforeInsertion, fallout.paintedEdges, causeId);
  const inserted = insertLatticeEdgePins(runtime, snapshot.tableId, causeId, lattice.edgePins);
  const paintedNodes = inserted.nodes.length === 0 ? fallout.paintedNodes : [...fallout.paintedNodes, ...inserted.nodes];
  const candidates: CutRepairWeldCandidate[] = inserted.nodes.length === 0 ? candidatesBeforeInsertion : [...candidatesBeforeInsertion, ...inserted.nodes];
  console.warn(
    `[terrain-cut-repair] insertLatticeEdgePins ${JSON.stringify({
      causeId,
      paintedEdgeCount: fallout.paintedEdges.length,
      edgePinCount: lattice.edgePins.length,
      anchorsCreated: inserted.nodes.length,
      knownEdgeCount: inserted.edges.length,
    })}`,
  );

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
    rimIds: new Set(liveRimCandidates.map((candidate) => candidate.id)),
    knownEdges: [...rimEdgeKnowledge, ...inserted.edges],
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

  // TEMP DIAGNOSTIC -- remove once the live "no room" skip source is
  // confirmed. Distinguishes a bug in this batch's *own* boundary (two of
  // its own quads independently declaring the same edge in the same
  // direction, or three-plus quads sharing what can only ever be a two-sided
  // edge) from a genuine collision with something already full in the
  // standing mesh, which addPatch's own skip already handles correctly and
  // is not itself a bug. Nothing here can see the standing mesh's own usage
  // counts -- only what this one submission itself declares.
  const edgeUsesWithinBatch = new Map<ConstructionEdgeId, boolean[]>();
  for (const region of patch.regions) {
    for (const use of region.boundary) {
      const list = edgeUsesWithinBatch.get(use.edgeId) ?? [];
      list.push(use.reversed);
      edgeUsesWithinBatch.set(use.edgeId, list);
    }
  }
  const selfConflicts = [...edgeUsesWithinBatch.entries()].filter(
    ([, uses]) => uses.length > 2 || (uses.length === 2 && uses[0] === uses[1]),
  );
  if (selfConflicts.length > 0) {
    console.warn(
      `[terrain-cut-repair] self-conflicting edges within this same batch ${JSON.stringify({
        causeId,
        selfConflicts: selfConflicts.map(([edgeId, uses]) => ({ edgeId, uses })),
      })}`,
    );
  }

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
    // TEMP DIAGNOSTIC -- remove once the live OpenLoop mismatch is found.
    // A full dump of every region's boundary (up to 20+ quads deep) is what
    // got truncated mid-object the last time this fired -- OpenLoop's own
    // message already names the exact two node ids involved
    // (`ContourError::OpenLoop`, `contour.rs`), so this pulls those two out
    // of the message itself and dumps only what actually touches them: the
    // one or two regions whose own corner cycle names either one, and every
    // known-edge entry (rim *and* painted -- the earlier dump only ever
    // included the painted half) with either as an endpoint. Small enough to
    // never get cut off, and points straight at the mismatch instead of
    // requiring a search through everything submitted.
    const openLoopNodes = /expected next edge to start at (.+), found (.+)$/.exec(message);
    const named = openLoopNodes !== null ? [openLoopNodes[1]!, openLoopNodes[2]!] : [];
    const touchedRegions =
      named.length === 0
        ? patch.regions.map((region) => ({ regionId: region.regionId }))
        : patch.regions
            .filter((region) => region.regionId.split("|").some((id) => named.includes(id)))
            .map((region) => ({ regionId: region.regionId, boundary: region.boundary }));
    const touchedKnownEdges = [...rimEdgeKnowledge, ...inserted.edges].filter(
      (known) => named.length === 0 || named.includes(known.startNodeId) || named.includes(known.endNodeId),
    );
    console.warn(
      `[terrain-cut-repair] addPatch failed, targeted boundary dump ${JSON.stringify({
        causeId,
        message,
        named,
        touchedKnownEdges,
        touchedRegions,
      })}`,
    );
    throw new Error(
      `terrain cut repair's regenerated fill failed -- ${message}. Submitted regions: ${JSON.stringify(
        patch.regions.map((region) => ({ regionId: region.regionId, edges: region.boundary.length })),
      )}`,
      { cause: error },
    );
  }
}
