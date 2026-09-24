import { curveEdgesOf, curveHandles, panelHeightWidgets } from "../../features/edit-construction/index.ts";
import type { BezierPort } from "../../ports/bezier-port.ts";
import type { ConstructionPlanarRequest, ConstructionPlanarShape, ConstructionMotionRequest, ConstructionMotionPlan, ConstructionNodeMotion } from "../../ports/index.ts";
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
  applyMapProjectionDeltas,
  createMapProjection,
  createSurfaceProjection,
  resolveSurfaceCovering,
  surfaceRefFromNodeSet,
  type MapProjection,
  type MapProjectionDelta,
} from "../../entities/map/index.ts";
import type {
  ApplyRegionOverlayRequest,
  ApplyPatchReplacementRequest,
  CameraControlHandle,
  CameraControlOptions,
  ChangeOrigin,
  CloudOutcome,
  CloudRequest,
  ConfirmedTokenRenderChange,
  ConstructionTopologyBoundsQuery,
  ConstructionContourAnswer,
  ConstructionContourQuery,
  ConstructionCoveredRegion,
  ConstructionCurvedEdge,
  ConstructionFieldQuery,
  ConstructionFieldSample,
  ConstructionEdgeGeometry,
  ConstructionGraphSnapshot,
  ConstructionIrregularQuadGrid,
  ConstructionIrregularQuadGridRequest,
  ConstructionNodeId,
  ConstructionHostPoint,
  ConstructionPatch,
  ConstructionPinRequest,
  ConstructionPanelRun,
  ConstructionPatchOutcome,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSessionPort,
  ConstructionSurfaceKey,
  ConstructionSurfaceCapability,
  ConstructionSurfaceSpec,
  ConstructionUnfilledLoop,
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
  hasTrait,
  mergeOutcomes,
  surfaceTypesWithTrait,
  type AtomicEditOp,
} from "../../features/edit-construction/index.ts";
import { timeCommit, timePhase } from "./commit-timing.ts";

function surfaceCapabilities(): readonly ConstructionSurfaceCapability[] {
  const types = new Set([...surfaceTypesWithTrait("cuts"), ...surfaceTypesWithTrait("accepts-cuts")]);
  return [...types].map((surfaceType) => ({
    surfaceType,
    cuts: hasTrait(surfaceType, "cuts"),
    acceptsCuts: hasTrait(surfaceType, "accepts-cuts"),
  }));
}

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

/** What a committed transaction produced, and whether it made an undo entry. */
export interface TransactionResult<T> {
  readonly value: T;
  readonly recorded: boolean;
}

