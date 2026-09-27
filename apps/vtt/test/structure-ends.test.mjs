import assert from "node:assert/strict";
import test from "node:test";
import { shownGlobalHandles } from "../src/features/edit-construction/index.ts";
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

test("a curved ramp's free end dragged onto a floor's edge connects there", async () => {
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

/** A pointer sample as the view gives it: where the camera ray from `eye` through `aim` hits the ground, and that ray. */
function aimed(eye, aim) {
  const d = { x: aim.x - eye.x, y: aim.y - eye.y, z: aim.z - eye.z };
  const length = Math.hypot(d.x, d.y, d.z);
  const direction = { x: d.x / length, y: d.y / length, z: d.z / length };
  const t = -eye.y / direction.y;
  return { point: { x: eye.x + direction.x * t, y: 0, z: eye.z + direction.z * t }, ray: { origin: eye, direction } };
}

test("the ramp's top lands on a raised floor's edge the pointer aims at, though the ray meets the ground behind it", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    floor(runtime, "high", 10, 2, "platform-floating");
    const eye = { x: 0, y: 12, z: 2 };
    const end = aimed(eye, { x: 9.8, y: 2, z: 2 });
    assert.ok(end.point.x > 11, "the ray's ground hit is well past the edge");
    const start = { point: { x: 4, y: 0, z: 2 } };
    slopeRampTool.onPointerUp(fixture.ctx, { start, current: end, samples: [start, end] }, params);
    assert.ok(calls.feedback.at(-1).message.includes("2 ponta"), JSON.stringify(calls.feedback.at(-1)));
    close(centre(ramp(runtime), "top").x, 10, "the top on the high floor's edge");
  } finally { session.free(); }
});

test("a free ramp top stands under the pointer at its own height, not where the ray met the ground", () => {
  const fixture = sessionFixture();
  const { runtime, session } = fixture;
  try {
    const eye = { x: 0, y: 12, z: 0 };
    const end = aimed(eye, { x: 6, y: 2, z: 0 });
    const start = { point: { x: 0, y: 0, z: 0 } };
    slopeRampTool.onPointerUp(fixture.ctx, { start, current: end, samples: [start, end] }, params);
    const top = centre(ramp(runtime), "top");
    close(top.y, 2, "the top climbs the rise");
    close(top.x, 6, `under the pointer at that height, not at the ground hit ${end.point.x}`);
  } finally { session.free(); }
});

const nodeAt = (runtime, id) => runtime.getGraphSnapshot().nodes.find((n) => n.id === id).position;

test("a welded ramp moved away from its floor carries the solid floor whole; slid along the floor's edge it moves alone", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    drawn(fixture, { x: 4, y: 0, z: 2 }, { x: 8, y: 0, z: 2 });
    const pivot = handle(runtime, "pivot");
    // Along the edge (z): the ramp slides on the floor's side, the floor keeps its shape and place.
    dragEnd(fixture, "pivot", { x: pivot.position.x, y: 0, z: pivot.position.z + 0.5 });
    assert.equal(calls.feedback.at(-1).tone, "success", JSON.stringify(calls.feedback.at(-1)));
    close(nodeAt(runtime, "low:1").x, 4, "the floor stayed");
    close(nodeAt(runtime, "low:1").z, 0, "the floor stayed");
    close(centre(ramp(runtime), "bottom").z, 2.5, "the ramp slid along the edge");
    // Away from it (x): the floor comes along, whole.
    const again = handle(runtime, "pivot");
    dragEnd(fixture, "pivot", { x: again.position.x + 3, y: 0, z: again.position.z });
    assert.equal(calls.feedback.at(-1).tone, "success", JSON.stringify(calls.feedback.at(-1)));
    for (const [id, x, z] of [["low:0", 3, 0], ["low:1", 7, 0], ["low:2", 7, 4], ["low:3", 3, 4]]) {
      close(nodeAt(runtime, id).x, x, `${id} carried in x`);
      close(nodeAt(runtime, id).z, z, `${id} kept its z`);
    }
    assert.ok(welded(faces(runtime, "platform")[0], ramp(runtime), "bottom"), "still welded");
  } finally { session.free(); }
});

