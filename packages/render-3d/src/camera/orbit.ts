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
export const PITCH_LIMIT = Math.PI / 2 - 0.05;

/** The closest and furthest the camera may be pulled. */
export const DISTANCE_RANGE = { min: 0.5, max: 60 } as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Where the camera sits for a given orbit. */
export function orbitPosition(state: OrbitState): Vec3 {
  const pitch = clamp(state.pitch, -PITCH_LIMIT, PITCH_LIMIT);
  const horizontal = Math.cos(pitch) * state.distance;
  return {
    x: state.target.x + horizontal * Math.sin(state.yaw),
    y: state.target.y + Math.sin(pitch) * state.distance,
    z: state.target.z + horizontal * Math.cos(state.yaw),
  };
}

/**
 * Recovers an orbit from a camera already pointed somewhere.
 *
 * Lets a trial keep the framing it was authored with instead of snapping to a
 * default the moment orbiting is switched on.
 */
export function orbitFromCamera(position: Vec3, target: Vec3): OrbitState {
  const dx = position.x - target.x;
  const dy = position.y - target.y;
  const dz = position.z - target.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance === 0) return { yaw: 0, pitch: 0, distance: DISTANCE_RANGE.min, target };
  return {
    yaw: Math.atan2(dx, dz),
    pitch: Math.asin(clamp(dy / distance, -1, 1)),
    distance,
    target,
  };
}

/** Applies a drag, in pixels, to an orbit. */
export function orbitDrag(state: OrbitState, dx: number, dy: number, radiansPerPixel = 0.008): OrbitState {
  return {
    ...state,
    yaw: state.yaw - dx * radiansPerPixel,
    // Dragging up should tip the camera up, and screen y grows downward.
    pitch: clamp(state.pitch + dy * radiansPerPixel, -PITCH_LIMIT, PITCH_LIMIT),
  };
}

/**
 * Applies a wheel notch to an orbit.
 *
 * Multiplicative rather than additive, so a notch moves the same *proportion*
 * of the way in at every scale. Additive zoom crawls when far out and slams
 * into the target when close.
 */
export function orbitZoom(state: OrbitState, delta: number, factorPerNotch = 1.0015): OrbitState {
  return {
    ...state,
    distance: clamp(
      state.distance * factorPerNotch ** delta,
      DISTANCE_RANGE.min,
      DISTANCE_RANGE.max,
    ),
  };
}

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len === 0) return v;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

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
export function orbitPan(state: OrbitState, dx: number, dy: number, unitsPerPixel = 0.0016): OrbitState {
  const position = orbitPosition(state);
  const forward = normalize({
    x: state.target.x - position.x,
    y: state.target.y - position.y,
    z: state.target.z - position.z,
  });
  const right = normalize(cross(forward, WORLD_UP));
  const up = cross(right, forward);
  const scale = state.distance * unitsPerPixel;
  return {
    ...state,
    target: {
      x: state.target.x - right.x * dx * scale + up.x * dy * scale,
      y: state.target.y - right.y * dx * scale + up.y * dy * scale,
      z: state.target.z - right.z * dx * scale + up.z * dy * scale,
    },
  };
}

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
export function attachOrbit(
  element: HTMLElement,
  view: OrbitableView,
  initial: OrbitState,
  options: OrbitOptions = {},
): () => void {
  let state = initial;
  let dragging: number | null = null;
  let dragMode: "orbit" | "pan" = "orbit";
  let lastX = 0;
  let lastY = 0;

  const apply = () => {
    view.setCamera({
      projection: "perspective",
      fov: options.fov,
      position: orbitPosition(state),
      target: state.target,
      near: options.near,
      far: options.far,
    });
    options.onChange?.(state);
  };

  const claim = (event: Event) => {
    if (options.exclusive === true) event.stopPropagation();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (dragging !== null) return;
    // Undefined `orbitButton`/`panButton` preserves the original "any button
    // orbits" behaviour; only a caller that opts in by setting either gets
    // button-specific routing.
    const isPan = options.panButton !== undefined && event.button === options.panButton;
    const isOrbit = !isPan && (options.orbitButton === undefined || event.button === options.orbitButton);
    if (!isPan && !isOrbit) return;

    // The middle button in particular triggers the browser's own native
    // autoscroll gesture (the page grabs the cursor to scroll on drag) unless
    // suppressed here -- without this, that native gesture wins the pointer
    // before `onPointerMove` ever sees it, so pan silently never fires no
    // matter how correct its own math is.
    event.preventDefault();
    claim(event);
    dragMode = isPan ? "pan" : "orbit";
    if (dragMode === "orbit" && options.pivot === "cursor") {
      const pivot = options.resolvePivot?.(event.clientX, event.clientY);
      if (pivot !== undefined) {
        // Re-derives yaw/pitch/distance from the unchanged camera position so
        // the view does not jump-cut to the new pivot -- only what it orbits
        // around changes. Applied immediately (not deferred to the first
        // `pointermove`) so a click-and-release with no drag still leaves the
        // camera pointed at the resolved pivot.
        state = orbitFromCamera(orbitPosition(state), pivot);
        apply();
      }
    }
    dragging = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    element.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (dragging !== event.pointerId) return;
    claim(event);
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    state = dragMode === "pan" ? orbitPan(state, dx, dy) : orbitDrag(state, dx, dy);
    lastX = event.clientX;
    lastY = event.clientY;
    apply();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (dragging !== event.pointerId) return;
    claim(event);
    dragging = null;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  };

  // Not passive: the page must not scroll while the pointer is over the view.
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    claim(event);
    state = orbitZoom(state, event.deltaY);
    apply();
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);
  element.addEventListener("wheel", onWheel, { passive: false });
  apply();

  return () => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointercancel", onPointerUp);
    element.removeEventListener("wheel", onWheel);
  };
}
