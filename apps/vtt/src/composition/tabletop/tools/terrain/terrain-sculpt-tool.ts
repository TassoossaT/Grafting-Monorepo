import { DEFAULT_TOOL_PARAMS, buildIrregularQuadGrid } from "@/features/edit-construction";
import type { TerrainSculptParams, QuadMesh, Vec2 } from "@/features/edit-construction";
import type {
  ConstructionCoveredRegion,
  ConstructionOrientedEdgeUse,
  ConstructionPatch,
  ConstructionPatchRegion,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionSurfaceSpec,
} from "@/ports";

import { brushSweptOutlinePolygons, brushSweptRegionFill } from "../shapes/preview-shapes.ts";
import { restackTerrain } from "./terrain-restack.ts";
import type { ConstructionTool, ToolContext, ToolGesture } from "../core/tool-context.ts";
import { createBoundaryEdges } from "../core/boundary-edges.ts";

/**
 * PENDING (not scheduled): this whole file -- lattice generation, heightmap
 * sampling, and the weld/merge search in `revealNear` -- runs in TypeScript.
 * Everything else this app generates procedurally (`generateTerrainCell`,
 * `generatePathExtrusion`) runs in Rust/WASM through `ConstructionSessionPort`; this
 * tool is the one exception, because it was ported as-is from a JS lab
 * prototype (`apps/architecture-studio/src/vtt/irregular-grid.ts`) to reach
 * the real app fast rather than rewritten in Rust first.
 *
 * Moving it: `irregular-grid.ts`'s algorithm is a direct port (pure
 * geometry, and `apps/architecture-studio/test/irregular-grid.test.mjs`
 * already specifies its behavior to port against). Heightmap sampling is
 * nearly free -- `generation-wasm`'s `generate_heightmap` already builds as
 * an `rlib`, so `construction-wasm` can depend on it directly in Rust, no
 * WASM-to-WASM call. `BrushSession` itself (below) is now only ever a local
 * variable inside `onPointerUp`, built and resolved in one synchronous pass
 * over the whole gesture -- no per-gesture mutable module state to leak or
 * clean up, on the JS side. A Rust port still needs its own equivalent
 * lifetime handling (allocate the session, resolve every sample, free it),
 * just scoped to one WASM call instead of a whole gesture's worth of ticks.
 */

/**
 * How this tool actually works, since the previous per-tick "generate a
 * fresh independent hexagon and hope its vertices land close enough to weld"
 * approach did not produce a real single mesh: two independently-seeded
 * lattices translated by an arbitrary (mouse-derived) offset essentially
 * never line up closely enough for their vertices to coincide, no matter how
 * generous the weld tolerance -- welding by proximity was patching the
 * symptom, not the cause.
 *
 * The fix is to stop regenerating geometry per reveal. One `QuadMesh` is
 * built once, sized generously (`params.trianglesPerSide`) to cover a whole
 * stroke, then every vertex gets its node id assigned once. Two quads that
 * share a corner therefore always share the exact same node id by
 * construction -- not by chance proximity -- so the result is one real
 * connected mesh.
 *
 * Unlike the tool's own earlier live-reveal version, this only ever runs
 * once per gesture, on release (`onPointerUp`): the same generic
 * preview-then-commit-once contract every other brush in this app follows
 * (see `brush-tool.ts`'s own doc) -- the drag only shows
 * `brushSweptRegionFill`'s ghost, and the whole mesh (every quad any sample
 * along the path ever touched) is resolved and submitted in one shot at the
 * end, not incrementally while dragging.
 */
