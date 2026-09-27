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

test("a press on a platform's side builds against it; the handle just outside the side pushes it", async () => {
  const { shownGlobalHandles } = await import("../src/features/edit-construction/index.ts");
  const { platformContourTool } = await import("../src/composition/tabletop/tools/platform/platform-contour-tool.ts");
  const fixture = sessionFixture();
  const { runtime, session, ctx, calls } = fixture;
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  const params = platformContourTool.defaultParams();
  try {
    face(runtime, "f", [[0, 0], [4, 0], [4, 4], [0, 4]], 0, "platform");
    const press = { point: { x: 4.05, y: 0, z: 2 } };
    platformContourTool.onPointerDown(ctx, press, params);
    platformContourTool.onPointerUp(ctx, { start: press, current: press, samples: [press], moved: false }, params);
    platformContourTool.onCancel?.(ctx);
    close(at(runtime, "f:1").x, 4, "the side itself is never grabbed");
    const scene = { graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: runtime.cloudFor };
    const east = shownGlobalHandles(scene).find((h) => h.kind === "side" && h.position.x > 4);
    assert.ok(east && Math.abs(east.position.z - 2) < 1e-9, "the east side's handle, just outside its middle");
    const start = { nodeId: east.id, point: east.position, screenX: 100, screenY: 300 };
    const current = { point: { x: east.position.x + 1, y: 0, z: 2.3 }, screenX: 200, screenY: 300 };
    platformContourTool.onPointerDown(ctx, start, params);
    platformContourTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
    platformContourTool.onPointerUp(ctx, { start, current, samples: [start, current], moved: true }, params);
    assert.ok(!calls.feedback.some((f) => f.tone === "error"), JSON.stringify(calls.feedback));
    close(at(runtime, "f:1").x, 5, "the east side pushed out, square to itself");
    close(at(runtime, "f:2").x, 5, "whole");
    close(at(runtime, "f:1").z, 0, "its corners slide along the sides next to it");
    assert.equal(runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform").length, 1, "no new area drawn");
  } finally { session.free(); }
});

test("a platform drawn a little crooked still resizes: near-straight edges are one side, shallow corners follow the push", () => {
  const { runtime, session } = sessionFixture();
  try {
    // The south side is drawn with a slight kink at (2, 0.01), and a shallow corner at (8, 1) before the east side.
    face(runtime, "f", [[0, 0], [2, 0.01], [4, 0], [8, 1], [8, 5], [0, 5]]);
    const south = edgeBetween(runtime, "f", 0, 1);
    for (const delta of [{ x: 0.1, y: 0, z: 0.1 }, { x: 0, y: 0, z: -0.5 }, { x: 0, y: 0, z: 0.5 }]) {
      const plan = edit(runtime, "f", { kind: "edge", edgeId: south }, delta);
      assert.equal(plan.kind, "apply", `${JSON.stringify(delta)}: ${plan.reason}`);
    }
    close(at(runtime, "f:0").x, 0, "the south-west corner slid along the west side only");
    close(at(runtime, "f:5").z, 5, "the north side stayed");
  } finally { session.free(); }
});

test("resizing a grounded platform re-cuts the ground in the same transaction; a floating one reaches no ground", async () => {
  const { commitRegionEdit } = await import("../src/composition/tabletop/effects/effect-commit.ts");
  const { latticeRegenerateReaction } = await import("../src/composition/tabletop/terrain/terrain-lattice-reaction.ts");
  const { runtime, session } = sessionFixture();
  runtime.getSnapshot = () => ({ tableId: "platform-test", map: { nodePositions: new Map(runtime.getGraphSnapshot().nodes.map((n) => [n.id, { position: n.position }])) } });
  const reached = [];
  const real = latticeRegenerateReaction(() => 1);
  const reactions = { "lattice-regenerate": (rt, effect, hits) => { reached.push({ surfaceType: effect.change.surfaceType, hits: hits.length }); return real(rt, effect, hits); } };
  try {
    face(runtime, "g", [[0, 0], [4, 0], [4, 4], [0, 4]], 0, "platform");
    face(runtime, "fl", [[10, 0], [14, 0], [14, 4], [10, 4]], 0, "platform-floating");
    addFace(runtime, "ground", "terrain", [[-2, -2], [16, -2], [16, 6], [-2, 6]].map(([x, z], i) => ({ id: `ground:${i}`, position: { x, y: 0, z } })));
    for (const prefix of ["g", "fl"]) {
      const topology = floorOf(runtime, prefix);
      const plan = planEdit(resolveCloudTopology(runtime, topology.surfaceKey), { surfaceKey: topology.surfaceKey, target: { kind: "edge", edgeId: edgeBetween(runtime, prefix, 1, 2) }, delta: { x: 1, y: 0, z: 0 } }, runtime.getGraphSnapshot(), runtime);
      assert.equal(plan.kind, "apply", plan.reason);
      const { recorded } = commitRegionEdit(runtime, plan.ops, { transactionId: `resize:${prefix}`, reactions });
      assert.ok(recorded, "one transaction");
    }
    assert.ok(reached.some((r) => r.surfaceType === "platform" && r.hits > 0), `the grounded platform's resize reached the ground: ${JSON.stringify(reached)}`);
    assert.ok(!reached.some((r) => r.surfaceType === "platform-floating" && r.hits > 0), "the floating one's did not");
    close(at(runtime, "g:1").x, 5, "and the resize itself stands");
  } finally { session.free(); }
});

test("a grounded platform moved far rebuilds the ground its rim nodes dragged along, not only where it stood and went", async () => {
  const { commitRegionEdit } = await import("../src/composition/tabletop/effects/effect-commit.ts");
  const { latticeRegenerateReaction } = await import("../src/composition/tabletop/terrain/terrain-lattice-reaction.ts");
  const { runtime, session } = sessionFixture();
  runtime.getSnapshot = () => ({ tableId: "platform-test", map: { nodePositions: new Map(runtime.getGraphSnapshot().nodes.map((n) => [n.id, { position: n.position }])) } });
  const consumed = [];
  const reactions = { "lattice-regenerate": latticeRegenerateReaction((_rt, request) => { consumed.push(...request.consumedSurfaceKeys.map((key) => key.join(":"))); return 1; }) };
  try {
    face(runtime, "g", [[0, 0], [4, 0], [4, 4], [0, 4]], 0, "platform");
    // The ground the cut left: its rim is the platform's own south edge.
    addFace(runtime, "rim", "terrain", [
      { id: "g:1", position: { x: 4, y: 0, z: 0 } }, { id: "g:0", position: { x: 0, y: 0, z: 0 } },
      { id: "rim:a", position: { x: 0, y: 0, z: -3 } }, { id: "rim:b", position: { x: 4, y: 0, z: -3 } },
    ]);
    const rim = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "terrain");
    const topology = floorOf(runtime, "g");
    const plan = planEdit(resolveCloudTopology(runtime, topology.surfaceKey), { surfaceKey: topology.surfaceKey, target: { kind: "region" }, delta: { x: 30, y: 0, z: 30 } }, runtime.getGraphSnapshot(), runtime);
    assert.equal(plan.kind, "apply", plan.reason);
    commitRegionEdit(runtime, plan.ops, { transactionId: "move-far", reactions });
    assert.ok(consumed.includes(rim.surfaceKey.join(":")), `the stretched rim ground is rebuilt: ${JSON.stringify(consumed)}`);
  } finally { session.free(); }
});

