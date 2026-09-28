import assert from "node:assert/strict";
import test from "node:test";
import { planEdit, resolveCloudTopology } from "../src/features/edit-construction/index.ts";
import { slopeRampTool } from "../src/composition/tabletop/tools/slope/slope-tools.ts";
import { commitPlatformShape } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { dispatchEffects } from "../src/composition/tabletop/effects/effect-commit.ts";
import { shapeChangeOfReplacement } from "../src/composition/tabletop/effects/shape-change.ts";
import { latticeRegenerateReaction } from "../src/composition/tabletop/terrain/terrain-lattice-reaction.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";

const params = { bottomWidth: 2, topWidth: 1, rise: 2 };
const faces = (runtime, type) => runtime.getAllRegionTopologies().filter((t) => t.surfaceType === type);
const ramp = (runtime) => faces(runtime, "platform-ramp")[0];
const corner = (topology, end, side) => topology.nodes.find((n) => n.id.endsWith(`:ramp:${end}:${side}`));
const width = (topology, end) => {
  const a = corner(topology, end, "min").position, b = corner(topology, end, "max").position;
  return Math.hypot(b.x - a.x, b.z - a.z);
};
const centre = (topology, end) => {
  const a = corner(topology, end, "min").position, b = corner(topology, end, "max").position;
  return { x: (a.x + b.x) / 2, y: a.y, z: (a.z + b.z) / 2 };
};
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);
const floor = (runtime, prefix, x0, y, type = "platform") => addFace(runtime, prefix, type,
  [[x0, 0], [x0 + 4, 0], [x0 + 4, 4], [x0, 4]].map(([x, z], i) => ({ id: `${prefix}:${i}`, position: { x, y, z } })));

function drawn(start = { point: { x: 0, y: 0, z: 0 } }, end = { point: { x: 6, y: 0, z: 0 } }, fixture = sessionFixture()) {
  slopeRampTool.onPointerUp(fixture.ctx, { start, current: end, samples: [start, end] }, params);
  return fixture;
}

function edit(runtime, target, delta) {
  const topology = ramp(runtime);
  const plan = planEdit(resolveCloudTopology(runtime, topology.surfaceKey), { surfaceKey: topology.surfaceKey, target, delta }, runtime.getGraphSnapshot(), runtime);
  if (plan.kind === "apply") runtime.applyRegionEdit(plan.ops);
  return plan;
}
const edgeOf = (topology, a, b) => topology.outerLoops.flat().find((e) => [e.startNodeId, e.endNodeId].sort().join() === [a.id, b.id].sort().join()).edgeId;

test("dragging draws a straight ramp: a symmetric trapezoid climbing the rise, with its own width at each end", () => {
  const { runtime, session, calls } = drawn({ point: { x: 0, y: 0.5, z: 0 } });
  try {
    const face = ramp(runtime);
    assert.ok(face, JSON.stringify(calls.feedback));
    assert.equal(face.nodes.length, 4);
    close(width(face, "bottom"), 2, "bottom width");
    close(width(face, "top"), 1, "top width");
    close(corner(face, "bottom", "min").position.y, 0.5, "the bottom starts at the start's height");
    close(corner(face, "top", "max").position.y, 2.5, "the top climbs the rise");
    close(centre(face, "bottom").z, 0, "centred on the axis");
    close(centre(face, "top").z, 0, "centred on the axis");
    assert.ok(JSON.parse(session.all_surface_meshes_json()).some((m) => m.surfaceType === "platform-ramp" && m.indices.length > 0), "the ramp is meshed");
    assert.equal(faces(runtime, "platform-slope").length, 0, "a straight ramp is not a spine");
  } finally { session.free(); }
});

test("a corner changes only its own end's width, mirrored so the axis stays", () => {
  const { runtime, session } = drawn();
  try {
    const face = ramp(runtime);
    const plan = edit(runtime, { kind: "vertex", nodeId: corner(face, "bottom", "max").id }, { x: 3, y: 1, z: 0.5 });
    assert.equal(plan.kind, "apply", plan.reason);
    const after = ramp(runtime);
    close(width(after, "bottom"), 3, "the bottom widens by the move along its own edge, on both sides");
    close(width(after, "top"), 1, "the top is untouched");
    close(centre(after, "bottom").x, 0, "the axis stays");
    close(corner(after, "bottom", "max").position.y, 0, "a corner never lifts its end");
  } finally { session.free(); }
});

