import assert from "node:assert/strict";
import test from "node:test";
import { commitRoof, roofTool } from "../src/composition/tabletop/tools/roof/roof-tool.ts";
import { DEFAULT_TOOL_PARAMS, planEdit, resolveCloudTopology } from "../src/features/edit-construction/index.ts";
import { sessionFixture, addFace } from "./platform-session-fixture.mjs";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";

function fixture() {
  const value = sessionFixture();
  value.runtime.generateCap = (request) => JSON.parse(value.session.profile_cap_json(JSON.stringify(request)));
  let operations = 0;
  const apply = value.runtime.applyPatchReplacement;
  value.runtime.applyPatchReplacement = (request) => { operations++; return apply(request); };
  return { ...value, operations: () => operations };
}

test("roof drag commits four native sheets exactly once, preserving per-face profiles", () => {
  const { ctx, runtime, session, operations } = fixture();
  try {
    const start = { point: { x: 0, y: 0, z: 0 } }, current = { point: { x: 8, y: 0, z: 4 } };
    const params = { ...DEFAULT_TOOL_PARAMS.roof, elevation: 3, height: 5, curvatures: [-1, 0, 1, 0.5] };
    const gesture = { start, current, samples: [start, current] };
    roofTool.previewFor(gesture, params, ctx);
    assert.equal(operations(), 0);
    roofTool.onPointerUp(ctx, gesture, params);
    assert.equal(operations(), 1);
    const faces = runtime.getAllRegionTopologies();
    assert.equal(faces.length, 4);
    assert.deepEqual(faces.map((f) => f.profile.middle), params.curvatures);
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
    roofTool.onClick(ctx, { point: { x: 3, y: 7, z: 2 }, surfaceRef: surfaceRefFromNodeSet(platform.surfaceKey) }, { ...DEFAULT_TOOL_PARAMS.roof, shape: "platform", elevation: 0, height: 3 });
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