test("turning a welded ramp turns the solid floor it lands on with it", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    drawn(fixture, { x: 4, y: 0, z: 2 }, { x: 8, y: 0, z: 2 });
    const rotate = handle(runtime, "rotate");
    const { pivot } = rotate;
    const from = Math.atan2(rotate.position.z - pivot.z, rotate.position.x - pivot.x);
    const reach = Math.hypot(rotate.position.x - pivot.x, rotate.position.z - pivot.z);
    const before = nodeAt(runtime, "low:0");
    dragEnd(fixture, "rotate", { x: pivot.x + reach * Math.cos(from + Math.PI / 2), y: 0, z: pivot.z + reach * Math.sin(from + Math.PI / 2) });
    assert.ok(!calls.feedback.some((f) => f.tone === "error"), JSON.stringify(calls.feedback.slice(-2)));
    const after = nodeAt(runtime, "low:0");
    const r = (p) => Math.hypot(p.x - pivot.x, p.z - pivot.z);
    close(r(after), r(before), "the floor's corner turned round the ramp's pivot");
    assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 1, "and actually moved");
    assert.ok(welded(faces(runtime, "platform")[0], ramp(runtime), "bottom"), "still welded");
  } finally { session.free(); }
});

test("a curved ramp moved or turned by its whole-structure handles carries the solid floor welded to it, still welded", async () => {
  const { commitPlatformSlope } = await import("../src/composition/tabletop/tools/slope/slope-commit.ts");
  const { slopeCurveTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { controlSectionId, isSpineControlNodeId } = await import("../src/features/edit-construction/index.ts");
  const fixture = sessionFixture();
  const { runtime, session, ctx, calls } = fixture;
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  const curve = { width: 1.5, rise: 2 };
  const spineHandle = (kind) => shownGlobalHandles(scene(runtime)).find((h) => h.kind === kind && h.owner === "platform-slope");
  const dragSpine = (kind, to) => {
    const grabbed = spineHandle(kind);
    const start = { nodeId: grabbed.id, point: grabbed.position, screenX: 100, screenY: 300 };
    const current = { point: to, screenX: 200, screenY: 300 };
    slopeCurveTool.onPointerDown(ctx, start, curve);
    slopeCurveTool.onPointerMove(ctx, { start, current, samples: [start, current] }, curve);
    slopeCurveTool.onPointerUp(ctx, { start, current, samples: [start, current] }, curve);
  };
  try {
    floor(runtime, "low", 0, 0);
    commitPlatformSlope(ctx, [{ x: 4, y: 0, z: 2 }, { x: 8, y: 2, z: 2 }], curve);
    const origin = runtime.getGraphSnapshot().nodes.find((n) => isSpineControlNodeId(n.id) && Math.abs(n.position.x - 4) < 1e-6);
    const weldedNow = () => ["min", "max"].every((side) => faces(runtime, "platform")[0].nodes.some((n) => n.id === controlSectionId(origin.id, side)));
    assert.ok(weldedNow(), "welded at creation");
    const pivot = spineHandle("pivot");
    dragSpine("pivot", { x: pivot.position.x + 3, y: 0, z: pivot.position.z + 1 });
    assert.ok(!calls.feedback.some((f) => f.tone === "error"), JSON.stringify(calls.feedback.slice(-2)));
    close(nodeAt(runtime, "low:0").x, 3, "the floor carried in x");
    close(nodeAt(runtime, "low:0").z, 1, "and in z");
    assert.ok(weldedNow(), "still welded after the move");
    const rotate = spineHandle("rotate");
    const from = Math.atan2(rotate.position.z - rotate.pivot.z, rotate.position.x - rotate.pivot.x);
    const reach = Math.hypot(rotate.position.x - rotate.pivot.x, rotate.position.z - rotate.pivot.z);
    const before = nodeAt(runtime, "low:0");
    dragSpine("rotate", { x: rotate.pivot.x + reach * Math.cos(from + Math.PI / 2), y: 0, z: rotate.pivot.z + reach * Math.sin(from + Math.PI / 2) });
    assert.ok(!calls.feedback.some((f) => f.tone === "error"), JSON.stringify(calls.feedback.slice(-2)));
    const after = nodeAt(runtime, "low:0");
    const r = (p) => Math.hypot(p.x - rotate.pivot.x, p.z - rotate.pivot.z);
    close(r(after), r(before), "the floor turned round the ramp's pivot");
    assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 1, "and moved");
    assert.ok(weldedNow(), "still welded after the turn");
  } finally { session.free(); }
});

