import assert from "node:assert/strict";
import test from "node:test";
import { slopeCurveTool, slopeSpiralTool } from "../src/composition/tabletop/tools/slope/slope-tools.ts";
import { commitPlatformSlope } from "../src/composition/tabletop/tools/slope/slope-commit.ts";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";
import { clickAll, drawSpiral } from "./curve-draft-fixture.mjs";
import { curvePickId } from "../src/features/edit-construction/index.ts";

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
    drawSpiral(slopeSpiralTool, ctx, { center: { x: 0, y: 0, z: 0 }, radius: 3, turns: 2, params: { width: 1.5, rise: 6 } });
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

test("a spiral is laid out centre, start, end: the start click sets radius and start, the turning sets direction and turns", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  try {
    // Turned the negative way, three quarters round.
    drawSpiral(slopeSpiralTool, ctx, { center: { x: 5, y: 0, z: 5 }, radius: 2, startAngle: Math.PI / 2, turns: -0.75, startY: 1, params: { width: 1, rise: 3 } });
    const steps = walk(runtime);
    assert.equal(steps.length, 4, `three quarter-turn spans: ${JSON.stringify(calls.feedback)}`);
    const first = node(runtime, steps.find((s) => Math.abs(s.y - 1) < 1e-9).id).position;
    assert.ok(Math.abs(first.x - 5) < 1e-9 && Math.abs(first.z - 7) < 1e-9, `the spiral starts at the start click: ${JSON.stringify(first)}`);
    const last = node(runtime, steps.find((s) => Math.abs(s.y - 4) < 1e-9).id).position;
    // From 90 degrees, three quarters the negative way ends at 180 degrees.
    assert.ok(Math.abs(last.x - 3) < 1e-6 && Math.abs(last.z - 5) < 1e-6, `turned the negative way to the end: ${JSON.stringify(last)}`);
    for (const s of steps) {
      const p = node(runtime, s.id).position;
      assert.ok(Math.abs(Math.hypot(p.x - 5, p.z - 5) - 2) < 1e-6, "the start click's distance is the radius");
    }
    assert.ok(slopeSpans(runtime).every((e) => e.curve.geometry?.kind === "arc"), "every span keeps its arc");
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

test("straight mode: start and end make one straight span, and it stays straight when an end is dragged", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  const params = { width: 1.5, rise: 2, mode: "straight" };
  try {
    clickAll(slopeCurveTool, ctx, [{ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }], params);
    const [span] = slopeSpans(runtime);
    assert.equal(span?.curve.geometry?.kind, "line", JSON.stringify(calls.feedback));
    const end = { nodeId: span.endNodeId, point: node(runtime, span.endNodeId).position };
    const target = { point: { x: 6, y: 0, z: 4 } };
    slopeCurveTool.onPointerDown(ctx, end, params);
    slopeCurveTool.onPointerMove(ctx, { start: end, current: target, samples: [end, target] }, params);
    slopeCurveTool.onPointerUp(ctx, { start: end, current: target, samples: [end, target] }, params);
    const [after] = slopeSpans(runtime);
    const a = node(runtime, after.startNodeId).position, b = node(runtime, after.endNodeId).position;
    const curve = runtime.curveBatch({ tolerance: 0.01, commands: [{ kind: "resolve", handles: after.curve, start: [a.x, a.y, a.z], end: [b.x, b.y, b.z] }] })[0].curves[0];
    const mid = curve.points[1];
    // Straight in plan: the first handle sits on the chord at a third.
    assert.ok(Math.abs(mid[0] - b.x / 3) < 1e-6 && Math.abs(mid[2] - b.z / 3) < 1e-6, JSON.stringify(curve));
  } finally { session.free(); }
});

test("arc mode: start, end, then the bulge gives quarter-turn arc spans through the pulled point", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  const params = { width: 1.5, rise: 2, mode: "arc" };
  try {
    clickAll(slopeCurveTool, ctx, [{ x: 4, y: 0, z: 0 }, { x: -4, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }], params);
    const spans = slopeSpans(runtime);
    assert.equal(spans.length, 2, `a half turn in two quarters: ${JSON.stringify(calls.feedback)}`);
    assert.ok(spans.every((e) => e.curve.geometry?.kind === "arc" && Math.hypot(...e.curve.geometry.center) < 1e-9));
    const heights = walk(runtime).map((s) => s.y).sort();
    assert.deepEqual([heights[0], heights.at(-1)], [0, 2], "the second click is the end: it takes the rise");
    assert.ok(constantGrade(runtime));
  } finally { session.free(); }
});

