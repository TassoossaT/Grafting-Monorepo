import assert from "node:assert/strict";
import test from "node:test";
import { slopeCurveTool, slopeSpiralTool } from "../src/composition/tabletop/tools/slope/slope-tools.ts";
import { commitPlatformSlope } from "../src/composition/tabletop/tools/slope/slope-commit.ts";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";

const slopeSpans = (runtime) => runtime.getGraphSnapshot().edges.filter((e) => e.curve?.surfaceType === "platform-slope");
const node = (runtime, id) => runtime.getGraphSnapshot().nodes.find((n) => n.id === id);
const faces = (runtime, type) => runtime.getAllRegionTopologies().filter((t) => t.surfaceType === type);

/** The spine's control nodes walked end to end, with the plan length run up to each. */
function walk(runtime) {
  const spans = slopeSpans(runtime);
  const degree = new Map();
  for (const e of spans) for (const id of [e.startNodeId, e.endNodeId]) degree.set(id, (degree.get(id) ?? 0) + 1);
  let at = [...degree].find(([, d]) => d === 1)[0];
  const used = new Set(), out = [{ id: at, run: 0 }];
  while (used.size < spans.length) {
    const e = spans.find((s) => !used.has(s.edgeId) && (s.startNodeId === at || s.endNodeId === at));
    used.add(e.edgeId);
    const reversed = e.endNodeId === at;
    const a = node(runtime, e.startNodeId).position, b = node(runtime, e.endNodeId).position;
    const curve = runtime.curveBatch({ tolerance: 1e-4, commands: [{ kind: "resolve", handles: e.curve, start: [a.x, a.y, a.z], end: [b.x, b.y, b.z] }] })[0];
    at = reversed ? e.startNodeId : e.endNodeId;
    out.push({ id: at, run: out.at(-1).run + curve.lengths[0] });
  }
  return out.map((step) => ({ ...step, y: node(runtime, step.id).position.y }));
}

/** Whether every control node's height is where one constant grade by plan length puts it. */
function constantGrade(runtime, tolerance = 1e-3) {
  const steps = walk(runtime);
  const first = steps[0], last = steps.at(-1);
  return steps.every((s) => Math.abs(s.y - (first.y + (last.y - first.y) * s.run / last.run)) < tolerance);
}

function curveRamp(fixture, clicks, params = { width: 1.5, rise: 2 }) {
  for (const click of clicks) slopeCurveTool.onClick(fixture.ctx, click, params);
  slopeCurveTool.onKeyDown(fixture.ctx, "Enter", params);
}

test("a curved ramp is drawn through points in plan and climbs from its first point to its last at one constant grade", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    curveRamp(fixture, [{ point: { x: 0, y: 1, z: 0 } }, { point: { x: 3, y: 0, z: 2 } }, { point: { x: 5, y: 0, z: 6 } }, { point: { x: 9, y: 0, z: 7 } }]);
    const steps = walk(runtime);
    assert.equal(steps.length, 4, JSON.stringify(calls.feedback));
    assert.deepEqual([steps[0].y, steps.at(-1).y].sort(), [1, 3], "it starts at the first click's height and climbs the rise");
    assert.ok(constantGrade(runtime), JSON.stringify(steps));
    assert.match(calls.feedback.at(-1).message, /inclinação \d+%/, "the grade is reported");
  } finally { session.free(); }
});

test("a curved ramp ending on a floor ends at that floor's height, welded into its edge", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    const high = addFace(runtime, "high", "platform-floating", [[10, 0], [14, 0], [14, 4], [10, 4]].map(([x, z], i) => ({ id: `high:${i}`, position: { x, y: 2.5, z } })));
    const onFloor = { point: { x: 10, y: 2.5, z: 2 }, surfaceRef: surfaceRefFromNodeSet(high.surfaceKey) };
    curveRamp(fixture, [{ point: { x: 0, y: 0, z: 0 } }, { point: { x: 5, y: 0, z: 4 } }, onFloor], { width: 1.5, rise: 9 });
    const steps = walk(runtime);
    assert.deepEqual([steps[0].y, steps.at(-1).y].sort(), [0, 2.5], JSON.stringify(calls.feedback));
    assert.match(calls.feedback.at(-1).message, /1 ponta/, "the end on the floor's edge is welded");
    assert.ok(constantGrade(runtime));
  } finally { session.free(); }
});

