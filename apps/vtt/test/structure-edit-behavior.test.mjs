import assert from "node:assert/strict";
import test from "node:test";

import { createStructureEditBehavior } from "../src/composition/tabletop/tools/core/structure-edit-behavior.ts";
import { curvePickId } from "../src/features/edit-construction/index.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";

/** A wall and a platform with entirely disjoint nodes -- the case that actually exercises `ownsType` filtering, unlike `building()`'s fixture where every wall corner doubles as a platform corner. */
function wallAndPlatform(runtime) {
  const wall = addFace(runtime, "wall-only", "wall-white", [
    { id: "w:a-bottom", position: { x: 0, y: 0, z: 0 } },
    { id: "w:b-bottom", position: { x: 4, y: 0, z: 0 } },
    { id: "w:b-top", position: { x: 4, y: 3, z: 0 } },
    { id: "w:a-top", position: { x: 0, y: 3, z: 0 } },
  ]);
  const platform = addFace(runtime, "platform-only", "platform", [
    { id: "p:0", position: { x: 10, y: 0, z: 0 } },
    { id: "p:1", position: { x: 14, y: 0, z: 0 } },
    { id: "p:2", position: { x: 14, y: 0, z: 4 } },
    { id: "p:3", position: { x: 10, y: 0, z: 4 } },
  ]);
  return { wall, platform };
}

test("a wall-scoped behavior grabs the wall's own vertex and edits it", () => {
  const { runtime, session } = sessionFixture();
  try {
    wallAndPlatform(runtime);
    const behavior = createStructureEditBehavior({ ownsType: (t) => t === "wall-white" });
    const grabbed = behavior.tryGrab({ runtime, reportSelection() {}, reportFeedback() {} }, { point: { x: 0, y: 0, z: 0 }, nodeId: "w:a-bottom" }, { mode: "shape" });
    assert.equal(grabbed, true);
    assert.equal(behavior.wasGrabbed(), true);
    assert.equal(behavior.isActive(), true);
  } finally { session.free(); }
});

test("a wall-scoped behavior refuses a platform's own vertex -- it does not own that type", () => {
  const { runtime, session } = sessionFixture();
  try {
    wallAndPlatform(runtime);
    const behavior = createStructureEditBehavior({ ownsType: (t) => t === "wall-white" });
    const grabbed = behavior.tryGrab({ runtime, reportSelection() {}, reportFeedback() {} }, { point: { x: 10, y: 0, z: 0 }, nodeId: "p:0" }, { mode: "shape" });
    assert.equal(grabbed, false);
    assert.equal(behavior.wasGrabbed(), false);
    assert.equal(behavior.isActive(), false);
  } finally { session.free(); }
});

test("a platform-scoped behavior grabs the platform's own vertex, and refuses the wall's", () => {
  const { runtime, session } = sessionFixture();
  try {
    wallAndPlatform(runtime);
    const behavior = createStructureEditBehavior({ ownsType: (t) => t === "platform" });
    assert.equal(behavior.tryGrab({ runtime, reportSelection() {}, reportFeedback() {} }, { point: { x: 10, y: 0, z: 0 }, nodeId: "p:0" }, { mode: "shape" }), true);
    assert.equal(behavior.tryGrab({ runtime, reportSelection() {}, reportFeedback() {} }, { point: { x: 0, y: 0, z: 0 }, nodeId: "w:a-bottom" }, { mode: "shape" }), false);
  } finally { session.free(); }
});

test("a curve handle is grabbed only by a tool owning the curve's type: a platform's curved edge is not the wall tool's", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    const { platform } = wallAndPlatform(runtime);
    const edgeId = platform.outerLoops[0][0].edgeId;
    runtime.applyRegionEdit([{ kind: "retype-edge", edgeId, geometry: { kind: "bezier", handle1: [11, -1], handle2: [13, -1] } }]);
    const sample = { point: { x: 12, y: 0, z: -1 }, nodeId: curvePickId(edgeId, "midpoint") };
    const walls = createStructureEditBehavior({ ownsType: (t) => t === "wall-white" });
    assert.equal(walls.tryGrab(ctx, sample, { mode: "shape" }), false);
    assert.equal(walls.isActive(), false);
    const platforms = createStructureEditBehavior({ ownsType: (t) => t === "platform" });
    assert.equal(platforms.tryGrab(ctx, sample, { mode: "shape" }), true);
  } finally { session.free(); }
});

