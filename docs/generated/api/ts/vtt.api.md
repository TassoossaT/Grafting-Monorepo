# vtt

### `reference vtt.construction.createConstructionSessionAdapter`

### `function vtt.construction-session-wasm-adapter.createConstructionSessionAdapter(): ConstructionSessionPort`

### `reference vtt.rendering.chunkKeyFor`

### `reference vtt.rendering.chunkSurfaceMeshes`

### `reference vtt.rendering.clipPlaneForCameraHeight`

### `reference vtt.rendering.colorForSurfaceType`

### `reference vtt.rendering.createRender3dSceneAdapter`

### `reference vtt.rendering.MAP_LAYER_ID`

### `reference vtt.rendering.MAP_SURFACE_VISUAL_KIND`

### `reference vtt.rendering.mapChunkSceneItem`

### `reference vtt.rendering.MapChunkVisualParams`

### `function vtt.map-chunk-batching.chunkSurfaceMeshes(surfaces: readonly SurfaceMeshResult[]): readonly RenderMapChunk[]`

Buckets triangulated construction surfaces into spatial chunks (via the
existing chunkKeyFor) and merges each bucket's meshes into one
buffer (via `@grafting/render-3d`'s existing `mergeMeshChunks`), producing
the `RenderMapChunk`s `SceneRenderPort.applyConfirmed` expects. A chunk
that mixes surface types (e.g. a wall and a terrain cell landing in the
same bucket) takes its first surface's `surfaceType`/`physical` for
classification -- `colorForSurfaceType`'s flat placeholder coloring
doesn't yet need finer granularity than that (see `E4.2`).

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

### `property vtt.create-tabletop-runtime.CreateTabletopRuntimeInput.constructionPort?: ConstructionSessionPort`

### `property vtt.create-tabletop-runtime.CreateTabletopRuntimeInput.initialTokens?: readonly TokenProjection[]`

### `property vtt.create-tabletop-runtime.CreateTabletopRuntimeInput.renderPort?: SceneRenderPort`

### `property vtt.create-tabletop-runtime.CreateTabletopRuntimeInput.tableId: string`

### `function vtt.create-tabletop-runtime.createTabletopRuntime(input: CreateTabletopRuntimeInput): TabletopRuntime`

### `interface vtt.default-map-seed.DefaultMapSeed`

### `property vtt.default-map-seed.DefaultMapSeed.terrainCell: GenerateTerrainCellOperation`

### `property vtt.default-map-seed.DefaultMapSeed.wall: GenerateWallOperation`

### `function vtt.default-map-seed.defaultMapSeed(tableId: string, initiatedBy: string): DefaultMapSeed`

Builds (but does not apply) one generated terrain cell and one
wall-with-door, so a fresh table has visible map geometry to render
without waiting on `E3.7`'s pointer/edit-mode UI -- the same role the
guide token plays for `entities/token`. Every id is namespaced by
`tableId` so two tables never collide inside one `ConstructionSession`.

### `class vtt.tabletop-runtime.AppTabletopRuntime`

### `constructor vtt.tabletop-runtime.AppTabletopRuntime.constructor(tableId: string, render: SceneRenderPort, construction: ConstructionSessionPort, initialTokens: readonly TokenProjection[]): AppTabletopRuntime`

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

### `property vtt.tabletop-runtime.TabletopSnapshot.map: MapProjection`

### `property vtt.tabletop-runtime.TabletopSnapshot.revision: number`

### `property vtt.tabletop-runtime.TabletopSnapshot.status: TabletopRuntimeStatus`

### `property vtt.tabletop-runtime.TabletopSnapshot.tableId: string`

### `property vtt.tabletop-runtime.TabletopSnapshot.tokens: TokenCollectionProjection`

### `type vtt.tabletop-runtime.TabletopRuntimeListener = () => void`

### `type vtt.tabletop-runtime.TabletopRuntimeStatus = "idle" | "starting" | "ready" | "disposed"`

### `reference vtt.map.applyMapProjectionDelta`

### `reference vtt.map.createMapProjection`

### `reference vtt.map.createSurfaceProjection`

### `reference vtt.map.MapId`

### `reference vtt.map.MapProjection`

### `reference vtt.map.MapProjectionDelta`

### `reference vtt.map.NodeRef`

### `reference vtt.map.SurfaceProjection`

### `reference vtt.map.SurfaceRef`

### `reference vtt.map.surfaceRefFromNodeSet`

### `interface vtt.map-projection.MapProjection`

### `property vtt.map-projection.MapProjection.byId: ReadonlyMap<string, SurfaceProjection>`

### `property vtt.map-projection.MapProjection.revision: number`

### `interface vtt.map-projection.SurfaceProjection`

### `property vtt.map-projection.SurfaceProjection.orderedNodeRefs: readonly string[]`

### `property vtt.map-projection.SurfaceProjection.physical: boolean`

### `property vtt.map-projection.SurfaceProjection.revision: number`

### `property vtt.map-projection.SurfaceProjection.surfaceRef: string`

### `property vtt.map-projection.SurfaceProjection.type: string`

### `type vtt.map-projection.MapId = string`

### `type vtt.map-projection.MapProjectionDelta = { surface: SurfaceProjection; type: "surface-upserted" } | { revision: number; surfaceRef: SurfaceRef; type: "surface-removed" }`

### `type vtt.map-projection.NodeRef = string`

### `type vtt.map-projection.SurfaceRef = string`

### `function vtt.map-projection.applyMapProjectionDelta(current: MapProjection, delta: MapProjectionDelta): MapProjection`

### `function vtt.map-projection.createMapProjection(surfaces: readonly SurfaceProjection[]): MapProjection`

### `function vtt.map-projection.createSurfaceProjection(input: SurfaceProjection): SurfaceProjection`

### `function vtt.map-projection.surfaceRefFromNodeSet(nodeRefs: readonly string[]): string`

Derives a stable SurfaceRef from a surface's canonical node-set
identity. Sorted + joined so two callers presenting the same node set in
a different order agree on the same ref -- mirroring
`grafting-graph-core::SurfaceKey`'s own order-independence. Per
`docs/architecture/vtt-product-model.md` §4.1, a `SurfaceRef` is "derived
by an adapter from canonical node-set identity"; this is that pure
derivation, called from the adapter layer.

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

### `reference vtt.edit-construction.ConstructionOperation`

### `reference vtt.edit-construction.ConstructionOperationContext`

### `reference vtt.edit-construction.createGenerateTerrainCellOperation`

### `reference vtt.edit-construction.createGenerateWallOperation`

### `reference vtt.edit-construction.GenerateTerrainCellOperation`

### `reference vtt.edit-construction.GenerateWallOperation`

### `reference vtt.edit-construction.OperationId`

### `reference vtt.edit-construction.ParticipantId`

### `reference vtt.edit-construction.RevisionPrecondition`

### `interface vtt.construction-operations.ConstructionOperationContext`

### `property vtt.construction-operations.ConstructionOperationContext.initiatedBy: string`

### `property vtt.construction-operations.ConstructionOperationContext.operationId: string`

### `property vtt.construction-operations.ConstructionOperationContext.tableId: string`

### `interface vtt.construction-operations.GenerateTerrainCellOperation`

### `property vtt.construction-operations.GenerateTerrainCellOperation.expected: readonly RevisionPrecondition[]`

### `property vtt.construction-operations.GenerateTerrainCellOperation.initiatedBy: string`

### `property vtt.construction-operations.GenerateTerrainCellOperation.kind: "construction.generate-terrain-cell@1"`

### `property vtt.construction-operations.GenerateTerrainCellOperation.operationId: string`

### `property vtt.construction-operations.GenerateTerrainCellOperation.payload: GenerateTerrainCellRequest`

### `property vtt.construction-operations.GenerateTerrainCellOperation.tableId: string`

### `interface vtt.construction-operations.GenerateWallOperation`

### `property vtt.construction-operations.GenerateWallOperation.expected: readonly RevisionPrecondition[]`

### `property vtt.construction-operations.GenerateWallOperation.initiatedBy: string`

### `property vtt.construction-operations.GenerateWallOperation.kind: "construction.generate-wall@1"`

### `property vtt.construction-operations.GenerateWallOperation.operationId: string`

### `property vtt.construction-operations.GenerateWallOperation.payload: GenerateWallRequest`

### `property vtt.construction-operations.GenerateWallOperation.tableId: string`

### `interface vtt.construction-operations.RevisionPrecondition`

### `property vtt.construction-operations.RevisionPrecondition.revision: number`

### `property vtt.construction-operations.RevisionPrecondition.scope: string`

### `type vtt.construction-operations.ConstructionOperation = GenerateTerrainCellOperation | GenerateWallOperation`

### `type vtt.construction-operations.OperationId = string`

### `type vtt.construction-operations.ParticipantId = string`

### `function vtt.construction-operations.createGenerateTerrainCellOperation(payload: GenerateTerrainCellRequest, context: ConstructionOperationContext): GenerateTerrainCellOperation`

`construction.generate-terrain-cell@1`: no revision precondition, mirroring
`token.place@1` -- generation creates new nodes/surfaces, it does not
contend with an existing revision.

### `function vtt.construction-operations.createGenerateWallOperation(payload: GenerateWallRequest, context: ConstructionOperationContext): GenerateWallOperation`

`construction.generate-wall@1`: same no-precondition shape as generate-terrain-cell.

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

### `reference vtt.ports.AffectedSurfaces`

### `reference vtt.ports.ChangeOrigin`

### `reference vtt.ports.ConfirmedMapChunkRenderChange`

### `reference vtt.ports.ConfirmedRenderChange`

### `reference vtt.ports.ConfirmedTokenRenderChange`

### `reference vtt.ports.ConstructionEdgeId`

### `reference vtt.ports.ConstructionNodeId`

### `reference vtt.ports.ConstructionPosition`

### `reference vtt.ports.ConstructionSessionPort`

### `reference vtt.ports.ConstructionSurfaceKey`

### `reference vtt.ports.ConstructionSurfaceSpec`

### `reference vtt.ports.CornerHeightModule`

### `reference vtt.ports.DeleteNodeOutcome`

### `reference vtt.ports.DoorOpening`

### `reference vtt.ports.GenerateTerrainCellRequest`

### `reference vtt.ports.GenerateWallRequest`

### `reference vtt.ports.RenderDependencyRevision`

### `reference vtt.ports.RenderLayerKey`

### `reference vtt.ports.RenderMapChunk`

### `reference vtt.ports.RenderMeshData`

### `reference vtt.ports.RenderToken`

### `reference vtt.ports.RenderViewId`

### `reference vtt.ports.SceneRenderMetrics`

### `reference vtt.ports.SceneRenderPort`

### `reference vtt.ports.SplitSurfaceOutcome`

### `reference vtt.ports.SurfaceMeshResult`

### `reference vtt.ports.WallPiece`

### `reference vtt.ports.WallSegment`

### `interface vtt.construction-session-port.AffectedSurfaces`

### `property vtt.construction-session-port.AffectedSurfaces.affectedSurfaceKeys: readonly ConstructionSurfaceKey[]`

### `interface vtt.construction-session-port.ConstructionPosition`

### `property vtt.construction-session-port.ConstructionPosition.x: number`

### `property vtt.construction-session-port.ConstructionPosition.y: number`

### `property vtt.construction-session-port.ConstructionPosition.z: number`

### `interface vtt.construction-session-port.ConstructionSessionPort`

Hides `grafting-procgen-construction-wasm`'s `ConstructionSession` ABI
(Rust panics are uncatchable on `wasm32-unknown-unknown`, so an adapter
must validate at this boundary, not rely on recovering from one) behind
app-owned types. Mirrors the whole session ABI, not only the
generate-terrain-cell/generate-wall slice this task's own runtime wiring
calls -- `E3.7`'s edit-mode interaction needs the five mutation
operations too, and shaping this once avoids redesigning the boundary
when that lands.

### `method vtt.construction-session-port.ConstructionSessionPort.addEdge(id: string, source: string, target: string): void`

### `method vtt.construction-session-port.ConstructionSessionPort.addNode(id: string, position: ConstructionPosition): void`

### `method vtt.construction-session-port.ConstructionSessionPort.addSurface(spec: ConstructionSurfaceSpec): ConstructionSurfaceKey`

### `method vtt.construction-session-port.ConstructionSessionPort.deleteNode(nodeId: string, capSurfaceType: string, capPhysical: boolean): DeleteNodeOutcome`

### `method vtt.construction-session-port.ConstructionSessionPort.dispose(): Promise<void>`

### `method vtt.construction-session-port.ConstructionSessionPort.duplicateSurface(key: ConstructionSurfaceKey, nodes: readonly { id: string; position: ConstructionPosition }[], ringEdgeIds: readonly string[], surfaceType: string, physical: boolean): ConstructionSurfaceKey`

### `method vtt.construction-session-port.ConstructionSessionPort.generateTerrainCell(request: GenerateTerrainCellRequest): ConstructionSurfaceKey`

### `method vtt.construction-session-port.ConstructionSessionPort.generateWall(request: GenerateWallRequest): readonly WallPiece[]`

### `method vtt.construction-session-port.ConstructionSessionPort.getAllSurfaceMeshes(): readonly SurfaceMeshResult[]`

Every currently-known surface's mesh -- the bootstrap/full-render call.

### `method vtt.construction-session-port.ConstructionSessionPort.getSurfaceMesh(surfaceKey: ConstructionSurfaceKey): SurfaceMeshResult`

### `method vtt.construction-session-port.ConstructionSessionPort.mergeSurfaces(a: ConstructionSurfaceKey, b: ConstructionSurfaceKey, merged: ConstructionSurfaceSpec): ConstructionSurfaceKey`

### `method vtt.construction-session-port.ConstructionSessionPort.moveNode(nodeId: string, position: ConstructionPosition): AffectedSurfaces`

### `method vtt.construction-session-port.ConstructionSessionPort.setTerrainMesh(width: number, height: number, layers: number, primitive: "passage" | "boundary" | "surface", deformationXy: number, deformationZ: number): void`

Must be called once before generateTerrainCell.

### `method vtt.construction-session-port.ConstructionSessionPort.splitSurface(key: ConstructionSurfaceKey, first: ConstructionSurfaceSpec, second: ConstructionSurfaceSpec): SplitSurfaceOutcome`

### `method vtt.construction-session-port.ConstructionSessionPort.start(): Promise<void>`

Loads the underlying Wasm module and starts an empty session. Every
other method requires this to have resolved first, mirroring
import("./scene-render-port.ts").SceneRenderPort's own
`start`/`dispose` lifecycle so a composition root awaits both the same
way.

### `interface vtt.construction-session-port.ConstructionSurfaceSpec`

### `property vtt.construction-session-port.ConstructionSurfaceSpec.cycle: readonly string[]`

### `property vtt.construction-session-port.ConstructionSurfaceSpec.physical: boolean`

### `property vtt.construction-session-port.ConstructionSurfaceSpec.surfaceType: string`

### `interface vtt.construction-session-port.CornerHeightModule`

### `property vtt.construction-session-port.CornerHeightModule.cornerHeights: readonly [number, number, number, number]`

Exactly 4 entries, in `PrismGridMesh::cell_corners`' cyclic order.

### `property vtt.construction-session-port.CornerHeightModule.name: string`

### `interface vtt.construction-session-port.DeleteNodeOutcome`

### `property vtt.construction-session-port.DeleteNodeOutcome.cappingSurfaceKeys: readonly ConstructionSurfaceKey[]`

### `property vtt.construction-session-port.DeleteNodeOutcome.removedSurfaceKeys: readonly ConstructionSurfaceKey[]`

### `interface vtt.construction-session-port.DoorOpening`

### `property vtt.construction-session-port.DoorOpening.closesAt: number`

### `property vtt.construction-session-port.DoorOpening.opensAt: number`

### `interface vtt.construction-session-port.GenerateTerrainCellRequest`

### `property vtt.construction-session-port.GenerateTerrainCellRequest.cell: number`

### `property vtt.construction-session-port.GenerateTerrainCellRequest.edgeIds: readonly [string, string, string, string]`

### `property vtt.construction-session-port.GenerateTerrainCellRequest.module: CornerHeightModule`

### `property vtt.construction-session-port.GenerateTerrainCellRequest.nodeIds: readonly [string, string, string, string]`

One id per corner slot, in cyclic order -- exactly 4 entries.

### `property vtt.construction-session-port.GenerateTerrainCellRequest.surfaceType: string`

### `interface vtt.construction-session-port.GenerateWallRequest`

### `property vtt.construction-session-port.GenerateWallRequest.door?: DoorOpening`

### `property vtt.construction-session-port.GenerateWallRequest.doorType: string`

### `property vtt.construction-session-port.GenerateWallRequest.edgeIds: Readonly<Record<string, ConstructionEdgeId>>`

Keyed by directional role-pair wire name (e.g. `"startBottom->startTop"`).

### `property vtt.construction-session-port.GenerateWallRequest.nodeIds: Readonly<Record<string, ConstructionNodeId>>`

Keyed by wall-role wire name (e.g. `"startBottom"`).

### `property vtt.construction-session-port.GenerateWallRequest.wall: WallSegment`

### `property vtt.construction-session-port.GenerateWallRequest.wallType: string`

### `interface vtt.construction-session-port.SplitSurfaceOutcome`

### `property vtt.construction-session-port.SplitSurfaceOutcome.firstKey: ConstructionSurfaceKey`

### `property vtt.construction-session-port.SplitSurfaceOutcome.secondKey: ConstructionSurfaceKey`

### `interface vtt.construction-session-port.SurfaceMeshResult`

### `property vtt.construction-session-port.SurfaceMeshResult.mesh: RenderMeshData`

### `property vtt.construction-session-port.SurfaceMeshResult.physical: boolean`

### `property vtt.construction-session-port.SurfaceMeshResult.surfaceKey: ConstructionSurfaceKey`

### `property vtt.construction-session-port.SurfaceMeshResult.surfaceType: string`

### `interface vtt.construction-session-port.WallPiece`

### `property vtt.construction-session-port.WallPiece.surfaceKey: ConstructionSurfaceKey`

### `property vtt.construction-session-port.WallPiece.surfaceType: string`

### `interface vtt.construction-session-port.WallSegment`

### `property vtt.construction-session-port.WallSegment.end: ConstructionPosition`

### `property vtt.construction-session-port.WallSegment.height: number`

### `property vtt.construction-session-port.WallSegment.start: ConstructionPosition`

### `type vtt.construction-session-port.ConstructionEdgeId = string`

### `type vtt.construction-session-port.ConstructionNodeId = string`

### `type vtt.construction-session-port.ConstructionSurfaceKey = readonly ConstructionNodeId[]`

A construction surface's canonical node-set identity, unordered.

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
