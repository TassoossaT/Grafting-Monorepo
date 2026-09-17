import assert from "node:assert/strict";
import test from "node:test";
import { controlSectionId, createPathBrushEffect, curvePickId, pathFormationFor, planBezierEdit, planEdit, planPathCloudMutation, resolveCloudTopology } from "../src/features/edit-construction/index.ts";
import { slopeRampTool, slopeSpiralTool } from "../src/composition/tabletop/tools/slope/slope-tools.ts";
import { commitPlatformSlope } from "../src/composition/tabletop/tools/slope/slope-commit.ts";
import { dispatchEffects } from "../src/composition/tabletop/effects/effect-commit.ts";
import { shapeChangeOfReplacement } from "../src/composition/tabletop/effects/shape-change.ts";
import { latticeRegenerateReaction } from "../src/composition/tabletop/terrain/terrain-lattice-reaction.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";

const params = { width: 2 };
const floor = (runtime, prefix, x0, y) => addFace(runtime, prefix, "platform",
  [[x0, 0], [x0 + 4, 0], [x0 + 4, 4], [x0, 4]].map(([x, z], i) => ({ id: `${prefix}:${i}`, position: { x, y, z } })));
const faces = (runtime, type) => runtime.getAllRegionTopologies().filter((t) => t.surfaceType === type);
const floorOf = (runtime, prefix) => faces(runtime, "platform").find((t) => t.nodes.some((n) => n.id === `${prefix}:0`));
const slopeSpans = (runtime) => runtime.getGraphSnapshot().edges.filter((e) => e.curve?.surfaceType === "platform-slope");
const node = (runtime, id) => runtime.getGraphSnapshot().nodes.find((n) => n.id === id);
const level = (topology) => {
  const byStation = new Map();
  for (const n of topology.nodes) {
    const key = n.id.replace(/:(min|max)$/, "");
    if (byStation.has(key) && Math.abs(byStation.get(key) - n.position.y) > 1e-5) return false;
    byStation.set(key, n.position.y);
  }
  return true;
};

function twoFloorsAndRamp() {
  const fixture = sessionFixture();
  floor(fixture.runtime, "low", 0, 0);
  floor(fixture.runtime, "high", 10, 3);
  commitPlatformSlope(fixture.ctx, [{ x: 4, y: 0, z: 2 }, { x: 7, y: 1.2, z: 2.6 }, { x: 10, y: 3, z: 2 }], params);
  return fixture;
}

test("a ramp is a spine of bezier spans owned by the sloped platform, one face per span, welded into both floors", () => {
  const { runtime, session, calls } = twoFloorsAndRamp();
  try {
    const spans = slopeSpans(runtime);
    assert.equal(spans.length, 2, JSON.stringify(calls.feedback));
    const ramp = faces(runtime, "platform-slope");
    assert.equal(ramp.length, 2);
    assert.ok(ramp.every((face) => face.nodes.length > 4), "each face follows its curve with sampled margins");
    assert.ok(ramp.every(level), "every cross-section is level");
    const [start, end] = [spans.find((e) => e.edgeId.endsWith(":0")).startNodeId, spans.find((e) => e.edgeId.endsWith(":1")).endNodeId];
    for (const [prefix, control] of [["low", start], ["high", end]]) {
      const f = floorOf(runtime, prefix);
      for (const side of ["min", "max"]) assert.ok(f.nodes.some((n) => n.id === controlSectionId(control, side)), `${prefix} lacks ${side}`);
    }
    const edgeIds = new Set(runtime.getGraphSnapshot().edges.map((e) => e.edgeId));
    assert.ok(!edgeIds.has("low:edge:1") && !edgeIds.has("high:edge:3"), "the split floor edges must not linger");
    assert.equal(faces(runtime, "path").length, 0);
  } finally { session.free(); }
});