export interface TabletopRuntime extends BezierPort {
  generateCap(request: import("../../ports/cap-port.ts").CapRequest): import("../../ports/cap-port.ts").CapPatch;
  start(): Promise<void>;
  applyConfirmedToken(envelope: ConfirmedTokenDeltaEnvelope): void;
  /**
   * Applies a resolved sequence of atomic edit ops as one transaction --
   * what `planEdit` produced from the user's gesture and the grabbed role's
   * own policy. The runtime deliberately does not resolve policy itself:
   * that belongs to `features/edit-construction`, and the tool layer runs it
   * before calling here.
   */
  planMotion(request: ConstructionMotionRequest): ConstructionMotionPlan;
  planarBoolean(request: ConstructionPlanarRequest): readonly ConstructionPlanarShape[];

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
  /** Pins nodes to host faces in relative `(u, v)`; the host carries them from then on. See `ConstructionSessionPort.pinNodes`. */
  pinNodes(pins: readonly ConstructionPinRequest[], origin: ChangeOrigin, causeId: string): RegionEditOutcome;
  unpinNodes(nodeIds: readonly ConstructionNodeId[], origin: ChangeOrigin, causeId: string): RegionEditOutcome;
  /** World points in a host face's `(u, v)` frame. Throws when the host is not an upright panel. */
  projectToHost(request: { readonly hostSurfaceKey: ConstructionSurfaceKey; readonly points: readonly ConstructionPosition[] }): readonly ConstructionHostPoint[];
  /** Host `(u, v)` pairs back to world positions. Pure. */
  resolveOnHost(request: { readonly hostSurfaceKey: ConstructionSurfaceKey; readonly uv: readonly (readonly [number, number])[] }): readonly ConstructionPosition[];
  /** Labels regions as one group (`null` clears). See `ConstructionSessionPort.setRegionGroup`. */
  setRegionGroup(surfaceKeys: readonly ConstructionSurfaceKey[], groupId: string | null): RegionEditOutcome;
  /** The run of upright panels through `surfaceKey`. See `ConstructionSessionPort.panelRun`. */
  panelRun(surfaceKey: ConstructionSurfaceKey): ConstructionPanelRun;
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
  /**
   * One irregular quad grid, generated against the contours given -- what
   * ground is made of, whether it is being created or regenerated. Pure: it
   * reads nothing from the live graph and changes nothing in it.
   */
  generateIrregularQuadGrid(
    request: ConstructionIrregularQuadGridRequest,
  ): ConstructionIrregularQuadGrid | undefined;
  /** Every region's boundary. */
  getAllRegionTopologies(): readonly ConstructionRegionTopology[];
  /** Region boundaries near a local edit, resolved in one engine call. */
  getRegionTopologiesInBounds(bounds: ConstructionTopologyBoundsQuery): readonly ConstructionRegionTopology[];
  /** Every bezier boundary edge a region uses. See `ConstructionSessionPort.getCurvedEdges`. */
  getCurvedEdges(): readonly ConstructionCurvedEdge[];
  /** Pure contour geometry questions. See `ConstructionSessionPort.queryContours`. */
  queryContours(queries: readonly ConstructionContourQuery[]): readonly ConstructionContourAnswer[];
  /** Where points project onto the curves a surface was swept from. See `ConstructionSessionPort.queryField`. */
  queryField(query: ConstructionFieldQuery): readonly ConstructionFieldSample[];
  /** Generic graph primitives, including edges not owned by a region boundary. */
  getGraphSnapshot(): ConstructionGraphSnapshot;
  applyRegionOverlay(
    request: ApplyRegionOverlayRequest,
    origin: ChangeOrigin,
    causeId: string,
  ): ConstructionPatchOutcome;
  applyPatchReplacement(
    request: ApplyPatchReplacementRequest,
    origin: ChangeOrigin,
    causeId: string,
  ): ConstructionPatchOutcome;
  /**
   * Runs `work` as one atomic transaction named `transactionId`: everything
   * it mutates commits as a single undo entry, or -- if it throws -- is rolled
   * back to exactly the state before it, projection included, and the error
   * is rethrown. `recorded` says whether an undo entry was made; record the
   * history entry exactly when it is true.
   */
  transact<T>(transactionId: string, origin: ChangeOrigin, work: () => T): TransactionResult<T>;
  /** Undoes one committed transaction (or a replacement recorded outside one). */
  undoTransaction(transactionId: string, origin: ChangeOrigin): void;
  redoTransaction(transactionId: string, origin: ChangeOrigin): void;
  /** Unregisters a surface outright, prunes orphaned nodes, and folds the outcome into the running map. See `ConstructionSessionPort.removeSurface`. */
  removeSurface(request: RemoveSurfaceRequest, origin: ChangeOrigin, causeId: string): RegionEditOutcome;
  /** `ADR-0022`'s "cloud" query -- a pure read, never touches the map. See `ConstructionSessionPort.cloudFor`. */
  cloudFor(request: CloudRequest): CloudOutcome;
  /** Passthrough to `TerrainNoisePort.generateHeightmap` -- see that port for parameter meaning. */
  generateHeightmap(
    width: number,
    height: number,
    seed: number,
    scale: number,
    originX: number,
    originY: number,
  ): Float32Array;
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
  #bezierHandleIds = new Set<string>();
  #panelHeightWidgetIds = new Set<string>();
  /** Surfaces holding pinned nodes; `undefined` until next needed after a restore. A host edit moves those nodes without naming them. */
  #pinnedSurfaceRefs: Set<string> | undefined;
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
    this.#construction.setSurfaceCapabilities(surfaceCapabilities());
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
   *
   * A surface whose mesh failed to derive this call is simply absent from
   * `changedMeshes` (see `#applyConstructionMutation`'s use of
   * `getSurfaceMeshesReport`) rather than listed in `removedSurfaceRefs`, so
   * it falls straight into "every other surface" above and keeps whatever it
   * last rendered.
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

