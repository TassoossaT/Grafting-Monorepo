/**
 * Dragging to orbit a lab trial's camera.
 *
 * Every 3D trial so far shipped with a fixed camera, which quietly limits what
 * a trial can tell you: a generated surface seen from one angle hides exactly
 * the defects -- coincident faces, gaps at a seam, a module facing the wrong
 * way -- that a trial exists to expose. You cannot judge geometry you cannot
 * turn.
 *
 * Written against `render-3d`'s `setCamera` and plain numbers rather than
 * pulled in as a controls library, because the renderer's whole shape is that
 * no backend type crosses its boundary; a controls package from the Three.js
 * ecosystem would reintroduce one in the consumer. The arithmetic is small
 * enough that the seam is worth more than the saved lines, and it is tested
 * separately from the DOM.
 */

/** A point in world space, matching `render-3d`'s own `Vec3`. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

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

/** The minimum of `render-3d`'s `View` this needs. Keeps the helper testable. */
export interface OrbitableView {
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
  readonly fov?: number;
  readonly near?: number;
  readonly far?: number;
  /** Called after every change, so the caller can redraw. */
  readonly onChange?: (state: OrbitState) => void;
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

  const onPointerDown = (event: PointerEvent) => {
    if (dragging !== null) return;
    dragging = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    element.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (dragging !== event.pointerId) return;
    state = orbitDrag(state, event.clientX - lastX, event.clientY - lastY);
    lastX = event.clientX;
    lastY = event.clientY;
    apply();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (dragging !== event.pointerId) return;
    dragging = null;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  };

  // Not passive: the page must not scroll while the pointer is over the view.
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
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
