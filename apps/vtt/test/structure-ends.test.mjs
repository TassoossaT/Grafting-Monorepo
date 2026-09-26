import assert from "node:assert/strict";
import test from "node:test";
import { globalHandleActions, shownGlobalHandles } from "../src/features/edit-construction/index.ts";
import { slopeRampTool } from "../src/composition/tabletop/tools/slope/slope-tools.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";

const params = { bottomWidth: 2, topWidth: 1, rise: 2 };
const scene = (runtime) => ({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: runtime.cloudFor });
const faces = (runtime, type) => runtime.getAllRegionTopologies().filter((t) => t.surfaceType === type);
const ramp = (runtime) => faces(runtime, "platform-ramp")[0];
const corner = (topology, end, side) => topology.nodes.find((n) => n.id.endsWith(`:ramp:${end}:${side}`));
const centre = (topology, end) => {
  const a = corner(topology, end, "min").position, b = corner(topology, end, "max").position;
  return { x: (a.x + b.x) / 2, y: a.y, z: (a.z + b.z) / 2 };
};
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);
const floor = (runtime, prefix, x0, y, type = "platform") => addFace(runtime, prefix, type,
  [[x0, 0], [x0 + 4, 0], [x0 + 4, 4], [x0, 4]].map(([x, z], i) => ({ id: `${prefix}:${i}`, position: { x, y, z } })));
/** Whether `floor` shares both corners of the ramp's `end`. */
const welded = (floorFace, rampFace, end) => ["min", "max"].every((side) => floorFace.nodes.some((n) => n.id === corner(rampFace, end, side).id));
const handle = (runtime, kind) => shownGlobalHandles(scene(runtime)).find((h) => h.kind === kind && h.owner === "platform-ramp");

function drawn(fixture, start, end) {
  slopeRampTool.onPointerUp(fixture.ctx, { start: { point: start }, current: { point: end }, samples: [{ point: start }, { point: end }] }, params);
}

/** Drags the handle `kind` of the ramp to `to` with the ramp tool, as a pointer does. */
function dragEnd(fixture, kind, to) {
  Object.assign(fixture.runtime, { showPreview() {}, clearPreview() {} });
  const grabbed = handle(fixture.runtime, kind);
  const start = { nodeId: grabbed.id, point: grabbed.position, screenX: 100, screenY: 300 };
  const current = { point: to, screenX: 200, screenY: 300 };
  slopeRampTool.onPointerDown(fixture.ctx, start, params);
  slopeRampTool.onPointerMove(fixture.ctx, { start, current, samples: [start, current] }, params);
  slopeRampTool.onPointerUp(fixture.ctx, { start, current, samples: [start, current] }, params);
}

test("a straight ramp shows an origin and a destination handle at its ends' centres", () => {
  const fixture = sessionFixture();
  try {
    drawn(fixture, { x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 });
    close(handle(fixture.runtime, "origin").position.x, 0, "origin at the bottom");
    close(handle(fixture.runtime, "destination").position.x, 6, "destination at the top");
  } finally { fixture.session.free(); }
});

test("dragging a free destination onto a floor's edge connects it there, the welded origin staying put", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    floor(runtime, "high", 10, 2, "platform-floating");
    drawn(fixture, { x: 4, y: 0, z: 2 }, { x: 7, y: 0, z: 2 });
    const before = ramp(runtime);
    assert.ok(welded(faces(runtime, "platform")[0], before, "bottom"), "the origin starts welded");
    dragEnd(fixture, "destination", { x: 10.3, y: 0, z: 2.5 });
    assert.equal(calls.feedback.at(-1).tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const after = ramp(runtime);
    assert.equal(after.surfaceKey.join(), before.surfaceKey.join(), "still the same ramp");
    close(centre(after, "top").x, 10, "the top on the high floor's edge");
    close(centre(after, "top").z, 2, "square to the edges, the sideways drag dropped");
    close(centre(after, "top").y, 2, "at the high floor's height");
    close(centre(after, "bottom").x, 4, "the origin did not move");
    assert.ok(welded(faces(runtime, "platform-floating")[0], after, "top"), "the destination welded into the high floor");
    assert.ok(welded(faces(runtime, "platform")[0], after, "bottom"), "the origin still welded");
    assert.equal(fixture.ctx.history.undo()?.kind, "transaction", "recorded for undo as one transaction");
  } finally { session.free(); }
});

test("dragging a welded destination away disconnects it, and the floor's edge is whole again", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    floor(runtime, "high", 10, 2, "platform-floating");
    drawn(fixture, { x: 4, y: 0, z: 2 }, { x: 10, y: 0, z: 2 });
    assert.ok(welded(faces(runtime, "platform-floating")[0], ramp(runtime), "top"), "both ends start welded");
    dragEnd(fixture, "destination", { x: 7, y: 0, z: 2 });
    assert.equal(calls.feedback.at(-1).tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const high = faces(runtime, "platform-floating")[0];
    assert.ok(!welded(high, ramp(runtime), "top"), "the top came off the high floor");
    assert.equal(high.outerLoops[0].length, 4, "the high floor's west edge is one edge again");
    assert.ok(welded(faces(runtime, "platform")[0], ramp(runtime), "bottom"), "the origin still welded");
    close(centre(ramp(runtime), "top").x, 7, "the top where it was left");
  } finally { session.free(); }
});

