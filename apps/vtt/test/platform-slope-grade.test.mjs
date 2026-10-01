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
    const high = addFace(runtime, "high", "platform", [[10, 0], [14, 0], [14, 4], [10, 4]].map(([x, z], i) => ({ id: `high:${i}`, position: { x, y: 2.5, z } })));
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

test("a spiral is laid out start, centre, end: the start click sets its start, the centre its radius, the turning its direction and turns", () => {
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
    const high = addFace(runtime, "high", "platform", [[8, 6], [12, 6], [12, 10], [8, 10]].map(([x, z], i) => ({ id: `high:${i}`, position: { x, y: 2, z } })));
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

test("the draft preview is a filled band at the ramp's width, and hovering never re-reads the table", () => {
  const { ctx, runtime, session } = sessionFixture();
  const params = { width: 2, rise: 3, mode: "arc" };
  try {
    for (let i = 0; i < 40; i += 1) addFace(runtime, `f${i}`, "platform", [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, z], k) => ({ id: `f${i}:${k}`, position: { x: x + 20 + (i % 8) * 2, y: 0, z: z + Math.floor(i / 8) * 2 } })));
    clickAll(slopeCurveTool, ctx, [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }], params);
    let reads = 0;
    const read = runtime.getAllRegionTopologies;
    runtime.getAllRegionTopologies = () => { reads += 1; return read(); };
    const started = performance.now();
    let preview;
    for (let i = 0; i < 120; i += 1) {
      const sample = { point: { x: 4 + Math.cos(i / 10), y: 0, z: 3 + Math.sin(i / 10) } };
      preview = slopeCurveTool.previewFor({ start: sample, current: sample, samples: [sample] }, params, ctx);
    }
    const perFrame = (performance.now() - started) / 120;
    assert.equal(reads, 0, "hovering reads nothing from the table");
    assert.equal(preview.kind, "mesh", "a filled band, not a line");
    const xs = [], zs = [];
    for (let i = 0; i < preview.positions.length; i += 3) { xs.push(preview.positions[i]); zs.push(preview.positions[i + 2]); }
    assert.ok(Math.min(...zs) < -0.9, "the band has the ramp's width either side of its axis");
    assert.ok(perFrame < 5, `a preview frame costs ${perFrame.toFixed(2)} ms`);
  } finally { session.free(); }
});

test("the scene manipulator raises a ramp's end even though its points otherwise move in plan only", async () => {
  const { beginCurveGesture } = await import("../src/composition/tabletop/tools/core/curve-edit-gesture.ts");
  const { ctx, runtime, session, calls } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  try {
    commitPlatformSlope(ctx, [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 3 }, { x: 8, y: 2, z: 0 }], { width: 1.5 });
    const end = walk(runtime).at(-1);
    const from = node(runtime, end.id).position, to = { ...from, y: 5 };
    const gesture = beginCurveGesture(ctx, { nodeId: end.id, point: from }, { mode: "shape", insertOnClick: false, spatialTarget: true });
    gesture.move({ start: { nodeId: end.id, point: to }, current: { nodeId: end.id, point: to }, samples: [] });
    gesture.commit();
    assert.equal(node(runtime, end.id).position.y, 5, JSON.stringify(calls.feedback));
    assert.ok(constantGrade(runtime));
  } finally { session.free(); }
});

test("every spine has a pivot: a spiral's at its centre, a free ramp's at the middle of its points", async () => {
  const { spineGlobalHandles } = await import("../src/features/edit-construction/index.ts");
  const spinePivots = (graph) => spineGlobalHandles(graph).filter((h) => h.kind === "pivot");
  const { ctx, runtime, session } = sessionFixture();
  try {
    drawSpiral(slopeSpiralTool, ctx, { center: { x: 10, y: 0, z: -4 }, radius: 3, turns: 1.5, startY: 1, params: { width: 1.5, rise: 3 } });
    commitPlatformSlope(ctx, [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, { x: 8, y: 2, z: 0 }], { width: 1.5 });
    const pivots = spinePivots(runtime.getGraphSnapshot());
    assert.equal(pivots.length, 2);
    const spiral = pivots.find((p) => Math.abs(p.position.x - 10) < 1e-6);
    assert.ok(spiral && Math.abs(spiral.position.z + 4) < 1e-6, "the spiral's pivot is its centre");
    const ramp = pivots.find((p) => p !== spiral);
    assert.ok(Math.abs(ramp.position.x - 4) < 1e-6, `the ramp's pivot is the middle of its points: ${JSON.stringify(ramp.position)}`);
  } finally { session.free(); }
});

