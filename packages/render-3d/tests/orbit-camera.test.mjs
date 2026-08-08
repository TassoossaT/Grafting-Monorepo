import assert from "node:assert/strict";
import test from "node:test";

import {
  DISTANCE_RANGE,
  PITCH_LIMIT,
  attachOrbit,
  orbitDrag,
  orbitFromCamera,
  orbitPosition,
  orbitZoom,
} from "../dist/index.js";

const ORIGIN = { x: 0, y: 0, z: 0 };
const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) < tolerance;

test("recovering an orbit from a camera and placing it again is a round trip", () => {
  // The property that lets a trial keep its authored framing instead of
  // snapping to a default the moment orbiting is switched on.
  const cases = [
    { position: { x: 4.5, y: 4.5, z: 5.5 }, target: { x: 0, y: 0.3, z: 0 } },
    { position: { x: -2, y: 1, z: 0 }, target: ORIGIN },
    { position: { x: 0, y: 0, z: 3 }, target: ORIGIN },
  ];
  cases.forEach(({ position, target }) => {
    const back = orbitPosition(orbitFromCamera(position, target));
    assert.ok(near(back.x, position.x, 1e-9), `x: ${back.x} vs ${position.x}`);
    assert.ok(near(back.y, position.y, 1e-9), `y: ${back.y} vs ${position.y}`);
    assert.ok(near(back.z, position.z, 1e-9), `z: ${back.z} vs ${position.z}`);
  });
});

test("a camera sitting on its own target degrades to a usable orbit", () => {
  const state = orbitFromCamera(ORIGIN, ORIGIN);
  assert.equal(state.distance, DISTANCE_RANGE.min, "a zero distance would be unrecoverable");
  assert.ok(Number.isFinite(state.yaw) && Number.isFinite(state.pitch));
});

test("orbiting keeps the distance to the target", () => {
  let state = orbitFromCamera({ x: 3, y: 2, z: 4 }, { x: 1, y: 0, z: 1 });
  const distance = state.distance;
  for (const [dx, dy] of [
    [120, -40],
    [-300, 250],
    [17, 3],
  ]) {
    state = orbitDrag(state, dx, dy);
    const at = orbitPosition(state);
    const measured = Math.hypot(at.x - state.target.x, at.y - state.target.y, at.z - state.target.z);
    assert.ok(near(measured, distance, 1e-9), `distance drifted to ${measured}`);
  }
});

test("pitch stops short of the poles, where the view would flip", () => {
  // At exactly the pole the view direction is parallel to up and the camera's
  // orientation stops being defined. Not taste -- correctness.
  let state = orbitFromCamera({ x: 0, y: 1, z: 1 }, ORIGIN);
  state = orbitDrag(state, 0, 100000);
  assert.ok(state.pitch <= PITCH_LIMIT, `pitch reached ${state.pitch}`);
  state = orbitDrag(state, 0, -100000);
  assert.ok(state.pitch >= -PITCH_LIMIT, `pitch reached ${state.pitch}`);
});

test("dragging up tips the camera up, and right swings it the other way", () => {
  const start = orbitFromCamera({ x: 0, y: 0, z: 5 }, ORIGIN);
  assert.ok(orbitDrag(start, 0, 50).pitch > start.pitch, "screen y grows downward");
  assert.ok(orbitDrag(start, 50, 0).yaw < start.yaw);
});

test("zoom is proportional, so a notch does the same work at every scale", () => {
  const far = orbitZoom({ ...orbitFromCamera({ x: 0, y: 0, z: 40 }, ORIGIN) }, -100);
  const close = orbitZoom({ ...orbitFromCamera({ x: 0, y: 0, z: 4 }, ORIGIN) }, -100);
  assert.ok(near(far.distance / 40, close.distance / 4, 1e-9), "the ratio must match");
});

test("zoom is clamped at both ends", () => {
  const state = orbitFromCamera({ x: 0, y: 0, z: 5 }, ORIGIN);
  assert.equal(orbitZoom(state, -1e6).distance, DISTANCE_RANGE.min);
  assert.equal(orbitZoom(state, 1e6).distance, DISTANCE_RANGE.max);
});

/** The smallest element and view that `attachOrbit` will accept. */
function fakes() {
  const listeners = new Map();
  const element = {
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type) => listeners.delete(type),
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => true,
  };
  const cameras = [];
  return { element, listeners, view: { setCamera: (camera) => cameras.push(camera) }, cameras };
}

test("attaching points the camera immediately and detaching removes every listener", () => {
  // The leak this guards against is real: a trial that re-mounts its engine
  // would otherwise accumulate listeners driving a disposed view.
  const { element, listeners, view, cameras } = fakes();
  const detach = attachOrbit(element, view, orbitFromCamera({ x: 0, y: 0, z: 5 }, ORIGIN));
  assert.equal(cameras.length, 1, "the camera is set once on attach");
  assert.ok(listeners.size > 0);
  detach();
  assert.equal(listeners.size, 0, "every listener must be removed");
});

test("a drag only moves the camera between pointer down and up", () => {
  const { element, listeners, view, cameras } = fakes();
  attachOrbit(element, view, orbitFromCamera({ x: 0, y: 0, z: 5 }, ORIGIN));
  const before = cameras.length;

  // Moving without pressing must do nothing.
  listeners.get("pointermove")({ pointerId: 1, clientX: 10, clientY: 10 });
  assert.equal(cameras.length, before);

  listeners.get("pointerdown")({ pointerId: 1, clientX: 0, clientY: 0 });
  listeners.get("pointermove")({ pointerId: 1, clientX: 40, clientY: 0 });
  assert.equal(cameras.length, before + 1, "a drag moves the camera");

  listeners.get("pointerup")({ pointerId: 1 });
  listeners.get("pointermove")({ pointerId: 1, clientX: 80, clientY: 0 });
  assert.equal(cameras.length, before + 1, "releasing ends the drag");
});

test("a second pointer does not fight the one already dragging", () => {
  const { element, listeners, view, cameras } = fakes();
  attachOrbit(element, view, orbitFromCamera({ x: 0, y: 0, z: 5 }, ORIGIN));
  listeners.get("pointerdown")({ pointerId: 1, clientX: 0, clientY: 0 });
  listeners.get("pointerdown")({ pointerId: 2, clientX: 500, clientY: 500 });
  const before = cameras.length;
  listeners.get("pointermove")({ pointerId: 2, clientX: 600, clientY: 500 });
  assert.equal(cameras.length, before, "the second pointer must be ignored");
});

test("the wheel is prevented from scrolling the page", () => {
  const { element, listeners, view } = fakes();
  attachOrbit(element, view, orbitFromCamera({ x: 0, y: 0, z: 5 }, ORIGIN));
  let prevented = false;
  listeners.get("wheel")({ deltaY: -100, preventDefault: () => (prevented = true) });
  assert.ok(prevented);
});