test("a side changes both widths together, keeping their difference", () => {
  const { runtime, session } = drawn();
  try {
    const face = ramp(runtime);
    const plan = edit(runtime, { kind: "edge", edgeId: edgeOf(face, corner(face, "bottom", "max"), corner(face, "top", "max")) }, { x: 2, y: 0, z: 0.5 });
    assert.equal(plan.kind, "apply", plan.reason);
    const after = ramp(runtime);
    close(width(after, "bottom"), 3, "the bottom widens");
    close(width(after, "top"), 2, "the top widens as much");
    close(centre(after, "top").x, 6, "the ramp keeps its length");
  } finally { session.free(); }
});

test("an end changes the ramp's length and rise, never its direction", () => {
  const { runtime, session } = drawn();
  try {
    const face = ramp(runtime);
    const plan = edit(runtime, { kind: "edge", edgeId: edgeOf(face, corner(face, "top", "min"), corner(face, "top", "max")) }, { x: 2, y: 1, z: 3 });
    assert.equal(plan.kind, "apply", plan.reason);
    const after = ramp(runtime);
    close(centre(after, "top").x, 8, "longer along the axis");
    close(centre(after, "top").z, 0, "the sideways part of the move is dropped");
    close(centre(after, "top").y, 3, "higher");
    close(width(after, "top"), 1, "same width");
  } finally { session.free(); }
});

test("a corner dragged past the axis is refused rather than twisting the ramp", () => {
  const { runtime, session } = drawn();
  try {
    const face = ramp(runtime);
    const before = session.snapshot_json();
    const plan = edit(runtime, { kind: "vertex", nodeId: corner(face, "bottom", "max").id }, { x: 0, y: 0, z: -5 });
    assert.equal(plan.kind, "deny");
    assert.equal(session.snapshot_json(), before);
  } finally { session.free(); }
});

test("a ramp drawn from one floor to the next, as a floor is -- the press one corner, the pointer the far one -- welds both ends, square to the floors' edges", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    floor(runtime, "high", 10, 2, "platform");
    drawn({ point: { x: 4, y: 0, z: 1 } }, { point: { x: 10, y: 0, z: 3 } }, fixture);
    assert.ok(calls.feedback.at(-1).message.includes("2 ponta"), JSON.stringify(calls.feedback));
    const face = ramp(runtime);
    close(centre(face, "bottom").x, 4, "the bottom lies on the low floor's edge");
    close(centre(face, "top").x, 10, "the top lies on the high floor's edge");
    close(centre(face, "top").z, 2, "square to the edges, between the press and the pointer");
    const width = (end) => Math.abs(corner(face, end, "max").position.z - corner(face, end, "min").position.z);
    close(width("bottom"), 2, "the width drawn");
    close(width("top"), 2, "the same at the top");
    const low = faces(runtime, "platform").find((f) => f.nodes[0].position.y < 1);
    const high = faces(runtime, "platform").find((f) => f.nodes[0].position.y > 1);
    for (const side of ["min", "max"]) {
      assert.ok(low.nodes.some((n) => n.id === corner(face, "bottom", side).id), `the low floor shares bottom ${side}`);
      assert.ok(high.nodes.some((n) => n.id === corner(face, "top", side).id), `the high floor shares top ${side}`);
    }
  } finally { session.free(); }
});

test("an end near a floor's edge, even just off it, lands at that floor's height whatever the rise says", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    floor(runtime, "high", 10, 3.5, "platform");
    // Both presses fall on the ground just outside each floor's edge.
    drawn({ point: { x: 4.4, y: 0, z: 2 } }, { point: { x: 9.5, y: 0, z: 2 } }, fixture);
    assert.ok(calls.feedback.at(-1).message.includes("2 ponta"), JSON.stringify(calls.feedback));
    const face = ramp(runtime);
    close(centre(face, "bottom").x, 4, "the bottom snaps onto the low floor's edge");
    close(centre(face, "top").x, 10, "the top snaps onto the high floor's edge");
    close(centre(face, "top").y, 3.5, "the top takes the floor's height, not start + rise");
  } finally { session.free(); }
});

