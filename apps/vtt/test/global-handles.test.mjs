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

test("a platform shows pivot, rotate and height handles and one just outside each side and corner; a wall, which declares none, shows nothing", () => {
  const { runtime, session } = sessionFixture();
  try {
    square(runtime, "floor", 0, 0);
    addFace(runtime, "wall", "wall-white", [[10, 0, 0], [12, 0, 0], [12, 2, 0], [10, 2, 0]].map(([x, y, z], i) => ({ id: `wall:${i}`, position: { x, y, z } })));
    const handles = shownGlobalHandles(scene(runtime));
    assert.deepEqual(handles.map((h) => h.kind).filter((kind) => kind !== "side" && kind !== "corner").sort(), ["height", "pivot", "rotate"]);
    const sides = handles.filter((h) => h.kind === "side"), corners = handles.filter((h) => h.kind === "corner");
    assert.equal(sides.length, 4);
    assert.equal(corners.length, 4);
    // Outside the 4 x 2 platform, never on it -- a press on the platform itself builds against it.
    for (const h of [...sides, ...corners]) assert.ok(h.position.x < 0 || h.position.x > 4 || h.position.z < 0 || h.position.z > 2, JSON.stringify(h.position));
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
    // One transaction: the turn and whatever it reached undo together.
    const entry = ctx.history.undo();
    assert.equal(entry.kind, "transaction");
    session.undo_region_overlay(entry.transactionId);
    const back = node(runtime, "floor:0").position;
    assert.ok(Math.abs(back.x) < 1e-9 && Math.abs(back.z) < 1e-9, "undo puts it back");
  } finally { session.free(); }
});

test("a platform with a wall standing on it turns with the wall, as one piece", () => {
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
    const top = () => node(runtime, "wall:top1").position;
    const was = top();
    drag(platformContourTool, fixture, handle, [{ x: handle.pivot.x + 5 * Math.cos(from + Math.PI / 2), y: 0, z: handle.pivot.z + 5 * Math.sin(from + Math.PI / 2) }], platformContourTool.defaultParams());
    assert.ok(!calls.feedback.some((f) => f.tone === "error"), JSON.stringify(calls.feedback.slice(-2)));
    const now = top();
    const r = (p) => Math.hypot(p.x - handle.pivot.x, p.z - handle.pivot.z);
    assert.ok(Math.abs(r(now) - r(was)) < 1e-6 && Math.hypot(now.x - was.x, now.z - was.z) > 1, `the wall's top turned round the same pivot: ${JSON.stringify(now)}`);
    assert.equal(now.y, 3, "at its own height");
  } finally { session.free(); }
});

test("a grounded platform turns though the ground it cut rims it: the ground is rebuilt, not in the way", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    square(runtime, "floor", 0, 0);
    // The ground next to it shares the platform's own edge, as a cut leaves it.
    addFace(runtime, "ground", "terrain", [
      { id: "floor:1", position: { x: 4, y: 0, z: 0 } }, { id: "floor:0", position: { x: 0, y: 0, z: 0 } },
      { id: "ground:a", position: { x: 0, y: 0, z: -3 } }, { id: "ground:b", position: { x: 4, y: 0, z: -3 } },
    ]);
    const handle = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "rotate" && h.owner === "platform");
    const from = Math.atan2(handle.position.z - handle.pivot.z, handle.position.x - handle.pivot.x);
    drag(platformContourTool, fixture, handle, [{ x: handle.pivot.x + 5 * Math.cos(from + 0.3), y: 0, z: handle.pivot.z + 5 * Math.sin(from + 0.3) }], platformContourTool.defaultParams());
    assert.ok(!calls.feedback.some((f) => /apoiado/.test(f.message)), JSON.stringify(calls.feedback.slice(-2)));
    assert.ok(Math.abs(node(runtime, "floor:2").position.x - 4) > 1e-3, "the platform turned");
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

test("one registry lists every edit handle the scene shows, each with the kind its look is chosen by", async () => {
  const { sceneHandles } = await import("../src/features/edit-construction/index.ts");
  const { commitPlatformSlope } = await import("../src/composition/tabletop/tools/slope/slope-commit.ts");
  const { HANDLE_GLYPHS } = await import("../src/composition/tabletop/handle-glyphs.ts");
  const fixture = sessionFixture();
  const { runtime, session, ctx } = fixture;
  try {
    square(runtime, "floor", 0, 0);
    commitPlatformSlope(ctx, [{ x: 10, y: 0, z: 0 }, { x: 14, y: 2, z: 0 }, { x: 18, y: 4, z: 3 }], { width: 1.5 });
    const input = { graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), contour: [], port: runtime, cloudFor: runtime.cloudFor };
    const points = sceneHandles({ ...input, pointsOnly: true, owns: (type) => type === "platform-slope" });
    const kinds = new Set(points.map((h) => h.kind));
    for (const kind of ["anchor", "midpoint", "pivot", "rotate", "height"]) assert.ok(kinds.has(kind), `a spine tool shows its ${kind} handles`);
    assert.ok(!points.some((h) => h.kind === "pivot" && h.id.includes("floor")), "not the floor's, which it does not edit");
    const everything = sceneHandles({ ...input, pointsOnly: false, owns: () => true });
    assert.ok(everything.every((h) => HANDLE_GLYPHS[h.kind] !== undefined), "every kind has its look in the one catalog");
    assert.equal(new Set(everything.map((h) => h.id)).size, everything.length, "no two handles share an id");
  } finally { session.free(); }
});