interface BrushSession {
  readonly origin: ConstructionPosition;
  readonly mesh: QuadMesh;
  /** Stable per session, index-aligned with `mesh.vertices`. Assigned once at session start, never regenerated. */
  readonly vertexIds: readonly ConstructionNodeId[];
  /** `vertexIds` as a set -- lets `revealNear` exclude this session's own (possibly already-submitted) nodes from its own weld candidates. Without this, a not-yet-resolved vertex could weld onto an *already-resolved neighbour from this same mesh* once an earlier tick has committed it, collapsing two distinct local vertices into one id and producing a duplicate-cornered surface. Cross-stroke merging is the goal; self-merging is a bug. */
  readonly ownIds: ReadonlySet<ConstructionNodeId>;
  /** Precomputed once from the heightmap, index-aligned with `mesh.vertices`. */
  readonly vertexHeights: readonly number[];
  /** The id actually used for a vertex once resolved -- `vertexIds[i]` normally, or a different pre-existing node's id if this vertex happened to weld onto something from an earlier stroke. `undefined` until first revealed. */
  readonly effectiveId: (ConstructionNodeId | undefined)[];
  /** Which quads (by index into `mesh.quads`) already have a surface submitted -- revisiting the same area mid-stroke must not resubmit them. */
  readonly submittedQuads: Set<number>;
  /** Existing (cross-session) node ids this session has already welded onto, so a second vertex of the *same* session can't also claim one -- two of this session's own corners collapsing onto one pre-existing node would produce a degenerate (repeated-corner) surface cycle. */
  readonly claimedExternalIds: Set<ConstructionNodeId>;
}

const TERRAIN_COLOR: Record<TerrainSculptParams["targetSurface"], number> = {
  terrain: 0x334155,
  "terrain-grass": 0x4a7a4a,
};

/** Resolution of the sampled heightmap -- plenty for smooth variation across one stroke's mesh; does not need to match vertex count. */
const HEIGHTMAP_RESOLUTION = 16;

/** Physical edge length of one triangle in the hex lattice -- world-space scale of one cell. */
const HEX_TRIANGLE_SIDE = 2;

/** How far from a given gesture sample a quad counts as "under the brush" and gets revealed. Roughly one cell's reach, so a slow drag reveals a smooth trail rather than jumping in large clumps. */
const REVEAL_RADIUS = HEX_TRIANGLE_SIDE * 1.5;

/**
 * How close (XZ only) a vertex -- boundary or interior -- must land to an
 * existing node from a *different* stroke/seed before reusing that id
 * instead of creating a new one. Height is excluded on purpose -- see
 * `terrain-sculpt-tool.ts`'s own module doc for why.
 *
 * Sized relative to `HEX_TRIANGLE_SIDE`: after `ortho()` subdivides, adjacent
 * vertices within one hexagon sit roughly `HEX_TRIANGLE_SIDE / 2` apart, so
 * the radius has to stay well under that or it risks catching the *wrong*
 * neighbouring vertex from the same mesh instead of the intended one from
 * another stroke. `0.3` leaves comfortable headroom under that `1.0` spacing
 * while still being generous enough to catch the kind of by-eye misalignment
 * two arbitrary, unsnapped click positions produce.
 */
const CROSS_SESSION_WELD_EPSILON = HEX_TRIANGLE_SIDE * 0.3;

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly spanX: number;
  readonly spanY: number;
}

function boundsOf(vertices: readonly Vec2[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
  }
  return { minX, minY, spanX: maxX - minX || 1, spanY: maxY - minY || 1 };
}

/**
 * Bilinear sample of a flat row-major heightmap at a normalized `(u, v)` --
 * ported from `apps/architecture-studio/src/vtt/stacked-terrain.ts`'s
 * `sampleHeightfield` (same reasoning: the grid is irregular and the noise
 * source is not, so nothing lines a vertex up with a sample; bilinear rather
 * than nearest keeps a real step between adjacent vertices' samples).
 */