test("a floor drawn against a ramp's free end welds it, without its corners being picked", async () => {
  const { commitPlatformContour } = await import("../src/composition/tabletop/tools/platform/platform-contour-tool.ts");
  const { commitPlatformSlope } = await import("../src/composition/tabletop/tools/slope/slope-commit.ts");
  const { controlSectionId, isSpineControlNodeId } = await import("../src/features/edit-construction/index.ts");
  const fixture = sessionFixture();
  const { runtime, session, ctx, calls } = fixture;
  try {
    // A straight ramp climbing east to a free top at x = 8, y = 2.
    drawn(fixture, { x: 4, y: 0, z: 2 }, { x: 8, y: 0, z: 2 });
    // A curved ramp climbing west to a free end at x = -4, y = 2.
    commitPlatformSlope(ctx, [{ x: 0, y: 0, z: 8 }, { x: -4, y: 2, z: 8 }], { width: 1.5 });
    const curveEnd = runtime.getGraphSnapshot().nodes.find((n) => isSpineControlNodeId(n.id) && Math.abs(n.position.x + 4) < 1e-6);
    // Floors drawn with sides running across each free end -- no corner anywhere near them.
    commitPlatformContour(ctx, [[8, -2], [12, -2], [12, 6], [8, 6]].map(([x, z]) => ({ point: { x, y: 2, z } })), { mode: "create", elevation: 2, support: "floating", shape: "rectangle" });
    assert.equal(calls.feedback.at(-1).tone, "success", JSON.stringify(calls.feedback.at(-1)));
    commitPlatformContour(ctx, [[-8, 4], [-4, 4], [-4, 12], [-8, 12]].map(([x, z]) => ({ point: { x, y: 2, z } })), { mode: "create", elevation: 2, support: "floating", shape: "rectangle" });
    const floors = faces(runtime, "platform-floating");
    assert.equal(floors.length, 2);
    const east = floors.find((f) => f.nodes.some((n) => n.position.x > 10));
    const west = floors.find((f) => f.nodes.some((n) => n.position.x < -6));
    assert.ok(welded(east, ramp(runtime), "top"), "the straight ramp's top is welded into the floor drawn against it");
    assert.ok(["min", "max"].every((side) => west.nodes.some((n) => n.id === controlSectionId(curveEnd.id, side))), "and the curved ramp's end into the other");
    assert.equal(ctx.history.undo()?.kind, "transaction", "one step with the floor it came with");
  } finally { session.free(); }
});

test("a straight ramp drawn from another ramp's free top runs straight on from it, sharing its end", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    drawn(fixture, { x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 });
    const first = ramp(runtime);
    // From just by the first ramp's top, at its height, off towards +x and a little sideways.
    drawn(fixture, { x: 6.2, y: 2, z: 0.1 }, { x: 10, y: 0, z: 0.8 });
    assert.match(calls.feedback.at(-1).message, /continuando outra estrutura/, JSON.stringify(calls.feedback.at(-1)));
    const second = faces(runtime, "platform-ramp").find((f) => f.surfaceKey.join() !== first.surfaceKey.join());
    const top = ["min", "max"].map((side) => first.nodes.find((n) => n.id.endsWith(`:ramp:top:${side}`)).id);
    assert.ok(top.every((id) => second.nodes.some((n) => n.id === id)), "the second ramp's bottom is the first one's top");
    const secondTop = second.nodes.filter((n) => !top.includes(n.id));
    assert.equal(secondTop.length, 2);
    for (const node of secondTop) close(node.position.z, node.position.z > 0 ? 0.5 : -0.5, "straight on, as wide as the first one's top");
    close(secondTop[0].position.y, 4, "climbing its own rise from the first one's top");
  } finally { session.free(); }
});