test("a corner handle, just outside the corner, pushes both sides meeting there", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    square(runtime, "floor", 0, 0);
    const corner = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "corner" && h.position.x > 4 && h.position.z > 2);
    assert.ok(corner, "the north-east corner's handle");
    drag(platformContourTool, fixture, corner, [{ x: corner.position.x + 1, y: 0, z: corner.position.z + 0.5 }], platformContourTool.defaultParams());
    const p = node(runtime, "floor:2").position;
    assert.ok(Math.abs(p.x - 5) < 1e-6 && Math.abs(p.z - 2.5) < 1e-6, `${JSON.stringify(p)} ${JSON.stringify(calls.feedback)}`);
    assert.ok(Math.abs(node(runtime, "floor:1").position.x - 5) < 1e-6 && Math.abs(node(runtime, "floor:3").position.z - 2.5) < 1e-6, "both sides moved whole");
    assert.ok(Math.abs(node(runtime, "floor:0").position.x) < 1e-9 && Math.abs(node(runtime, "floor:0").position.z) < 1e-9, "the far corner stays");
  } finally { session.free(); }
});

test("a straight ramp's side handles stand off its long sides only and widen it; a press on the ramp itself edits nothing", () => {
  const fixture = sessionFixture();
  const { runtime, session, ctx } = fixture;
  const params = { bottomWidth: 2, topWidth: 1, rise: 2 };
  try {
    const start = { point: { x: 0, y: 0, z: 0 } }, end = { point: { x: 6, y: 0, z: 0 } };
    slopeRampTool.onPointerUp(ctx, { start, current: end, samples: [start, end] }, params);
    const before = JSON.stringify(runtime.getGraphSnapshot().nodes);
    const body = { point: { x: 3, y: 1, z: 0 } };
    slopeRampTool.onPointerDown(ctx, body, params);
    slopeRampTool.onPointerMove(ctx, { start: body, current: { point: { x: 5, y: 1, z: 2 } }, samples: [body] }, params);
    slopeRampTool.onCancel?.(ctx);
    assert.equal(JSON.stringify(runtime.getGraphSnapshot().nodes), before, "the ramp's body is never grabbed");
    const sides = shownGlobalHandles(scene(runtime)).filter((h) => h.kind === "side" && h.owner === "platform-ramp");
    assert.equal(sides.length, 2, "its two long sides; its ends are the origin and destination handles'");
    assert.ok(sides.every((h) => Math.abs(h.position.z) > 0.5), "each outside its side");
    const width = () => {
      const zs = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform-ramp").nodes.map((n) => n.position.z);
      return Math.max(...zs) - Math.min(...zs);
    };
    const wide = width();
    const side = sides[0];
    const out = Math.sign(side.position.z);
    drag(slopeRampTool, fixture, side, [{ x: side.position.x, y: 0, z: side.position.z + out * 0.5 }], params);
    assert.ok(width() > wide + 0.5, `widened both ways: ${wide} -> ${width()}`);
  } finally { session.free(); }
});

test("with a focus, the scene shows only the focused structure's handles", async () => {
  const { sceneHandles } = await import("../src/features/edit-construction/index.ts");
  const { runtime, session } = sessionFixture();
  try {
    square(runtime, "a", 0, 0);
    square(runtime, "b", 10, 0, 3, "platform-floating");
    const input = { ...scene(runtime), contour: [], pointsOnly: false, owns: () => true };
    const a = runtime.getAllRegionTopologies().find((t) => t.nodes.some((n) => n.id === "a:0"));
    const focused = sceneHandles({ ...input, focus: { faces: new Set([a.surfaceKey.join("\u0000")]), spineNodes: new Set() } });
    const all = sceneHandles(input);
    assert.ok(focused.length > 0 && focused.length < all.length);
    const shown = new Set(focused.map((h) => h.id));
    assert.ok(shownGlobalHandles(scene(runtime)).filter((h) => shown.has(h.id)).every((h) => h.nodeIds.includes("a:0")), "only a's");
    assert.equal(sceneHandles({ ...input, focus: { faces: new Set(), spineNodes: new Set() } }).length, 0, "nothing under the pointer, nothing shown");
  } finally { session.free(); }
});