test("lifting the upper floor carries the ramp's end control point and re-places the ramp on the moved curve", () => {
  const { runtime, session } = twoFloorsAndRamp();
  try {
    const end = slopeSpans(runtime).find((e) => e.edgeId.endsWith(":1")).endNodeId;
    const before = new Map(faces(runtime, "platform-slope").flatMap((t) => t.nodes).map((n) => [n.id, n.position.y]));
    const high = floorOf(runtime, "high");
    const plan = planEdit(resolveCloudTopology(runtime, high.surfaceKey), { surfaceKey: high.surfaceKey, target: { kind: "region" }, delta: { x: 0, y: 1, z: 0 } }, runtime.getGraphSnapshot(), runtime);
    assert.equal(plan.kind, "apply", plan.reason);
    runtime.applyRegionEdit(plan.ops);
    assert.ok(floorOf(runtime, "high").nodes.every((n) => n.position.y === 4));
    assert.ok(floorOf(runtime, "low").nodes.every((n) => n.position.y === 0), "the lower floor must not follow");
    assert.ok(Math.abs(node(runtime, end).position.y - 4) < 1e-5, "the end control point follows its floor");
    const ramp = faces(runtime, "platform-slope");
    assert.ok(ramp.every(level));
    const lifted = ramp.flatMap((t) => t.nodes).filter((n) => n.position.y - before.get(n.id) > 1e-4);
    assert.ok(lifted.some((n) => n.position.y - before.get(n.id) < 0.999), "interior sections rise with the curve, less than the end");
  } finally { session.free(); }
});

test("a ramp and the floors it joins stay separate clouds, and its faces are edited through the spine", () => {
  const { runtime, session } = twoFloorsAndRamp();
  try {
    const low = floorOf(runtime, "low");
    assert.equal(resolveCloudTopology(runtime, low.surfaceKey).members.length, 1);
    const ramp = faces(runtime, "platform-slope")[0];
    assert.equal(resolveCloudTopology(runtime, ramp.surfaceKey).members.length, 2);
    const grabbed = planEdit(resolveCloudTopology(runtime, ramp.surfaceKey), { surfaceKey: ramp.surfaceKey, target: { kind: "region" }, delta: { x: 0, y: 1, z: 0 } }, runtime.getGraphSnapshot(), runtime);
    assert.equal(grabbed.kind, "deny");
  } finally { session.free(); }
});

test("the ramp's spine takes the road's handle, midpoint and width edits, regenerating sloped faces", () => {
  const { runtime, session } = twoFloorsAndRamp();
  try {
    const edit = (targetId, position, operationId, extra = {}) => {
      const plan = planBezierEdit({ snapshot: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), port: runtime, field: runtime, targetId, position, operationId, tableId: "platform-test", ...extra });
      assert.ok(plan);
      runtime.applyPatchReplacement(plan.request);
      return plan;
    };
    const first = slopeSpans(runtime).find((e) => e.edgeId.endsWith(":0"));
    edit(curvePickId(first.edgeId, "midpoint"), { x: 5.5, y: 0.6, z: 1 }, "slope:pull");
    edit(curvePickId(first.edgeId, "midpoint"), { x: 0, y: 0, z: 0 }, "slope:width", { action: "width", width: 3 });
    assert.deepEqual(slopeSpans(runtime).find((e) => e.edgeId === first.edgeId).curve.bandOffsets, [-1.5, 1.5]);
    assert.equal(faces(runtime, "platform-slope").length, 2);
    assert.equal(faces(runtime, "path").length, 0, "a ramp edit never regenerates a road");
    assert.ok(faces(runtime, "platform-slope").every(level));
    assert.equal(slopeSpans(runtime).length, 2, "the spine keeps its owner through edits");
    edit(curvePickId(first.edgeId, "midpoint"), { x: 0, y: 0, z: 0 }, "slope:split", { insert: true });
    assert.equal(slopeSpans(runtime).length, 3);
    assert.equal(faces(runtime, "platform-slope").length, 3);
  } finally { session.free(); }
});

