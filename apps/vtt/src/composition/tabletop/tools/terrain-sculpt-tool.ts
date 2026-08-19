import { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
import type { TerrainSculptParams } from "@/features/edit-construction";
import type { ConstructionNodeId, ConstructionPosition, ConstructionSurfaceSpec } from "@/ports";

import { buildIrregularQuadGrid, type QuadMesh, type Vec2 } from "./irregular-grid.ts";
import { brushSweptRegionFill } from "./preview-shapes.ts";
import type { ConstructionTool, ToolContext, ToolGesture } from "./tool-context.ts";

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
    const session = startSession(ctx, gesture.start.point, params);
    const newNodes: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[] = [];
    const newSurfaces: ConstructionSurfaceSpec[] = [];
    for (const sample of gesture.samples) {
      revealNear(ctx, session, sample.point, params, newNodes, newSurfaces);
    }
    if (newNodes.length === 0 && newSurfaces.length === 0) {
      ctx.reportFeedback({ tone: "info", message: "Nenhum terreno gerado." });
      return;
    }
    ctx.runtime.applyIrregularTerrainPatch(
      newNodes,
      newSurfaces,
      "local",
      `${ctx.tableId}:terrain-sculpt-reveal:${ctx.nextSequence()}`,
    );
    ctx.reportFeedback({
      tone: "success",
      message: `Terreno gerado: ${newSurfaces.length} superfícies, ${newNodes.length} nós.`,
    });
  },
};
