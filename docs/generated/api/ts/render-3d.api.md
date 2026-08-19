# render-3d

### `interface render-3d.AnimationTrack`

One time-driven change to the scene.

### `property render-3d.AnimationTrack.durationMs: number`

Simulated milliseconds from start to completion. Must be greater than zero.

### `property render-3d.AnimationTrack.easing?: Easing`

Applied to progress before AnimationTrack.apply. Linear when omitted.

### `property render-3d.AnimationTrack.id: string`

Caller-chosen identity. Playing the same id again replaces the running track.

### `property render-3d.AnimationTrack.loop?: boolean`

Whether the track restarts on completion instead of finishing. Defaults to `false`.

### `method render-3d.AnimationTrack.apply(progress: number, scene: Scene): void`

Writes this track's state for the given eased progress.

Called with `1` exactly once on completion, so a track never has to
defend against ending slightly short of its final value.

### `method render-3d.AnimationTrack.onComplete(scene: Scene): void`

Called once after the final `apply`, for a track that needs to clean up.

### `interface render-3d.Animator`

Drives tracks from simulated time and writes their results into a scene.

### `property render-3d.Animator.origin: ChangeOrigin`

The origin recorded for scene writes made by tracks. Always `"engine"`.

### `method render-3d.Animator.advance(simDeltaMs: number): void`

Advances every track by a simulated interval and applies the results.

The engine calls this once per frame with the clock's `simDelta`, which is
`0` while paused. Callers driving their own loop may call it directly.

### `method render-3d.Animator.clear(): void`

Stops every track without settling.

### `method render-3d.Animator.isPlaying(id: string): boolean`

Whether a track is currently running.

### `method render-3d.Animator.play(track: AnimationTrack): void`

Starts a track, replacing any running track with the same id.

Replacement rather than stacking is deliberate: two tracks writing the
same property is a bug that is very hard to see and trivial to cause.

### `method render-3d.Animator.running(): readonly RunningTrack[]`

Every track in flight.

### `method render-3d.Animator.stop(id: string, settle?: boolean): boolean`

Stops a track. `settle` applies its final value first. Returns whether it was running.

### `interface render-3d.ClipPlaneDescriptor`

A single cutting plane, as data. Points where `dot(normal, point) +
constant >= 0` is false are cut away.

Engine-global: the active plane cuts every item whose material opted in
via `MaterialDescriptor.clippable`, across every view. Independent
per-view clip heights are not supported by this contract.

### `property render-3d.ClipPlaneDescriptor.constant: number`

Signed offset in the plane equation `dot(normal, point) + constant >= 0`.

### `property render-3d.ClipPlaneDescriptor.normal: Vec3`

Unit normal of the cutting plane.

### `interface render-3d.Clock`

Time source shared by animation, simulation, and any caller-owned stepping.

### `property render-3d.Clock.last: ClockTick`

The most recent tick, or the zero tick before the first sample.

### `property render-3d.Clock.mode: ClockMode`

Current mode.

### `property render-3d.Clock.rate: number`

Simulation-time multiplier while running. `1` is real time; `0.25` is quarter speed.

### `method render-3d.Clock.advance(simMilliseconds: number): void`

Injects a fixed simulation step, independent of mode and rate.

This is the turn-based entry point: a caller that never calls
Clock.play drives the whole world by resolving a turn into a
single `advance`, and gets identical animation behaviour to a real-time
caller without the engine knowing which it is.

### `method render-3d.Clock.pause(): void`

Freezes simulation time. Real time keeps advancing. No-op when already paused.

### `method render-3d.Clock.play(): void`

Resumes simulation time. No-op when already running.

### `method render-3d.Clock.sample(realNow: number): ClockTick`

Produces the next tick from a real-time reading, in milliseconds.

Called once per frame by whoever owns the frame loop. Any simulation time
queued by Clock.advance is released into this tick's `simDelta`.

### `method render-3d.Clock.setRate(rate: number): void`

Sets the simulation-time multiplier. Must be finite and non-negative.

### `interface render-3d.ClockOptions`

Options for createClock.

### `property render-3d.ClockOptions.autoplay?: boolean`

Whether simulation time starts advancing. Defaults to `true`.

### `property render-3d.ClockOptions.rate?: number`

Initial simulation-time multiplier. Defaults to `1`.

### `interface render-3d.ClockTick`

One observation of time, handed to every listener on a frame.

### `property render-3d.ClockTick.frame: number`

Monotonic frame counter, incremented once per Clock.sample.

### `property render-3d.ClockTick.realDelta: number`

Wall-clock milliseconds since the previous sample. Advances while paused.

### `property render-3d.ClockTick.realElapsed: number`

