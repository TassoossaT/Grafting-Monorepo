import assert from "node:assert/strict";
import test from "node:test";
import { planEdit, resolveCloudTopology } from "../src/features/edit-construction/index.ts";
import { slopeRampTool } from "../src/composition/tabletop/tools/slope/slope-tools.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);
const floorOf = (runtime, prefix) => runtime.getAllRegionTopologies().find((t) => t.nodes.some((n) => n.id === `${prefix}:0`));
const at = (runtime, id) => runtime.getGraphSnapshot().nodes.find((n) => n.id === id).position;
const face = (runtime, prefix, corners, y = 1, type = "platform-floating") =>
  addFace(runtime, prefix, type, corners.map(([x, z], i) => ({ id: `${prefix}:${i}`, position: { x, y, z } })));

function edit(runtime, prefix, target, delta) {
  const topology = floorOf(runtime, prefix);
  const plan = planEdit(resolveCloudTopology(runtime, topology.surfaceKey), { surfaceKey: topology.surfaceKey, target, delta }, runtime.getGraphSnapshot(), runtime);
  if (plan.kind === "apply") runtime.applyRegionEdit(plan.ops);
  return plan;
}
const edgeBetween = (runtime, prefix, a, b) => floorOf(runtime, prefix).outerLoops.flat()
  .find((use) => [use.startNodeId, use.endNodeId].sort().join() === [`${prefix}:${a}`, `${prefix}:${b}`].sort().join()).edgeId;

test("a side pushed out moves square to itself, its corners sliding along the slanted sides next to it, never changing height", () => {
  const { runtime, session } = sessionFixture();
  try {
    // A trapezoid: the top side (2-3) is shorter, its neighbours slant inwards.
    face(runtime, "f", [[0, 0], [6, 0], [5, 4], [1, 4]]);
    const plan = edit(runtime, "f", { kind: "edge", edgeId: edgeBetween(runtime, "f", 2, 3) }, { x: 3, y: 5, z: 2 });
    assert.equal(plan.kind, "apply", plan.reason);
    // Pushed 2 out along z; the slanted sides (slope 4 in z per 1 in x) carry the corners 0.5 further in.
    close(at(runtime, "f:2").z, 6, "the side moved square to itself by the delta's part across it");
    close(at(runtime, "f:2").x, 4.5, "the corner slid along its slanted neighbour");
    close(at(runtime, "f:3").x, 1.5, "and so did the other");
    close(at(runtime, "f:0").x, 0, "the far side stayed");
    for (const i of [0, 1, 2, 3]) close(at(runtime, `f:${i}`).y, 1, "no height changed");
  } finally { session.free(); }
});

test("a corner dragged moves the two sides meeting there, like resizing a box by its corner", () => {
  const { runtime, session } = sessionFixture();
  try {
    face(runtime, "f", [[0, 0], [4, 0], [4, 4], [0, 4]]);
    const plan = edit(runtime, "f", { kind: "vertex", nodeId: "f:2" }, { x: 1, y: 3, z: 2 });
    assert.equal(plan.kind, "apply", plan.reason);
    close(at(runtime, "f:2").x, 5, "the corner under the pointer, in x");
    close(at(runtime, "f:2").z, 6, "and in z");
    close(at(runtime, "f:1").x, 5, "the side across x came along");
    close(at(runtime, "f:1").z, 0, "sliding along its own neighbour");
    close(at(runtime, "f:3").z, 6, "the side across z came along");
    close(at(runtime, "f:3").x, 0, "sliding along its own neighbour");
    close(at(runtime, "f:0").x, 0, "the opposite corner stayed");
    for (const i of [0, 1, 2, 3]) close(at(runtime, `f:${i}`).y, 1, "no height changed");
  } finally { session.free(); }
});

test("a side split by a welded ramp still moves whole, and carries the ramp's end with it", () => {
  const fixture = sessionFixture();
  const { runtime, session } = fixture;
  try {
    face(runtime, "f", [[0, 0], [4, 0], [4, 4], [0, 4]], 0, "platform");
    const start = { point: { x: 4, y: 0, z: 2 } }, end = { point: { x: 8, y: 0, z: 2 } };
    slopeRampTool.onPointerUp(fixture.ctx, { start, current: end, samples: [start, end] }, { bottomWidth: 2, topWidth: 1, rise: 2 });
    assert.ok(floorOf(runtime, "f").outerLoops[0].length > 4, "the east side is split around the ramp");
    // The first piece of the east side, from its south corner up to the ramp.
    const eastBefore = floorOf(runtime, "f").outerLoops[0].find((use) => use.startNodeId === "f:1");
    const plan = edit(runtime, "f", { kind: "edge", edgeId: eastBefore.edgeId }, { x: 1, y: 0, z: 0 });
    assert.equal(plan.kind, "apply", plan.reason);
    close(at(runtime, "f:1").x, 5, "the east side's corner moved");
    close(at(runtime, "f:2").x, 5, "both of them");
    const ramp = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform-ramp");
    for (const node of ramp.nodes.filter((n) => n.id.includes(":ramp:bottom:"))) close(node.position.x, 5, "the ramp's welded end came along");
  } finally { session.free(); }
});

test("a side pushed in past its neighbours is refused rather than turning the platform over", () => {
  const { runtime, session } = sessionFixture();
  try {
    face(runtime, "f", [[0, 0], [6, 0], [5, 4], [1, 4]]);
    // The slanted sides meet 24 away from the base: pushing the top side past that point flips it.
    const plan = edit(runtime, "f", { kind: "edge", edgeId: edgeBetween(runtime, "f", 2, 3) }, { x: 0, y: 0, z: 30 });
    assert.equal(plan.kind, "deny");
  } finally { session.free(); }
});

test("pressing just off a platform's side, on the ground, grabs that side instead of starting a new area", async () => {
  const { platformContourTool } = await import("../src/composition/tabletop/tools/platform/platform-contour-tool.ts");
  const fixture = sessionFixture();
  const { runtime, session, ctx, calls } = fixture;
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  const params = platformContourTool.defaultParams();
  try {
    face(runtime, "f", [[0, 0], [4, 0], [4, 4], [0, 4]], 0, "platform");
    const start = { point: { x: 4.25, y: 0, z: 2 } };
    const current = { point: { x: 5.25, y: 0, z: 2.3 } };
    platformContourTool.onPointerDown(ctx, start, params);
    platformContourTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
    platformContourTool.onPointerUp(ctx, { start, current, samples: [start, current], moved: true }, params);
    assert.ok(!calls.feedback.some((f) => f.tone === "error"), JSON.stringify(calls.feedback));
    close(at(runtime, "f:1").x, 5, "the east side pushed out");
    close(at(runtime, "f:2").x, 5, "whole");
    assert.equal(runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform").length, 1, "no new area drawn");
  } finally { session.free(); }
});
