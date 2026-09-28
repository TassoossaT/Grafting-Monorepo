import assert from "node:assert/strict";
import test from "node:test";
import { commitRoof, roofTool } from "../src/composition/tabletop/tools/roof/roof-tool.ts";
import { DEFAULT_TOOL_PARAMS, planEdit, resolveCloudTopology } from "../src/features/edit-construction/index.ts";
import { sessionFixture, addFace } from "./platform-session-fixture.mjs";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";

function fixture() {
  const value = sessionFixture();
  value.runtime.generateCap = (request) => JSON.parse(value.session.profile_cap_json(JSON.stringify(request)));
  value.runtime.generateRoof = (request) => JSON.parse(value.session.profile_roof_json(JSON.stringify(request)));
  value.runtime.roofFootprintBlocks = (contour) => JSON.parse(value.session.roof_footprint_blocks_json(JSON.stringify(contour)));
  let operations = 0;
  const apply = value.runtime.applyPatchReplacement;
  value.runtime.applyPatchReplacement = (request) => { operations++; return apply(request); };
  return { ...value, operations: () => operations };
}

test("roof drag commits a four-water roof exactly once, keeping its recipe on every face", () => {
  const { ctx, runtime, session, operations } = fixture();
  try {
    const start = { point: { x: 0, y: 0, z: 0 } }, current = { point: { x: 8, y: 0, z: 4 } };
    const params = { ...DEFAULT_TOOL_PARAMS.roof, elevation: 3, height: 5 };
    const gesture = { start, current, samples: [start, current] };
    roofTool.previewFor(gesture, params, ctx);
    assert.equal(operations(), 0);
    roofTool.onPointerUp(ctx, gesture, params);
    assert.equal(operations(), 1);
    const faces = runtime.getAllRegionTopologies();
    assert.equal(faces.length, 4);
    assert.ok(faces.every((f) => f.props.roof.blocks[0].slopes.every((slope) => slope === 1)));
    assert.equal(new Set(faces.map((f) => f.props.roof.group)).size, 1);
    assert.equal(Math.max(...faces.flatMap((f) => f.nodes.map((n) => n.position.y))), 8);
    const cloud = resolveCloudTopology(runtime, faces[0].surfaceKey);
    const plan = planEdit(cloud, { surfaceKey: faces[0].surfaceKey, target: { kind: "region" }, delta: { x: 0, y: 2, z: 0 } }, runtime.getGraphSnapshot(), runtime);
    assert.equal(plan.kind, "apply", plan.reason);
    runtime.applyRegionEdit(plan.ops);
    assert.equal(Math.min(...runtime.getGraphSnapshot().nodes.map((n) => n.position.y)), 5);
    assert.equal(Math.max(...runtime.getGraphSnapshot().nodes.map((n) => n.position.y)), 10);
  } finally { session.free(); }
});

test("circular roof uses four arc leaves and refuses invalid height without a transaction", () => {
  const { ctx, runtime, session, operations, calls } = fixture();
  try {
    const request = { base: { kind: "circle", center: [0,0], radius: 2 }, elevation: 3, height: 2, overhang: 0.2, curvatures: [0,0,0,0] };
    commitRoof(ctx, request);
    assert.equal(operations(), 1);
    const faces = runtime.getAllRegionTopologies();
    assert.equal(faces.length, 4);
    assert.ok(faces.every((face) => face.outerLoops[0][0].geometry.kind === "arc"));
    const before = session.all_surface_meshes_json();
    commitRoof(ctx, { ...request, height: -1 });
    assert.equal(operations(), 1);
    assert.equal(calls.feedback.at(-1).tone, "error");
    assert.equal(session.all_surface_meshes_json(), before);
  } finally { session.free(); }
});

test("roof on a platform takes its contour and elevation without replacing the platform", () => {
  const { ctx, runtime, session, operations } = fixture();
  try {
    const platform = addFace(runtime, "support", "platform", [[0,0],[8,0],[8,4],[0,4]].map(([x,z],index) => ({ id: `p${index}`, position: { x,y:7,z } })));
    roofTool.onClick(ctx, { point: { x: 3, y: 7, z: 2 }, surfaceRef: surfaceRefFromNodeSet(platform.surfaceKey) }, { ...DEFAULT_TOOL_PARAMS.roof, shape: "base", elevation: 0, height: 3 });
    assert.equal(operations(), 1);
    const all = runtime.getAllRegionTopologies();
    assert.equal(all.filter((f) => f.surfaceType === "platform").length, 1);
    const roofs = all.filter((f) => f.surfaceType === "roof");
    assert.equal(roofs.length, 4);
    assert.equal(Math.min(...roofs.flatMap((f) => f.nodes.map((n) => n.position.y))), 7);
    assert.equal(Math.max(...roofs.flatMap((f) => f.nodes.map((n) => n.position.y))), 10);
    const entry = ctx.history.undo();
    session.undo_region_overlay(entry.transactionId);
    assert.equal(runtime.getAllRegionTopologies().length, 1);
    session.redo_region_overlay(ctx.history.redo().transactionId);
    assert.equal(runtime.getAllRegionTopologies().length, 5);
  } finally { session.free(); }
});