Wall-clock milliseconds since the clock was created. Advances while paused.

### `property render-3d.ClockTick.simDelta: number`

Simulated milliseconds since the previous sample. Always `0` while paused,
except on the sample that follows an explicit Clock.advance.

### `property render-3d.ClockTick.simElapsed: number`

Simulated milliseconds since the clock was created. Frozen while paused.

### `interface render-3d.EngineOptions`

Everything needed to stand an engine up.

### `property render-3d.EngineOptions.autoplay?: boolean`

Whether the clock starts running. Defaults to `true`; a turn-based caller passes `false`.

### `property render-3d.EngineOptions.lights?: readonly LightDescriptor[]`

Initial lighting. Unlit materials do not require any.

### `property render-3d.EngineOptions.maxPixelRatio?: number`

Device pixel ratio ceiling. Defaults to `2`.

### `property render-3d.EngineOptions.registry?: VisualRegistry`

Shared visual kinds. A private empty registry is created when omitted.

### `interface render-3d.Euler`

Rotation in radians, applied in XYZ order.

### `property render-3d.Euler.x: number`

Pitch, in radians.

### `property render-3d.Euler.y: number`

Yaw, in radians.

### `property render-3d.Euler.z: number`

Roll, in radians.

### `interface render-3d.FrameReport`

What the engine did during one frame. Reported for measurement, not for control flow.

### `property render-3d.FrameReport.contextLost: boolean`

Whether the graphics context was unusable during this frame.

Nothing is drawn while this is true. The engine rebuilds everything from
the scene once the context comes back, so a caller normally only needs
this to surface the condition to the user.

### `property render-3d.FrameReport.tick: ClockTick`

The clock reading this frame ran at.

### `property render-3d.FrameReport.viewsDrawn: number`

Views actually redrawn this frame.

### `property render-3d.FrameReport.viewsSkipped: number`

Views skipped because nothing they draw had changed.

### `property render-3d.FrameReport.visualsRebuilt: number`

Item visuals rebuilt this frame.

### `interface render-3d.GridParams`

Parameters for the gridVisual kind.

### `property render-3d.GridParams.cellSize: number`

World-space distance between adjacent lines.

### `property render-3d.GridParams.color?: number`

Line color. Defaults to white, so the caller's palette decides.

### `property render-3d.GridParams.extent: number`

Half the grid's world-space span on each axis -- it runs from `-extent` to `extent` on both X and Z.

### `property render-3d.GridParams.opacity?: number`

Line opacity, in `(0, 1]`. Defaults to `1`.

### `interface render-3d.HeightfieldData`

A regular grid of elevation samples, the shape a terrain or a fluid surface takes.

### `property render-3d.HeightfieldData.depth: number`

Sample count along the Z axis.

### `property render-3d.HeightfieldData.elevationScale?: number`

Multiplier applied to each sample before it becomes a vertex height. Defaults to `1`.

### `property render-3d.HeightfieldData.size?: { x: number; z: number }`

World-space span of the grid on both axes. Defaults to `width`/`depth`.

### `property render-3d.HeightfieldData.values: Float32Array`

Row-major elevation samples, `width * depth` of them.

### `property render-3d.HeightfieldData.width: number`

Sample count along the X axis.

### `interface render-3d.HeightfieldParams`

Parameters for the heightfieldVisual kind.

### `property render-3d.HeightfieldParams.color?: number`

Surface color. Defaults to white, so the caller's palette decides.

### `property render-3d.HeightfieldParams.depth: number`

Sample count along the Z axis.

### `property render-3d.HeightfieldParams.elevationScale?: number`

Multiplier applied to each sample before it becomes a vertex height. Defaults to `1`.

### `property render-3d.HeightfieldParams.flatShading?: boolean`

Whether facets are shaded flat. Defaults to `true`.

### `property render-3d.HeightfieldParams.size?: number`

World-space span of the grid on both axes. Defaults to `20` square.

### `property render-3d.HeightfieldParams.values: Float32Array`

Row-major elevation samples, `width * depth` of them.

### `property render-3d.HeightfieldParams.width: number`

Sample count along the X axis.

### `interface render-3d.Invalidation`

What changed since the last frame, at the coarsest granularity that is still
correct.

The point of tracking this at all is that most state changes cannot affect
most of what is drawn. Redrawing everything because something changed is the
default that looks fine with three objects on screen and becomes the whole
performance problem with three hundred. Moving one item must not be able to
invalidate a layer that item is not in.

### `property render-3d.Invalidation.empty: boolean`

Whether anything at all changed.

### `property render-3d.Invalidation.layers: ReadonlySet<string>`

Layers whose contents changed, and therefore the views that draw them.

### `property render-3d.Invalidation.rebuild: ReadonlySet<string>`