function sampleHeightmapBilinear(heightmap: Float32Array, resolution: number, u: number, v: number): number {
  const x = Math.min(Math.max(u, 0), 1) * (resolution - 1);
  const y = Math.min(Math.max(v, 0), 1) * (resolution - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, resolution - 1);
  const y1 = Math.min(y0 + 1, resolution - 1);
  const fx = x - x0;
  const fy = y - y0;

  const at = (column: number, row: number) => heightmap[row * resolution + column] ?? 0;
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

function nodeId(ctx: ToolContext, salt: number, vertexIndex: number): ConstructionNodeId {
  return `${ctx.tableId}:terrain-sculpt-${salt}:v${vertexIndex}`;
}

/** An existing node from *outside* this session (another stroke, the seeded terrain, a wall) to weld onto if a vertex happens to land on it. */
interface ExistingNode {
  readonly id: ConstructionNodeId;
  readonly x: number;
  readonly z: number;
}

function nearestExisting(
  x: number,
  z: number,
  existing: readonly ExistingNode[],
  exclude: ReadonlySet<ConstructionNodeId>,
): ConstructionNodeId | undefined {
  let best: ExistingNode | undefined;
  let bestDistanceSq = CROSS_SESSION_WELD_EPSILON * CROSS_SESSION_WELD_EPSILON;
  for (const candidate of existing) {
    if (exclude.has(candidate.id)) continue;
    const dx = candidate.x - x;
    const dz = candidate.z - z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq <= bestDistanceSq) {
      best = candidate;
      bestDistanceSq = distanceSq;
    }
  }
  return best?.id;
}

function startSession(
  ctx: ToolContext,
  origin: ConstructionPosition,
  params: TerrainSculptParams,
): BrushSession {
  const salt = ctx.nextSequence();
  const mesh = buildIrregularQuadGrid({
    seed: Math.floor(params.seed) || 1,
    trianglesPerSide: Math.max(1, Math.round(params.trianglesPerSide)),
    triangleSide: HEX_TRIANGLE_SIDE,
    // `relax()`'s own `strength` is "how hard cells get pulled toward
    // square" -- inverted here so the UI's "irregularidade" reads the
    // intuitive way (higher = more organic, not more regular).
    strength: 1 - Math.min(Math.max(params.irregularity, 0), 1),
  });
  const heightmap = ctx.runtime.generateHeightmap(
    HEIGHTMAP_RESOLUTION,
    HEIGHTMAP_RESOLUTION,
    Math.floor(params.seed) || 1,
    params.noiseScale,
  );
  const bounds = boundsOf(mesh.vertices);
  const vertexHeights = mesh.vertices.map((vertex) => {
    const u = (vertex.x - bounds.minX) / bounds.spanX;
    const v = (vertex.y - bounds.minY) / bounds.spanY;
    return sampleHeightmapBilinear(heightmap, HEIGHTMAP_RESOLUTION, u, v) * params.heightScale;
  });
  const vertexIds = mesh.vertices.map((_, index) => nodeId(ctx, salt, index));
  return {
    origin,
    mesh,
    vertexIds,
    ownIds: new Set(vertexIds),
    vertexHeights,
    effectiveId: new Array(mesh.vertices.length).fill(undefined),
    submittedQuads: new Set(),
    claimedExternalIds: new Set(),
  };
}

/**
 * Resolves (into `newNodes`/`newSurfaces`, not submitted here) every
 * not-yet-resolved quad of `session.mesh` whose centroid falls within
 * {@link REVEAL_RADIUS} of `point`. A vertex is resolved (id assigned, and
 * added as a real node unless it welds onto pre-existing geometry) the first
 * time any revealed quad touches it -- every quad after that reuses the same
 * resolved id, which is what keeps the whole stroke one connected mesh.
 * Called once per gesture sample from `onPointerUp`, accumulating into the
 * same two arrays, so the whole gesture submits as one batch.
 */