  #syncBezierHandles(origin: ChangeOrigin, causeId: string, generation: number): void {
    if (typeof this.#construction.curveBatch !== "function") return;
    const contour = typeof this.#construction.getCurvedEdges === "function" ? this.#construction.getCurvedEdges() : [];
    const handles = curveHandles(curveEdgesOf(this.#construction.getGraphSnapshot(), contour, this.#construction), this.#construction);
    const live = new Set(handles.map((h) => h.id));
    for (const id of this.#bezierHandleIds) if (!live.has(id)) this.#removeNodeHandle(id, origin, causeId, generation);
    for (const handle of handles) this.#uploadNodeHandle(handle.id, handle.position, origin, causeId, generation);
    this.#bezierHandleIds = live;
  }

  /** Uploads/retires one widget per top run of every partition panel -- a wall's own per-segment height handle, mirroring `#syncBezierHandles`. */
  #syncPanelHeightWidgets(origin: ChangeOrigin, causeId: string, generation: number): void {
    if (typeof this.#construction.getAllRegionTopologies !== "function") return;
    const widgets = panelHeightWidgets(this.#construction.getAllRegionTopologies());
    const live = new Set(widgets.map((widget) => widget.id));
    for (const id of this.#panelHeightWidgetIds) if (!live.has(id)) this.#removeNodeHandle(id, origin, causeId, generation);
    for (const widget of widgets) this.#uploadNodeHandle(widget.id, widget.position, origin, causeId, generation);
    this.#panelHeightWidgetIds = live;
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
    const firstMeshBySurface = new Map<string, SurfaceMeshResult>();
    for (const mesh of meshes) {
      const surfaceRef = surfaceRefFromNodeSet(mesh.surfaceKey);
      if (!firstMeshBySurface.has(surfaceRef)) firstMeshBySurface.set(surfaceRef, mesh);
    }
    const deltas: MapProjectionDelta[] = [];
    for (const surfaceKey of surfaceKeys) {
      const surfaceRef = surfaceRefFromNodeSet(surfaceKey);
      const mesh = firstMeshBySurface.get(surfaceRef);
      if (mesh === undefined) continue;
      const previous = map.byId.get(surfaceRef);
      deltas.push({
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
    return applyMapProjectionDeltas(map, deltas);
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
    const deltas: MapProjectionDelta[] = [];
    for (const node of this.#construction.getNodePositions()) {
      const previous = map.nodePositions.get(node.id);
      if (
        previous !== undefined &&
        previous.position.x === node.position.x &&
        previous.position.y === node.position.y &&
        previous.position.z === node.position.z
      ) {
        continue;
      }
      deltas.push({
        type: "node-moved",
        nodeRef: node.id,
        position: node.position,
        revision: (previous?.revision ?? 0) + 1,
      });
      this.#uploadNodeHandle(node.id, node.position, origin, causeId, generation);
    }
    this.#syncBezierHandles(origin, causeId, generation);
    this.#syncPanelHeightWidgets(origin, causeId, generation);
    return applyMapProjectionDeltas(map, deltas);
  }

  /** Folds positions an atomic edit request already carried, without asking the engine to serialize every live node. */
  #foldKnownNodePositions(
    map: MapProjection,
    positions: ReadonlyMap<ConstructionNodeId, ConstructionPosition>,
    origin: ChangeOrigin,
    causeId: string,
    generation: number,
  ): MapProjection {
    const deltas: MapProjectionDelta[] = [];
    for (const [nodeId, position] of positions) {
      const previous = map.nodePositions.get(nodeId);
      if (
        previous !== undefined &&
        previous.position.x === position.x &&
        previous.position.y === position.y &&
        previous.position.z === position.z
      ) {
        continue;
      }
      deltas.push({
        type: "node-moved",
        nodeRef: nodeId,
        position,
        revision: (previous?.revision ?? 0) + 1,
      });
      this.#uploadNodeHandle(nodeId, position, origin, causeId, generation);
    }
    // Curve handles sit off the anchors and follow a reshaped edge too, so
    // they are re-placed whatever the edit moved or retyped. Height widgets
    // sit at a top run's midpoint for the same reason.
    this.#syncBezierHandles(origin, causeId, generation);
    this.#syncPanelHeightWidgets(origin, causeId, generation);
    return applyMapProjectionDeltas(map, deltas);
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
    // Fetched one surface at a time, not `surfaceKeys.flatMap`, and a
    // fetch that throws is skipped rather than aborting the whole sync: a
    // single mutation can name several affected surfaces that also border
    // *each other*, and one of them can legitimately have already been
    // removed by this same call (a batch deleting several adjacent
    // consumed regions together, say) -- its own removal is already
    // handled through `removedSurfaceRefs`/`#foldRegionEditOutcome`'s own
    // removed-keys loop, so a stale mesh fetch for it here is redundant,
    // not load-bearing. Letting one such fetch abort the whole sync used
    // to skip the render update for *every* surface in the batch, not just
    // the stale one -- the mutation itself had already committed, so the
    // screen simply never caught up.
    // Older/in-memory ports used by embedders can still provide only the
    // single-key method; the Wasm port takes the one-crossing batch path.
    //
    // A port that also exposes `getSurfaceMeshesReport` tells the two ways a
    // key can be absent from `meshes` apart: `"unknown"` is a stale key --
    // normal when this same mutation also removed that surface, already
    // handled via `removedSurfaceRefs` -- while any other reason is a live
    // surface whose mesh genuinely failed to derive. That surface's chunk
    // membership, pick target, and projection are left exactly as they were
    // (they simply never enter `meshes` below), so the last valid render
    // keeps showing rather than the face vanishing under a still-live key.
    const report = this.#construction.getSurfaceMeshesReport;
    const batch = this.#construction.getSurfaceMeshes;
    let meshes: readonly SurfaceMeshResult[];
    if (typeof report === "function") {
      const result = report.call(this.#construction, surfaceKeys);
      meshes = result.meshes;
      for (const failure of result.failed) {
        if (failure.reason === "unknown") continue;
        const surfaceRef = surfaceRefFromNodeSet(failure.surfaceKey);
        if (removedSurfaceRefs.includes(surfaceRef)) continue;
        console.warn(`surface ${surfaceRef} failed to mesh: ${failure.reason}`);
      }
    } else {
      meshes = typeof batch === "function"
        ? batch.call(this.#construction, surfaceKeys)
        : surfaceKeys.flatMap((surfaceKey) => {
            try {
              return this.#construction.getSurfaceMesh(surfaceKey);
            } catch {
              return [];
            }
          });
    }
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

  planarBoolean(request: ConstructionPlanarRequest): readonly ConstructionPlanarShape[] { return this.#construction.planarBoolean(request); }

  planMotion(request: ConstructionMotionRequest): ConstructionMotionPlan {
    this.#requireReady("planning structural movement");
    return this.#construction.planMotion(request);
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

    const movements = ops.filter((op) => op.kind === "move-vertex");
    const outcome = timePhase(`motor: edição (${ops.length} ops)`, () => movements.length === ops.length
      ? this.#construction.moveVertices(movements)
      : ops.reduce((merged, op) => mergeOutcomes(merged, applyEditOp(this.#construction, op)), EMPTY_OUTCOME));
    const positionsAreKnown = ops.every(
      (op) => op.kind !== "move-edge" && op.kind !== "move-region" && op.kind !== "duplicate-region",
    );
    const knownPositions = positionsAreKnown ? new Map<ConstructionNodeId, ConstructionPosition>() : undefined;
    if (knownPositions !== undefined) {
      for (const op of ops) {
        if (op.kind === "move-vertex" || op.kind === "insert-vertex") knownPositions.set(op.nodeId, op.position);
      }
    }
    timePhase("render da edição", () => this.#foldRegionEditOutcome(outcome, origin, causeId, knownPositions));
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
    this.#foldRegionEditOutcome(
      outcome,
      origin,
      causeId,
      patch.nodes.length === 0 ? undefined : new Map(patch.nodes.map((node) => [node.id, node.position])),
    );
    return outcome;
  }

  pinNodes(pins: readonly ConstructionPinRequest[], origin: ChangeOrigin, causeId: string): RegionEditOutcome {
    this.#requireReady("pinning nodes");
    const outcome = this.#construction.pinNodes(pins);
    const pinned = new Set(pins.map((pin) => pin.nodeId));
    const positions = new Map<ConstructionNodeId, ConstructionPosition>();
    for (const surfaceKey of outcome.affectedSurfaceKeys) {
      const topology = this.#construction.getRegionTopology(surfaceKey);
      if (topology === undefined || !topology.nodes.some((node) => pinned.has(node.id))) continue;
      this.#pinnedSurfaceRefs?.add(surfaceRefFromNodeSet(surfaceKey));
      for (const node of topology.nodes) if (pinned.has(node.id)) positions.set(node.id, node.position);
    }
    this.#foldRegionEditOutcome(outcome, origin, causeId, positions);
    return outcome;
  }

  unpinNodes(nodeIds: readonly ConstructionNodeId[], origin: ChangeOrigin, causeId: string): RegionEditOutcome {
    this.#requireReady("unpinning nodes");
    const outcome = this.#construction.unpinNodes(nodeIds);
    this.#pinnedSurfaceRefs = undefined;
    this.#foldRegionEditOutcome(outcome, origin, causeId, new Map());
    return outcome;
  }

  projectToHost(request: { readonly hostSurfaceKey: ConstructionSurfaceKey; readonly points: readonly ConstructionPosition[] }): readonly ConstructionHostPoint[] {
    this.#requireReady("projecting onto a host face");
    return this.#construction.projectToHost(request);
  }

  resolveOnHost(request: { readonly hostSurfaceKey: ConstructionSurfaceKey; readonly uv: readonly (readonly [number, number])[] }): readonly ConstructionPosition[] {
    this.#requireReady("resolving on a host face");
    return this.#construction.resolveOnHost(request);
  }

  setRegionGroup(surfaceKeys: readonly ConstructionSurfaceKey[], groupId: string | null): RegionEditOutcome {
    this.#requireReady("grouping regions");
    return this.#construction.setRegionGroup(surfaceKeys, groupId);
  }

  panelRun(surfaceKey: ConstructionSurfaceKey): ConstructionPanelRun {
    this.#requireReady("reading a panel run");
    return this.#construction.panelRun(surfaceKey);
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

  generateIrregularQuadGrid(
    request: ConstructionIrregularQuadGridRequest,
  ): ConstructionIrregularQuadGrid | undefined {
    this.#requireReady("generating a terrain grid");
    return this.#construction.generateIrregularQuadGrid(request);
  }

  getAllRegionTopologies(): readonly ConstructionRegionTopology[] {
    this.#requireReady("reading every region's topology");
    if (typeof this.#construction.getAllRegionTopologies === "function") {
      return this.#construction.getAllRegionTopologies();
    }
    return [];
  }

  queryContours(queries: readonly ConstructionContourQuery[]): readonly ConstructionContourAnswer[] {
    this.#requireReady("asking about contour geometry");
    return this.#construction.queryContours(queries);
  }

  queryField(query: ConstructionFieldQuery): readonly ConstructionFieldSample[] {
    this.#requireReady("reading a reference field");
    return this.#construction.queryField(query);
  }

  getCurvedEdges(): readonly ConstructionCurvedEdge[] {
    this.#requireReady("reading curved boundary edges");
    return typeof this.#construction.getCurvedEdges === "function" ? this.#construction.getCurvedEdges() : [];
  }

  getRegionTopologiesInBounds(bounds: ConstructionTopologyBoundsQuery): readonly ConstructionRegionTopology[] {
    this.#requireReady("reading nearby region topologies");
    if (typeof this.#construction.getRegionTopologiesInBounds === "function") {
      return this.#construction.getRegionTopologiesInBounds(bounds);
    }
    if (typeof this.#construction.getAllRegionTopologies === "function") {
      return this.#construction.getAllRegionTopologies();
    }
    return [];
  }

  generateCap(request: import("../../ports/cap-port.ts").CapRequest): import("../../ports/cap-port.ts").CapPatch {
    this.#requireReady("generating a covering");
    return this.#construction.generateCap(request);
  }

  curveBatch(request: import("../../ports/bezier-port.ts").CurveBatch): readonly import("../../ports/bezier-port.ts").CurveResult[] {
    this.#requireReady("planning curves");
    return this.#construction.curveBatch(request);
  }

  curveNetwork(request: import("../../ports/bezier-port.ts").CurveNetworkRequest): import("../../ports/bezier-port.ts").CurveNetworkPatch {
    this.#requireReady("planning curve connections");
    return this.#construction.curveNetwork(request);
  }

  getGraphSnapshot(): ConstructionGraphSnapshot {
    this.#requireReady("reading the construction graph");
    return this.#construction.getGraphSnapshot();
  }

  /**
   * The projection/render sync every atomic edit shares. Exact vertex moves
   * and insertions carry their positions through `knownNodePositions`; edits
   * that can move an unenumerated cascade fall back to the full engine scan.
   * Removed nodes always come from the authoritative outcome.
   */
  #foldRegionEditOutcome(
    outcome: RegionEditOutcome,
    origin: ChangeOrigin,
    causeId: string,
    knownNodePositions?: ReadonlyMap<ConstructionNodeId, ConstructionPosition>,
  ): void {
    const changed = [...outcome.affectedSurfaceKeys, ...outcome.createdSurfaceKeys];
    const removedRefs = outcome.removedSurfaceKeys.map(surfaceRefFromNodeSet);
    for (const removedRef of removedRefs) this.#pinnedSurfaceRefs?.delete(removedRef);
    if (knownNodePositions !== undefined) knownNodePositions = this.#withCarriedPinnedNodes(outcome.affectedSurfaceKeys, knownNodePositions);
    this.#applyConstructionMutation(changed, removedRefs, origin, causeId, (map) => {
      const removals: MapProjectionDelta[] = [];
      for (const removedRef of removedRefs) {
        const previous = map.byId.get(removedRef);
        if (previous === undefined) continue;
        removals.push({
          type: "surface-removed",
          surfaceRef: removedRef,
          revision: previous.revision + 1,
        });
      }
      for (const nodeId of outcome.removedNodeIds) {
        removals.push({ type: "node-removed", nodeRef: nodeId });
        this.#removeNodeHandle(nodeId, origin, causeId, this.#generation);
      }
      const next = applyMapProjectionDeltas(map, removals);
      return knownNodePositions === undefined
        ? this.#foldDiscoveredNodePositions(next, origin, causeId, this.#generation)
        : this.#foldKnownNodePositions(next, knownNodePositions, origin, causeId, this.#generation);
    });
  }

  #withCarriedPinnedNodes(
    affected: readonly ConstructionSurfaceKey[],
    known: ReadonlyMap<ConstructionNodeId, ConstructionPosition>,
  ): ReadonlyMap<ConstructionNodeId, ConstructionPosition> {
    if (affected.length === 0) return known;
    this.#pinnedSurfaceRefs ??= new Set(
      this.#construction
        .getAllRegionTopologies()
        .filter((topology) => topology.nodes.some((node) => node.pin !== undefined))
        .map((topology) => surfaceRefFromNodeSet(topology.surfaceKey)),
    );
    let carried: Map<ConstructionNodeId, ConstructionPosition> | undefined;
    for (const surfaceKey of affected) {
      if (!this.#pinnedSurfaceRefs.has(surfaceRefFromNodeSet(surfaceKey))) continue;
      for (const node of this.#construction.getRegionTopology(surfaceKey)?.nodes ?? []) {
        if (node.pin === undefined || known.has(node.id)) continue;
        carried ??= new Map(known);
        carried.set(node.id, node.position);
      }
    }
    return carried ?? known;
  }

  /** Rebuilds projections after a session-owned semantic checkpoint restore -- the only place a full `getAllSurfaceMeshes()` re-derivation is still correct, since an undo/redo restore can touch an arbitrary, unenumerated set of surfaces. See {@link AppTabletopRuntime.#fullResyncSurfaces}. */
  #refreshConstructionProjection(origin: ChangeOrigin, causeId: string): void {
    const meshes = this.#construction.getAllSurfaceMeshes();
    this.#pinnedSurfaceRefs = undefined;
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
  applyRegionOverlay(
    request: ApplyRegionOverlayRequest,
    origin: ChangeOrigin,
    causeId: string,
  ): ConstructionPatchOutcome {
    this.#requireReady("applying a region overlay");
    const outcome = this.#construction.applyRegionOverlay(request);
    this.#foldRegionEditOutcome(
      outcome,
      origin,
      causeId,
      request.patch.nodes.length === 0
        ? undefined
        : new Map(request.patch.nodes.map((node) => [node.id, node.position])),
    );
    return outcome;
  }

  /**
   * Replaces `sourceSurfaceKeys` with `patch` and nothing else. How other
   * clouds react to the change is the effect pipeline's business
   * (`effects/effect-commit.ts`), never a side effect of this mutation.
   */
  applyPatchReplacement(
    request: ApplyPatchReplacementRequest,
    origin: ChangeOrigin,
    causeId: string,
  ): ConstructionPatchOutcome {
    this.#requireReady("replacing generated regions");
    return timeCommit(`substituição de ${request.patch.regions[0]?.surfaceType ?? "patch"}`, () => {
      // Boundary size, not just face count. A path regeneration unions the
      // whole touched cloud, so a connected road network comes back as *one*
      // region whose ring is the perimeter of everything joined to it --
      // "1 faces" that is nothing like one small face. Without this the log
      // reads as a cheap edit that is inexplicably slow.
      const boundaryEdges = request.patch.regions.reduce(
        (total, region) =>
          total + region.boundary.length + (region.holes ?? []).reduce((held, hole) => held + hole.length, 0),
        0,
      );
      const outcome = timePhase(
        `motor: substituição (${request.patch.regions.length} faces, ${boundaryEdges} arestas de contorno, ${request.patch.nodes.length} nós)`,
        () => this.#construction.applyPatchReplacement(request),
      );
      const knownNodePositions = new Map<ConstructionNodeId, ConstructionPosition>();
      for (const node of request.patch.nodes) knownNodePositions.set(node.id, node.position);
      for (const node of request.graphPatch?.nodes ?? []) knownNodePositions.set(node.id, node.position);
      timePhase("render", () => this.#foldRegionEditOutcome(outcome, origin, causeId, knownNodePositions));
      return outcome;
    });
  }
  transact<T>(transactionId: string, origin: ChangeOrigin, work: () => T): TransactionResult<T> {
    this.#requireReady("running a construction transaction");
    this.#construction.beginTransaction(transactionId);
    let result: T;
    try {
      result = work();
    } catch (error) {
      this.#construction.rollbackTransaction(transactionId);
      // The rolled-back mutations were already folded into the projection
      // one by one; only a full resync knows every surface they touched.
      this.#refreshConstructionProjection(origin, `rollback:${transactionId}`);
      throw error;
    }
    return { value: result, recorded: this.#construction.commitTransaction(transactionId) };
  }

  undoTransaction(transactionId: string, origin: ChangeOrigin): void {
    this.#requireReady("undoing a construction transaction");
    this.#construction.undoRegionOverlay(transactionId);
    this.#refreshConstructionProjection(origin, `undo:${transactionId}`);
  }

  redoTransaction(transactionId: string, origin: ChangeOrigin): void {
    this.#requireReady("redoing a construction transaction");
    this.#construction.redoRegionOverlay(transactionId);
    this.#refreshConstructionProjection(origin, `redo:${transactionId}`);
  }
  removeSurface(request: RemoveSurfaceRequest, origin: ChangeOrigin, causeId: string): RegionEditOutcome {
    this.#requireReady("removing a surface");

    const outcome = this.#construction.removeSurface(request);
    this.#foldRegionEditOutcome(outcome, origin, causeId);
    return outcome;
  }

  cloudFor(request: CloudRequest): CloudOutcome {
    this.#requireReady("querying a cloud");
    return this.#construction.cloudFor(request);
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

  generateHeightmap(
    width: number,
    height: number,
    seed: number,
    scale: number,
    originX: number,
    originY: number,
  ): Float32Array {
    return this.#terrainNoise.generateHeightmap(width, height, seed, scale, originX, originY);
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
