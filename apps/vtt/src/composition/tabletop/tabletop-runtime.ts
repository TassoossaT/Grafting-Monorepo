import { chunkKeyForSurface, CONSTRUCTION_GRID_EXTENT, mergeChunkBucket, mergeSurfaceMeshes } from "../../adapters/rendering/index.ts";
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
  resolveSurfaceCovering,
  surfaceRefFromNodeSet,
  type MapProjection,
} from "../../entities/map/index.ts";
import type {
  ApplyRegionOverlayRequest,
  CameraControlHandle,
  CameraControlOptions,
  ChangeOrigin,
  CloudOutcome,
  CloudRequest,
  ConfirmedTokenRenderChange,
  ConstructionCoveredRegion,
  ConstructionEdgeGeometry,
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPatch,
  ConstructionPatchOutcome,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSessionPort,
  ConstructionSurfaceKey,
  ConstructionSurfaceSpec,
  ConstructionUnfilledLoop,
  DiffOutcome,
  GenerateRegionPartitionRequest,
  RegionEditOutcome,
  RemoveSurfaceRequest,
  RenderMeshData,
  RenderPreviewDescriptor,
  RenderViewId,
  ScenePickResult,
  SceneRenderMetrics,
  SceneRenderPort,
  SurfaceMeshResult,
  TerrainNoisePort,
} from "@/ports";

