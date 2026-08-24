# vtt

### `function vtt.construction-session-wasm-adapter.createConstructionSessionAdapter(): ConstructionSessionPort`

### `function vtt.terrain-noise-wasm-adapter.createTerrainNoiseAdapter(): TerrainNoisePort`

### `variable vtt.construction-grid-scene-item.CONSTRUCTION_GRID_EXTENT: 25`

Half the grid's world-space span on each axis -- the board runs from `-extent` to `extent` on both X and Z.

### `variable vtt.construction-grid-scene-item.CONSTRUCTION_GRID_LAYER_ID: "construction-grid"`

### `variable vtt.construction-grid-scene-item.CONSTRUCTION_GRID_MAJOR_ITEM_ID: "construction-grid:major"`

### `variable vtt.construction-grid-scene-item.CONSTRUCTION_GRID_MINOR_ITEM_ID: "construction-grid:minor"`

### `variable vtt.construction-grid-scene-item.CONSTRUCTION_GROUND_ITEM_ID: "construction-ground:plane"`

### `variable vtt.construction-grid-scene-item.CONSTRUCTION_GROUND_LAYER_ID: "construction-ground"`

### `variable vtt.construction-grid-scene-item.CONSTRUCTION_GROUND_VISUAL_KIND: "vtt-construction-ground"`

### `variable vtt.construction-grid-scene-item.GRID_SNAP_UNIT: 1`

The unit `use-construction-pointer.ts`'s snap-to-grid option rounds a picked point to -- the same spacing the visible minor grid lines already draw at, so a snapped point always lands exactly on a drawn intersection.

### `function vtt.construction-grid-scene-item.constructionGridSceneItems(): readonly [SceneItem<GridParams>, SceneItem<GridParams>]`

### `function vtt.construction-grid-scene-item.constructionGroundSceneItem(): SceneItem<Record<string, never>>`

