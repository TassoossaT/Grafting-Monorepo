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

test("a ramp dragged from one floor to the next welds both ends, square to the floors' edges", () => {
  const fixture = sessionFixture();
  const { runtime, session, calls } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    floor(runtime, "high", 10, 2, "platform-floating");
    drawn({ point: { x: 4, y: 0, z: 2 } }, { point: { x: 10, y: 0, z: 2.8 } }, fixture);
    assert.ok(calls.feedback.at(-1).message.includes("2 ponta"), JSON.stringify(calls.feedback));
    const face = ramp(runtime);
    close(centre(face, "bottom").x, 4, "the bottom lies on the low floor's edge");
    close(centre(face, "top").x, 10, "the top lies on the high floor's edge");
    close(centre(face, "top").z, 2, "square to the edges, the stray sideways drag dropped");
    const low = faces(runtime, "platform")[0];
    const high = faces(runtime, "platform-floating")[0];
    for (const side of ["min", "max"]) {
      assert.ok(low.nodes.some((n) => n.id === corner(face, "bottom", side).id), `the low floor shares bottom ${side}`);
      assert.ok(high.nodes.some((n) => n.id === corner(face, "top", side).id), `the high floor shares top ${side}`);
    }
  } finally { session.free(); }
});

test("lifting the upper floor carries the ramp's welded end; the ramp stays a clean trapezoid", () => {
  const fixture = sessionFixture();
  const { runtime, session } = fixture;
  try {
    floor(runtime, "low", 0, 0);
    floor(runtime, "high", 10, 2, "platform-floating");
    drawn({ point: { x: 4, y: 0, z: 2 } }, { point: { x: 10, y: 0, z: 2 } }, fixture);
    const high = faces(runtime, "platform-floating")[0];
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

test("a floating platform leaves the terrain alone, where a grounded one cuts it", () => {
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
    assert.equal(floating.patch.regions[0].surfaceType, "platform-floating");
    assert.equal(reached(floating), false, "a floating platform reaches no ground");
    assert.equal(grounded.patch.regions[0].surfaceType, "platform");
    assert.equal(reached(grounded), true, "a grounded platform cuts the ground under it");
  } finally { session.free(); }
});

test("a floating and a grounded platform never extend each other or become one cloud", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  const rectangle = (x0, x1, y) => [[x0, 0], [x1, 0], [x1, 2], [x0, 2]].map(([x, z], i, all) => ({ start: { x, y, z }, end: { x: all[(i + 1) % 4][0], y, z: all[(i + 1) % 4][1] }, geometry: { kind: "line" } }));
  try {
    commitPlatformShape(ctx, rectangle(0, 2, 0), { elevation: 0, mode: "create", support: "grounded" });
    commitPlatformShape(ctx, rectangle(2, 4, 0), { elevation: 0, mode: "create", support: "floating" });
    const grounded = faces(runtime, "platform")[0];
    const cloud = resolveCloudTopology(runtime, grounded.surfaceKey);
    assert.equal(cloud.members.length, 1, "the floating platform beside it is its own cloud");
    commitPlatformShape(ctx, rectangle(1, 3, 0), { elevation: 0, mode: "extend", support: "floating" });
    assert.deepEqual(faces(runtime, "platform").map((t) => t.surfaceKey), [grounded.surfaceKey], JSON.stringify(calls.feedback));
  } finally { session.free(); }
});