test("dragging a spiral's pivot moves the whole spiral in plan, arc centres and all, keeping its heights", async () => {
  const { spineGlobalHandles } = await import("../src/features/edit-construction/index.ts");
  const spinePivots = (graph) => spineGlobalHandles(graph).filter((h) => h.kind === "pivot");
  const { ctx, runtime, session, calls } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  const params = { width: 1.5, rise: 3 };
  try {
    drawSpiral(slopeSpiralTool, ctx, { center: { x: 0, y: 0, z: 0 }, radius: 3, turns: 1, startY: 1, params });
    const before = new Map(runtime.getGraphSnapshot().nodes.map((n) => [n.id, n.position]));
    const [pivot] = spinePivots(runtime.getGraphSnapshot());
    const start = { nodeId: pivot.id, point: pivot.position };
    const target = { point: { x: 5, y: 0, z: 2 } };
    slopeSpiralTool.onPointerDown(ctx, start, params);
    slopeSpiralTool.onPointerMove(ctx, { start, current: target, samples: [start, target] }, params);
    slopeSpiralTool.onPointerUp(ctx, { start, current: target, samples: [start, target] }, params);
    const spans = slopeSpans(runtime);
    assert.ok(spans.every((e) => Math.hypot(e.curve.geometry.center[0] - 5, e.curve.geometry.center[1] - 2) < 1e-6), JSON.stringify(calls.feedback));
    for (const id of new Set(spans.flatMap((e) => [e.startNodeId, e.endNodeId]))) {
      const was = before.get(id), now = node(runtime, id).position;
      assert.ok(Math.abs(now.x - was.x - 5) < 1e-6 && Math.abs(now.z - was.z - 2) < 1e-6 && Math.abs(now.y - was.y) < 1e-9, `moved by the drag, same height: ${id}`);
    }
    assert.equal(faces(runtime, "platform-slope").length, spans.length);
  } finally { session.free(); }
});

test("the scene manipulator on a pivot lifts the whole spiral", async () => {
  const { spineGlobalHandles } = await import("../src/features/edit-construction/index.ts");
  const spinePivots = (graph) => spineGlobalHandles(graph).filter((h) => h.kind === "pivot");
  const { beginCurveGesture } = await import("../src/composition/tabletop/tools/core/curve-edit-gesture.ts");
  const { ctx, runtime, session, calls } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  const params = { width: 1.5, rise: 3 };
  try {
    drawSpiral(slopeSpiralTool, ctx, { center: { x: 0, y: 0, z: 0 }, radius: 3, turns: 1, startY: 1, params });
    const [pivot] = spinePivots(runtime.getGraphSnapshot());
    const lifted = { ...pivot.position, y: pivot.position.y + 2 };
    const gesture = beginCurveGesture(ctx, { nodeId: pivot.id, point: pivot.position }, { mode: "shape", insertOnClick: false, spatialTarget: true });
    gesture.move({ start: { nodeId: pivot.id, point: lifted }, current: { nodeId: pivot.id, point: lifted }, samples: [] });
    gesture.commit();
    const heights = walk(runtime).map((s) => s.y);
    assert.deepEqual([Math.min(...heights), Math.max(...heights)], [3, 6], JSON.stringify(calls.feedback));
  } finally { session.free(); }
});

test("a spiral's end handles: height above its end, turns just past it; a free ramp only has height", async () => {
  const { spineGlobalHandles } = await import("../src/features/edit-construction/index.ts");
  const spineEndHandles = (graph) => spineGlobalHandles(graph).filter((h) => h.kind !== "pivot");
  const { ctx, runtime, session } = sessionFixture();
  try {
    drawSpiral(slopeSpiralTool, ctx, { center: { x: 0, y: 0, z: 0 }, radius: 3, turns: 1, startY: 0, params: { width: 1.5, rise: 4 } });
    commitPlatformSlope(ctx, [{ x: 20, y: 0, z: 0 }, { x: 24, y: 0, z: 2 }, { x: 28, y: 2, z: 0 }], { width: 1.5 });
    const handles = spineEndHandles(runtime.getGraphSnapshot());
    const spiral = handles.filter((h) => h.kind === "turns");
    assert.deepEqual(handles.filter((h) => h.kind === "height").length, 2);
    assert.equal(spiral.length, 1, "only the spiral winds");
    const end = node(runtime, spiral[0].ends[1]).position;
    assert.ok(Math.abs(Math.hypot(spiral[0].position.x - end.x, spiral[0].position.z - end.z) - 1.2) < 1e-6, "just past the end");
  } finally { session.free(); }
});