test("a spiral is one spine, one face per span, meshed on its own turn", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  try {
    slopeSpiralTool.onClick(ctx, { point: { x: 20, y: 1, z: 0 } }, { ...params, radius: 3, turns: 1.5, rise: 4 });
    const ramp = faces(runtime, "platform-slope");
    assert.equal(ramp.length, 12, JSON.stringify(calls.feedback));
    assert.equal(slopeSpans(runtime).length, 12);
    const heights = ramp.flatMap((t) => t.nodes.map((n) => n.position.y));
    assert.ok(Math.abs(Math.min(...heights) - 1) < 1e-5 && Math.abs(Math.max(...heights) - 5) < 1e-5);
    assert.ok(ramp.every(level));
    const meshes = JSON.parse(session.all_surface_meshes_json());
    for (const face of ramp) {
      const ys = face.nodes.map((n) => n.position.y);
      const mesh = meshes.find((m) => JSON.stringify(m.surfaceKey) === JSON.stringify(face.surfaceKey));
      assert.ok(mesh && mesh.indices.length > 0, "every span meshes");
      for (let i = 1; i < mesh.positions.length; i += 3) {
        assert.ok(mesh.positions[i] > Math.min(...ys) - 0.3 && mesh.positions[i] < Math.max(...ys) + 0.3, `a vertex left its turn: ${mesh.positions[i]}`);
      }
    }
  } finally { session.free(); }
});

test("ramps passing through each other each mesh on their own curve, never borrowing the other's height", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  const ramps = [
    [{ x: 0, y: 0, z: -6 }, { x: 0, y: 3, z: 6 }],
    [{ x: -6, y: 2.3, z: 0.5 }, { x: 6, y: 2.3, z: -0.5 }],
    [{ x: -6, y: 1, z: 0 }, { x: 6, y: 2, z: 0 }],
  ];
  try {
    for (const points of ramps) commitPlatformSlope(ctx, points, params);
    assert.equal(faces(runtime, "platform-slope").length, 3, JSON.stringify(calls.feedback));
    const meshes = JSON.parse(session.all_surface_meshes_json());
    for (const [a, b] of ramps) {
      const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
      const face = faces(runtime, "platform-slope").find((t) => t.nodes.some((n) => Math.hypot(n.position.x - a.x, n.position.z - a.z) < 1.01 && Math.abs(n.position.y - a.y) < 1e-6));
      const mesh = meshes.find((m) => JSON.stringify(m.surfaceKey) === JSON.stringify(face.surfaceKey));
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const [x, y, z] = [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]];
        const expected = a.y + (b.y - a.y) * (((x - a.x) * dx + (z - a.z) * dz) / length2);
        assert.ok(Math.abs(y - expected) < 1e-3, `vertex (${x}, ${y}, ${z}) left its ramp's plane; expected y ${expected}`);
      }
    }
  } finally { session.free(); }
});

test("a road drawn across a ramp's spine never welds into it", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  try {
    commitPlatformSlope(ctx, [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0.05, z: 0 }], params);
    const spine = slopeSpans(runtime);
    assert.equal(spine.length, 1, JSON.stringify(calls.feedback));
    const road = { shape: "circle", radius: 0.5, rotationDegrees: 0, pathKind: "road", bedWidth: 0.6, shoulderWidth: 0.1, shoulderHeight: 0, miterLimit: 4 };
    const effect = createPathBrushEffect({ brushShape: { kind: "circle", radius: 0.5 }, brushRegion: { samples: [{ x: 5, y: 0, z: -6 }, { x: 5, y: 0, z: 6 }] }, parameters: pathFormationFor(road) },
      { operationId: "road:cross", tableId: "platform-test", initiatedBy: "path-brush" });
    const plan = planPathCloudMutation({ bezier: runtime, field: runtime, tableId: "platform-test", snapToGrid: false, graphSnapshot: runtime.getGraphSnapshot(),
      regionTopologies: runtime.getAllRegionTopologies(), coverageFor: () => [], effect, tolerance: 0.025 });
    assert.equal(plan.kind, "ready");
    runtime.applyPatchReplacement(plan.request);
    assert.deepEqual(slopeSpans(runtime).map((e) => [e.edgeId, e.startNodeId, e.endNodeId]), spine.map((e) => [e.edgeId, e.startNodeId, e.endNodeId]));
    assert.equal(faces(runtime, "platform-slope").length, 1);
  } finally { session.free(); }
});

