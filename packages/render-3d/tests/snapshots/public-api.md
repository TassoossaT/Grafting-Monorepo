# Generated TypeScript public API baseline

Package: `@grafting/render-3d`  
TypeScript: `5.9.3`  
Source entry point: `src/index.ts`  
Documentation policy: every exported declaration and public member requires TSDoc  
Forbidden public modules: `three`

## Declaration entry point

```ts
/** Grafting-owned spatial primitives. No renderer type appears in this file. */
/** A point or direction in engine space. */
export interface Vec3 {
    /** Rightward axis. */
    readonly x: number;
    /** Upward axis. */
    readonly y: number;
    /** Depth axis, toward the viewer. */
    readonly z: number;
}
/** Rotation in radians, applied in XYZ order. */
export interface Euler {
    /** Pitch, in radians. */
    readonly x: number;
    /** Yaw, in radians. */
    readonly y: number;
    /** Roll, in radians. */
    readonly z: number;
}
/** Placement of a scene item. Every field is optional; omitted fields keep their identity value. */
export interface Transform {
    /** Placement in engine space. Defaults to the origin. */
    readonly position?: Vec3;
    /** Orientation. Defaults to unrotated. */
    readonly rotation?: Euler;
    /** Uniform scale when a number, per-axis when a {@link Vec3}. Defaults to `1`. */
    readonly scale?: number | Vec3;
}
/** The origin-of-identity transform, used when an item supplies none. */
export declare const IDENTITY_TRANSFORM: Required<Pick<Transform, "position" | "rotation">> & {
    readonly scale: number;
};

/** Grafting-owned spatial primitives. No renderer type appears in this file. */
/** A point or direction in engine space. */
export interface Vec3 {
    /** Rightward axis. */
    readonly x: number;
    /** Upward axis. */
    readonly y: number;
    /** Depth axis, toward the viewer. */
    readonly z: number;
}
/** Rotation in radians, applied in XYZ order. */
export interface Euler {
    /** Pitch, in radians. */
    readonly x: number;
    /** Yaw, in radians. */
    readonly y: number;
    /** Roll, in radians. */
    readonly z: number;
}
/** Placement of a scene item. Every field is optional; omitted fields keep their identity value. */
export interface Transform {
    /** Placement in engine space. Defaults to the origin. */
    readonly position?: Vec3;
    /** Orientation. Defaults to unrotated. */
    readonly rotation?: Euler;
    /** Uniform scale when a number, per-axis when a {@link Vec3}. Defaults to `1`. */
    readonly scale?: number | Vec3;
}
/** The origin-of-identity transform, used when an item supplies none. */
export declare const IDENTITY_TRANSFORM: Required<Pick<Transform, "position" | "rotation">> & {
    readonly scale: number;
};

/**
 * The engine's time authority.
 *
 * Nothing time-driven may read `performance.now` or drive itself from
 * `requestAnimationFrame` directly. Everything reads simulation time from a
 * clock, which is what makes pausing, slow motion, and discrete turn stepping
 * a property of the engine rather than a feature each caller reimplements.
 *
 * Real time and simulation time are deliberately separate. A paused clock
 * still reports real time advancing, so a camera can keep moving, a hover
 * highlight can keep responding, and a frame can still be drawn while the
 * simulated world is frozen.
 */
/** How a clock is currently producing simulation time. */
export type ClockMode = 
/** Simulation time follows real time, scaled by {@link Clock.rate}. */
"running"
/** Simulation time is frozen. Only {@link Clock.advance} moves it. */
 | "paused";
/** One observation of time, handed to every listener on a frame. */
export interface ClockTick {
    /** Monotonic frame counter, incremented once per {@link Clock.sample}. */
    readonly frame: number;
    /** Wall-clock milliseconds since the clock was created. Advances while paused. */
    readonly realElapsed: number;
    /** Wall-clock milliseconds since the previous sample. Advances while paused. */
    readonly realDelta: number;
    /** Simulated milliseconds since the clock was created. Frozen while paused. */
    readonly simElapsed: number;
    /**
     * Simulated milliseconds since the previous sample. Always `0` while paused,
     * except on the sample that follows an explicit {@link Clock.advance}.
     */
    readonly simDelta: number;
}
/** Time source shared by animation, simulation, and any caller-owned stepping. */
export interface Clock {
    /** Current mode. */
    readonly mode: ClockMode;
    /** Simulation-time multiplier while running. `1` is real time; `0.25` is quarter speed. */
    readonly rate: number;
    /** The most recent tick, or the zero tick before the first sample. */
    readonly last: ClockTick;
    /** Resumes simulation time. No-op when already running. */
    play(): void;
    /** Freezes simulation time. Real time keeps advancing. No-op when already paused. */
    pause(): void;
    /** Sets the simulation-time multiplier. Must be finite and non-negative. */
    setRate(rate: number): void;
    /**
     * Injects a fixed simulation step, independent of mode and rate.
     *
     * This is the turn-based entry point: a caller that never calls
     * {@link Clock.play} drives the whole world by resolving a turn into a
     * single `advance`, and gets identical animation behaviour to a real-time
     * caller without the engine knowing which it is.
     */
    advance(simMilliseconds: number): void;
    /**
     * Produces the next tick from a real-time reading, in milliseconds.
     *
     * Called once per frame by whoever owns the frame loop. Any simulation time
     * queued by {@link Clock.advance} is released into this tick's `simDelta`.
     */
    sample(realNow: number): ClockTick;
}

import type { Clock } from "../contracts/clock.js";
/** Options for {@link createClock}. */
export interface ClockOptions {
    /** Whether simulation time starts advancing. Defaults to `true`. */
    readonly autoplay?: boolean;
    /** Initial simulation-time multiplier. Defaults to `1`. */
    readonly rate?: number;
}
/**
 * Creates the engine's time authority.
 *
 * A real-time caller calls {@link Clock.sample} once a frame and never touches
 * anything else. A turn-based caller creates the clock paused and calls
 * {@link Clock.advance} when a turn resolves. Both produce the same tick shape,
 * so nothing downstream needs to know which one it is serving.
 */
export declare function createClock(options?: ClockOptions): Clock;

import type { Clock } from "../contracts/clock.js";
/** Options for {@link createClock}. */
export interface ClockOptions {
    /** Whether simulation time starts advancing. Defaults to `true`. */
    readonly autoplay?: boolean;
    /** Initial simulation-time multiplier. Defaults to `1`. */
    readonly rate?: number;
}
/**
 * Creates the engine's time authority.
 *
 * A real-time caller calls {@link Clock.sample} once a frame and never touches
 * anything else. A turn-based caller creates the clock paused and calls
 * {@link Clock.advance} when a turn resolves. Both produce the same tick shape,
 * so nothing downstream needs to know which one it is serving.
 */
export declare function createClock(options?: ClockOptions): Clock;

/**
 * How something is drawn, described as data.
 *
 * The engine has no notion of what a scene item *is*. It knows only that an
 * item names a registered visual kind and carries parameters for it. Whether
 * that kind means a character marker, a wall segment, a volume of water, or a
 * spell effect is decided entirely outside this package, by whoever registers
 * the kind — including a separate package that this one never imports.
 *
 * Descriptors are plain data on purpose. A renderer-specific object would make
 * the extension point a vendor boundary, forcing every consumer that wants a
 * new shape to import the renderer. Data keeps the renderer private (DEC-049)
 * and keeps the engine replaceable underneath.
 */
/** Packed vertex data for a caller-built shape. */
export interface MeshData {
    /** Flat `xyz` triples, three floats per vertex. */
    readonly positions: Float32Array;
    /** Optional flat `xyz` normal triples. Computed from faces when omitted. */
    readonly normals?: Float32Array;
    /** Optional flat `uv` pairs, two floats per vertex. */
    readonly uvs?: Float32Array;
    /** Optional triangle indices. Positions are read sequentially when omitted. */
    readonly indices?: Uint16Array | Uint32Array;
}
/** A regular grid of elevation samples, the shape a terrain or a fluid surface takes. */
export interface HeightfieldData {
    /** Sample count along the X axis. */
    readonly width: number;
    /** Sample count along the Z axis. */
    readonly depth: number;
    /** Row-major elevation samples, `width * depth` of them. */
    readonly values: Float32Array;
    /** World-space span of the grid on both axes. Defaults to `width`/`depth`. */
    readonly size?: {
        readonly x: number;
        readonly z: number;
    };
    /** Multiplier applied to each sample before it becomes a vertex height. Defaults to `1`. */
    readonly elevationScale?: number;
}
/** The shape half of a visual. */
export type GeometryDescriptor = {
    /**
     * A camera-facing unit square. Its world size comes from the item's
     * transform scale, and an optional unlit texture supplies its shape.
     */
    readonly shape: "sprite";
} | {
    readonly shape: "plane";
    readonly width: number;
    readonly depth: number;
    readonly segments?: number;
} | {
    readonly shape: "box";
    readonly width: number;
    readonly height: number;
    readonly depth: number;
} | {
    readonly shape: "sphere";
    readonly radius: number;
    readonly segments?: number;
} | {
    readonly shape: "cylinder";
    readonly radius: number;
    readonly height: number;
    readonly segments?: number;
} | {
    readonly shape: "heightfield";
    readonly field: HeightfieldData;
} | {
    readonly shape: "mesh";
    readonly data: MeshData;
} | {
    /**
     * Explicit line segments: consecutive pairs of `xyz` triples, two
     * vertices per segment.
     *
     * Distinct from pairing another geometry with a `line` material, which
     * derives edges from that geometry's *triangles* and therefore shows
     * every internal split. When the edges are the subject — a grid, a
     * route, a boundary, a debug overlay — the caller already knows which
     * ones exist and does not want them rediscovered from triangulation.
     */
    readonly shape: "segments";
    readonly positions: Float32Array;
};
/** An image source a material may sample. DOM types only; no renderer texture type is exposed. */
export type TextureSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement;
/** The appearance half of a visual. */
export type MaterialDescriptor = {
    /** Responds to scene lighting. */
    readonly surface: "lit";
    readonly color?: number;
    readonly opacity?: number;
    /** Whether existing scene depth may occlude this material. Defaults to `true`. */
    readonly depthTest?: boolean;
    /** Whether drawing this material updates the scene depth buffer. Defaults to `true`. */
    readonly depthWrite?: boolean;
    readonly metalness?: number;
    readonly roughness?: number;
    readonly flatShading?: boolean;
    readonly doubleSided?: boolean;
    readonly texture?: TextureSource;
    /** Whether the engine's active clip plane, if any, cuts this material. Defaults to `false`. */
    readonly clippable?: boolean;
} | {
    /** Ignores scene lighting. The right choice for overlays, grids, and markers. */
    readonly surface: "unlit";
    readonly color?: number;
    readonly opacity?: number;
    /** Whether existing scene depth may occlude this material. Defaults to `true`. */
    readonly depthTest?: boolean;
    /** Whether drawing this material updates the scene depth buffer. Defaults to `true`. */
    readonly depthWrite?: boolean;
    readonly doubleSided?: boolean;
    readonly texture?: TextureSource;
    /** Whether the engine's active clip plane, if any, cuts this material. Defaults to `false`. */
    readonly clippable?: boolean;
} | {
    /** Draws edges rather than faces. */
    readonly surface: "line";
    readonly color?: number;
    readonly opacity?: number;
    /** Whether existing scene depth may occlude this material. Defaults to `true`. */
    readonly depthTest?: boolean;
    /** Whether drawing this material updates the scene depth buffer. Defaults to `true`. */
    readonly depthWrite?: boolean;
} | {
    /**
     * Draws each of the geometry's vertices as a point, filling nothing.
     *
     * Pairs with *any* geometry, which is the useful part: the same
     * heightfield or mesh a caller already has can be drawn as a cloud of
     * points instead of a solid surface, with no second copy of the data.
     *
     * Points convey silhouette and volume while being structurally unable to
     * carry surface detail. That makes this the right primitive whenever
     * something must be shown to exist without being shown in full — a
     * partially-known space, a scan, a preview of data not yet resolved.
     */
    readonly surface: "points";
    readonly color?: number;
    readonly opacity?: number;
    /** Whether existing scene depth may occlude this material. Defaults to `true`. */
    readonly depthTest?: boolean;
    /** Whether drawing this material updates the scene depth buffer. Defaults to `true`. */
    readonly depthWrite?: boolean;
    /** Point size. In world units when attenuated, in pixels when not. Defaults to `1`. */
    readonly size?: number;
    /** Whether points shrink with distance. Defaults to `true`. */
    readonly sizeAttenuation?: boolean;
    /** Sprite applied to each point, for soft or shaped points rather than squares. */
    readonly texture?: TextureSource;
};
/** A complete description of how to draw one item. */
export interface VisualDescriptor {
    /** The shape drawn. */
    readonly geometry: GeometryDescriptor;
    /** How that shape is drawn. */
    readonly material: MaterialDescriptor;
    /**
     * Whether the item should be considered for pointer picking. Defaults to
     * `true`. Terrain under a fog layer, or a purely decorative overlay, sets
     * this to `false` so it never intercepts a click.
     */
    readonly pickable?: boolean;
}
/**
 * A named, externally-supplied way of turning parameters into a drawable
 * description.
 *
 * Registering a kind is the entire integration surface for anything the engine
 * does not know about. Two kinds that happen to draw the same way share the
 * same descriptor and cost the engine nothing extra; two kinds that mean
 * completely different things to the product are still just two entries here.
 */
export interface VisualDefinition<TParams = unknown> {
    /** Stable name items reference. Must be unique within a registry. */
    readonly kind: string;
    /** Produces the drawable description for a set of parameters. */
    describe(params: TParams): VisualDescriptor;
    /**
     * Optional cheap comparison used to skip rebuilding an unchanged item.
     *
     * Without it the engine falls back to reference equality on the parameters,
     * which is correct but conservative: a caller that rebuilds an equivalent
     * parameter object every frame would rebuild geometry every frame.
     */
    equals?(a: TParams, b: TParams): boolean;
}
/** An item's reference to a registered kind, plus that kind's parameters. */
export interface VisualRef<TParams = unknown> {
    /** Name of the registered kind that describes this item. */
    readonly kind: string;
    /** Parameters handed to that kind's `describe`. */
    readonly params: TParams;
}
/** Lookup of visual kinds, owned by the caller and shared by every scene. */
export interface VisualRegistry {
    /** Registers a kind. Throws when the name is already taken. */
    register<TParams>(definition: VisualDefinition<TParams>): void;
    /** Returns the definition for a kind, or `undefined` when it was never registered. */
    get(kind: string): VisualDefinition<never> | undefined;
    /** Every registered kind name, in registration order. */
    kinds(): readonly string[];
}

import type { VisualDefinition, VisualRegistry } from "../contracts/visual.js";
/**
 * Creates a lookup of visual kinds.
 *
 * A registry is the whole integration surface for anything this package does
 * not know about. It is created by the caller and may be shared across engines,
 * so a separate package can populate one — defining what its own concepts look
 * like — and hand it over without either package importing the other.
 */
export declare function createVisualRegistry(definitions?: readonly VisualDefinition<never>[]): VisualRegistry;

import type { Transform } from "./space.js";
import type { VisualRef } from "./visual.js";
/** Caller-chosen identity for a scene item. */
export type ItemId = string;
/** Caller-chosen identity for a draw group. */
export type LayerId = string;
/**
 * Where a change came from.
 *
 * Carried from the moment a change is made rather than inferred afterwards.
 * A renderer that reports its own placements the same way it reports the
 * user's produces feedback loops that are indistinguishable from real input,
 * and a network-authoritative caller has a third source to tell apart, not
 * just two.
 */
export type ChangeOrigin = 
/** The local user did this, through direct interaction. */
"local"
/** An authority elsewhere did this; it arrived over the wire. */
 | "remote"
/** The engine itself did this — placement, animation, layout. Never user input. */
 | "engine";
/**
 * An ordered draw group.
 *
 * Layers are the unit of invalidation as well as of ordering: a view redraws
 * when a layer it draws has changed, so a change confined to one layer cannot
 * force unrelated content to be redrawn. Declaring which layers exist and what
 * they mean is the caller's job; the engine ships no layer names of its own.
 */
export interface LayerDefinition {
    /** Caller-chosen name, unique within a scene. */
    readonly id: LayerId;
    /** Draw order. Lower draws first, so higher values appear on top. */
    readonly order: number;
    /** Whether the layer is drawn at all. Defaults to `true`. */
    readonly visible?: boolean;
    /** Multiplies every item's opacity in this layer. Defaults to `1`. */
    readonly opacity?: number;
    /** Whether items in this layer can be picked. Defaults to `true`. */
    readonly pickable?: boolean;
}
/** One drawable thing placed in the world. */
export interface SceneItem<TParams = unknown> {
    /** Caller-chosen identity, stable across updates to this item. */
    readonly id: ItemId;
    /** The registered visual kind and its parameters. */
    readonly visual: VisualRef<TParams>;
    /** Which draw group the item belongs to. */
    readonly layer: LayerId;
    /** Placement. Defaults to the identity transform. */
    readonly transform?: Transform;
    /** Whether the item is drawn. Defaults to `true`. */
    readonly visible?: boolean;
    /**
     * Opaque caller data carried through unchanged.
     *
     * The engine never reads this. It exists so a pick result can be traced back
     * to whatever the caller considers the real entity, without the engine
     * needing a concept of one.
     */
    readonly data?: unknown;
}
/** A single mutation applied to the scene. */
export type SceneChange = {
    readonly type: "item-added";
    readonly id: ItemId;
    readonly layer: LayerId;
    readonly origin: ChangeOrigin;
} | {
    readonly type: "item-removed";
    readonly id: ItemId;
    readonly layer: LayerId;
    readonly origin: ChangeOrigin;
} | {
    readonly type: "item-transformed";
    readonly id: ItemId;
    readonly layer: LayerId;
    readonly origin: ChangeOrigin;
} | {
    readonly type: "item-visual-changed";
    readonly id: ItemId;
    readonly layer: LayerId;
    readonly origin: ChangeOrigin;
} | {
    readonly type: "layer-changed";
    readonly layer: LayerId;
    readonly origin: ChangeOrigin;
};
/** Notified after each batch of changes, with every change's origin intact. */
export type SceneObserver = (changes: readonly SceneChange[]) => void;
/** The mutable world. Holds no renderer state and can be driven headlessly. */
export interface Scene {
    /** Declares or replaces a draw group. */
    defineLayer(layer: LayerDefinition, origin?: ChangeOrigin): void;
    /** Every declared layer, sorted by draw order. */
    layers(): readonly LayerDefinition[];
    /** Adds an item, or replaces one with the same id. */
    put<TParams>(item: SceneItem<TParams>, origin?: ChangeOrigin): void;
    /** Removes an item. Returns whether it existed. */
    remove(id: ItemId, origin?: ChangeOrigin): boolean;
    /** Reads an item without copying it. */
    get(id: ItemId): SceneItem | undefined;
    /** Every item in a layer, or every item when no layer is given. */
    items(layer?: LayerId): readonly SceneItem[];
    /** Moves an item, touching nothing else. */
    setTransform(id: ItemId, transform: Transform, origin?: ChangeOrigin): void;
    /** Replaces an item's visual parameters, keeping its placement. */
    setVisualParams(id: ItemId, params: unknown, origin?: ChangeOrigin): void;
    /** Shows or hides an item. */
    setVisible(id: ItemId, visible: boolean, origin?: ChangeOrigin): void;
    /**
     * Groups several mutations into one notification.
     *
     * Applying a turn's worth of changes inside one batch produces a single
     * observer call and a single redraw, rather than one of each per change.
     */
    batch(mutate: () => void, origin?: ChangeOrigin): void;
    /** Subscribes to changes. Returns an unsubscribe function. */
    observe(observer: SceneObserver): () => void;
    /** Drops every item and layer. */
    clear(origin?: ChangeOrigin): void;
}

import type { Scene } from "../contracts/scene.js";
/**
 * Creates the mutable world.
 *
 * The scene holds no graphics state at all. It can be built, mutated, and
 * asserted on with no browser and no context, which is what lets the rules a
 * product cares about be tested without a renderer being involved.
 */
export declare function createScene(): Scene;

import type { ChangeOrigin, Scene } from "./scene.js";
/**
 * Animation is defined as "a function of simulated progress that writes to the
 * scene", and nothing more.
 *
 * That definition is what makes pause, slow motion, and discrete turns free
 * rather than special cases: a track never reads real time, so it cannot tell
 * whether its progress came from a real-time frame or from a single
 * {@link Clock.advance} resolving an entire turn at once.
 */
export type TrackId = string;
/** Maps linear progress to eased progress. Both in `0..1`. */
export type Easing = (t: number) => number;
/** One time-driven change to the scene. */
export interface AnimationTrack {
    /** Caller-chosen identity. Playing the same id again replaces the running track. */
    readonly id: TrackId;
    /** Simulated milliseconds from start to completion. Must be greater than zero. */
    readonly durationMs: number;
    /** Whether the track restarts on completion instead of finishing. Defaults to `false`. */
    readonly loop?: boolean;
    /** Applied to progress before {@link AnimationTrack.apply}. Linear when omitted. */
    readonly easing?: Easing;
    /**
     * Writes this track's state for the given eased progress.
     *
     * Called with `1` exactly once on completion, so a track never has to
     * defend against ending slightly short of its final value.
     */
    apply(progress: number, scene: Scene): void;
    /** Called once after the final `apply`, for a track that needs to clean up. */
    onComplete?(scene: Scene): void;
}
/** A track in flight. */
export interface RunningTrack {
    /** Which track this reports on. */
    readonly id: TrackId;
    /** Simulated milliseconds elapsed within the track. */
    readonly elapsedMs: number;
    /** Linear progress in `0..1`, before easing. */
    readonly progress: number;
}
/** Drives tracks from simulated time and writes their results into a scene. */
export interface Animator {
    /**
     * Starts a track, replacing any running track with the same id.
     *
     * Replacement rather than stacking is deliberate: two tracks writing the
     * same property is a bug that is very hard to see and trivial to cause.
     */
    play(track: AnimationTrack): void;
    /** Stops a track. `settle` applies its final value first. Returns whether it was running. */
    stop(id: TrackId, settle?: boolean): boolean;
    /** Whether a track is currently running. */
    isPlaying(id: TrackId): boolean;
    /** Every track in flight. */
    running(): readonly RunningTrack[];
    /**
     * Advances every track by a simulated interval and applies the results.
     *
     * The engine calls this once per frame with the clock's `simDelta`, which is
     * `0` while paused. Callers driving their own loop may call it directly.
     */
    advance(simDeltaMs: number): void;
    /** Stops every track without settling. */
    clear(): void;
    /** The origin recorded for scene writes made by tracks. Always `"engine"`. */
    readonly origin: ChangeOrigin;
}

import type { Animator } from "../contracts/animation.js";
import type { Scene } from "../contracts/scene.js";
/**
 * Creates the driver that turns simulated time into scene writes.
 *
 * It never reads a real clock. Everything it does is a pure function of the
 * interval it is handed, so the same track produces the same result whether
 * that interval arrived as sixty small real-time steps or as one deliberate
 * turn-sized step.
 */
export declare function createAnimator(scene: Scene): Animator;

import type { Easing } from "../contracts/animation.js";
/**
 * Replaceable easing defaults.
 *
 * These are conveniences, not policy: a track supplies its own curve whenever
 * the product's motion language calls for one, and nothing here is applied
 * unless a track asks for it.
 */
export declare const easings: Readonly<Record<"linear" | "easeIn" | "easeOut" | "easeInOut", Easing>>;

import type { LayerId } from "./scene.js";
import type { Vec3 } from "./space.js";
/** Caller-chosen identity for a view. */
export type ViewId = string;
/** How a view projects the world. Plain data; no renderer camera type is exposed. */
export type CameraDescriptor = {
    readonly projection: "perspective";
    /** Vertical field of view in degrees. Defaults to `45`. */
    readonly fov?: number;
    readonly position: Vec3;
    readonly target: Vec3;
    readonly near?: number;
    readonly far?: number;
    readonly up?: Vec3;
} | {
    readonly projection: "orthographic";
    /** Half-height of the visible volume in world units. Width follows the aspect ratio. */
    readonly extent: number;
    readonly position: Vec3;
    readonly target: Vec3;
    readonly near?: number;
    readonly far?: number;
    readonly up?: Vec3;
};
/** What a pointer hit. */
export interface PickResult {
    /** Which item was hit. */
    readonly itemId: string;
    /** The layer that item belongs to. */
    readonly layer: LayerId;
    /** World-space intersection point. */
    readonly point: Vec3;
    /** Distance from the camera, in world units. */
    readonly distance: number;
    /** The item's opaque caller data, carried through unchanged. */
    readonly data?: unknown;
}
/** Everything needed to open a view onto the scene. */
export interface ViewOptions {
    /** Caller-chosen identity. Generated when omitted. */
    readonly id?: ViewId;
    /** Element that receives the view's output surface. Its contents are replaced. */
    readonly target: HTMLElement;
    /** How this view projects the world. */
    readonly camera: CameraDescriptor;
    /**
     * Which layers this view draws, in the scene's order.
     *
     * Omitting it draws every layer. Naming them explicitly is what lets the
     * engine skip a view entirely when the only thing that changed lives in a
     * layer this view never shows.
     */
    readonly layers?: readonly LayerId[];
    /** Background color. A transparent view is drawn when omitted. */
    readonly background?: number;
    /** Initial size in CSS pixels. Measured from `target` when omitted. */
    readonly width?: number;
    /** Initial height in CSS pixels. Measured from `target` when omitted. */
    readonly height?: number;
}
/**
 * One camera onto the scene.
 *
 * Views are the reason a scene with many rendered elements needs one engine
 * rather than many: every view in an engine shares a single graphics context,
 * so the number of views is bounded by memory rather than by the browser's cap
 * on live contexts, which is silently enforced by dropping the oldest.
 */
export interface View {
    /** This view's identity, as supplied or generated. */
    readonly id: ViewId;
    /** Current width in CSS pixels. */
    readonly width: number;
    /** Current height in CSS pixels. */
    readonly height: number;
    /** Repoints the camera. Marks only this view dirty. */
    setCamera(camera: CameraDescriptor): void;
    /** Changes which layers are drawn. Marks only this view dirty. */
    setLayers(layers: readonly LayerId[] | undefined): void;
    /**
     * Changes the output size.
     *
     * A resize is routine — a window, a panel, a zoom — so it is a first-class
     * operation rather than a reason to tear the view down and rebuild it.
     */
    resize(width: number, height: number): void;
    /** Marks the view as needing a redraw on the next frame. */
    invalidate(): void;
    /** Shows or hides the view without disposing it. A hidden view costs nothing per frame. */
    setActive(active: boolean): void;
    /** Resolves a pointer position in the view's CSS pixels to what it hit. */
    pick(x: number, y: number): PickResult | undefined;
    /** Captures the last drawn frame as a data URL. */
    capture(mimeType?: string): string;
    /** Releases the view's surface. The engine and its other views are unaffected. */
    dispose(): void;
}

import type { Animator } from "./animation.js";
import type { Clock, ClockTick } from "./clock.js";
import type { Scene } from "./scene.js";
import type { Vec3 } from "./space.js";
import type { VisualRegistry } from "./visual.js";
import type { View, ViewOptions } from "./view.js";
/** Scene lighting, as data. The engine ships no default lighting rig of its own. */
export type LightDescriptor = {
    readonly light: "ambient";
    readonly color?: number;
    readonly intensity?: number;
} | {
    readonly light: "directional";
    readonly color?: number;
    readonly intensity?: number;
    readonly direction: Vec3;
} | {
    readonly light: "point";
    readonly color?: number;
    readonly intensity?: number;
    readonly position: Vec3;
    readonly distance?: number;
};
/**
 * A single cutting plane, as data. Points where `dot(normal, point) +
 * constant >= 0` is false are cut away.
 *
 * Engine-global: the active plane cuts every item whose material opted in
 * via `MaterialDescriptor.clippable`, across every view. Independent
 * per-view clip heights are not supported by this contract.
 */
export interface ClipPlaneDescriptor {
    /** Unit normal of the cutting plane. */
    readonly normal: Vec3;
    /** Signed offset in the plane equation `dot(normal, point) + constant >= 0`. */
    readonly constant: number;
}
/** What the engine did during one frame. Reported for measurement, not for control flow. */
export interface FrameReport {
    /** The clock reading this frame ran at. */
    readonly tick: ClockTick;
    /** Views actually redrawn this frame. */
    readonly viewsDrawn: number;
    /** Views skipped because nothing they draw had changed. */
    readonly viewsSkipped: number;
    /** Item visuals rebuilt this frame. */
    readonly visualsRebuilt: number;
    /**
     * Whether the graphics context was unusable during this frame.
     *
     * Nothing is drawn while this is true. The engine rebuilds everything from
     * the scene once the context comes back, so a caller normally only needs
     * this to surface the condition to the user.
     */
    readonly contextLost: boolean;
}
/** Called after every frame the engine runs. */
export type FrameObserver = (report: FrameReport) => void;
/** Everything needed to stand an engine up. */
export interface EngineOptions {
    /** Shared visual kinds. A private empty registry is created when omitted. */
    readonly registry?: VisualRegistry;
    /** Initial lighting. Unlit materials do not require any. */
    readonly lights?: readonly LightDescriptor[];
    /** Device pixel ratio ceiling. Defaults to `2`. */
    readonly maxPixelRatio?: number;
    /** Whether the clock starts running. Defaults to `true`; a turn-based caller passes `false`. */
    readonly autoplay?: boolean;
}
/**
 * One graphics context, one world, many views.
 *
 * The engine owns the frame loop and decides what is worth redrawing. It has
 * no opinion about what the world contains: every drawable thing arrives
 * through a visual kind registered from outside, every draw group is named by
 * the caller, and every unit of time comes from a clock the caller can pause
 * or step by hand.
 */
export interface RenderEngine {
    /** The mutable world. */
    readonly scene: Scene;
    /** The time authority. */
    readonly clock: Clock;
    /** Time-driven writers into the scene. */
    readonly animator: Animator;
    /** Visual kinds available to this engine's items. */
    readonly registry: VisualRegistry;
    /** Whether the graphics context is currently lost. Nothing draws while true. */
    readonly contextLost: boolean;
    /** Replaces the lighting. Marks every lit view dirty. */
    setLights(lights: readonly LightDescriptor[]): void;
    /** Replaces the active clip plane. `undefined` disables clipping. Marks every view dirty. */
    setClipPlane(plane: ClipPlaneDescriptor | undefined): void;
    /** Opens a view. Every view shares this engine's single graphics context. */
    createView(options: ViewOptions): View;
    /** Every open view, in creation order. */
    views(): readonly View[];
    /** Begins driving frames from the host's animation frames. */
    start(): void;
    /** Stops driving frames. Views keep their last drawn output. */
    stop(): void;
    /**
     * Runs exactly one frame at the given real-time reading.
     *
     * The way to drive the engine from a host-owned loop, from a fixed-step
     * simulation, or from a test that needs frames to be deterministic rather
     * than however often the browser felt like scheduling one.
     */
    frame(realNow: number): FrameReport;
    /** Subscribes to frame reports. Returns an unsubscribe function. */
    observeFrames(observer: FrameObserver): () => void;
    /** Stops the loop and releases the graphics context, every view, and every built visual. */
    dispose(): void;
}

import type { EngineOptions, RenderEngine } from "../contracts/engine.js";
/**
 * Creates an engine: one graphics context, one world, many views.
 *
 * The single context is the load-bearing decision. Browsers cap live WebGL
 * contexts — for many it is as low as eight — and enforce the cap by silently
 * dropping the oldest, so a design that spends one context per rendered
 * element does not fail with an error, it fails by having things vanish. Here
 * every view shares this engine's one context and is presented into its own
 * 2D surface, so the number of simultaneous views is bounded by memory.
 *
 * This file owns scheduling, invalidation, and lifetime. It does not import a
 * renderer; everything that draws sits behind {@link RenderBackend}.
 */
export declare function createEngine(options?: EngineOptions): RenderEngine;

import type { ItemId, LayerId, SceneChange } from "../contracts/scene.js";
/**
 * What changed since the last frame, at the coarsest granularity that is still
 * correct.
 *
 * The point of tracking this at all is that most state changes cannot affect
 * most of what is drawn. Redrawing everything because something changed is the
 * default that looks fine with three objects on screen and becomes the whole
 * performance problem with three hundred. Moving one item must not be able to
 * invalidate a layer that item is not in.
 */
export interface Invalidation {
    /** Items whose visual must be rebuilt from its descriptor. */
    readonly rebuild: ReadonlySet<ItemId>;
    /** Items that only moved. Placement is reapplied; geometry is left alone. */
    readonly reposition: ReadonlySet<ItemId>;
    /** Items whose built visual must be released. */
    readonly release: ReadonlySet<ItemId>;
    /** Layers whose contents changed, and therefore the views that draw them. */
    readonly layers: ReadonlySet<LayerId>;
    /** Whether anything at all changed. */
    readonly empty: boolean;
}
/** Accumulates scene changes between frames. */
export interface InvalidationTracker {
    /** Folds a batch of scene changes in. */
    record(changes: readonly SceneChange[]): void;
    /** Marks every layer and item dirty. Used when lighting or the registry changes. */
    invalidateAll(layers: Iterable<LayerId>, items: Iterable<ItemId>): void;
    /** Returns what accumulated and resets, ready for the next frame. */
    drain(): Invalidation;
    /** Whether anything is currently pending. */
    readonly pending: boolean;
}
/** Creates the per-frame change accumulator. */
export declare function createInvalidationTracker(): InvalidationTracker;

import type { ItemId, LayerId, SceneChange } from "../contracts/scene.js";
/**
 * What changed since the last frame, at the coarsest granularity that is still
 * correct.
 *
 * The point of tracking this at all is that most state changes cannot affect
 * most of what is drawn. Redrawing everything because something changed is the
 * default that looks fine with three objects on screen and becomes the whole
 * performance problem with three hundred. Moving one item must not be able to
 * invalidate a layer that item is not in.
 */
export interface Invalidation {
    /** Items whose visual must be rebuilt from its descriptor. */
    readonly rebuild: ReadonlySet<ItemId>;
    /** Items that only moved. Placement is reapplied; geometry is left alone. */
    readonly reposition: ReadonlySet<ItemId>;
    /** Items whose built visual must be released. */
    readonly release: ReadonlySet<ItemId>;
    /** Layers whose contents changed, and therefore the views that draw them. */
    readonly layers: ReadonlySet<LayerId>;
    /** Whether anything at all changed. */
    readonly empty: boolean;
}
/** Accumulates scene changes between frames. */
export interface InvalidationTracker {
    /** Folds a batch of scene changes in. */
    record(changes: readonly SceneChange[]): void;
    /** Marks every layer and item dirty. Used when lighting or the registry changes. */
    invalidateAll(layers: Iterable<LayerId>, items: Iterable<ItemId>): void;
    /** Returns what accumulated and resets, ready for the next frame. */
    drain(): Invalidation;
    /** Whether anything is currently pending. */
    readonly pending: boolean;
}
/** Creates the per-frame change accumulator. */
export declare function createInvalidationTracker(): InvalidationTracker;

import type { VisualDefinition } from "../contracts/visual.js";
/** Parameters for the {@link heightfieldVisual} kind. */
export interface HeightfieldParams {
    /** Sample count along the X axis. */
    readonly width: number;
    /** Sample count along the Z axis. */
    readonly depth: number;
    /** Row-major elevation samples, `width * depth` of them. */
    readonly values: Float32Array;
    /** World-space span of the grid on both axes. Defaults to `20` square. */
    readonly size?: number;
    /** Multiplier applied to each sample before it becomes a vertex height. Defaults to `1`. */
    readonly elevationScale?: number;
    /** Surface color. Defaults to white, so the caller's palette decides. */
    readonly color?: number;
    /** Whether facets are shaded flat. Defaults to `true`. */
    readonly flatShading?: boolean;
}
/**
 * A replaceable default for the most common surface shape: a regular grid of
 * elevation samples.
 *
 * It is here because a grid of heights is genuinely generic — it is terrain,
 * but it is equally a fluid surface, a deformation field, or a heatmap — and
 * not because the engine has any opinion about what a caller draws. A product
 * that wants different shading registers its own kind under a different name
 * and this one costs it nothing.
 */
export declare const heightfieldVisual: VisualDefinition<HeightfieldParams>;

import type { VisualDefinition } from "../contracts/visual.js";
/** Parameters for the {@link heightfieldVisual} kind. */
export interface HeightfieldParams {
    /** Sample count along the X axis. */
    readonly width: number;
    /** Sample count along the Z axis. */
    readonly depth: number;
    /** Row-major elevation samples, `width * depth` of them. */
    readonly values: Float32Array;
    /** World-space span of the grid on both axes. Defaults to `20` square. */
    readonly size?: number;
    /** Multiplier applied to each sample before it becomes a vertex height. Defaults to `1`. */
    readonly elevationScale?: number;
    /** Surface color. Defaults to white, so the caller's palette decides. */
    readonly color?: number;
    /** Whether facets are shaded flat. Defaults to `true`. */
    readonly flatShading?: boolean;
}
/**
 * A replaceable default for the most common surface shape: a regular grid of
 * elevation samples.
 *
 * It is here because a grid of heights is genuinely generic — it is terrain,
 * but it is equally a fluid surface, a deformation field, or a heatmap — and
 * not because the engine has any opinion about what a caller draws. A product
 * that wants different shading registers its own kind under a different name
 * and this one costs it nothing.
 */
export declare const heightfieldVisual: VisualDefinition<HeightfieldParams>;

import type { VisualDefinition } from "../contracts/visual.js";
/** Parameters for the {@link gridVisual} kind. */
export interface GridParams {
    /** Half the grid's world-space span on each axis -- it runs from `-extent` to `extent` on both X and Z. */
    readonly extent: number;
    /** World-space distance between adjacent lines. */
    readonly cellSize: number;
    /** Line color. Defaults to white, so the caller's palette decides. */
    readonly color?: number;
    /** Line opacity, in `(0, 1]`. Defaults to `1`. */
    readonly opacity?: number;
}
/**
 * A replaceable default for a bounded ground-plane reference grid, on
 * `y = 0`, spanning `[-extent, extent]` on both X and Z with a line every
 * `cellSize` units.
 *
 * It is here, generic and product-agnostic, for the same reason
 * {@link heightfieldVisual} is: a reference/board grid is not specific to
 * any one product's meaning, only its placement and color are. A product
 * that wants a different default (e.g. a camera-anchored infinite-grid
 * shader instead of bounded line geometry) registers its own kind under a
 * different name and this one costs it nothing.
 */
export declare const gridVisual: VisualDefinition<GridParams>;

import type { VisualDefinition } from "../contracts/visual.js";
/** Parameters for the {@link gridVisual} kind. */
export interface GridParams {
    /** Half the grid's world-space span on each axis -- it runs from `-extent` to `extent` on both X and Z. */
    readonly extent: number;
    /** World-space distance between adjacent lines. */
    readonly cellSize: number;
    /** Line color. Defaults to white, so the caller's palette decides. */
    readonly color?: number;
    /** Line opacity, in `(0, 1]`. Defaults to `1`. */
    readonly opacity?: number;
}
/**
 * A replaceable default for a bounded ground-plane reference grid, on
 * `y = 0`, spanning `[-extent, extent]` on both X and Z with a line every
 * `cellSize` units.
 *
 * It is here, generic and product-agnostic, for the same reason
 * {@link heightfieldVisual} is: a reference/board grid is not specific to
 * any one product's meaning, only its placement and color are. A product
 * that wants a different default (e.g. a camera-anchored infinite-grid
 * shader instead of bounded line geometry) registers its own kind under a
 * different name and this one costs it nothing.
 */
export declare const gridVisual: VisualDefinition<GridParams>;

import type { MeshData } from "../contracts/visual.js";
/**
 * Concatenates several meshes into one buffer, offsetting each piece's
 * indices past everything already appended.
 *
 * Pure array arithmetic, useful to any caller batching many small meshes
 * into one draw call — not something specific to any one product's idea of
 * a "chunk". A caller that groups geometry into spatial buckets (a chunked
 * terrain, a merged prop cluster, anything else that wants one buffer per
 * bucket) calls this once per bucket.
 *
 * A piece without its own `indices` is a flat triangle list (`GeometryDescriptor`'s
 * own "positions read sequentially when omitted" rule) — merged as an
 * implicit `0..n-1` index run, never by dropping indices from every *other*
 * piece just because one piece lacks them; that would silently discard the
 * shared-vertex structure indexed pieces depend on.
 */
export declare function mergeMeshChunks(pieces: readonly MeshData[]): MeshData;

/**
 * A small, self-contained PRNG (mulberry32) rather than `Math.random` --
 * seeded deterministically, so the same seed always produces the same
 * sequence. That is what makes procedural visual variation (a room's shape,
 * a scatter of instances, a jittered grid) reproducible in tests and
 * replayable across a reload, instead of flaky.
 */
export declare function mulberry32(seed: number): () => number;
/** Linear interpolation: `fraction` of the way from `min` to `max`. */
export declare function lerp(min: number, max: number, fraction: number): number;

/**
 * Dragging to orbit a view's camera.
 *
 * A fixed camera quietly limits what a rendered result can tell you: a
 * generated surface seen from one angle hides exactly the defects --
 * coincident faces, a gap at a seam, a piece facing the wrong way -- that
 * looking at it was supposed to expose. You cannot judge geometry you cannot
 * turn.
 *
 * Lives here rather than in a consumer because it is camera behaviour for this
 * engine, and because both consumers that needed it would otherwise have kept
 * their own copy. It is written against this package's own `setCamera` and
 * plain numbers rather than pulled in as a controls library: the engine's
 * whole shape is that no backend type crosses its boundary, and a controls
 * package from the Three.js ecosystem would reintroduce one *in the consumer*.
 * The arithmetic is small enough that the seam is worth more than the saved
 * lines, and it is tested separately from the DOM.
 */
import type { Vec3 } from "../contracts/space.js";
/** Where the camera sits, in spherical coordinates about a target. */
export interface OrbitState {
    /** Rotation about the vertical axis, in radians. */
    readonly yaw: number;
    /** Elevation above the horizon, in radians. */
    readonly pitch: number;
    /** Distance from the target, in world units. */
    readonly distance: number;
    /** The point orbited. */
    readonly target: Vec3;
}
/**
 * How close to straight up or down the camera may get.
 *
 * Not a matter of taste: at exactly the pole the view direction is parallel to
 * the up vector and the camera's orientation stops being defined, which shows
 * up as the view flipping. Stopping just short of it costs nothing.
 */
export declare const PITCH_LIMIT: number;
/** The closest and furthest the camera may be pulled. */
export declare const DISTANCE_RANGE: {
    readonly min: 0.5;
    readonly max: 60;
};
/** Where the camera sits for a given orbit. */
export declare function orbitPosition(state: OrbitState): Vec3;
/**
 * Recovers an orbit from a camera already pointed somewhere.
 *
 * Lets a trial keep the framing it was authored with instead of snapping to a
 * default the moment orbiting is switched on.
 */
export declare function orbitFromCamera(position: Vec3, target: Vec3): OrbitState;
/** Applies a drag, in pixels, to an orbit. */
export declare function orbitDrag(state: OrbitState, dx: number, dy: number, radiansPerPixel?: number): OrbitState;
/**
 * Applies a wheel notch to an orbit.
 *
 * Multiplicative rather than additive, so a notch moves the same *proportion*
 * of the way in at every scale. Additive zoom crawls when far out and slams
 * into the target when close.
 */
export declare function orbitZoom(state: OrbitState, delta: number, factorPerNotch?: number): OrbitState;
/**
 * Applies a drag, in pixels, as a lateral pan -- translating the orbited
 * target across the view plane instead of rotating around it.
 *
 * Every reference in `docs/research/vtt-board-construction-mode-ui-references.md`
 * and `docs/research/godview-builder-game-construction-ui-references.md` offers
 * this as a gesture independent of orbit (RMB/MMB-drag or WASD), so it is a
 * second pure function beside {@link orbitDrag} rather than a mode of it.
 *
 * Scaled by the current distance, like {@link orbitZoom}, so a pixel of drag
 * moves the same apparent amount of world regardless of how far the camera has
 * zoomed -- an unscaled pan would crawl when zoomed out and overshoot when
 * zoomed in. The camera keeps its yaw, pitch, and distance; only `target`
 * (and therefore the derived position, rigidly) moves.
 *
 * Convention: the world follows the cursor, like grabbing the ground and
 * pulling it -- dragging right brings what was to the right into view, and
 * dragging down (screen y grows downward, per {@link orbitDrag}'s own
 * convention) brings what was below into view. Achieving that means the
 * *camera* moves opposite the drag along `right`, and with the drag along
 * `up`.
 */
export declare function orbitPan(state: OrbitState, dx: number, dy: number, unitsPerPixel?: number): OrbitState;
/** The minimum of {@link View} this needs. Keeps the helper testable. */
export interface OrbitableView {
    /** Replaces the camera description driven by the orbit helper. */
    setCamera(camera: {
        projection: "perspective";
        fov?: number;
        position: Vec3;
        target: Vec3;
        near?: number;
        far?: number;
    }): void;
}
/** What {@link attachOrbit} needs to know about the camera it is driving. */
export interface OrbitOptions {
    /** Perspective field of view in degrees. */
    readonly fov?: number;
    /** Near clipping distance in world units. */
    readonly near?: number;
    /** Far clipping distance in world units. */
    readonly far?: number;
    /** Called after every change, so the caller can redraw. */
    readonly onChange?: (state: OrbitState) => void;
    /**
     * Whether these gestures belong to this view alone.
     *
     * When set, the handlers stop the events propagating any further, so a
     * surface that pans or zooms around this view -- a graph node, a scrolling
     * page -- never sees them. Done from inside the handlers deliberately: a
     * separate capture-phase listener on the same element cannot do this job,
     * because stopping an event during capture at an ancestor prevents it from
     * ever reaching the real target below and bubbling back, which silences the
     * orbit itself. That mistake shipped once.
     */
    readonly exclusive?: boolean;
    /**
     * Restricts orbit-drag to one `PointerEvent.button` value (0 = left,
     * 1 = middle, 2 = right). Undefined -- the default -- preserves this
     * module's original behaviour: any button orbits.
     *
     * A consumer that also drives its own tool gestures with the left button on
     * this same element (apps/vtt's construction tools, reserving LMB per the
     * board plan's camera control scheme) MUST set this explicitly, e.g. to
     * `2`, so the two gesture sets stop fighting over `pointerdown`.
     */
    readonly orbitButton?: number;
    /**
     * Enables a second, independent lateral-pan gesture bound to one
     * `PointerEvent.button` value, driven by {@link orbitPan}. Undefined --
     * the default -- disables panning entirely, this module's original
     * behaviour. Must differ from `orbitButton` when both are set.
     */
    readonly panButton?: number;
    /**
     * Where an orbit drag re-centers before rotating.
     *
     * `"center"` (the default) keeps today's behaviour: orbiting always turns
     * around whatever `target` already is. `"cursor"` asks {@link resolvePivot}
     * for the world point under the pointer at drag-start and re-targets there
     * first -- the Tiny Glade convention (`docs/research/vtt-board-construction-mode-ui-references.md`)
     * for framing one detail precisely without recentring the whole scene by
     * hand first.
     */
    readonly pivot?: "center" | "cursor";
    /**
     * Resolves the world point under a client-space pointer position. Required
     * for `pivot: "cursor"`; ignored otherwise.
     *
     * Kept as an injected callback rather than a raycast implemented here,
     * because this module owns no scene geometry (`VTT-ARCH-002`) -- the real
     * answer comes from the consumer's own picking (e.g. `SceneRenderPort.pick`
     * in `apps/vtt`). Returning `undefined` (the pointer is over empty space)
     * leaves the current target unchanged for that drag.
     */
    readonly resolvePivot?: (clientX: number, clientY: number) => Vec3 | undefined;
}
/**
 * Makes `element` drive `view`'s camera by dragging and scrolling.
 *
 * Returns a function that detaches every listener. Callers must call it on
 * unmount; a trial that re-mounts its engine would otherwise accumulate
 * listeners driving a disposed view.
 */
export declare function attachOrbit(element: HTMLElement, view: OrbitableView, initial: OrbitState, options?: OrbitOptions): () => void;

/**
 * Dragging to orbit a view's camera.
 *
 * A fixed camera quietly limits what a rendered result can tell you: a
 * generated surface seen from one angle hides exactly the defects --
 * coincident faces, a gap at a seam, a piece facing the wrong way -- that
 * looking at it was supposed to expose. You cannot judge geometry you cannot
 * turn.
 *
 * Lives here rather than in a consumer because it is camera behaviour for this
 * engine, and because both consumers that needed it would otherwise have kept
 * their own copy. It is written against this package's own `setCamera` and
 * plain numbers rather than pulled in as a controls library: the engine's
 * whole shape is that no backend type crosses its boundary, and a controls
 * package from the Three.js ecosystem would reintroduce one *in the consumer*.
 * The arithmetic is small enough that the seam is worth more than the saved
 * lines, and it is tested separately from the DOM.
 */
import type { Vec3 } from "../contracts/space.js";
/** Where the camera sits, in spherical coordinates about a target. */
export interface OrbitState {
    /** Rotation about the vertical axis, in radians. */
    readonly yaw: number;
    /** Elevation above the horizon, in radians. */
    readonly pitch: number;
    /** Distance from the target, in world units. */
    readonly distance: number;
    /** The point orbited. */
    readonly target: Vec3;
}
/**
 * How close to straight up or down the camera may get.
 *
 * Not a matter of taste: at exactly the pole the view direction is parallel to
 * the up vector and the camera's orientation stops being defined, which shows
 * up as the view flipping. Stopping just short of it costs nothing.
 */
export declare const PITCH_LIMIT: number;
/** The closest and furthest the camera may be pulled. */
export declare const DISTANCE_RANGE: {
    readonly min: 0.5;
    readonly max: 60;
};
/** Where the camera sits for a given orbit. */
export declare function orbitPosition(state: OrbitState): Vec3;
/**
 * Recovers an orbit from a camera already pointed somewhere.
 *
 * Lets a trial keep the framing it was authored with instead of snapping to a
 * default the moment orbiting is switched on.
 */
export declare function orbitFromCamera(position: Vec3, target: Vec3): OrbitState;
/** Applies a drag, in pixels, to an orbit. */
export declare function orbitDrag(state: OrbitState, dx: number, dy: number, radiansPerPixel?: number): OrbitState;
/**
 * Applies a wheel notch to an orbit.
 *
 * Multiplicative rather than additive, so a notch moves the same *proportion*
 * of the way in at every scale. Additive zoom crawls when far out and slams
 * into the target when close.
 */
export declare function orbitZoom(state: OrbitState, delta: number, factorPerNotch?: number): OrbitState;
/**
 * Applies a drag, in pixels, as a lateral pan -- translating the orbited
 * target across the view plane instead of rotating around it.
 *
 * Every reference in `docs/research/vtt-board-construction-mode-ui-references.md`
 * and `docs/research/godview-builder-game-construction-ui-references.md` offers
 * this as a gesture independent of orbit (RMB/MMB-drag or WASD), so it is a
 * second pure function beside {@link orbitDrag} rather than a mode of it.
 *
 * Scaled by the current distance, like {@link orbitZoom}, so a pixel of drag
 * moves the same apparent amount of world regardless of how far the camera has
 * zoomed -- an unscaled pan would crawl when zoomed out and overshoot when
 * zoomed in. The camera keeps its yaw, pitch, and distance; only `target`
 * (and therefore the derived position, rigidly) moves.
 *
 * Convention: the world follows the cursor, like grabbing the ground and
 * pulling it -- dragging right brings what was to the right into view, and
 * dragging down (screen y grows downward, per {@link orbitDrag}'s own
 * convention) brings what was below into view. Achieving that means the
 * *camera* moves opposite the drag along `right`, and with the drag along
 * `up`.
 */
export declare function orbitPan(state: OrbitState, dx: number, dy: number, unitsPerPixel?: number): OrbitState;
/** The minimum of {@link View} this needs. Keeps the helper testable. */
export interface OrbitableView {
    /** Replaces the camera description driven by the orbit helper. */
    setCamera(camera: {
        projection: "perspective";
        fov?: number;
        position: Vec3;
        target: Vec3;
        near?: number;
        far?: number;
    }): void;
}
/** What {@link attachOrbit} needs to know about the camera it is driving. */
export interface OrbitOptions {
    /** Perspective field of view in degrees. */
    readonly fov?: number;
    /** Near clipping distance in world units. */
    readonly near?: number;
    /** Far clipping distance in world units. */
    readonly far?: number;
    /** Called after every change, so the caller can redraw. */
    readonly onChange?: (state: OrbitState) => void;
    /**
     * Whether these gestures belong to this view alone.
     *
     * When set, the handlers stop the events propagating any further, so a
     * surface that pans or zooms around this view -- a graph node, a scrolling
     * page -- never sees them. Done from inside the handlers deliberately: a
     * separate capture-phase listener on the same element cannot do this job,
     * because stopping an event during capture at an ancestor prevents it from
     * ever reaching the real target below and bubbling back, which silences the
     * orbit itself. That mistake shipped once.
     */
    readonly exclusive?: boolean;
    /**
     * Restricts orbit-drag to one `PointerEvent.button` value (0 = left,
     * 1 = middle, 2 = right). Undefined -- the default -- preserves this
     * module's original behaviour: any button orbits.
     *
     * A consumer that also drives its own tool gestures with the left button on
     * this same element (apps/vtt's construction tools, reserving LMB per the
     * board plan's camera control scheme) MUST set this explicitly, e.g. to
     * `2`, so the two gesture sets stop fighting over `pointerdown`.
     */
    readonly orbitButton?: number;
    /**
     * Enables a second, independent lateral-pan gesture bound to one
     * `PointerEvent.button` value, driven by {@link orbitPan}. Undefined --
     * the default -- disables panning entirely, this module's original
     * behaviour. Must differ from `orbitButton` when both are set.
     */
    readonly panButton?: number;
    /**
     * Where an orbit drag re-centers before rotating.
     *
     * `"center"` (the default) keeps today's behaviour: orbiting always turns
     * around whatever `target` already is. `"cursor"` asks {@link resolvePivot}
     * for the world point under the pointer at drag-start and re-targets there
     * first -- the Tiny Glade convention (`docs/research/vtt-board-construction-mode-ui-references.md`)
     * for framing one detail precisely without recentring the whole scene by
     * hand first.
     */
    readonly pivot?: "center" | "cursor";
    /**
     * Resolves the world point under a client-space pointer position. Required
     * for `pivot: "cursor"`; ignored otherwise.
     *
     * Kept as an injected callback rather than a raycast implemented here,
     * because this module owns no scene geometry (`VTT-ARCH-002`) -- the real
     * answer comes from the consumer's own picking (e.g. `SceneRenderPort.pick`
     * in `apps/vtt`). Returning `undefined` (the pointer is over empty space)
     * leaves the current target unchanged for that drag.
     */
    readonly resolvePivot?: (clientX: number, clientY: number) => Vec3 | undefined;
}
/**
 * Makes `element` drive `view`'s camera by dragging and scrolling.
 *
 * Returns a function that detaches every listener. Callers must call it on
 * unmount; a trial that re-mounts its engine would otherwise accumulate
 * listeners driving a disposed view.
 */
export declare function attachOrbit(element: HTMLElement, view: OrbitableView, initial: OrbitState, options?: OrbitOptions): () => void;
```
