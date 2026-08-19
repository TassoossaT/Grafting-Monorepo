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
  surfaceRefFromNodeSet,
  type MapProjection,
} from "../../entities/map/index.ts";
import type {
  AffectedSurfaces,
  ApplyPathBrushOutcome,
  CameraControlHandle,
  CameraControlOptions,
  ChangeOrigin,
  CloudOutcome,
  CloudRequest,
  ConfirmedTokenRenderChange,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionSessionPort,
  ConstructionSurfaceKey,
  ConstructionSurfaceSpec,
  DeleteNodeOutcome,
  DiffOutcome,
  GenerateBoundaryCapRequest,
  GeneratePathExtrusionRequest,
  GenerateRegionPartitionRequest,
  GenerateTerrainCellRequest,
  RemoveEdgeRequest,
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

import { PATH_BRUSH_SOURCE_SURFACE_TYPES, type PathBrushEffect } from "../../features/edit-construction/index.ts";

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
 * `generateTerrainCell` callers clamp a click into this positive quadrant, so it
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
  /**
   * One tick of a continuous path-brush pen (wall, fence, any other
   * extruded panel run): regenerates the whole drawn path's straight/arc
   * geometry from `request.edges` and applies only the difference against
   * what already exists. Never generates a floor/ceiling itself -- see
   * {@link generateBoundaryCap}/{@link generateRegionPartition}. See
   * `ConstructionSessionPort.generatePathExtrusion`.
   */
  generatePathExtrusion(request: GeneratePathExtrusionRequest, origin: ChangeOrigin, causeId: string): DiffOutcome;
  /** Previews or confirms one swept convex terrain-to-path effect as a single atomic construction mutation. */
  previewPathBrush(effect: PathBrushEffect): RenderPreviewDescriptor | undefined;
  applyPathBrush(effect: PathBrushEffect, origin: ChangeOrigin): ApplyPathBrushOutcome;
  undoPathBrush(operationId: string, origin: ChangeOrigin): void;
  redoPathBrush(operationId: string, origin: ChangeOrigin): void;
  /** One closed boundary of points becomes one capping surface (a floor, a ceiling, ...). See `ConstructionSessionPort.generateBoundaryCap`. */
  generateBoundaryCap(request: GenerateBoundaryCapRequest, origin: ChangeOrigin, causeId: string): DiffOutcome;
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
  /** Removes an edge outright -- no repair, no cascading. See `ConstructionSessionPort.removeEdge`. */
  removeEdge(request: RemoveEdgeRequest, origin: ChangeOrigin, causeId: string): void;
  /** Deletes a node and repairs the hole it leaves. See `ConstructionSessionPort.deleteNode`. */
  deleteNode(
    nodeId: ConstructionNodeId,
    capSurfaceType: string,
    capPhysical: boolean,
    origin: ChangeOrigin,
    causeId: string,
  ): DeleteNodeOutcome;
  /** `ADR-0022`'s "cloud" query -- a pure read, never touches the map. See `ConstructionSessionPort.cloudFor`. */
  cloudFor(request: CloudRequest): CloudOutcome;
  /**
   * Submits a whole batch of nodes and surfaces (e.g. one irregular-terrain
   * hexagon's worth) through the construction session's existing generic
   * `addNode`/`addSurface` operations, then re-derives/re-uploads exactly
   * like `generateTerrainCell`/`generatePathExtrusion` do. No new Rust/Wasm surface --
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

function emptyPathBrushOutcome(): ApplyPathBrushOutcome {
  const ids = { created: [], preserved: [], replaced: [], removed: [] } as const;
  return {
    nodeIds: ids,
    edgeIds: ids,
    surfaceIds: ids,
    invalidation: { changedSurfaces: [], topologyRepairNeighbors: [], directDependencies: [] },
  };
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
  readonly #seedDefaultMapOnStart: boolean;
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
    seedDefaultMap = false,
  ) {
    const normalizedTableId = tableId.trim();
    if (normalizedTableId.length === 0) {
      throw new Error("tableId must not be empty");
    }

    this.#tableId = normalizedTableId;
    this.#render = render;
    this.#construction = construction;
    this.#terrainNoise = terrainNoise;
    this.#seedDefaultMapOnStart = seedDefaultMap;
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
    this.#construction.setTerrainMesh(TERRAIN_GRID_WIDTH, TERRAIN_GRID_HEIGHT, TERRAIN_GRID_LAYERS, "surface", 0, 0);
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

    const map = this.#seedDefaultMapOnStart ? this.#seedDefaultMap(generation) : createMapProjection();
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
    const terrainKey = this.#construction.generateTerrainCell(terrainCell.payload);
    const wallOutcome = this.#construction.generatePathExtrusion(wall.payload);

    const meshes = this.#construction.getAllSurfaceMeshes();
    const causeId = `table-load:${this.#tableId}`;
    this.#fullResyncSurfaces(meshes, "programmatic", causeId, generation);

    const surfaceKeys = [terrainKey, ...wallOutcome.addedSurfaceKeys];
    let map = this.#foldAffectedSurfaces(createMapProjection(), surfaceKeys, meshes);
    map = this.#foldDiscoveredNodePositions(map, "programmatic", causeId, generation);
    return map;
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
        const newChunkId = chunkKeyForSurface(mesh);
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
      const chunk = bucket === undefined ? undefined : mergeChunkBucket(chunkId, [...bucket.values()]);
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
    this.#applyConstructionMutation(affected.affectedSurfaceKeys, [], origin, causeId, (map) => {
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
    this.#applyConstructionMutation([surfaceKey], [], origin, causeId, (map) =>
      this.#foldDiscoveredNodePositions(map, origin, causeId, this.#generation),
    );
    return surfaceKey;
  }

  /** Folds one Phase-C path-brush transformation without deriving topology in TypeScript. */
  #foldPathBrushOutcome(outcome: ApplyPathBrushOutcome, origin: ChangeOrigin, causeId: string): void {
    const changed = new Map<string, ConstructionSurfaceKey>();
    for (const surfaceKey of [
      ...outcome.surfaceIds.created,
      ...outcome.surfaceIds.preserved,
      ...outcome.surfaceIds.replaced,
      ...outcome.invalidation.changedSurfaces,
      ...outcome.invalidation.topologyRepairNeighbors,
      ...outcome.invalidation.directDependencies,
    ]) {
      changed.set(surfaceRefFromNodeSet(surfaceKey), surfaceKey);
    }

    const removedRefs = outcome.surfaceIds.removed.map(surfaceRefFromNodeSet);
    this.#applyConstructionMutation([...changed.values()], removedRefs, origin, causeId, (map) => {
      let next = map;
      for (const surfaceRef of removedRefs) {
        const previous = next.byId.get(surfaceRef);
        if (previous === undefined) continue;
        next = applyMapProjectionDelta(next, { type: "surface-removed", surfaceRef, revision: previous.revision + 1 });
      }
      next = this.#foldDiscoveredNodePositions(next, origin, causeId, this.#generation);
      for (const nodeId of outcome.nodeIds.removed) {
        next = applyMapProjectionDelta(next, { type: "node-removed", nodeRef: nodeId });
        this.#removeNodeHandle(nodeId, origin, causeId, this.#generation);
      }
      return next;
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

  previewPathBrush(effect: PathBrushEffect): RenderPreviewDescriptor | undefined {
    this.#requireReady("previewing a path brush");
    if (effect.brushRegion.samples.length === 0) return undefined;
    const request = {
      operationId: effect.operationId,
      samples: effect.brushRegion.samples,
      brushShape: effect.brushShape,
      depth: effect.parameters.depth,
      targetSurfaceType: effect.targetType,
      sourceSurfaceTypes: PATH_BRUSH_SOURCE_SURFACE_TYPES,
    };
    let surfaces: readonly SurfaceMeshResult[];
    try {
      surfaces = this.#construction.previewPathBrush(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("produced no semantic change")) throw error;
      return undefined;
    }
    if (surfaces.length === 0) return undefined;
    const mesh = mergeSurfaceMeshes(surfaces);
    if (mesh.indices === undefined) return undefined;
    return { kind: "mesh", positions: mesh.positions, indices: mesh.indices, color: 0xc084fc, opacity: 0.5 };
  }

  applyPathBrush(effect: PathBrushEffect, origin: ChangeOrigin): ApplyPathBrushOutcome {
    this.#requireReady("applying a path brush");
    if (effect.brushRegion.samples.length === 0) {
      throw new Error("a confirmed path brush stroke requires at least one sample");
    }
    const request = {
      operationId: effect.operationId,
      samples: effect.brushRegion.samples,
      brushShape: effect.brushShape,
      depth: effect.parameters.depth,
      targetSurfaceType: effect.targetType,
      sourceSurfaceTypes: PATH_BRUSH_SOURCE_SURFACE_TYPES,
    };
    let outcome: ApplyPathBrushOutcome;
    try {
      outcome = this.#construction.applyPathBrush(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("produced no semantic change")) throw error;
      return emptyPathBrushOutcome();
    }
    this.#foldPathBrushOutcome(outcome, origin, effect.operationId);
    return outcome;
  }
  undoPathBrush(operationId: string, origin: ChangeOrigin): void {
    this.#requireReady("undoing a path brush");
    this.#construction.undoPathBrush(operationId);
    this.#refreshConstructionProjection(origin, `undo:${operationId}`);
  }

  redoPathBrush(operationId: string, origin: ChangeOrigin): void {
    this.#requireReady("redoing a path brush");
    this.#construction.redoPathBrush(operationId);
    this.#refreshConstructionProjection(origin, `redo:${operationId}`);
  }
  generatePathExtrusion(request: GeneratePathExtrusionRequest, origin: ChangeOrigin, causeId: string): DiffOutcome {
    this.#requireReady("drawing a path");

    const outcome = this.#construction.generatePathExtrusion(request);
    this.#foldDiffOutcome(outcome, origin, causeId);
    return outcome;
  }

  generateBoundaryCap(request: GenerateBoundaryCapRequest, origin: ChangeOrigin, causeId: string): DiffOutcome {
    this.#requireReady("capping a boundary");

    const outcome = this.#construction.generateBoundaryCap(request);
    this.#foldDiffOutcome(outcome, origin, causeId);
    return outcome;
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

  removeEdge(request: RemoveEdgeRequest, origin: ChangeOrigin, causeId: string): void {
    this.#requireReady("removing an edge");

    this.#construction.removeEdge(request);
    this.#applyConstructionMutation([], [], origin, causeId, (map) => map);
  }

  deleteNode(
    nodeId: ConstructionNodeId,
    capSurfaceType: string,
    capPhysical: boolean,
    origin: ChangeOrigin,
    causeId: string,
  ): DeleteNodeOutcome {
    this.#requireReady("deleting a node");

    const outcome = this.#construction.deleteNode(nodeId, capSurfaceType, capPhysical);
    const removedRefs = outcome.removedSurfaceKeys.map(surfaceRefFromNodeSet);
    this.#applyConstructionMutation(outcome.cappingSurfaceKeys, removedRefs, origin, causeId, (map) => {
      let next = map;
      for (const surfaceRef of removedRefs) {
        const previous = next.byId.get(surfaceRef);
        if (previous === undefined) continue;
        next = applyMapProjectionDelta(next, { type: "surface-removed", surfaceRef, revision: previous.revision + 1 });
      }
      next = applyMapProjectionDelta(next, { type: "node-removed", nodeRef: nodeId });
      this.#removeNodeHandle(nodeId, origin, causeId, this.#generation);
      return this.#foldDiscoveredNodePositions(next, origin, causeId, this.#generation);
    });
    return outcome;
  }

  cloudFor(request: CloudRequest): CloudOutcome {
    this.#requireReady("querying a cloud");
    return this.#construction.cloudFor(request);
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

    this.#applyConstructionMutation(surfaceKeys, [], origin, causeId, (map) =>
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

    this.#applyConstructionMutation(newKeys, removedRefs, origin, causeId, (map) => {
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