test("two and one waters close their unpitched sides with vertical gables", () => {
  for (const [waters, leaves, gables] of [[2, 2, 2], [1, 1, 3]]) {
    const { ctx, runtime, session } = fixture();
    try {
      const start = { point: { x: 0, y: 0, z: 0 } }, current = { point: { x: 8, y: 0, z: 4 } };
      roofTool.onPointerUp(ctx, { start, current, samples: [start, current] }, { ...DEFAULT_TOOL_PARAMS.roof, waters, elevation: 3, height: 2 });
      const faces = runtime.getAllRegionTopologies();
      // A vertical face stands on one line in plan.
      const vertical = ({ nodes: [a, b, ...rest] }) => rest.every((c) => Math.abs((b.position.x - a.position.x) * (c.position.z - a.position.z) - (b.position.z - a.position.z) * (c.position.x - a.position.x)) < 1e-6);
      assert.equal(faces.length, leaves + gables, `${waters} waters`);
      assert.equal(faces.filter(vertical).length, gables, `${waters} waters`);
      assert.equal(Math.max(...faces.flatMap((f) => f.nodes.map((n) => n.position.y))), 5);
    } finally { session.free(); }
  }
});

/** An L room of wall panels three high, sharing their columns. */
function lRoom(runtime) {
  const plan = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
  const foot = plan.map(([x, z], i) => ({ id: `f${i}`, position: { x, y: 0, z } }));
  const top = plan.map(([x, z], i) => ({ id: `t${i}`, position: { x, y: 3, z } }));
  return plan.map((_, i) => {
    const j = (i + 1) % plan.length;
    return addFace(runtime, `wall-${i}`, "wall-white", [foot[i], foot[j], top[j], top[i]]);
  });
}

test("a roof over a wall loop takes the room's L as joined blocks at the wall tops", () => {
  const { ctx, runtime, session, operations } = fixture();
  try {
    const walls = lRoom(runtime);
    roofTool.onClick(ctx, { point: { x: 5, y: 3, z: 0 }, surfaceRef: surfaceRefFromNodeSet(walls[0].surfaceKey) }, { ...DEFAULT_TOOL_PARAMS.roof, shape: "base", height: 2 });
    assert.equal(operations(), 1, ctx.calls?.feedback?.at(-1)?.message);
    const roofs = runtime.getAllRegionTopologies().filter((f) => f.surfaceType === "roof");
    assert.equal(roofs[0].props.roof.blocks.length, 2);
    const ys = roofs.flatMap((f) => f.nodes.map((n) => n.position.y));
    assert.equal(Math.min(...ys), 3);
    assert.ok(Math.abs(Math.max(...ys) - 5) < 1e-6);
  } finally { session.free(); }
});

test("a wall run that closes no room carries no roof", () => {
  const { ctx, runtime, session, operations, calls } = fixture();
  try {
    const foot = [0, 1, 2].map((i) => ({ id: `f${i}`, position: { x: i * 4, y: 0, z: 0 } }));
    const top = [0, 1, 2].map((i) => ({ id: `t${i}`, position: { x: i * 4, y: 3, z: 0 } }));
    const wall = addFace(runtime, "wall-0", "wall-white", [foot[0], foot[1], top[1], top[0]]);
    addFace(runtime, "wall-1", "wall-white", [foot[1], foot[2], top[2], top[1]]);
    roofTool.onClick(ctx, { point: { x: 1, y: 3, z: 0 }, surfaceRef: surfaceRefFromNodeSet(wall.surfaceKey) }, { ...DEFAULT_TOOL_PARAMS.roof, shape: "base" });
    assert.equal(operations(), 0);
    assert.equal(calls.feedback.at(-1).tone, "error");
  } finally { session.free(); }
});
