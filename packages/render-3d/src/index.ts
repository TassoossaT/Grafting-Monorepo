/**
 * `@grafting/render-3d` — a generic 3D rendering engine.
 *
 * The package draws things. It has no idea what they mean. There is no notion
 * here of a character, a wall, a spell, or a body of water, because those are
 * product concepts and two of them frequently want identical treatment: a
 * marker that slides across a surface and a volume of water that ripples in
 * place are the same problem to a renderer and completely different problems
 * to a game. Modelling by product concept would put that decision in the wrong
 * package.
 *
 * What the engine offers instead are generic capabilities, each usable on its
 * own:
 *
 * - a **clock** that owns simulated time, so pausing, slowing, and stepping a
 *   whole turn at once are properties of the engine rather than features every
 *   caller rebuilds;
 * - a **scene** of items placed in space, carrying the origin of every change
 *   so local input, remote authority, and the engine's own writes stay
 *   distinguishable;
 * - **layers** as caller-named draw groups, which are also the unit of
 *   invalidation;
 * - **visual kinds** registered from outside, which is the entire integration
 *   surface for anything the engine does not know about — including a separate
 *   package that this one never imports;
 * - **views**, many cameras sharing one graphics context, each resizable and
 *   redrawn only when something it actually draws has changed;
 * - **animation** defined as a function of simulated progress, which is why it
 *   behaves identically under real time and under discrete turns.
 *
 * The renderer itself is private. No renderer type crosses this boundary, in
 * either direction.
 */

export type { Euler, Transform, Vec3 } from "./contracts/space.js";
export { IDENTITY_TRANSFORM } from "./contracts/space.js";

export type { Clock, ClockMode, ClockTick } from "./contracts/clock.js";
export { createClock } from "./clock/create-clock.js";
export type { ClockOptions } from "./clock/create-clock.js";

export type {
  GeometryDescriptor,
  HeightfieldData,
  MaterialDescriptor,
  MeshData,
  TextureSource,
  VisualDefinition,
  VisualDescriptor,
  VisualRef,
  VisualRegistry,
} from "./contracts/visual.js";
export { createVisualRegistry } from "./visual/create-registry.js";

export type {
  ChangeOrigin,
  ItemId,
  LayerDefinition,
  LayerId,
  Scene,
  SceneChange,
  SceneItem,
  SceneObserver,
} from "./contracts/scene.js";
export { createScene } from "./scene/create-scene.js";

export type {
  AnimationTrack,
  Animator,
  Easing,
  RunningTrack,
  TrackId,
} from "./contracts/animation.js";
export { createAnimator } from "./animation/create-animator.js";
export { easings } from "./animation/easing.js";

export type { CameraDescriptor, PickResult, View, ViewId, ViewOptions } from "./contracts/view.js";

export type {
  EngineOptions,
  FrameObserver,
  FrameReport,
  LightDescriptor,
  RenderEngine,
} from "./contracts/engine.js";
export { createEngine } from "./engine/create-engine.js";

export type { Invalidation, InvalidationTracker } from "./invalidation/create-invalidation.js";
export { createInvalidationTracker } from "./invalidation/create-invalidation.js";

export type { HeightfieldParams } from "./visual/heightfield-visual.js";
export { heightfieldVisual } from "./visual/heightfield-visual.js";

export type { OrbitOptions, OrbitState, OrbitableView } from "./camera/orbit.js";
export {
  DISTANCE_RANGE,
  PITCH_LIMIT,
  attachOrbit,
  orbitDrag,
  orbitFromCamera,
  orbitPosition,
  orbitZoom,
} from "./camera/orbit.js";