test("a straight ramp drawn from a curved ramp's free end takes that end over", async () => {
  const { commitPlatformSlope } = await import("../src/composition/tabletop/tools/slope/slope-commit.ts");
  const { controlSectionId, isSpineControlNodeId } = await import("../src/features/edit-construction/index.ts");
  const fixture = sessionFixture();
  const { runtime, session, ctx, calls } = fixture;
  try {
    commitPlatformSlope(ctx, [{ x: 0, y: 0, z: 8 }, { x: -4, y: 2, z: 8 }], { width: 1.5 });
    const end = runtime.getGraphSnapshot().nodes.find((n) => isSpineControlNodeId(n.id) && Math.abs(n.position.x + 4) < 1e-6);
    drawn(fixture, { x: -4.3, y: 0, z: 8 }, { x: -9, y: 0, z: 8 });
    assert.match(calls.feedback.at(-1).message, /continuando outra estrutura/, JSON.stringify(calls.feedback.at(-1)));
    const straight = ramp(runtime);
    assert.ok(["min", "max"].every((side) => straight.nodes.some((n) => n.id === controlSectionId(end.id, side))), "its bottom is the curved ramp's end");
    for (const side of ["min", "max"]) close(straight.nodes.find((n) => n.id === controlSectionId(end.id, side)).position.y, 2, "at that end's height");
  } finally { session.free(); }
});

test("a ramp's free end dragged onto another ramp's free end joins it there", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    drawn(fixture, { x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 });
    const first = ramp(runtime);
    drawn(fixture, { x: 12, y: 2, z: 0 }, { x: 16, y: 0, z: 0 });
    const second = () => faces(runtime, "platform-ramp").find((f) => f.surfaceKey.join() !== first.surfaceKey.join());
    const origin = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "origin" && second().nodes.some((n) => h.nodeIds.includes(n.id)) && !first.nodes.some((n) => h.nodeIds.includes(n.id)));
    const start = { nodeId: origin.id, point: origin.position, screenX: 100, screenY: 300 };
    const current = { point: { x: 6.3, y: 2, z: 0.2 }, screenX: 200, screenY: 300 };
    Object.assign(runtime, { showPreview() {}, clearPreview() {} });
    slopeRampTool.onPointerDown(fixture.ctx, start, params);
    slopeRampTool.onPointerMove(fixture.ctx, { start, current, samples: [start, current] }, params);
    slopeRampTool.onPointerUp(fixture.ctx, { start, current, samples: [start, current] }, params);
    assert.ok(!calls.feedback.some((f) => f && f.tone === "error"), JSON.stringify(calls.feedback.slice(-2)));
    const top = ["min", "max"].map((side) => first.nodes.find((n) => n.id.endsWith(`:ramp:top:${side}`)).id);
    assert.ok(top.every((id) => second().nodes.some((n) => n.id === id)), "the dragged end took the first ramp's top over");
  } finally { session.free(); }
});