Items whose visual must be rebuilt from its descriptor.

### `property render-3d.Invalidation.release: ReadonlySet<string>`

Items whose built visual must be released.

### `property render-3d.Invalidation.reposition: ReadonlySet<string>`

Items that only moved. Placement is reapplied; geometry is left alone.

### `interface render-3d.InvalidationTracker`

Accumulates scene changes between frames.

### `property render-3d.InvalidationTracker.pending: boolean`

Whether anything is currently pending.

### `method render-3d.InvalidationTracker.drain(): Invalidation`

Returns what accumulated and resets, ready for the next frame.

### `method render-3d.InvalidationTracker.invalidateAll(layers: Iterable<string>, items: Iterable<string>): void`

Marks every layer and item dirty. Used when lighting or the registry changes.

### `method render-3d.InvalidationTracker.record(changes: readonly SceneChange[]): void`

Folds a batch of scene changes in.

### `interface render-3d.LayerDefinition`

An ordered draw group.

Layers are the unit of invalidation as well as of ordering: a view redraws
when a layer it draws has changed, so a change confined to one layer cannot
force unrelated content to be redrawn. Declaring which layers exist and what
they mean is the caller's job; the engine ships no layer names of its own.

### `property render-3d.LayerDefinition.id: string`

Caller-chosen name, unique within a scene.

### `property render-3d.LayerDefinition.opacity?: number`

Multiplies every item's opacity in this layer. Defaults to `1`.

### `property render-3d.LayerDefinition.order: number`

Draw order. Lower draws first, so higher values appear on top.

### `property render-3d.LayerDefinition.pickable?: boolean`

Whether items in this layer can be picked. Defaults to `true`.

### `property render-3d.LayerDefinition.visible?: boolean`

Whether the layer is drawn at all. Defaults to `true`.

### `interface render-3d.MeshData`

Packed vertex data for a caller-built shape.

### `property render-3d.MeshData.indices?: Uint16Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>`

Optional triangle indices. Positions are read sequentially when omitted.

### `property render-3d.MeshData.normals?: Float32Array<ArrayBufferLike>`

Optional flat `xyz` normal triples. Computed from faces when omitted.

### `property render-3d.MeshData.positions: Float32Array`

Flat `xyz` triples, three floats per vertex.

### `property render-3d.MeshData.uvs?: Float32Array<ArrayBufferLike>`

Optional flat `uv` pairs, two floats per vertex.

### `interface render-3d.OrbitableView`

The minimum of View this needs. Keeps the helper testable.

### `method render-3d.OrbitableView.setCamera(camera: { far?: number; fov?: number; near?: number; position: Vec3; projection: "perspective"; target: Vec3 }): void`

Replaces the camera description driven by the orbit helper.

### `interface render-3d.OrbitOptions`

What attachOrbit needs to know about the camera it is driving.

### `property render-3d.OrbitOptions.exclusive?: boolean`

Whether these gestures belong to this view alone.

When set, the handlers stop the events propagating any further, so a
surface that pans or zooms around this view -- a graph node, a scrolling
page -- never sees them. Done from inside the handlers deliberately: a
separate capture-phase listener on the same element cannot do this job,
because stopping an event during capture at an ancestor prevents it from
ever reaching the real target below and bubbling back, which silences the
orbit itself. That mistake shipped once.

### `property render-3d.OrbitOptions.far?: number`

Far clipping distance in world units.

### `property render-3d.OrbitOptions.fov?: number`

Perspective field of view in degrees.

### `property render-3d.OrbitOptions.near?: number`

Near clipping distance in world units.

### `property render-3d.OrbitOptions.onChange?: (state: OrbitState) => void`

Called after every change, so the caller can redraw.

### `property render-3d.OrbitOptions.orbitButton?: number`

Restricts orbit-drag to one `PointerEvent.button` value (0 = left,
1 = middle, 2 = right). Undefined -- the default -- preserves this
module's original behaviour: any button orbits.

