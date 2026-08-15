import { chunkSurfaceMeshes, CONSTRUCTION_GRID_EXTENT } from "../../adapters/rendering/index.ts";
import {
  applyTokenProjectionDelta,
  createTokenCollection,
  type TokenCollectionProjection,
  type TokenProjection,
  type TokenProjectionDelta,
} from "../../entities/token/index.ts";
import {
  applyMapProjectionDelta,
  createMapProjection,
  createSurfaceProjection,
  surfaceRefFromNodeSet,
  type MapProjection,
} from "../../entities/map/index.ts";
import type {
  AffectedSurfaces,
  CameraControlHandle,
  CameraControlOptions,
  ChangeOrigin,
  ConfirmedTokenRenderChange,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionSessionPort,
  ConstructionSurfaceKey,
  ConstructionSurfaceSpec,
  GenerateTerrainCellRequest,
  GenerateWallRequest,
  RenderMapChunk,
  RenderPreviewDescriptor,
  RenderViewId,
  ScenePickResult,
  SceneRenderMetrics,
  SceneRenderPort,
  SurfaceMeshResult,
  TerrainNoisePort,
  WallPiece,
} from "@/ports";

import { defaultMapSeed } from "./default-map-seed.ts";

/**
 * The one `setTerrainMesh` grid declared per table (`ConstructionSessionPort`
 * requires exactly one call, before any `generateTerrainCell`). `cell`
 * addresses this grid by index (`z * width + x` for layer 0), and each
 * cell's *physical* footprint is fixed by `PrismGridMesh` itself to
 * render-space `X ∈ [x, x+1]`, `Z ∈ [z, z+1]` -- there is no origin/offset
 * parameter anywhere in `ConstructionSessionPort.setTerrainMesh`, so this
 * grid always starts at world `(0, 0)`, not centered like the visible
 * reference grid (`construction-grid-scene-item.ts`, `±CONSTRUCTION_GRID_EXTENT`).
 * `terrain-brush-tool.ts` clamps a click into this positive quadrant, so it
 * is sized to `CONSTRUCTION_GRID_EXTENT` on purpose: that makes the
 * buildable quadrant exactly the positive-X/positive-Z **half** of the
 * visible reference grid, not some arbitrary smaller area a player would
 * have to discover by trial and error. A click in the negative half still
 * clamps to its nearest edge cell rather than erroring -- a real, permanent
 * limit of this API (there is no way to give a `PrismGridMesh` cell a
 * negative position), not something a bigger grid or a client-side offset
 * trick can remove.
 */
export const TERRAIN_GRID_WIDTH = CONSTRUCTION_GRID_EXTENT;
export const TERRAIN_GRID_HEIGHT = CONSTRUCTION_GRID_EXTENT;
export const TERRAIN_GRID_LAYERS = 1;
export const TERRAIN_CELL_COUNT = TERRAIN_GRID_WIDTH * TERRAIN_GRID_HEIGHT * TERRAIN_GRID_LAYERS;

export type TabletopRuntimeStatus = "idle" | "starting" | "ready" | "disposed";

export interface TabletopSnapshot {
  readonly revision: number;
  readonly status: TabletopRuntimeStatus;
  readonly tableId: string;
  readonly tokens: TokenCollectionProjection;
  readonly map: MapProjection;
}

export interface ConfirmedTokenDeltaEnvelope {
  readonly origin: ChangeOrigin;
  readonly causeId: string;
  readonly delta: TokenProjectionDelta;
}

export type TabletopRuntimeListener = () => void;

