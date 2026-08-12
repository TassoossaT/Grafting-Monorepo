# vtt

### `reference vtt.rendering.chunkKeyFor`

### `reference vtt.rendering.clipPlaneForCameraHeight`

### `reference vtt.rendering.colorForSurfaceType`

### `reference vtt.rendering.createRender3dSceneAdapter`

### `reference vtt.rendering.MAP_LAYER_ID`

### `reference vtt.rendering.MAP_SURFACE_VISUAL_KIND`

### `reference vtt.rendering.mapChunkSceneItem`

### `reference vtt.rendering.MapChunkVisualParams`

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

### `function vtt.map-chunk-scene-item.colorForSurfaceType(surfaceType: string, physical: boolean): number`

Flat classification color, no texture -- matches `@grafting/render-3d`'s
own `heightfieldVisual` default. A real material/asset pipeline is `E4.2`;
this exists only so generated geometry is visually distinguishable while
nothing else renders it.

### `function vtt.map-chunk-scene-item.mapChunkSceneItem(chunk: RenderMapChunk): SceneItem<MapChunkVisualParams>`

### `class vtt.render-3d-scene-adapter.Render3dSceneAdapter`

### `constructor vtt.render-3d-scene-adapter.Render3dSceneAdapter.constructor(): Render3dSceneAdapter`

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.applyConfirmed(change: ConfirmedRenderChange): void`

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.attachView(target: HTMLElement): string`

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.detachView(viewId: string): void`

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.dispose(): Promise<void>`

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.getMetrics(): SceneRenderMetrics`

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.resizeView(viewId: string, width: number, height: number): void`

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.setFloorClipHeight(height: number | undefined): void`

Sets the floor-cutaway height in continuous world-space Y. `undefined` disables cutaway.

### `method vtt.render-3d-scene-adapter.Render3dSceneAdapter.start(runtimeGeneration: number): Promise<void>`

### `function vtt.render-3d-scene-adapter.createRender3dSceneAdapter(): SceneRenderPort`

### `interface vtt.token-scene-item.TokenVisualParams`

### `property vtt.token-scene-item.TokenVisualParams.color: number`

### `variable vtt.token-scene-item.TOKEN_LAYER_ID: "tokens"`

### `variable vtt.token-scene-item.TOKEN_VISUAL_KIND: "vtt-token-billboard"`

### `function vtt.token-scene-item.tokenSceneItem(token: RenderToken): SceneItem<TokenVisualParams>`

### `function vtt.token-scene-item.tokenTransform(token: RenderToken): Transform`

### `reference vtt.tabletop.ConfirmedTokenDeltaEnvelope`

### `reference vtt.tabletop.createTabletopRuntime`

### `reference vtt.tabletop.CreateTabletopRuntimeInput`

### `reference vtt.tabletop.TabletopRuntime`

### `reference vtt.tabletop.TabletopRuntimeListener`

### `reference vtt.tabletop.TabletopRuntimeStatus`

### `reference vtt.tabletop.TabletopSnapshot`

### `interface vtt.create-tabletop-runtime.CreateTabletopRuntimeInput`

### `property vtt.create-tabletop-runtime.CreateTabletopRuntimeInput.initialTokens?: readonly TokenProjection[]`

### `property vtt.create-tabletop-runtime.CreateTabletopRuntimeInput.renderPort?: SceneRenderPort`

### `property vtt.create-tabletop-runtime.CreateTabletopRuntimeInput.tableId: string`

### `function vtt.create-tabletop-runtime.createTabletopRuntime(input: CreateTabletopRuntimeInput): TabletopRuntime`

### `class vtt.tabletop-runtime.AppTabletopRuntime`

### `constructor vtt.tabletop-runtime.AppTabletopRuntime.constructor(tableId: string, render: SceneRenderPort, initialTokens: readonly TokenProjection[]): AppTabletopRuntime`

### `method vtt.tabletop-runtime.AppTabletopRuntime.applyConfirmedToken(envelope: ConfirmedTokenDeltaEnvelope): void`

### `method vtt.tabletop-runtime.AppTabletopRuntime.attachView(target: HTMLElement): string`

### `method vtt.tabletop-runtime.AppTabletopRuntime.detachView(viewId: string): void`

### `method vtt.tabletop-runtime.AppTabletopRuntime.dispose(): Promise<void>`

### `method vtt.tabletop-runtime.AppTabletopRuntime.getRenderMetrics(): SceneRenderMetrics`

### `method vtt.tabletop-runtime.AppTabletopRuntime.getSnapshot(): TabletopSnapshot`

### `method vtt.tabletop-runtime.AppTabletopRuntime.resizeView(viewId: string, width: number, height: number): void`

### `method vtt.tabletop-runtime.AppTabletopRuntime.start(): Promise<void>`

### `method vtt.tabletop-runtime.AppTabletopRuntime.subscribe(listener: TabletopRuntimeListener): () => void`

### `interface vtt.tabletop-runtime.ConfirmedTokenDeltaEnvelope`

### `property vtt.tabletop-runtime.ConfirmedTokenDeltaEnvelope.causeId: string`

### `property vtt.tabletop-runtime.ConfirmedTokenDeltaEnvelope.delta: TokenProjectionDelta`

### `property vtt.tabletop-runtime.ConfirmedTokenDeltaEnvelope.origin: ChangeOrigin`

### `interface vtt.tabletop-runtime.TabletopRuntime`

### `method vtt.tabletop-runtime.TabletopRuntime.applyConfirmedToken(envelope: ConfirmedTokenDeltaEnvelope): void`

### `method vtt.tabletop-runtime.TabletopRuntime.attachView(target: HTMLElement): string`

### `method vtt.tabletop-runtime.TabletopRuntime.detachView(viewId: string): void`

### `method vtt.tabletop-runtime.TabletopRuntime.dispose(): Promise<void>`

### `method vtt.tabletop-runtime.TabletopRuntime.getRenderMetrics(): SceneRenderMetrics`

### `method vtt.tabletop-runtime.TabletopRuntime.getSnapshot(): TabletopSnapshot`

### `method vtt.tabletop-runtime.TabletopRuntime.resizeView(viewId: string, width: number, height: number): void`

### `method vtt.tabletop-runtime.TabletopRuntime.start(): Promise<void>`

### `method vtt.tabletop-runtime.TabletopRuntime.subscribe(listener: TabletopRuntimeListener): () => void`

### `interface vtt.tabletop-runtime.TabletopSnapshot`

### `property vtt.tabletop-runtime.TabletopSnapshot.revision: number`

### `property vtt.tabletop-runtime.TabletopSnapshot.status: TabletopRuntimeStatus`

### `property vtt.tabletop-runtime.TabletopSnapshot.tableId: string`

### `property vtt.tabletop-runtime.TabletopSnapshot.tokens: TokenCollectionProjection`

### `type vtt.tabletop-runtime.TabletopRuntimeListener = () => void`

### `type vtt.tabletop-runtime.TabletopRuntimeStatus = "idle" | "starting" | "ready" | "disposed"`

### `reference vtt.token.applyTokenProjectionDelta`

### `reference vtt.token.createTokenCollection`

### `reference vtt.token.createTokenProjection`

### `reference vtt.token.SceneId`

### `reference vtt.token.SubjectRef`

### `reference vtt.token.TokenAppearance`

### `reference vtt.token.TokenCollectionProjection`

### `reference vtt.token.TokenId`

### `reference vtt.token.TokenPosition`

### `reference vtt.token.TokenProjection`

### `reference vtt.token.TokenProjectionDelta`

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

### `reference vtt.place-token.BindTokenSubjectIntent`

### `reference vtt.place-token.BindTokenSubjectOperation`

### `reference vtt.place-token.createBindTokenSubjectOperation`

### `reference vtt.place-token.createPlaceTokenOperation`

### `reference vtt.place-token.OperationId`

### `reference vtt.place-token.ParticipantId`

### `reference vtt.place-token.PlaceTokenIntent`

### `reference vtt.place-token.PlaceTokenOperation`

### `reference vtt.place-token.RevisionPrecondition`

### `reference vtt.place-token.TokenOperation`

### `reference vtt.place-token.TokenOperationContext`

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

### `reference vtt.ports.ChangeOrigin`

### `reference vtt.ports.ConfirmedMapChunkRenderChange`

### `reference vtt.ports.ConfirmedRenderChange`

### `reference vtt.ports.ConfirmedTokenRenderChange`

### `reference vtt.ports.RenderDependencyRevision`

### `reference vtt.ports.RenderLayerKey`

### `reference vtt.ports.RenderMapChunk`

### `reference vtt.ports.RenderMeshData`

### `reference vtt.ports.RenderToken`

### `reference vtt.ports.RenderViewId`

### `reference vtt.ports.SceneRenderMetrics`

### `reference vtt.ports.SceneRenderPort`

### `interface vtt.scene-render-port.RenderDependencyRevision`

### `property vtt.scene-render-port.RenderDependencyRevision.layer: RenderLayerKey`

### `property vtt.scene-render-port.RenderDependencyRevision.revision: number`

### `property vtt.scene-render-port.RenderDependencyRevision.scopeId: string`

### `interface vtt.scene-render-port.RenderMapChunk`

One spatially-bucketed unit of map geometry. `surfaceType`/`physical` echo
`grafting-procgen-construction-wasm`'s `Surface` fields directly -- this
port does not invent its own classification vocabulary.

### `property vtt.scene-render-port.RenderMapChunk.chunkId: string`

### `property vtt.scene-render-port.RenderMapChunk.mesh: RenderMeshData`

### `property vtt.scene-render-port.RenderMapChunk.physical: boolean`

### `property vtt.scene-render-port.RenderMapChunk.surfaceType: string`

### `interface vtt.scene-render-port.RenderMeshData`

Packed vertex data for one piece of map geometry. Defined locally rather
than imported from `@grafting/render-3d`, matching how RenderToken
already keeps this port renderer-agnostic.

### `property vtt.scene-render-port.RenderMeshData.indices?: Uint16Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>`

### `property vtt.scene-render-port.RenderMeshData.normals?: Float32Array<ArrayBufferLike>`

### `property vtt.scene-render-port.RenderMeshData.positions: Float32Array`

### `property vtt.scene-render-port.RenderMeshData.uvs?: Float32Array<ArrayBufferLike>`

### `interface vtt.scene-render-port.RenderToken`

### `property vtt.scene-render-port.RenderToken.appearance: { color: number; label: string; size: number }`

### `property vtt.scene-render-port.RenderToken.id: string`

### `property vtt.scene-render-port.RenderToken.position: { x: number; y: number; z: number }`

### `interface vtt.scene-render-port.SceneRenderMetrics`

### `property vtt.scene-render-port.SceneRenderMetrics.attachedViews: number`

### `property vtt.scene-render-port.SceneRenderMetrics.confirmedTokenChanges: number`

### `property vtt.scene-render-port.SceneRenderMetrics.rendererCreates: number`

### `property vtt.scene-render-port.SceneRenderMetrics.rendererDisposes: number`

### `property vtt.scene-render-port.SceneRenderMetrics.terrainUploads: number`

### `interface vtt.scene-render-port.SceneRenderPort`

### `method vtt.scene-render-port.SceneRenderPort.applyConfirmed(change: ConfirmedRenderChange): void`

### `method vtt.scene-render-port.SceneRenderPort.attachView(target: HTMLElement): string`

### `method vtt.scene-render-port.SceneRenderPort.detachView(viewId: string): void`

### `method vtt.scene-render-port.SceneRenderPort.dispose(): Promise<void>`

### `method vtt.scene-render-port.SceneRenderPort.getMetrics(): SceneRenderMetrics`

### `method vtt.scene-render-port.SceneRenderPort.resizeView(viewId: string, width: number, height: number): void`

### `method vtt.scene-render-port.SceneRenderPort.setFloorClipHeight(height: number | undefined): void`

Sets the floor-cutaway height in continuous world-space Y. `undefined` disables cutaway.

### `method vtt.scene-render-port.SceneRenderPort.start(runtimeGeneration: number): Promise<void>`

### `type vtt.scene-render-port.ChangeOrigin = "local" | "network" | "programmatic"`

### `type vtt.scene-render-port.ConfirmedMapChunkRenderChange = { causeId: string; chunk: RenderMapChunk; dependency: RenderDependencyRevision; origin: ChangeOrigin; runtimeGeneration: number; type: "map-chunk-upserted" } | { causeId: string; chunkId: string; dependency: RenderDependencyRevision; origin: ChangeOrigin; runtimeGeneration: number; type: "map-chunk-removed" }`

### `type vtt.scene-render-port.ConfirmedRenderChange = ConfirmedTokenRenderChange | ConfirmedMapChunkRenderChange`

### `type vtt.scene-render-port.ConfirmedTokenRenderChange = { causeId: string; dependency: RenderDependencyRevision; origin: ChangeOrigin; runtimeGeneration: number; token: RenderToken; type: "token-upserted" } | { causeId: string; dependency: RenderDependencyRevision; origin: ChangeOrigin; runtimeGeneration: number; tokenId: string; type: "token-removed" }`

### `type vtt.scene-render-port.RenderLayerKey = "tokens" | "terrain"`

### `type vtt.scene-render-port.RenderViewId = string`