function revealNear(
  ctx: ToolContext,
  session: BrushSession,
  point: ConstructionPosition,
  params: TerrainSculptParams,
  newNodes: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[],
  newSurfaces: ConstructionSurfaceSpec[],
): void {
  // What the brush's own reach already tells us: any existing node farther
  // than one dab's radius (plus weld slack) from `point` cannot possibly be
  // touched by anything this call reveals, so there is no reason to check it
  // -- this *is* "project the brush area, find which existing points it
  // hits" applied directly, not a separate pass. Filtering here also keeps
  // the candidate list small regardless of how much geometry exists
  // elsewhere on the table.
  const searchRadius = REVEAL_RADIUS + CROSS_SESSION_WELD_EPSILON;
  const searchRadiusSq = searchRadius * searchRadius;
  const existing: readonly ExistingNode[] = [...ctx.runtime.getSnapshot().map.nodePositions.values()]
    .filter((entry) => {
      // This session's own nodes are never a weld target for its own
      // not-yet-resolved vertices -- see `ownIds`'s own doc for why.
      if (session.ownIds.has(entry.nodeRef)) return false;
      const dx = entry.position.x - point.x;
      const dz = entry.position.z - point.z;
      return dx * dx + dz * dz <= searchRadiusSq;
    })
    .map((entry) => ({ id: entry.nodeRef, x: entry.position.x, z: entry.position.z }));

  const resolve = (vertexIndex: number): ConstructionNodeId | undefined => {
    const already = session.effectiveId[vertexIndex];
    if (already !== undefined) return already;
    const local = session.mesh.vertices[vertexIndex];
    if (local === undefined) return undefined;
    const worldX = session.origin.x + local.x;
    const worldZ = session.origin.z + local.y;
    // No boundary/interior distinction here on purpose: a second stroke
    // painted *over* the middle of an earlier one needs its interior
    // vertices to merge with the earlier mesh just as much as its edges do
    // -- restricting this to boundary-only misses exactly that case.
    const welded = nearestExisting(worldX, worldZ, existing, session.claimedExternalIds);
    const id = welded ?? session.vertexIds[vertexIndex];
    if (id === undefined) return undefined;
    session.effectiveId[vertexIndex] = id;
    if (welded === undefined) {
      const height = session.vertexHeights[vertexIndex] ?? 0;
      newNodes.push({ id, position: { x: worldX, y: height, z: worldZ } });
    } else {
      // Claimed for the rest of this session, so a second vertex of the
      // *same* mesh can't also collapse onto it -- see `claimedExternalIds`'s
      // own doc for why that would otherwise produce a degenerate cycle.
      session.claimedExternalIds.add(welded);
    }
    return id;
  };

  session.mesh.quads.forEach((quad, quadIndex) => {
    if (session.submittedQuads.has(quadIndex)) return;

    let centroidX = 0;
    let centroidZ = 0;
    let cornerCount = 0;
    for (const vertexIndex of quad) {
      const local = session.mesh.vertices[vertexIndex];
      if (local === undefined) continue;
      centroidX += session.origin.x + local.x;
      centroidZ += session.origin.z + local.y;
      cornerCount += 1;
    }
    if (cornerCount === 0) return;
    centroidX /= cornerCount;
    centroidZ /= cornerCount;
    const dx = centroidX - point.x;
    const dz = centroidZ - point.z;
    if (dx * dx + dz * dz > REVEAL_RADIUS * REVEAL_RADIUS) return;

    const cycle = quad.map((vertexIndex) => resolve(vertexIndex)).filter((id): id is ConstructionNodeId => id !== undefined);
    if (cycle.length !== quad.length) return;
    // Two of this quad's corners can still collapse onto the same id if a
    // boundary weld fires on more than one of them at once (e.g. two
    // adjacent boundary vertices both land within range of the same
    // pre-existing node) -- submitting that cycle would be a degenerate,
    // repeated-corner surface, so skip it rather than let the WASM side reject it.
    if (new Set(cycle).size !== cycle.length) return;

    session.submittedQuads.add(quadIndex);
    newSurfaces.push({ cycle, surfaceType: params.targetSurface, physical: true });
  });
}

/**
 * How big the lattice needs to be to guarantee it covers wherever this
 * gesture actually went -- the area comes from the brush's own swept path,
 * never from an independent terrain-side size guess. Only possible because
 * the whole gesture is known before the mesh is built (single commit on
 * release, not a live per-tick reveal that had to pre-guess an upper bound
 * before the drag was even finished): `params.trianglesPerSide` still acts
 * as a floor, so a deliberately large single dab still gets its full
 * requested size, but a long drag can never silently run past a
 * pre-committed size the way it used to.
 */