A consumer that also drives its own tool gestures with the left button on
this same element (apps/vtt's construction tools, reserving LMB per the
board plan's camera control scheme) MUST set this explicitly, e.g. to
`2`, so the two gesture sets stop fighting over `pointerdown`.

### `property render-3d.OrbitOptions.panButton?: number`

Enables a second, independent lateral-pan gesture bound to one
`PointerEvent.button` value, driven by orbitPan. Undefined --
the default -- disables panning entirely, this module's original
behaviour. Must differ from `orbitButton` when both are set.

### `property render-3d.OrbitOptions.pivot?: "center" | "cursor"`

Where an orbit drag re-centers before rotating.

`"center"` (the default) keeps today's behaviour: orbiting always turns
around whatever `target` already is. `"cursor"` asks resolvePivot
for the world point under the pointer at drag-start and re-targets there
first -- the Tiny Glade convention (`docs/research/vtt-board-construction-mode-ui-references.md`)
for framing one detail precisely without recentring the whole scene by
hand first.

### `property render-3d.OrbitOptions.resolvePivot?: (clientX: number, clientY: number) => Vec3 | undefined`

Resolves the world point under a client-space pointer position. Required
for `pivot: "cursor"`; ignored otherwise.

Kept as an injected callback rather than a raycast implemented here,
because this module owns no scene geometry (`VTT-ARCH-002`) -- the real
answer comes from the consumer's own picking (e.g. `SceneRenderPort.pick`
in `apps/vtt`). Returning `undefined` (the pointer is over empty space)
leaves the current target unchanged for that drag.

### `interface render-3d.OrbitState`

Where the camera sits, in spherical coordinates about a target.

### `property render-3d.OrbitState.distance: number`

Distance from the target, in world units.

### `property render-3d.OrbitState.pitch: number`

Elevation above the horizon, in radians.

### `property render-3d.OrbitState.target: Vec3`

The point orbited.

### `property render-3d.OrbitState.yaw: number`

Rotation about the vertical axis, in radians.

### `interface render-3d.PickResult`

What a pointer hit.

### `property render-3d.PickResult.data?: unknown`

The item's opaque caller data, carried through unchanged.

### `property render-3d.PickResult.distance: number`

Distance from the camera, in world units.

### `property render-3d.PickResult.itemId: string`

Which item was hit.

### `property render-3d.PickResult.layer: string`

The layer that item belongs to.

### `property render-3d.PickResult.point: Vec3`

World-space intersection point.

### `interface render-3d.RenderEngine`

One graphics context, one world, many views.

The engine owns the frame loop and decides what is worth redrawing. It has
no opinion about what the world contains: every drawable thing arrives
through a visual kind registered from outside, every draw group is named by
the caller, and every unit of time comes from a clock the caller can pause
or step by hand.

### `property render-3d.RenderEngine.animator: Animator`

Time-driven writers into the scene.

### `property render-3d.RenderEngine.clock: Clock`

The time authority.

### `property render-3d.RenderEngine.contextLost: boolean`

Whether the graphics context is currently lost. Nothing draws while true.

### `property render-3d.RenderEngine.registry: VisualRegistry`

Visual kinds available to this engine's items.

### `property render-3d.RenderEngine.scene: Scene`

The mutable world.

### `method render-3d.RenderEngine.createView(options: ViewOptions): View`

Opens a view. Every view shares this engine's single graphics context.

### `method render-3d.RenderEngine.dispose(): void`

Stops the loop and releases the graphics context, every view, and every built visual.

### `method render-3d.RenderEngine.frame(realNow: number): FrameReport`

Runs exactly one frame at the given real-time reading.

The way to drive the engine from a host-owned loop, from a fixed-step
simulation, or from a test that needs frames to be deterministic rather
than however often the browser felt like scheduling one.

### `method render-3d.RenderEngine.observeFrames(observer: FrameObserver): () => void`

Subscribes to frame reports. Returns an unsubscribe function.

### `method render-3d.RenderEngine.setClipPlane(plane: ClipPlaneDescriptor | undefined): void`

Replaces the active clip plane. `undefined` disables clipping. Marks every view dirty.

### `method render-3d.RenderEngine.setLights(lights: readonly LightDescriptor[]): void`

Replaces the lighting. Marks every lit view dirty.

### `method render-3d.RenderEngine.start(): void`

Begins driving frames from the host's animation frames.

### `method render-3d.RenderEngine.stop(): void`

Stops driving frames. Views keep their last drawn output.

### `method render-3d.RenderEngine.views(): readonly View[]`

Every open view, in creation order.

### `interface render-3d.RunningTrack`

A track in flight.

### `property render-3d.RunningTrack.elapsedMs: number`

Simulated milliseconds elapsed within the track.

### `property render-3d.RunningTrack.id: string`

Which track this reports on.

### `property render-3d.RunningTrack.progress: number`

Linear progress in `0..1`, before easing.

### `interface render-3d.Scene`

The mutable world. Holds no renderer state and can be driven headlessly.

### `method render-3d.Scene.batch(mutate: () => void, origin?: ChangeOrigin): void`

Groups several mutations into one notification.

Applying a turn's worth of changes inside one batch produces a single
observer call and a single redraw, rather than one of each per change.

### `method render-3d.Scene.clear(origin?: ChangeOrigin): void`

Drops every item and layer.

### `method render-3d.Scene.defineLayer(layer: LayerDefinition, origin?: ChangeOrigin): void`