test("a ramp welds to a round floor's curved edge: its end is the chord, its corners on the arc, the floor's outline unchanged", async () => {
  const { commitPlatformShape } = await import("../src/composition/tabletop/tools/platform/platform-contour-tool.ts");
  const { commitPlatformSlope } = await import("../src/composition/tabletop/tools/slope/slope-commit.ts");
  const { controlSectionId, isSpineControlNodeId } = await import("../src/features/edit-construction/index.ts");
  const fixture = sessionFixture();
  const { runtime, session, ctx, calls } = fixture;
  try {
    // A round floating floor of radius 4 round the origin: two half circles.
    commitPlatformShape(ctx, [
      { start: { x: 4, y: 0, z: 0 }, end: { x: -4, y: 0, z: 0 }, geometry: { kind: "arc", center: [0, 0], clockwise: false } },
      { start: { x: -4, y: 0, z: 0 }, end: { x: 4, y: 0, z: 0 }, geometry: { kind: "arc", center: [0, 0], clockwise: false } },
    ], { elevation: 0, mode: "create", support: "floating" });
    const round = () => faces(runtime, "platform-floating")[0];
    assert.equal(round().outerLoops[0].length, 2, JSON.stringify(calls.feedback.at(-1)));
    // A straight ramp off the arc, from just outside it, running out along the radius.
    drawn(fixture, { x: 3.5 * Math.cos(0.8), y: 0, z: 3.5 * Math.sin(0.8) }, { x: 9 * Math.cos(0.8), y: 0, z: 9 * Math.sin(0.8) });
    assert.match(calls.feedback.at(-1).message, /1 ponta\(s\) soldada/, JSON.stringify(calls.feedback.at(-1)));
    const ends = ramp(runtime);
    for (const side of ["min", "max"]) {
      const p = corner(ends, "bottom", side).position;
      close(Math.hypot(p.x, p.z), 4, `the bottom ${side} corner stands on the arc`);
    }
    assert.ok(welded(round(), ends, "bottom"), "welded into the round floor");
    const arcs = round().outerLoops[0];
    assert.ok(arcs.every((use) => use.geometry.kind === "arc"), "the floor's outline is still arcs only");
    // A curved ramp off the other side of it.
    commitPlatformSlope(ctx, [{ x: 0, y: 0, z: -4 }, { x: 0, y: 2, z: -9 }], { width: 1.5 });
    const end = runtime.getGraphSnapshot().nodes.find((n) => isSpineControlNodeId(n.id) && Math.abs(n.position.z + 9) > 1 && Math.abs(n.position.x) < 1e-6);
    assert.ok(["min", "max"].every((side) => round().nodes.some((n) => n.id === controlSectionId(end.id, side))), `the curved ramp welded too ${JSON.stringify(calls.feedback.at(-1))}`);
    for (const side of ["min", "max"]) {
      const p = round().nodes.find((n) => n.id === controlSectionId(end.id, side)).position;
      close(Math.hypot(p.x, p.z), 4, `its section's ${side} end on the arc`);
    }
    // Pulled away, the straight ramp comes off and the arcs it cut are whole again.
    const origin = shownGlobalHandles(scene(runtime)).find((h) => h.kind === "origin");
    const start = { nodeId: origin.id, point: origin.position, screenX: 100, screenY: 300 };
    const away = { point: { x: 7 * Math.cos(0.8), y: 0, z: 7 * Math.sin(0.8) }, screenX: 200, screenY: 300 };
    Object.assign(runtime, { showPreview() {}, clearPreview() {} });
    slopeRampTool.onPointerDown(ctx, start, params);
    slopeRampTool.onPointerMove(ctx, { start, current: away, samples: [start, away] }, params);
    slopeRampTool.onPointerUp(ctx, { start, current: away, samples: [start, away], moved: true }, params);
    assert.ok(!welded(round(), ramp(runtime), "bottom"), "the ramp came off");
    assert.ok(round().outerLoops[0].every((use) => use.geometry.kind === "arc"), "still arcs only");
    // Two half circles, one of them cut in three where the curved ramp still stands.
    assert.equal(round().outerLoops[0].length, 4, "the pieces the straight ramp cut joined back into one arc");
  } finally { session.free(); }
});