function latticeTrianglesPerSideFor(gesture: ToolGesture, params: TerrainSculptParams): number {
  const origin = gesture.start.point;
  let maxDistance = 0;
  for (const sample of gesture.samples) {
    const dx = sample.point.x - origin.x;
    const dz = sample.point.z - origin.z;
    maxDistance = Math.max(maxDistance, Math.hypot(dx, dz));
  }
  const neededRadius = maxDistance + REVEAL_RADIUS + CROSS_SESSION_WELD_EPSILON;
  const neededTrianglesPerSide = Math.ceil(neededRadius / HEX_TRIANGLE_SIDE);
  return Math.max(1, Math.round(params.trianglesPerSide), neededTrianglesPerSide);
}

/**
 * Every region the stroke's own swept area touches, asked of the engine once
 * per disjoint piece of that area and merged by identity.
 *
 * The footprint is the very shape the drag ghost showed
 * (`brushSweptOutlinePolygons` is shared with the preview), so the stroke
 * never affects ground the user was not shown.
 */
function coveredByStroke(ctx: ToolContext, gesture: ToolGesture): readonly ConstructionCoveredRegion[] {
  const merged = new Map<string, ConstructionCoveredRegion>();
  for (const polygon of brushSweptOutlinePolygons(gesture.samples.map((sample) => sample.point), REVEAL_RADIUS)) {
    const ring = polygon[0];
    if (ring === undefined || ring.length < 3) continue;
    for (const region of ctx.runtime.getFootprintCoverage(ring)) {
      merged.set(region.surfaceKey.join(" "), region);
    }
  }
  return [...merged.values()];
}

interface ResolvedPatch {
  readonly nodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[];
  readonly surfaces: readonly ConstructionSurfaceSpec[];
}

/**
 * Turns resolved face cycles into a patch whose neighbours share their
 * boundary edges.
 *
 * The edge between two nodes is named after the *pair*, in a fixed order, so
 * both faces that meet on it derive the same name and end up referencing one
 * edge used twice. Letting each face mint its own (which is what submitting
 * bare cycles does) produces two coincident edges used once each: visually
 * identical, structurally unconnected, and with no free-versus-shared
 * distinction left for {@link ToolContext.runtime.getUnfilledLoops} to read.
 *
 * A face keeps its cycle-derived region id, so painting the same ground
 * twice still resolves to the same identity and is skipped rather than
 * duplicated.
 */
function toPatch(
  ctx: ToolContext,
  nodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[],
  surfaces: readonly ConstructionSurfaceSpec[],
): ConstructionPatch {
  // A boundary with a face on both sides is interior ground, and terrain is
  // never created above anything -- so a face that finds its edge full is
  // meant to be refused, not rescued with an edge of its own. The rim it
  // leaves is what `fillUnfilledLoops` reads.
  const edges = createBoundaryEdges(ctx.tableId, { kind: "refuse-when-full" });
  const regions: ConstructionPatchRegion[] = [];

  for (const surface of surfaces) {
    const boundary: ConstructionOrientedEdgeUse[] = [];
    for (let index = 0; index < surface.cycle.length; index += 1) {
      const from = surface.cycle[index];
      const to = surface.cycle[(index + 1) % surface.cycle.length];
      if (from === undefined || to === undefined) continue;
      boundary.push(edges.use(from, to));
    }
    if (boundary.length !== surface.cycle.length) continue;
    regions.push({
      regionId: surface.cycle.join("|"),
      boundary,
      surfaceType: surface.surfaceType,
      physical: surface.physical,
    });
  }

  return { nodes, edges: edges.all(), regions };
}