test("dragging the height handle up raises the far end; the ramp stays graded", async () => {
  const { spineGlobalHandles } = await import("../src/features/edit-construction/index.ts");
  const spineEndHandles = (graph) => spineGlobalHandles(graph).filter((h) => h.kind !== "pivot");
  const { ctx, runtime, session, calls } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  const params = { width: 1.5, rise: 2 };
  try {
    commitPlatformSlope(ctx, [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 3 }, { x: 8, y: 2, z: 0 }], { width: 1.5 });
    const handle = spineEndHandles(runtime.getGraphSnapshot()).find((h) => h.kind === "height");
    const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
    const current = { point: handle.position, screenX: 100, screenY: 180 };
    slopeCurveTool.onPointerDown(ctx, start, params);
    slopeCurveTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
    slopeCurveTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
    const heights = walk(runtime).map((s) => s.y);
    assert.ok(Math.abs(Math.max(...heights) - 5) < 1e-9, `120 px up is 3 m: ${JSON.stringify(heights)} ${JSON.stringify(calls.feedback.slice(-2))}`);
    assert.ok(constantGrade(runtime));
  } finally { session.free(); }
});

test("winding the turns handle a quarter round adds a quarter turn at the same grade", async () => {
  const { spineGlobalHandles } = await import("../src/features/edit-construction/index.ts");
  const spineEndHandles = (graph) => spineGlobalHandles(graph).filter((h) => h.kind !== "pivot");
  const { beginCurveGesture } = await import("../src/composition/tabletop/tools/core/curve-edit-gesture.ts");
  const { ctx, runtime, session, calls } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  try {
    drawSpiral(slopeSpiralTool, ctx, { center: { x: 0, y: 0, z: 0 }, radius: 3, turns: 1, startY: 0, params: { width: 1.5, rise: 4 } });
    const handle = spineEndHandles(runtime.getGraphSnapshot()).find((h) => h.kind === "turns");
    const gesture = beginCurveGesture(ctx, { nodeId: handle.id, point: handle.position }, { mode: "shape", insertOnClick: false, spatialTarget: true });
    // The manipulator carried round the centre, a little at a time, in the spiral's own direction.
    const start = Math.atan2(handle.position.z, handle.position.x);
    for (let i = 1; i <= 9; i += 1) {
      const angle = start + (Math.PI / 2) * (i / 9);
      const point = { x: 4 * Math.cos(angle), y: handle.position.y, z: 4 * Math.sin(angle) };
      gesture.move({ start: { nodeId: handle.id, point }, current: { nodeId: handle.id, point }, samples: [] });
    }
    gesture.commit();
    const [pivotSpan] = slopeSpans(runtime);
    const { describeSpineChain } = await import("../src/features/edit-construction/index.ts");
    const summary = describeSpineChain(runtime.getGraphSnapshot(), pivotSpan.startNodeId);
    assert.ok(Math.abs(summary.spiral.turns - 1.25) < 1e-6, `${JSON.stringify(summary)} ${JSON.stringify(calls.feedback.slice(-2))}`);
    assert.ok(Math.abs(summary.endHeight - 5) < 1e-6, "same grade: a quarter turn more climbs a quarter more");
    assert.equal(slopeSpans(runtime).length, 5);
  } finally { session.free(); }
});

test("an angle tracker counts whole circles, either way round", async () => {
  const { createAngleTracker } = await import("../src/features/edit-construction/index.ts");
  const tracker = createAngleTracker({ x: 0, z: 0 }, { x: 1, z: 0 });
  for (let i = 1; i <= 16; i += 1) tracker.turn({ x: Math.cos((i / 8) * Math.PI), z: Math.sin((i / 8) * Math.PI) });
  assert.ok(Math.abs(tracker.turned - 2 * Math.PI) < 1e-9, "one full turn");
  for (let i = 15; i >= -8; i -= 1) tracker.turn({ x: Math.cos((i / 8) * Math.PI), z: Math.sin((i / 8) * Math.PI) });
  assert.ok(Math.abs(tracker.turned + Math.PI) < 1e-9, "and back past the start");
});