Declares or replaces a draw group.

### `method render-3d.Scene.get(id: string): SceneItem<unknown> | undefined`

Reads an item without copying it.

### `method render-3d.Scene.items(layer?: string): readonly SceneItem<unknown>[]`

Every item in a layer, or every item when no layer is given.

### `method render-3d.Scene.layers(): readonly LayerDefinition[]`

Every declared layer, sorted by draw order.

### `method render-3d.Scene.observe(observer: SceneObserver): () => void`

Subscribes to changes. Returns an unsubscribe function.

### `method render-3d.Scene.put(item: SceneItem<TParams>, origin?: ChangeOrigin): void`

Adds an item, or replaces one with the same id.

### `method render-3d.Scene.remove(id: string, origin?: ChangeOrigin): boolean`

Removes an item. Returns whether it existed.

### `method render-3d.Scene.setTransform(id: string, transform: Transform, origin?: ChangeOrigin): void`

Moves an item, touching nothing else.

### `method render-3d.Scene.setVisible(id: string, visible: boolean, origin?: ChangeOrigin): void`

Shows or hides an item.

### `method render-3d.Scene.setVisualParams(id: string, params: unknown, origin?: ChangeOrigin): void`

Replaces an item's visual parameters, keeping its placement.

### `interface render-3d.SceneItem`

One drawable thing placed in the world.

### `property render-3d.SceneItem.data?: unknown`

Opaque caller data carried through unchanged.

The engine never reads this. It exists so a pick result can be traced back
to whatever the caller considers the real entity, without the engine
needing a concept of one.

### `property render-3d.SceneItem.id: string`

Caller-chosen identity, stable across updates to this item.

### `property render-3d.SceneItem.layer: string`

Which draw group the item belongs to.

### `property render-3d.SceneItem.transform?: Transform`

Placement. Defaults to the identity transform.

### `property render-3d.SceneItem.visible?: boolean`

Whether the item is drawn. Defaults to `true`.

### `property render-3d.SceneItem.visual: VisualRef<TParams>`

The registered visual kind and its parameters.

### `interface render-3d.Transform`

Placement of a scene item. Every field is optional; omitted fields keep their identity value.

### `property render-3d.Transform.position?: Vec3`

Placement in engine space. Defaults to the origin.

### `property render-3d.Transform.rotation?: Euler`

Orientation. Defaults to unrotated.

### `property render-3d.Transform.scale?: number | Vec3`

Uniform scale when a number, per-axis when a Vec3. Defaults to `1`.

### `interface render-3d.Vec3`

A point or direction in engine space.

### `property render-3d.Vec3.x: number`

Rightward axis.

### `property render-3d.Vec3.y: number`

Upward axis.

### `property render-3d.Vec3.z: number`

Depth axis, toward the viewer.

### `interface render-3d.View`

One camera onto the scene.

Views are the reason a scene with many rendered elements needs one engine
rather than many: every view in an engine shares a single graphics context,
so the number of views is bounded by memory rather than by the browser's cap
on live contexts, which is silently enforced by dropping the oldest.

### `property render-3d.View.height: number`

Current height in CSS pixels.

### `property render-3d.View.id: string`

This view's identity, as supplied or generated.

### `property render-3d.View.width: number`

Current width in CSS pixels.

### `method render-3d.View.capture(mimeType?: string): string`

Captures the last drawn frame as a data URL.

### `method render-3d.View.dispose(): void`

Releases the view's surface. The engine and its other views are unaffected.

### `method render-3d.View.invalidate(): void`

Marks the view as needing a redraw on the next frame.

### `method render-3d.View.pick(x: number, y: number): PickResult | undefined`

Resolves a pointer position in the view's CSS pixels to what it hit.

### `method render-3d.View.resize(width: number, height: number): void`

Changes the output size.

A resize is routine — a window, a panel, a zoom — so it is a first-class
operation rather than a reason to tear the view down and rebuild it.

### `method render-3d.View.setActive(active: boolean): void`

Shows or hides the view without disposing it. A hidden view costs nothing per frame.

### `method render-3d.View.setCamera(camera: CameraDescriptor): void`

Repoints the camera. Marks only this view dirty.

### `method render-3d.View.setLayers(layers: readonly string[] | undefined): void`

Changes which layers are drawn. Marks only this view dirty.

### `interface render-3d.ViewOptions`

Everything needed to open a view onto the scene.

### `property render-3d.ViewOptions.background?: number`

Background color. A transparent view is drawn when omitted.

### `property render-3d.ViewOptions.camera: CameraDescriptor`

How this view projects the world.

### `property render-3d.ViewOptions.height?: number`

Initial height in CSS pixels. Measured from `target` when omitted.