/**
 * Fills every closed loop of boundary *this stroke's own region* leaves
 * uncovered.
 *
 * A face this stroke declined -- degenerate, welded onto ground that already
 * had one, refused by a rule -- leaves a gap whose rim its neighbours still
 * hold. Those are the visible holes in the terrain, and they are recoverable
 * without knowing why each one happened: the engine reports the loops, each
 * already oriented for the face that closes it, so filling one is a plain
 * region registration that adds no edge and no node.
 *
 * `scope` is the whole point. The brush already knows every node it touched,
 * so the search never has to be a sweep of the map -- and must not be one: a
 * closed loop with no face somewhere the brush never went is somebody else's
 * shape, and paving it over because a stroke happened elsewhere is a bug,
 * not a repair. Confined to the stroke, the only loops in play are the ones
 * it just bounded, and its own outline is among them -- that one encloses
 * the others rather than being enclosed, so an unbroken stroke fills
 * nothing and simply creates as it always did.
 *
 * A hole a region *declared* -- a doorway, a courtyard -- is not reported
 * and so is never sealed; that exclusion lives in the engine.
 */
function fillUnfilledLoops(
  ctx: ToolContext,
  scope: readonly ConstructionNodeId[],
  surfaceType: string,
  causeId: string,
): number {
  const loops = ctx.runtime.getUnfilledLoops(scope);
  if (loops.length === 0) return 0;
  ctx.runtime.addPatch(
    {
      nodes: [],
      edges: [],
      regions: loops.map((loop) => ({
        regionId: loop.nodeIds.join("|"),
        boundary: loop.boundary,
        ...matchTheGroundAround(loop.neighbours, surfaceType),
      })),
    },
    "local",
    causeId,
  );
  return loops.length;
}

/**
 * What to make a gap out of: whatever most of the faces around it are made
 * of, falling back to the brush's own target when it has no neighbours to
 * copy.
 *
 * Filling with the *selected* type instead is what leaves a mended gap a
 * different colour from the ground it sits in -- paint grass, pass over an
 * older slate patch to close a hole in it, and the patch comes back with a
 * green tile in the middle. The stroke never retypes ground it merely passes
 * over (raising only moves Y), so a gap inside that ground must not be
 * retyped either. A gap inside terrain this same stroke generated has that
 * type on every side anyway, so the two cases agree.
 */
function matchTheGroundAround(
  neighbours: readonly { readonly surfaceType: string; readonly physical: boolean }[],
  fallback: string,
): { readonly surfaceType: string; readonly physical: boolean } {
  const tally = new Map<string, { count: number; physical: number }>();
  for (const neighbour of neighbours) {
    const entry = tally.get(neighbour.surfaceType) ?? { count: 0, physical: 0 };
    entry.count += 1;
    if (neighbour.physical) entry.physical += 1;
    tally.set(neighbour.surfaceType, entry);
  }
  let best: { surfaceType: string; count: number; physical: number } | undefined;
  for (const [surfaceType, entry] of tally) {
    if (best === undefined || entry.count > best.count) best = { surfaceType, ...entry };
  }
  if (best === undefined) return { surfaceType: fallback, physical: true };
  // Physical wins a tie: a gap left walk-through in the middle of solid
  // ground is a worse wrong answer than a solid tile in a decorative patch.
  return { surfaceType: best.surfaceType, physical: best.physical * 2 >= best.count };
}

/**
 * Drops every resolved face that, *after welding*, landed on ground that
 * already has one.
 *
 * `blockOccupiedQuads` cannot catch these: it runs before resolution and so
 * tests each quad where the lattice put it, not where welding pulled it.
 * A corner welds to anything within {@link CROSS_SESSION_WELD_EPSILON}, which
 * is a sizeable fraction of one cell, so a quad whose own centre sits just
 * outside an existing face can still have all four corners snap onto that
 * face's nodes -- reproducing it exactly. Submitting that is what raised
 * `an edge already exists with identity ...`: same cycle, same derived
 * region id, same derived edge ids.
 *
 * Testing the welded centroid is the same question asked at the only moment
 * the answer is final. Nodes left unreferenced by the surviving faces are
 * dropped too, so a rejected face cannot leave loose nodes behind.
 */