/** Turns a spine's rotate handle `angle` round its pivot, as the scene manipulator would carry it, a little at a time. */
async function rotate(ctx, runtime, angle, shiftKey = false) {
  const { spineGlobalHandles } = await import("../src/features/edit-construction/index.ts");
  const { beginCurveGesture } = await import("../src/composition/tabletop/tools/core/curve-edit-gesture.ts");
  const handle = spineGlobalHandles(runtime.getGraphSnapshot()).find((h) => h.kind === "rotate");
  const gesture = beginCurveGesture(ctx, { nodeId: handle.id, point: handle.position }, { mode: "shape", insertOnClick: false, spatialTarget: true });
  const reach = Math.hypot(handle.position.x - handle.pivot.x, handle.position.z - handle.pivot.z);
  const from = Math.atan2(handle.position.z - handle.pivot.z, handle.position.x - handle.pivot.x);
  for (let i = 1; i <= 12; i += 1) {
    const a = from + (angle * i) / 12;
    const point = { x: handle.pivot.x + reach * Math.cos(a), y: handle.position.y, z: handle.pivot.z + reach * Math.sin(a) };
    gesture.move({ start: { nodeId: handle.id, point }, current: { nodeId: handle.id, point, shiftKey }, samples: [] });
  }
  gesture.commit();
  return handle.pivot;
}

test("the rotate handle turns a whole spiral round its centre: still the same exact helix", async () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  try {
    drawSpiral(slopeSpiralTool, ctx, { center: { x: 2, y: 0, z: 1 }, radius: 3, turns: 1, startY: 0, params: { width: 1.5, rise: 4 } });
    const before = new Map(runtime.getGraphSnapshot().nodes.map((n) => [n.id, n.position]));
    await rotate(ctx, runtime, Math.PI / 2);
    const spans = slopeSpans(runtime);
    assert.ok(spans.every((e) => Math.hypot(e.curve.geometry.center[0] - 2, e.curve.geometry.center[1] - 1) < 1e-9), JSON.stringify(calls.feedback.slice(-2)));
    for (const id of new Set(spans.flatMap((e) => [e.startNodeId, e.endNodeId]))) {
      const was = before.get(id), now = node(runtime, id).position;
      const turned = { x: 2 - (was.z - 1), z: 1 + (was.x - 2) };
      assert.ok(Math.hypot(now.x - turned.x, now.z - turned.z) < 1e-6 && Math.abs(now.y - was.y) < 1e-9, `${id} turned a quarter round the centre`);
    }
    assert.ok(constantGrade(runtime));
  } finally { session.free(); }
});

test("the rotate handle turns a free ramp round its middle, handles and all; the protractor's step lands the turn", async () => {
  const { ctx, runtime, session } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  try {
    commitPlatformSlope(ctx, [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 3 }, { x: 8, y: 2, z: 0 }], { width: 1.5 });
    const midpoint = () => {
      const [span] = slopeSpans(runtime);
      const a = node(runtime, span.startNodeId).position, b = node(runtime, span.endNodeId).position;
      return runtime.curveBatch({ tolerance: 0.01, commands: [{ kind: "split", curve: runtime.curveBatch({ tolerance: 0.01, commands: [{ kind: "resolve", handles: span.curve, start: [a.x, a.y, a.z], end: [b.x, b.y, b.z] }] })[0].curves[0], t: 0.5 }] })[0].curves[0].points[3];
    };
    const was = midpoint();
    // The table offers steps of 15 degrees (Shift would ask for the finer 5): a turn a hair off 45 lands on it.
    ctx.rulerSnap = true;
    ctx.rulerAngleStep = (15 * Math.PI) / 180;
    const pivot = await rotate(ctx, runtime, (46.4 * Math.PI) / 180);
    const now = midpoint();
    const raw = Math.atan2(now[2] - pivot.z, now[0] - pivot.x) - Math.atan2(was[2] - pivot.z, was[0] - pivot.x);
    const angle = Math.atan2(Math.sin(raw), Math.cos(raw));
    assert.ok(Math.abs(angle - Math.PI / 4) < 1e-6, `the span's own shape turned with it, snapped to 45 degrees: ${(angle * 180) / Math.PI}`);
  } finally { session.free(); }
});