test("hovering on a floor's edge before dragging previews nothing rather than a broken ramp", () => {
  const fixture = sessionFixture();
  const { runtime, session, ctx } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    const onEdge = { point: { x: 4, y: 0, z: 2 } };
    const preview = slopeRampTool.previewFor({ start: onEdge, current: onEdge, samples: [onEdge] }, params, ctx);
    assert.ok(!preview || [...preview.positions].every(Number.isFinite), "no NaN reaches the scene");
  } finally { session.free(); }
});

test("a ramp may leave a floor's edge back over the floor, welded there, climbing over it to the next floor", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    floor(runtime, "high", -6, 2, "platform");
    // Starts on the low floor by its east edge and runs west, up over it, to the high floor.
    drawn({ point: { x: 3.9, y: 0, z: 2 } }, { point: { x: -2.1, y: 0, z: 2 } }, fixture);
    const last = calls.feedback.at(-1);
    assert.equal(last.tone, "success", JSON.stringify(last));
    assert.match(last.message, /2 ponta/, "welded at both ends");
    const face = ramp(runtime);
    close(centre(face, "bottom").x, 4, "the bottom on the low floor's east edge");
    close(centre(face, "top").x, -2, "the top on the high floor's edge");
    for (const side of ["min", "max"]) {
      assert.ok(faces(runtime, "platform").find((f) => f.nodes[0].position.y < 1).nodes.some((n) => n.id === corner(face, "bottom", side).id), `the low floor shares bottom ${side}`);
    }
  } finally { session.free(); }
});

test("an end dragged near a floor's corner slides along the edge until its width fits", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    floor(runtime, "high", 10, 2, "platform");
    drawn({ point: { x: 4, y: 0, z: 0.2 } }, { point: { x: 10, y: 0, z: 0.2 } }, fixture);
    assert.ok(calls.feedback.at(-1).message.includes("1 ponta"), JSON.stringify(calls.feedback));
    const face = ramp(runtime);
    assert.ok(Math.min(corner(face, "top", "min").position.z, corner(face, "top", "max").position.z) > 0, "the top's corners stay inside the edge");
    close(width(face, "top"), 1, "the top keeps its width");
    const high = faces(runtime, "platform").find((f) => f.nodes[0].position.y > 1);
    assert.ok(high.nodes.some((n) => n.id === corner(face, "top", "min").id), "welded into the floor");
  } finally { session.free(); }
});

test("lifting the upper floor carries the ramp's welded end; the ramp stays a clean trapezoid", () => {
  const fixture = sessionFixture();
  const { runtime, session } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    floor(runtime, "high", 10, 2, "platform");
    drawn({ point: { x: 4, y: 0, z: 2 } }, { point: { x: 10, y: 0, z: 2 } }, fixture);
    const high = faces(runtime, "platform").find((f) => f.nodes[0].position.y > 1);
    const plan = planEdit(resolveCloudTopology(runtime, high.surfaceKey), { surfaceKey: high.surfaceKey, target: { kind: "region" }, delta: { x: 0, y: 1, z: 1 } }, runtime.getGraphSnapshot(), runtime);
    assert.equal(plan.kind, "apply", plan.reason);
    runtime.applyRegionEdit(plan.ops);
    const face = ramp(runtime);
    close(centre(face, "top").y, 3, "the top end rose with the floor");
    close(centre(face, "top").z, 3, "the top end moved sideways with the floor");
    close(centre(face, "bottom").z, 3, "the bottom end followed the sideways part, so the axis stays square");
    close(centre(face, "bottom").y, 0, "the bottom end stays on its own floor's height");
  } finally { session.free(); }
});