function pruneFacesOnExistingGround(
  ctx: ToolContext,
  nodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[],
  surfaces: readonly ConstructionSurfaceSpec[],
): ResolvedPatch {
  if (surfaces.length === 0) return { nodes, surfaces };

  const pending = new Map<ConstructionNodeId, ConstructionPosition>();
  for (const node of nodes) pending.set(node.id, node.position);
  const live = ctx.runtime.getSnapshot().map.nodePositions;
  const positionOf = (id: ConstructionNodeId): ConstructionPosition | undefined =>
    pending.get(id) ?? live.get(id)?.position;

  const centroids: [number, number][] = surfaces.map((surface) => {
    let x = 0;
    let z = 0;
    let corners = 0;
    for (const id of surface.cycle) {
      const position = positionOf(id);
      if (position === undefined) continue;
      x += position.x;
      z += position.z;
      corners += 1;
    }
    // A face none of whose corners resolved has no centre to test; NaN
    // never falls inside any polygon, so it survives here and fails loudly
    // later rather than being silently swallowed by this filter.
    return corners === 0 ? [NaN, NaN] : [x / corners, z / corners];
  });

  const occupied = new Set(ctx.runtime.classifyPoints(centroids).map((hit) => hit.index));
  if (occupied.size === 0) return { nodes, surfaces };

  const kept = surfaces.filter((_, index) => !occupied.has(index));
  const referenced = new Set<ConstructionNodeId>();
  for (const surface of kept) for (const id of surface.cycle) referenced.add(id);
  return { nodes: nodes.filter((node) => referenced.has(node.id)), surfaces: kept };
}

/**
 * Marks every lattice quad whose centre already sits inside some region as
 * submitted, so the stroke generates only over open ground.
 *
 * This is what enforces "terrain is never created above anything" precisely,
 * face by face. Refusing the whole stroke because its edge happened to graze
 * a wall was the blunt version of the same rule -- and wrong, since a wall
 * *stands on* terrain and so always overlaps it in XZ.
 */
function blockOccupiedQuads(ctx: ToolContext, session: BrushSession): void {
  const centroids: [number, number][] = [];
  const quadIndices: number[] = [];
  session.mesh.quads.forEach((quad, quadIndex) => {
    let x = 0;
    let z = 0;
    let corners = 0;
    for (const vertexIndex of quad) {
      const local = session.mesh.vertices[vertexIndex];
      if (local === undefined) continue;
      x += session.origin.x + local.x;
      z += session.origin.z + local.y;
      corners += 1;
    }
    if (corners === 0) return;
    centroids.push([x / corners, z / corners]);
    quadIndices.push(quadIndex);
  });
  if (centroids.length === 0) return;

  for (const hit of ctx.runtime.classifyPoints(centroids)) {
    const quadIndex = quadIndices[hit.index];
    if (quadIndex !== undefined) session.submittedQuads.add(quadIndex);
  }
}