test("dragging draws a straight ramp that climbs the fixed rise from the start's height", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  try {
    const start = { point: { x: 0, y: 0.5, z: 0 } }, end = { point: { x: 6, y: 0, z: 1 } };
    const preview = slopeRampTool.previewFor({ start, current: end, samples: [start, end] }, { ...params, rise: 2 }, ctx);
    assert.ok(preview, "the drag previews the ramp");
    slopeRampTool.onPointerUp(ctx, { start, current: end, samples: [start, end] }, { ...params, rise: 2 });
    const spans = slopeSpans(runtime);
    assert.equal(spans.length, 1, JSON.stringify(calls.feedback));
    assert.equal(node(runtime, spans[0].startNodeId).position.y, 0.5);
    assert.equal(node(runtime, spans[0].endNodeId).position.y, 2.5);
    assert.equal(faces(runtime, "platform-slope").length, 1);
    assert.ok(JSON.parse(session.all_surface_meshes_json()).some((m) => m.surfaceType === "platform-slope" && m.indices.length > 0));
  } finally { session.free(); }
});

test("a ramp over terrain cuts it and hands the terrain to its regeneration, on creation and on a spine edit", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  const requests = [];
  const apply = runtime.applyPatchReplacement;
  runtime.applyPatchReplacement = (request) => { requests.push(request); return apply(request); };
  runtime.getSnapshot = () => ({ tableId: "platform-test", map: { nodePositions: new Map(runtime.getGraphSnapshot().nodes.map((n) => [n.id, { position: n.position }])) } });
  const repairOf = (request, replaced = []) => {
    let fallout;
    const change = shapeChangeOfReplacement(runtime, request, replaced, undefined);
    dispatchEffects(runtime, [{ kind: "cut", causeId: "cause", change }], { "lattice-regenerate": latticeRegenerateReaction((_runtime, received) => { fallout = received; return 1; }) });
    return fallout;
  };
  try {
    // The ramp is drawn first so its own commit reaches no ground; the ground
    // laid after it is what the recorded reaction below is asked about. Its
    // corners sit near the ramp because the pipeline reaches faces by their
    // nodes, as the engine's bounds query does.
    const start = { point: { x: -3, y: 0, z: 0 } }, end = { point: { x: 4, y: 0, z: 1 } };
    slopeRampTool.onPointerUp(ctx, { start, current: end, samples: [start, end] }, { ...params, rise: 2 });
    const ground = addFace(runtime, "ground", "terrain", [[-4, -3], [5, -3], [5, 3], [-4, 3]].map(([x, z], i) => ({ id: `ground:${i}`, position: { x, y: 0, z } })));
    const created = requests.at(-1);
    assert.equal(created.patch.regions[0].surfaceType, "platform-slope", JSON.stringify(calls.feedback));
    assert.ok(created.footprintOutline?.length >= 3, "creation claims its footprint");
    const cut = repairOf(created);
    assert.ok(cut, "creating a ramp dispatches the terrain repair");
    assert.equal(cut.painterSurfaceType, "platform-slope");
    assert.deepEqual(cut.consumedSurfaceKeys, [ground.surfaceKey]);

    const span = slopeSpans(runtime)[0];
    const before = faces(runtime, "platform-slope");
    const plan = planBezierEdit({ snapshot: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), port: runtime, field: runtime,
      targetId: curvePickId(span.edgeId, "midpoint"), position: { x: 0.5, y: 1, z: 3 }, operationId: "slope:bend", tableId: "platform-test" });
    assert.ok(plan.request.footprintOutline?.length >= 3, "a spine edit claims the regenerated footprint");
    assert.deepEqual(plan.request.sourceSurfaceKeys, before.map((t) => t.surfaceKey), "the edit replaces the ramp's standing faces");
    runtime.applyPatchReplacement(plan.request);
    assert.ok(repairOf(plan.request, before), "editing the ramp regenerates the terrain around it");
  } finally { session.free(); }
});

test("a ramp dragged from a floor edge to the next floor's height welds both ends", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  try {
    floor(runtime, "low", 0, 0);
    floor(runtime, "high", 10, 3);
    const start = { point: { x: 4, y: 0, z: 2 } }, end = { point: { x: 10, y: 0, z: 2 } };
    slopeRampTool.onPointerUp(ctx, { start, current: end, samples: [start, end] }, { ...params, rise: 3 });
    assert.ok(calls.feedback.at(-1).message.includes("2 ponta"), JSON.stringify(calls.feedback));
  } finally { session.free(); }
});