### `property render-3d.ViewOptions.id?: string`

Caller-chosen identity. Generated when omitted.

### `property render-3d.ViewOptions.layers?: readonly string[]`

Which layers this view draws, in the scene's order.

Omitting it draws every layer. Naming them explicitly is what lets the
engine skip a view entirely when the only thing that changed lives in a
layer this view never shows.

### `property render-3d.ViewOptions.target: HTMLElement`

Element that receives the view's output surface. Its contents are replaced.

### `property render-3d.ViewOptions.width?: number`

Initial size in CSS pixels. Measured from `target` when omitted.

### `interface render-3d.VisualDefinition`

A named, externally-supplied way of turning parameters into a drawable
description.

Registering a kind is the entire integration surface for anything the engine
does not know about. Two kinds that happen to draw the same way share the
same descriptor and cost the engine nothing extra; two kinds that mean
completely different things to the product are still just two entries here.

### `property render-3d.VisualDefinition.kind: string`

Stable name items reference. Must be unique within a registry.

### `method render-3d.VisualDefinition.describe(params: TParams): VisualDescriptor`

Produces the drawable description for a set of parameters.

### `method render-3d.VisualDefinition.equals(a: TParams, b: TParams): boolean`

Optional cheap comparison used to skip rebuilding an unchanged item.

Without it the engine falls back to reference equality on the parameters,
which is correct but conservative: a caller that rebuilds an equivalent
parameter object every frame would rebuild geometry every frame.

### `interface render-3d.VisualDescriptor`

A complete description of how to draw one item.

### `property render-3d.VisualDescriptor.geometry: GeometryDescriptor`

The shape drawn.

### `property render-3d.VisualDescriptor.material: MaterialDescriptor`

How that shape is drawn.

### `property render-3d.VisualDescriptor.pickable?: boolean`

Whether the item should be considered for pointer picking. Defaults to
`true`. Terrain under a fog layer, or a purely decorative overlay, sets
this to `false` so it never intercepts a click.

### `interface render-3d.VisualRef`

An item's reference to a registered kind, plus that kind's parameters.

### `property render-3d.VisualRef.kind: string`

Name of the registered kind that describes this item.

### `property render-3d.VisualRef.params: TParams`

Parameters handed to that kind's `describe`.

### `interface render-3d.VisualRegistry`

Lookup of visual kinds, owned by the caller and shared by every scene.

### `method render-3d.VisualRegistry.get(kind: string): VisualDefinition<never> | undefined`

Returns the definition for a kind, or `undefined` when it was never registered.

### `method render-3d.VisualRegistry.kinds(): readonly string[]`

Every registered kind name, in registration order.

### `method render-3d.VisualRegistry.register(definition: VisualDefinition<TParams>): void`

Registers a kind. Throws when the name is already taken.

### `type render-3d.CameraDescriptor = { far?: number; fov?: number; near?: number; position: Vec3; projection: "perspective"; target: Vec3; up?: Vec3 } | { extent: number; far?: number; near?: number; position: Vec3; projection: "orthographic"; target: Vec3; up?: Vec3 }`

How a view projects the world. Plain data; no renderer camera type is exposed.

### `type render-3d.ChangeOrigin = "local" | "remote" | "engine"`

Where a change came from.

Carried from the moment a change is made rather than inferred afterwards.
A renderer that reports its own placements the same way it reports the
user's produces feedback loops that are indistinguishable from real input,
and a network-authoritative caller has a third source to tell apart, not
just two.

### `type render-3d.ClockMode = "running" | "paused"`

How a clock is currently producing simulation time.

### `type render-3d.Easing = (t: number) => number`

Maps linear progress to eased progress. Both in `0..1`.

### `type render-3d.FrameObserver = (report: FrameReport) => void`

Called after every frame the engine runs.

### `type render-3d.GeometryDescriptor = { shape: "sprite" } | { depth: number; segments?: number; shape: "plane"; width: number } | { depth: number; height: number; shape: "box"; width: number } | { radius: number; segments?: number; shape: "sphere" } | { height: number; radius: number; segments?: number; shape: "cylinder" } | { field: HeightfieldData; shape: "heightfield" } | { data: MeshData; shape: "mesh" } | { positions: Float32Array; shape: "segments" }`

The shape half of a visual.

### `type render-3d.ItemId = string`

Caller-chosen identity for a scene item.

### `type render-3d.LayerId = string`

Caller-chosen identity for a draw group.

### `type render-3d.LightDescriptor = { color?: number; intensity?: number; light: "ambient" } | { color?: number; direction: Vec3; intensity?: number; light: "directional" } | { color?: number; distance?: number; intensity?: number; light: "point"; position: Vec3 }`