test("connect mode: a ramp between two floor edges leaves each square to its edge and welds into both", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  const params = { width: 1.5, rise: 9, mode: "connect" };
  try {
    const low = addFace(runtime, "low", "platform", [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, z], i) => ({ id: `low:${i}`, position: { x, y: 0, z } })));
    const high = addFace(runtime, "high", "platform-floating", [[8, 6], [12, 6], [12, 10], [8, 10]].map(([x, z], i) => ({ id: `high:${i}`, position: { x, y: 2, z } })));
    clickAll(slopeCurveTool, ctx, [
      { point: { x: 4.2, y: 0, z: 2 }, surfaceRef: surfaceRefFromNodeSet(low.surfaceKey) },
      { point: { x: 10, y: 2, z: 5.9 }, surfaceRef: surfaceRefFromNodeSet(high.surfaceKey) },
    ], params);
    const [span] = slopeSpans(runtime);
    assert.ok(span, JSON.stringify(calls.feedback));
    assert.match(calls.feedback.at(-1).message, /2 ponta/, JSON.stringify(calls.feedback));
    const heights = walk(runtime).map((s) => s.y).sort();
    assert.deepEqual([heights[0], heights.at(-1)], [0, 2], "ends at each floor's height");
    assert.ok(Math.abs(span.curve.start[2]) < 1e-6 && span.curve.start[0] > 0, `leaves the low floor square to its +X edge: ${JSON.stringify(span.curve.start)}`);
  } finally { session.free(); }
});

test("R cycles the creation mode of a multi-mode tool", () => {
  const { ctx, session } = sessionFixture();
  let params = { width: 1.5, rise: 2, mode: "points" };
  ctx.updateToolParams = (_id, update) => { params = update(params); };
  try {
    assert.equal(slopeCurveTool.onKeyDown(ctx, "r", params), true);
    assert.equal(params.mode, "straight");
    slopeCurveTool.onKeyDown(ctx, "R", params);
    assert.equal(params.mode, "arc");
  } finally { session.free(); }
});

test("pulling a straight span's midpoint bends it into an arc through the pointer", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  const params = { width: 1.5, rise: 0.5, mode: "straight" };
  try {
    clickAll(slopeCurveTool, ctx, [{ x: -3, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }], params);
    const [span] = slopeSpans(runtime);
    const pick = { nodeId: curvePickId(span.edgeId, "midpoint"), point: { x: 0, y: 0.25, z: 0 } };
    const target = { point: { x: 0, y: 0, z: 3 } };
    slopeCurveTool.onPointerDown(ctx, pick, params);
    slopeCurveTool.onPointerMove(ctx, { start: pick, current: target, samples: [pick, target] }, params);
    slopeCurveTool.onPointerUp(ctx, { start: pick, current: target, samples: [pick, target] }, params);
    const spans = slopeSpans(runtime);
    assert.ok(spans.length >= 2 && spans.every((e) => e.curve.geometry?.kind === "arc"), JSON.stringify(calls.feedback));
    const [center] = spans.map((e) => e.curve.geometry.center);
    assert.ok(Math.hypot(center[0], center[1]) < 1e-6, `the arc through (-3,0), (0,3), (3,0) is centred at the origin: ${center}`);
  } finally { session.free(); }
});
