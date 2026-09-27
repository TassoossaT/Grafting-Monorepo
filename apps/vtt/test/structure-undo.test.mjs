import assert from "node:assert/strict";
import test from "node:test";
import { shownGlobalHandles } from "../src/features/edit-construction/index.ts";
import { slopeCurveTool, slopeRampTool } from "../src/composition/tabletop/tools/slope/slope-tools.ts";
import { commitPlatformContour, commitPlatformShape, platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { commitPlatformSlope } from "../src/composition/tabletop/tools/slope/slope-commit.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";

/**
 * Every structure edit is one undoable transaction: undoing it puts the
 * whole table back exactly as it was, and redoing it brings back exactly
 * what it made -- welds, the floors it carried and all.
 */

const ramp = { bottomWidth: 2, topWidth: 1, rise: 2 };
const curve = { width: 1.5, rise: 2 };
const floor = (runtime, prefix, x0, y, type = "platform") => addFace(runtime, prefix, type,
  [[x0, 0], [x0 + 4, 0], [x0 + 4, 4], [x0, 4]].map(([x, z], i) => ({ id: `${prefix}:${i}`, position: { x, y, z } })));
const scene = (runtime) => ({ graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: runtime.cloudFor });
/** The whole table: every face with its outline, and the graph -- what an undo must restore exactly. */
const state = (runtime) => JSON.stringify({
  faces: runtime.getAllRegionTopologies().map((t) => ({ key: t.surfaceKey.join("/"), type: t.surfaceType, loops: [...t.outerLoops, ...t.holes], nodes: t.nodes }))
    .sort((a, b) => (a.key < b.key ? -1 : 1)),
  graph: runtime.getGraphSnapshot(),
});
const handle = (runtime, kind, owner) => shownGlobalHandles(scene(runtime)).find((h) => h.kind === kind && h.owner === owner);

function drag(tool, params, ctx, grabbed, to) {
  const start = { nodeId: grabbed.id, point: grabbed.position, screenX: 100, screenY: 300 };
  const current = { point: to, screenX: 200, screenY: 300 };
  tool.onPointerDown(ctx, start, params);
  tool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
  tool.onPointerUp(ctx, { start, current, samples: [start, current], moved: true }, params);
}
const turn = (grabbed, angle) => {
  const a = Math.atan2(grabbed.position.z - grabbed.pivot.z, grabbed.position.x - grabbed.pivot.x) + angle;
  const r = Math.hypot(grabbed.position.x - grabbed.pivot.x, grabbed.position.z - grabbed.pivot.z);
  return { x: grabbed.pivot.x + r * Math.cos(a), y: 0, z: grabbed.pivot.z + r * Math.sin(a) };
};
function drawRamp(ctx, from, to) {
  const start = { point: from }, end = { point: to };
  slopeRampTool.onPointerUp(ctx, { start, current: end, samples: [start, end] }, ramp);
}

/** A low floor with a ramp welded to it, climbing to a floating floor welded at its top. */
function assembly() {
  const fixture = sessionFixture();
  Object.assign(fixture.runtime, { showPreview() {}, clearPreview() {} });
  floor(fixture.runtime, "low", 0, 0);
  floor(fixture.runtime, "high", 10, 2, "platform-floating");
  drawRamp(fixture.ctx, { x: 4, y: 0, z: 2 }, { x: 10, y: 0, z: 2 });
  return fixture;
}

const edits = {
  "drawing a welded ramp": (f) => drawRamp(f.ctx, { x: 4, y: 0, z: 1 }, { x: 10, y: 0, z: 1 }),
  "drawing a ramp on from another ramp's free end": (f) => {
    drawRamp(f.ctx, { x: 0, y: 0, z: 8 }, { x: 5, y: 0, z: 8 });
    drawRamp(f.ctx, { x: 5.2, y: 2, z: 8 }, { x: 9, y: 0, z: 8 });
  },
  "a curved ramp's end dragged onto a straight ramp's free end": (f) => {
    drawRamp(f.ctx, { x: 0, y: 0, z: 8 }, { x: 5, y: 0, z: 8 });
    commitPlatformSlope(f.ctx, [{ x: 9, y: 2, z: 11 }, { x: 13, y: 4, z: 11 }], curve);
    const end = f.runtime.getGraphSnapshot().nodes.find((n) => n.id.startsWith("spine:") && Math.abs(n.position.x - 9) < 1e-6);
    const start = { nodeId: end.id, point: end.position }, current = { point: { x: 5.3, y: 0, z: 8.2 } };
    slopeCurveTool.onPointerDown(f.ctx, start, curve);
    slopeCurveTool.onPointerMove(f.ctx, { start, current, samples: [start, current] }, curve);
    slopeCurveTool.onPointerUp(f.ctx, { start, current, samples: [start, current], moved: true }, curve);
  },
  "a ramp welded to a round floor's curved edge": (f) => {
    commitPlatformShape(f.ctx, [
      { start: { x: -16, y: 0, z: -20 }, end: { x: -24, y: 0, z: -20 }, geometry: { kind: "arc", center: [-20, -20], clockwise: false } },
      { start: { x: -24, y: 0, z: -20 }, end: { x: -16, y: 0, z: -20 }, geometry: { kind: "arc", center: [-20, -20], clockwise: false } },
    ], { elevation: 0, mode: "create", support: "floating" });
    drawRamp(f.ctx, { x: -20 + 3.6 * Math.cos(0.8), y: 0, z: -20 + 3.6 * Math.sin(0.8) }, { x: -20 + 9 * Math.cos(0.8), y: 0, z: -20 + 9 * Math.sin(0.8) });
  },
  "raising a welded ramp's bottom alone": (f) => {
    const grabbed = handle(f.runtime, "originHeight", "platform-ramp");
    const start = { nodeId: grabbed.id, point: grabbed.position, screenX: 100, screenY: 300 };
    const current = { point: grabbed.position, screenX: 100, screenY: 260 };
    slopeRampTool.onPointerDown(f.ctx, start, ramp);
    slopeRampTool.onPointerMove(f.ctx, { start, current, samples: [start, current] }, ramp);
    slopeRampTool.onPointerUp(f.ctx, { start, current, samples: [start, current], moved: true }, ramp);
  },
  "moving a ramp end to reconnect it": (f) => {
    const end = handle(f.runtime, "destination", "platform-ramp");
    drag(slopeRampTool, ramp, f.ctx, end, { x: end.position.x - 2, y: 0, z: end.position.z });
  },
  "moving a welded ramp, its floors carried": (f) => {
    const pivot = handle(f.runtime, "pivot", "platform-ramp");
    drag(slopeRampTool, ramp, f.ctx, pivot, { x: pivot.position.x, y: 0, z: pivot.position.z + 3 });
  },
  "turning a floor, what is joined turning with it": (f) => {
    const rotate = handle(f.runtime, "rotate", "platform");
    drag(platformContourTool, platformContourTool.defaultParams(), f.ctx, rotate, turn(rotate, 0.6));
  },
  "pushing a floor's side out": (f) => {
    const side = shownGlobalHandles(scene(f.runtime)).find((h) => h.kind === "side" && h.position.x < 0);
    drag(platformContourTool, platformContourTool.defaultParams(), f.ctx, side, { x: side.position.x - 1, y: 0, z: side.position.z });
  },
  "drawing a floor against a free curved ramp end": (f) => {
    commitPlatformSlope(f.ctx, [{ x: 0, y: 0, z: 10 }, { x: -4, y: 2, z: 10 }], curve);
    commitPlatformContour(f.ctx, [[-8, 7], [-4, 7], [-4, 13], [-8, 13]].map(([x, z]) => ({ point: { x, y: 2, z } })), { mode: "create", elevation: 2, support: "floating", shape: "rectangle" });
  },
  "moving a welded curved ramp, its floor carried": (f) => {
    commitPlatformSlope(f.ctx, [{ x: 0, y: 0, z: 1 }, { x: -4, y: 2, z: 1 }], curve);
    const pivot = handle(f.runtime, "pivot", "platform-slope");
    drag(slopeCurveTool, curve, f.ctx, pivot, { x: pivot.position.x - 1, y: 0, z: pivot.position.z + 1 });
  },
};

for (const [name, run] of Object.entries(edits)) {
  test(`${name} undoes and redoes as one step`, () => {
    const fixture = assembly();
    const { session, runtime, ctx, calls } = fixture;
    try {
      const before = state(runtime);
      const firstStep = [];
      const record = ctx.history.record.bind(ctx.history);
      ctx.history.record = (entry) => { firstStep.push(entry); record(entry); };
      run(fixture);
      assert.ok(!calls.feedback.some((f) => f && f.tone === "error"), JSON.stringify(calls.feedback.filter((f) => f && f.tone === "error")));
      assert.ok(firstStep.length > 0 && firstStep.every((entry) => entry.kind === "transaction"), "recorded as transactions");
      const after = state(runtime);
      assert.notEqual(after, before, "the edit changed something");
      for (let i = firstStep.length - 1; i >= 0; i -= 1) session.undo_region_overlay(ctx.history.undo().transactionId);
      assert.equal(state(runtime), before, "undo puts every face, node and weld back");
      for (let i = 0; i < firstStep.length; i += 1) session.redo_region_overlay(ctx.history.redo().transactionId);
      assert.equal(state(runtime), after, "redo brings the edit back exactly");
    } finally { session.free(); }
  });
}