test("a curved ramp's end dragged onto a straight ramp's free end joins it: the straight ramp takes the end's cross-section over", async () => {
  const { commitPlatformSlope } = await import("../src/composition/tabletop/tools/slope/slope-commit.ts");
  const { slopeCurveTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { controlSectionId, isSpineControlNodeId } = await import("../src/features/edit-construction/index.ts");
  const fixture = sessionFixture();
  const { runtime, session, ctx, calls } = fixture;
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  const curve = { width: 1.5, rise: 2 };
  try {
    // A straight ramp climbing east, its top free at x = 6, y = 2.
    drawn(fixture, { x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 });
    // A curved ramp further east, its west end free.
    commitPlatformSlope(ctx, [{ x: 10, y: 2, z: 3 }, { x: 14, y: 4, z: 3 }], curve);
    const end = runtime.getGraphSnapshot().nodes.find((n) => isSpineControlNodeId(n.id) && Math.abs(n.position.x - 10) < 1e-6);
    const start = { nodeId: end.id, point: end.position };
    const target = { point: { x: 6.3, y: 0, z: 0.2 } };
    slopeCurveTool.onPointerDown(ctx, start, curve);
    slopeCurveTool.onPointerMove(ctx, { start, current: target, samples: [start, target] }, curve);
    slopeCurveTool.onPointerUp(ctx, { start, current: target, samples: [start, target], moved: true }, curve);
    assert.ok(!calls.feedback.some((f) => f && f.tone === "error"), JSON.stringify(calls.feedback.slice(-2)));
    const placed = runtime.getGraphSnapshot().nodes.find((n) => n.id === end.id).position;
    close(placed.x, 6, "the curved ramp's end on the straight one's top");
    close(placed.z, 0, "at its middle");
    close(placed.y, 2, "at its height");
    const straight = ramp(runtime);
    assert.ok(["min", "max"].every((side) => straight.nodes.some((n) => n.id === controlSectionId(end.id, side))), "the straight ramp's top is the curved one's end");
    // Pulled away again, the straight ramp keeps an end of its own where it stood.
    const again = { nodeId: end.id, point: placed };
    const away = { point: { x: 8, y: 0, z: 5 } };
    slopeCurveTool.onPointerDown(ctx, again, curve);
    slopeCurveTool.onPointerMove(ctx, { start: again, current: away, samples: [again, away] }, curve);
    slopeCurveTool.onPointerUp(ctx, { start: again, current: away, samples: [again, away], moved: true }, curve);
    const freed = ramp(runtime);
    assert.ok(!["min", "max"].some((side) => freed.nodes.some((n) => n.id === controlSectionId(end.id, side))), "the straight ramp let go");
    const tops = freed.nodes.filter((n) => Math.abs(n.position.x - 6) < 1e-6);
    assert.equal(tops.length, 2, "its top still where it stood");
  } finally { session.free(); }
});

test("a curved ramp drawn from a straight ramp's free top runs on from it, the straight ramp taking its end over", async () => {
  const { slopeCurveTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { controlSectionId, isSpineControlNodeId } = await import("../src/features/edit-construction/index.ts");
  const { clickAll } = await import("./curve-draft-fixture.mjs");
  const fixture = sessionFixture();
  const { runtime, session, ctx, calls } = fixture;
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  const curve = { width: 1.5, rise: 2, mode: "straight" };
  try {
    drawn(fixture, { x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 });
    // Straight mode: start just by the straight ramp's top, end off to the north-east.
    clickAll(slopeCurveTool, ctx, [{ x: 6.2, y: 2, z: 0.1 }, { x: 11, y: 0, z: 4 }], curve);
    assert.match(calls.feedback.at(-1).message, /continuando uma rampa/, JSON.stringify(calls.feedback.at(-1)));
    const start = runtime.getGraphSnapshot().nodes.find((n) => isSpineControlNodeId(n.id) && Math.abs(n.position.x - 6) < 1e-6);
    assert.ok(start, "the curved ramp starts on the straight one's top");
    close(start.position.y, 2, "at its height");
    const straight = ramp(runtime);
    assert.ok(["min", "max"].every((side) => straight.nodes.some((n) => n.id === controlSectionId(start.id, side))), "the straight ramp's top is the curved one's start");
  } finally { session.free(); }
});

/** Drags the vertical handle `kind` of `owner` up by `dy`, 40 screen pixels a unit, with `tool`. */
function lift(fixture, tool, toolParams, owner, kind, dy) {
  Object.assign(fixture.runtime, { showPreview() {}, clearPreview() {} });
  const grabbed = shownGlobalHandles(scene(fixture.runtime)).find((h) => h.kind === kind && h.owner === owner);
  assert.ok(grabbed && grabbed.motion.kind === "vertical", `${owner} shows a vertical ${kind} handle`);
  const start = { nodeId: grabbed.id, point: grabbed.position, screenX: 100, screenY: 300 };
  const current = { point: grabbed.position, screenX: 100, screenY: 300 - dy * 40 };
  tool.onPointerDown(fixture.ctx, start, toolParams);
  tool.onPointerMove(fixture.ctx, { start, current, samples: [start, current] }, toolParams);
  tool.onPointerUp(fixture.ctx, { start, current, samples: [start, current], moved: true }, toolParams);
}

test("each end of a straight ramp has its own height handle: raising one changes how steeply it climbs, off any floor it held", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    drawn(fixture, { x: 4, y: 0, z: 2 }, { x: 8, y: 0, z: 2 });
    lift(fixture, slopeRampTool, params, "platform-ramp", "destinationHeight", 1);
    assert.equal(calls.feedback.at(-1).tone, "success", JSON.stringify(calls.feedback.at(-1)));
    close(centre(ramp(runtime), "top").y, 3, "the top raised by one");
    close(centre(ramp(runtime), "bottom").y, 0, "the bottom where it was");
    close(centre(ramp(runtime), "top").x, 8, "and nowhere else");
    assert.ok(welded(faces(runtime, "platform")[0], ramp(runtime), "bottom"), "the bottom still welded");
    lift(fixture, slopeRampTool, params, "platform-ramp", "originHeight", 0.5);
    close(centre(ramp(runtime), "bottom").y, 0.5, "the bottom raised by a half");
    assert.ok(!welded(faces(runtime, "platform")[0], ramp(runtime), "bottom"), "off the floor it no longer stands on");
    for (const i of [0, 1, 2, 3]) close(runtime.getGraphSnapshot().nodes.find((n) => n.id === `low:${i}`).position.y, 0, "the solid floor stays where it was");
  } finally { session.free(); }
});

