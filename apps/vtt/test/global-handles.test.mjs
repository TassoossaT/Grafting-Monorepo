import assert from "node:assert/strict";
import test from "node:test";
import { shownGlobalHandles } from "../src/features/edit-construction/index.ts";
import { platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { slopeRampTool } from "../src/composition/tabletop/tools/slope/slope-tools.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";

const scene = (runtime) => ({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: runtime.cloudFor });
const node = (runtime, id) => runtime.getGraphSnapshot().nodes.find((n) => n.id === id);
const square = (runtime, prefix, x0, z0, y = 0, type = "platform") => addFace(runtime, prefix, type,
  [[x0, z0], [x0 + 4, z0], [x0 + 4, z0 + 2], [x0, z0 + 2]].map(([x, z], i) => ({ id: `${prefix}:${i}`, position: { x, y, z } })));

/** Drags `handle` with `tool` through `points`, recording where the scene shows the handle meanwhile. */
function drag(tool, fixture, handle, points, params, extra = {}) {
  const shown = [];
  fixture.runtime.previewNodeHandle = (id, position) => { if (id === handle.id && position) shown.push(position); };
  Object.assign(fixture.runtime, { showPreview() {}, clearPreview() {} });
  const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
  tool.onPointerDown(fixture.ctx, start, params);
  let last = start;
  for (const point of points) {
    last = { point, screenX: 200, screenY: 300, ...extra };
    tool.onPointerMove(fixture.ctx, { start, current: last, samples: [start, last] }, params);
  }
  tool.onPointerUp(fixture.ctx, { start, current: last, samples: [start, last] }, params);
  return shown;
}

test("a platform shows pivot, rotate and height handles; a wall, which declares none, shows nothing", () => {
  const { runtime, session } = sessionFixture();
  try {
    square(runtime, "floor", 0, 0);
    addFace(runtime, "wall", "wall-white", [[10, 0, 0], [12, 0, 0], [12, 2, 0], [10, 2, 0]].map(([x, y, z], i) => ({ id: `wall:${i}`, position: { x, y, z } })));
    const handles = shownGlobalHandles(scene(runtime));
    assert.deepEqual(handles.map((h) => h.kind).sort(), ["height", "pivot", "rotate"]);
    const pivot = handles.find((h) => h.kind === "pivot");
    assert.ok(Math.abs(pivot.position.x - 2) < 1e-9 && Math.abs(pivot.position.z - 1) < 1e-9, "at the platform's middle");
  } finally { session.free(); }
});

test("the rotate handle turns a platform a quarter round its middle, keeps to its circle while dragged, and undoes", () => {
  const fixture = sessionFixture();
  const { runtime, session, ctx, calls } = fixture;
  const params = platformContourTool.defaultParams();
  try {
    square(runtime, "floor", 0, 0);
    const handle = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "rotate");
    const from = Math.atan2(handle.position.z - handle.pivot.z, handle.position.x - handle.pivot.x);
    // The pointer wanders well off the handle's circle: the handle does not.
    const points = Array.from({ length: 12 }, (_, i) => {
      const a = from + (Math.PI / 2) * ((i + 1) / 12);
      return { x: handle.pivot.x + 9 * Math.cos(a), y: 0, z: handle.pivot.z + 9 * Math.sin(a) };
    });
    const shown = drag(platformContourTool, fixture, handle, points, params);
    const reach = Math.hypot(handle.position.x - handle.pivot.x, handle.position.z - handle.pivot.z);
    assert.ok(shown.length > 0 && shown.every((p) => Math.abs(Math.hypot(p.x - handle.pivot.x, p.z - handle.pivot.z) - reach) < 1e-6), "the handle stayed on its circle");
    const corner = node(runtime, "floor:0").position;
    assert.ok(Math.abs(corner.x - 3) < 1e-6 && Math.abs(corner.z + 1) < 1e-6, `(0,0) turned a quarter round (2,1): ${JSON.stringify(corner)} ${JSON.stringify(calls.feedback.slice(-2))}`);
    const entry = ctx.history.undo();
    assert.equal(entry.kind, "region-edit");
    runtime.applyRegionEdit(entry.undo);
    const back = node(runtime, "floor:0").position;
    assert.ok(Math.abs(back.x) < 1e-9 && Math.abs(back.z) < 1e-9, "undo puts it back");
  } finally { session.free(); }
});