export interface TabletopRuntime {
  start(): Promise<void>;
  applyConfirmedToken(envelope: ConfirmedTokenDeltaEnvelope): void;
  moveNode(
    nodeId: ConstructionNodeId,
    position: ConstructionPosition,
    origin: ChangeOrigin,
    causeId: string,
  ): AffectedSurfaces;
  generateTerrainCell(
    request: GenerateTerrainCellRequest,
    origin: ChangeOrigin,
    causeId: string,
  ): ConstructionSurfaceKey;
  generateWall(request: GenerateWallRequest, origin: ChangeOrigin, causeId: string): readonly WallPiece[];
  /**
   * Submits a whole batch of nodes and surfaces (e.g. one irregular-terrain
   * hexagon's worth) through the construction session's existing generic
   * `addNode`/`addSurface` operations, then re-derives/re-uploads exactly
   * like `generateTerrainCell`/`generateWall` do. No new Rust/Wasm surface --
   * `ConstructionSessionPort.addNode`/`addSurface` already exist.
   */
  applyIrregularTerrainPatch(
    nodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[],
    surfaces: readonly ConstructionSurfaceSpec[],
    origin: ChangeOrigin,
    causeId: string,
  ): readonly ConstructionSurfaceKey[];
  /**
   * Inserts `nodes` (e.g. a crossing point's bottom/top pair), then splits
   * each existing surface named in `splits` into two new ones through the
   * generic `addNode`/`splitSurface` operations -- no new Rust/Wasm surface.
   * The old surface's projection entry is explicitly removed (unlike
   * `applyIrregularTerrainPatch`'s add-only shape, `splitSurface` always
   * *replaces* what it's given).
   */
  applyWallCrossingSplit(
    nodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[],
    splits: readonly {
      readonly originalKey: ConstructionSurfaceKey;
      readonly first: ConstructionSurfaceSpec;
      readonly second: ConstructionSurfaceSpec;
    }[],
    origin: ChangeOrigin,
    causeId: string,
  ): readonly ConstructionSurfaceKey[];
  /** Passthrough to `TerrainNoisePort.generateHeightmap` -- see that port for parameter meaning. */
  generateHeightmap(width: number, height: number, seed: number, scale: number): Float32Array;
  pick(viewId: RenderViewId, x: number, y: number): ScenePickResult | undefined;
  /** Shows a construction tool's not-yet-committed ghost. Purely visual -- passthrough to `SceneRenderPort`, never touches the construction session. */
  showPreview(descriptor: RenderPreviewDescriptor): void;
  /** Hides the active tool preview, if any. */
  clearPreview(): void;
  attachView(target: HTMLElement): RenderViewId;
  detachView(viewId: RenderViewId): void;
  resizeView(viewId: RenderViewId, width: number, height: number): void;
  attachCameraControls(
    viewId: RenderViewId,
    element: HTMLElement,
    options?: CameraControlOptions,
  ): CameraControlHandle;
  getRenderMetrics(): SceneRenderMetrics;
  getSnapshot(): TabletopSnapshot;
  subscribe(listener: TabletopRuntimeListener): () => void;
  dispose(): Promise<void>;
}

function snapshot(
  tableId: string,
  status: TabletopRuntimeStatus,
  revision: number,
  tokens: TokenCollectionProjection,
  map: MapProjection,
): TabletopSnapshot {
  return Object.freeze({ revision, status, tableId, tokens, map });
}

function renderChange(
  envelope: ConfirmedTokenDeltaEnvelope,
  runtimeGeneration: number,
): ConfirmedTokenRenderChange {
  if (envelope.delta.type === "token-removed") {
    return {
      type: "token-removed",
      origin: envelope.origin,
      causeId: envelope.causeId,
      runtimeGeneration,
      dependency: {
        layer: "tokens",
        scopeId: envelope.delta.tokenId,
        revision: envelope.delta.revision,
      },
      tokenId: envelope.delta.tokenId,
    };
  }

  const token = envelope.delta.token;
  return {
    type: "token-upserted",
    origin: envelope.origin,
    causeId: envelope.causeId,
    runtimeGeneration,
    dependency: {
      layer: "tokens",
      scopeId: token.id,
      revision: token.revision,
    },
    token: {
      id: token.id,
      position: token.position,
      appearance: token.appearance,
    },
  };
}

export class AppTabletopRuntime implements TabletopRuntime {
  readonly #listeners = new Set<TabletopRuntimeListener>();
  readonly #tableId: string;
  readonly #render: SceneRenderPort;
  readonly #construction: ConstructionSessionPort;
  readonly #terrainNoise: TerrainNoisePort;
  /** Last uploaded revision per `RenderMapChunk.chunkId`, so a re-chunk after an edit can tell which chunk ids fell out and must be removed. */
  readonly #chunkRevisions = new Map<string, number>();
  /** Last uploaded revision per node handle, mirroring `#chunkRevisions` but for the `"handles"` render layer. */
  readonly #nodeHandleRevisions = new Map<string, number>();
  #generation = 0;
  #snapshot: TabletopSnapshot;