test("a curved ramp has a height handle at each end for its climb, and one in the middle raising it whole with its floor", async () => {
  const { commitPlatformSlope } = await import("../src/composition/tabletop/tools/slope/slope-commit.ts");
  const { slopeCurveTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { controlSectionId, isSpineControlNodeId } = await import("../src/features/edit-construction/index.ts");
  const fixture = sessionFixture();
  const { runtime, session, ctx, calls } = fixture;
  const curve = { width: 1.5, rise: 2 };
  const control = (x) => runtime.getGraphSnapshot().nodes.find((n) => isSpineControlNodeId(n.id) && Math.abs(n.position.x - x) < 1e-6);
  try {
    floor(runtime, "low", 0, 0);
    commitPlatformSlope(ctx, [{ x: 4, y: 0, z: 2 }, { x: 8, y: 2, z: 2 }], curve);
    const start = control(4);
    lift(fixture, slopeCurveTool, curve, "platform-slope", "destinationHeight", 1);
    assert.ok(!calls.feedback.some((f) => f && f.tone === "error"), JSON.stringify(calls.feedback.slice(-2)));
    close(control(8).position.y, 3, "the far end raised by one");
    close(control(4).position.y, 0, "the near end where it was");
    // The whole ramp up by a half: the floor welded to it comes along, still welded.
    lift(fixture, slopeCurveTool, curve, "platform-slope", "height", 0.5);
    close(control(8).position.y, 3.5, "far end up");
    close(control(4).position.y, 0.5, "near end up");
    close(runtime.getGraphSnapshot().nodes.find((n) => n.id === "low:0").position.y, 0.5, "the floor carried up with it");
    assert.ok(["min", "max"].every((side) => faces(runtime, "platform")[0].nodes.some((n) => n.id === controlSectionId(start.id, side))), "still welded");
    // The near end alone down again: off the floor, which stays.
    lift(fixture, slopeCurveTool, curve, "platform-slope", "originHeight", -0.25);
    close(control(4).position.y, 0.25, "near end lowered");
    assert.ok(!["min", "max"].some((side) => faces(runtime, "platform")[0].nodes.some((n) => n.id === controlSectionId(start.id, side))), "came off its floor");
    close(runtime.getGraphSnapshot().nodes.find((n) => n.id === "low:0").position.y, 0.5, "the floor stays");
  } finally { session.free(); }
});

test("each end's tilt handle stands on past that end, clear of the middle's height handle, and has its own look", async () => {
  const { HANDLE_GLYPHS } = await import("../src/composition/tabletop/handle-glyphs.ts");
  const fixture = sessionFixture();
  const { runtime, session } = fixture;
  try {
    drawn(fixture, { x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 });
    const top = handle(runtime, "destinationHeight"), bottom = handle(runtime, "originHeight"), whole = handle(runtime, "height");
    assert.ok(top.position.x > 6 && bottom.position.x < 0, "each on past its own end");
    assert.ok(Math.abs(whole.position.x - 3) < 1e-6, "the whole-ramp height handle stays in the middle");
    assert.equal(HANDLE_GLYPHS.destinationHeight, "tilt");
    assert.notEqual(HANDLE_GLYPHS.destinationHeight, HANDLE_GLYPHS.height, "not drawn like the whole-ramp height handle");
  } finally { session.free(); }
});