test("a floor drawn against another of its kind at its height joins it into one floor; another kind stays apart", async () => {
  const { commitPlatformContour } = await import("../src/composition/tabletop/tools/platform/platform-contour-tool.ts");
  const { runtime, session, ctx, calls } = sessionFixture();
  const draw = (corners, support) => commitPlatformContour(ctx, corners.map(([x, z]) => ({ point: { x, y: 1, z } })), { mode: "create", elevation: 1, support, shape: "rectangle" });
  try {
    draw([[0, 0], [4, 0], [4, 4], [0, 4]], "floating");
    // Against the first one's east side, only part of the way along it.
    draw([[4, 1], [8, 1], [8, 3], [4, 3]], "floating");
    assert.equal(calls.feedback.at(-1).tone, "success", JSON.stringify(calls.feedback.at(-1)));
    const floating = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform-floating");
    assert.equal(floating.length, 1, "one floor now");
    const xs = floating[0].nodes.map((n) => n.position.x);
    assert.ok(Math.min(...xs) === 0 && Math.max(...xs) === 8, "covering both");
    // A grounded floor against it is another kind: it stays its own.
    draw([[-4, 0], [0, 0], [0, 4], [-4, 4]], "grounded");
    assert.equal(runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform-floating").length, 1);
    assert.equal(runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "platform").length, 1);
  } finally { session.free(); }
});