test("a platform with a wall standing on it is not turned out from under the wall", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    square(runtime, "floor", 0, 0);
    addFace(runtime, "wall", "wall-white", [
      { id: "floor:0", position: { x: 0, y: 0, z: 0 } }, { id: "floor:1", position: { x: 4, y: 0, z: 0 } },
      { id: "wall:top1", position: { x: 4, y: 3, z: 0 } }, { id: "wall:top0", position: { x: 0, y: 3, z: 0 } },
    ]);
    const handle = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "rotate");
    const from = Math.atan2(handle.position.z - handle.pivot.z, handle.position.x - handle.pivot.x);
    const before = session.snapshot_json();
    drag(platformContourTool, fixture, handle, [{ x: handle.pivot.x + 5 * Math.cos(from + 1), y: 0, z: handle.pivot.z + 5 * Math.sin(from + 1) }], platformContourTool.defaultParams());
    assert.equal(session.snapshot_json(), before);
    assert.ok(calls.feedback.some((f) => f.tone === "error" && /apoiado/.test(f.message)), JSON.stringify(calls.feedback.slice(-2)));
  } finally { session.free(); }
});

test("the height handle raises a platform, only straight up, through its own role", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    square(runtime, "floor", 0, 0, 1, "platform-floating");
    const handle = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "height");
    const shown = drag(platformContourTool, fixture, handle, [{ x: 30, y: 0, z: 30 }], { ...platformContourTool.defaultParams(), support: "floating" }, { screenY: 220 });
    assert.ok(shown.every((p) => Math.abs(p.x - handle.position.x) < 1e-9 && Math.abs(p.z - handle.position.z) < 1e-9), "the handle only moved up");
    assert.ok([0, 1, 2, 3].every((i) => Math.abs(node(runtime, `floor:${i}`).position.y - 3) < 1e-9), `80 px up is 2 m: ${JSON.stringify(calls.feedback.slice(-2))}`);
  } finally { session.free(); }
});

test("a straight ramp is moved by its pivot and turned by its rotate handle, and stays a clean trapezoid", () => {
  const fixture = sessionFixture();
  const { runtime, session, ctx, calls } = fixture;
  const params = { bottomWidth: 2, topWidth: 1, rise: 2 };
  try {
    const start = { point: { x: 0, y: 0, z: 0 } }, end = { point: { x: 6, y: 0, z: 0 } };
    slopeRampTool.onPointerUp(ctx, { start, current: end, samples: [start, end] }, params);
    const pivot = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "pivot" && h.owner === "platform-ramp");
    drag(slopeRampTool, fixture, pivot, [{ x: pivot.position.x + 5, y: 0, z: pivot.position.z + 1 }], params);
    const moved = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "pivot" && h.owner === "platform-ramp");
    assert.ok(Math.abs(moved.pivot.x - pivot.pivot.x - 5) < 1e-6 && Math.abs(moved.pivot.z - pivot.pivot.z - 1) < 1e-6, JSON.stringify(calls.feedback.slice(-2)));
    const rotate = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "rotate" && h.owner === "platform-ramp");
    const from = Math.atan2(rotate.position.z - rotate.pivot.z, rotate.position.x - rotate.pivot.x);
    drag(slopeRampTool, fixture, rotate, Array.from({ length: 6 }, (_, i) => ({ x: rotate.pivot.x + 6 * Math.cos(from + (i + 1) * 0.2), y: 0, z: rotate.pivot.z + 6 * Math.sin(from + (i + 1) * 0.2) })), params);
    assert.match(calls.feedback.at(-1).message, /girada/, JSON.stringify(calls.feedback.slice(-3)));
  } finally { session.free(); }
});