test("a platform high over the terrain leaves it alone, where one resting on it cuts it -- the ground is cut only where a structure touches it", () => {
  const { ctx, runtime, session } = sessionFixture();
  const requests = [];
  const apply = runtime.applyPatchReplacement;
  runtime.applyPatchReplacement = (request) => { requests.push(request); return apply(request); };
  runtime.getSnapshot = () => ({ tableId: "platform-test", map: { nodePositions: new Map(runtime.getGraphSnapshot().nodes.map((n) => [n.id, { position: n.position }])) } });
  // Whether the cut reached any ground face at all, by the pipeline's own record.
  const reached = (request) => dispatchEffects(runtime, [{ kind: "cut", causeId: "cause", change: shapeChangeOfReplacement(runtime, request, [], undefined) }],
    { "lattice-regenerate": latticeRegenerateReaction(() => 1) }).some((record) => record.hitCount > 0);
  const square = (x0, y) => [[x0, 0], [x0 + 2, 0], [x0 + 2, 2], [x0, 2], [x0, 0]]
    .slice(0, 4).map(([x, z], i, all) => ({ start: { x, y, z }, end: { x: all[(i + 1) % 4][0], y, z: all[(i + 1) % 4][1] }, geometry: { kind: "line" } }));
  try {
    commitPlatformShape(ctx, square(0, 3), { elevation: 3, mode: "create", support: "floating" });
    commitPlatformShape(ctx, square(4, 0), { elevation: 0, mode: "create", support: "grounded" });
    const [floating, grounded] = requests;
    addFace(runtime, "ground", "terrain", [[-1, -1], [7, -1], [7, 3], [-1, 3]].map(([x, z], i) => ({ id: `ground:${i}`, position: { x, y: 0, z } })));
    assert.equal(floating.patch.regions[0].surfaceType, "platform");
    assert.equal(reached(floating), false, "a platform 3 m up reaches no ground");
    assert.equal(grounded.patch.regions[0].surfaceType, "platform");
    assert.equal(reached(grounded), true, "a platform on the ground cuts the ground under it");
  } finally { session.free(); }
});

test("a straight ramp is also drawn by clicks: start, then end; Shift with the pointer sets the rise; Escape drops the draft", () => {
  const fixture = sessionFixture();
  const { runtime, session, ctx, calls } = fixture;
  try {
    const click = (x, z, extra = {}) => {
      const sample = { point: { x, y: 0, z }, screenX: 100, screenY: 300, ...extra };
      slopeRampTool.onPointerDown(ctx, sample, params);
      slopeRampTool.onPointerUp(ctx, { start: sample, current: sample, samples: [sample, sample], moved: false }, params);
      slopeRampTool.onClick(ctx, sample, params);
    };
    click(0, 0);
    assert.equal(ramp(runtime), undefined, "one click only starts it");
    // Shift held, the pointer 80 pixels up: two units more rise than the tool's own.
    const hover = { point: { x: 6, y: 0, z: 0 }, screenX: 100, screenY: 300, shiftKey: true };
    slopeRampTool.previewFor({ start: hover, current: hover, samples: [hover] }, params, ctx);
    const raised = { ...hover, screenY: 220 };
    assert.ok(slopeRampTool.previewFor({ start: raised, current: raised, samples: [raised] }, params, ctx), "the draft previews to the pointer");
    click(6, 0);
    assert.equal(calls.feedback.at(-1).tone, "success", JSON.stringify(calls.feedback.at(-1)));
    close(centre(ramp(runtime), "top").y, params.rise + 2, "the rise Shift set");
    click(20, 20);
    slopeRampTool.onCancel(ctx);
    click(26, 20);
    assert.equal(faces(runtime, "platform-ramp").length, 1, "Escape dropped the second draft; its end click only started another");
  } finally { session.free(); }
});

test("a ramp started on a floor's edge stays welded there wherever the pointer draws it, off the floor or over it, wide or narrow", async () => {
  const { plannedRamp } = await import("../src/composition/tabletop/tools/slope/ramp-commit.ts");
  const fixture = sessionFixture();
  const { runtime, session, ctx } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    const start = { point: { x: 4.1, y: 0, z: 2 } };
    for (const [along, across] of [[5, 0], [5, 1.5], [5, -1.5], [3, 0.2], [-3, 1], [-3, -1], [-5, 0]]) {
      const degrees = `${along},${across}`;
      const pointer = { point: { x: 4.1 + along, y: 0, z: 2 + across } };
      const plan = plannedRamp(ctx, start, pointer, params);
      assert.equal(plan.welds.length, 1, `at ${degrees} degrees the start stays welded`);
      const bottom = { x: (plan.corners.bottom.min.x + plan.corners.bottom.max.x) / 2 };
      close(bottom.x, 4, `at ${degrees} degrees on the east edge`);
    }
  } finally { session.free(); }
});