/** Terrain-sculpt's own effect: the brush hands over the whole gesture, once, on release -- this resolves every quad any sample along the path touched into one mesh and submits it in a single batch, mirroring `terrain-brush`'s own (deleted) commit-once contract for its cell-by-cell Rust calls. */
export const terrainSculptTool: ConstructionTool<"terrain-sculpt"> = {
  id: "terrain-sculpt",
  defaultParams: () => DEFAULT_TOOL_PARAMS["terrain-sculpt"],

  previewFor(gesture: ToolGesture, params: TerrainSculptParams) {
    return brushSweptRegionFill(
      gesture.samples.map((sample) => sample.point),
      { kind: "circle", radius: REVEAL_RADIUS },
      TERRAIN_COLOR[params.targetSurface],
      0.35,
    );
  },

  // Presence of this hook makes the generic dispatcher capture and sample the drag; the mesh is only ever resolved on release.
  onPointerMove(): void {},

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: TerrainSculptParams): void {
    const causeId = `${ctx.tableId}:terrain-sculpt:${ctx.nextSequence()}`;

    // One stroke does both, per area -- it is not a choice between them.
    // Where ground already exists the covered faces are raised; where it
    // does not, terrain is generated. A stroke uniting two patches spans
    // exactly that mix: it touches both and its middle is empty, so
    // treating the two as alternatives fills nothing.
    //
    // The raise goes first so generation welds onto ground already at its
    // final height. Order is no longer load-bearing the way it was when the
    // raise deleted and recreated the patch -- it now only moves existing
    // nodes, so no id the generator might weld onto is ever invalidated --
    // but a vertex that welds onto the rim still wants the raised Y, not the
    // stale one. Occupancy is unaffected either way: the raise moves ground
    // in Y, never in XZ.
    const covered = coveredByStroke(ctx, gesture);
    const raised =
      covered.length > 0
        ? restackTerrain(ctx, params.targetSurface, covered, causeId)
        : { raisedFaces: 0, movedVertices: 0, skipped: [] };

    // Mend the ground that is already here *before* generating over it, and
    // for two reasons. It is what "pass the brush over a hole to close it"
    // has to mean -- the rim of that hole is already in the map, so closing
    // it is a region registration, never new geometry. And doing it first
    // makes the gap occupied ground, so the lattice below skips it: a fresh
    // lattice is seeded at this gesture's own origin and lands wherever the
    // pointer went, so its vertices do not line up with the older mesh
    // around the hole and only some of them fall close enough to weld. What
    // it would generate there is a quad at its own offset, overlapping the
    // rim instead of meeting it -- more free boundary, not less.
    const existing = new Set<ConstructionNodeId>();
    for (const region of covered) for (const id of region.nodeIds) existing.add(id);
    const mended = fillUnfilledLoops(ctx, [...existing], params.targetSurface, causeId);

    const trianglesPerSide = latticeTrianglesPerSideFor(gesture, params);
    const session = startSession(ctx, gesture.start.point, { ...params, trianglesPerSide });
    blockOccupiedQuads(ctx, session);

    const newNodes: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[] = [];
    const newSurfaces: ConstructionSurfaceSpec[] = [];
    for (const sample of gesture.samples) {
      revealNear(ctx, session, sample.point, params, newNodes, newSurfaces);
    }
    const resolved = pruneFacesOnExistingGround(ctx, newNodes, newSurfaces);
    // A face the engine refuses is one whose boundary had no room -- ground
    // that already has a face on both sides. It costs that face, never the
    // stroke, so the count is reported rather than treated as a failure.
    const outcome =
      resolved.surfaces.length > 0
        ? ctx.runtime.addPatch(toPatch(ctx, resolved.nodes, resolved.surfaces), "local", causeId)
        : undefined;
    const built = outcome?.createdSurfaceKeys.length ?? 0;
    const refused = outcome?.skippedRegionIds.length ?? 0;

    // The region to search for holes: every node this stroke touched, from
    // both halves of it -- the faces it generated and the ones it raised.
    // Taken from the face cycles rather than from `resolved.nodes` because
    // those are only the *new* nodes; a cycle also names the existing ones
    // its corners welded onto, and a gap at the seam between old ground and
    // new is bounded by exactly that mix.
    const touched = new Set<ConstructionNodeId>(existing);
    for (const surface of resolved.surfaces) for (const id of surface.cycle) touched.add(id);
    const filled = mended + fillUnfilledLoops(ctx, [...touched], params.targetSurface, causeId);

    const parts: string[] = [];
    if (built > 0) parts.push(`${built} faces novas`);
    if (filled > 0) parts.push(`${filled} buracos fechados`);
    if (refused > 0) parts.push(`${refused} sobre terreno existente`);
    if (raised.raisedFaces > 0) parts.push(`${raised.raisedFaces} elevadas (${raised.movedVertices} vértices)`);
    if (parts.length === 0) {
      ctx.reportFeedback({
        tone: "info",
        message:
          raised.skipped.length > 0
            ? raised.skipped[0] ?? "Nada a fazer aqui."
            : "Nada a fazer aqui.",
      });
      return;
    }
    ctx.reportFeedback({
      tone: "success",
      message: `Terreno: ${parts.join(", ")}.${raised.skipped.length > 0 ? ` ${raised.skipped[0]}` : ""}`,
    });
  },
};