test("a welded end offers Desconectar, which takes it off the floor and leaves the ramp standing", () => {
  const fixture = sessionFixture();
  const { runtime, session, ctx } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    drawn(fixture, { x: 4, y: 0, z: 2 }, { x: 8, y: 0, z: 2 });
    const origin = handle(runtime, "origin");
    assert.deepEqual(globalHandleActions(scene(runtime), handle(runtime, "destination").id), [], "a free end offers nothing");
    assert.deepEqual(slopeRampTool.selectionActions(ctx, origin.id).map((a) => a.id), ["disconnect"]);
    const standing = ramp(runtime).nodes.map((n) => JSON.stringify(n)).sort();
    assert.equal(slopeRampTool.onSelectionAction(ctx, "disconnect", params, origin.id), true);
    const low = faces(runtime, "platform")[0];
    assert.ok(!welded(low, ramp(runtime), "bottom"), "the origin came off");
    assert.equal(low.outerLoops[0].length, 4, "the floor's edge is whole again");
    assert.deepEqual(ramp(runtime).nodes.map((n) => JSON.stringify(n)).sort(), standing, "the ramp did not move");
    assert.deepEqual(slopeRampTool.selectionActions(ctx, handle(runtime, "origin").id), [], "nothing more to disconnect");
  } finally { session.free(); }
});

test("a curved ramp's free end dragged onto a floor's edge connects there, and disconnects on request", async () => {
  const { commitPlatformSlope } = await import("../src/composition/tabletop/tools/slope/slope-commit.ts");
  const { slopeCurveTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { controlSectionId, isSpineControlNodeId } = await import("../src/features/edit-construction/index.ts");
  const fixture = sessionFixture();
  const { runtime, session, ctx, calls } = fixture;
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  const curve = { width: 1.5, rise: 2 };
  const sharesEnd = (floorFace, id) => ["min", "max"].every((side) => floorFace.nodes.some((n) => n.id === controlSectionId(id, side)));
  try {
    floor(runtime, "low", 0, 0);
    floor(runtime, "high", 10, 2, "platform-floating");
    commitPlatformSlope(ctx, [{ x: 4, y: 0, z: 2 }, { x: 7, y: 2, z: 2 }], curve);
    const controls = runtime.getGraphSnapshot().nodes.filter((n) => isSpineControlNodeId(n.id));
    const end = controls.find((n) => Math.abs(n.position.x - 7) < 1e-6);
    const origin = controls.find((n) => Math.abs(n.position.x - 4) < 1e-6);
    assert.ok(sharesEnd(faces(runtime, "platform")[0], origin.id), "the start is welded at creation");
    const start = { nodeId: end.id, point: end.position };
    const target = { point: { x: 10.3, y: 0, z: 2.5 } };
    slopeCurveTool.onPointerDown(ctx, start, curve);
    slopeCurveTool.onPointerMove(ctx, { start, current: target, samples: [start, target] }, curve);
    slopeCurveTool.onPointerUp(ctx, { start, current: target, samples: [start, target] }, curve);
    const placed = runtime.getGraphSnapshot().nodes.find((n) => n.id === end.id).position;
    close(placed.x, 10, `the end sits on the high floor's edge ${JSON.stringify(calls.feedback.slice(-2))}`);
    close(placed.y, 2, "at the high floor's height");
    assert.ok(sharesEnd(faces(runtime, "platform-floating")[0], end.id), "the end welded into the high floor");
    assert.ok(sharesEnd(faces(runtime, "platform")[0], origin.id), "the start still welded");
    assert.deepEqual(slopeCurveTool.selectionActions(ctx, end.id).map((a) => a.id), ["disconnect"]);
    assert.equal(slopeCurveTool.onSelectionAction(ctx, "disconnect", curve, end.id), true);
    const high = faces(runtime, "platform-floating")[0];
    assert.ok(!sharesEnd(high, end.id), "the end came off");
    assert.equal(high.outerLoops[0].length, 4, "the high floor's edge is whole again");
  } finally { session.free(); }
});

test("a curved ramp's welded end dragged away from its floor comes off it", async () => {
  const { commitPlatformSlope } = await import("../src/composition/tabletop/tools/slope/slope-commit.ts");
  const { slopeCurveTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { controlSectionId, isSpineControlNodeId } = await import("../src/features/edit-construction/index.ts");
  const fixture = sessionFixture();
  const { runtime, session, ctx, calls } = fixture;
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  const curve = { width: 1.5, rise: 2 };
  try {
    floor(runtime, "low", 0, 0);
    commitPlatformSlope(ctx, [{ x: 4, y: 0, z: 2 }, { x: 8, y: 2, z: 2 }], curve);
    const origin = runtime.getGraphSnapshot().nodes.find((n) => isSpineControlNodeId(n.id) && Math.abs(n.position.x - 4) < 1e-6);
    const start = { nodeId: origin.id, point: origin.position };
    const target = { point: { x: 5.5, y: 0, z: 6 } };
    slopeCurveTool.onPointerDown(ctx, start, curve);
    slopeCurveTool.onPointerMove(ctx, { start, current: target, samples: [start, target] }, curve);
    slopeCurveTool.onPointerUp(ctx, { start, current: target, samples: [start, target] }, curve);
    const low = faces(runtime, "platform")[0];
    assert.ok(!low.nodes.some((n) => n.id === controlSectionId(origin.id, "min")), `the start came off ${JSON.stringify(calls.feedback.slice(-2))}`);
    assert.equal(low.outerLoops[0].length, 4, "the floor's edge is whole again");
    close(runtime.getGraphSnapshot().nodes.find((n) => n.id === origin.id).position.z, 6, "the start where it was dragged");
  } finally { session.free(); }
});