import {
  EMPTY_OUTCOME,
  applyEditOp,
  mergeOutcomes,
  type AtomicEditOp,
} from "../../features/edit-construction/index.ts";

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
  /**
   * Applies a resolved sequence of atomic edit ops as one transaction --
   * what `planEdit` produced from the user's gesture and the grabbed role's
   * own policy. The runtime deliberately does not resolve policy itself:
   * that belongs to `features/edit-construction`, and the tool layer runs it
   * before calling here.
   */
  applyRegionEdit(
    ops: readonly AtomicEditOp[],
    origin: ChangeOrigin,
    causeId: string,
  ): RegionEditOutcome;
  /**
   * The single-op shortcut for a caller that already knows the absolute
   * position it wants (an undo/redo stack replaying a drag), skipping the
   * policy pass a live gesture goes through.
   */
  moveVertex(
    nodeId: ConstructionNodeId,
    position: ConstructionPosition,
    origin: ChangeOrigin,
    causeId: string,
  ): RegionEditOutcome;
  /**
   * Registers a whole generated patch -- nodes, shared boundary edges, and
   * the faces over them -- in one transaction. See `ConstructionPatch`.
   */
  addPatch(patch: ConstructionPatch, origin: ChangeOrigin, causeId: string): ConstructionPatchOutcome;
  /**
   * Opens one more inner loop on a face that already exists -- what a door
   * or a window stands in. The loop must already be registered, and it keeps
   * one free use per edge so a face can take it.
   */
  addHole(
    request: {
      readonly surfaceKey: ConstructionSurfaceKey;
      readonly hole: readonly ConstructionOrientedEdgeUse[];
    },
    origin: ChangeOrigin,
    causeId: string,
  ): RegionEditOutcome;
  /** Every closed loop of boundary with no face on it, among `scope`'s nodes -- a hole whose rim already exists. */
  getUnfilledLoops(scope: readonly ConstructionNodeId[]): readonly ConstructionUnfilledLoop[];
  /** One region's live boundary -- what a handle/hit-test layer reads. */
  getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined;
  /** What a brush footprint currently covers, before anything is generated. */
  getFootprintCoverage(
    polygon: readonly (readonly [number, number])[],
  ): readonly ConstructionCoveredRegion[];
  /** Which of `points` already sit inside a region -- per-point, for a generator building only over open ground. */
  classifyPoints(
    points: readonly (readonly [number, number])[],
  ): readonly { readonly index: number; readonly surfaceKey: ConstructionSurfaceKey; readonly surfaceType: string }[];
  /** Every region's boundary. */
  getAllRegionTopologies(): readonly ConstructionRegionTopology[];
  applyRegionOverlay(
    request: ApplyRegionOverlayRequest,
    origin: ChangeOrigin,
    causeId: string,
  ): ConstructionPatchOutcome;
  undoPathBrush(operationId: string, origin: ChangeOrigin): void;
  redoPathBrush(operationId: string, origin: ChangeOrigin): void;
  /**
   * One tick of a continuous cell-painting brush ("Pintar Casa," a
   * wall-brush stroke's closure): regenerates the whole painted cell
   * set's region partition and applies only the difference against what
   * already exists -- walls/floors/ceilings can be added AND removed in
   * the same call (a split moving, two regions merging). See
   * `ConstructionSessionPort.generateRegionPartition`.
   */
  generateRegionPartition(request: GenerateRegionPartitionRequest, origin: ChangeOrigin, causeId: string): DiffOutcome;
  /** Unregisters a surface outright -- no hole-repair, no cascading. A caller composing a bigger removal (e.g. "Apagar Cômodo") calls this once per surface it already knows belongs to that removal. See `ConstructionSessionPort.removeSurface`. */
  removeSurface(request: RemoveSurfaceRequest, origin: ChangeOrigin, causeId: string): void;
  /** `ADR-0022`'s "cloud" query -- a pure read, never touches the map. See `ConstructionSessionPort.cloudFor`. */
  cloudFor(request: CloudRequest): CloudOutcome;
  /**
   * Welds a T-junction into an existing panel: subdividing the crossed
   * panel's own boundary edges at the crossing point, through
   * `insertVertex`. The panel stays one region with more boundary, rather
   * than being replaced by two -- the crossing wall welds onto the freshly
   * minted nodes by position, which is all the junction ever needed.
   */
  applyWallCrossingWeld(
    inserts: readonly {
      readonly edgeId: string;
      readonly nodeId: ConstructionNodeId;
      readonly position: ConstructionPosition;
      readonly firstEdgeId: string;
      readonly secondEdgeId: string;
    }[],
    origin: ChangeOrigin,
    causeId: string,
  ): RegionEditOutcome;
  /** Passthrough to `TerrainNoisePort.generateHeightmap` -- see that port for parameter meaning. */
  generateHeightmap(width: number, height: number, seed: number, scale: number): Float32Array;
  pick(viewId: RenderViewId, x: number, y: number): ScenePickResult | undefined;
  /** Shows a construction tool's not-yet-committed ghost. Purely visual -- passthrough to `SceneRenderPort`, never touches the construction session. */
  showPreview(descriptor: RenderPreviewDescriptor, channel?: string): void;
  /** Hides the active tool preview, if any. */
  clearPreview(channel?: string): void;
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
  /** Last uploaded revision per `RenderMapChunk.chunkId`. */
  readonly #chunkRevisions = new Map<string, number>();
  /**
   * Every mesh piece currently landing in each spatial chunk bucket, keyed
   * by `chunkId` then by a per-piece member key -- the persistent
   * membership `#syncSurfaceChunks` incrementally updates instead of
   * re-deriving every chunk's buffer from the whole map on every edit. One
   * `surfaceRef` can own more than one member key: an analytic-region
   * surface (a merged path-brush source/target region) can legitimately
   * triangulate into several disjoint mesh pieces (one per outer loop), and
   * each piece can land in a different spatial chunk.
   */
  readonly #chunkMembers = new Map<string, Map<string, SurfaceMeshResult>>();
  /** Reverse index of `#chunkMembers`: which chunk a given member piece currently belongs to, so moving/removing it only touches its own (old and new) chunk. */
  readonly #memberChunk = new Map<string, string>();
  /** Every member key currently registered for a given `surfaceRef`, so a surface whose piece count shrinks (or whose ref is removed outright) can find and drop exactly its own stale pieces. */
  readonly #surfaceMembers = new Map<string, ReadonlySet<string>>();
  /** Last uploaded revision for each invisible per-surface pick proxy. */
  readonly #surfacePickRevisions = new Map<string, number>();
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

    this.#snapshot = snapshot(
      this.#tableId,
      this.#snapshot.status,
      this.#snapshot.revision,
      this.#snapshot.tokens,
      createMapProjection(),
    );
    this.#publishLifecycle("ready");
  }

  /** Upserts one surface's invisible pick proxy. `meshData` is the surface's whole pick geometry -- already merged across every mesh piece the surface currently has, if more than one. */
  #upsertSurfacePickTarget(
    surfaceRef: string,
    meshData: RenderMeshData,
    origin: ChangeOrigin,
    causeId: string,
    generation: number,
  ): void {
    const revision = (this.#surfacePickRevisions.get(surfaceRef) ?? 0) + 1;
    this.#surfacePickRevisions.set(surfaceRef, revision);
    this.#render.applyConfirmed({
      type: "surface-pick-target-upserted",
      origin,
      causeId,
      runtimeGeneration: generation,
      dependency: { layer: "surface-picks", scopeId: surfaceRef, revision },
      target: { surfaceRef, mesh: meshData },
    });
  }

  /** Removes one surface's invisible pick proxy, if it had one. */
  #removeSurfacePickTarget(surfaceRef: string, origin: ChangeOrigin, causeId: string, generation: number): void {
    const revision = this.#surfacePickRevisions.get(surfaceRef);
    if (revision === undefined) return;
    this.#render.applyConfirmed({
      type: "surface-pick-target-removed",
      origin,
      causeId,
      runtimeGeneration: generation,
      dependency: { layer: "surface-picks", scopeId: surfaceRef, revision: revision + 1 },
      surfaceRef,
    });
    this.#surfacePickRevisions.delete(surfaceRef);
  }

  /**
   * Updates the chunked render layer and per-surface pick proxies for
   * exactly `changedMeshes`/`removedSurfaceRefs` -- every other surface's
   * chunk membership and buffer is left untouched. This used to re-derive
   * *every* surface in the whole map (`getAllSurfaceMeshes()`) and re-chunk
   * all of it on every single edit, diffing the result against what was
   * uploaded last time to find removed chunk ids -- "deliberately simple"
   * when the map was always small, but it means every mutation's cost (and
   * its JSON round-trip across the WASM boundary) scaled with total map
   * size, not with what actually changed. Worse, if that full round-trip
   * ever came back incomplete for any reason (a real risk once a single
   * mutation can produce hundreds of surfaces at once, e.g. a long
   * terrain-sculpt drag), the diff read every surface missing from it as
   * "removed" -- silently deleting untouched geometry elsewhere on the map.
   *
   * A chunk's render buffer is a merge of every surface currently landing in
   * that spatial bucket (`chunkSurfaceMeshes`'s own doc explains why a
   * partial buffer can't be patched surface-by-surface), so `#chunkMembers`
   * tracks that membership persistently; only the *chunks* a change actually
   * touched (gained a surface, lost one, or had one move between buckets)
   * get re-merged and re-uploaded here -- everything else costs nothing.
   */
  #syncSurfaceChunks(
    changedMeshes: readonly SurfaceMeshResult[],
    removedSurfaceRefs: readonly string[],
    origin: ChangeOrigin,
    causeId: string,
    generation: number,
  ): void {
    const dirtyChunkIds = new Set<string>();

    for (const surfaceRef of removedSurfaceRefs) {
      this.#dropSurfaceMembers(surfaceRef, dirtyChunkIds);
      this.#removeSurfacePickTarget(surfaceRef, origin, causeId, generation);
    }

    // `changedMeshes` can hold more than one entry per `surfaceRef`: an
    // analytic-region surface (a merged path-brush source/target region)
    // legitimately triangulates into several disjoint pieces (one per outer
    // loop), each independently bucketed by its own chunk -- grouping here
    // is what stops all but the first piece from silently going unrendered.
    const piecesBySurface = new Map<string, SurfaceMeshResult[]>();
    for (const mesh of changedMeshes) {
      const surfaceRef = surfaceRefFromNodeSet(mesh.surfaceKey);
      let pieces = piecesBySurface.get(surfaceRef);
      if (pieces === undefined) {
        pieces = [];
        piecesBySurface.set(surfaceRef, pieces);
      }
      pieces.push(mesh);
    }

    for (const [surfaceRef, pieces] of piecesBySurface) {
      const previousMembers = this.#surfaceMembers.get(surfaceRef);
      const nextMembers = new Set<string>();

      pieces.forEach((mesh, index) => {
        const memberKey = `${surfaceRef}#${index}`;
        nextMembers.add(memberKey);
        const newChunkId = chunkKeyForSurface(mesh, resolveSurfaceCovering);
        const oldChunkId = this.#memberChunk.get(memberKey);
        if (oldChunkId !== undefined && oldChunkId !== newChunkId) {
          this.#chunkMembers.get(oldChunkId)?.delete(memberKey);
          dirtyChunkIds.add(oldChunkId);
        }
        let bucket = this.#chunkMembers.get(newChunkId);
        if (bucket === undefined) {
          bucket = new Map();
          this.#chunkMembers.set(newChunkId, bucket);
        }
        bucket.set(memberKey, mesh);
        this.#memberChunk.set(memberKey, newChunkId);
        dirtyChunkIds.add(newChunkId);
      });

      // A piece count that shrank since last sync (e.g. a region losing one
      // of its outer loops) leaves its now-excess old member keys behind --
      // drop exactly those, not the ones still current.
      if (previousMembers !== undefined) {
        for (const staleKey of previousMembers) {
          if (nextMembers.has(staleKey)) continue;
          const oldChunkId = this.#memberChunk.get(staleKey);
          if (oldChunkId !== undefined) {
            this.#chunkMembers.get(oldChunkId)?.delete(staleKey);
            this.#memberChunk.delete(staleKey);
            dirtyChunkIds.add(oldChunkId);
          }
        }
      }
      this.#surfaceMembers.set(surfaceRef, nextMembers);

      const pickMeshData = pieces.length === 1 ? pieces[0].mesh : mergeSurfaceMeshes(pieces);
      this.#upsertSurfacePickTarget(surfaceRef, pickMeshData, origin, causeId, generation);
    }

    for (const chunkId of dirtyChunkIds) {
      const bucket = this.#chunkMembers.get(chunkId);
      const chunk = bucket === undefined ? undefined : mergeChunkBucket(chunkId, [...bucket.values()], resolveSurfaceCovering);
      if (chunk === undefined) {
        this.#chunkMembers.delete(chunkId);
        const revision = this.#chunkRevisions.get(chunkId);
        if (revision === undefined) continue;
        this.#render.applyConfirmed({
          type: "map-chunk-removed",
          origin,
          causeId,
          runtimeGeneration: generation,
          dependency: { layer: "terrain", scopeId: chunkId, revision: revision + 1 },
          chunkId,
        });
        this.#chunkRevisions.delete(chunkId);
        continue;
      }
      const revision = (this.#chunkRevisions.get(chunkId) ?? 0) + 1;
      this.#chunkRevisions.set(chunkId, revision);
      this.#render.applyConfirmed({
        type: "map-chunk-upserted",
        origin,
        causeId,
        runtimeGeneration: generation,
        dependency: { layer: "terrain", scopeId: chunkId, revision },
        chunk,
      });
    }
  }

  /** Drops every mesh piece currently registered for `surfaceRef` from `#chunkMembers`/`#memberChunk`/`#surfaceMembers`, marking each piece's chunk dirty. */
  #dropSurfaceMembers(surfaceRef: string, dirtyChunkIds: Set<string>): void {
    const members = this.#surfaceMembers.get(surfaceRef);
    if (members === undefined) return;
    for (const memberKey of members) {
      const oldChunkId = this.#memberChunk.get(memberKey);
      if (oldChunkId !== undefined) {
        this.#chunkMembers.get(oldChunkId)?.delete(memberKey);
        this.#memberChunk.delete(memberKey);
        dirtyChunkIds.add(oldChunkId);
      }
    }
    this.#surfaceMembers.delete(surfaceRef);
  }

  /**
   * The only place `getAllSurfaceMeshes()` (a full re-derivation of the
   * entire map) is still allowed to run -- when the actual set of changed
   * surfaces genuinely isn't known (the initial load, or restoring an
   * undo/redo checkpoint that may have touched an arbitrary, unenumerated
   * set of surfaces). Diffs the fresh full list against `#surfaceMembers`'s
   * own tracked membership to find what's now stale, then reuses
   * {@link AppTabletopRuntime.#syncSurfaceChunks} so both paths update
   * exactly the same persistent state.
   */
  #fullResyncSurfaces(
    meshes: readonly SurfaceMeshResult[],
    origin: ChangeOrigin,
    causeId: string,
    generation: number,
  ): void {
    const currentRefs = new Set(meshes.map((mesh) => surfaceRefFromNodeSet(mesh.surfaceKey)));
    const staleRefs = [...this.#surfaceMembers.keys()].filter((ref) => !currentRefs.has(ref));
    this.#syncSurfaceChunks(meshes, staleRefs, origin, causeId, generation);
  }

  /** Uploads one node's pickable handle at its current position, mirroring `#syncSurfaceChunks`'s revision-guard bookkeeping but per-node rather than per-chunk. */
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

  /** Removes one node's pickable handle -- the counterpart to {@link AppTabletopRuntime.#uploadNodeHandle}, needed once a mutation deletes a node outright. */
  #removeNodeHandle(nodeId: ConstructionNodeId, origin: ChangeOrigin, causeId: string, generation: number): void {
    const revision = (this.#nodeHandleRevisions.get(nodeId) ?? 0) + 1;
    this.#nodeHandleRevisions.delete(nodeId);
    this.#render.applyConfirmed({
      type: "node-handle-removed",
      origin,
      causeId,
      runtimeGeneration: generation,
      dependency: { layer: "handles", scopeId: nodeId, revision },
      nodeId,
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
   * own action in the error so `moveNode`/`generateTerrainCell`/`generatePathExtrusion`
   * each keep a distinct, readable message despite sharing this guard.
   */
  #requireReady(action: string): void {
    if (this.#snapshot.status !== "ready") {
      throw new Error(`${action} requires a ready tabletop runtime`);
    }
  }

  /**
   * The sequence every construction mutation shares once the engine call
   * itself has already run: fetch only `surfaceKeys`'s own meshes and
   * incrementally sync the chunked render layer for them plus
   * `removedSurfaceRefs` (see
   * {@link AppTabletopRuntime.#syncSurfaceChunks}), fold `surfaceKeys` into
   * the cached `MapProjection`, let the caller fold in whatever node-position
   * change its own mutation implies (a full re-scan for a newly-generated
   * cell/wall, or a direct known-position fold for a move -- see
   * {@link AppTabletopRuntime.#foldDiscoveredNodePositions}'s own doc comment
   * for why those differ), then bump the snapshot revision and notify.
   */
  #applyConstructionMutation(
    surfaceKeys: readonly ConstructionSurfaceKey[],
    removedSurfaceRefs: readonly string[],
    origin: ChangeOrigin,
    causeId: string,
    foldNodePositions: (map: MapProjection) => MapProjection,
  ): void {
    const meshes = surfaceKeys.flatMap((surfaceKey) => this.#construction.getSurfaceMesh(surfaceKey));
    this.#syncSurfaceChunks(meshes, removedSurfaceRefs, origin, causeId, this.#generation);

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
   * Applies a resolved sequence of atomic edit ops as one transaction, then
   * re-derives and re-uploads every chunk and folds the whole merged
   * outcome into the cached `MapProjection`.
   *
   * Policy resolution deliberately happens *before* this call, in
   * `features/edit-construction`: this method never asks what a wall allows,
   * it only performs what was already decided -- see
   * `docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.
   */
  applyRegionEdit(
    ops: readonly AtomicEditOp[],
    origin: ChangeOrigin,
    causeId: string,
  ): RegionEditOutcome {
    this.#requireReady("editing a region");
    if (ops.length === 0) return EMPTY_OUTCOME;

    const outcome = ops.reduce(
      (merged, op) => mergeOutcomes(merged, applyEditOp(this.#construction, op)),
      EMPTY_OUTCOME,
    );
    this.#foldRegionEditOutcome(outcome, origin, causeId);
    return outcome;
  }

  moveVertex(
    nodeId: ConstructionNodeId,
    position: ConstructionPosition,
    origin: ChangeOrigin,
    causeId: string,
  ): RegionEditOutcome {
    return this.applyRegionEdit([{ kind: "move-vertex", nodeId, position }], origin, causeId);
  }

  addPatch(patch: ConstructionPatch, origin: ChangeOrigin, causeId: string): ConstructionPatchOutcome {
    this.#requireReady("registering a generated patch");
    const outcome = this.#construction.addPatch(patch);
    this.#foldRegionEditOutcome(outcome, origin, causeId);
    return outcome;
  }

  addHole(
    request: {
      readonly surfaceKey: ConstructionSurfaceKey;
      readonly hole: readonly ConstructionOrientedEdgeUse[];
    },
    origin: ChangeOrigin,
    causeId: string,
  ): RegionEditOutcome {
    this.#requireReady("opening a face");
    const outcome = this.#construction.addHole(request);
    this.#foldRegionEditOutcome(outcome, origin, causeId);
    return outcome;
  }

  getUnfilledLoops(scope: readonly ConstructionNodeId[]): readonly ConstructionUnfilledLoop[] {
    this.#requireReady("looking for unfilled loops");
    return this.#construction.getUnfilledLoops(scope);
  }

  getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined {
    this.#requireReady("reading a region's topology");
    return this.#construction.getRegionTopology(surfaceKey);
  }

  getFootprintCoverage(
    polygon: readonly (readonly [number, number])[],
  ): readonly ConstructionCoveredRegion[] {
    this.#requireReady("querying a footprint's coverage");
    return this.#construction.getFootprintCoverage(polygon);
  }

  classifyPoints(
    points: readonly (readonly [number, number])[],
  ): readonly { readonly index: number; readonly surfaceKey: ConstructionSurfaceKey; readonly surfaceType: string }[] {
    this.#requireReady("classifying points");
    return this.#construction.classifyPoints(points);
  }

  getAllRegionTopologies(): readonly ConstructionRegionTopology[] {
    this.#requireReady("reading every region's topology");
    return this.#construction.getAllRegionTopologies();
  }

  /**
   * The projection/render sync every atomic edit shares. Node positions come
   * from a full re-scan rather than a known target: an edit's cascade (and
   * the engine's own zero-orphan cleanup) can move or delete nodes this
   * caller never named, so there is no shortcut position to fold directly.
   */
  #foldRegionEditOutcome(outcome: RegionEditOutcome, origin: ChangeOrigin, causeId: string): void {
    const changed = [...outcome.affectedSurfaceKeys, ...outcome.createdSurfaceKeys];
    const removedRefs = outcome.removedSurfaceKeys.map(surfaceRefFromNodeSet);
    this.#applyConstructionMutation(changed, removedRefs, origin, causeId, (map) => {
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
      for (const nodeId of outcome.removedNodeIds) {
        next = applyMapProjectionDelta(next, { type: "node-removed", nodeRef: nodeId });
        this.#removeNodeHandle(nodeId, origin, causeId, this.#generation);
      }
      return this.#foldDiscoveredNodePositions(next, origin, causeId, this.#generation);
    });
  }

  /** Rebuilds projections after a session-owned semantic checkpoint restore -- the only place a full `getAllSurfaceMeshes()` re-derivation is still correct, since an undo/redo restore can touch an arbitrary, unenumerated set of surfaces. See {@link AppTabletopRuntime.#fullResyncSurfaces}. */
  #refreshConstructionProjection(origin: ChangeOrigin, causeId: string): void {
    const meshes = this.#construction.getAllSurfaceMeshes();
    this.#fullResyncSurfaces(meshes, origin, causeId, this.#generation);

    const liveNodes = new Set(this.#construction.getNodePositions().map((node) => node.id));
    for (const nodeId of [...this.#nodeHandleRevisions.keys()]) {
      if (!liveNodes.has(nodeId)) this.#removeNodeHandle(nodeId, origin, causeId, this.#generation);
    }

    let map = this.#foldAffectedSurfaces(
      createMapProjection(),
      meshes.map((mesh) => mesh.surfaceKey),
      meshes,
    );
    map = this.#foldDiscoveredNodePositions(map, origin, causeId, this.#generation);
    this.#snapshot = snapshot(
      this.#tableId,
      this.#snapshot.status,
      this.#snapshot.revision + 1,
      this.#snapshot.tokens,
      map,
    );
    this.#notify();
  }
  /** Shared by every `generate*` mutation: folds `outcome`'s added/removed surfaces and removed nodes into the running map. */
  #foldDiffOutcome(outcome: DiffOutcome, origin: ChangeOrigin, causeId: string): void {
    const removedRefs = outcome.removedSurfaceKeys.map(surfaceRefFromNodeSet);
    this.#applyConstructionMutation(outcome.addedSurfaceKeys, removedRefs, origin, causeId, (map) => {
      let next = map;
      for (const surfaceRef of removedRefs) {
        const previous = next.byId.get(surfaceRef);
        if (previous === undefined) continue;
        next = applyMapProjectionDelta(next, { type: "surface-removed", surfaceRef, revision: previous.revision + 1 });
      }
      next = this.#foldDiscoveredNodePositions(next, origin, causeId, this.#generation);
      for (const nodeId of outcome.removedNodeIds) {
        next = applyMapProjectionDelta(next, { type: "node-removed", nodeRef: nodeId });
        this.#removeNodeHandle(nodeId, origin, causeId, this.#generation);
      }
      return next;
    });
  }

  applyRegionOverlay(
    request: ApplyRegionOverlayRequest,
    origin: ChangeOrigin,
    causeId: string,
  ): ConstructionPatchOutcome {
    this.#requireReady("applying a region overlay");
    const outcome = this.#construction.applyRegionOverlay(request);
    this.#foldRegionEditOutcome(outcome, origin, causeId);
    return outcome;
  }
  undoPathBrush(operationId: string, origin: ChangeOrigin): void {
    this.#requireReady("undoing a path brush");
    this.#construction.undoRegionOverlay(operationId);
    this.#refreshConstructionProjection(origin, `undo:${operationId}`);
  }

  redoPathBrush(operationId: string, origin: ChangeOrigin): void {
    this.#requireReady("redoing a path brush");
    this.#construction.redoRegionOverlay(operationId);
    this.#refreshConstructionProjection(origin, `redo:${operationId}`);
  }
  generateRegionPartition(request: GenerateRegionPartitionRequest, origin: ChangeOrigin, causeId: string): DiffOutcome {
    this.#requireReady("painting a region");

    const outcome = this.#construction.generateRegionPartition(request);
    this.#foldDiffOutcome(outcome, origin, causeId);
    return outcome;
  }

  removeSurface(request: RemoveSurfaceRequest, origin: ChangeOrigin, causeId: string): void {
    this.#requireReady("removing a surface");

    this.#construction.removeSurface(request);
    const surfaceRef = surfaceRefFromNodeSet(request.surfaceKey);
    this.#applyConstructionMutation([], [surfaceRef], origin, causeId, (map) => {
      const previous = map.byId.get(surfaceRef);
      if (previous === undefined) return map;
      return applyMapProjectionDelta(map, { type: "surface-removed", surfaceRef, revision: previous.revision + 1 });
    });
  }

  cloudFor(request: CloudRequest): CloudOutcome {
    this.#requireReady("querying a cloud");
    return this.#construction.cloudFor(request);
  }

  applyWallCrossingWeld(
    inserts: readonly {
      readonly edgeId: string;
      readonly nodeId: ConstructionNodeId;
      readonly position: ConstructionPosition;
      readonly firstEdgeId: string;
      readonly secondEdgeId: string;
    }[],
    origin: ChangeOrigin,
    causeId: string,
  ): RegionEditOutcome {
    return this.applyRegionEdit(
      inserts.map((insert) => ({ kind: "insert-vertex" as const, ...insert })),
      origin,
      causeId,
    );
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

  showPreview(descriptor: RenderPreviewDescriptor, channel?: string): void {
    this.#render.showPreview(descriptor, channel);
  }

  clearPreview(channel?: string): void {
    this.#render.clearPreview(channel);
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