  constructor(
    tableId: string,
    render: SceneRenderPort,
    construction: ConstructionSessionPort,
    terrainNoise: TerrainNoisePort,
    initialTokens: readonly TokenProjection[] = [],
  ) {
    const normalizedTableId = tableId.trim();
    if (normalizedTableId.length === 0) {
      throw new Error("tableId must not be empty");
    }

    this.#tableId = normalizedTableId;
    this.#render = render;
    this.#construction = construction;
    this.#terrainNoise = terrainNoise;
    this.#snapshot = snapshot(
      this.#tableId,
      "idle",
      0,
      createTokenCollection(initialTokens),
      createMapProjection(),
    );
  }

  async start(): Promise<void> {
    if (this.#snapshot.status === "starting" || this.#snapshot.status === "ready") {
      throw new Error(`tabletop runtime is already ${this.#snapshot.status}`);
    }

    const generation = ++this.#generation;
    this.#publishLifecycle("starting");
    await this.#render.start(generation);
    await this.#construction.start();
    await this.#terrainNoise.start();

    if (generation !== this.#generation) return;

    for (const token of this.#snapshot.tokens.byId.values()) {
      this.#render.applyConfirmed(
        renderChange(
          {
            origin: "programmatic",
            causeId: `table-load:${this.#tableId}`,
            delta: { type: "token-upserted", token },
          },
          generation,
        ),
      );
    }

    const map = this.#seedDefaultMap(generation);
    this.#snapshot = snapshot(
      this.#tableId,
      this.#snapshot.status,
      this.#snapshot.revision,
      this.#snapshot.tokens,
      map,
    );
    this.#publishLifecycle("ready");
  }

  /**
   * Generates one terrain cell and one wall-with-door through the real
   * construction engine and renders them -- the same role the guide token
   * plays for `entities/token`, so `pnpm nx run vtt:dev` shows map geometry
   * without waiting on `E3.7`'s edit-mode UI. Every seeded surface starts
   * at revision 1; there is no earlier revision to invalidate.
   */
  #seedDefaultMap(generation: number): MapProjection {
    const { terrainCell, wall } = defaultMapSeed(this.#tableId, "system");
    this.#construction.setTerrainMesh(TERRAIN_GRID_WIDTH, TERRAIN_GRID_HEIGHT, TERRAIN_GRID_LAYERS, "surface", 0, 0);
    const terrainKey = this.#construction.generateTerrainCell(terrainCell.payload);
    const wallPieces = this.#construction.generateWall(wall.payload);

    const meshes = this.#construction.getAllSurfaceMeshes();
    const causeId = `table-load:${this.#tableId}`;
    this.#uploadMapChunks(chunkSurfaceMeshes(meshes), "programmatic", causeId, generation);

    const surfaceKeys = [terrainKey, ...wallPieces.map((piece) => piece.surfaceKey)];
    let map = this.#foldAffectedSurfaces(createMapProjection(), surfaceKeys, meshes);
    map = this.#foldDiscoveredNodePositions(map, "programmatic", causeId, generation);
    return map;
  }

  /**
   * Uploads every currently-chunked piece of map geometry and removes any
   * previously-uploaded chunk id that no longer appears -- required because
   * `chunkSurfaceMeshes` merges every surface landing in one spatial bucket
   * into a single buffer per {@link SceneRenderPort.applyConfirmed} call, so
   * a stale bucket cannot be corrected by re-uploading only the surface that
   * moved out of it. Re-deriving and re-chunking every surface on each edit
   * (rather than patching just the affected ones) is deliberately simple:
   * nothing in this map's current scale needs finer-grained chunk diffing
   * yet (`E1.1` found query/traversal cheap well past this map's size).
   */
  #uploadMapChunks(
    chunks: readonly RenderMapChunk[],
    origin: ChangeOrigin,
    causeId: string,
    generation: number,
  ): void {
    const nextChunkIds = new Set<string>();
    for (const chunk of chunks) {
      nextChunkIds.add(chunk.chunkId);
      const revision = (this.#chunkRevisions.get(chunk.chunkId) ?? 0) + 1;
      this.#chunkRevisions.set(chunk.chunkId, revision);
      this.#render.applyConfirmed({
        type: "map-chunk-upserted",
        origin,
        causeId,
        runtimeGeneration: generation,
        dependency: { layer: "terrain", scopeId: chunk.chunkId, revision },
        chunk,
      });
    }

    for (const [chunkId, revision] of [...this.#chunkRevisions]) {
      if (nextChunkIds.has(chunkId)) continue;
      this.#render.applyConfirmed({
        type: "map-chunk-removed",
        origin,
        causeId,
        runtimeGeneration: generation,
        dependency: { layer: "terrain", scopeId: chunkId, revision: revision + 1 },
        chunkId,
      });
      this.#chunkRevisions.delete(chunkId);
    }
  }

  /** Uploads one node's pickable handle at its current position, mirroring `#uploadMapChunks`'s revision-guard bookkeeping but per-node rather than per-chunk. */
  #uploadNodeHandle(
    nodeId: ConstructionNodeId,
    position: ConstructionPosition,
    origin: ChangeOrigin,
    causeId: string,
    generation: number,
  ): void {
    const revision = (this.#nodeHandleRevisions.get(nodeId) ?? 0) + 1;
    this.#nodeHandleRevisions.set(nodeId, revision);
    this.#render.applyConfirmed({
      type: "node-handle-upserted",
      origin,
      causeId,
      runtimeGeneration: generation,
      dependency: { layer: "handles", scopeId: nodeId, revision },
      handle: { nodeId, position },
    });
  }

  /** Upserts every surface key that just changed (or is brand new) into `map`, using its freshly re-derived mesh for shape/type/physical. Shared by every mutation that reports which surfaces it touched. */
  #foldAffectedSurfaces(
    map: MapProjection,
    surfaceKeys: readonly ConstructionSurfaceKey[],
    meshes: readonly SurfaceMeshResult[],
  ): MapProjection {
    let next = map;
    for (const surfaceKey of surfaceKeys) {
      const surfaceRef = surfaceRefFromNodeSet(surfaceKey);
      const mesh = meshes.find((candidate) => surfaceRefFromNodeSet(candidate.surfaceKey) === surfaceRef);
      if (mesh === undefined) continue;
      const previous = next.byId.get(surfaceRef);
      next = applyMapProjectionDelta(next, {
        type: "surface-upserted",
        surface: createSurfaceProjection({
          surfaceRef,
          orderedNodeRefs: mesh.surfaceKey,
          type: mesh.surfaceType,
          physical: mesh.physical,
          revision: (previous?.revision ?? 0) + 1,
        }),
      });
    }
    return next;
  }

  /**
   * Diffs a full `getNodePositions()` against `map`'s cached positions and
   * folds in (and uploads a handle for) anything that changed -- the only
   * way to discover a newly-generated cell/wall's node positions, since the
   * Rust engine computes those internally from cell-index/wall-geometry
   * rather than the caller supplying them. Not used by {@link moveNode},
   * which already knows its target position directly and would rather not
   * pay for a full re-scan to rediscover it.
   */
  #foldDiscoveredNodePositions(
    map: MapProjection,
    origin: ChangeOrigin,
    causeId: string,
    generation: number,
  ): MapProjection {
    let next = map;
    for (const node of this.#construction.getNodePositions()) {
      const previous = next.nodePositions.get(node.id);
      if (
        previous !== undefined &&
        previous.position.x === node.position.x &&
        previous.position.y === node.position.y &&
        previous.position.z === node.position.z
      ) {
        continue;
      }
      next = applyMapProjectionDelta(next, {
        type: "node-moved",
        nodeRef: node.id,
        position: node.position,
        revision: (previous?.revision ?? 0) + 1,
      });
      this.#uploadNodeHandle(node.id, node.position, origin, causeId, generation);
    }
    return next;
  }

  /**
   * Requires a ready runtime for a construction mutation, naming the caller's
   * own action in the error so `moveNode`/`generateTerrainCell`/`generateWall`
   * each keep a distinct, readable message despite sharing this guard.
   */
  #requireReady(action: string): void {
    if (this.#snapshot.status !== "ready") {
      throw new Error(`${action} requires a ready tabletop runtime`);
    }
  }

  /**
   * The sequence every construction mutation shares once the engine call
   * itself has already run: re-derive and re-upload every chunk (see
   * {@link AppTabletopRuntime.#uploadMapChunks}), fold `surfaceKeys` into the
   * cached `MapProjection`, let the caller fold in whatever node-position
   * change its own mutation implies (a full re-scan for a newly-generated
   * cell/wall, or a direct known-position fold for a move -- see
   * {@link AppTabletopRuntime.#foldDiscoveredNodePositions}'s own doc comment
   * for why those differ), then bump the snapshot revision and notify.
   */
  #applyConstructionMutation(
    surfaceKeys: readonly ConstructionSurfaceKey[],
    origin: ChangeOrigin,
    causeId: string,
    foldNodePositions: (map: MapProjection) => MapProjection,
  ): void {
    const meshes = this.#construction.getAllSurfaceMeshes();
    this.#uploadMapChunks(chunkSurfaceMeshes(meshes), origin, causeId, this.#generation);

    let map = this.#foldAffectedSurfaces(this.#snapshot.map, surfaceKeys, meshes);
    map = foldNodePositions(map);

    this.#snapshot = snapshot(
      this.#tableId,
      this.#snapshot.status,
      this.#snapshot.revision + 1,
      this.#snapshot.tokens,
      map,
    );
    this.#notify();
  }

  /**
   * Moves an existing construction node to an absolute position through the
   * real engine, then re-derives and re-uploads every chunk and folds the
   * affected surfaces plus the moved node's own new position into the cached
   * `MapProjection`. Returns the engine's own `AffectedSurfaces` so a caller
   * (e.g. an undo/redo stack) can see what else changed.
   */
  moveNode(
    nodeId: ConstructionNodeId,
    position: ConstructionPosition,
    origin: ChangeOrigin,
    causeId: string,
  ): AffectedSurfaces {
    this.#requireReady("moving a node");

    const affected = this.#construction.moveNode(nodeId, position);
    this.#applyConstructionMutation(affected.affectedSurfaceKeys, origin, causeId, (map) => {
      const previousNode = map.nodePositions.get(nodeId);
      const next = applyMapProjectionDelta(map, {
        type: "node-moved",
        nodeRef: nodeId,
        position,
        revision: (previousNode?.revision ?? 0) + 1,
      });
      this.#uploadNodeHandle(nodeId, position, origin, causeId, this.#generation);
      return next;
    });
    return affected;
  }

  /**
   * Generates one more terrain cell through the real engine and folds it
   * into the running map -- the edit-mode UI's "add terrain" trigger,
   * distinct from {@link AppTabletopRuntime.#seedDefaultMap}'s one-time
   * bootstrap call.
   */
  generateTerrainCell(
    request: GenerateTerrainCellRequest,
    origin: ChangeOrigin,
    causeId: string,
  ): ConstructionSurfaceKey {
    this.#requireReady("generating terrain");

    const surfaceKey = this.#construction.generateTerrainCell(request);
    this.#applyConstructionMutation([surfaceKey], origin, causeId, (map) =>
      this.#foldDiscoveredNodePositions(map, origin, causeId, this.#generation),
    );
    return surfaceKey;
  }

  /** Generates one more wall (and its door) through the real engine and folds every piece into the running map. */
  generateWall(request: GenerateWallRequest, origin: ChangeOrigin, causeId: string): readonly WallPiece[] {
    this.#requireReady("generating a wall");

    const pieces = this.#construction.generateWall(request);
    this.#applyConstructionMutation(
      pieces.map((piece) => piece.surfaceKey),
      origin,
      causeId,
      (map) => this.#foldDiscoveredNodePositions(map, origin, causeId, this.#generation),
    );
    return pieces;
  }

  applyIrregularTerrainPatch(
    nodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[],
    surfaces: readonly ConstructionSurfaceSpec[],
    origin: ChangeOrigin,
    causeId: string,
  ): readonly ConstructionSurfaceKey[] {
    this.#requireReady("applying an irregular terrain patch");

    for (const node of nodes) this.#construction.addNode(node.id, node.position);

    // A duplicate node-set is an *expected* outcome of the irregular-terrain
    // brush's own merge strategy -- `irregular-terrain-tool.ts`'s `revealNear`
    // deliberately welds a new stroke's vertices onto nearby existing nodes,
    // so two overlapping strokes (or two overlapping dabs of the same
    // stroke) can legitimately compute the exact same cycle twice. If a
    // surface for that cycle already exists, that surface already *is* the
    // connected geometry this call wanted -- nothing to add, nothing wrong.
    // Each surface gets its own attempt (not one `.map()` that aborts the
    // whole batch on the first failure) so one redundant cycle can't also
    // silently drop every surface queued after it in the same call.
    const surfaceKeys: ConstructionSurfaceKey[] = [];
    for (const spec of surfaces) {
      try {
        surfaceKeys.push(this.#construction.addSurface(spec));
      } catch (error) {
        // The Rust side throws a bare `JsValue::from_str` for this, not a
        // wrapped `Error` -- see `session.rs`'s `to_js_error` -- so a plain
        // string is the normal shape here, not just a defensive fallback.
        const message = typeof error === "string" ? error : error instanceof Error ? error.message : undefined;
        const isDuplicate = message !== undefined && message.includes("a surface already exists for node set");
        if (!isDuplicate) throw error;
      }
    }

    this.#applyConstructionMutation(surfaceKeys, origin, causeId, (map) =>
      this.#foldDiscoveredNodePositions(map, origin, causeId, this.#generation),
    );
    return surfaceKeys;
  }

  applyWallCrossingSplit(
    nodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[],
    splits: readonly {
      readonly originalKey: ConstructionSurfaceKey;
      readonly first: ConstructionSurfaceSpec;
      readonly second: ConstructionSurfaceSpec;
    }[],
    origin: ChangeOrigin,
    causeId: string,
  ): readonly ConstructionSurfaceKey[] {
    this.#requireReady("splitting a wall at a crossing");

    for (const node of nodes) this.#construction.addNode(node.id, node.position);

    const newKeys: ConstructionSurfaceKey[] = [];
    const removedRefs: string[] = [];
    for (const split of splits) {
      const outcome = this.#construction.splitSurface(split.originalKey, split.first, split.second);
      newKeys.push(outcome.firstKey, outcome.secondKey);
      removedRefs.push(surfaceRefFromNodeSet(split.originalKey));
    }

    this.#applyConstructionMutation(newKeys, origin, causeId, (map) => {
      let next = map;
      for (const removedRef of removedRefs) {
        const previous = next.byId.get(removedRef);
        if (previous === undefined) continue;
        next = applyMapProjectionDelta(next, {
          type: "surface-removed",
          surfaceRef: removedRef,
          revision: previous.revision + 1,
        });
      }
      return this.#foldDiscoveredNodePositions(next, origin, causeId, this.#generation);
    });
    return newKeys;
  }

  applyConfirmedToken(envelope: ConfirmedTokenDeltaEnvelope): void {
    if (this.#snapshot.status !== "ready") {
      throw new Error("confirmed token changes require a ready tabletop runtime");
    }
    const tokens = applyTokenProjectionDelta(this.#snapshot.tokens, envelope.delta);
    if (tokens === this.#snapshot.tokens) return;

    this.#render.applyConfirmed(renderChange(envelope, this.#generation));
    this.#snapshot = snapshot(
      this.#tableId,
      this.#snapshot.status,
      this.#snapshot.revision + 1,
      tokens,
      this.#snapshot.map,
    );
    this.#notify();
  }

  pick(viewId: RenderViewId, x: number, y: number): ScenePickResult | undefined {
    return this.#render.pick(viewId, x, y);
  }

  showPreview(descriptor: RenderPreviewDescriptor): void {
    this.#render.showPreview(descriptor);
  }

  clearPreview(): void {
    this.#render.clearPreview();
  }

  generateHeightmap(width: number, height: number, seed: number, scale: number): Float32Array {
    return this.#terrainNoise.generateHeightmap(width, height, seed, scale);
  }

  attachView(target: HTMLElement): RenderViewId {
    if (this.#snapshot.status !== "ready") {
      throw new Error("a render view requires a ready tabletop runtime");
    }
    return this.#render.attachView(target);
  }

  detachView(viewId: RenderViewId): void {
    this.#render.detachView(viewId);
  }

  resizeView(viewId: RenderViewId, width: number, height: number): void {
    this.#render.resizeView(viewId, width, height);
  }

  attachCameraControls(
    viewId: RenderViewId,
    element: HTMLElement,
    options?: CameraControlOptions,
  ): CameraControlHandle {
    return this.#render.attachCameraControls(viewId, element, options);
  }

  getRenderMetrics(): SceneRenderMetrics {
    return this.#render.getMetrics();
  }

  getSnapshot = (): TabletopSnapshot => this.#snapshot;

  subscribe = (listener: TabletopRuntimeListener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  async dispose(): Promise<void> {
    if (this.#snapshot.status === "disposed") return;

    this.#generation += 1;
    this.#publishLifecycle("disposed");
    this.#listeners.clear();
    await this.#render.dispose();
    await this.#construction.dispose();
  }

  #publishLifecycle(status: TabletopRuntimeStatus): void {
    if (this.#snapshot.status === status) return;
    this.#snapshot = snapshot(
      this.#tableId,
      status,
      this.#snapshot.revision + 1,
      this.#snapshot.tokens,
      this.#snapshot.map,
    );
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
