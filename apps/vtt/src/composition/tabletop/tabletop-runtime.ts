import { chunkSurfaceMeshes } from "../../adapters/rendering/index.ts";
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
  ChangeOrigin,
  ConfirmedTokenRenderChange,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionSessionPort,
  RenderMapChunk,
  RenderViewId,
  ScenePickResult,
  SceneRenderMetrics,
  SceneRenderPort,
} from "@/ports";

import { defaultMapSeed } from "./default-map-seed.ts";

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
  pick(viewId: RenderViewId, x: number, y: number): ScenePickResult | undefined;
  attachView(target: HTMLElement): RenderViewId;
  detachView(viewId: RenderViewId): void;
  resizeView(viewId: RenderViewId, width: number, height: number): void;
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
    initialTokens: readonly TokenProjection[] = [],
  ) {
    const normalizedTableId = tableId.trim();
    if (normalizedTableId.length === 0) {
      throw new Error("tableId must not be empty");
    }

    this.#tableId = normalizedTableId;
    this.#render = render;
    this.#construction = construction;
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
    this.#construction.setTerrainMesh(2, 2, 1, "surface", 0, 0);
    this.#construction.generateTerrainCell(terrainCell.payload);
    this.#construction.generateWall(wall.payload);

    const meshes = this.#construction.getAllSurfaceMeshes();
    const causeId = `table-load:${this.#tableId}`;
    this.#uploadMapChunks(chunkSurfaceMeshes(meshes), "programmatic", causeId, generation);

    const nodePositions = this.#construction.getNodePositions();
    for (const node of nodePositions) {
      this.#uploadNodeHandle(node.id, node.position, "programmatic", causeId, generation);
    }

    return createMapProjection(
      meshes.map((mesh) =>
        createSurfaceProjection({
          surfaceRef: surfaceRefFromNodeSet(mesh.surfaceKey),
          orderedNodeRefs: mesh.surfaceKey,
          type: mesh.surfaceType,
          physical: mesh.physical,
          revision: 1,
        }),
      ),
      nodePositions.map((node) => ({ nodeRef: node.id, position: node.position, revision: 1 })),
    );
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

  /**
   * Moves an existing construction node to an absolute position through the
   * real engine, then re-derives and re-uploads every chunk (see
   * {@link AppTabletopRuntime.#uploadMapChunks}) and folds the affected
   * surfaces plus the moved node's own new position into the cached
   * `MapProjection`. Returns the engine's own `AffectedSurfaces` so a caller
   * (e.g. an undo/redo stack) can see what else changed.
   */
  moveNode(
    nodeId: ConstructionNodeId,
    position: ConstructionPosition,
    origin: ChangeOrigin,
    causeId: string,
  ): AffectedSurfaces {
    if (this.#snapshot.status !== "ready") {
      throw new Error("moving a node requires a ready tabletop runtime");
    }

    const affected = this.#construction.moveNode(nodeId, position);
    const meshes = this.#construction.getAllSurfaceMeshes();
    this.#uploadMapChunks(chunkSurfaceMeshes(meshes), origin, causeId, this.#generation);
    this.#uploadNodeHandle(nodeId, position, origin, causeId, this.#generation);

    let map = this.#snapshot.map;
    for (const surfaceKey of affected.affectedSurfaceKeys) {
      const surfaceRef = surfaceRefFromNodeSet(surfaceKey);
      const mesh = meshes.find((candidate) => surfaceRefFromNodeSet(candidate.surfaceKey) === surfaceRef);
      if (mesh === undefined) continue;
      const previous = map.byId.get(surfaceRef);
      map = applyMapProjectionDelta(map, {
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

    const previousNode = map.nodePositions.get(nodeId);
    map = applyMapProjectionDelta(map, {
      type: "node-moved",
      nodeRef: nodeId,
      position,
      revision: (previousNode?.revision ?? 0) + 1,
    });

    this.#snapshot = snapshot(
      this.#tableId,
      this.#snapshot.status,
      this.#snapshot.revision + 1,
      this.#snapshot.tokens,
      map,
    );
    this.#notify();
    return affected;
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