An invisible, pickable plane spanning the whole grid -- without it,
`SceneRenderPort.pick` only ever resolves a point over *existing* map
geometry or a node handle (the construction grid's own lines are
`pickable: false`, and raycasting against sparse line segments would give
poor click coverage even if they weren't). This is what makes the grid
usable as a construction base: a construction tool can now generate the
*first* piece of geometry in an empty area, not only extend geometry that
already exists.

### `interface vtt.construction-preview-scene-item.ConstructionPreviewVisualParams`

### `property vtt.construction-preview-scene-item.ConstructionPreviewVisualParams.color: number`

### `property vtt.construction-preview-scene-item.ConstructionPreviewVisualParams.filled: boolean`

### `property vtt.construction-preview-scene-item.ConstructionPreviewVisualParams.indices?: Uint16Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>`

### `property vtt.construction-preview-scene-item.ConstructionPreviewVisualParams.opacity: number`

### `property vtt.construction-preview-scene-item.ConstructionPreviewVisualParams.positions: Float32Array`

### `variable vtt.construction-preview-scene-item.CONSTRUCTION_PREVIEW_LAYER_ID: "construction-preview"`

### `variable vtt.construction-preview-scene-item.CONSTRUCTION_PREVIEW_VISUAL_KIND: "vtt-construction-preview"`

### `variable vtt.construction-preview-scene-item.DEFAULT_PREVIEW_CHANNEL: "active"`

The channel a caller that names none is drawn on -- the single tool ghost.

### `function vtt.construction-preview-scene-item.constructionPreviewSceneItem(descriptor: RenderPreviewDescriptor, channel: string): SceneItem<ConstructionPreviewVisualParams>`

Turns a tool's plain RenderPreviewDescriptor into a scene item on
the dedicated preview layer -- never pickable, drawn above everything
(tokens included) so a ghost is never occluded by real geometry.

### `function vtt.construction-preview-scene-item.constructionPreviewSceneItemId(channel: string): string`

One id per channel, so `put` replaces within a channel and never across.

### `interface vtt.map-chunk-batching.ResolvedCovering`

A resolved covering as this adapter needs to see it. Structurally matches
`entities/map`'s `SurfaceCovering`; declared here so the adapter depends on a
shape rather than on a product slice.

### `property vtt.map-chunk-batching.ResolvedCovering.key: string`

### `property vtt.map-chunk-batching.ResolvedCovering.kind: string`

### `property vtt.map-chunk-batching.ResolvedCovering.surface: { color: number } | undefined`

`undefined` for a covering that draws no surface mesh.

### `type vtt.map-chunk-batching.CoveringResolver = (surfaceType: string, physical: boolean) => ResolvedCovering`

Resolves a surface's visual fill. Supplied by the caller rather than imported
so this adapter stays a translator: `entities/map` owns the policy, and no
adapter here reaches upstream into a product slice to ask what something
should look like.

### `function vtt.map-chunk-batching.chunkKeyForSurface(surface: SurfaceMeshResult, resolveCovering: CoveringResolver): string`

Which chunk one surface's mesh lands in -- shared by the full re-chunk below
and `tabletop-runtime.ts`'s own incremental sync, so both agree on chunk
membership.

The key is spatial bucket **and** covering, not bucket alone. Bucketing by
position only meant a bucket holding a wall and a terrain cell merged them
into one buffer, which can carry exactly one appearance -- so one of the two
silently rendered as the other. Splitting the key is what makes a chunk a set
of surfaces that genuinely can share a draw.

### `function vtt.map-chunk-batching.chunkSurfaceMeshes(surfaces: readonly SurfaceMeshResult[], resolveCovering: CoveringResolver): readonly RenderMapChunk[]`

Buckets triangulated construction surfaces into spatial chunks (via the
existing chunkKeyFor) and merges each bucket's meshes into one
buffer (via `@grafting/render-3d`'s existing `mergeMeshChunks`), producing
the `RenderMapChunk`s `SceneRenderPort.applyConfirmed` expects.

Surfaces that look different never share a chunk: chunkKeyForSurface
keys by covering as well as position, so the merged buffer always has exactly
one appearance to carry.

### `function vtt.map-chunk-batching.mergeChunkBucket(chunkId: string, members: readonly SurfaceMeshResult[], resolveCovering: CoveringResolver): RenderMapChunk | undefined`

Merges one spatial chunk's current member surfaces into the one `RenderMapChunk` buffer `SceneRenderPort.applyConfirmed` expects -- `undefined` for an empty bucket (the caller should remove the chunk instead of upserting it). See chunkSurfaceMeshes's own doc for why a chunk is always a full re-merge of its members, never a per-surface patch.

### `function vtt.map-chunk-batching.mergeSurfaceMeshes(surfaces: readonly SurfaceMeshResult[]): RenderMeshData`

Merges exact per-surface preview meshes into one renderer-neutral mesh descriptor.

### `function vtt.map-chunk-key.chunkKeyFor(centroid: Vec3, chunkSize: number): string`

Buckets a world-space centroid into a fixed-size XZ grid cell, identified
by its own cell coordinates. Pure arithmetic, not a graph algorithm, so it
stays app-owned rather than reproducing a `libs/*` capability by hand.

Vertical position never affects the bucket: chunking exists to bound how
much geometry one buffer holds on the ground plane, not to slice by floor
(floor cutting is the clip plane's job, see clipPlaneForCameraHeight).

### `function vtt.map-chunk-key.clipPlaneForCameraHeight(cameraY: number, offset: number): ClipPlaneDescriptor`

Converts a camera height into the clip plane that hides geometry above it,
so a viewer above a floor can see into it instead of only its roof.

Continuous world-space Y, not a discrete floor index -- the roadmap's own
requirement for this task. Not called from this task's own wiring (no live
camera exists in `apps/vtt` yet); it is the ready integration point `E3.7`
calls once pointer/camera control exists.

### `interface vtt.map-chunk-scene-item.MapChunkVisualParams`

### `property vtt.map-chunk-scene-item.MapChunkVisualParams.color: number`

### `property vtt.map-chunk-scene-item.MapChunkVisualParams.mesh: RenderMeshData`

### `variable vtt.map-chunk-scene-item.MAP_LAYER_ID: "map"`

### `variable vtt.map-chunk-scene-item.MAP_SURFACE_VISUAL_KIND: "vtt-map-surface"`

### `function vtt.map-chunk-scene-item.mapChunkSceneItem(chunk: RenderMapChunk): SceneItem<MapChunkVisualParams>`

Translates one already-classified map chunk into a scene item.

Deciding what a surface looks like is not this module's job: the chunk
arrives with its covering already resolved by `entities/map`, and this
function only carries it across the renderer boundary. It used to derive the
color itself from `surfaceType`, which put product presentation policy
downstream of the port meant to feed it -- see
`docs/architecture/vtt-surface-covering-transformation-plan.md`.

### `interface vtt.map-surface-pick-scene-item.MapSurfacePickData`

### `property vtt.map-surface-pick-scene-item.MapSurfacePickData.entity: "map-surface-pick"`

### `property vtt.map-surface-pick-scene-item.MapSurfacePickData.surfaceRef: string`

### `interface vtt.map-surface-pick-scene-item.MapSurfacePickVisualParams`

### `property vtt.map-surface-pick-scene-item.MapSurfacePickVisualParams.mesh: RenderMeshData`

### `variable vtt.map-surface-pick-scene-item.MAP_SURFACE_PICK_LAYER_ID: "map-surface-picks"`

### `variable vtt.map-surface-pick-scene-item.MAP_SURFACE_PICK_VISUAL_KIND: "vtt-map-surface-pick"`

### `function vtt.map-surface-pick-scene-item.mapSurfacePickSceneItem(surfaceRef: string, mesh: RenderMeshData): SceneItem<MapSurfacePickVisualParams>`

Invisible pick proxy retaining one canonical SurfaceRef per render item.

### `function vtt.map-surface-pick-scene-item.mapSurfacePickSceneItemId(surfaceRef: string): string`

### `function vtt.marker-textures.createMarkerTexture(): HTMLCanvasElement`

Draws the sprite texture for a placed token marker: a filled circle with a small pointer tail.

### `function vtt.marker-textures.createNodeHandleTexture(): HTMLCanvasElement`

A small ring-dot, visually distinct from the token marker -- an editable construction-node handle, not a placed token.

### `interface vtt.node-handle-scene-item.NodeHandlePickData`

Opaque per-item data a pick result echoes back, letting the adapter recover which node a hit handle belongs to without parsing its scene item id.

### `property vtt.node-handle-scene-item.NodeHandlePickData.entity: "construction-node-handle"`

### `property vtt.node-handle-scene-item.NodeHandlePickData.nodeId: string`

### `variable vtt.node-handle-scene-item.NODE_HANDLE_LAYER_ID: "construction-handles"`

### `variable vtt.node-handle-scene-item.NODE_HANDLE_VISUAL_KIND: "vtt-construction-node-handle"`

### `function vtt.node-handle-scene-item.nodeHandleSceneItem(nodeId: string, position: ConstructionPosition): SceneItem<Record<string, never>>`

### `function vtt.node-handle-scene-item.nodeHandleSceneItemId(nodeId: string): string`

### `function vtt.node-handle-scene-item.nodeHandleTransform(position: ConstructionPosition): Transform`

### `class vtt.render-3d-scene-adapter.Render3dSceneAdapter`

### `constructor vtt.render-3d-scene-adapter.Render3dSceneAdapter.constructor(): Render3dSceneAdapter`

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.applyConfirmed(change: ConfirmedRenderChange): void`

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.attachCameraControls(viewId: string, element: HTMLElement, options: CameraControlOptions): CameraControlHandle`

Makes `element`'s drag/scroll gestures drive `viewId`'s camera, starting
from the framing that view was created with. Call once per view and hold
the returned handle for its lifetime, the same convention `attachView`
itself already follows -- calling this again on the same view resets to
that original framing rather than continuing from wherever the camera
currently is.

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.attachView(target: HTMLElement): string`

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.clearPreview(channel?: string): void`

Hides one channel, or every channel when none is named.

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.detachView(viewId: string): void`

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.dispose(): Promise<void>`

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.getMetrics(): SceneRenderMetrics`

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.pick(viewId: string, x: number, y: number): ScenePickResult | undefined`

Resolves a pointer position (in the view's CSS pixels) to what it hit, or `undefined` if it hit nothing.

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.resizeView(viewId: string, width: number, height: number): void`

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.setFloorClipHeight(height: number | undefined): void`

Sets the floor-cutaway height in continuous world-space Y. `undefined` disables cutaway.

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.showPreview(descriptor: RenderPreviewDescriptor, channel: string): void`

Shows (or replaces) one preview overlay.

`channel` names which overlay: two callers with different names coexist,
and the same name always replaces. A tool's own ghost is one channel; a
diagnostic overlay drawn alongside it is another, and neither has to know
the other exists. Omitted means the default channel, which is the
single-ghost behaviour every tool already relies on.

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.start(runtimeGeneration: number): Promise<void>`

### `function vtt.render-3d-scene-adapter.createRender3dSceneAdapter(): SceneRenderPort`

### `interface vtt.token-scene-item.TokenVisualParams`

### `property vtt.token-scene-item.TokenVisualParams.color: number`

### `variable vtt.token-scene-item.TOKEN_LAYER_ID: "tokens"`

### `variable vtt.token-scene-item.TOKEN_VISUAL_KIND: "vtt-token-billboard"`

### `function vtt.token-scene-item.tokenSceneItem(token: RenderToken): SceneItem<TokenVisualParams>`

### `function vtt.token-scene-item.tokenTransform(token: RenderToken): Transform`

### `interface vtt.create-tabletop-runtime.CreateTabletopRuntimeInput`

### `property vtt.create-tabletop-runtime.CreateTabletopRuntimeInput.constructionPort?: ConstructionSessionPort`

### `property vtt.create-tabletop-runtime.CreateTabletopRuntimeInput.initialTokens?: readonly TokenProjection[]`

### `property vtt.create-tabletop-runtime.CreateTabletopRuntimeInput.renderPort?: SceneRenderPort`

### `property vtt.create-tabletop-runtime.CreateTabletopRuntimeInput.tableId: string`

### `property vtt.create-tabletop-runtime.CreateTabletopRuntimeInput.terrainNoisePort?: TerrainNoisePort`

### `function vtt.create-tabletop-runtime.createTabletopRuntime(input: CreateTabletopRuntimeInput): TabletopRuntime`

### `class vtt.tabletop-runtime.AppTabletopRuntime`

### `constructor vtt.tabletop-runtime.AppTabletopRuntime.constructor(tableId: string, render: SceneRenderPort, construction: ConstructionSessionPort, terrainNoise: TerrainNoisePort, initialTokens: readonly TokenProjection[]): AppTabletopRuntime`

### `method vtt.tabletop-runtime.AppTabletopRuntime.addHole(request: { hole: readonly ConstructionOrientedEdgeUse[]; surfaceKey: ConstructionSurfaceKey }, origin: ChangeOrigin, causeId: string): RegionEditOutcome`

Opens one more inner loop on a face that already exists -- what a door
or a window stands in. The loop must already be registered, and it keeps
one free use per edge so a face can take it.

### `method vtt.tabletop-runtime.AppTabletopRuntime.addPatch(patch: ConstructionPatch, origin: ChangeOrigin, causeId: string): ConstructionPatchOutcome`

Registers a whole generated patch -- nodes, shared boundary edges, and
the faces over them -- in one transaction. See `ConstructionPatch`.

### `method vtt.tabletop-runtime.AppTabletopRuntime.applyConfirmedToken(envelope: ConfirmedTokenDeltaEnvelope): void`

### `method vtt.tabletop-runtime.AppTabletopRuntime.applyRegionEdit(ops: readonly AtomicEditOp[], origin: ChangeOrigin, causeId: string): RegionEditOutcome`

Applies a resolved sequence of atomic edit ops as one transaction, then
re-derives and re-uploads every chunk and folds the whole merged
outcome into the cached `MapProjection`.

Policy resolution deliberately happens *before* this call, in
`features/edit-construction`: this method never asks what a wall allows,
it only performs what was already decided -- see
`docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.

### `method vtt.tabletop-runtime.AppTabletopRuntime.applyRegionOverlay(request: ApplyRegionOverlayRequest, origin: ChangeOrigin, causeId: string): ConstructionPatchOutcome`

### `method vtt.tabletop-runtime.AppTabletopRuntime.applyWallCrossingWeld(inserts: readonly { edgeId: string; firstEdgeId: string; nodeId: string; position: ConstructionPosition; secondEdgeId: string }[], origin: ChangeOrigin, causeId: string): RegionEditOutcome`

Welds a T-junction into an existing panel: subdividing the crossed
panel's own boundary edges at the crossing point, through
`insertVertex`. The panel stays one region with more boundary, rather
than being replaced by two -- the crossing wall welds onto the freshly
minted nodes by position, which is all the junction ever needed.

### `method vtt.tabletop-runtime.AppTabletopRuntime.attachCameraControls(viewId: string, element: HTMLElement, options?: CameraControlOptions): CameraControlHandle`

### `method vtt.tabletop-runtime.AppTabletopRuntime.attachView(target: HTMLElement): string`

### `method vtt.tabletop-runtime.AppTabletopRuntime.classifyPoints(points: readonly (readonly [number, number])[]): readonly { index: number; surfaceKey: ConstructionSurfaceKey; surfaceType: string }[]`

Which of `points` already sit inside a region -- per-point, for a generator building only over open ground.

### `method vtt.tabletop-runtime.AppTabletopRuntime.clearPreview(channel?: string): void`

Hides the active tool preview, if any.

### `method vtt.tabletop-runtime.AppTabletopRuntime.cloudFor(request: CloudRequest): CloudOutcome`

`ADR-0022`'s "cloud" query -- a pure read, never touches the map. See `ConstructionSessionPort.cloudFor`.

### `method vtt.tabletop-runtime.AppTabletopRuntime.detachView(viewId: string): void`

### `method vtt.tabletop-runtime.AppTabletopRuntime.dispose(): Promise<void>`

### `method vtt.tabletop-runtime.AppTabletopRuntime.generateHeightmap(width: number, height: number, seed: number, scale: number): Float32Array`

Passthrough to `TerrainNoisePort.generateHeightmap` -- see that port for parameter meaning.

### `method vtt.tabletop-runtime.AppTabletopRuntime.generateRegionPartition(request: GenerateRegionPartitionRequest, origin: ChangeOrigin, causeId: string): DiffOutcome`

One tick of a continuous cell-painting brush ("Pintar Casa," a
wall-brush stroke's closure): regenerates the whole painted cell
set's region partition and applies only the difference against what
already exists -- walls/floors/ceilings can be added AND removed in
the same call (a split moving, two regions merging). See
`ConstructionSessionPort.generateRegionPartition`.

### `method vtt.tabletop-runtime.AppTabletopRuntime.getAllRegionTopologies(): readonly ConstructionRegionTopology[]`

Every region's boundary.

### `method vtt.tabletop-runtime.AppTabletopRuntime.getFootprintCoverage(polygon: readonly (readonly [number, number])[]): readonly ConstructionCoveredRegion[]`

What a brush footprint currently covers, before anything is generated.

### `method vtt.tabletop-runtime.AppTabletopRuntime.getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined`

One region's live boundary -- what a handle/hit-test layer reads.

### `method vtt.tabletop-runtime.AppTabletopRuntime.getRenderMetrics(): SceneRenderMetrics`

### `method vtt.tabletop-runtime.AppTabletopRuntime.getSnapshot(): TabletopSnapshot`

### `method vtt.tabletop-runtime.AppTabletopRuntime.getUnfilledLoops(scope: readonly string[]): readonly ConstructionUnfilledLoop[]`

Every closed loop of boundary with no face on it, among `scope`'s nodes -- a hole whose rim already exists.

### `method vtt.tabletop-runtime.AppTabletopRuntime.moveVertex(nodeId: string, position: ConstructionPosition, origin: ChangeOrigin, causeId: string): RegionEditOutcome`

The single-op shortcut for a caller that already knows the absolute
position it wants (an undo/redo stack replaying a drag), skipping the
policy pass a live gesture goes through.

### `method vtt.tabletop-runtime.AppTabletopRuntime.pick(viewId: string, x: number, y: number): ScenePickResult | undefined`

### `method vtt.tabletop-runtime.AppTabletopRuntime.redoPathBrush(operationId: string, origin: ChangeOrigin): void`

### `method vtt.tabletop-runtime.AppTabletopRuntime.removeSurface(request: RemoveSurfaceRequest, origin: ChangeOrigin, causeId: string): void`

Unregisters a surface outright -- no hole-repair, no cascading. A caller composing a bigger removal (e.g. "Apagar Cômodo") calls this once per surface it already knows belongs to that removal. See `ConstructionSessionPort.removeSurface`.

### `method vtt.tabletop-runtime.AppTabletopRuntime.resizeView(viewId: string, width: number, height: number): void`

### `method vtt.tabletop-runtime.AppTabletopRuntime.showPreview(descriptor: RenderPreviewDescriptor, channel?: string): void`

Shows a construction tool's not-yet-committed ghost. Purely visual -- passthrough to `SceneRenderPort`, never touches the construction session.

### `method vtt.tabletop-runtime.AppTabletopRuntime.start(): Promise<void>`

### `method vtt.tabletop-runtime.AppTabletopRuntime.subscribe(listener: TabletopRuntimeListener): () => void`

### `method vtt.tabletop-runtime.AppTabletopRuntime.undoPathBrush(operationId: string, origin: ChangeOrigin): void`

### `interface vtt.tabletop-runtime.ConfirmedTokenDeltaEnvelope`

### `property vtt.tabletop-runtime.ConfirmedTokenDeltaEnvelope.causeId: string`

### `property vtt.tabletop-runtime.ConfirmedTokenDeltaEnvelope.delta: TokenProjectionDelta`

### `property vtt.tabletop-runtime.ConfirmedTokenDeltaEnvelope.origin: ChangeOrigin`

### `interface vtt.tabletop-runtime.TabletopRuntime`

### `method vtt.tabletop-runtime.TabletopRuntime.addHole(request: { hole: readonly ConstructionOrientedEdgeUse[]; surfaceKey: ConstructionSurfaceKey }, origin: ChangeOrigin, causeId: string): RegionEditOutcome`

Opens one more inner loop on a face that already exists -- what a door
or a window stands in. The loop must already be registered, and it keeps
one free use per edge so a face can take it.

### `method vtt.tabletop-runtime.TabletopRuntime.addPatch(patch: ConstructionPatch, origin: ChangeOrigin, causeId: string): ConstructionPatchOutcome`

Registers a whole generated patch -- nodes, shared boundary edges, and
the faces over them -- in one transaction. See `ConstructionPatch`.

### `method vtt.tabletop-runtime.TabletopRuntime.applyConfirmedToken(envelope: ConfirmedTokenDeltaEnvelope): void`

### `method vtt.tabletop-runtime.TabletopRuntime.applyRegionEdit(ops: readonly AtomicEditOp[], origin: ChangeOrigin, causeId: string): RegionEditOutcome`

Applies a resolved sequence of atomic edit ops as one transaction --
what `planEdit` produced from the user's gesture and the grabbed role's
own policy. The runtime deliberately does not resolve policy itself:
that belongs to `features/edit-construction`, and the tool layer runs it
before calling here.

### `method vtt.tabletop-runtime.TabletopRuntime.applyRegionOverlay(request: ApplyRegionOverlayRequest, origin: ChangeOrigin, causeId: string): ConstructionPatchOutcome`

### `method vtt.tabletop-runtime.TabletopRuntime.applyWallCrossingWeld(inserts: readonly { edgeId: string; firstEdgeId: string; nodeId: string; position: ConstructionPosition; secondEdgeId: string }[], origin: ChangeOrigin, causeId: string): RegionEditOutcome`

Welds a T-junction into an existing panel: subdividing the crossed
panel's own boundary edges at the crossing point, through
`insertVertex`. The panel stays one region with more boundary, rather
than being replaced by two -- the crossing wall welds onto the freshly
minted nodes by position, which is all the junction ever needed.

### `method vtt.tabletop-runtime.TabletopRuntime.attachCameraControls(viewId: string, element: HTMLElement, options?: CameraControlOptions): CameraControlHandle`

### `method vtt.tabletop-runtime.TabletopRuntime.attachView(target: HTMLElement): string`

### `method vtt.tabletop-runtime.TabletopRuntime.classifyPoints(points: readonly (readonly [number, number])[]): readonly { index: number; surfaceKey: ConstructionSurfaceKey; surfaceType: string }[]`

Which of `points` already sit inside a region -- per-point, for a generator building only over open ground.

### `method vtt.tabletop-runtime.TabletopRuntime.clearPreview(channel?: string): void`

Hides the active tool preview, if any.

### `method vtt.tabletop-runtime.TabletopRuntime.cloudFor(request: CloudRequest): CloudOutcome`

`ADR-0022`'s "cloud" query -- a pure read, never touches the map. See `ConstructionSessionPort.cloudFor`.

### `method vtt.tabletop-runtime.TabletopRuntime.detachView(viewId: string): void`

### `method vtt.tabletop-runtime.TabletopRuntime.dispose(): Promise<void>`

### `method vtt.tabletop-runtime.TabletopRuntime.generateHeightmap(width: number, height: number, seed: number, scale: number): Float32Array`

Passthrough to `TerrainNoisePort.generateHeightmap` -- see that port for parameter meaning.

### `method vtt.tabletop-runtime.TabletopRuntime.generateRegionPartition(request: GenerateRegionPartitionRequest, origin: ChangeOrigin, causeId: string): DiffOutcome`

One tick of a continuous cell-painting brush ("Pintar Casa," a
wall-brush stroke's closure): regenerates the whole painted cell
set's region partition and applies only the difference against what
already exists -- walls/floors/ceilings can be added AND removed in
the same call (a split moving, two regions merging). See
`ConstructionSessionPort.generateRegionPartition`.

### `method vtt.tabletop-runtime.TabletopRuntime.getAllRegionTopologies(): readonly ConstructionRegionTopology[]`

Every region's boundary.

### `method vtt.tabletop-runtime.TabletopRuntime.getFootprintCoverage(polygon: readonly (readonly [number, number])[]): readonly ConstructionCoveredRegion[]`

What a brush footprint currently covers, before anything is generated.

### `method vtt.tabletop-runtime.TabletopRuntime.getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined`

One region's live boundary -- what a handle/hit-test layer reads.

### `method vtt.tabletop-runtime.TabletopRuntime.getRenderMetrics(): SceneRenderMetrics`

### `method vtt.tabletop-runtime.TabletopRuntime.getSnapshot(): TabletopSnapshot`

### `method vtt.tabletop-runtime.TabletopRuntime.getUnfilledLoops(scope: readonly string[]): readonly ConstructionUnfilledLoop[]`

Every closed loop of boundary with no face on it, among `scope`'s nodes -- a hole whose rim already exists.

### `method vtt.tabletop-runtime.TabletopRuntime.moveVertex(nodeId: string, position: ConstructionPosition, origin: ChangeOrigin, causeId: string): RegionEditOutcome`

The single-op shortcut for a caller that already knows the absolute
position it wants (an undo/redo stack replaying a drag), skipping the
policy pass a live gesture goes through.

### `method vtt.tabletop-runtime.TabletopRuntime.pick(viewId: string, x: number, y: number): ScenePickResult | undefined`

### `method vtt.tabletop-runtime.TabletopRuntime.redoPathBrush(operationId: string, origin: ChangeOrigin): void`

### `method vtt.tabletop-runtime.TabletopRuntime.removeSurface(request: RemoveSurfaceRequest, origin: ChangeOrigin, causeId: string): void`

Unregisters a surface outright -- no hole-repair, no cascading. A caller composing a bigger removal (e.g. "Apagar Cômodo") calls this once per surface it already knows belongs to that removal. See `ConstructionSessionPort.removeSurface`.

### `method vtt.tabletop-runtime.TabletopRuntime.resizeView(viewId: string, width: number, height: number): void`

### `method vtt.tabletop-runtime.TabletopRuntime.showPreview(descriptor: RenderPreviewDescriptor, channel?: string): void`

Shows a construction tool's not-yet-committed ghost. Purely visual -- passthrough to `SceneRenderPort`, never touches the construction session.

### `method vtt.tabletop-runtime.TabletopRuntime.start(): Promise<void>`

### `method vtt.tabletop-runtime.TabletopRuntime.subscribe(listener: TabletopRuntimeListener): () => void`

### `method vtt.tabletop-runtime.TabletopRuntime.undoPathBrush(operationId: string, origin: ChangeOrigin): void`

### `interface vtt.tabletop-runtime.TabletopSnapshot`

### `property vtt.tabletop-runtime.TabletopSnapshot.map: MapProjection`

### `property vtt.tabletop-runtime.TabletopSnapshot.revision: number`

### `property vtt.tabletop-runtime.TabletopSnapshot.status: TabletopRuntimeStatus`

### `property vtt.tabletop-runtime.TabletopSnapshot.tableId: string`

### `property vtt.tabletop-runtime.TabletopSnapshot.tokens: TokenCollectionProjection`

### `type vtt.tabletop-runtime.TabletopRuntimeListener = () => void`

### `type vtt.tabletop-runtime.TabletopRuntimeStatus = "idle" | "starting" | "ready" | "disposed"`

### `reference vtt.tools.HouseVec2 -> vtt.interior-partition.Vec2`

### `reference vtt.tools.IrregularGridVec2 -> vtt.irregular-grid.Vec2`

### `interface vtt.boundary-edges.BoundaryEdges`

Collects the boundary edges one patch declares, and the uses that walk them.

### `method vtt.boundary-edges.BoundaryEdges.all(): readonly ConstructionPatchEdge[]`

Every edge declared so far, each exactly once.

### `method vtt.boundary-edges.BoundaryEdges.use(from: string, to: string, geometry?: ConstructionEdgeGeometry): ConstructionOrientedEdgeUse`

Declares (or reuses) the edge between `from` and `to`, given that edge's geometry walked `from` -> `to`, and returns the use that walks it in that direction. Geometry defaults to a straight chord.

### `type vtt.boundary-edges.EdgeSharing = { existingUses: ReadonlyMap<ConstructionEdgeId, readonly boolean[]>; kind: "private-when-full"; runPrefix: string } | { kind: "refuse-when-full" }`

What a generator does when the shared edge it wants has no room left.

An edge bounds two faces, one on each side, and the engine refuses a
third use or a second one facing the same way. Whether that refusal is
correct depends entirely on what the type means by it, so the type says.

### `function vtt.boundary-edges.boundaryUsage(ctx: ToolContext): ReadonlyMap<string, readonly boolean[]>`

Every direction each boundary edge on the table is currently walked in.

Read once per commit by a `"private-when-full"` generator, so it can tell
which boundary it may join from which it has to keep to itself. A
`"refuse-when-full"` generator never needs this and should not pay for
the scan.

### `function vtt.boundary-edges.createBoundaryEdges(tableId: string, sharing: EdgeSharing): BoundaryEdges`

### `function vtt.boundary-edges.reverseGeometry(geometry: ConstructionEdgeGeometry): ConstructionEdgeGeometry`

The same physical curve seen from the other end -- an arc keeps its center and flips its sweep, a chord is symmetric.

### `function vtt.boundary-edges.sharedEdgeId(tableId: string, from: string, to: string): string`

The name the edge between two nodes carries, wherever it is named.

Exported because declaring a patch is not the only way an edge comes into
being: splitting one at a node mints two more, and if those are named any
other way then a face declared later over the same pair of nodes gets a
second, coincident edge instead of the one already there. One rule, one
name, everywhere -- which is what lets a junction share a spine seam with
the run it split.

### `interface vtt.brush-tool.BrushRegion`

The one geometric fact a brush produces: its shape plus every sample the
gesture has swept through, start to end. No fitting, no element selection,
no domain effect -- what the sweep means is entirely up to
BrushToolSpec.applyRegion.

### `property vtt.brush-tool.BrushRegion.samples: readonly ConstructionPosition[]`

### `property vtt.brush-tool.BrushRegion.shape: BrushShape`

The brush footprint, already widened to hold the product -- see
expandedToHold. This is what the ghost is drawn from, which is
what makes the ghost an honest envelope rather than a decoration.

### `property vtt.brush-tool.BrushRegion.tolerance: number`

How far the committed product may be moved off the drawn stroke to
straighten it: whatever of the brush's own reach the product does not
occupy. See BrushToolSpec.halfWidth.

### `interface vtt.brush-tool.BrushToolSpec`

### `property vtt.brush-tool.BrushToolSpec.id: Id`

### `method vtt.brush-tool.BrushToolSpec.applyRegion(region: BrushRegion, ctx: ToolContext, params: ToolParamsFor<Id>): void`

The only place domain semantics live: what the swept region means, and
which backend call applies it. Called exactly once, on pointer release,
with the whole gesture's region -- never incrementally, never per-cell,
never per-segment. Recomputing over the full region on every commit is
fine; the brush never tracks what was already applied.

### `method vtt.brush-tool.BrushToolSpec.defaultParams(): ToolParamsFor<Id>`

### `method vtt.brush-tool.BrushToolSpec.halfWidth(params: ToolParamsFor<Id>): number`

How far this brush's own product reaches from the stroke it is drawn
along -- half a road's full width, shoulders included; zero for a
product with no width of its own.

This is the one number that gives the brush's reach a meaning, and it
gives every brush the *same* meaning: the reach is the envelope the
product must fit inside, and whatever the product leaves unused is the
budget for straightening the hand. A wall is columns and shared edges,
with no thickness in plan, so its whole reach is correction budget --
the behaviour it already had, now falling out of the general rule
instead of being a rule of its own.

### `method vtt.brush-tool.BrushToolSpec.previewColor(params: ToolParamsFor<Id>): number`

### `type vtt.brush-tool.BrushableToolId = "path-brush" | "wall-brush"`

Tool ids whose parameters carry a brush shape (radius/rotation/footprint) -- the only ids createBrushTool can wire up.

### `function vtt.brush-tool.brushReach(shape: BrushShape): number`

How far a brush shape reaches from its own center. What that reach *means*
is the calling tool's business -- a footprint to carve for one, a fitting
tolerance for another -- but the number itself is a property of the shape,
so it is derived once here rather than per tool.

### `function vtt.brush-tool.createBrushTool(spec: BrushToolSpec<Id>): ConstructionTool<Id>`

Wires a BrushToolSpec into a `ConstructionTool`. Shape/size/rotation
resolution, pointer batching (the dispatcher's own `gesture.samples`), the
generic filled-region preview, and the commit-once-per-gesture contract
all live here, once -- every brush shares this instead of reimplementing
it, including the preview: what a brush stroke will do depends on what's
underneath it, but that's `applyRegion`'s job to sort out at commit time
(the same way terrain generation already varies its own outcome by
region), not a reason for the preview itself to special-case one tool.
Only `applyRegion` differs between brushes; the brush -- preview included
-- is the same for all of them.

### `interface vtt.contour-fusion.ContourFusion`

One place a rim being committed must fuse into a standing one.

### `property vtt.contour-fusion.ContourFusion.along: number`

Where along that edge the meeting point falls, from 0 to 1.

### `property vtt.contour-fusion.ContourFusion.edgeId: string`

The standing edge that gains the meeting point.

### `property vtt.contour-fusion.ContourFusion.ownIndex: number`

The point of the committed rim that moves onto the meeting point.

### `property vtt.contour-fusion.ContourFusion.position: ConstructionPosition`

Where the two rims meet, at the height the committed rim carries there.

### `property vtt.contour-fusion.ContourFusion.standingIndex: number`

Which segment of the standing rim that was.

### `interface vtt.contour-fusion.FusionPolyline`

One polyline of a rim, with the edge standing between each pair of points.

### `property vtt.contour-fusion.FusionPolyline.edgeIds: readonly (string | undefined)[]`

The edge between consecutive points; one shorter than `points`.

### `property vtt.contour-fusion.FusionPolyline.points: readonly ConstructionPosition[]`

### `function vtt.contour-fusion.contourFusionsAgainst(own: FusionPolyline, standing: FusionPolyline, standingFootprint: readonly PointXZ[]): readonly ContourFusion[]`

Every meeting point between a rim being committed and one already standing.

A crossing counts when it cuts off an **end** of the committed rim: the
first or last point, sitting inside `standingFootprint` with nothing of the
rim beyond it. That is the loose end -- the stub poking into the other face
-- and it is the one that moves onto the meeting point, which both cuts the
stub and fuses the rims in a single stroke.

An interior point inside the footprint is a rim passing clean **through**
rather than arriving, and is left alone. Pulling it back would fold the rim
over on itself; cutting it properly means splitting the committed rim in
two and filling the gap with a face, and nothing here is allowed to invent
that face. So a true through-crossing still leaves two rims crossing, and
closing it is the junction face this does not build.

At most one fusion per committed point and one per standing edge: a point
can only be in one place, and an edge split twice would name a second time
the edge the first split has already replaced.

### `function vtt.contour-fusion.footprintOf(left: readonly ConstructionPosition[], right: readonly ConstructionPosition[]): readonly ConstructionPosition[]`

The closed footprint a pair of rims bounds, walked as one ring.

### `function vtt.contour-fusion.mitrePoint(joint: ConstructionPosition, ownRim: ConstructionPosition, ownDirection: PointXZ, standingRim: ConstructionPosition, standingDirection: PointXZ, limit: number): ConstructionPosition`

Where two rims leaving one joint meet if each keeps going as it was.

This is the mitre, and it is what an L bend needs: the two runs share a
station, so their cross-sections at that station are the same cut, and the
question is only where the outer corner of that cut falls. On the outside
of the bend the two rims cross ahead of themselves; on the inside they
cross behind. Both are the same intersection of two infinite lines, which
is why there is no case analysis here.

Parallel rims -- one run continuing straight into the next -- meet nowhere,
and the honest answer is the point half way between them.

### `function vtt.contour-fusion.sideOf(origin: PointXZ, direction: PointXZ, at: PointXZ): number`

Which side of `direction` the point `at` lies, seen from `origin`.

The sign is all that is used. Two rims belong to the same side of a joint
when a traveller passing through it keeps them both on the same hand --
which, since one run's direction points *into* the joint and the other's
points *out* of it, means their signs are opposite.

### `interface vtt.edge-overlay.EdgeOverlayGroup`

One role's edges, as a flat `[x, y, z, x, y, z, ...]` segment list.

### `property vtt.edge-overlay.EdgeOverlayGroup.color: number`

### `property vtt.edge-overlay.EdgeOverlayGroup.positions: Float32Array`

### `property vtt.edge-overlay.EdgeOverlayGroup.role: string`

### `variable vtt.edge-overlay.EDGE_FALLBACK_COLOR: 6583435`

Drawn for an edge whose role no palette entry names.

### `variable vtt.edge-overlay.EDGE_ROLE_COLORS: Readonly<Record<string, number>>`

A palette keyed by role, with a fallback for a role nothing has named yet.

### `variable vtt.edge-overlay.INTERIOR_EDGE_ROLE: "interior-edge"`

What a rim role becomes once the graph shows a face on both sides.

### `variable vtt.edge-overlay.RIM_ROLES: ReadonlySet<string>`

Roles that claim an edge is on the outside of something, and so are only
true while it has a face on one side.

A type names the role; whether the graph still bears it out is not the
type's business, because a type sees one face at a time and this is a
question about a pair. Left unchecked it produces the one drawing error
that matters here -- a rim line running through the middle of a road, kept
by nothing but the addresses its nodes were minted with, long after a
junction turned it into an interior seam.

Any type may add to this. It is a capability, not a rule about paths.

### `function vtt.edge-overlay.edgeOverlayChannel(role: string): string`

The preview channel one role's edges are drawn on.

### `function vtt.edge-overlay.edgeOverlayDescriptor(group: EdgeOverlayGroup): PreviewDescriptor`

One group as the descriptor that draws it.

### `function vtt.edge-overlay.edgeOverlayOf(topologies: readonly ConstructionRegionTopology[]): readonly EdgeOverlayGroup[]`

Groups every edge of every region in `topologies` by role.

An edge shared by two faces is drawn once: it is one edge, and drawing it
twice would only make a shared boundary look heavier than a free one, which
is the opposite of the truth worth seeing.

Sharing also settles the role. A type that named an edge as some kind of
rim named it from one face, and one face cannot see the other; if the graph
shows two, the edge is interior whatever it was called -- see
RIM_ROLES.

### `variable vtt.edit-region-tool.editRegionTool: ConstructionTool<"edit-region">`

### `variable vtt.navigate-tool.navigateTool: ConstructionTool<"navigate">`

No-op: in `navigate` mode the pointer drives camera orbit/pan
(`attachCameraNavigation`, wired independently in `tabletop-entry.tsx`),
not any construction effect. Exists so `tool-registry.ts` has an entry for
every `ConstructionToolId` and `use-construction-pointer.ts` never needs a
"no tool selected" special case.

### `interface vtt.stroke-fitting.FitOptions`

What a caller may vary about a fit. `arcs` defaults to on.

### `property vtt.stroke-fitting.FitOptions.arcs?: boolean`

When false, every span is fitted as a straight chord and no circle is ever considered.

### `interface vtt.stroke-fitting.FittedEdge`

One fitted edge of a stroke: an endpoint pair plus the contour geometry
that actually explains the samples between them -- a straight chord, or a
true circular arc through them. This is the graph's own edge vocabulary
(`ConstructionEdgeGeometry`), not a private tag a generator has to
translate, so a fitted edge is already the thing that gets declared.

### `property vtt.stroke-fitting.FittedEdge.end: ConstructionPosition`

### `property vtt.stroke-fitting.FittedEdge.geometry: ConstructionEdgeGeometry`

### `property vtt.stroke-fitting.FittedEdge.start: ConstructionPosition`

### `function vtt.stroke-fitting.fitPath(points: readonly ConstructionPosition[], tolerance: number, options: FitOptions): readonly FittedEdge[]`

Turns a raw, hand-drawn stroke (every pointer sample, wobble included)
into a short list of fitted edges: corners are found first
(Ramer-Douglas-Peucker, cornerIndices), then each run between
corners is classified (classifySegment) as a straight chord or
the true circle through it.

`tolerance` (world units) is the whole correction dial -- how far the raw
stroke must wander off *both* a straight line and its best-fit arc before
that counts as a real corner rather than hand tremor or ordinary
curvature. At `0` the contour is committed literally; the larger it gets,
the more freely a shaky stroke is straightened into clean runs. Fewer
than 2 points fits to nothing.

With `arcs` off every span is a chord, however round the samples look.
That is for a caller whose samples are no longer a hand -- points landing
on exact grid intersections, say -- where the circle through any three of
them is a real circle that nobody drew.

### `class vtt.sweep-formation.SweepFormationError`

Why a sweep could not be planned.

### `constructor vtt.sweep-formation.SweepFormationError.constructor(message?: string): SweepFormationError`

### `constructor vtt.sweep-formation.SweepFormationError.constructor(message?: string, options?: ErrorOptions): SweepFormationError`

### `interface vtt.sweep-formation.SweptArc`

The curve a stretch of a formation runs on, if it is not straight.

### `property vtt.sweep-formation.SweptArc.center: readonly [number, number]`

### `property vtt.sweep-formation.SweptArc.clockwise: boolean`

### `interface vtt.sweep-formation.TransverseProfilePoint`

One sample of a formation's transverse profile.

### `property vtt.sweep-formation.TransverseProfilePoint.elevation: number`

Height above the reference line's own height at that station.

### `property vtt.sweep-formation.TransverseProfilePoint.lateralOffset: number`

Signed world distance from the reference line, left to right.

### `function vtt.sweep-formation.stationFrame(line: readonly ConstructionPosition[], index: number, miterLimit: number, arcs: readonly (SweptArc | undefined)[]): readonly [number, number]`

The direction one station offsets its profile along.

At a corner it is the mitre: the bisector of the two neighbouring normals,
lengthened so the offset rim still meets both straight stretches, and
bounded so a hairpin gets a corner rather than a spike. Same rule the
junction mitre follows between two runs -- this one is within one run.

Where a stretch curves, its normal comes from the curve rather than from
the chord standing in for it. A station in the middle of an arc then has
the *same* normal arriving and leaving, so the mitre resolves to no corner
at all -- correctly, because there is none: a circle does not have corners,
only the polygon that approximates it does. That is what lets a curved road
be smooth instead of faceted, and it is why the rim of one can be declared
as a single arc.

### `function vtt.sweep-formation.sweepFormation(referenceLine: readonly ConstructionPosition[], profile: readonly TransverseProfilePoint[], miterLimit: number, options: { arcs?: readonly (SweptArc | undefined)[] }): ConstructionSweepPlan`

Samples a transverse profile along a reference line into connected quads.

Vertices are station-major: every consecutive `profile.length` entries form
one transverse station, which is what lets `pathPatch` read a station
address straight off a vertex index. Quads reference those shared vertices,
so neighbouring strips are connected by construction rather than by welding
coincident geometry afterwards.

### `function vtt.sweep-formation.sweptBoundary(stationCount: number, profileLength: number): readonly number[]`

The rim of a plain formation, as vertex indices.

Down the first column, across the last station, back up the last column,
and across the first station to close. True of a formation standing on its
own, which is the only thing a sweep can know -- everything that makes it
*untrue*, a junction above all, is known only where clouds and surface
types are. Exported so that side can walk it, compare against it, or
replace it outright.

### `function vtt.sweep-formation.withoutCoincidentStations(samples: readonly ConstructionPosition[]): readonly ConstructionPosition[]`

The caller's stations with any coincident repeat dropped.

Hygiene, not resampling: it only ever removes, never places. Two stations
at one spot give the frame maths no direction to read, and a pointer held
still or a grid snap folding samples onto one intersection both produce
exactly that. Where the stations go is the caller's decision, because it
depends on what the formation runs over.

### `interface vtt.tool-context.ConstructionTool`

One construction tool's behavior, generic over its own parameter shape.
Every hook is optional -- a tool implements only the lifecycle stages it
actually uses (a click-only tool has no `onPointerUp`, it commits
on `onClick`). `composition/tabletop/use-construction-pointer.ts` is the
only caller and never branches on `id` -- it just invokes whichever hook
the active tool defines.

### `property vtt.tool-context.ConstructionTool.id: Id`

### `method vtt.tool-context.ConstructionTool.defaultParams(): ToolParamsFor<Id>`

### `method vtt.tool-context.ConstructionTool.onClick(ctx: ToolContext, sample: PointerSample, params: ToolParamsFor<Id>): void`

A press+release with no intervening drag. Batch/stamp tools (room) commit here instead of `onPointerUp`.

### `method vtt.tool-context.ConstructionTool.onPointerDown(ctx: ToolContext, sample: PointerSample, params: ToolParamsFor<Id>): void`

Left-button press. Continuous tools (brushes, move-node) start their gesture here.

### `method vtt.tool-context.ConstructionTool.onPointerMove(ctx: ToolContext, gesture: ToolGesture, params: ToolParamsFor<Id>): void`

Called while a gesture is active (left button held). Brushes that paint continuously (terrain) commit here, throttled by the dispatcher.

### `method vtt.tool-context.ConstructionTool.onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: ToolParamsFor<Id>): void`

Gesture end. Tools that commit a single shape from a drag (wall, move-node's history entry) act here.

### `method vtt.tool-context.ConstructionTool.previewFor(gesture: ToolGesture, params: ToolParamsFor<Id>, ctx: ToolContext): PreviewDescriptor | undefined`

The tool's not-yet-committed ghost for the current gesture (or stationary hover, when `gesture.start === gesture.current`).

### `interface vtt.tool-context.ConstructionToolFeedback`

### `property vtt.tool-context.ConstructionToolFeedback.message: string`

### `property vtt.tool-context.ConstructionToolFeedback.surfaceRef?: string`

### `property vtt.tool-context.ConstructionToolFeedback.tone: "error" | "info" | "success"`

### `interface vtt.tool-context.PointerSample`

What the pointer resolved to at one instant -- `nodeId` present only when it hit a node handle.

### `property vtt.tool-context.PointerSample.nodeId?: string`

### `property vtt.tool-context.PointerSample.point: ConstructionPosition`

### `property vtt.tool-context.PointerSample.surfaceRef?: string`

### `interface vtt.tool-context.ToolContext`

What every tool implementation is handed to act -- the runtime to call, undo/redo history for the one tool that uses it, and a salt generator so repeated commits never collide (mirrors `tabletop-entry.tsx`'s retired `generateCountRef`).

### `property vtt.tool-context.ToolContext.history: EditHistoryStack`

### `property vtt.tool-context.ToolContext.runtime: TabletopRuntime`

### `property vtt.tool-context.ToolContext.snapToGrid: boolean`

Whether the grid magnet is on. A fact about the session, not a
behaviour: the dispatcher has already rounded every ground point to a
grid intersection by the time a tool sees it, and this only says so, so
a tool that reads meaning into where its samples came from can. What
any tool does with it is that tool's own business.

### `property vtt.tool-context.ToolContext.tableId: string`

### `method vtt.tool-context.ToolContext.nextSequence(): number`

A fresh integer each call, monotonically increasing for the runtime's lifetime -- feeds id-namespacing salts and cell/room indices, mirroring `tabletop-entry.tsx`'s retired `generateCountRef`.

### `method vtt.tool-context.ToolContext.reportFeedback(feedback: ConstructionToolFeedback | undefined): void`

### `method vtt.tool-context.ToolContext.reportSelection(info: { id: string; point: ConstructionPosition } | undefined): void`

Reports the node a tool just selected/moved, for `SettingsDrawer`'s inspector. `undefined` clears the inspector.

### `interface vtt.tool-context.ToolGesture`

A gesture in progress (or, for a stationary hover, one where `start === current`).

### `property vtt.tool-context.ToolGesture.current: PointerSample`

### `property vtt.tool-context.ToolGesture.samples: readonly PointerSample[]`

Ordered samples accumulated by the dispatcher; preview-only until pointer release.

### `property vtt.tool-context.ToolGesture.start: PointerSample`

### `function vtt.tool-context.scopedToolId(ctx: string | ToolContext, domain: string, suffix?: string | number): string`

Builds a deterministic scoped operation/prefix ID for a given tool/domain on a table.

### `variable vtt.tool-diagnostics.TOOL_DIAGNOSTIC_PREFIX: "[construction]"`

The prefix every line carries, so a console filter finds the lot.

### `function vtt.tool-diagnostics.inStage(tool: string, stage: string, facts: Readonly<Record<string, unknown>>, run: () => T): T`

Runs one stage of a commit, naming it if it throws.

Rethrows: this reports, it does not decide. Whether a failed stage costs
the stroke or only part of it is the caller's judgement, and swallowing
here would take that judgement away -- and hide the failure, which is the
opposite of the point.

### `function vtt.tool-diagnostics.reportToolFailure(tool: string, stage: string, facts: Readonly<Record<string, unknown>>, error: unknown): void`

One failed stage, on the console, with everything known about it.

### `function vtt.tool-diagnostics.reportToolWarning(tool: string, stage: string, facts: Readonly<Record<string, unknown>>): void`

Something a commit survived but should not have had to.

### `function vtt.tool-registry.toolFor(id: Id): ConstructionTool<Id>`

### `variable vtt.house-room-delete-tool.houseRoomDeleteTool: ConstructionTool<"house-room-delete">`

Two behaviors, picked by what the click actually landed on: a click
directly on a wall panel (within `findWallSurfaceAt`'s own tolerance)
removes just that one surface -- the raw `removeSurface` primitive,
nothing else touched. A click anywhere else inside an enclosed room
removes every wall bounding it, via `findEnclosingRoom` (`room-lookup.ts`)
turning the click into the room's own corner loop and
roomSurfaceKeys turning that loop into one `removeSurface` call
per wall -- no composite "delete a room" call anywhere in the stack. A
click that hits neither (open exterior space) is a no-op.

### `type vtt.interior-partition.Vec2 = PointXZ`

### `function vtt.interior-partition.cellsInPolygon(polygon: readonly PointXZ[], cellSize: number): { cells: readonly CellCoordinate[]; origin: PointXZ }`

Every integer grid cell (in a local, `origin`-relative grid) whose own center falls inside `polygon`, plus the world-space `origin` that grid is anchored to.

### `function vtt.interior-partition.idPrefixForRoom(tableId: string, bottomCycle: readonly string[]): string`

A stable id prefix for one specific enclosed room, derived from its own boundary nodes -- re-clicking the same room regenerates/diffs against its own prior attempt (e.g. after changing `seed`) instead of stacking a duplicate.

### `function vtt.interior-partition.isRedundantPerimeterWall(ctx: ToolContext, surfaceKey: readonly string[], polygon: readonly PointXZ[], tolerance: number): boolean`

True if a wall panel's own midpoint (between its two vertical posts, not
its 4 individual corners) sits within `tolerance` of the room's own true
boundary -- see `interior-wall-tool.ts`'s own `BOUNDARY_DUPLICATE_TOLERANCE_CELLS`
doc for why the region-partition algorithm's own redrawn perimeter needs
filtering back out. The midpoint, not the corners, is what actually
distinguishes a redundant duplicate (a short run that itself lies along
the boundary) from a genuine interior partition wall that legitimately
*starts and ends* on the boundary while cutting across open interior
space in between -- checking corners alone would wrongly strip every
ordinary wall-to-wall partition, since both its ends are expected to
touch the boundary.

### `variable vtt.interior-wall-tool.interiorWallTool: ConstructionTool<"interior-wall">`

One click inside an already-enclosed space (any shape, any number of
sides -- `findEnclosingRoom`'s own wall-follower algorithm, `"largest"`
preference so a click still resolves to the structure's own outermost
boundary even after it has already been subdivided once, not whatever
smaller cell the click happens to land in) rasterizes that footprint
into a `cellSize` grid and hands it to `generateRegionPartition` -- the
same region-partition Rust algorithm the retired "Pintar Casa" brush
drove one painted cell at a time, now driven by one click over an
already-drawn footprint instead. A region larger than `maxRegionCells`
auto-splits into more than one room; the same footprint reproduces the
same layout for a given `seed` (see `idPrefixForRoom`), so clicking the
same structure again after changing `seed`/`maxRegionCells` regenerates
a different layout in place rather than stacking a duplicate. The
engine's own floor/ceiling caps are NOT implemented as a front concept
yet, but are not suppressed here either (`generate_and_apply_region_partition`
has no opt-out for them -- see `apps/vtt/notes/0008-region-partition-needs-rework.md`,
item 2).

### `interface vtt.room-lookup.DerivedRoom`

### `property vtt.room-lookup.DerivedRoom.bottomCycle: readonly string[]`

### `property vtt.room-lookup.DerivedRoom.polygon: readonly PointXZ[]`

### `property vtt.room-lookup.DerivedRoom.topCycle: readonly string[]`

### `function vtt.room-lookup.findEnclosingRoom(ctx: ToolContext, click: ConstructionPosition, preference: "smallest" | "largest"): DerivedRoom | undefined`

The smallest (or, with `preference: "largest"`, the largest) closed wall
loop containing `click`, or `undefined` if no enclosed area was found
there. Algorithm: every wall is an edge between its two bottom corner
nodes (`wallSpans`). Tracing a planar graph's faces from a directed edge
by always continuing to the next neighbour (sorted by angle) immediately
after the reverse of the edge just arrived on is the standard
"wall-follower" construction for extracting bounded regions from a
straight-line graph -- but getting its clockwise/counter-clockwise
convention right by construction is easy to get backwards. Rather than
rely on that, this tries *both* directions of every wall as a starting
edge and keeps whichever closed loops actually contain the click point
(point-in-polygon) -- correct regardless of winding convention. Robust
to a T-junction on one side (the loop just gets an extra colinear vertex
there, which doesn't change area/containment).

`preference` picks which of those candidate loops to return when more
than one contains the click (nested rooms, or a room already subdivided
by interior walls): `"smallest"` (the default -- right for
`house-room-delete-tool.ts`'s "Apagar Cômodo," which must only ever
touch the one room actually clicked) picks the innermost. `"largest"` is
right for `interior-wall-tool.ts`'s "Gerar Interiores": a click inside a
room it already subdivided must still resolve to that structure's own
*outermost* boundary, not whatever smaller cell the click happens to
land in after a prior generation -- otherwise regenerating (e.g. after
changing the seed) only ever re-subdivides an already-subdivided sliver
instead of the whole footprint again.

### `variable vtt.opening-tool.openingTool: ConstructionTool<"opening">`

One click stamps an opening onto the wall panel under the pointer.

Two calls, because the wall already exists and only one of them creates
anything: the patch registers the rim and the face standing in it, then
the wall is opened along that very rim. The second walks the loop
backwards -- reversing a ring is not just flipping each use, the order
reverses too -- so the rim ends up bounding the wall on one side and the
opening on the other, used twice, joined the way any two faces are.

Where the opening lands is read off the panel itself, not off the ground:
`panel-rail.ts` flattens the panel into travel-and-height, so a curved
wall is travelled rather than spanned and a window sits on the curve
instead of cutting across it.

### `interface vtt.panel-rail.PanelRail`

One upright face, flattened: a rail to travel along and a height to rise through.

### `property vtt.panel-rail.PanelRail.baseY: number`

### `property vtt.panel-rail.PanelRail.geometry: ConstructionEdgeGeometry`

The rail's own curvature, as an edge geometry walked in the direction of
increasing travel. A straight panel reads as a line; a curved one carries
the arc, so anything stamped onto the panel bends with it.

### `property vtt.panel-rail.PanelRail.length: number`

Rail length in world units -- the full run from one side of the panel to the other.

### `property vtt.panel-rail.PanelRail.topY: number`

### `method vtt.panel-rail.PanelRail.positionAt(travel: number, y: number): ConstructionPosition`

The point `travel` along the rail, at height `y`.

### `method vtt.panel-rail.PanelRail.travelTo(point: ConstructionPosition): number`

Where `point` sits along the rail, clamped to the panel.

### `function vtt.panel-rail.panelRailOf(topology: ConstructionRegionTopology): PanelRail | undefined`

Reads a face as an upright panel: a run along the base, one side rising, a
run back along the top, one side coming down.

Found by locating exactly two upright sides rather than by counting edges,
so a panel whose base has since been subdivided -- a T-junction welding
another wall onto its side -- is still the same panel. `undefined` for
anything that is not one, which is the whole of "you cannot put an opening
here".

### `variable vtt.path-brush-tool.pathBrushTool: ConstructionTool<"path-brush">`

A free path stroke, built on the same brush every other brush uses: press,
drag, and on release the whole swept region is handed over once.

Path creation follows the same ownership split as walls: this tool only
chooses the interaction, `path-shared.ts` owns the single commit every
path goes through, `path-patch.ts` declares the graph, and Rust supplies
reusable geometry and executes the resolved overlay without ever being
told any of it is a path.

### `interface vtt.path-junction.JunctionWedges`

What closing one mouth costs and produces.

### `property vtt.path-junction.JunctionWedges.patch: ConstructionPatch`

Their replacement, either side of the arriving road.

### `property vtt.path-junction.JunctionWedges.removed: readonly ConstructionSurfaceKey[]`

Faces of the standing run that the mouth opens into, and so must go.

### `function vtt.path-junction.junctionRemovals(wedges: readonly JunctionWedges[]): readonly AtomicEditOp[]`

The edits that take the faces a mouth opens into out of the graph.

### `function vtt.path-junction.junctionWedges(tableId: string, operationId: string, arrivingCorridorId: string, mouth: PathMouth, junction: { nodeId: string; station: number }): JunctionWedges | undefined`

Rebuilds the standing run's flank around one mouth.

`undefined` when the mouth spans nothing the standing run actually has --
a graze at the very end of a run, or a corner that landed outside every
band. Closing nothing is better than declaring a face over a hole that is
not there.

### `interface vtt.path-patch.PathPatchFormation`

Application-owned graph declaration for one generic sweep result.

### `property vtt.path-patch.PathPatchFormation.boundary: readonly ConstructionOrientedEdgeUse[]`

### `property vtt.path-patch.PathPatchFormation.outline: readonly (readonly [number, number])[]`

### `property vtt.path-patch.PathPatchFormation.patch: ConstructionPatch`

### `function vtt.path-patch.pathPatch(tableId: string, corridorId: string, surfaceType: string, plan: ConstructionSweepPlan, profileLength: number, spineSlot: number, welded: ReadonlyMap<string, string>): PathPatchFormation`

Converts graph-neutral Rust geometry into the exact nodes, shared edges,
and faces the construction graph must register. This mirrors `wallPatch`:
the application defines what the product is; Rust only validates and
executes the resulting patch.

Edges are named after the table and the pair of nodes they run between,
exactly as `wallPatch` names them, because that shared name is the whole
mechanism by which two independently declared faces agree on one edge.
Namespacing them per operation instead would guarantee that no path could
ever share an edge with anything -- the interior edges of one sweep would
still be shared, since they carry the same prefix, which is precisely what
made the mistake invisible.

`refuse-when-full` is the right rule here, and only becomes meaningful now
that the name can actually collide: two faces to an edge is the true limit
for ground, so an edge with no room left means something is already there,
and the overlay refusing the patch is that fact arriving where it is
precise. A wall shares `private-when-full` for the opposite reason -- any
number of walls may legitimately stand on one column.

### `interface vtt.path-shared.PathMouth`

### `property vtt.path-shared.PathMouth.run: PathRun`

### `property vtt.path-shared.PathMouth.sides: readonly PathMouthSide[]`

### `property vtt.path-shared.PathMouth.station: number`

This run's end station, the one whose rib became the mouth.

### `property vtt.path-shared.PathMouth.through: number`

The slot of the standing rim the mouth opens through.

### `interface vtt.path-shared.PathMouthSide`

Where the run being committed opens into a run already standing.

A T, seen from the arriving side. The arriving run stops at a spine node in
the middle of the standing run, so its end rib cannot be mitred -- that rib
has road on both sides of it and cannot be rotated onto anything. What can
be said is where its two rims cross the standing rim, and those two points
are the **mouth**: the opening the arriving road makes in the flank of the
standing one.

Reported rather than acted on, because closing a mouth is not an edit to
this run at all -- it is a rebuild of the standing run's faces around the
hole, which `junctionWedges` does.

### `property vtt.path-shared.PathMouthSide.across: number`

This run's own slot, so its corner node can be named.

### `property vtt.path-shared.PathMouthSide.position: ConstructionPosition`

### `property vtt.path-shared.PathMouthSide.standingStation: number`

Roughly where the corner falls on the standing run's station scale.

For ordering the two corners along the rim, and nothing else. Anything
that has to *find* something on the standing run locates it by position
instead: a station number is not a coordinate system a later junction
leaves alone, since splitting a spine mints fractional ones.

### `interface vtt.path-shared.SpineJoin`

One arrival that welded onto a station already standing.

### `property vtt.path-shared.SpineJoin.at: number`

Index into the committed reference line where the two meet.

### `property vtt.path-shared.SpineJoin.nodeId: string`

### `property vtt.path-shared.SpineJoin.position: ConstructionPosition`

### `property vtt.path-shared.SpineJoin.run: PathRun`

### `property vtt.path-shared.SpineJoin.standingIndex: number`

Which station of the standing run that was.

### `property vtt.path-shared.SpineJoin.terminal: boolean`

Whether that station is an end of the standing run rather than a middle.

### `variable vtt.path-shared.PATH_COLOR: 12616956`

### `function vtt.path-shared.commitPathContour(ctx: ToolContext, stroke: readonly ConstructionPosition[], brushShape: BrushShape, tolerance: number, params: PathBrushParams, domain: string): void`

Commits one path run, in one transaction.

This is the only path a path is ever built by, the way
`walls/wall-shared.ts`'s `commitWallContour` is the only path a wall is
built by. A free stroke, and any straight drag or preset that comes
later, differ in nothing but the reference line they hand over: they all
resolve their formation the same way, claim their edges the same way, and
declare the same faces. Nothing here knows which tool called it.

The raw stroke is fitted before anything else, exactly as
`commitWallStroke` fits one: `tolerance` is whatever of the brush's reach
the road itself does not occupy, so the committed road always lands inside
the ghost that was drawn. At zero slack -- a brush no wider than the road
-- the stroke is committed literally.

What reaches Rust is still a polyline, because the sweep planner cannot
read an arc yet. But it is now a polyline of decisions rather than of hand
samples, and this is the single place that changes when the planner learns
contour geometry.

### `function vtt.path-shared.joinedCoveredKeys(ctx: ToolContext, outline: readonly (readonly [number, number])[], covered: readonly ConstructionCoveredRegion[], joinedCorridors: ReadonlySet<string>): ReadonlySet<string>`

Which covered faces this run *joins* rather than replaces.

Joined faces are left out of the overlay's sources, so they are not
consumed -- which is the whole point. A path replacing a path is what made
one carriageway erase another instead of the two meeting.

**Asked by identity first.** A run that welded a node onto another run's
spine has joined that run, and every face of it, full stop; whether the
new footprint happens to swallow one of its spine nodes is beside the
point. Geometry was the only question available before junctions were
built, and it stopped being safe the moment a junction started cutting the
arriving road back at the rim: the footprint no longer reaches the other
road's travel line, so the purely geometric answer became "cut" for the
very runs this one had just joined -- and consuming those bands takes the
crossed run's spine with them.

The geometric rule stays for the case identity cannot see: a footprint
laid over a run's travel line without any junction having been made.

### `function vtt.path-shared.junctionsWithStandingSpines(ctx: ToolContext, line: readonly ConstructionPosition[], ownReach: number): { inserts: readonly AtomicEditOp[]; joined: readonly PathRun[]; line: readonly ConstructionPosition[]; origins: readonly number[]; terminals: readonly SpineJoin[]; welds: ReadonlyMap<number, string> }`

Every place the run being drawn meets a spine already standing.

Two ways to meet, and only the first existed before: a stroke drawn
**across** another run crosses its spine, and a stroke that **ends on**
another run touches it without ever crossing anything. The second is the
ordinary T -- one road arriving at another -- and is far more common than
the first. Segment intersection cannot see it at all, because there is no
intersection: the drawn line simply stops.

So an endpoint is handled by projection instead. If either end of the
stroke lands within the standing run's own reach of its spine -- which is
to say, on that road -- it is moved onto the spine and joined there.

Either way the join is *made*, not found: a meeting point almost never
lands on an existing station, so the crossed spine's edge is split and the
node minted, which is `insertedColumnAt` for paths. The node is numbered on
the crossed run's own station scale, fractionally, so it stays part of that
spine's chain and in the right order.

### `function vtt.path-shared.mitreTerminalRibs(plan: ConstructionSweepPlan, profileLength: number, spineSlot: number, joins: readonly SpineJoin[], arcs: readonly (SweptArc | undefined)[]): { moves: readonly AtomicEditOp[]; vertices: readonly ConstructionPosition[]; welds: ReadonlyMap<string, string> }`

Mitres this run's end rib into the end rib of a run it met at a station.

The L, and the only junction shape that needs no junction face at all.
Both runs stop at the same station, so their cross-sections there are the
same cut of the road, and the two ribs are not two ribs: they are one,
running between the two places the outer rims meet. Each rim keeps the
direction its own spine gave it until it reaches its opposite number, and
that meeting point is the corner -- the outside of the bend meets ahead,
the inside behind, and both are the same intersection.

The join is made by *identity*, as everything else here is. The standing
run's rim node is moved onto the corner and the run being committed welds
its own rim node to it, so the rib edge between corner and spine is named
from the same pair of nodes on both sides and is therefore literally the
same edge. Two faces to an edge is exactly what `refuse-when-full` allows,
and it is how a wall shares a column.

Pairing the sides needs no case analysis either. One run's direction points
out of the joint and the other's points into it, so two rims lie on the
same hand of a traveller passing through precisely when `sideOf` gives them
opposite signs.

### `function vtt.path-shared.pathMouthsInto(plan: ConstructionSweepPlan, profileLength: number, spineSlot: number, joined: readonly PathRun[]): { mouths: readonly PathMouth[]; vertices: readonly ConstructionPosition[] }`

Cuts this run's end rib back onto the rim of the run it arrived at, and
reports the mouth that leaves.

The rim keeps the direction its own spine gave it until it reaches the
standing rim, which is the same rule the mitre follows -- an arrival is
still two L bends, one per side. What differs is only that a T bends into
the *middle* of a rim rather than into its end, so the two corners are not
nodes the standing run already has, and the faces behind them have to be
rebuilt rather than nudged.

### `function vtt.path-shared.referenceLineFrom(fitted: readonly FittedEdge[], stroke: readonly ConstructionPosition[], ridesTerrain: boolean): { arcs: readonly (SweptArc | undefined)[]; line: readonly ConstructionPosition[] }`

The reference line to sweep along: where the fit decided the road goes,
at the height the ground was actually picked at.

Arc flattening here is temporary and deliberately kept in one place so it
is obvious what to delete -- `sweepFormation` only samples a polyline, so a
true arc has no way to reach it intact. Until it accepts contour geometry,
a curve is handed over as chords close enough that the difference is
invisible, which is still a world apart from handing over the raw hand.
Now that the sweep is on this side, teaching it arcs is a local change.

### `interface vtt.geometry-2d.PointXZ`

Shared 2D geometry algorithms in the tabletop's ground plane (XZ).
On the tabletop, X and Z represent the ground plane where Y represents height.

### `property vtt.geometry-2d.PointXZ.x: number`

### `property vtt.geometry-2d.PointXZ.z: number`

### `function vtt.geometry-2d.angleFromToXZ(a: PointXZ, b: PointXZ): number`

Angle in radians from point `a` to point `b` on the XZ plane (-PI to PI).

### `function vtt.geometry-2d.distanceToPolygonBoundaryXZ(point: PointXZ, polygon: readonly PointXZ[]): number`

Minimum distance from `point` to the boundary edges of a polygon on the XZ plane.

### `function vtt.geometry-2d.distanceToSegmentXZ(point: PointXZ, a: PointXZ, b: PointXZ): number`

Shortest distance from `point` to the clamped finite segment `[a, b]` on the XZ plane.

### `function vtt.geometry-2d.pinnedToBaseline(baseline: { y: number }, point: T): T`

Pins `point`'s Y coordinate to `baseline`'s Y coordinate.

### `function vtt.geometry-2d.pointInPolygonXZ(point: PointXZ, polygon: readonly PointXZ[]): boolean`

Ray-casting algorithm to test if a 2D point lies inside a polygon on the XZ plane.

### `function vtt.geometry-2d.polygonAreaXZ(polygon: readonly PointXZ[]): number`

2D polygon area on the XZ plane via Shoelace formula.

### `function vtt.geometry-2d.projectOntoLineXZ(point: PointXZ, a: PointXZ, b: PointXZ): { perp: number; t: number; x: number; z: number }`

Projects `point` onto the infinite line through `a` and `b` on the XZ plane.
- `t`: normalized position along the segment (0 at `a`, 1 at `b`, can be <0 or >1 outside the segment).
- `perp`: perpendicular distance from `point` to the infinite line.
- `x`, `z`: coordinates of the projected point on the line.

### `function vtt.geometry-2d.segmentCrossingXZ(fromA: PointXZ, toA: PointXZ, fromB: PointXZ, toB: PointXZ): { across: number; along: number } | undefined`

Where two XZ segments cross, as the parameter along each -- `undefined` for
parallel segments, or for a crossing that falls outside either one.

Both parameters come back because a caller almost always needs the one it
did not ask about: splitting the segment that was crossed needs `across`,
while ordering the crossing among a polyline's own points needs `along`.

### `function vtt.geometry-2d.xzDistance(a: PointXZ, b: PointXZ): number`

2D Euclidean distance on the XZ plane.

### `function vtt.geometry-2d.xzDistanceSq(a: PointXZ, b: PointXZ): number`

Squared 2D Euclidean distance on the XZ plane (avoids square root for comparisons).

### `type vtt.preview-shapes.BrushOutlineShape = { kind: "circle"; radius: number } | { kind: "square"; radius: number; rotationRadians: number } | { kind: "hexagon"; radius: number; rotationRadians: number }`

### `function vtt.preview-shapes.brushStrokeOutline(samples: readonly ConstructionPosition[], shape: BrushOutlineShape, color: number, opacity: number): PreviewDescriptor`

Preview-only outline for any convex brush shape supported by the Rust contract.

### `function vtt.preview-shapes.brushSweptOutlinePolygons(samples: readonly ConstructionPosition[], radius: number): MultiPolygon`

The swept area of a circular brush stroke, as real 2D polygons (XZ).

Shared with brushSweptRegionFill on purpose: the ghost the user
saw while dragging and the footprint the engine is then asked about must
be the identical shape, or the stroke would affect ground the preview
never highlighted.

### `function vtt.preview-shapes.brushSweptRegionFill(samples: readonly ConstructionPosition[], shape: BrushOutlineShape, color: number, opacity: number): PreviewDescriptor`

### `function vtt.preview-shapes.circleOutline(center: ConstructionPosition, radius: number, color: number, opacity: number): PreviewDescriptor`

A renderer-neutral circular brush outline shared by terrain and surface transformations.

### `function vtt.preview-shapes.circularBrushStrokeOutline(samples: readonly ConstructionPosition[], radius: number, color: number, opacity: number): PreviewDescriptor`

Preview-only outline of the same circular brush swept over ordered samples.
Positions are explicit segment pairs because the render port's `segments`
primitive does not imply a line strip.

### `function vtt.preview-shapes.footprintQuad(corners: readonly [ConstructionPosition, ConstructionPosition, ConstructionPosition, ConstructionPosition], color: number, opacity: number): PreviewDescriptor`

A filled ghost over an arbitrary rectangular footprint (not necessarily axis-aligned to `center`) -- a stamped footprint's proposed outline.

### `function vtt.preview-shapes.polylineSegmentsPreview(points: readonly ConstructionPosition[], color: number, opacity: number): PreviewDescriptor | undefined`

Builds an open polyline preview connecting consecutive points.

### `function vtt.preview-shapes.quadAround(center: ConstructionPosition, halfExtent: number, color: number, opacity: number): PreviewDescriptor`

A filled square ghost centered on `center`, `halfExtent` out on both X and Z -- a hover cursor or stamp footprint.

### `function vtt.preview-shapes.segmentBetween(start: ConstructionPosition, end: ConstructionPosition, color: number, opacity: number): PreviewDescriptor`

An open line ghost from `start` to `end` -- a wall-brush's centerline while dragging.

### `function vtt.preview-shapes.segmentsPreview(positions: Float32Array<ArrayBufferLike> | readonly number[], color: number, opacity: number): PreviewDescriptor`

Builds a PreviewDescriptor for a set of straight segment pairs (e.g. wall centerline ghost).

### `interface vtt.irregular-grid.FaceMesh`

A mesh of arbitrary faces, the intermediate form before quadrangulation.

### `property vtt.irregular-grid.FaceMesh.faces: readonly Face[]`

### `property vtt.irregular-grid.FaceMesh.vertices: readonly Vec2[]`

### `interface vtt.irregular-grid.IrregularQuadGridOptions`

Options for buildIrregularQuadGrid.

### `property vtt.irregular-grid.IrregularQuadGridOptions.iterations?: number`

Smoothing passes. Around `10`-`20` settles this grid. Defaults to `12`.

### `property vtt.irregular-grid.IrregularQuadGridOptions.pinBoundary?: boolean`

Whether vertices on the outer boundary stay put. Defaults to `true`.

A single chunk relaxed without pinning rounds off, because nothing outside
pulls back. Townscaper avoids this by relaxing across overlapping
neighbourhoods instead; pinning is the honest single-chunk stand-in, and
what a chunked implementation replaces.

### `property vtt.irregular-grid.IrregularQuadGridOptions.seed: number`

### `property vtt.irregular-grid.IrregularQuadGridOptions.strength?: number`

Fraction of the way to the target each pass moves a vertex. Defaults to `0.5`.

### `property vtt.irregular-grid.IrregularQuadGridOptions.triangleSide?: number`

Edge length of one equilateral triangle. Defaults to `0.5`.

### `property vtt.irregular-grid.IrregularQuadGridOptions.trianglesPerSide: number`

Triangles along one hexagon edge. Sylves' walkthrough uses `4`.

### `interface vtt.irregular-grid.QuadMesh`

The finished all-quad grid.

### `property vtt.irregular-grid.QuadMesh.quads: readonly Quad[]`

### `property vtt.irregular-grid.QuadMesh.vertices: readonly Vec2[]`

### `interface vtt.irregular-grid.RelaxOptions`

Options for relax.

### `property vtt.irregular-grid.RelaxOptions.iterations?: number`

Smoothing passes. Around `10`-`20` settles this grid. Defaults to `12`.

### `property vtt.irregular-grid.RelaxOptions.pinBoundary?: boolean`

Whether vertices on the outer boundary stay put. Defaults to `true`.

A single chunk relaxed without pinning rounds off, because nothing outside
pulls back. Townscaper avoids this by relaxing across overlapping
neighbourhoods instead; pinning is the honest single-chunk stand-in, and
what a chunked implementation replaces.

### `property vtt.irregular-grid.RelaxOptions.strength?: number`

Fraction of the way to the target each pass moves a vertex. Defaults to `0.5`.

### `interface vtt.irregular-grid.TriangleHexOptions`

Options for buildTriangleHex.

### `property vtt.irregular-grid.TriangleHexOptions.triangleSide?: number`

Edge length of one equilateral triangle. Defaults to `0.5`.

### `property vtt.irregular-grid.TriangleHexOptions.trianglesPerSide: number`

Triangles along one hexagon edge. Sylves' walkthrough uses `4`.

### `interface vtt.irregular-grid.Vec2`

A point on the grid plane.

### `property vtt.irregular-grid.Vec2.x: number`

### `property vtt.irregular-grid.Vec2.y: number`

### `type vtt.irregular-grid.Face = readonly number[]`

A face as indices into a vertex list, in cyclic order.

### `type vtt.irregular-grid.Quad = readonly [number, number, number, number]`

A face known to have exactly four vertices.

### `type vtt.irregular-grid.Random = () => number`

Deterministic 0..1 source, so a given seed always yields the same grid.

### `function vtt.irregular-grid.boundaryVertices(mesh: QuadMesh): Set<number>`

Vertices on an edge belonging to exactly one quad.

### `function vtt.irregular-grid.buildIrregularQuadGrid(options: IrregularQuadGridOptions): QuadMesh`

Runs the five steps in order. The whole technique, start to finish.

### `function vtt.irregular-grid.buildTriangleHex(options: TriangleHexOptions): FaceMesh`

Step 1 — a hexagon filled with equilateral triangles.

A hexagon rather than a square because hexagons tile the plane while each
one stays a self-contained chunk, which is what later lets the grid extend
indefinitely with each chunk seeded from its own coordinates.

### `function vtt.irregular-grid.createRandom(seed: number): Random`

Seeded generator.

Determinism is not a convenience here. The map is replicated authoritative
state, so two hosts generating "the same" grid must produce identical
vertices, and a grid that depends on `Math.random` cannot be regenerated
from a saved seed.

### `function vtt.irregular-grid.ortho(mesh: FaceMesh): QuadMesh`

Step 3 — Conway's ortho operator: every face becomes quads.

A face of `n` sides yields `n` quads, each spanning one corner, the two
adjacent edge midpoints, and the face centre. A triangle becomes three
quads and a rhombus four, so nothing has to be done about faces that never
found a partner — the mesh is all-quad regardless of how the pairing went.

### `function vtt.irregular-grid.pairTriangles(mesh: FaceMesh, random: Random): FaceMesh`

Step 2 — randomly merge adjacent triangles into rhombi.

This is the step that makes the result irregular, and it is purely
aesthetic: whatever stays unpaired is handled by ortho anyway. The
matching is greedy over a shuffled order, which leaves some triangles
unpaired by construction — that variation is the point, so no attempt is
made to maximise the matching.

### `function vtt.irregular-grid.relax(mesh: QuadMesh, options: RelaxOptions): QuadMesh`

Step 5 — pull every cell toward a square without regularising the grid.

For each quad the best-fit square sharing its centre is found by rotating
each corner back by its own quarter-turn and averaging: in a true square all
four land on the same point, so how far they disagree is exactly how far the
cell is from square. Corners then move toward where that square puts them.

Because every vertex is pulled by all the cells it belongs to, the result is
a compromise — cells become square-ish while the irregular layout survives.
Averaging positions toward neighbours instead (ordinary Laplacian smoothing)
would shrink the mesh and say nothing about the shape of a cell.

### `function vtt.irregular-grid.weld(mesh: QuadMesh, epsilon: number): QuadMesh`

Step 4 — merge coincident vertices.

Required before relaxation rather than merely tidy: each face produced its
own copy of every shared edge midpoint, and until those are one vertex,
smoothing moves each copy independently and tears the mesh apart.

### `interface vtt.terrain-restack.RestackOutcome`

### `property vtt.terrain-restack.RestackOutcome.movedVertices: number`

Distinct nodes actually moved -- shared corners count once.

### `property vtt.terrain-restack.RestackOutcome.raisedFaces: number`

### `property vtt.terrain-restack.RestackOutcome.skipped: readonly string[]`

Why some covered faces were left alone -- a wall the brush centred on,
most commonly. Reported rather than thrown: refusing the *whole* stroke
over one such face was the earlier behaviour, and it meant painting
terrain anywhere near a wall did nothing at all, since a wall stands on
terrain and therefore always overlaps it in XZ.

### `variable vtt.terrain-restack.ELEVATION_STEP: 0.5`

How far one stroke raises the ground it covers.

### `function vtt.terrain-restack.facesToRaise(resolved: readonly ResolvedCoverage[]): readonly ConstructionCoveredRegion[]`

The faces a terrain stroke should raise: those the brush covers whole.
A face the brush merely clips is left alone -- raising it would drag
ground the user never painted over.

### `function vtt.terrain-restack.restackTerrain(ctx: ToolContext, paintedType: string, covered: readonly ConstructionCoveredRegion[], causeId: string): RestackOutcome`

Raises every covered face the type table allows.

A face the table forbids -- a wall the brush centred on -- is left alone
and reported in `skipped`, not thrown. The stroke still does everything
else it was asked to.

### `variable vtt.terrain-sculpt-tool.terrainSculptTool: ConstructionTool<"terrain-sculpt">`

Terrain-sculpt's own effect: the brush hands over the whole gesture, once, on release -- this resolves every quad any sample along the path touched into one mesh and submits it in a single batch, mirroring `terrain-brush`'s own (deleted) commit-once contract for its cell-by-cell Rust calls.

### `function vtt.tower-geometry.circleContour(center: ConstructionPosition, radius: number): readonly FittedEdge[]`

A closed circular wall run: CIRCLE_SEGMENTS corners around the
circle and one true circular arc between each pair, every arc sharing the
one real center.

This is the whole of the tower preset. It produces contour edges in the
same vocabulary a free stroke is fitted into, so the preset commits
through exactly the same wall builder with no geometry, no ids and no
generation of its own -- a preset decides where the corners go and how
each step curves, and stops there.

Corners run counter-clockwise (increasing angle), and each arc sweeps the
short way between consecutive corners, which is the quarter turn that
actually lies on the requested circle.

### `function vtt.tower-geometry.previewOutline(center: ConstructionPosition, radius: number, segments: number): Float32Array`

A closed polygon outline approximating the tower's own footprint, for the
ghost preview only -- never fed to the engine. `segments` line-segment
pairs (`pointAt(step)`, `pointAt(step + 1)`), the last one closing exactly
back onto the first point since `pointAt(segments)`'s angle (`2*PI`)
lands on the same position as `pointAt(0)`'s (`0`).

### `variable vtt.tower-stamp-tool.towerStampTool: ConstructionTool<"tower-stamp">`

One click stamps a closed circular wall run at a known radius (one of
`TOWER_RADIUS_PRESETS`, never a freehand drag).

A tower is not its own kind of structure and has no code of its own: it is
the ordinary wall type, committed through the ordinary wall builder, from
a contour a preset happened to compute instead of a hand drawing it. That
is the entire difference -- so a tower welds onto a drawn wall, gets
edited by the same handles, and is subject to the same rules, for free.

### `variable vtt.wall-brush-tool.wallBrushTool: ConstructionTool<"wall-brush">`

A free wall stroke, built on the same brush every other brush uses: press,
drag, and on release the whole swept region is handed over once. Nothing
is committed mid-drag and nothing is resent per tick -- what the pointer
traced is corrected into contour edges and declared as one patch.

The brush footprint is the correction dial rather than a footprint to
paint. Its reach is fed straight to the fitter as tolerance: at radius 0
the drawn contour is committed literally, and the wider the brush the more
freely a shaky stroke is straightened into clean runs and true arcs. That
is why a wall brush is meant to be a small circle -- it is not covering
ground, it is saying how literally to take the hand.

Everything a wall is lives in TypeScript from here down (`wall-shared.ts`,
`wall-patch.ts`): corners resolve to columns, columns share edges, and the
engine is handed nodes, edges and faces without ever being told they are a
wall.

### `variable vtt.wall-line-tool.wallLineTool: ConstructionTool<"wall-line">`

A straight wall drawn by press-drag-release. Wherever the drag wanders,
only the press point and the release point reach the graph: one exact
straight contour edge between them. That correction is this tool's entire
reason to exist, distinct from the free brush, whose own correction is a
fit with a tolerance rather than a guarantee.

Beyond that it is the same wall as every other: the same contour commit,
the same column resolution, the same shared edges. A run drawn here welds
onto a free stroke, or onto another straight run, by resolving its corner
onto that run's own column -- by connection, not by landing on the same
coordinate.

### `interface vtt.wall-patch.WallColumn`

One extremity of a wall run: the two nodes of that extremity's own
vertical edge, bottom and top.

A wall is four vertices and four edges, and the four vertices are the four
extremities -- two columns, this one and the next. Whatever else ends up
along an edge later (a T-junction insert splitting it into a series of
micro-edges) changes none of that: what separates one wall from another is
a division running side to side, never a vertex sitting on the way.

The height of the wall is the length of this column's own vertical edge,
which is the distance between `bottom` and `top`. There is no stored
height anywhere -- the graph holds the two nodes and their connection, and
the distance is a consequence.

### `property vtt.wall-patch.WallColumn.bottom: ConstructionPosition`

### `property vtt.wall-patch.WallColumn.bottomNodeId: string`

### `property vtt.wall-patch.WallColumn.top: ConstructionPosition`

### `property vtt.wall-patch.WallColumn.topNodeId: string`

### `interface vtt.wall-patch.WallContour`

A whole wall run, ready to be declared: the columns it passes through, and
the contour geometry of each step between them, in the direction the run
travels.

`closed` makes the last column step back onto the first -- which is all a
tower or a house outline is. There is no separate closed-shape builder and
no preset-specific geometry: a preset only decides where the columns are
and what each step curves like.

### `property vtt.wall-patch.WallContour.closed: boolean`

### `property vtt.wall-patch.WallContour.columns: readonly WallColumn[]`

### `property vtt.wall-patch.WallContour.geometries: readonly ConstructionEdgeGeometry[]`

Geometry of the step from column `i` to column `i + 1`, in that direction.

### `function vtt.wall-patch.wallPatch(tableId: string, contour: WallContour, surfaceType: string, sharing: EdgeSharing, physical: boolean): ConstructionPatch`

Turns a wall run into one patch: every node it introduces, the shared
edges between them, and one upright panel per step.

Each panel is declared in the order base, far column, top, near column --
the two columns being the vertical edges. That ordering is not decoration:
it is what makes a curved panel readable as a ruled strip downstream
instead of a ring some projection has to guess a plane for.

Everything about what a wall *is* lives here, in TypeScript. The engine is
told which nodes exist, which edges connect them, and which faces sit over
those edges -- it is never told that any of it is a wall.

### `variable vtt.wall-shared.WALL_COLOR: Record<WallParams["wallType"], number>`

### `variable vtt.wall-shared.WALL_HEIGHT: 3`

Default length of a panel's own vertical edge, for callers with no height parameter of their own.

### `function vtt.wall-shared.commitWallContour(ctx: ToolContext, fitted: readonly FittedEdge[], params: WallParams, domain: string, correction: number): void`

Commits a fitted run of contour edges as walls, in one transaction.

This is the only path a wall is ever built by. A free stroke, a straight
drag and a tower preset differ in nothing but the contour they hand over:
they all resolve their corners the same way, claim their edges the same
way, and declare the same faces. Nothing here knows which tool called it,
and nothing downstream is told any of it is a wall.

### `function vtt.wall-shared.commitWallStroke(ctx: ToolContext, samples: readonly ConstructionPosition[], tolerance: number, params: WallParams, domain: string): void`

Fits a raw stroke and commits it, the free-brush entry point --
`tolerance` is the brush's own radius, so a radius of 0 commits the drawn
contour literally and a wider brush corrects a shakier stroke into clean
straight runs and true arcs.

With the grid magnet on, the stroke is already a sequence of exact grid
intersections: the hand is no longer what the samples describe, so there
is no hand tremor to read curvature out of, and the circle through any
three staircase points is a real circle that was never drawn. Arcs are
off in that mode for that reason -- snapped means deliberate, and what
was placed deliberately is what gets built.

### `function vtt.wall-shared.findWallSurfaceAt(ctx: ToolContext, point: ConstructionPosition): ConstructionSurfaceKey | undefined`

The wall panel whose own centerline `point` lands closest to (XZ only,
within WALL_PICK_TOLERANCE), or `undefined` if none qualify --
`house-room-delete-tool.ts`'s single-surface delete: a click that lands
directly on a wall removes just that one panel, distinct from a click on
open floor inside a room, which removes every wall bounding it instead.

### `interface vtt.wall-spans.WallSpan`

### `property vtt.wall-spans.WallSpan.a: ConstructionPosition`

The bottom corner under bottomA/topA.

### `property vtt.wall-spans.WallSpan.b: ConstructionPosition`

### `property vtt.wall-spans.WallSpan.bottomA: string`

### `property vtt.wall-spans.WallSpan.bottomB: string`

### `property vtt.wall-spans.WallSpan.bottomEdgeIds: readonly string[]`

Boundary edges running along the baseline -- what a T-junction subdivides.

### `property vtt.wall-spans.WallSpan.physical: boolean`

### `property vtt.wall-spans.WallSpan.surfaceKey: ConstructionSurfaceKey`

### `property vtt.wall-spans.WallSpan.surfaceType: string`

### `property vtt.wall-spans.WallSpan.topA: string`

### `property vtt.wall-spans.WallSpan.topB: string`

### `property vtt.wall-spans.WallSpan.topEdgeIds: readonly string[]`

Boundary edges running along the top, the paired half of the same subdivision.

### `property vtt.wall-spans.WallSpan.topY: number`

### `function vtt.wall-spans.wallSpans(ctx: ToolContext): readonly WallSpan[]`

### `interface vtt.use-construction-pointer.ConstructionPointerHandlers`

### `property vtt.use-construction-pointer.ConstructionPointerHandlers.onClick: (event: MouseEvent<HTMLDivElement>) => void`

### `property vtt.use-construction-pointer.ConstructionPointerHandlers.onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void`

### `property vtt.use-construction-pointer.ConstructionPointerHandlers.onPointerDown: (event: PointerEvent<HTMLDivElement>) => void`

### `property vtt.use-construction-pointer.ConstructionPointerHandlers.onPointerMove: (event: PointerEvent<HTMLDivElement>) => void`

### `property vtt.use-construction-pointer.ConstructionPointerHandlers.onPointerUp: (event: PointerEvent<HTMLDivElement>) => void`

### `interface vtt.use-construction-pointer.UseConstructionPointerOptions`

### `property vtt.use-construction-pointer.UseConstructionPointerOptions.activeTool: ConstructionToolId`

### `property vtt.use-construction-pointer.UseConstructionPointerOptions.history: EditHistoryStack`

### `property vtt.use-construction-pointer.UseConstructionPointerOptions.onFeedbackChange: (feedback: ConstructionToolFeedback | undefined) => void`

### `property vtt.use-construction-pointer.UseConstructionPointerOptions.onSelectionChange: (info: SelectedNodeInfo | undefined) => void`

### `property vtt.use-construction-pointer.UseConstructionPointerOptions.runtime: TabletopRuntime`

### `property vtt.use-construction-pointer.UseConstructionPointerOptions.snapToGrid: boolean`

When true, a resolved point (other than an existing node handle -- those stay precise) snaps to the nearest grid intersection before any tool sees it, so a new terrain cell/wall/room lands centered on the grid instead of wherever the pointer happened to be.

### `property vtt.use-construction-pointer.UseConstructionPointerOptions.tableId: string`

### `property vtt.use-construction-pointer.UseConstructionPointerOptions.toolParams: ToolParamsByTool`

### `property vtt.use-construction-pointer.UseConstructionPointerOptions.viewId: string | undefined`

### `function vtt.use-construction-pointer.useConstructionPointer(options: UseConstructionPointerOptions): ConstructionPointerHandlers`

The generic pointer/effect dispatcher: owns the pointer gesture lifecycle
(down/move/up/cancel/click) and the active tool's preview, but never
branches on *which* tool is active -- it only resolves what the pointer
hit, looks the active tool up in `tools/tool-registry.ts`, and calls
whichever lifecycle hook that tool defines. Per-tool behavior (what a
stroke or a click actually generates) lives entirely in `tools/*.ts`.

### `interface vtt.map-projection.MapProjection`

### `property vtt.map-projection.MapProjection.byId: ReadonlyMap<string, SurfaceProjection>`

### `property vtt.map-projection.MapProjection.nodePositions: ReadonlyMap<string, NodePositionEntry>`

Live node positions, keyed by NodeRef -- what edit-mode picking
and drag-to-move need and `SurfaceProjection` alone cannot give (its
`orderedNodeRefs` are bare ids, not positions). Populated from
`ConstructionSessionPort.getNodePositions()` at map load, then kept
current by `node-moved` deltas.

### `property vtt.map-projection.MapProjection.revision: number`

### `interface vtt.map-projection.NodePosition`

### `property vtt.map-projection.NodePosition.x: number`

### `property vtt.map-projection.NodePosition.y: number`

### `property vtt.map-projection.NodePosition.z: number`

### `interface vtt.map-projection.NodePositionEntry`

### `property vtt.map-projection.NodePositionEntry.nodeRef: string`

### `property vtt.map-projection.NodePositionEntry.position: NodePosition`

### `property vtt.map-projection.NodePositionEntry.revision: number`

### `interface vtt.map-projection.SurfaceProjection`

### `property vtt.map-projection.SurfaceProjection.orderedNodeRefs: readonly string[]`

### `property vtt.map-projection.SurfaceProjection.physical: boolean`

### `property vtt.map-projection.SurfaceProjection.revision: number`

### `property vtt.map-projection.SurfaceProjection.surfaceRef: string`

### `property vtt.map-projection.SurfaceProjection.type: string`

### `type vtt.map-projection.MapId = string`

### `type vtt.map-projection.MapProjectionDelta = { surface: SurfaceProjection; type: "surface-upserted" } | { revision: number; surfaceRef: SurfaceRef; type: "surface-removed" } | { nodeRef: NodeRef; position: NodePosition; revision: number; type: "node-moved" } | { nodeRef: NodeRef; type: "node-removed" }`

### `type vtt.map-projection.NodeRef = string`

### `type vtt.map-projection.SurfaceRef = string`

### `function vtt.map-projection.applyMapProjectionDelta(current: MapProjection, delta: MapProjectionDelta): MapProjection`

### `function vtt.map-projection.createMapProjection(surfaces: readonly SurfaceProjection[], nodePositions: readonly NodePositionEntry[]): MapProjection`

### `function vtt.map-projection.createSurfaceProjection(input: SurfaceProjection): SurfaceProjection`

### `function vtt.map-projection.surfaceRefFromNodeSet(nodeRefs: readonly string[]): string`

Derives a stable SurfaceRef from a surface's canonical node-set
identity. Sorted + joined so two callers presenting the same node set in
a different order agree on the same ref -- mirroring
`grafting-graph-core::SurfaceKey`'s own order-independence. Per
`docs/architecture/vtt-product-model.md` §4.1, a `SurfaceRef` is "derived
by an adapter from canonical node-set identity"; this is that pure
derivation, called from the adapter layer.

### `interface vtt.surface-covering.SurfaceCovering`

A surface's resolved visual fill.

### `property vtt.surface-covering.SurfaceCovering.key: string`

Batching identity: two surfaces sharing this key may merge into one render
buffer, and two that do not share it must not.

Spatial bucketing alone is not enough -- a bucket holding a wall and a
terrain cell would otherwise merge them and take one of their
classifications for both.

### `property vtt.surface-covering.SurfaceCovering.kind: string`

Which covering kind fills the surface.

### `property vtt.surface-covering.SurfaceCovering.surface: SurfaceFill | undefined`

How the surface mesh itself is drawn, or `undefined` when this covering
draws no mesh.

Absence is the representation on purpose: a covering that draws nothing
emits no chunk, so "invisible" costs no buffer, no draw call and no special
case downstream -- the render port never learns that `none` exists.

### `interface vtt.surface-covering.SurfaceFill`

How a covering fills the surface mesh, or `undefined` when it draws none.

### `property vtt.surface-covering.SurfaceFill.color: number`

Flat classification color, until a real material/asset pipeline exists (`E4.2`).

### `type vtt.surface-covering.CoveringKind = string`

Which covering fills a surface.

Deliberately an open string rather than a union: `DEC-052`/`ADR-0014` forbid
baking product concepts into infrastructure, and `ADR-0022` already had to
correct one closed enum (`BoundaryKind`). New kinds -- an unfilled opening, a
repeated unit asset, a decal -- must cost a registration, never an edit to a
type every consumer recompiles against.

### `variable vtt.surface-covering.NONE_COVERING: SurfaceCovering`

The covering that draws nothing. One value, since it carries no parameters.

### `variable vtt.surface-covering.NONE_COVERING_KIND: CoveringKind`

A covering that draws nothing at all.

The surface still exists: it keeps its identity, its `physical` fact, and its
pick proxy, so it stays selectable, draggable and undoable. It simply is not
drawn -- which is what an open doorway, a barred gate or a pierced window
needs, since anything drawn in the opening would defeat the point of the
opening. See `ADR-0022`'s asset layer and the transformation plan's phase 3.

### `variable vtt.surface-covering.PAINTED_COVERING_KIND: CoveringKind`

The only kind this phase ships: the surface mesh is drawn, flat-shaded.

Named rather than assumed because it is about to stop being the only
possibility. A covering that draws nothing (`"none"`, for a barred gate or an
open doorway) and one that places repeated unit geometry are the next two,
and neither is a special case of this one.

### `function vtt.surface-covering.colorForSurfaceType(surfaceType: string, physical: boolean): number`

Flat classification color for a surface type.

A placeholder, and deliberately so: it exists only to make generated geometry
visually distinguishable while nothing else renders it. Moved here from the
render adapter unchanged -- same inputs, same colors -- because deciding what
a product's surfaces look like is product policy, not renderer translation.

### `function vtt.surface-covering.paintedCovering(color: number): SurfaceCovering`

A painted covering of one flat color.

### `function vtt.surface-covering.resolveSurfaceCovering(surfaceType: string, physical: boolean): SurfaceCovering`

Resolves the covering for one surface.

The single decision point this module exists for.

Every surface still resolves to a painted covering, which keeps behaviour
identical to before this layer existed. NONE_COVERING is reachable
and fully wired -- a surface resolving to it renders nothing while staying
pickable -- but nothing selects it yet, because nothing authors the surfaces
that need it: the construction tools go through `straight_cycle_region`,
which produces a single outer loop and no holes, so no opening exists to
leave unfilled. The policy lands with hole authoring; the mechanism is ready
for it now.

### `interface vtt.token-projection.TokenAppearance`

### `property vtt.token-projection.TokenAppearance.color: number`

### `property vtt.token-projection.TokenAppearance.label: string`

### `property vtt.token-projection.TokenAppearance.size: number`

### `interface vtt.token-projection.TokenCollectionProjection`

### `property vtt.token-projection.TokenCollectionProjection.byId: ReadonlyMap<string, TokenProjection>`

### `property vtt.token-projection.TokenCollectionProjection.revision: number`

### `interface vtt.token-projection.TokenPosition`

### `property vtt.token-projection.TokenPosition.x: number`

### `property vtt.token-projection.TokenPosition.y: number`

### `property vtt.token-projection.TokenPosition.z: number`

### `interface vtt.token-projection.TokenProjection`

### `property vtt.token-projection.TokenProjection.appearance: TokenAppearance`

### `property vtt.token-projection.TokenProjection.id: string`

### `property vtt.token-projection.TokenProjection.position: TokenPosition`

### `property vtt.token-projection.TokenProjection.revision: number`

### `property vtt.token-projection.TokenProjection.sceneId: string`

### `property vtt.token-projection.TokenProjection.subjectRef?: string`

### `type vtt.token-projection.SceneId = string`

### `type vtt.token-projection.SubjectRef = string`

### `type vtt.token-projection.TokenId = string`

### `type vtt.token-projection.TokenProjectionDelta = { token: TokenProjection; type: "token-upserted" } | { revision: number; tokenId: TokenId; type: "token-removed" }`

### `function vtt.token-projection.applyTokenProjectionDelta(current: TokenCollectionProjection, delta: TokenProjectionDelta): TokenCollectionProjection`

### `function vtt.token-projection.createTokenCollection(tokens: readonly TokenProjection[]): TokenCollectionProjection`

### `function vtt.token-projection.createTokenProjection(input: TokenProjection): TokenProjection`

### `interface vtt.atomic-edit.EditGesture`

One user gesture, before any policy has looked at it.

### `property vtt.atomic-edit.EditGesture.delta: ConstructionPosition`

World-space movement the pointer accumulated over the drag.

### `property vtt.atomic-edit.EditGesture.surfaceKey: ConstructionSurfaceKey`

### `property vtt.atomic-edit.EditGesture.target: EditTarget`

### `type vtt.atomic-edit.AtomicEditOp = { kind: "move-vertex"; nodeId: ConstructionNodeId; position: ConstructionPosition } | { edgeId: ConstructionEdgeId; firstEdgeId: ConstructionEdgeId; kind: "insert-vertex"; nodeId: ConstructionNodeId; position: ConstructionPosition; secondEdgeId: ConstructionEdgeId } | { kind: "remove-vertex"; nodeId: ConstructionNodeId; weldedEdgeId: ConstructionEdgeId } | { edgeId: ConstructionEdgeId; geometry: ConstructionEdgeGeometry; kind: "retype-edge" } | { delta: ConstructionPosition; edgeId: ConstructionEdgeId; kind: "move-edge" } | { delta: ConstructionPosition; kind: "move-region"; surfaceKey: ConstructionSurfaceKey } | { kind: "delete-region"; surfaceKey: ConstructionSurfaceKey } | { kind: "duplicate-region"; offset: ConstructionPosition; physical: boolean; suffix: string; surfaceKey: ConstructionSurfaceKey; surfaceType: string }`

The atomic edit vocabulary, as data. Every entry maps one-to-one onto a
`ConstructionSessionPort` primitive; nothing here knows what a wall or a
terrain patch is.

Expressing an op as a value rather than a direct port call is what lets a
structure type's policy *substitute* one op for another, and lets a
cascade be a plain list of further ops applied in the same transaction --
see `docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.

### `type vtt.atomic-edit.AtomicEditOpKind = AtomicEditOp["kind"]`

### `type vtt.atomic-edit.EditAxis = "x" | "y" | "z"`

Zeroes out every axis a role does not allow -- the "constraint on the op's
own parameter" half of a role policy, enforced here on the TS side
*before* the engine call, never inside Rust.

### `type vtt.atomic-edit.EditTarget = { kind: "vertex"; nodeId: ConstructionNodeId } | { edgeId: ConstructionEdgeId; kind: "edge" } | { kind: "region" }`

Which part of a region the user grabbed.

### `variable vtt.atomic-edit.ALL_AXES: readonly EditAxis[]`

### `variable vtt.atomic-edit.HEIGHT_AXIS: readonly EditAxis[]`

### `variable vtt.atomic-edit.HORIZONTAL_AXES: readonly EditAxis[]`

### `variable vtt.atomic-edit.ZERO_DELTA: ConstructionPosition`

### `function vtt.atomic-edit.addPosition(a: ConstructionPosition, b: ConstructionPosition): ConstructionPosition`

### `function vtt.atomic-edit.constrainToAxes(delta: ConstructionPosition, axes: readonly EditAxis[]): ConstructionPosition`

### `function vtt.atomic-edit.scalePosition(position: ConstructionPosition, factor: number): ConstructionPosition`

### `function vtt.brush-shape-params.resolveBrushShape(params: BrushShapeParams): BrushShape`

Converts editable shape parameters into the immutable semantic brush contract.

### `interface vtt.construction-cloud.CloudSource`

The slice of the runtime a cloud resolution needs, named here so
`features/` stays free of the composition root and a test can supply two
functions instead of a runtime.

### `method vtt.construction-cloud.CloudSource.cloudFor(request: { seed: ConstructionSurfaceKey; surfaceType: string }): { surfaceKeys: readonly ConstructionSurfaceKey[] }`

### `method vtt.construction-cloud.CloudSource.getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined`

### `interface vtt.construction-cloud.CloudTopology`

A cloud together with the live boundary of every member.

### `property vtt.construction-cloud.CloudTopology.cloud: ConstructionCloud`

### `property vtt.construction-cloud.CloudTopology.members: readonly ConstructionRegionTopology[]`

Every member's boundary, the seed included.

### `property vtt.construction-cloud.CloudTopology.seed: ConstructionRegionTopology`

The member the gesture landed on. Role resolution reads this one and
only this one: a corner is a corner of the face it belongs to, and
asking the whole cloud what a single grabbed node means would have no
answer.

### `interface vtt.construction-cloud.ConstructionCloud`

The cloud: the connected component of same-`type` surfaces reachable from
one of them by shared graph nodes.

`ADR-0022` puts this fourth in the layering (graph -> mesh -> surface ->
**cloud** -> asset) and is explicit about what it is for: "this is the
unit generation and editing operate on -- never an individual `Surface` in
isolation," and "editing dispatches by cloud, not by individual surface."
A cloud of one surface is not a special case; it is a component of size
one, same code path as one of a thousand.

Derived, never stored, exactly like a mesh. There is no cloud object in
the graph to keep in sync: two separately drawn walls become one cloud the
moment a stroke welds a node they both reference, because the *next*
query walks across it. Nothing performs a merge, and nothing can forget
to.

The type is what the cloud carries, and the reason the whole layer exists:
a surface holds the `type` string, but the cloud is the thing that string
names as one construction. Which is why a type's editing behaviour is
declared against the cloud (`structure-types/`), and why a tool preset --
"a tower," "a house" -- can only choose parameters and a generator, never
hold behaviour of its own.

### `property vtt.construction-cloud.ConstructionCloud.members: readonly ConstructionSurfaceKey[]`

Every member, the seed included, in the engine's own stable order.

### `property vtt.construction-cloud.ConstructionCloud.seed: ConstructionSurfaceKey`

The member the gesture actually landed on.

### `property vtt.construction-cloud.ConstructionCloud.surfaceType: string`

The one type every member shares; a cloud never spans two.

### `function vtt.construction-cloud.cloudNodes(topology: CloudTopology): readonly { id: string; position: { x: number; y: number; z: number } }[]`

Every distinct boundary node across a cloud, deduplicated by id -- members share nodes wherever they are welded.

### `function vtt.construction-cloud.refreshCloudTopology(source: CloudSource, cloud: ConstructionCloud): CloudTopology | undefined`

Re-reads every member's boundary against the live session, keeping the
membership already resolved.

A drag re-plans on every tick and must see current positions, but must not
re-resolve membership mid-gesture: a move that welds onto a neighbour
would silently enlarge the cloud under the pointer and start dragging
geometry the gesture never grabbed. Membership is settled once, on press.

### `function vtt.construction-cloud.resolveCloud(source: CloudSource, seed: ConstructionSurfaceKey): ConstructionCloud | undefined`

The cloud the surface at `seed` belongs to.

The engine answers which surfaces are connected and share the type; it is
never asked what the type *means*. `undefined` only when the key is stale
-- a live surface always belongs to at least its own cloud, so an empty
membership is treated as the seed alone rather than as an error, which is
what keeps a component of size one on the same path as any other.

### `function vtt.construction-cloud.resolveCloudTopology(source: CloudSource, seed: ConstructionSurfaceKey): CloudTopology | undefined`

resolveCloud plus every member's live boundary, which is what a
gesture is actually planned against.

A member whose topology has since gone stale is dropped rather than
failing the whole resolution: the cloud query and the topology reads are
separate calls, and a surface that disappeared between them is exactly the
case where continuing with what is still there is right.

### `interface vtt.edit-history.EditHistoryStack`

### `method vtt.edit-history.EditHistoryStack.getState(): EditHistoryState`

### `method vtt.edit-history.EditHistoryStack.record(entry: ConstructionHistoryEntry): void`

Records a completed move. Clears any redo history, per standard undo-stack semantics.

### `method vtt.edit-history.EditHistoryStack.redo(): ConstructionHistoryEntry | undefined`

Pops the most recently undone entry and returns it for the caller to apply its `redo` ops, or `undefined` if there is nothing to redo.

### `method vtt.edit-history.EditHistoryStack.undo(): ConstructionHistoryEntry | undefined`

Pops the most recent entry and returns it for the caller to apply its `undo` ops, or `undefined` if there is nothing to undo.

### `interface vtt.edit-history.EditHistoryState`

### `property vtt.edit-history.EditHistoryState.canRedo: boolean`

### `property vtt.edit-history.EditHistoryState.canUndo: boolean`

### `interface vtt.edit-history.PathBrushHistoryEntry`

One confirmed path-brush stroke; the construction session owns its before/after checkpoints.

### `property vtt.edit-history.PathBrushHistoryEntry.kind: "path-brush"`

### `property vtt.edit-history.PathBrushHistoryEntry.operationId: string`

### `interface vtt.edit-history.RegionEditHistoryEntry`

One completed edit gesture, as the two op sequences that reverse and
replay it. Undo applies `undo`; redo applies `redo` -- the caller (the
pointer-capture UI layer) owns actually issuing them through
`TabletopRuntime.applyRegionEdit`, this stack only tracks which one is
next.

Op sequences rather than a single node's before/after position, because a
role's cascade legitimately moves nodes the gesture never named: a wall's
bottom corner carries its paired top corner by the same delta, and an undo
that only put the grabbed corner back would leave the panel sheared. See
`docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.

### `property vtt.edit-history.RegionEditHistoryEntry.kind: "region-edit"`

### `property vtt.edit-history.RegionEditHistoryEntry.redo: readonly AtomicEditOp[]`

### `property vtt.edit-history.RegionEditHistoryEntry.undo: readonly AtomicEditOp[]`

### `type vtt.edit-history.ConstructionHistoryEntry = RegionEditHistoryEntry | PathBrushHistoryEntry`

### `function vtt.edit-history.createEditHistoryStack(): EditHistoryStack`

### `interface vtt.edit-orchestrator.EditOpSink`

The slice of `ConstructionSessionPort` an edit plan actually needs.

### `method vtt.edit-orchestrator.EditOpSink.deleteRegion(surfaceKey: readonly string[]): RegionEditOutcome`

### `method vtt.edit-orchestrator.EditOpSink.duplicateRegion(request: { offset: { x: number; y: number; z: number }; physical: boolean; suffix: string; surfaceKey: readonly string[]; surfaceType: string }): RegionEditOutcome`

### `method vtt.edit-orchestrator.EditOpSink.insertVertex(request: { edgeId: string; firstEdgeId: string; nodeId: string; position: { x: number; y: number; z: number }; secondEdgeId: string }): RegionEditOutcome`

### `method vtt.edit-orchestrator.EditOpSink.moveEdge(edgeId: string, delta: { x: number; y: number; z: number }): RegionEditOutcome`

### `method vtt.edit-orchestrator.EditOpSink.moveRegion(surfaceKey: readonly string[], delta: { x: number; y: number; z: number }): RegionEditOutcome`

### `method vtt.edit-orchestrator.EditOpSink.moveVertex(nodeId: string, position: { x: number; y: number; z: number }): RegionEditOutcome`

### `method vtt.edit-orchestrator.EditOpSink.removeVertex(nodeId: string, weldedEdgeId: string): RegionEditOutcome`

### `method vtt.edit-orchestrator.EditOpSink.retypeEdge(edgeId: string, geometry: { kind: "line" } | { center: readonly [number, number]; clockwise: boolean; kind: "arc" }): RegionEditOutcome`

### `type vtt.edit-orchestrator.EditPlan = { kind: "apply"; ops: readonly AtomicEditOp[]; role: EditRole; scope: EditScope; surfaceCount: number } | { kind: "deny"; reason: string; role: EditRole } | { kind: "regenerate"; reason: string; role: EditRole }`

Turns one user gesture into the exact sequence of atomic ops to issue.

This is the TS half of the ownership split the design doc settles: Rust
owns the primitives and knows nothing of type, role, or policy; this layer
resolves which role was grabbed, constrains the op's own parameter, and
assembles the primary op plus whatever cascade the role declares -- all
before a single engine call is made.

It plans against a **cloud**, not a face (`ADR-0022`: "editing dispatches
by cloud, not by individual surface"). The face the pointer landed on is
still what says *what was grabbed* -- a corner is a corner of a panel --
but how far the resulting op reaches is the role's own declaration, and a
cloud-scoped role fans out over every member.

Pure on purpose. It reads topology and returns a plan; nothing here
touches the session. applyEditPlan performs it.

### `variable vtt.edit-orchestrator.EMPTY_OUTCOME: RegionEditOutcome`

### `function vtt.edit-orchestrator.applyEditOp(sink: EditOpSink, op: AtomicEditOp): RegionEditOutcome`

Issues one atomic op against the session.

### `function vtt.edit-orchestrator.applyEditPlan(sink: EditOpSink, plan: EditPlan): RegionEditOutcome`

Applies every op in a plan in order, as one transaction, and reports the
merged outcome. A non-`"apply"` plan is a no-op here by design -- deciding
what a denial or an escalation means to the user is the caller's, not
this layer's.

### `function vtt.edit-orchestrator.mergeOutcomes(left: RegionEditOutcome, right: RegionEditOutcome): RegionEditOutcome`

Folds two outcomes, so a whole transaction reports one combined result.

### `function vtt.edit-orchestrator.planEdit(cloud: CloudTopology, gesture: EditGesture): EditPlan`

Resolves `gesture` against the structure type's own role table. The
returned ops are already constrained -- a height-only role's horizontal
movement is gone by this point, never clamped later or inside Rust.

### `interface vtt.path-cloud.PathRun`

### `property vtt.path-cloud.PathRun.bands: readonly PathRunBand[]`

Every face of the run, each carrying the stretch it covers.

The stretch is what a junction reads: closing a T means taking out the
faces the arriving road opens into and declaring what replaces them, and
"which faces" is a question about stations and sides, not about keys.

### `property vtt.path-cloud.PathRun.contours: readonly PathRunChain[]`

One per side, outermost slot first.

### `property vtt.path-cloud.PathRun.corridorId: string`

### `property vtt.path-cloud.PathRun.junctionStations: readonly number[]`

Stations whose spine node belongs to a **different** corridor -- this run
welded onto one already standing there. A junction, seen from this side.

### `property vtt.path-cloud.PathRun.ribs: readonly PathRunRib[]`

### `property vtt.path-cloud.PathRun.spine: PathRunChain | undefined`

### `property vtt.path-cloud.PathRun.subtype: PathKind | undefined`

### `interface vtt.path-cloud.PathRunBand`

One face of a run, with the stretch of the run it covers.

### `property vtt.path-cloud.PathRunBand.slots: readonly number[]`

The slots it lies between, in order across.

### `property vtt.path-cloud.PathRunBand.stations: readonly number[]`

The stations it spans, in order.

### `property vtt.path-cloud.PathRunBand.surfaceKey: ConstructionSurfaceKey`

### `interface vtt.path-cloud.PathRunChain`

A chain running **along** the run: the spine, or one side of the contour.

### `property vtt.path-cloud.PathRunChain.across: number`

### `property vtt.path-cloud.PathRunChain.edgeIds: readonly string[]`

The edge between consecutive nodes; one shorter than `nodes`.

### `property vtt.path-cloud.PathRunChain.nodes: readonly PathRunNode[]`

Ordered by station.

### `interface vtt.path-cloud.PathRunNode`

One node of a run, with the address its id carries.

### `property vtt.path-cloud.PathRunNode.across: number`

Signed slot across the cross-section; `0` is the spine.

### `property vtt.path-cloud.PathRunNode.nodeId: string`

### `property vtt.path-cloud.PathRunNode.position: ConstructionPosition`

### `property vtt.path-cloud.PathRunNode.station: number`

### `interface vtt.path-cloud.PathRunRib`

A chain running **across** the run: one station, contour to contour.

### `property vtt.path-cloud.PathRunRib.bands: readonly ConstructionSurfaceKey[]`

The faces this rib bounds.

### `property vtt.path-cloud.PathRunRib.edgeIds: readonly string[]`

### `property vtt.path-cloud.PathRunRib.nodes: readonly PathRunNode[]`

Ordered by `across`, so from one contour through the spine to the other.

### `property vtt.path-cloud.PathRunRib.station: number`

### `function vtt.path-cloud.pathCloudPerimeter(cloud: CloudTopology): readonly PerimeterLoop[]`

The outer perimeter of a whole path cloud, as one named thing.

**This is the contour.** Not the chain a single run reports at its
outermost slot -- that is the rim the sweep laid down, true of a road
standing alone and stale the moment another road joins it. The contour of a
junction is the perimeter of everything joined at it, and the only test
that stays true through a junction is the graph's own: a face on one side
and nothing on the other.

Kept as its own reading, and separately from `PathRun`, because it is
cloud-shaped rather than run-shaped and because it is the thing worth
editing. Every question about the outside of a road network -- where a kerb
goes, where a pavement is offset from, whether two roads really did fuse --
is a question about this one loop, and having it in one place is what makes
changing any of them a local change.

A cloud with a hole in it -- roads round a block -- reports more than one
loop, the outer walk and one per hole, which is correct and is why this is
not a single ring.

### `function vtt.path-cloud.pathRunFor(topologies: readonly ConstructionRegionTopology[], corridorId: string): PathRun | undefined`

One run by its corridor id, or `undefined` if nothing present is from it.

### `function vtt.path-cloud.pathRunsIn(topologies: readonly ConstructionRegionTopology[]): readonly PathRun[]`

Every path run present in `topologies`, one per corridor.

Takes a plain set of boundaries rather than a cloud, because the caller
that needs *every* standing run -- crossing detection, which is looking
for runs it is not yet connected to -- is by definition looking outside
any one cloud.

### `function vtt.path-cloud.pathRunsOf(cloud: CloudTopology): readonly PathRun[]`

The runs inside one cloud -- the cloud-owned view, and the one a tool
should reach for.

Editing dispatches by cloud, so anything asking "what is this road made
of" is asking about the cloud under the pointer, not about a face and not
about the whole table.

### `function vtt.path-corridor.pathCorridorId(operationId: string, kind: PathKind): string`

### `function vtt.path-corridor.pathSubtypeOf(corridorId: string): PathKind | undefined`

The subtype `corridorId` was built from, or `undefined` if it carries none.

### `interface vtt.path-recipe.PathFormationRecipe`

Product recipe forwarded unchanged to the construction-session boundary.

### `property vtt.path-recipe.PathFormationRecipe.kind: PathKind`

### `property vtt.path-recipe.PathFormationRecipe.miterLimit: number`

### `property vtt.path-recipe.PathFormationRecipe.profile: readonly PathProfilePoint[]`

### `interface vtt.path-recipe.PathProfilePoint`

One VTT-owned sample of the cross-section the generic Rust sweep executes.

### `property vtt.path-recipe.PathProfilePoint.elevation: number`

### `property vtt.path-recipe.PathProfilePoint.lateralOffset: number`

### `variable vtt.path-recipe.PATH_SPINE_OFFSET: 0`

The lateral offset the spine sits at.

Every path profile carries a point here, which is what makes the travel
line a real seam in the graph: the two bands either side of it meet along
one shared edge chain, so the line is stored, shared and editable rather
than being a number the generator forgot. Any further line a product wants
to be first-class -- a lane, a rail -- is just another profile point, and
needs no machinery of its own.

### `function vtt.path-recipe.pathCarvesGround(kind: PathKind): boolean`

Whether this subtype carves what it is drawn over.

Declared rather than inferred, which is what dissolves the awkward part of
an overpass: nothing has to work out from a flat XZ footprint whether a
crossing is at the same level, because the run that spans says so itself.

### `function vtt.path-recipe.pathFormationFor(params: PathBrushParams): PathFormationRecipe`

Resolves the VTT's named path recipe without constructing any mesh or graph.

**Flat, and three slots wide, on purpose.** A run is exactly its outer
contour, its spine, and the rib linking them -- the same three parts the
junction work is about to be written against. A raised U edge is a detail
that goes back on top once those connections work, and while the central
logic is being settled it only gets in the way: a lifted rim drags the
terrain's own hole up with it, because the hole reuses the rim's very
nodes, which reads as a berm running the whole length of the road.

`shoulderWidth` still widens the run; `shoulderHeight` is deliberately
unread until the U returns.

Elevations are measured from the reference line's own height rather than
from the world floor. The Rust sweep owns frames, vertices and quads;
where the stations go, and how high each one sits, stays on this side.

### `function vtt.path-recipe.pathHalfWidth(params: PathBrushParams): number`

How far this recipe's own product reaches from the reference line -- the
outermost lateral offset of the profile it produces.

Read off the profile rather than recomputed from the parameters, so the
width the brush is sized against and the width actually swept can never
drift apart. A `street` has no shoulder and a `road` does; that difference
lives in one place, and this follows it.

### `function vtt.path-recipe.pathRidesTerrain(kind: PathKind): boolean`

Whether this subtype's stations take their height from the ground beneath
them.

A deck does not: it spans, so its height comes from its own ends and the
middle stays level instead of sagging onto whatever it crosses. That, plus
declaring that it consumes nothing, is the whole of what makes a subtype a
bridge -- no separate type, no separate role table, no separate logic.

### `function vtt.path-recipe.pathSpineSlot(profile: readonly PathProfilePoint[]): number`

Which profile slot is the spine -- the index of the point at
PATH_SPINE_OFFSET, or `-1` for a profile that declares none.

Node identity is minted relative to this slot, so that "outward" is a fact
an id carries rather than something a later edit has to infer from
geometry that has since moved.

### `interface vtt.station-node-id.StationNodeAddress`

One node of a station-major sweep, as the parts its id is built from.

### `property vtt.station-node-id.StationNodeAddress.across: number`

Signed slot across the cross-section; `0` is the spine.

### `property vtt.station-node-id.StationNodeAddress.operationId: string`

The operation that minted it -- the corridor this node belongs to.

### `property vtt.station-node-id.StationNodeAddress.station: number`

Which cross-section along the line.

### `function vtt.station-node-id.followsOutward(moved: StationNodeAddress, candidate: StationNodeAddress): boolean`

Whether `candidate` should follow `moved` when `moved` is dragged: same
corridor, same station, and further from the spine on the same side.

The spine carries its whole cross-section, a node partway out carries only
what lies beyond it, and the outermost carries nothing -- one rule, no
per-slot cases. Expressed as "further out" rather than as a walk from
neighbour to neighbour because the two agree wherever a walk is even
possible, and this keeps agreeing when the interior is not a grid.

### `function vtt.station-node-id.isSpineNode(id: string): boolean`

Whether `id` names the travel line itself rather than anything beside it.

### `function vtt.station-node-id.parseStationNodeId(id: string): StationNodeAddress | undefined`

The address inside `id`, or `undefined` for an id no sweep minted.

### `function vtt.station-node-id.stationNodeId(operationId: string, station: number, across: number): string`

### `interface vtt.structure-types.ResolvedCoverage`

One covered region, paired with what the painted type wants to do about it.

### `property vtt.structure-types.ResolvedCoverage.covered: ConstructionCoveredRegion`

### `property vtt.structure-types.ResolvedCoverage.interaction: CreationInteraction`

### `variable vtt.structure-types.STRUCTURE_TYPE_DEFINITIONS: readonly StructureTypeDefinition[]`

One file per structure type, each pairing creation-shape knowledge with
the role table that shape implies -- the whole TS-owned half of
`docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.

A definition here is a **cloud's** behaviour, not a face's: the type
string a surface carries only selects which of these tables governs the
cloud it belongs to (`construction-cloud.ts`). Every type declares the
same three things, including how far each of its roles reaches -- there
is no per-type escape from the rule, and a type that wants a different
reach says so in its own role table rather than in a tool.

Types sharing a shape share a definition rather than restating one: every
upright panel (wall, tower, door jamb) is one type built by one builder --
a tower is a wall someone stamped a circle of, not a kind of its own --
and both terrain flavours are the same non-enumerable boundary. Splitting
those per product name would be duplication, not per-type policy.

A path is its own definition despite also being generated, because its
shape genuinely differs: a swept run has addressable stations, so it has
real roles to name, where terrain has none and can only regenerate. Shape
is what decides whether two products share a table -- not whether they
happen to share a generator.

### `function vtt.structure-types.firstRefusal(resolved: readonly ResolvedCoverage[]): string | undefined`

The first refusal in a resolved coverage, if any.

### `function vtt.structure-types.resolveCoverage(paintedType: string, covered: readonly ConstructionCoveredRegion[], paintedSubtype?: string): readonly ResolvedCoverage[]`

Pairs every region a footprint touches with its resolved interaction --
the creation-side counterpart to `planEdit`. Pure: it decides, it does not
act, and the caller performs whatever the resolutions imply.

A `"forbid"` anywhere in the result is the caller's cue to abandon the
whole stroke rather than apply the rest: painting terrain across a wall
must not quietly terraform everything except the wall.

### `function vtt.structure-types.resolveCreationInteraction(paintedType: string, coveredType: string, paintedSubtype?: string): CreationInteraction`

What painting `paintedType` over one already-present region means.

An unrecognized covered type is refused rather than defaulting to
`"ignore"`: silently stacking on top of something nobody declared is
exactly how geometry accumulates unnoticed.

### `function vtt.structure-types.resolvePolicy(topology: ConstructionRegionTopology, target: EditTarget): RolePolicy`

The role a grabbed part of a region carries, plus the policy governing it.
A surface type with no definition at all resolves to a denial rather than
a permissive default -- an unrecognized type is exactly the case where
guessing would corrupt geometry.

### `function vtt.structure-types.structureTypeFor(surfaceType: string): StructureTypeDefinition | undefined`

The definition governing one surface type, or `undefined` if it has none.

### `type vtt.creation-interaction.CreationInteraction = { kind: "ignore" } | { kind: "cut" } | { kind: "restack" } | { kind: "forbid"; reason: string }`

What happens when one structure type is painted over another.

Creation and editing are two faces of the same coin: a type declares what
its own parts allow (the role table) *and* how it meets every other type.
Neither half lives in Rust -- the engine answers "what is already here"
(`getFootprintCoverage`) and performs primitives; which of them to run is
this table's call.

**The relation is directional, and that is the point.** A wall goes on top
of terrain; terrain does not go on top of a wall. Declaring one direction
says nothing about the other, so both are declared separately rather than
inferred from a symmetric "compatible" flag.

### `type vtt.creation-interaction.CreationInteractionKind = CreationInteraction["kind"]`

### `variable vtt.creation-interaction.CUT: CreationInteraction`

### `variable vtt.creation-interaction.IGNORE: CreationInteraction`

### `variable vtt.creation-interaction.RESTACK: CreationInteraction`

### `function vtt.creation-interaction.forbid(reason: string): CreationInteraction`

### `variable vtt.organic-structure.ORGANIC_ROLES: { body: "organic-body"; boundaryEdge: "organic-boundary-edge"; boundaryVertex: "organic-boundary-vertex" }`

The role model for a procedurally generated, non-enumerable boundary --
terrain sculpted from a noise lattice, a path swept by a brush. There is
no "this vertex is always the corner" to assign, because generation never
promised one: the vertex count and layout follow the stroke, not a fixed
shape this side requested.

Consequences, straight from
`docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`: the table
is near-empty on purpose. Anything structural (subdividing, welding,
cutting) escalates to a whole-region regeneration rather than a sequence
of primitives, because no atomic sequence can express "re-roll this
terrain." What *is* role-independent -- sliding a boundary vertex, edge,
or the whole patch around -- stays allowed, since it needs no knowledge of
what the vertex means.

### `function vtt.organic-structure.organicPolicyFactory(structural: "deny" | "regenerate"): (role: string) => RolePolicy`

### `function vtt.organic-structure.organicRoleFor(_topology: unknown, target: EditTarget): string`

### `function vtt.organic-structure.organicStructureType(surfaceType: string, label: string, creation: string, structural: "deny" | "regenerate", interactionOver: (coveredType: string, paintedSubtype?: string) => CreationInteraction): StructureTypeDefinition`

### `function vtt.organic-structure.pathInteractionOver(_coveredType: string, paintedSubtype?: string): CreationInteraction`

A path **carves**: it consumes what it crosses and keeps the leftover with
the path's own shape cut out of it. Over terrain that is a road; over a
wall the same cut reads as an opening through it.

Over another path the two formations become one connected path surface:
the same cut-and-refill flow consumes the overlap instead of leaving
coincident path geometry behind.

Except a deck, which spans rather than carves. That is a declared property
of the subtype, not something read back from geometry -- which is exactly
why an overpass needs no height-aware coverage query to be told apart from
a crossing at the same level. The run that passes over says so.

### `function vtt.organic-structure.terrainInteractionOver(coveredType: string): CreationInteraction`

Terrain painted over terrain **raises** it: the covered faces are deleted,
the new ones generated above, and the result stitched back onto the rim
the removal exposed. It does not overlay a second lattice on top of the
first, which is what used to stack geometry on every stroke.

Terrain over anything else is refused. Ground is not something that can
come into being above a wall or a path -- there is no meaning to assign,
so nothing is generated and the caller says why. This is the direction
that does *not* mirror: a wall over terrain is perfectly ordinary.

### `variable vtt.panel-structure.PANEL_ROLES: { body: "panel-body"; bottomCorner: "panel-bottom-corner"; bottomEdge: "panel-bottom-edge"; post: "panel-post"; topCorner: "panel-top-corner"; topEdge: "panel-top-edge"; unknown: "panel-unknown" }`

The shared role model for every type generated by `extrude_path`: an
upright panel whose boundary is a bottom run at the baseline and a top run
one `height` above it. Walls and towers are both this shape -- a tower is
a closed ring of such panels with arc edges instead of straight ones, not
a different topology.

**Where the roles come from.** `extrude_path` emits one panel's cycle as
`[bottomStart, bottomEnd, topEnd, topStart]`, and `straight_cycle_region`
turns that into edges `0: bottom`, `1: end post`, `2: top`, `3: start
post`. This side issued that generation call, so it knows the meaning of
each slot by construction -- Rust neither tags nor reports a role. Height
comparison is used rather than the raw index so a panel that has since
been subdivided (a T-junction weld inserting a vertex mid-run) still
classifies correctly; both rules describe the very same creation shape.

### `function vtt.panel-structure.panelInteractionOver(_coveredType: string): CreationInteraction`

A panel is built *on top of* whatever is already there and consumes
nothing: a wall standing on terrain leaves that terrain intact, and two
walls crossing weld at their shared corners rather than eating each other.
That is the whole of the panel side of the interaction table.

### `function vtt.panel-structure.panelPolicyFor(role: string): RolePolicy`

### `function vtt.panel-structure.panelRoleFor(topology: ConstructionRegionTopology, target: EditTarget): string`

### `function vtt.panel-structure.panelStructureType(surfaceType: string, label: string, creation: string): StructureTypeDefinition`

Builds one `extrude_path`-generated structure type on the shared panel model.

### `variable vtt.path-structure.PATH_ROLES: { across: "path-across"; body: "path-body"; contourEdge: "path-contour-edge"; edge: "path-edge"; ribEdge: "path-rib-edge"; spine: "path-spine"; spineEdge: "path-spine-edge"; unknown: "path-unknown" }`

The role model for anything swept along a travel line: a spine, whatever
lies between the spine and the rim, and the rim itself.

**The whole rule is one sentence.** Dragging a node carries every node of
its own station that lies further out on the same side. The spine's "further
out" is the entire cross-section; a node partway out carries only what is
beyond it; the rim carries nothing, because nothing is beyond it. That
single rule replaces a per-slot table, and it is why there is no separate
`contour` role here to keep in sync with a `rib` one.

**Same-delta, deliberately.** Nothing is recomputed. A drag does not re-run
the recipe or re-derive the mitre frame, so a corner made by dragging the
spine narrows the way any hand-edited shape narrows. That is the model this
repo already commits to for walls -- the graph is the truth and the recipe
only seeds it -- and it is what lets the whole cascade be plain same-delta
ops, which is all `RolePolicy` supports.

**Widening has a direction now.** Because the cross-section is materialised
as real nodes out to the rim, pushing the rim outward is an ordinary edit
rather than a width parameter that would need the frame recomputed to mean
anything.

### `function vtt.path-structure.pathPolicyFor(role: string): RolePolicy`

### `function vtt.path-structure.pathRoleFor(topology: ConstructionRegionTopology, target: EditTarget): string`

### `function vtt.path-structure.pathStructureType(surfaceType: string, label: string, creation: string, interactionOver: (coveredType: string, paintedSubtype?: string) => CreationInteraction): StructureTypeDefinition`

Builds one swept-product structure type on the shared spine model.

### `interface vtt.structure-type.CascadeContext`

What a cascade gets to look at when deriving its extra ops.

The whole cloud, not only the grabbed face: a cascade exists precisely to
reach parts the gesture never named, and a panel welded onto a neighbour
shares its column with that neighbour. Reading one face would make the
answer depend on which of two panels the pointer happened to land on.

A swept product needs the same reach for its own reason -- one station
runs through every band it was built from, and the rim belongs only to
the outermost -- which is why there is no second "related regions" list
beside this one. The cloud already *is* that list, resolved by the layer
whose job it is (`construction-cloud.ts`) instead of recomputed by
whichever tool happens to be calling.

### `property vtt.structure-type.CascadeContext.cloud: CloudTopology`

### `property vtt.structure-type.CascadeContext.delta: { x: number; y: number; z: number }`

The delta already constrained by the role's own axes.

### `property vtt.structure-type.CascadeContext.target: EditTarget`

### `property vtt.structure-type.CascadeContext.topology: ConstructionRegionTopology`

The face the gesture landed on -- `cloud.seed`, offered directly for the common case.

### `interface vtt.structure-type.RolePolicy`

One role's complete editing policy: what it allows, how far it reaches,
what constrains the op's own parameter, and what else fires in the same
transaction.

### `property vtt.structure-type.RolePolicy.axes: readonly EditAxis[]`

Axes the gesture's delta survives on. Ignored when `resolve` is not `"allow"`.

### `property vtt.structure-type.RolePolicy.cascade?: (context: CascadeContext) => readonly AtomicEditOp[]`

Extra ops fired alongside the primary one, as one transaction -- e.g.
moving a wall's bottom corner moves its paired top corner by the *same*
delta. Same-delta cascades are all this model needs so far; there is no
scaled or cross-axis variant.

### `property vtt.structure-type.RolePolicy.resolve: EditResolution`

### `property vtt.structure-type.RolePolicy.role: string`

### `property vtt.structure-type.RolePolicy.scope: EditScope`

Whether the op applies to the grabbed face alone or to every member of
its cloud. Declared per role rather than defaulted, so a new structure
type states its reach on purpose instead of inheriting whichever answer
happened to be cheaper -- the same posture the axes list already takes.

### `interface vtt.structure-type.StructureTypeDefinition`

One structure type's definition -- which is to say, **what a cloud of this
type does**, since the cloud is what the type names (`ADR-0022`, and
`construction-cloud.ts`). Nothing below is a property of a single face;
a face only carries the string that selects this table.

It pairs the halves the design doc keeps together on purpose:

1. **How it is created** -- which generation call produced it, in what
   expected shape.
2. **The role table derived from that shape**, each role declaring its own
   reach. Because this side *asked* for a specific shape, it already knows
   by construction what index 0 of the engine's deterministically-ordered
   response means. Nothing travels back from Rust to say so.
3. **How it meets every other type** when painted over one.

A tool preset -- "a tower," "a house" -- is not a type and never appears
here. A preset chooses parameters and a generator; the geometry it
produces lands in a cloud whose type is one of these, and that cloud is
where its behaviour comes from. This is why a tower needs no editing code
of its own.

### `property vtt.structure-type.StructureTypeDefinition.creation: string`

How this type is generated, recorded next to the roles it implies --
the doc's whole point is that these two halves must not drift apart.

### `property vtt.structure-type.StructureTypeDefinition.interactionOver: (coveredType: string, paintedSubtype?: string) => CreationInteraction`

What happens when **this** type is painted over `coveredType` -- the
creation half of the same declaration. Directional on purpose: a wall
goes on terrain, terrain does not go on a wall, and neither direction
says anything about the other.

`paintedSubtype` is the preset the run being painted was built from,
when its type has subtypes at all. It is what lets one type vary a
declared behaviour -- a bridge deck consuming nothing where a road
carves -- without splitting into a second type with its own role table
and its own logic to keep in step.

### `property vtt.structure-type.StructureTypeDefinition.label: string`

### `property vtt.structure-type.StructureTypeDefinition.policyFor: (role: string) => RolePolicy`

The policy for one role.

### `property vtt.structure-type.StructureTypeDefinition.roleFor: (topology: ConstructionRegionTopology, target: EditTarget) => string`

Resolves what the grabbed part of this region means.

### `property vtt.structure-type.StructureTypeDefinition.surfaceType: string`

The `surfaceType` the engine reports for regions of this kind.

### `type vtt.structure-type.EditResolution = { kind: "allow" } | { kind: "deny"; reason: string } | { kind: "regenerate"; reason: string }`

What a role's policy allows a gesture to do.

### `type vtt.structure-type.EditRole = string`

A role is this app's own name for "what a particular node/edge of a
generated shape means" -- `"wall-bottom-corner"`, `"tower-rim-edge"`.
Deliberately a plain string: the engine never sees one, never returns one,
and never validates one. Each structure-type file mints its own.

### `type vtt.structure-type.EditScope = "surface" | "cloud"`

How far a gesture on this role reaches.

`ADR-0022` settles the default: the cloud is what editing operates on,
never a face in isolation. A role is `"surface"` only where the grabbed
part genuinely belongs to one face and to no other -- a panel's own
corner is that panel's corner, and moving it moves whatever else happens
to reference the node, which is a consequence of the graph rather than a
scope decision. `"cloud"` is for the roles that name the *whole thing*:
grabbing a wall's body means the wall, not the one panel under the
pointer.

### `function vtt.structure-type.allowed(role: string, axes: readonly EditAxis[], scope: EditScope, cascade?: (context: CascadeContext) => readonly AtomicEditOp[]): RolePolicy`

Convenience for the common "allowed, on these axes, at this reach, no cascade" policy.

### `function vtt.structure-type.denied(role: string, reason: string): RolePolicy`

The policy every unknown role falls back to: refuse rather than guess.

### `interface vtt.surface-edit-contract.BrushGestureRegion`

The complete world-space sweep supplied by one gesture.

### `property vtt.surface-edit-contract.BrushGestureRegion.samples: readonly BrushGestureSample[]`

### `interface vtt.surface-edit-contract.BrushGestureSample`

A world-space pointer sample collected for one brush gesture.

### `property vtt.surface-edit-contract.BrushGestureSample.x: number`

### `property vtt.surface-edit-contract.BrushGestureSample.y: number`

### `property vtt.surface-edit-contract.BrushGestureSample.z: number`

### `interface vtt.surface-edit-contract.ConstructionOperationContext`

Who asked for an effect, and on which table. Only `operationId` crosses to the engine; the rest is for undo/redo bookkeeping and attribution.

### `property vtt.surface-edit-contract.ConstructionOperationContext.initiatedBy: string`

### `property vtt.surface-edit-contract.ConstructionOperationContext.operationId: string`

### `property vtt.surface-edit-contract.ConstructionOperationContext.tableId: string`

### `interface vtt.surface-edit-contract.PathBrushEffect`

One semantic path-paint intent. It contains no graph mutations.

### `property vtt.surface-edit-contract.PathBrushEffect.brushRegion: BrushGestureRegion`

### `property vtt.surface-edit-contract.PathBrushEffect.brushShape: BrushShape`

### `property vtt.surface-edit-contract.PathBrushEffect.expected: readonly RevisionPrecondition[]`

### `property vtt.surface-edit-contract.PathBrushEffect.initiatedBy: string`

### `property vtt.surface-edit-contract.PathBrushEffect.kind: "surface.path-brush@1"`

### `property vtt.surface-edit-contract.PathBrushEffect.operationId: string`

### `property vtt.surface-edit-contract.PathBrushEffect.parameters: PathFormationRecipe`

### `property vtt.surface-edit-contract.PathBrushEffect.tableId: string`

### `property vtt.surface-edit-contract.PathBrushEffect.targetScope: "brush-region"`

### `property vtt.surface-edit-contract.PathBrushEffect.targetType: "path"`

### `interface vtt.surface-edit-contract.RevisionPrecondition`

A revision an effect expects to still be current when it lands.

Nothing supplies one today -- every effect is built with an empty list --
so this is the shape a concurrent-edit check would take, not a check that
runs.

### `property vtt.surface-edit-contract.RevisionPrecondition.revision: number`

### `property vtt.surface-edit-contract.RevisionPrecondition.scope: string`

### `interface vtt.surface-edit-contract.SurfaceEditModeDefinition`

App-owned metadata for a mode, without renderer or Rust types.

### `property vtt.surface-edit-contract.SurfaceEditModeDefinition.effectKinds: readonly string[]`

### `property vtt.surface-edit-contract.SurfaceEditModeDefinition.id: string`

### `property vtt.surface-edit-contract.SurfaceEditModeDefinition.label: string`

### `property vtt.surface-edit-contract.SurfaceEditModeDefinition.previewPolicy: "none" | "gesture-preview"`

### `property vtt.surface-edit-contract.SurfaceEditModeDefinition.scopePolicy: "local" | "explicit-global"`

### `property vtt.surface-edit-contract.SurfaceEditModeDefinition.sourceSurfaceType: string`

### `property vtt.surface-edit-contract.SurfaceEditModeDefinition.supportedTargetScopes: readonly SurfaceEditTargetScope[]`

### `property vtt.surface-edit-contract.SurfaceEditModeDefinition.transformerCapability: string`

### `type vtt.surface-edit-contract.BrushShape = { kind: "circle"; radius: number } | { kind: "square"; rotationRadians: number; size: number } | { kind: "hexagon"; radius: number; rotationRadians: number }`

A renderer-neutral external brush footprint.

### `type vtt.surface-edit-contract.PathFormationParameters = PathFormationRecipe`

VTT-selected profile for a generic path-sweep formation.

### `type vtt.surface-edit-contract.SurfaceEditTargetScope = "brush-region" | "surface" | "edge" | "node" | "cloud"`

A product-owned scope supported by a surface edit mode -- *what a mode
accepts as a target*.

Not to be confused with `structure-types`' own `EditScope`, which is *how
far one role's op reaches* once a target has been grabbed. A mode can
accept a `"node"` target whose role nevertheless reaches the whole cloud;
the two answer different questions and share only the word.

### `function vtt.surface-edit-contract.createPathBrushEffect(payload: Omit<PathBrushEffect, keyof ConstructionOperationContext | "kind" | "targetScope" | "targetType" | "expected">, context: ConstructionOperationContext, expected: readonly RevisionPrecondition[]): PathBrushEffect`

Creates one immutable effect for a future release-to-confirm boundary.
It deliberately does not resolve geometry or mutate graph topology.

### `variable vtt.surface-edit-mode-registry.SURFACE_EDIT_MODE_DEFINITIONS: readonly SurfaceEditModeDefinition[]`

Product-owned edit modes; capabilities stay renderer- and WASM-neutral.

### `function vtt.surface-edit-mode-registry.surfaceEditModeFor(sourceSurfaceType: string): SurfaceEditModeDefinition | undefined`

Resolves the contextual edit mode for one semantic construction surface type.

### `interface vtt.surface-perimeter.PerimeterLoop`

One closed run of perimeter, walked end to end.

### `property vtt.surface-perimeter.PerimeterLoop.closed: boolean`

Whether the walk closed on itself, as a complete perimeter must.

### `property vtt.surface-perimeter.PerimeterLoop.edgeIds: readonly string[]`

In walk order; one per step.

### `property vtt.surface-perimeter.PerimeterLoop.nodeIds: readonly string[]`

In walk order, `nodeIds[i]` starting `edgeIds[i]`.

### `property vtt.surface-perimeter.PerimeterLoop.positions: readonly ConstructionPosition[]`

### `function vtt.surface-perimeter.edgeUseCounts(topologies: readonly ConstructionRegionTopology[]): ReadonlyMap<string, number>`

How many faces each edge bounds, across the whole set.

### `function vtt.surface-perimeter.perimeterOf(topologies: readonly ConstructionRegionTopology[]): readonly PerimeterLoop[]`

Every perimeter loop of `topologies`, as closed walks.

Takes a whole set rather than one face, because the question is only
meaningful for a set: an edge is interior *to something*, and one face on
its own has nothing but perimeter. Hand it a cloud and it answers for the
cloud, which is the unit a junction actually changes.

A node where three or more perimeter edges meet -- a pinch, where the
surface touches itself -- is walked by taking whichever edge has not been
walked yet. That yields loops that partition the perimeter rather than the
one canonical figure-of-eight, which is the right answer for drawing it and
an arbitrary one for reasoning about winding.

### `interface vtt.tool-types.BrushShapeParams`

### `property vtt.tool-types.BrushShapeParams.radius: number`

Circle/hexagon radius, or square half-size, in world units.

### `property vtt.tool-types.BrushShapeParams.rotationDegrees: number`

Rotation around world Y; ignored by circles.

### `property vtt.tool-types.BrushShapeParams.shape: BrushShapeKind`

Convex footprint shared by terrain and path brushes.

### `interface vtt.tool-types.InteriorGenerateParams`

One click inside an already-enclosed space (any shape -- `findEnclosingRoom`'s
own wall-follower algorithm, not limited to rectangles) rasterizes that
space into a `cellSize` grid and hands it to the same region-partition
algorithm `ConstructionSessionPort.generateRegionPartition` already
exposes (the Rust side the retired "Pintar Casa" brush used to drive one
cell at a time) -- see `composition/tabletop/tools/house/interior-wall-tool.ts`.
A region larger than `maxRegionCells` auto-splits into more than one
room, so the same enclosed footprint can regenerate into a different
layout just by changing `seed`/`maxRegionCells`. No floor/ceiling
(not implemented yet) -- only the generated cap surfaces are stripped
back out client-side after the engine call.

### `property vtt.tool-types.InteriorGenerateParams.cellSize: number`

World-space side length of one grid cell.

### `property vtt.tool-types.InteriorGenerateParams.maxRegionCells: number`

A connected region larger than this many cells gets auto-split into more than one room.

### `property vtt.tool-types.InteriorGenerateParams.seed: number`

Drives the split layout's jitter -- the same enclosed footprint always reproduces the same rooms for a given seed.

### `property vtt.tool-types.InteriorGenerateParams.wallType: "wall-white" | "wall-gray"`

### `interface vtt.tool-types.OpeningParams`

One opening stamped onto a wall panel: a door or a window.

An opening is a face like any other -- it is not a marker on the wall and
not a hole cut through it. The wall gains an inner loop and this face
takes that very loop as its own boundary, so the two share the rim and a
wall with a window is still one wall.

A door is the same shape with its sill on the floor, which is why there is
one tool and not two.

### `property vtt.tool-types.OpeningParams.height: number`

### `property vtt.tool-types.OpeningParams.openingType: "window" | "door"`

### `property vtt.tool-types.OpeningParams.sill: number`

How far above the wall's own base the opening starts. Zero is a door.

### `property vtt.tool-types.OpeningParams.width: number`

How wide, measured along the wall rather than across the ground -- a curved wall is travelled, not spanned.

### `interface vtt.tool-types.PathBrushParams`

### `property vtt.tool-types.PathBrushParams.bedWidth: number`

Width of the flat traversable bed, in world units.

### `property vtt.tool-types.PathBrushParams.miterLimit: number`

Maximum corner extension, in multiples of the local half width.

### `property vtt.tool-types.PathBrushParams.pathKind: PathKind`

Product recipe; every variant still creates the single `path` surface type.

### `property vtt.tool-types.PathBrushParams.radius: number`

Circle/hexagon radius, or square half-size, in world units.

### `property vtt.tool-types.PathBrushParams.rotationDegrees: number`

Rotation around world Y; ignored by circles.

### `property vtt.tool-types.PathBrushParams.shape: BrushShapeKind`

Convex footprint shared by terrain and path brushes.

### `property vtt.tool-types.PathBrushParams.shoulderHeight: number`

Non-negative shoulder elevation above the path bed.

### `property vtt.tool-types.PathBrushParams.shoulderWidth: number`

Width of each optional raised shoulder, in world units.

### `interface vtt.tool-types.TerrainSculptParams`

A single seeded, self-contained hexagon of irregular terrain, submitted as
graph nodes/surfaces in one shot -- see
`composition/tabletop/tools/terrain/terrain-sculpt-tool.ts`.

### `property vtt.tool-types.TerrainSculptParams.heightScale: number`

Multiplies the sampled Perlin noise (native `[-1, 1]`) into world-space height units.

### `property vtt.tool-types.TerrainSculptParams.irregularity: number`

`0` = cells relaxed hard toward square (regular-looking, like a normal
grid); `1` = minimal relaxation, cells keep the raw irregular shape/size
variety `pairTriangles`'s random rhombus merge produces. `irregular-grid.ts`'s
own `relax()` step is what pulls cells toward square in the first place --
this maps directly onto its `strength` option.

### `property vtt.tool-types.TerrainSculptParams.noiseScale: number`

Perlin `scale` -- smaller values are smoother/larger-scale terrain features.

### `property vtt.tool-types.TerrainSculptParams.seed: number`

### `property vtt.tool-types.TerrainSculptParams.targetSurface: "terrain" | "terrain-grass"`

### `property vtt.tool-types.TerrainSculptParams.trianglesPerSide: number`

Triangles per hexagon edge -- sizes the one whole-stroke lattice built on `onPointerDown` (`composition/tabletop/tools/terrain/terrain-sculpt-tool.ts`). Bigger means more room to paint before running past the precomputed area, at a one-time (not per-tick) JS cost.

### `interface vtt.tool-types.ToolParamsByTool`

### `property vtt.tool-types.ToolParamsByTool.edit-region: NoToolParams`

### `property vtt.tool-types.ToolParamsByTool.house-room-delete: NoToolParams`

### `property vtt.tool-types.ToolParamsByTool.interior-wall: InteriorGenerateParams`

### `property vtt.tool-types.ToolParamsByTool.navigate: NoToolParams`

### `property vtt.tool-types.ToolParamsByTool.opening: OpeningParams`

### `property vtt.tool-types.ToolParamsByTool.path-brush: PathBrushParams`

### `property vtt.tool-types.ToolParamsByTool.terrain-sculpt: TerrainSculptParams`

### `property vtt.tool-types.ToolParamsByTool.tower-stamp: TowerStampParams`

### `property vtt.tool-types.ToolParamsByTool.wall-brush: WallBrushParams`

### `property vtt.tool-types.ToolParamsByTool.wall-line: WallParams`

### `interface vtt.tool-types.TowerStampParams`

What every wall-producing tool needs and nothing else: which wall type,
and how tall. There is one wall type in the engine, so a free stroke, a
straight run and a tower preset all commit through the same builder with
the same parameters -- a preset is a shape, never its own kind of wall.

`height` is the length of each panel's own vertical edge, which is all a
height ever is here: the graph stores the two horizontal edges and their
connection, and the distance between them is this number.

### `property vtt.tool-types.TowerStampParams.height: number`

Length of a panel's own vertical edge, in world units.

### `property vtt.tool-types.TowerStampParams.radius: 1.5 | 2.5 | 4`

### `property vtt.tool-types.TowerStampParams.wallType: "wall-white" | "wall-gray"`

### `interface vtt.tool-types.WallBrushParams`

A free wall stroke. The brush footprint is not a footprint here -- it is
the *fitting tolerance*: a radius of 0 commits the contour literally, and
a larger radius lets a shakier stroke be corrected into clean straight
runs and true arcs. That is the whole reason a wall brush carries a shape
at all, and why its radius floor is 0 rather than the path brush's own.

### `property vtt.tool-types.WallBrushParams.height: number`

Length of a panel's own vertical edge, in world units.

### `property vtt.tool-types.WallBrushParams.radius: number`

Circle/hexagon radius, or square half-size, in world units.

### `property vtt.tool-types.WallBrushParams.rotationDegrees: number`

Rotation around world Y; ignored by circles.

### `property vtt.tool-types.WallBrushParams.shape: BrushShapeKind`

Convex footprint shared by terrain and path brushes.

### `property vtt.tool-types.WallBrushParams.wallType: "wall-white" | "wall-gray"`

### `interface vtt.tool-types.WallParams`

What every wall-producing tool needs and nothing else: which wall type,
and how tall. There is one wall type in the engine, so a free stroke, a
straight run and a tower preset all commit through the same builder with
the same parameters -- a preset is a shape, never its own kind of wall.

`height` is the length of each panel's own vertical edge, which is all a
height ever is here: the graph stores the two horizontal edges and their
connection, and the distance between them is this number.

### `property vtt.tool-types.WallParams.height: number`

Length of a panel's own vertical edge, in world units.

### `property vtt.tool-types.WallParams.wallType: "wall-white" | "wall-gray"`

### `type vtt.tool-types.BrushShapeKind = "circle" | "square" | "hexagon"`

### `type vtt.tool-types.ConstructionToolId = "navigate" | "edit-region" | "path-brush" | "wall-brush" | "wall-line" | "interior-wall" | "tower-stamp" | "opening" | "house-room-delete" | "terrain-sculpt"`

The construction-tool vocabulary every layer (widgets, composition) needs
to agree on: which tools exist, what each one's parameters look like, and
how a tool describes its own not-yet-committed preview. Pure data, no
pointer/render logic -- that lives in `composition/tabletop/tools/`
(the tool implementations) and `adapters/rendering/` (turning a
PreviewDescriptor into an actual scene item).

### `type vtt.tool-types.NoToolParams = Record<string, never>`

### `type vtt.tool-types.PathKind = "trail" | "street" | "road" | "bridge"`

Which preset a path run is built from.

A subtype, not a type: every one of these collapses to the single `path`
surface type, shares its role table, its cascade and its editing rules,
and differs only in the cross-section it seeds and a couple of declared
behaviours. Adding one is adding a preset -- never a second set of type
logic to keep in step with the first.

### `type vtt.tool-types.PreviewDescriptor = { color: number; kind: "segments"; opacity?: number; positions: Float32Array } | { color: number; kind: "quad"; opacity?: number; positions: Float32Array } | { color: number; indices: Uint16Array | Uint32Array; kind: "mesh"; opacity?: number; positions: Float32Array }`

A tool's not-yet-committed ghost, expressed as plain geometry -- no
renderer type crosses this boundary (`adapters/rendering` is the only
layer allowed to know about `@grafting/render-3d`). `"segments"` draws an
open polyline (a wall's centerline while dragging); `"quad"` draws a
filled footprint (a terrain brush's reach, a room stamp's proposed
outline) as two triangles over 4 corner points.

### `type vtt.tool-types.ToolParamsFor = ToolParamsByTool[Id]`

### `variable vtt.tool-types.DEFAULT_TOOL_PARAMS: ToolParamsByTool`

### `variable vtt.tool-types.TOWER_RADIUS_PRESETS: readonly [1.5, 2.5, 4]`

A closed circular wall footprint, stamped in one click at a known radius
-- not drawn. This is the "buildings get known geometry, never freehand
curves" half of the owner's own split (free brush stays free for
fences/paths; a building shape like a tower is a preset instead), see
`composition/tabletop/tools/tower/tower-stamp-tool.ts`. `radius` is
deliberately restricted to TOWER_RADIUS_PRESETS -- a small,
closed catalog, not a free numeric field -- so every tower on a table is
one of a few known sizes a later room-generation pass (Note 0008) can
reason about, not an arbitrary one a careless drag produced.

### `interface vtt.attach-camera-navigation.CameraControllable`

The minimum a target needs for this feature to drive its camera. A
structural type, not `TabletopRuntime` itself -- `composition` depends on
`features`, not the other way around, so this module cannot import the
concrete runtime type and instead accepts anything shaped like it.

### `method vtt.attach-camera-navigation.CameraControllable.attachCameraControls(viewId: string, element: HTMLElement, options?: CameraControlOptions): CameraControlHandle`

### `function vtt.attach-camera-navigation.attachCameraNavigation(target: CameraControllable, viewId: string, element: HTMLElement): () => void`

Wires camera navigation for one attached view. Returns a detach function --
callers MUST invoke it on unmount/view-detach, the same lifecycle discipline
`TabletopRuntime.attachView`'s own callers already follow.

### `interface vtt.token-operations.BindTokenSubjectIntent`

### `property vtt.token-operations.BindTokenSubjectIntent.expectedTokenRevision: number`

### `property vtt.token-operations.BindTokenSubjectIntent.subjectRef: string | null`

### `property vtt.token-operations.BindTokenSubjectIntent.tokenId: string`

### `interface vtt.token-operations.BindTokenSubjectOperation`

### `property vtt.token-operations.BindTokenSubjectOperation.expected: readonly RevisionPrecondition[]`

### `property vtt.token-operations.BindTokenSubjectOperation.initiatedBy: string`

### `property vtt.token-operations.BindTokenSubjectOperation.kind: "token.bind-subject@1"`

### `property vtt.token-operations.BindTokenSubjectOperation.operationId: string`

### `property vtt.token-operations.BindTokenSubjectOperation.payload: { subjectRef: string | null; tokenId: string }`

### `property vtt.token-operations.BindTokenSubjectOperation.tableId: string`

### `interface vtt.token-operations.PlaceTokenIntent`

### `property vtt.token-operations.PlaceTokenIntent.appearance: TokenAppearance`

### `property vtt.token-operations.PlaceTokenIntent.position: TokenPosition`

### `property vtt.token-operations.PlaceTokenIntent.sceneId: string`

### `property vtt.token-operations.PlaceTokenIntent.subjectRef?: string`

### `property vtt.token-operations.PlaceTokenIntent.tokenId: string`

### `interface vtt.token-operations.PlaceTokenOperation`

### `property vtt.token-operations.PlaceTokenOperation.expected: readonly RevisionPrecondition[]`

### `property vtt.token-operations.PlaceTokenOperation.initiatedBy: string`

### `property vtt.token-operations.PlaceTokenOperation.kind: "token.place@1"`

### `property vtt.token-operations.PlaceTokenOperation.operationId: string`

### `property vtt.token-operations.PlaceTokenOperation.payload: PlaceTokenIntent`

### `property vtt.token-operations.PlaceTokenOperation.sceneId: string`

### `property vtt.token-operations.PlaceTokenOperation.tableId: string`

### `interface vtt.token-operations.RevisionPrecondition`

### `property vtt.token-operations.RevisionPrecondition.revision: number`

### `property vtt.token-operations.RevisionPrecondition.scope: string`

### `interface vtt.token-operations.TokenOperationContext`

### `property vtt.token-operations.TokenOperationContext.initiatedBy: string`

### `property vtt.token-operations.TokenOperationContext.operationId: string`

### `property vtt.token-operations.TokenOperationContext.tableId: string`

### `type vtt.token-operations.OperationId = string`

### `type vtt.token-operations.ParticipantId = string`

### `type vtt.token-operations.TokenOperation = PlaceTokenOperation | BindTokenSubjectOperation`

### `function vtt.token-operations.createBindTokenSubjectOperation(intent: BindTokenSubjectIntent, context: TokenOperationContext): BindTokenSubjectOperation`

### `function vtt.token-operations.createPlaceTokenOperation(intent: PlaceTokenIntent, context: TokenOperationContext): PlaceTokenOperation`

### `interface vtt.construction-session-port.AffectedSurfaces`

### `property vtt.construction-session-port.AffectedSurfaces.affectedSurfaceKeys: readonly ConstructionSurfaceKey[]`

### `interface vtt.construction-session-port.ApplyRegionOverlayRequest`

One generic overlay whose geometry and affected regions were resolved by the application.

### `property vtt.construction-session-port.ApplyRegionOverlayRequest.boundary: readonly ConstructionOrientedEdgeUse[]`

### `property vtt.construction-session-port.ApplyRegionOverlayRequest.operationId: string`

### `property vtt.construction-session-port.ApplyRegionOverlayRequest.outline: readonly (readonly [number, number])[]`

### `property vtt.construction-session-port.ApplyRegionOverlayRequest.patch: ConstructionPatch`

### `property vtt.construction-session-port.ApplyRegionOverlayRequest.sourceSurfaceKeys: readonly ConstructionSurfaceKey[]`

### `interface vtt.construction-session-port.CellCoordinate`

One grid cell in a GenerateRegionPartitionRequest's own local grid
-- not world units (multiply by `cellSize` and offset by `origin` to get
a world position). Generic on purpose (not house-specific): the app
composition layer names a particular use of this "a house," but this
port only knows about painted cells partitioned into rooms, the same way
it only knows about "a wall," not "a bedroom wall."

### `property vtt.construction-session-port.CellCoordinate.x: number`

### `property vtt.construction-session-port.CellCoordinate.z: number`

### `interface vtt.construction-session-port.CloudOutcome`

### `property vtt.construction-session-port.CloudOutcome.surfaceKeys: readonly ConstructionSurfaceKey[]`

### `interface vtt.construction-session-port.CloudRequest`

`ADR-0022`'s "cloud" query: the connected component of same-`type`
surfaces reachable from `seed` by shared graph nodes.

### `property vtt.construction-session-port.CloudRequest.seed: ConstructionSurfaceKey`

### `property vtt.construction-session-port.CloudRequest.surfaceType: string`

### `interface vtt.construction-session-port.ConstructionCoveredRegion`

One existing region a footprint touches, with what a per-type rule needs to decide.

### `property vtt.construction-session-port.ConstructionCoveredRegion.centroid: ConstructionPosition`

World-space centroid; `y` is the height the face currently sits at.

### `property vtt.construction-session-port.ConstructionCoveredRegion.coverage: ConstructionCoverageKind`

### `property vtt.construction-session-port.ConstructionCoveredRegion.nodeIds: readonly string[]`

### `property vtt.construction-session-port.ConstructionCoveredRegion.physical: boolean`

### `property vtt.construction-session-port.ConstructionCoveredRegion.surfaceKey: ConstructionSurfaceKey`

### `property vtt.construction-session-port.ConstructionCoveredRegion.surfaceType: string`

### `interface vtt.construction-session-port.ConstructionNodeSnapshot`

### `property vtt.construction-session-port.ConstructionNodeSnapshot.id: string`

### `property vtt.construction-session-port.ConstructionNodeSnapshot.position: ConstructionPosition`

### `interface vtt.construction-session-port.ConstructionOrientedEdgeUse`

One boundary edge walked in a loop's own direction.

### `property vtt.construction-session-port.ConstructionOrientedEdgeUse.edgeId: string`

### `property vtt.construction-session-port.ConstructionOrientedEdgeUse.reversed: boolean`

### `interface vtt.construction-session-port.ConstructionPatch`

A whole generated patch: its nodes, its **shared** boundary edges, and the
faces over them.

The caller naming its own edges is the point, not the batching. A face
registered from a bare node cycle mints an edge per step named after that
face, so two faces sitting side by side get two different edges along the
line they visually share -- coincident, never connected, and the manifold
rule stays silent because each is used once. Naming the segment instead
lets both faces reference the same edge, which is what makes the result a
mesh and what gives ConstructionSessionPort.getUnfilledLoops a
free-versus-shared distinction to read.

### `property vtt.construction-session-port.ConstructionPatch.edges: readonly ConstructionPatchEdge[]`

### `property vtt.construction-session-port.ConstructionPatch.nodes: readonly { id: string; position: ConstructionPosition }[]`

### `property vtt.construction-session-port.ConstructionPatch.regions: readonly ConstructionPatchRegion[]`

### `interface vtt.construction-session-port.ConstructionPatchEdge`

One boundary segment of a generated patch, named by its caller.

`geometry` is optional and defaults to a straight chord, which is what
every flat-ground patch declares. It matters because a patch is the only
way a generator names a **shared** edge: an arc two faces meet along has
no other way to reach the graph curved, so a curved wall panel and its
neighbour would otherwise be forced back onto an unshared edge each.

### `property vtt.construction-session-port.ConstructionPatchEdge.edgeId: string`

### `property vtt.construction-session-port.ConstructionPatchEdge.endNodeId: string`

### `property vtt.construction-session-port.ConstructionPatchEdge.geometry?: ConstructionEdgeGeometry`

### `property vtt.construction-session-port.ConstructionPatchEdge.startNodeId: string`

### `interface vtt.construction-session-port.ConstructionPatchOutcome`

What ConstructionSessionPort.addPatch registered, and what it refused.

### `property vtt.construction-session-port.ConstructionPatchOutcome.affectedSurfaceKeys: readonly ConstructionSurfaceKey[]`

Surfaces whose mesh must be re-derived.

### `property vtt.construction-session-port.ConstructionPatchOutcome.createdNodeIds: readonly string[]`

### `property vtt.construction-session-port.ConstructionPatchOutcome.createdSurfaceKeys: readonly ConstructionSurfaceKey[]`

### `property vtt.construction-session-port.ConstructionPatchOutcome.removedNodeIds: readonly string[]`

Nodes the engine's own zero-orphan cleanup reclaimed.

### `property vtt.construction-session-port.ConstructionPatchOutcome.removedSurfaceKeys: readonly ConstructionSurfaceKey[]`

### `property vtt.construction-session-port.ConstructionPatchOutcome.skippedRegionIds: readonly string[]`

Faces left unregistered because their boundary had no room -- the ground
under them already has a face on both sides of an edge they wanted.
Reported rather than thrown: one refused face must not cost the whole
stroke.

### `interface vtt.construction-session-port.ConstructionPatchRegion`

One face of a generated patch, over edges the same request declares.

### `property vtt.construction-session-port.ConstructionPatchRegion.boundary: readonly ConstructionOrientedEdgeUse[]`

### `property vtt.construction-session-port.ConstructionPatchRegion.holes?: readonly (readonly ConstructionOrientedEdgeUse[])[]`

Inner loops this face is opened by -- a door, a window, any opening.
Absent means a solid face, which is what almost every patch declares.

An opening leaves one use free on every edge of its own rim, so a
second face can take that rim as its own boundary and stand in the
opening. Declaring both in one patch is the point: half of it is a
wall with an opening nobody is standing in.

### `property vtt.construction-session-port.ConstructionPatchRegion.physical: boolean`

### `property vtt.construction-session-port.ConstructionPatchRegion.regionId: string`

### `property vtt.construction-session-port.ConstructionPatchRegion.surfaceType: string`

### `interface vtt.construction-session-port.ConstructionPosition`

### `property vtt.construction-session-port.ConstructionPosition.x: number`

### `property vtt.construction-session-port.ConstructionPosition.y: number`

### `property vtt.construction-session-port.ConstructionPosition.z: number`

### `interface vtt.construction-session-port.ConstructionRegionEdge`

One edge of a region's boundary, with its walk direction already resolved.

### `property vtt.construction-session-port.ConstructionRegionEdge.edgeId: string`

### `property vtt.construction-session-port.ConstructionRegionEdge.endNodeId: string`

### `property vtt.construction-session-port.ConstructionRegionEdge.geometry: ConstructionEdgeGeometry`

### `property vtt.construction-session-port.ConstructionRegionEdge.reversed: boolean`

### `property vtt.construction-session-port.ConstructionRegionEdge.startNodeId: string`

### `interface vtt.construction-session-port.ConstructionRegionTopology`

One region's live boundary, in the engine's own deterministic order. That
ordering is the entire contract behind index-to-role mapping: the front
end asked for a specific generated shape, so it already knows what
`nodes[0]` means. Rust never tags a node or edge with a role.

### `property vtt.construction-session-port.ConstructionRegionTopology.holes: readonly (readonly ConstructionRegionEdge[])[]`

### `property vtt.construction-session-port.ConstructionRegionTopology.nodes: readonly ConstructionNodeSnapshot[]`

### `property vtt.construction-session-port.ConstructionRegionTopology.outerLoops: readonly (readonly ConstructionRegionEdge[])[]`

### `property vtt.construction-session-port.ConstructionRegionTopology.physical: boolean`

### `property vtt.construction-session-port.ConstructionRegionTopology.surfaceKey: ConstructionSurfaceKey`

### `property vtt.construction-session-port.ConstructionRegionTopology.surfaceType: string`

### `interface vtt.construction-session-port.ConstructionSessionPort`

Hides `grafting-procgen-construction-wasm`'s `ConstructionSession` ABI
(Rust panics are uncatchable on `wasm32-unknown-unknown`, so an adapter
must validate at this boundary, not rely on recovering from one) behind
app-owned types. Mirrors the whole session ABI, not only the slice the
current runtime wiring calls.

### `method vtt.construction-session-port.ConstructionSessionPort.addHole(request: { hole: readonly ConstructionOrientedEdgeUse[]; surfaceKey: ConstructionSurfaceKey }): RegionEditOutcome`

Opens one more inner loop on an existing face -- what a door or a
window is an opening for. The loop must already be registered, and it
keeps one free use per edge so a face can stand in it.

### `method vtt.construction-session-port.ConstructionSessionPort.addPatch(patch: ConstructionPatch): ConstructionPatchOutcome`

Registers a whole generated patch in one transaction -- see
ConstructionPatch for why a generator names its own edges.
Nodes, edges, and regions already present are skipped, not rejected: a
stroke overlapping an earlier one re-declares what they share, and that
must not mint a second copy.

### `method vtt.construction-session-port.ConstructionSessionPort.applyRegionOverlay(request: ApplyRegionOverlayRequest): ConstructionPatchOutcome`

Atomically overlays an application-generated patch onto exact source regions.

### `method vtt.construction-session-port.ConstructionSessionPort.classifyPoints(points: readonly (readonly [number, number])[]): readonly { index: number; surfaceKey: ConstructionSurfaceKey; surfaceType: string }[]`

Which of `points` already sit inside a region -- the per-point form of
getFootprintCoverage, for a generator deciding face by face
whether the ground under it is free. A stroke spanning both occupied and
open ground needs that distinction *within* its own area, which one
footprint-wide verdict cannot give.

Indexed back to the request; a point over open ground is simply absent.

### `method vtt.construction-session-port.ConstructionSessionPort.cloudFor(request: CloudRequest): CloudOutcome`

`ADR-0022`'s "cloud" query.

### `method vtt.construction-session-port.ConstructionSessionPort.deleteRegion(surfaceKey: ConstructionSurfaceKey): RegionEditOutcome`

Unregisters a region, leaving zero orphaned nodes or edges behind.

### `method vtt.construction-session-port.ConstructionSessionPort.dispose(): Promise<void>`

### `method vtt.construction-session-port.ConstructionSessionPort.duplicateRegion(request: { offset: ConstructionPosition; physical: boolean; suffix: string; surfaceKey: ConstructionSurfaceKey; surfaceType: string }): RegionEditOutcome`

Mints a parallel copy; the same `suffix` always reproduces the same copy.

### `method vtt.construction-session-port.ConstructionSessionPort.generateRegionPartition(request: GenerateRegionPartitionRequest): DiffOutcome`

### `method vtt.construction-session-port.ConstructionSessionPort.getAllRegionTopologies(): readonly ConstructionRegionTopology[]`

Every region's boundary -- the edit-mode bootstrap call.

### `method vtt.construction-session-port.ConstructionSessionPort.getAllSurfaceMeshes(): readonly SurfaceMeshResult[]`

Every currently-known surface's mesh -- the bootstrap/full-render call.

### `method vtt.construction-session-port.ConstructionSessionPort.getFootprintCoverage(polygon: readonly (readonly [number, number])[]): readonly ConstructionCoveredRegion[]`

What a footprint currently covers, before anything is generated -- the
creation-side counterpart to getRegionTopology. The engine
reports; `features/edit-construction`'s per-type table decides.

### `method vtt.construction-session-port.ConstructionSessionPort.getNodePositions(): readonly ConstructionNodeSnapshot[]`

Every node currently in the session with its live position -- what an
edit-mode caller needs to seed hit-testing/handle placement without
re-deriving positions from triangulated mesh data. Backed by the Wasm
session's own `snapshot_json`, which already carries node positions;
this method exposes only that slice (edges/surfaces are unused by any
caller so far).

### `method vtt.construction-session-port.ConstructionSessionPort.getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined`

One region's live boundary, or `undefined` for a stale key.

### `method vtt.construction-session-port.ConstructionSessionPort.getSurfaceMesh(surfaceKey: ConstructionSurfaceKey): readonly SurfaceMeshResult[]`

One surface's mesh piece(s), by key. Almost always one piece -- but an
analytic-region key (a merged path-brush source/target region) can
legitimately triangulate into several disjoint pieces (one per outer
loop), and every one of them must be rendered, not just the first.

### `method vtt.construction-session-port.ConstructionSessionPort.getUnfilledLoops(scope: readonly string[]): readonly ConstructionUnfilledLoop[]`

Every closed loop of boundary **among `scope`'s nodes** that another
such loop encloses and no face fills -- a hole in the surface whose rim
already exists.

Structural, not geometric: it reports only loops the registered edges
already close, never a gap guessed from proximity. Filling one adds no
edge and no node, because the boundary was there all along.

`scope` is the region the caller just touched, and narrowing to it is
what makes the answer right rather than merely cheap: free boundary
elsewhere on the map bounds shapes nobody is editing, and a courtyard
between two unrelated patches reads as a hole from every angle except
"did this stroke put it there". An empty scope reports nothing.

### `method vtt.construction-session-port.ConstructionSessionPort.insertVertex(request: { edgeId: string; firstEdgeId: string; nodeId: string; position: ConstructionPosition; secondEdgeId: string }): RegionEditOutcome`

Subdivides one boundary edge, minting a new node on it. Both fragments
keep the original's geometry description. Called twice on the same
original edge, this is also the whole of the "carve a movable notch"
case -- there is deliberately no separate cut primitive here.

### `method vtt.construction-session-port.ConstructionSessionPort.moveEdge(edgeId: string, delta: ConstructionPosition): RegionEditOutcome`

Moves both of an edge's endpoints as one rigid unit.

### `method vtt.construction-session-port.ConstructionSessionPort.moveRegion(surfaceKey: ConstructionSurfaceKey, delta: ConstructionPosition): RegionEditOutcome`

Moves every node on a region's boundary, holes included.

### `method vtt.construction-session-port.ConstructionSessionPort.moveVertex(nodeId: string, position: ConstructionPosition): RegionEditOutcome`

Moves one boundary node to an absolute position.

### `method vtt.construction-session-port.ConstructionSessionPort.redoRegionOverlay(operationId: string): void`

### `method vtt.construction-session-port.ConstructionSessionPort.removeHole(request: { index: number; surfaceKey: ConstructionSurfaceKey }): RegionEditOutcome`

Closes one of a face's openings back up, by index, reclaiming whatever rim nothing stands on anymore.

### `method vtt.construction-session-port.ConstructionSessionPort.removeSurface(request: RemoveSurfaceRequest): void`

Unregisters a surface outright -- no hole-repair, no cascading.

### `method vtt.construction-session-port.ConstructionSessionPort.removeVertex(nodeId: string, weldedEdgeId: string): RegionEditOutcome`

Welds a node's two neighboring edges into one -- `insertVertex`'s inverse.

### `method vtt.construction-session-port.ConstructionSessionPort.retypeEdge(edgeId: string, geometry: ConstructionEdgeGeometry): RegionEditOutcome`

Swaps one edge's geometry without touching either endpoint.

### `method vtt.construction-session-port.ConstructionSessionPort.start(): Promise<void>`

Loads the underlying Wasm module and starts an empty session. Every
other method requires this to have resolved first, mirroring
import("./scene-render-port.ts").SceneRenderPort's own
`start`/`dispose` lifecycle so a composition root awaits both the same
way.

### `method vtt.construction-session-port.ConstructionSessionPort.undoRegionOverlay(operationId: string): void`

### `interface vtt.construction-session-port.ConstructionSurfaceSpec`

### `property vtt.construction-session-port.ConstructionSurfaceSpec.cycle: readonly string[]`

### `property vtt.construction-session-port.ConstructionSurfaceSpec.physical: boolean`

### `property vtt.construction-session-port.ConstructionSurfaceSpec.surfaceType: string`

### `interface vtt.construction-session-port.ConstructionSweepParameters`

Declarative cross-section consumed by the generic Rust sweep.

### `property vtt.construction-session-port.ConstructionSweepParameters.miterLimit: number`

### `property vtt.construction-session-port.ConstructionSweepParameters.profile: readonly { elevation: number; lateralOffset: number }[]`

### `interface vtt.construction-session-port.ConstructionSweepPlan`

Graph-neutral result of a reusable Rust profile sweep.

### `property vtt.construction-session-port.ConstructionSweepPlan.boundary: readonly number[]`

### `property vtt.construction-session-port.ConstructionSweepPlan.curves?: readonly { from: number; geometry: ConstructionEdgeGeometry; to: number }[]`

The lengthwise edges that are curves rather than chords, by the pair of
vertices each runs between.

Sparse: a straight formation reports none. A curved one reports the arc
every offset of that stretch follows -- concentric, so one centre serves
the spine and both rims.

### `property vtt.construction-session-port.ConstructionSweepPlan.quads: readonly (readonly [number, number, number, number])[]`

### `property vtt.construction-session-port.ConstructionSweepPlan.referenceLine: readonly ConstructionPosition[]`

The stations the formation actually used, carrying the height each one rides at.

### `property vtt.construction-session-port.ConstructionSweepPlan.vertices: readonly ConstructionPosition[]`

### `interface vtt.construction-session-port.ConstructionUnfilledLoop`

A closed loop of boundary with no face on it -- a hole in the surface.

### `property vtt.construction-session-port.ConstructionUnfilledLoop.boundary: readonly ConstructionOrientedEdgeUse[]`

The loop's edges, each already oriented for the face that would fill it
-- opposite the single region still using it. Registrable verbatim.

### `property vtt.construction-session-port.ConstructionUnfilledLoop.centroid: ConstructionPosition`

### `property vtt.construction-session-port.ConstructionUnfilledLoop.neighbours: readonly { physical: boolean; surfaceType: string }[]`

The face on the far side of each boundary edge, in the loop's own walk
order and with repeats -- so a caller filling the gap can make it match
the ground around it instead of whatever the current brush happens to
be set to. Reported, never applied: the engine has no opinion on what a
gap should be made of.

### `property vtt.construction-session-port.ConstructionUnfilledLoop.nodeIds: readonly string[]`

### `interface vtt.construction-session-port.DiffOutcome`

Every `generate*` mutation shares this outcome shape: the whole
request's geometry was regenerated and diffed against whatever this
structure already held, and only the difference applied.

### `property vtt.construction-session-port.DiffOutcome.addedSurfaceKeys: readonly ConstructionSurfaceKey[]`

### `property vtt.construction-session-port.DiffOutcome.removedNodeIds: readonly string[]`

### `property vtt.construction-session-port.DiffOutcome.removedSurfaceKeys: readonly ConstructionSurfaceKey[]`

### `interface vtt.construction-session-port.GenerateRegionPartitionRequest`

One tick of a continuous cell-painting brush ("Pintar Casa," a
wall-brush stroke's closure): the stroke's *whole* current accumulated
cell set (not just what changed since the last tick), regenerated and
diffed against whatever this structure already holds every call. Cells
are auto-split into disjoint regions larger than `maxRegionCells`; every
region gets its own per-cell floor/ceiling and a wall along every
boundary run, notched where a run borders a neighboring region.

### `property vtt.construction-session-port.GenerateRegionPartitionRequest.ceilingType: string`

### `property vtt.construction-session-port.GenerateRegionPartitionRequest.cells: readonly CellCoordinate[]`

### `property vtt.construction-session-port.GenerateRegionPartitionRequest.cellSize: number`

### `property vtt.construction-session-port.GenerateRegionPartitionRequest.floorType: string`

### `property vtt.construction-session-port.GenerateRegionPartitionRequest.idPrefix: string`

Namespaces every id this call derives -- same stability contract as GeneratePathExtrusionRequest.idPrefix.

### `property vtt.construction-session-port.GenerateRegionPartitionRequest.maxRegionCells: number`

A connected region larger than this gets auto-split into more than one region.

### `property vtt.construction-session-port.GenerateRegionPartitionRequest.notchType: string`

### `property vtt.construction-session-port.GenerateRegionPartitionRequest.origin: ConstructionPosition`

### `property vtt.construction-session-port.GenerateRegionPartitionRequest.seed: number`

The same seed always reproduces the same split layout for the same cell set.

### `property vtt.construction-session-port.GenerateRegionPartitionRequest.wallHeight: number`

### `property vtt.construction-session-port.GenerateRegionPartitionRequest.wallType: string`

### `interface vtt.construction-session-port.RegionEditOutcome`

What one atomic region edit changed. Every op in the vocabulary reports
this same shape, so a caller batching a policy's primary op with its
cascade merges outcomes instead of branching per op -- see
`docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.

### `property vtt.construction-session-port.RegionEditOutcome.affectedSurfaceKeys: readonly ConstructionSurfaceKey[]`

Surfaces whose mesh must be re-derived.

### `property vtt.construction-session-port.RegionEditOutcome.createdNodeIds: readonly string[]`

### `property vtt.construction-session-port.RegionEditOutcome.createdSurfaceKeys: readonly ConstructionSurfaceKey[]`

### `property vtt.construction-session-port.RegionEditOutcome.removedNodeIds: readonly string[]`

Nodes the engine's own zero-orphan cleanup reclaimed.

### `property vtt.construction-session-port.RegionEditOutcome.removedSurfaceKeys: readonly ConstructionSurfaceKey[]`

### `interface vtt.construction-session-port.RemoveSurfaceRequest`

### `property vtt.construction-session-port.RemoveSurfaceRequest.surfaceKey: ConstructionSurfaceKey`

### `interface vtt.construction-session-port.SurfaceMeshResult`

### `property vtt.construction-session-port.SurfaceMeshResult.mesh: RenderMeshData`

### `property vtt.construction-session-port.SurfaceMeshResult.physical: boolean`

### `property vtt.construction-session-port.SurfaceMeshResult.surfaceKey: ConstructionSurfaceKey`

### `property vtt.construction-session-port.SurfaceMeshResult.surfaceType: string`

### `interface vtt.construction-session-port.SurfaceTransformationInvalidation`

Local derived-state refresh scope emitted by an atomic transformation.

### `property vtt.construction-session-port.SurfaceTransformationInvalidation.changedSurfaces: readonly ConstructionSurfaceKey[]`

### `property vtt.construction-session-port.SurfaceTransformationInvalidation.directDependencies: readonly ConstructionSurfaceKey[]`

### `property vtt.construction-session-port.SurfaceTransformationInvalidation.topologyRepairNeighbors: readonly ConstructionSurfaceKey[]`

### `interface vtt.construction-session-port.TransformationIdentityDelta`

Identity lifecycle emitted by an atomic surface transformation.

### `property vtt.construction-session-port.TransformationIdentityDelta.created: readonly TIdentity[]`

### `property vtt.construction-session-port.TransformationIdentityDelta.preserved: readonly TIdentity[]`

### `property vtt.construction-session-port.TransformationIdentityDelta.removed: readonly TIdentity[]`

### `property vtt.construction-session-port.TransformationIdentityDelta.replaced: readonly TIdentity[]`

### `type vtt.construction-session-port.ConstructionCoverageKind = "centroid" | "overlap"`

How a brush footprint touches one existing region.

Reported as data rather than resolved by the engine: a type that swaps
whole faces (terrain restacking onto itself) and a type that cuts (a path
carved through) need different rules from the very same answer.

### `type vtt.construction-session-port.ConstructionEdgeGeometry = { kind: "line" } | { center: readonly [number, number]; clockwise: boolean; kind: "arc" }`

A contour edge's explicit geometry. `"arc"`'s `center` is an XZ point in
the surface's own plane -- geometry lives per edge, so a tapering wall is
simply two edges with their own centers, not a special case.

### `type vtt.construction-session-port.ConstructionEdgeId = string`

### `type vtt.construction-session-port.ConstructionNodeId = string`

### `type vtt.construction-session-port.ConstructionSurfaceKey = readonly ConstructionNodeId[]`

A construction surface's canonical node-set identity, unordered.

### `interface vtt.scene-render-port.CameraControlHandle`

Detaches the camera controls a call to SceneRenderPort.attachCameraControls started.

### `method vtt.scene-render-port.CameraControlHandle.dispose(): void`

### `interface vtt.scene-render-port.CameraControlOptions`

How a view's camera responds to dragging and scrolling. Mirrors
`@grafting/render-3d`'s `attachOrbit` options one-for-one in spirit but is
defined locally, like every other type in this port -- the render port
MUST NOT expose the concrete renderer package (`VTT-ARCH-002`).

### `property vtt.scene-render-port.CameraControlOptions.orbitButton?: number`

Reserves one `PointerEvent.button` (0 = left, 1 = middle, 2 = right) for
orbit-drag. Leaving it unset lets any button orbit -- only correct for a
view with no competing left-button tool gesture on the same element.

### `property vtt.scene-render-port.CameraControlOptions.panButton?: number`

Enables a lateral pan gesture, bound to this button, independent of `orbitButton`.

### `property vtt.scene-render-port.CameraControlOptions.pivot?: "center" | "cursor"`

`"cursor"` re-centers each orbit-drag on the point under the pointer,
resolved the same way SceneRenderPort.pick already resolves a
hit. `"center"` (the default) keeps orbiting around wherever the camera
is already looking.

### `interface vtt.scene-render-port.RenderCovering`

The resolved visual fill a chunk was built for. Structurally mirrors
`entities/map`'s `SurfaceCovering` but is declared locally, matching how
RenderMeshData and RenderToken already keep this port free of
dependencies in either direction.

### `property vtt.scene-render-port.RenderCovering.color: number`

### `property vtt.scene-render-port.RenderCovering.key: string`

Batching identity. Surfaces sharing it may merge into one buffer; surfaces
that do not must not, because a merged buffer carries exactly one
appearance.

### `property vtt.scene-render-port.RenderCovering.kind: string`

### `interface vtt.scene-render-port.RenderDependencyRevision`

### `property vtt.scene-render-port.RenderDependencyRevision.layer: RenderLayerKey`

### `property vtt.scene-render-port.RenderDependencyRevision.revision: number`

### `property vtt.scene-render-port.RenderDependencyRevision.scopeId: string`

### `interface vtt.scene-render-port.RenderMapChunk`

### `property vtt.scene-render-port.RenderMapChunk.chunkId: string`

### `property vtt.scene-render-port.RenderMapChunk.covering: RenderCovering`

What fills this chunk visually. Resolved upstream, in the app's own
covering layer -- the render adapter draws it and decides nothing.

This replaced the chunk's former `surfaceType`/`physical` pair. Those were
construction classification, carried into the render port only so the
adapter could re-derive an appearance from them; once the appearance
arrives resolved, they had no consumer left. Dropping them also removes the
defect they enabled -- a merged chunk could only carry one classification,
so a bucket mixing surfaces silently rendered some of them as the wrong
thing.

### `property vtt.scene-render-port.RenderMapChunk.mesh: RenderMeshData`

### `interface vtt.scene-render-port.RenderMeshData`

Packed vertex data for one piece of map geometry. Defined locally rather
than imported from `@grafting/render-3d`, matching how RenderToken
already keeps this port renderer-agnostic.

### `property vtt.scene-render-port.RenderMeshData.indices?: Uint16Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>`

### `property vtt.scene-render-port.RenderMeshData.normals?: Float32Array<ArrayBufferLike>`

### `property vtt.scene-render-port.RenderMeshData.positions: Float32Array`

### `property vtt.scene-render-port.RenderMeshData.uvs?: Float32Array<ArrayBufferLike>`

### `interface vtt.scene-render-port.RenderNodeHandle`

A construction node's live world position, rendered as a small pickable handle -- what edit-mode picking/drag-to-move hit-tests against.

### `property vtt.scene-render-port.RenderNodeHandle.nodeId: string`

### `property vtt.scene-render-port.RenderNodeHandle.position: { x: number; y: number; z: number }`

### `interface vtt.scene-render-port.RenderSurfacePickTarget`

### `property vtt.scene-render-port.RenderSurfacePickTarget.mesh: RenderMeshData`

### `property vtt.scene-render-port.RenderSurfacePickTarget.surfaceRef: string`

### `interface vtt.scene-render-port.RenderToken`

### `property vtt.scene-render-port.RenderToken.appearance: { color: number; label: string; size: number }`

### `property vtt.scene-render-port.RenderToken.id: string`

### `property vtt.scene-render-port.RenderToken.position: { x: number; y: number; z: number }`

### `interface vtt.scene-render-port.ScenePickResult`

What a pointer position resolved to. `nodeId` is present only when the
pointer actually hit a node handle -- otherwise `point` alone (e.g. a hit
against map geometry) is still useful for continuing an in-progress drag
across the ground.

### `property vtt.scene-render-port.ScenePickResult.nodeId?: string`

### `property vtt.scene-render-port.ScenePickResult.point: { x: number; y: number; z: number }`

### `property vtt.scene-render-port.ScenePickResult.surfaceRef?: string`

Canonical surface identity when map geometry, rather than ground, was hit.

### `interface vtt.scene-render-port.SceneRenderMetrics`

### `property vtt.scene-render-port.SceneRenderMetrics.attachedViews: number`

### `property vtt.scene-render-port.SceneRenderMetrics.confirmedTokenChanges: number`

### `property vtt.scene-render-port.SceneRenderMetrics.rendererCreates: number`

### `property vtt.scene-render-port.SceneRenderMetrics.rendererDisposes: number`

### `property vtt.scene-render-port.SceneRenderMetrics.terrainUploads: number`

### `interface vtt.scene-render-port.SceneRenderPort`

### `method vtt.scene-render-port.SceneRenderPort.applyConfirmed(change: ConfirmedRenderChange): void`

### `method vtt.scene-render-port.SceneRenderPort.attachCameraControls(viewId: string, element: HTMLElement, options?: CameraControlOptions): CameraControlHandle`

Makes `element`'s drag/scroll gestures drive `viewId`'s camera, starting
from the framing that view was created with. Call once per view and hold
the returned handle for its lifetime, the same convention `attachView`
itself already follows -- calling this again on the same view resets to
that original framing rather than continuing from wherever the camera
currently is.

### `method vtt.scene-render-port.SceneRenderPort.attachView(target: HTMLElement): string`

### `method vtt.scene-render-port.SceneRenderPort.clearPreview(channel?: string): void`

Hides one channel, or every channel when none is named.

### `method vtt.scene-render-port.SceneRenderPort.detachView(viewId: string): void`

### `method vtt.scene-render-port.SceneRenderPort.dispose(): Promise<void>`

### `method vtt.scene-render-port.SceneRenderPort.getMetrics(): SceneRenderMetrics`

### `method vtt.scene-render-port.SceneRenderPort.pick(viewId: string, x: number, y: number): ScenePickResult | undefined`

Resolves a pointer position (in the view's CSS pixels) to what it hit, or `undefined` if it hit nothing.

### `method vtt.scene-render-port.SceneRenderPort.resizeView(viewId: string, width: number, height: number): void`

### `method vtt.scene-render-port.SceneRenderPort.setFloorClipHeight(height: number | undefined): void`

Sets the floor-cutaway height in continuous world-space Y. `undefined` disables cutaway.

### `method vtt.scene-render-port.SceneRenderPort.showPreview(descriptor: RenderPreviewDescriptor, channel?: string): void`

Shows (or replaces) one preview overlay.

`channel` names which overlay: two callers with different names coexist,
and the same name always replaces. A tool's own ghost is one channel; a
diagnostic overlay drawn alongside it is another, and neither has to know
the other exists. Omitted means the default channel, which is the
single-ghost behaviour every tool already relies on.

### `method vtt.scene-render-port.SceneRenderPort.start(runtimeGeneration: number): Promise<void>`

### `type vtt.scene-render-port.ChangeOrigin = "local" | "network" | "programmatic"`

### `type vtt.scene-render-port.ConfirmedMapChunkRenderChange = { causeId: string; chunk: RenderMapChunk; dependency: RenderDependencyRevision; origin: ChangeOrigin; runtimeGeneration: number; type: "map-chunk-upserted" } | { causeId: string; chunkId: string; dependency: RenderDependencyRevision; origin: ChangeOrigin; runtimeGeneration: number; type: "map-chunk-removed" }`

### `type vtt.scene-render-port.ConfirmedNodeHandleRenderChange = { causeId: string; dependency: RenderDependencyRevision; handle: RenderNodeHandle; origin: ChangeOrigin; runtimeGeneration: number; type: "node-handle-upserted" } | { causeId: string; dependency: RenderDependencyRevision; nodeId: string; origin: ChangeOrigin; runtimeGeneration: number; type: "node-handle-removed" }`

### `type vtt.scene-render-port.ConfirmedRenderChange = ConfirmedTokenRenderChange | ConfirmedMapChunkRenderChange | ConfirmedNodeHandleRenderChange | ConfirmedSurfacePickRenderChange`

### `type vtt.scene-render-port.ConfirmedSurfacePickRenderChange = { causeId: string; dependency: RenderDependencyRevision; origin: ChangeOrigin; runtimeGeneration: number; target: RenderSurfacePickTarget; type: "surface-pick-target-upserted" } | { causeId: string; dependency: RenderDependencyRevision; origin: ChangeOrigin; runtimeGeneration: number; surfaceRef: string; type: "surface-pick-target-removed" }`

### `type vtt.scene-render-port.ConfirmedTokenRenderChange = { causeId: string; dependency: RenderDependencyRevision; origin: ChangeOrigin; runtimeGeneration: number; token: RenderToken; type: "token-upserted" } | { causeId: string; dependency: RenderDependencyRevision; origin: ChangeOrigin; runtimeGeneration: number; tokenId: string; type: "token-removed" }`

### `type vtt.scene-render-port.RenderLayerKey = "tokens" | "terrain" | "handles" | "surface-picks"`

### `type vtt.scene-render-port.RenderPreviewDescriptor = { color: number; kind: "segments"; opacity?: number; positions: Float32Array } | { color: number; kind: "quad"; opacity?: number; positions: Float32Array } | { color: number; indices: Uint16Array | Uint32Array; kind: "mesh"; opacity?: number; positions: Float32Array }`

### `type vtt.scene-render-port.RenderViewId = string`

### `variable vtt.scene-render-port.TOOL_GHOST_PREVIEW_CHANNEL: "active"`

The channel a tool's own ghost is drawn on.

Named in the port rather than in the adapter because the dispatcher has to
clear *its* overlay without touching anyone else's: an unnamed clear empties
every channel, which is right for teardown and wrong on every pointer move.

### `interface vtt.terrain-noise-port.TerrainNoisePort`

A deterministic, seeded height-noise source -- what a procedural terrain
generator samples per-vertex to decide elevation. Kept as its own port
(not folded into `ConstructionSessionPort`) because it wraps a completely
separate Wasm module (`@grafting/procgen-generation-wasm`) with no shared
state: this is a pure function behind an async-init lifecycle, not a
stateful session.

### `method vtt.terrain-noise-port.TerrainNoisePort.generateHeightmap(width: number, height: number, seed: number, scale: number): Float32Array`

Samples a real Perlin-noise heightmap on a `width` x `height` grid,
seeded deterministically. Returns a flat row-major array of one height
value per cell, in Perlin's native `[-1, 1]` range. `scale` is the
distance between samples in the noise's own space -- smaller values
produce smoother, larger-scale features (useful range roughly `0.05`
to `0.2`, per the underlying Wasm binding's own doc comment).

### `method vtt.terrain-noise-port.TerrainNoisePort.start(): Promise<void>`

Loads the underlying Wasm module. Every other method requires this to have resolved first.

### `interface vtt.ui.ActionDockItem`

One primary category or tool action in the ActionDock.

### `property vtt.ui.ActionDockItem.active?: boolean`

Whether this tool/category is currently active.

### `property vtt.ui.ActionDockItem.childActive?: boolean`

Whether any child sub-item of this item is active.

### `property vtt.ui.ActionDockItem.className?: string`

Optional caller-owned class name.

### `property vtt.ui.ActionDockItem.disabled?: boolean`

Whether this item is non-interactive.

### `property vtt.ui.ActionDockItem.icon: ReactNode`

Caller-rendered icon.

### `property vtt.ui.ActionDockItem.key: string`

Stable identity of the tool or category.

### `property vtt.ui.ActionDockItem.label: string`

Visible label or accessible title.

### `property vtt.ui.ActionDockItem.onClick?: () => void`

Invoked when this item is clicked.

### `property vtt.ui.ActionDockItem.shortcut?: string`

Keyboard shortcut hint (e.g. "B", "W", "P", "T").

### `property vtt.ui.ActionDockItem.subItems?: readonly ActionDockSubItem[]`

Optional sub-tools revealed above this button when it is active.

### `property vtt.ui.ActionDockItem.tooltip?: string`

Tooltip description.

### `interface vtt.ui.ActionDockProps`

Public inputs for the generic ActionDock bottom toolbar organism.

### `property vtt.ui.ActionDockProps.ariaLabel?: string`

Accessible name for the toolbar region.

### `property vtt.ui.ActionDockProps.className?: string`

Optional caller-owned class name applied to the outer wrapper.

### `property vtt.ui.ActionDockProps.items: readonly ActionDockItem[]`

Primary construction verbs / categories in display order.

### `property vtt.ui.ActionDockProps.leadingAccessories?: ReactNode`

Optional leading accessories rendered alongside the items.

### `property vtt.ui.ActionDockProps.style?: CSSProperties`

Optional inline style override for the outer wrapper.

### `property vtt.ui.ActionDockProps.trailingAccessories?: ReactNode`

Optional trailing accessories rendered alongside the items.

### `interface vtt.ui.ActionDockSubItem`

One sub-action or variant inside an active ActionDockItem.

### `property vtt.ui.ActionDockSubItem.active?: boolean`

Whether this sub-item is currently active.

### `property vtt.ui.ActionDockSubItem.className?: string`

Optional caller-owned class name.

### `property vtt.ui.ActionDockSubItem.disabled?: boolean`

Whether this sub-item is disabled.

### `property vtt.ui.ActionDockSubItem.icon?: ReactNode`

Caller-rendered icon.

### `property vtt.ui.ActionDockSubItem.key: string`

Stable identity of the sub-item.

### `property vtt.ui.ActionDockSubItem.label: string`

Visible label or accessible title.

### `property vtt.ui.ActionDockSubItem.onClick?: () => void`

Invoked when this sub-item is clicked.

### `property vtt.ui.ActionDockSubItem.shortcut?: string`

Keyboard shortcut hint (e.g. "1", "2", "Shift+W").

### `property vtt.ui.ActionDockSubItem.tooltip?: string`

Tooltip description.

### `interface vtt.ui.ButtonProps`

Public inputs for a compact, clickable action.

### `property vtt.ui.ButtonProps.className?: string`

Optional caller-owned class name for layout composition.

### `property vtt.ui.ButtonProps.label: string`

Human-readable button label.

### `property vtt.ui.ButtonProps.onClick?: () => void`

Invoked when the button is activated.

### `property vtt.ui.ButtonProps.tone?: "default" | "accent"`

Optional semantic emphasis.

### `interface vtt.ui.CardProps`

Public inputs for the smallest reusable bounded surface: a generic card.

### `property vtt.ui.CardProps.accentColor?: string`

Optional accent used for the card boundary.

### `property vtt.ui.CardProps.ariaLabel?: string`

Optional accessible name for the card.

### `property vtt.ui.CardProps.backgroundColor?: string`

Optional background color for the card surface.

### `property vtt.ui.CardProps.borderRadius?: number`

Optional rounded-corner radius in CSS pixels.

### `property vtt.ui.CardProps.borderWidth?: number`

Optional boundary width in CSS pixels.

### `property vtt.ui.CardProps.children: ReactNode`

Caller-owned content rendered inside the card.

### `property vtt.ui.CardProps.className?: string`

Optional caller-owned class name for layout composition.

### `property vtt.ui.CardProps.fillContainer?: boolean`

Whether the card occupies the complete width and height of its container.

### `property vtt.ui.CardProps.glowColor?: string`

Optional glow color rendered as an outer shadow, e.g. to signal live status.

### `property vtt.ui.CardProps.interactive?: boolean`

Whether the card should communicate pointer interaction.

### `property vtt.ui.CardProps.padding?: number`

Optional padding in CSS pixels.

### `property vtt.ui.CardProps.selected?: boolean`

Whether the card displays its selected treatment.

### `property vtt.ui.CardProps.selectedColor?: string`

Optional boundary color used when the card is selected.

### `property vtt.ui.CardProps.shape?: CardShape`

Geometric outline of the card; defaults to a rounded rectangle.

### `interface vtt.ui.CollapsePanel`

One collapsible section.

### `property vtt.ui.CollapsePanel.content: ReactNode`

Section content, shown when expanded.

### `property vtt.ui.CollapsePanel.header: string`

Section header, always visible.

### `property vtt.ui.CollapsePanel.key: string`

Stable identity within the list, and what `defaultActiveKeys` names.

### `interface vtt.ui.CollapseProps`

Public inputs for a set of stacked, individually collapsible sections.

### `property vtt.ui.CollapseProps.bordered?: boolean`

Whether the whole set draws its own outer border and panel background.
Set to `false` when this sits inside a surface that already provides
its own boundary (e.g. a Drawer) -- left `true`, both frame the
same content and it reads as boxed twice.

### `property vtt.ui.CollapseProps.className?: string`

Optional caller-owned class name for layout composition.

### `property vtt.ui.CollapseProps.defaultActiveKeys?: readonly string[]`

Which panel keys start expanded. Defaults to every panel's own key, i.e. all expanded.

### `property vtt.ui.CollapseProps.panels: readonly CollapsePanel[]`

The sections, in display order.

### `interface vtt.ui.DescriptionItem`

One label-value row.

### `property vtt.ui.DescriptionItem.key: string`

Stable identity within the list.

### `property vtt.ui.DescriptionItem.label: string`

Row label.

### `property vtt.ui.DescriptionItem.value: ReactNode`

Row value, plain text or caller-rendered content.

### `interface vtt.ui.DescriptionsProps`

Public inputs for a compact label-value grid.

### `property vtt.ui.DescriptionsProps.className?: string`

Optional caller-owned class name for layout composition.

### `property vtt.ui.DescriptionsProps.column?: number`

How many label-value pairs sit per row.

### `property vtt.ui.DescriptionsProps.items: readonly DescriptionItem[]`

The rows to display, in order.

### `interface vtt.ui.DrawerProps`

Public inputs for a panel that slides in from a screen edge.

### `property vtt.ui.DrawerProps.children: ReactNode`

Content rendered inside the drawer body.

### `property vtt.ui.DrawerProps.className?: string`

Optional caller-owned class name for layout composition.

### `property vtt.ui.DrawerProps.onClose: () => void`

Invoked when the drawer requests to close, e.g. its own close button or Escape.

### `property vtt.ui.DrawerProps.open: boolean`

Whether the drawer is currently shown.

### `property vtt.ui.DrawerProps.placement?: "bottom" | "top" | "left" | "right"`

Which screen edge the drawer slides in from.

### `property vtt.ui.DrawerProps.size?: number`

Drawer width (for `left`/`right` placement) or height (for `top`/`bottom`), in CSS pixels.

### `property vtt.ui.DrawerProps.title?: string`

Optional header text shown above the content.

### `interface vtt.ui.EdgeHandleProps`

Public inputs for a small handle fused to one edge of a panel, toggling it open/closed.

### `property vtt.ui.EdgeHandleProps.className?: string`

Optional caller-owned class name for layout composition.

### `property vtt.ui.EdgeHandleProps.edge: "left" | "right"`

Which edge of the panel the handle protrudes from -- `"right"` bulges
rightward (for a panel anchored to the screen's left edge), `"left"`
bulges leftward (for a panel anchored to the right edge).

### `property vtt.ui.EdgeHandleProps.onClick: () => void`

Invoked on a plain tap/click (movement below the drag threshold) or a keyboard activation. Never called for a real drag -- use `onDragEnd` for that.

### `property vtt.ui.EdgeHandleProps.onDrag?: (deltaX: number) => void`

Optional drag reporting. Once a press moves past a small threshold,
`onDrag` fires on every subsequent move with the horizontal offset (in
pixels, signed) from where the press started, and `onDragEnd` fires
once on release with the final offset -- a caller (e.g. `SlidingPanel`)
uses these to let the panel itself track the pointer 1:1 while
dragging. A press that never crosses the threshold is a plain tap and
only calls `onClick`; provide both callbacks together or neither.

### `property vtt.ui.EdgeHandleProps.onDragEnd?: (deltaX: number) => void`

Fires once on release, only after a real drag (see `onDrag`).

### `property vtt.ui.EdgeHandleProps.open: boolean`

Whether the panel this handle belongs to is currently open.

### `property vtt.ui.EdgeHandleProps.style?: CSSProperties`

Optional caller-owned inline style, e.g. to place this handle at a specific position.

### `property vtt.ui.EdgeHandleProps.title: string`

Tooltip and accessible name.

### `interface vtt.ui.FloatButtonGroupProps`

Public inputs for a cluster of floating actions, either collapsed behind one trigger or always visible as a plain row/column.

### `property vtt.ui.FloatButtonGroupProps.alwaysExpanded?: boolean`

Skips the collapsible trigger entirely -- every item renders directly,
always visible, with no separate open/close button. Use this for a
plain always-on toolbar rather than a Foundry-style "tap to reveal"
menu.

### `property vtt.ui.FloatButtonGroupProps.className?: string`

Optional caller-owned class name for layout composition.

### `property vtt.ui.FloatButtonGroupProps.icon?: ReactNode`

The trigger's own icon, shown when the group is collapsed. Unused when `alwaysExpanded` is set -- there is no trigger to show it on.

### `property vtt.ui.FloatButtonGroupProps.items: readonly FloatButtonItem[]`

The actions revealed when the group is open, in display order.

### `property vtt.ui.FloatButtonGroupProps.onOpenChange?: (open: boolean) => void`

Invoked with the group's next open state, e.g. on an outside click or its own trigger.

### `property vtt.ui.FloatButtonGroupProps.open?: boolean`

Controlled open state, together with `trigger` -- required to close the
group programmatically, e.g. after an item's own `onClick` fires, since
Ant Design does not do that on its own. Uncontrolled (starts collapsed,
closes only on its own trigger/outside click) when omitted. Ignored
when `alwaysExpanded` is set.

### `property vtt.ui.FloatButtonGroupProps.placement?: "bottom" | "top" | "left" | "right"`

Which side the group expands toward from the trigger -- `"top"`/`"bottom"`
stack items in a vertical column, `"left"`/`"right"` lay them out in a
horizontal row. When `alwaysExpanded` is set, this only picks the row's
axis (vertical for `"top"`/`"bottom"`, horizontal for `"left"`/`"right"`),
since there is no trigger to expand away from.

### `property vtt.ui.FloatButtonGroupProps.shape?: "circle" | "square"`

Outline. `"square"` renders the items as one joined, gapless block
(Ant Design's own compact-group styling) instead of separate floating
circles -- the trigger itself, which becomes the close control once
open, always renders as its own separate element outside that block.
Ignored (no joined styling) when `alwaysExpanded` is set.

### `property vtt.ui.FloatButtonGroupProps.style?: CSSProperties`

Optional caller-owned inline style, e.g. to place this group's trigger at a specific fixed position.

### `property vtt.ui.FloatButtonGroupProps.trigger?: "click" | "hover"`

Whether the group opens on click or hover. Ignored when `alwaysExpanded`
is set.

### `interface vtt.ui.FloatButtonItem`

One action inside a FloatButtonGroup.

### `property vtt.ui.FloatButtonItem.disabled?: boolean`

Renders this item non-interactive.

### `property vtt.ui.FloatButtonItem.icon: ReactNode`

Caller-rendered icon content. Vendor-neutral -- this molecule never ships its own icon set.

### `property vtt.ui.FloatButtonItem.key: string`

Stable identity within the list.

### `property vtt.ui.FloatButtonItem.onClick?: () => void`

Invoked when this item is activated.

### `property vtt.ui.FloatButtonItem.tone?: "primary" | "default"`

Emphasis, e.g. to mark the currently-active item in a tool selector.

### `property vtt.ui.FloatButtonItem.tooltip: string`

Tooltip and accessible name -- a float button shows no visible text label of its own.

### `interface vtt.ui.FloatButtonProps`

Public inputs for a single floating action, independent of any group.

### `property vtt.ui.FloatButtonProps.className?: string`

Optional caller-owned class name for layout composition.

### `property vtt.ui.FloatButtonProps.disabled?: boolean`

Renders this button non-interactive.

### `property vtt.ui.FloatButtonProps.icon: ReactNode`

Caller-rendered icon content. Vendor-neutral -- this atom never ships its own icon set.

### `property vtt.ui.FloatButtonProps.onClick?: () => void`

Invoked when this button is activated.

### `property vtt.ui.FloatButtonProps.shape?: "circle" | "square"`

Outline. `"square"` reads as part of a joined block -- pair it with a
`FloatButtonGroup` molecule using the same shape so the two visually
belong together.

### `property vtt.ui.FloatButtonProps.style?: CSSProperties`

Optional caller-owned inline style, e.g. to place this button at a specific fixed position.

### `property vtt.ui.FloatButtonProps.tone?: "primary" | "default"`

Emphasis. `"primary"` is the right choice for a button that opens a
panel rather than firing a direct action, so it reads as distinct from
a same-row action cluster.

### `property vtt.ui.FloatButtonProps.tooltip: string`

Tooltip and accessible name -- a float button shows no visible text label of its own.

### `interface vtt.ui.FloatButtonTreeBranch`

A branch: its own floating trigger, revealing a nested list of further FloatButtonTreeNodes -- leaves, or further branches.

### `property vtt.ui.FloatButtonTreeBranch.children: readonly FloatButtonTreeNode[]`

The nodes revealed when this branch opens, in display order.

### `property vtt.ui.FloatButtonTreeBranch.disabled?: boolean`

Renders this branch's own trigger non-interactive.

### `property vtt.ui.FloatButtonTreeBranch.icon: ReactNode`

Caller-rendered icon content. Vendor-neutral -- this organism never ships its own icon set.

### `property vtt.ui.FloatButtonTreeBranch.key: string`

Stable identity among its siblings.

### `property vtt.ui.FloatButtonTreeBranch.onClick?: undefined`

Absent on a branch -- a branch opens its `children`, it does not fire a direct action.

### `property vtt.ui.FloatButtonTreeBranch.placement?: FloatButtonTreePlacement`

Overrides the tree-level default expand direction for this branch's own submenu.

### `property vtt.ui.FloatButtonTreeBranch.siblingMode?: FloatButtonTreeSiblingMode`

Overrides the tree-level default sibling behavior among this branch's own children.

### `property vtt.ui.FloatButtonTreeBranch.tone?: "primary" | "default"`

Emphasis, e.g. to mark the currently-active branch in a selector.

### `property vtt.ui.FloatButtonTreeBranch.tooltip: string`

Tooltip and accessible name -- a float button shows no visible text label of its own.

### `property vtt.ui.FloatButtonTreeBranch.trigger?: FloatButtonTreeTrigger`

Overrides the tree-level default trigger for this branch's own submenu.

### `interface vtt.ui.FloatButtonTreeLeaf`

A direct action -- the tree's equivalent of a leaf node.

### `property vtt.ui.FloatButtonTreeLeaf.children?: undefined`

Absent on a leaf -- its presence (not its value) is what distinguishes a FloatButtonTreeBranch from a leaf.

### `property vtt.ui.FloatButtonTreeLeaf.disabled?: boolean`

Renders this leaf non-interactive.

### `property vtt.ui.FloatButtonTreeLeaf.icon: ReactNode`

Caller-rendered icon content. Vendor-neutral -- this organism never ships its own icon set.

### `property vtt.ui.FloatButtonTreeLeaf.key: string`

Stable identity among its siblings.

### `property vtt.ui.FloatButtonTreeLeaf.onClick: () => void`

Invoked when this leaf is activated. Closes the whole tree afterward, like choosing a menu action.

### `property vtt.ui.FloatButtonTreeLeaf.tone?: "primary" | "default"`

Emphasis, e.g. to mark the currently-active leaf in a selector.

### `property vtt.ui.FloatButtonTreeLeaf.tooltip: string`

Tooltip and accessible name -- a float button shows no visible text label of its own.

### `interface vtt.ui.FloatButtonTreeProps`

Public inputs for a tree of floating-button groups -- a group whose items can themselves be groups.

### `property vtt.ui.FloatButtonTreeProps.className?: string`

Optional caller-owned class name for the tree's own root position wrapper.

### `property vtt.ui.FloatButtonTreeProps.placement?: FloatButtonTreePlacement`

Default submenu expand direction for every branch that does not set its own.

### `property vtt.ui.FloatButtonTreeProps.root: FloatButtonTreeBranch`

The tree's single entry point. Always a branch: a tree with nothing to expand is just a `FloatButton`.

### `property vtt.ui.FloatButtonTreeProps.shape?: "circle" | "square"`

Outline for every button in the tree.

### `property vtt.ui.FloatButtonTreeProps.siblingMode?: FloatButtonTreeSiblingMode`

Default sibling behavior for every branch that does not set its own.

### `property vtt.ui.FloatButtonTreeProps.style?: CSSProperties`

Optional caller-owned inline style, e.g. to fix the tree's root to a corner of the screen.

### `property vtt.ui.FloatButtonTreeProps.trigger?: FloatButtonTreeTrigger`

Default submenu trigger for every branch that does not set its own.

### `interface vtt.ui.IconButtonProps`

Public inputs for a compact, icon-first action or toggle.

### `property vtt.ui.IconButtonProps.className?: string`

Optional caller-owned class name for layout composition.

### `property vtt.ui.IconButtonProps.disabled?: boolean`

Whether the button rejects interaction.

### `property vtt.ui.IconButtonProps.icon: ReactNode`

Caller-rendered icon content (glyph, emoji, or inline SVG). Vendor-neutral
on purpose -- this atom never ships its own icon set.

### `property vtt.ui.IconButtonProps.label?: string`

Optional visible label rendered beside the icon. Icon-only when omitted.

### `property vtt.ui.IconButtonProps.onClick?: () => void`

Invoked when the button is activated.

### `property vtt.ui.IconButtonProps.selected?: boolean`

Whether the button displays its selected/active treatment.

### `property vtt.ui.IconButtonProps.title: string`

Accessible name and hover tooltip. Required when `label` is omitted, since an icon-only button has no other text content.

### `interface vtt.ui.PopoverProps`

Public inputs for a small floating panel anchored to a trigger element.

### `property vtt.ui.PopoverProps.anchor: ReactNode`

The element the popover positions itself against.

### `property vtt.ui.PopoverProps.children: ReactNode`

Content rendered inside the popover body.

### `property vtt.ui.PopoverProps.className?: string`

Optional caller-owned class name for layout composition.

### `property vtt.ui.PopoverProps.onClose: () => void`

Invoked when the popover requests to close, e.g. an outside click or Escape.

### `property vtt.ui.PopoverProps.open: boolean`

Whether the popover is currently shown.

### `property vtt.ui.PopoverProps.placement?: "bottom" | "top" | "left" | "right"`

Which side of `anchor` the popover opens toward.

### `property vtt.ui.PopoverProps.title?: string`

Optional header text shown above the content.

### `interface vtt.ui.SelectableChipProps`

Public inputs for a small, toggleable choice within a set of options.

### `property vtt.ui.SelectableChipProps.className?: string`

Optional caller-owned class name for layout composition.

### `property vtt.ui.SelectableChipProps.label: string`

Human-readable choice label.

### `property vtt.ui.SelectableChipProps.onSelect?: (selected: boolean) => void`

Invoked when the chip is activated. Receives the chip's own next selected state, matching Ant Design's `CheckableTag` convention.

### `property vtt.ui.SelectableChipProps.selected?: boolean`

Whether this chip is the active choice.

### `property vtt.ui.SelectableChipProps.swatchColor?: string`

Optional color swatch rendered before the label, e.g. a material preview.

### `interface vtt.ui.SlidingPanelProps`

Public inputs for a panel anchored to one screen edge that slides fully off-screen when closed.

### `property vtt.ui.SlidingPanelProps.children: ReactNode`

The panel's own content.

### `property vtt.ui.SlidingPanelProps.className?: string`

Caller-owned class name for the panel's own container (use this for background, shadows, borders).

### `property vtt.ui.SlidingPanelProps.edge: "left" | "right"`

Which screen edge the panel is anchored to.

### `property vtt.ui.SlidingPanelProps.handleCloseLabel?: string`

Tooltip/Aria label for the handle when the panel is closed.

### `property vtt.ui.SlidingPanelProps.handleOpenLabel?: string`

Tooltip/Aria label for the handle when the panel is open.

### `property vtt.ui.SlidingPanelProps.onOpenChange: (open: boolean) => void`

Invoked with the panel's next open state, from a tap or a drag past the midpoint.

### `property vtt.ui.SlidingPanelProps.open: boolean`

Whether the panel is currently open.

### `property vtt.ui.SlidingPanelProps.style?: CSSProperties`

Caller-owned inline style, merged onto the panel's own container.

### `property vtt.ui.SlidingPanelProps.width: number`

Panel width in pixels.

### `property vtt.ui.SlidingPanelProps.zIndex?: number`

Stacking order for the panel's own fixed container.

### `interface vtt.ui.StatusBadgeProps`

Public inputs for a compact semantic status indicator.

### `property vtt.ui.StatusBadgeProps.className?: string`

Optional caller-owned class name for layout composition.

### `property vtt.ui.StatusBadgeProps.label: string`

Human-readable status label.

### `property vtt.ui.StatusBadgeProps.status: UiStatus`

Semantic state to present.

### `type vtt.ui.FloatButtonTreeNode = FloatButtonTreeLeaf | FloatButtonTreeBranch`

One node of a FloatButtonTree: either a leaf action or a branch with its own nested children.

### `function vtt.ui.ActionDock(props: ActionDockProps): ReactElement`

A generic bottom action dock organism.

Renders an accessible toolbar of primary actions with optional expandable
sub-action rows positioned horizontally above active items.

All visual identity (theming, colors, glassmorphism, sketch styles) is owned
by the consuming application via CSS classes (`.grafting-action-dock`,
`.grafting-action-dock__item`, etc.).

### `function vtt.ui.Button(props: ButtonProps): ReactElement`

Compact action button for lightweight command triggers.

### `function vtt.ui.Card(props: CardProps): ReactElement`

Dependency-free bounded surface with replaceable accent and selection styles.

### `function vtt.ui.Collapse(props: CollapseProps): ReactElement`

Several named sections stacked in one surface, each independently
expandable -- the right shape for a settings/inspector panel with more
than one topic, where stacking a separate Card per topic would
double the framing (the panel this sits inside, e.g. a Drawer,
already provides the outer boundary).

### `function vtt.ui.Descriptions(props: DescriptionsProps): ReactElement`

A read-only label-value grid -- the right shape for an inspector or a
metrics panel, where Card (a bounded, bordered surface meant to
stand alone, e.g. in a gallery grid) adds a frame this content does not
need, especially when several of these already sit inside another bounded
surface like Drawer or a Collapse panel.

### `function vtt.ui.Drawer(props: DrawerProps): ReactElement`

An edge-sliding settings/inspector panel, built on Ant Design's own
`Drawer`. Non-modal by default (no backdrop, no interaction lock on the
rest of the page) -- the common case for a persistent settings panel
beside a live 3D viewport, where blocking the scene behind it would be
unwanted.

### `function vtt.ui.EdgeHandle(props: EdgeHandleProps): ReactElement`

A half-round tab fused to one edge of a panel -- rounded on the side
facing away from the panel, flat on the side touching it, so it reads as
grown out of the panel rather than a separate floating control. Toggles
the panel open/closed on tap; optionally reports raw drag deltas so a
caller can let the panel itself be pulled open/closed, not just clicked.
No library ships this shape (confirmed by research before building it --
shadcn/ui's `SidebarRail` is the closest published pattern, but it is a
full-height drag rail on a Tailwind/Radix stack this project does not
use, not this shape). Hand-built CSS is the right size of solution here:
one small shape, no dependency.

### `function vtt.ui.FloatButton(props: FloatButtonProps): ReactElement`

One floating action, standalone -- the right shape for a corner-fixed
trigger like a settings-panel toggle, or a `Popover`/`Drawer` anchor whose
behavior (opens a panel) does not belong inside a `FloatButtonGroup`
molecule's list of direct actions.

### `function vtt.ui.FloatButtonGroup(props: FloatButtonGroupProps): ReactElement`

A cluster of floating actions -- either collapsed behind one trigger
(Ant Design's own `FloatButton.Group`, for a Foundry-style tool menu: a
category button that reveals its own sub-items) or, with `alwaysExpanded`,
a plain always-visible row/column of the same items with no trigger at
all. The atom `FloatButton` remains the right choice for a single
standalone action; this molecule is for a *cluster*.

The collapsed path renders its items as Ant Design's own `FloatButton`
directly, not this package's `FloatButton` atom -- `FloatButton.Group`
recognizes its children by that exact component reference to apply
group-item styling and layout, and a wrapping component in between breaks
that recognition silently (the group renders, but its items lose the
group's own positioning and behavior). The `alwaysExpanded` path has no
such constraint (no `FloatButton.Group` involved), but uses the same
direct `AntFloatButton` reference for consistency.

### `function vtt.ui.FloatButtonTree(props: FloatButtonTreeProps): ReactElement`

A tree of floating-button groups: a root trigger reveals a floating list
of items, any of which can itself be a branch with its own nested list
-- "a group of groups". Generic and product-agnostic: every node is
plain data (an action, or an icon/tooltip plus more nodes), nothing here
names a product concept.

Built on `@floating-ui/react` (MIT, the maintained successor to Popper.js)
rather than hand-rolled, specifically for its `FloatingTree` primitive:
coordinating open/close state, dismissal, and positioning across an
arbitrarily nested set of floating elements is exactly the hard part a
library should own. The event-coordination pattern here (a branch
announces opening via `tree.events` so accordion siblings close, a leaf
click announces closing the whole tree) mirrors Floating UI's own
reference nested-menu implementation
(`packages/react/test/visual/components/Menu.tsx` in their monorepo),
simplified: no roving-tabindex list navigation or typeahead, since this
is a cluster of buttons, not a full ARIA menu widget.

Every branch's trigger mode (`"click"` | `"hover"`) and sibling behavior
(`"accordion"` | `"multiple"`) default from this component's own props
but can be overridden per branch node, so one tree can mix e.g.
click-to-open categories with hover-to-open sub-items.

### `function vtt.ui.IconButton(props: IconButtonProps): ReactElement`

Compact icon-first action button with an explicit selected state, for
toolbars, rails, and hotbars where a text-label Button would not
fit -- backed by the same Ant Design button as Button, with
Grafting owning the selected-state boundary color rather than trusting a
vendor theme default.

### `function vtt.ui.lerp(min: number, max: number, fraction: number): number`

Linear interpolation: `fraction` of the way from `min` to `max`.

### `function vtt.ui.mulberry32(seed: number): () => number`

A small, self-contained PRNG (mulberry32) rather than `Math.random` --
seeded deterministically, so the same seed always produces the same
sequence. That is what makes procedural visual variation (a room's shape,
a scatter of instances, a jittered grid) reproducible in tests and
replayable across a reload, instead of flaky.

### `function vtt.ui.Popover(props: PopoverProps): ReactElement`

Dismissible floating content anchored to a trigger element -- e.g. a
shape/material picker opened from a toolbar button -- built on Ant
Design's own `Popover` rather than a hand-positioned overlay, since
anchor-relative placement (including flipping when it would overflow the
viewport) is exactly what that vendor primitive already solves.

### `function vtt.ui.SelectableChip(props: SelectableChipProps): ReactElement`

One toggleable choice in a small set -- e.g. a material or preset picker --
built on Ant Design's `Tag.CheckableTag` rather than a bare `Tag`, since the
selectable behavior (not just the visual chip shape) is exactly what that
vendor primitive already models.

### `function vtt.ui.SlidingPanel(props: SlidingPanelProps): ReactElement`

A generic panel fixed to one edge of the screen that slides fully off-screen when
closed and back into view when open, with an EdgeHandle fused to
its edge as the drag/toggle control.

### `function vtt.ui.StatusBadge(props: StatusBadgeProps): ReactElement`

Semantic status marker with Grafting-owned status names.

### `interface vtt.widgets.ConstructionDockProps`

### `property vtt.widgets.ConstructionDockProps.activeTool: ConstructionToolId`

### `property vtt.widgets.ConstructionDockProps.canRedo: boolean`

### `property vtt.widgets.ConstructionDockProps.canUndo: boolean`

### `property vtt.widgets.ConstructionDockProps.onRedo: () => void`

### `property vtt.widgets.ConstructionDockProps.onSnapToGridChange: (snap: boolean) => void`

### `property vtt.widgets.ConstructionDockProps.onToggleSettings?: () => void`

### `property vtt.widgets.ConstructionDockProps.onToolChange: (tool: ConstructionToolId) => void`

### `property vtt.widgets.ConstructionDockProps.onUndo: () => void`

### `property vtt.widgets.ConstructionDockProps.ready: boolean`

### `property vtt.widgets.ConstructionDockProps.settingsOpen?: boolean`

### `property vtt.widgets.ConstructionDockProps.snapToGrid: boolean`

### `interface vtt.widgets.ConstructionHotbarProps`

### `property vtt.widgets.ConstructionHotbarProps.activeTool: ConstructionToolId`

### `property vtt.widgets.ConstructionHotbarProps.onToolChange: (tool: ConstructionToolId) => void`

### `property vtt.widgets.ConstructionHotbarProps.ready: boolean`

### `interface vtt.widgets.ConstructionToolParamsPanelProps`

### `property vtt.widgets.ConstructionToolParamsPanelProps.activeTool: ConstructionToolId`

### `property vtt.widgets.ConstructionToolParamsPanelProps.onParamsChange: (toolId: Id, next: ToolParamsByTool[Id]) => void`

### `property vtt.widgets.ConstructionToolParamsPanelProps.params: ToolParamsByTool`

### `interface vtt.widgets.SelectedNodeInfo`

### `property vtt.widgets.SelectedNodeInfo.id: string`

### `property vtt.widgets.SelectedNodeInfo.point: { x: number; y: number; z: number }`

A plain `{x,y,z}` shape rather than importing `ConstructionPosition` -- `widgets/` may not import `ports` (see `test/architecture-boundaries.test.mjs`), and this widget only ever reads three numbers.

### `interface vtt.widgets.SettingsDrawerProps`

### `property vtt.widgets.SettingsDrawerProps.activeTool: ConstructionToolId`

### `property vtt.widgets.SettingsDrawerProps.onOpenChange?: (open: boolean) => void`

### `property vtt.widgets.SettingsDrawerProps.onToolParamsChange: (toolId: Id, next: ToolParamsByTool[Id]) => void`

### `property vtt.widgets.SettingsDrawerProps.open?: boolean`

### `property vtt.widgets.SettingsDrawerProps.selectedNodeInfo: SelectedNodeInfo | null`

### `property vtt.widgets.SettingsDrawerProps.tokenCount: number`

### `property vtt.widgets.SettingsDrawerProps.toolParams: ToolParamsByTool`

### `interface vtt.widgets.ToolRailProps`

### `property vtt.widgets.ToolRailProps.canRedo: boolean`

### `property vtt.widgets.ToolRailProps.canUndo: boolean`

### `property vtt.widgets.ToolRailProps.onRedo: () => void`

### `property vtt.widgets.ToolRailProps.onSnapToGridChange: (snap: boolean) => void`

### `property vtt.widgets.ToolRailProps.onToolChange: (tool: ConstructionToolId) => void`

### `property vtt.widgets.ToolRailProps.onUndo: () => void`

### `property vtt.widgets.ToolRailProps.snapToGrid: boolean`

### `property vtt.widgets.ToolRailProps.tool: ConstructionToolId`

### `type vtt.widgets.EditTool = ConstructionToolId`

`tool-rail.tsx`'s own two tools are a subset of the shared `ConstructionToolId` vocabulary -- kept as an alias (not a separate type) so both this rail and `ConstructionHotbar` write to the same piece of state.

### `function vtt.widgets.ConstructionDock(props: ConstructionDockProps): Element`

The primary bottom ActionDock inspired by Tiny Glade's reactive construction model
and `docs/research/vtt-reactive-construction-and-tiny-glade-ui-model.md`.

Houses the 8 core construction verbs in a centered, glassmorphic dock:
1. 🏠 Edifícios (Pincel Livre, Linha Reta -- manual free-form/exact
   point-to-point walls; Gerar Interiores -- one click inside an
   already-enclosed space auto-generates its interior partition via the
   same region-partition algorithm the retired "Pintar Casa" brush used;
   Torre -- one click stamps a closed circular footprint at a known
   preset radius, never freehand-drawn, see `tower-stamp-tool.ts`)
2. 🚪 Aberturas (Portas & Janelas -- one click on a wall panel opens it
   and stands a face in the opening, see `opening-tool.ts`)
3. 🪜 Escadas (Conexão de elevações)
4. 🛤️ Caminhos (Trilhas & química de portais)
5. ⛰️ Terreno & Água (Escultura de Terreno)
6. 🌲 Vegetação (Adornos & Flora)
7. 🎨 Estilo & Paleta (Materiais & Temas)
8. 🔨 Demolir (Apagador de cômodos / elementos)

The former "Pintar Casa"/"Carimbo de Sala"/"Derivar Sala" cell-grid/stamp
tools and the separate "Muros" branch are retired -- the owner flagged the
whole cell-grid-room model as the wrong idea; "Edifícios" now means the
wall tools, formerly their own "Muros" entry.

### `function vtt.widgets.ConstructionHotbar(props: ConstructionHotbarProps): Element`

The bottom hotbar: selects the active construction tool only -- it never
generates geometry itself. A tool's own parameters live in
`ConstructionToolParamsPanel` (the right drawer); what a selected tool
does with the pointer lives in `composition/tabletop/tools/*.ts` via
`useConstructionPointer`. One root FloatButtonTree branch
("Construir") expands into one leaf per direct-action tool plus one
nested "Casa" branch -- "Expandir Cômodo" deliberately reuses the
`move-node` tool id rather than introducing a new one, since dragging a
shared corner already resizes whichever room(s) reference it with zero
house-specific code (`VTT-HOUSE-INCREMENTAL-EDIT`'s own finding).

### `function vtt.widgets.ConstructionToolParamsPanel(props: ConstructionToolParamsPanelProps): Element`

The right-panel half of the hotbar/panel sync: which fields show is driven
entirely by `activeTool` (set by `ConstructionHotbar`/`ToolRail`), and
editing a field here only ever updates `params[activeTool]` -- it never
knows how a tool turns its own parameters into geometry, that lives in
`composition/tabletop/tools/*.ts`.

### `function vtt.widgets.SettingsDrawer(props: SettingsDrawerProps): Element`

The right-side settings/inspector drawer: selection inspector, the active
construction tool's parameters, and scene metrics -- floats over the map,
collapsed by default.
Built on the shared `SlidingPanel` molecule, which owns the slide
animation and the fused open/close handle; this widget only supplies the
product-specific content.

### `function vtt.widgets.ToolRail(props: ToolRailProps): Element`

The left rail: navigate/move-node tool selection, the grid-snap toggle,
and undo/redo -- always visible as a plain button column (no separate
open/close trigger), edit-mode only. Grid snap sits here (not in the
construction hotbar) because it is not itself a tool -- it modifies every
construction tool's resolved point the same way, via
`use-construction-pointer.ts`.

### `interface vtt.use-keyboard-shortcuts.KeyboardShortcutsOptions`

### `property vtt.use-keyboard-shortcuts.KeyboardShortcutsOptions.canRedo: boolean`

### `property vtt.use-keyboard-shortcuts.KeyboardShortcutsOptions.canUndo: boolean`

### `property vtt.use-keyboard-shortcuts.KeyboardShortcutsOptions.onRedo: () => void`

### `property vtt.use-keyboard-shortcuts.KeyboardShortcutsOptions.onSnapToGridChange: (snap: boolean) => void`

### `property vtt.use-keyboard-shortcuts.KeyboardShortcutsOptions.onToolChange: (tool: ConstructionToolId) => void`

### `property vtt.use-keyboard-shortcuts.KeyboardShortcutsOptions.onUndo: () => void`

### `property vtt.use-keyboard-shortcuts.KeyboardShortcutsOptions.ready: boolean`

### `property vtt.use-keyboard-shortcuts.KeyboardShortcutsOptions.snapToGrid: boolean`

### `function vtt.use-keyboard-shortcuts.useKeyboardShortcuts(options: KeyboardShortcutsOptions): void`

Global keyboard shortcuts for the GM studio: Ctrl+Z/Ctrl+Y for undo/redo,
N/M/P/I select tools (mirroring the hotbar/rail's own tooltips) --
nothing here generates geometry directly anymore, a key just changes
`activeTool` the same way clicking its hotbar button would. Ignored while
an `<input>`/`<textarea>` has focus, so typing in a settings field never
triggers a shortcut.