Scene lighting, as data. The engine ships no default lighting rig of its own.

### `type render-3d.MaterialDescriptor = { clippable?: boolean; color?: number; depthTest?: boolean; depthWrite?: boolean; doubleSided?: boolean; flatShading?: boolean; metalness?: number; opacity?: number; roughness?: number; surface: "lit"; texture?: TextureSource } | { clippable?: boolean; color?: number; depthTest?: boolean; depthWrite?: boolean; doubleSided?: boolean; opacity?: number; surface: "unlit"; texture?: TextureSource } | { color?: number; depthTest?: boolean; depthWrite?: boolean; opacity?: number; surface: "line" } | { color?: number; depthTest?: boolean; depthWrite?: boolean; opacity?: number; size?: number; sizeAttenuation?: boolean; surface: "points"; texture?: TextureSource }`

The appearance half of a visual.

### `type render-3d.SceneChange = { id: ItemId; layer: LayerId; origin: ChangeOrigin; type: "item-added" } | { id: ItemId; layer: LayerId; origin: ChangeOrigin; type: "item-removed" } | { id: ItemId; layer: LayerId; origin: ChangeOrigin; type: "item-transformed" } | { id: ItemId; layer: LayerId; origin: ChangeOrigin; type: "item-visual-changed" } | { layer: LayerId; origin: ChangeOrigin; type: "layer-changed" }`

A single mutation applied to the scene.

### `type render-3d.SceneObserver = (changes: readonly SceneChange[]) => void`

Notified after each batch of changes, with every change's origin intact.

### `type render-3d.TextureSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement`

An image source a material may sample. DOM types only; no renderer texture type is exposed.

### `type render-3d.TrackId = string`

Animation is defined as "a function of simulated progress that writes to the
scene", and nothing more.

That definition is what makes pause, slow motion, and discrete turns free
rather than special cases: a track never reads real time, so it cannot tell
whether its progress came from a real-time frame or from a single
Clock.advance resolving an entire turn at once.

### `type render-3d.ViewId = string`

Caller-chosen identity for a view.

### `variable render-3d.DISTANCE_RANGE: { max: 60; min: 0.5 }`

The closest and furthest the camera may be pulled.

### `variable render-3d.easings: Readonly<Record<"linear" | "easeIn" | "easeOut" | "easeInOut", Easing>>`

Replaceable easing defaults.

These are conveniences, not policy: a track supplies its own curve whenever
the product's motion language calls for one, and nothing here is applied
unless a track asks for it.

### `variable render-3d.gridVisual: VisualDefinition<GridParams>`

A replaceable default for a bounded ground-plane reference grid, on
`y = 0`, spanning `[-extent, extent]` on both X and Z with a line every
`cellSize` units.

It is here, generic and product-agnostic, for the same reason
heightfieldVisual is: a reference/board grid is not specific to
any one product's meaning, only its placement and color are. A product
that wants a different default (e.g. a camera-anchored infinite-grid
shader instead of bounded line geometry) registers its own kind under a
different name and this one costs it nothing.

### `variable render-3d.heightfieldVisual: VisualDefinition<HeightfieldParams>`

A replaceable default for the most common surface shape: a regular grid of
elevation samples.

It is here because a grid of heights is genuinely generic — it is terrain,
but it is equally a fluid surface, a deformation field, or a heatmap — and
not because the engine has any opinion about what a caller draws. A product
that wants different shading registers its own kind under a different name
and this one costs it nothing.

### `variable render-3d.IDENTITY_TRANSFORM: Required<Pick<Transform, "position" | "rotation">> & { scale: number }`

The origin-of-identity transform, used when an item supplies none.

### `variable render-3d.PITCH_LIMIT: number`

How close to straight up or down the camera may get.

Not a matter of taste: at exactly the pole the view direction is parallel to
the up vector and the camera's orientation stops being defined, which shows
up as the view flipping. Stopping just short of it costs nothing.

### `function render-3d.attachOrbit(element: HTMLElement, view: OrbitableView, initial: OrbitState, options: OrbitOptions): () => void`

Makes `element` drive `view`'s camera by dragging and scrolling.

Returns a function that detaches every listener. Callers must call it on
unmount; a trial that re-mounts its engine would otherwise accumulate
listeners driving a disposed view.

### `function render-3d.createAnimator(scene: Scene): Animator`

Creates the driver that turns simulated time into scene writes.

It never reads a real clock. Everything it does is a pure function of the
interval it is handed, so the same track produces the same result whether
that interval arrived as sixty small real-time steps or as one deliberate
turn-sized step.

### `function render-3d.createClock(options: ClockOptions): Clock`

Creates the engine's time authority.