test("before a ramp is begun only a mark where it would start is shown, on the edge it would snap to; then it is built out as it is drawn", async () => {
  const { slopeRampTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { sessionFixture, addFace } = await import("./platform-session-fixture.mjs");
  const { ctx, runtime, session } = sessionFixture();
  try {
    addFace(runtime, "floor", "platform", [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, z], i) => ({ id: `floor:${i}`, position: { x, y: 0, z } })));
    const params = { bottomWidth: 2, topWidth: 1, rise: 2 };
    const away = { point: { x: 10, y: 0, z: 10 } };
    const loose = slopeRampTool.previewFor({ start: away, current: away, samples: [away] }, params, ctx);
    assert.equal(loose?.kind, "mesh", "a mark where it would start");
    assert.ok(loose.positions.length / 3 < 40, "only a small mark, no ramp");
    const edge = { point: { x: 4.2, y: 0, z: 2 } };
    const snapped = slopeRampTool.previewFor({ start: edge, current: edge, samples: [edge] }, params, ctx);
    assert.equal(snapped.color, loose.color, "the ramp's own colour");
    const xs = Array.from(snapped.positions).filter((_, i) => i % 3 === 0);
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 4) < 1e-6, "the mark stands where it would snap: on the floor's edge");
    slopeRampTool.onClick(ctx, away, params);
    const there = { point: { x: 14, y: 0, z: 10 } };
    const drawn = slopeRampTool.previewFor({ start: there, current: there, samples: [there] }, params, ctx);
    assert.ok(drawn.positions.length / 3 >= 4, "drawn out to the pointer");
    slopeRampTool.onCancel(ctx);
  } finally { session.free(); }
});

test("while drawing, [ ] narrow or widen the ramp and { } its top alone, as the tool's own widths", async () => {
  const { slopeRampTool } = await import("../src/composition/tabletop/tools/slope/slope-tools.ts");
  const { sessionFixture } = await import("./platform-session-fixture.mjs");
  const { ctx, session } = sessionFixture();
  try {
    let params = { bottomWidth: 2, topWidth: 2, rise: 2 };
    ctx.updateToolParams = (_id, update) => { params = update(params); };
    for (const key of ["]", "]", "{"]) assert.equal(slopeRampTool.onKeyDown(ctx, key, params), true, key);
    assert.deepEqual([params.bottomWidth, params.topWidth], [2.5, 2.25]);
    assert.equal(slopeRampTool.onKeyDown(ctx, "x", params), false, "any other key is not the ramp's");
  } finally { session.free(); }
});

test("on open ground a ramp is drawn as a floor is: the longer side what it climbs along, the shorter its width", async () => {
  const { plannedRamp } = await import("../src/composition/tabletop/tools/slope/ramp-commit.ts");
  const { ctx, session } = sessionFixture();
  try {
    const forward = { x: 1, y: -1, z: 0.001 };
    for (const [dx, dz, length, width] of [[6, 2, 6, 2], [-6, 2, 6, 2], [2, 5, 5, 2], [1.5, -4, 4, 1.5]]) {
      const plan = plannedRamp(ctx, { point: { x: 20, y: 0, z: 20 }, forward }, { point: { x: 20 + dx, y: 0, z: 20 + dz }, forward }, params);
      const { bottom, top } = plan.corners;
      const mid = (e) => ({ x: (e.min.x + e.max.x) / 2, z: (e.min.z + e.max.z) / 2 });
      close(Math.hypot(mid(top).x - mid(bottom).x, mid(top).z - mid(bottom).z), length, `${dx},${dz}: climbs the longer side`);
      close(Math.hypot(bottom.max.x - bottom.min.x, bottom.max.z - bottom.min.z), width, `${dx},${dz}: the shorter side is its width`);
      close(Math.hypot(top.max.x - top.min.x, top.max.z - top.min.z), width, `${dx},${dz}: at the top too`);
      assert.ok(Math.min(bottom.min.x, bottom.max.x) >= 20 - 1e-6 || dx < 0, `${dx},${dz}: from the press, one of its corners`);
    }
  } finally { session.free(); }
});