test("a spiral is an exact helix: every point on its circle, at one constant grade", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  try {
    slopeSpiralTool.onClick(ctx, { point: { x: 0, y: 0, z: 0 } }, { width: 1.5, radius: 3, turns: 2, rise: 6 });
    const spans = slopeSpans(runtime);
    assert.ok(spans.length >= 8, JSON.stringify(calls.feedback));
    const samples = runtime.curveBatch({ tolerance: 0.01, commands: spans.map((e) => {
      const a = node(runtime, e.startNodeId).position, b = node(runtime, e.endNodeId).position;
      return { kind: "resolve", handles: e.curve, start: [a.x, a.y, a.z], end: [b.x, b.y, b.z] };
    }) }).flatMap((r) => r.samples[0]);
    const radii = samples.map((s) => Math.hypot(s.position[0], s.position[2]));
    assert.ok(Math.max(...radii.map((r) => Math.abs(r - 3))) < 0.005, `radius ${Math.min(...radii)}..${Math.max(...radii)}`);
    assert.ok(constantGrade(runtime));
  } finally { session.free(); }
});

test("dragging out from the centre sets the spiral's radius and where it starts", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  try {
    const start = { point: { x: 5, y: 1, z: 5 } }, end = { point: { x: 5, y: 0, z: 7 } };
    slopeSpiralTool.onPointerDown(ctx, start, { width: 1, radius: 9, turns: 1, rise: 3 });
    slopeSpiralTool.onPointerUp(ctx, { start, current: end, samples: [start, end] }, { width: 1, radius: 9, turns: 1, rise: 3 });
    const steps = walk(runtime);
    const bottom = node(runtime, steps.find((s) => Math.abs(s.y - 1) < 1e-9).id).position;
    assert.ok(Math.abs(bottom.x - 5) < 1e-9 && Math.abs(bottom.z - 7) < 1e-9, `the spiral starts where the drag ended: ${JSON.stringify(bottom)} ${JSON.stringify(calls.feedback)}`);
    for (const s of steps) {
      const p = node(runtime, s.id).position;
      assert.ok(Math.abs(Math.hypot(p.x - 5, p.z - 5) - 2) < 1e-6, "the drag's length is the radius, not the panel's");
    }
  } finally { session.free(); }
});

test("dragging a point moves it in plan only; the ends keep their heights and the run stays graded", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  try {
    commitPlatformSlope(ctx, [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, { x: 8, y: 0, z: 0 }, { x: 12, y: 4, z: 0 }], { width: 1.5 });
    const steps = walk(runtime);
    const inner = steps[2];
    const start = { nodeId: inner.id, point: node(runtime, inner.id).position };
    // The pointer is over the ground: a road would take its height, a ramp keeps its own.
    const target = { point: { x: start.point.x + 1, y: 0, z: start.point.z + 2 } };
    slopeCurveTool.onPointerDown(ctx, start, { width: 1.5, rise: 2 });
    slopeCurveTool.onPointerMove(ctx, { start, current: target, samples: [start, target] }, { width: 1.5, rise: 2 });
    slopeCurveTool.onPointerUp(ctx, { start, current: target, samples: [start, target] }, { width: 1.5, rise: 2 });
    const moved = node(runtime, inner.id).position;
    assert.ok(Math.abs(moved.x - target.point.x) < 1e-6 && Math.abs(moved.z - target.point.z) < 1e-6, JSON.stringify(calls.feedback));
    assert.ok(moved.y > 0.5, `the point did not drop to the ground: ${moved.y}`);
    const after = walk(runtime);
    assert.deepEqual([after[0].y, after.at(-1).y].sort(), [0, 4], "the ends keep their heights");
    assert.ok(constantGrade(runtime), JSON.stringify(after));
    assert.equal(faces(runtime, "platform-slope").length, 3);
  } finally { session.free(); }
});