test("a spiral begun on a floor's edge leaves it square, curving to the side the pointer is on, and is welded there", async () => {
  const { addFace } = await import("./platform-session-fixture.mjs");
  const { controlSectionId, isSpineControlNodeId } = await import("../src/features/edit-construction/index.ts");
  for (const side of [1, -1]) {
    const { ctx, runtime, session, calls } = sessionFixture();
    Object.assign(runtime, { showPreview() {}, clearPreview() {} });
    try {
      addFace(runtime, "floor", "platform", [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, z], i) => ({ id: `floor:${i}`, position: { x, y: 0, z } })));
      const params = { width: 1, rise: 3 };
      const hover = (p) => { const s = { point: p }; slopeSpiralTool.previewFor({ start: s, current: s, samples: [s] }, params, ctx); return s; };
      // Pressed just off the east edge: the start lands on it.
      slopeSpiralTool.onClick(ctx, hover({ x: 4.1, y: 0, z: 2 }), params);
      // Taken out and aside: the circle touches the edge's square line at the start, on the pointer's side, 2 wide.
      slopeSpiralTool.onClick(ctx, hover({ x: 4.5, y: 0, z: 2 + 2 * side }), params);
      const center = { x: 4, z: 2 + 2 * side };
      // Turned half round, the way it leaves.
      const from = Math.atan2(2 - center.z, 4 - center.x);
      const way = side > 0 ? 1 : -1;
      for (let i = 1; i <= 8; i += 1) hover({ x: center.x + 2 * Math.cos(from + way * Math.PI * i / 8), y: 0, z: center.z + 2 * Math.sin(from + way * Math.PI * i / 8) });
      slopeSpiralTool.onClick(ctx, { point: { x: center.x + 2 * Math.cos(from + way * Math.PI), y: 0, z: center.z + 2 * Math.sin(from + way * Math.PI) } }, params);
      const spans = slopeSpans(runtime);
      assert.ok(spans.length > 0, JSON.stringify(calls.feedback));
      const controls = runtime.getGraphSnapshot().nodes.filter((n) => isSpineControlNodeId(n.id));
      const start = controls.find((n) => Math.abs(n.position.x - 4) < 1e-6 && Math.abs(n.position.z - 2) < 1e-6);
      assert.ok(start, "the spiral starts on the edge, where it was pressed");
      for (const p of controls) assert.ok(Math.abs(Math.hypot(p.position.x - center.x, p.position.z - center.z) - 2) < 1e-6, "every point on the circle the pointer picked");
      // Square off the edge: its first span leaves along +x.
      const first = spans.find((e) => e.startNodeId === start.id || e.endNodeId === start.id);
      const handle = first.startNodeId === start.id ? first.curve.start : first.curve.end;
      assert.ok(handle[0] > 0 && Math.abs(handle[2]) < 1e-6 * Math.abs(handle[0]) + 1e-9, `leaves square to the edge: ${JSON.stringify(handle)}`);
      const floor = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform");
      assert.ok(["min", "max"].every((s) => floor.nodes.some((n) => n.id === controlSectionId(start.id, s))), "welded into the floor");
    } finally { session.free(); }
  }
});

test("a spiral begun on a straight ramp's free end runs straight on from it before it curves", async () => {
  const { slopeRampTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { isSpineControlNodeId } = await import("../src/features/edit-construction/index.ts");
  const { ctx, runtime, session, calls } = sessionFixture();
  Object.assign(runtime, { showPreview() {}, clearPreview() {} });
  try {
    const s = { point: { x: 0, y: 0, z: 0 } }, e = { point: { x: 4, y: 0, z: 0 } };
    slopeRampTool.onPointerUp(ctx, { start: s, current: e, samples: [s, e] }, { bottomWidth: 1, topWidth: 1, rise: 2 });
    const params = { width: 1, rise: 3 };
    const hover = (p) => { const sample = { point: p }; slopeSpiralTool.previewFor({ start: sample, current: sample, samples: [sample] }, params, ctx); return sample; };
    slopeSpiralTool.onClick(ctx, hover({ x: 4, y: 2, z: 0 }), params);
    // Aside, and a little behind: the way on is still the ramp's.
    slopeSpiralTool.onClick(ctx, hover({ x: 3.5, y: 2, z: 2 }), params);
    for (let i = 1; i <= 8; i += 1) hover({ x: 4 + 2 * Math.cos(-Math.PI / 2 + Math.PI * i / 8), y: 2, z: 2 + 2 * Math.sin(-Math.PI / 2 + Math.PI * i / 8) });
    slopeSpiralTool.onClick(ctx, { point: { x: 4, y: 2, z: 4 } }, params);
    const spans = slopeSpans(runtime);
    assert.ok(spans.length > 0, JSON.stringify(calls.feedback));
    const start = runtime.getGraphSnapshot().nodes.find((n) => isSpineControlNodeId(n.id) && Math.hypot(n.position.x - 4, n.position.z) < 1e-6);
    assert.ok(start, "it starts at the ramp's end");
    const first = spans.find((edge) => edge.startNodeId === start.id || edge.endNodeId === start.id);
    const handle = first.startNodeId === start.id ? first.curve.start : first.curve.end;
    assert.ok(handle[0] > 0 && Math.abs(handle[2]) < 1e-6, `straight on from the ramp: ${JSON.stringify(handle)}`);
  } finally { session.free(); }
});