test("a spine's curve handle is grabbed only by a tool owning the spine's type", () => {
  const runtime = {
    getGraphSnapshot: () => ({
      nodes: [{ id: "spine:op:0", position: { x: 0, y: 0, z: 0 } }, { id: "spine:op:1", position: { x: 4, y: 0, z: 0 } }],
      edges: [{ edgeId: "span", startNodeId: "spine:op:0", endNodeId: "spine:op:1", curve: { surfaceType: "road" } }],
    }),
    getCurvedEdges: () => [],
    getAllRegionTopologies: () => [],
  };
  const ctx = { runtime, nextSequence: () => 1, reportSelection() {}, reportFeedback() {} };
  const sample = { point: { x: 2, y: 0, z: 0 }, nodeId: curvePickId("span", "midpoint") };
  assert.equal(createStructureEditBehavior({ ownsType: (t) => t === "wall-white" }).tryGrab(ctx, sample, { mode: "shape" }), false);
  assert.equal(createStructureEditBehavior({ ownsType: (t) => t === "road" }).tryGrab(ctx, sample, { mode: "shape" }), true);
});

test("lifting a wall's top says exactly how high the wall stands now, in the ruler -- not only that something moved", () => {
  const { runtime, session, ctx } = sessionFixture();
  const shown = [];
  ctx.showRuler = (feedback) => shown.push(feedback);
  try {
    wallAndPlatform(runtime);
    const behavior = createStructureEditBehavior({ ownsType: (t) => t === "wall-white" });
    const start = { point: { x: 0, y: 3, z: 0 }, nodeId: "w:a-top", screenX: 100, screenY: 300 };
    assert.equal(behavior.tryGrab(ctx, start, { mode: "elevation" }), true);
    // One metre up the screen is one metre up: the pixels a metre takes are the gesture's own.
    const current = { point: start.point, screenX: 100, screenY: 300 - 40 };
    behavior.onPointerMove(ctx, { start, current, samples: [start, current] }, { mode: "elevation" });
    const measures = shown.filter(Boolean).at(-1)?.measures ?? [];
    const height = measures.find((m) => m.kind === "height");
    assert.ok(height, JSON.stringify(measures));
    // The wall stood 3 high above its foot; its top is a metre higher.
    assert.ok(Math.abs(height.meters - 4) < 1e-6 && Math.abs(height.level - 4) < 1e-6, JSON.stringify(measures));
    assert.ok(Math.abs(measures.find((m) => m.kind === "change").meters - 1) < 1e-6);
  } finally { session.free(); }
});

test("the height widget lands the wall's top on a round number, like every other lift -- and leaves it as dragged with the snap off", async () => {
  const { panelHeightWidgetPickId } = await import("../src/features/edit-construction/index.ts");
  for (const snap of [true, false]) {
    const { runtime, session, ctx } = sessionFixture();
    const shown = [];
    Object.assign(ctx, { showRuler: (feedback) => shown.push(feedback), rulerSnap: snap, rulerLengthStep: 0.5 });
    try {
      const { wall } = wallAndPlatform(runtime);
      const topEdge = wall.outerLoops[0][2].edgeId;
      const behavior = createStructureEditBehavior({ ownsType: (t) => t === "wall-white" });
      const start = { point: { x: 2, y: 3, z: 0 }, nodeId: panelHeightWidgetPickId(topEdge, "group"), screenX: 100, screenY: 300 };
      assert.equal(behavior.tryGrab(ctx, start, { mode: "elevation" }), true);
      // 41.6 pixels up the screen: the pointer has the top 1.04 higher.
      const current = { point: start.point, screenX: 100, screenY: 300 - 41.6 };
      behavior.onPointerMove(ctx, { start, current, samples: [start, current] }, { mode: "elevation" });
      const last = shown.filter(Boolean).at(-1);
      const height = last.measures.find((m) => m.kind === "height").meters;
      const tops = runtime.getGraphSnapshot().nodes.filter((n) => n.id.endsWith("-top")).map((n) => n.position.y);
      if (snap) {
        assert.ok(Math.abs(height - 4) < 1e-6, `4 m, not 4.04: ${height}`);
        assert.ok(last.guides.some((g) => g.kind === "step"), "the round number is marked");
        assert.ok(tops.every((y) => Math.abs(y - 4) < 1e-6), JSON.stringify(tops));
      } else {
        assert.ok(Math.abs(height - 4.04) < 1e-6, `as dragged: ${height}`);
        assert.equal(last.guides.length, 0);
      }
    } finally { session.free(); }
  }
});