A real-time caller calls Clock.sample once a frame and never touches
anything else. A turn-based caller creates the clock paused and calls
Clock.advance when a turn resolves. Both produce the same tick shape,
so nothing downstream needs to know which one it is serving.

### `function render-3d.createEngine(options: EngineOptions): RenderEngine`

Creates an engine: one graphics context, one world, many views.

The single context is the load-bearing decision. Browsers cap live WebGL
contexts — for many it is as low as eight — and enforce the cap by silently
dropping the oldest, so a design that spends one context per rendered
element does not fail with an error, it fails by having things vanish. Here
every view shares this engine's one context and is presented into its own
2D surface, so the number of simultaneous views is bounded by memory.

This file owns scheduling, invalidation, and lifetime. It does not import a
renderer; everything that draws sits behind RenderBackend.

### `function render-3d.createInvalidationTracker(): InvalidationTracker`

Creates the per-frame change accumulator.

### `function render-3d.createScene(): Scene`

Creates the mutable world.

The scene holds no graphics state at all. It can be built, mutated, and
asserted on with no browser and no context, which is what lets the rules a
product cares about be tested without a renderer being involved.

### `function render-3d.createVisualRegistry(definitions: readonly VisualDefinition<never>[]): VisualRegistry`

Creates a lookup of visual kinds.

A registry is the whole integration surface for anything this package does
not know about. It is created by the caller and may be shared across engines,
so a separate package can populate one — defining what its own concepts look
like — and hand it over without either package importing the other.

### `function render-3d.lerp(min: number, max: number, fraction: number): number`

Linear interpolation: `fraction` of the way from `min` to `max`.

### `function render-3d.mergeMeshChunks(pieces: readonly MeshData[]): MeshData`

Concatenates several meshes into one buffer, offsetting each piece's
indices past everything already appended.

Pure array arithmetic, useful to any caller batching many small meshes
into one draw call — not something specific to any one product's idea of
a "chunk". A caller that groups geometry into spatial buckets (a chunked
terrain, a merged prop cluster, anything else that wants one buffer per
bucket) calls this once per bucket.

A piece without its own `indices` is a flat triangle list (`GeometryDescriptor`'s
own "positions read sequentially when omitted" rule) — merged as an
implicit `0..n-1` index run, never by dropping indices from every *other*
piece just because one piece lacks them; that would silently discard the
shared-vertex structure indexed pieces depend on.

### `function render-3d.mulberry32(seed: number): () => number`

A small, self-contained PRNG (mulberry32) rather than `Math.random` --
seeded deterministically, so the same seed always produces the same
sequence. That is what makes procedural visual variation (a room's shape,
a scatter of instances, a jittered grid) reproducible in tests and
replayable across a reload, instead of flaky.

### `function render-3d.orbitDrag(state: OrbitState, dx: number, dy: number, radiansPerPixel: number): OrbitState`

Applies a drag, in pixels, to an orbit.

### `function render-3d.orbitFromCamera(position: Vec3, target: Vec3): OrbitState`

Recovers an orbit from a camera already pointed somewhere.

Lets a trial keep the framing it was authored with instead of snapping to a
default the moment orbiting is switched on.

### `function render-3d.orbitPan(state: OrbitState, dx: number, dy: number, unitsPerPixel: number): OrbitState`

Applies a drag, in pixels, as a lateral pan -- translating the orbited
target across the view plane instead of rotating around it.

Every reference in `docs/research/vtt-board-construction-mode-ui-references.md`
and `docs/research/godview-builder-game-construction-ui-references.md` offers
this as a gesture independent of orbit (RMB/MMB-drag or WASD), so it is a
second pure function beside orbitDrag rather than a mode of it.

Scaled by the current distance, like orbitZoom, so a pixel of drag
moves the same apparent amount of world regardless of how far the camera has
zoomed -- an unscaled pan would crawl when zoomed out and overshoot when
zoomed in. The camera keeps its yaw, pitch, and distance; only `target`
(and therefore the derived position, rigidly) moves.

Convention: the world follows the cursor, like grabbing the ground and
pulling it -- dragging right brings what was to the right into view, and
dragging down (screen y grows downward, per orbitDrag's own
convention) brings what was below into view. Achieving that means the
*camera* moves opposite the drag along `right`, and with the drag along
`up`.

### `function render-3d.orbitPosition(state: OrbitState): Vec3`

Where the camera sits for a given orbit.

### `function render-3d.orbitZoom(state: OrbitState, delta: number, factorPerNotch: number): OrbitState`

Applies a wheel notch to an orbit.

Multiplicative rather than additive, so a notch moves the same *proportion*
of the way in at every scale. Additive zoom crawls when far out and slams
into the target when close.
