import assert from "node:assert/strict";
import test from "node:test";
import { planEdit, resolveCloudTopology } from "../src/features/edit-construction/index.ts";
import { editRegionTool } from "../src/composition/tabletop/tools/core/edit-region-tool.ts";
import { commitPlatformContour } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { commitWallContour } from "../src/composition/tabletop/tools/walls/wall-shared.ts";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";
import { building, sessionFixture } from "./platform-session-fixture.mjs";
import { addFace } from "./platform-session-fixture.mjs";

const platform = (runtime, i) => runtime.getAllRegionTopologies().find((t) => t.surfaceType === "platform" && t.nodes.some((n) => n.id === `p${i}:0`));
function plan(runtime, i, delta, target = { kind: "region" }) {
  const topology = platform(runtime, i);
  return planEdit(resolveCloudTopology(runtime, topology.surfaceKey), { surfaceKey: topology.surfaceKey, target, delta }, runtime.getGraphSnapshot(), runtime);
}
const heights = (runtime) => [0,1,2].map((i) => platform(runtime,i).nodes[0].position.y);
for (const [level, expected] of [[0,[1,4,7]], [1,[0,4,7]], [2,[0,3,7]]]) {
  test(`real WASM: move level ${level}, with different upper footprints`, () => {
    const { runtime, session, calls } = building();
    try {
      const before = runtime.getGraphSnapshot().nodes.filter((n) => n.id.startsWith("u:"));
      const result = plan(runtime, level, { x: 0, y: 1, z: 0 });
      assert.equal(result.kind, "apply", result.reason);
      assert.equal(new Set(result.ops.map((op) => op.nodeId)).size, result.ops.length);
      assert.equal(result.ops.length, (3-level)*4);
      runtime.applyRegionEdit(result.ops);
      assert.deepEqual(heights(runtime), expected);
      assert.deepEqual(runtime.getGraphSnapshot().nodes.filter((n) => n.id.startsWith("u:")), before);
      assert.deepEqual([calls.plans,calls.batches], [1,1]);
    } finally { session.free(); }
  });
}
test("received vertex elevation expands its whole platform; descending cannot cross a wall base", () => {
  const { runtime, session } = building();
  try {
    const valid = plan(runtime, 1, { x: 0, y: -1, z: 0 }, { kind: "vertex", nodeId: "p1:0" });
    assert.equal(valid.kind, "apply", valid.reason);
    runtime.applyRegionEdit(valid.ops);
    assert.deepEqual(heights(runtime), [0,2,5]);
    const before = session.snapshot_json();
    assert.equal(plan(runtime, 1, { x: 0, y: -2, z: 0 }).kind, "deny");
    assert.equal(session.snapshot_json(), before);
  } finally { session.free(); }
});
test("whole-platform horizontal translation carries upper clouds; local shape edit stays local", () => {
  const { runtime, session } = building();
  try {
    const full = plan(runtime, 0, { x: 2, y: 0, z: 0 });
    assert.equal(full.kind, "apply", full.reason);
    assert.equal(full.ops.length, 12);
    const local = plan(runtime, 0, { x: 1, y: 0, z: 0 }, { kind: "vertex", nodeId: "p0:0" });
    assert.equal(local.kind, "apply", local.reason);
    assert.deepEqual(local.ops.map((op) => op.nodeId), ["p0:0","p1:0","p2:0"]);
    assert.equal(plan(runtime, 1, { x: 1, y: 0, z: 0 }).kind, "deny", "a connected upright wall cannot be sheared by its top");
  } finally { session.free(); }
});
test("invalid absolute batches are atomic; equal cycles converge and conflicting requests reject", () => {
  const { runtime, session } = building();
  try {
    const before = session.snapshot_json();
    assert.throws(() => runtime.applyRegionEdit([{ nodeId: "p0:0", position: {x:9,y:9,z:9} }, { nodeId: "absent", position: {x:1,y:1,z:1} }]));
    assert.equal(session.snapshot_json(), before);
    const influences = [{from:"p0:0",to:"p2:3",axes:[true,true,true]},{from:"p2:3",to:"p0:0",axes:[true,true,true]}];
    const solved = runtime.planMotion({ seeds:[{nodeId:"p0:0",delta:{x:0,y:1,z:0}}], influences });
    assert.equal(solved.moves.length,2);
    assert.equal(solved.resolvedAxes,2);
    assert.equal(solved.visitedInfluences,2);
    assert.throws(() => runtime.planMotion({ seeds:[{nodeId:"p0:0",delta:{x:0,y:1,z:0}},{nodeId:"p2:3",delta:{x:0,y:2,z:0}}], influences }));
    assert.equal(session.snapshot_json(), before);
  } finally { session.free(); }
});
test("one drag history covers every storey, including after a rejected tick", () => {
  const { ctx, runtime, session } = building();
  try {
    const surfaceRef = surfaceRefFromNodeSet(platform(runtime,1).surfaceKey);
    const start = { point: {x:2,y:3,z:2}, surfaceRef, screenY:200 };
    editRegionTool.onPointerDown(ctx,start);
    const current = {...start, screenY:160};
    editRegionTool.onPointerMove(ctx,{start,current,samples:[start,current]},{mode:"elevation"});
    const bad = {...start, screenY:400};
    editRegionTool.onPointerMove(ctx,{start,current:bad,samples:[start,bad]},{mode:"elevation"});
    editRegionTool.onPointerUp(ctx);
    assert.deepEqual(heights(runtime),[0,4,7]);
    const history = ctx.history.undo();
    assert.equal(history.undo.length,8);
    runtime.applyRegionEdit(history.undo);
    assert.deepEqual(heights(runtime),[0,3,6]);
    runtime.applyRegionEdit(ctx.history.redo().redo);
    assert.deepEqual(heights(runtime),[0,4,7]);
  } finally { session.free(); }
});
const square = (x0,z0,x1,z1) => [[x0,z0],[x1,z0],[x1,z1],[x0,z1]].map(([x,z])=>({point:{x,y:0,z}}));
test("wall construction welds both platform levels without reusing the floor below by XZ", () => {
  const {ctx,runtime,session} = sessionFixture();
  try {
    for (let i=0;i<3;i++) addFace(runtime,`platform-${i}`,"platform",[[0,0],[4,0],[4,4],[0,4]].map(([x,z],c)=>({id:`p${i}:${c}`,position:{x,y:i*3,z}})));
    for (const y of [0,3]) commitWallContour(ctx,[{start:{x:0,y,z:0},end:{x:4,y,z:0},geometry:{kind:"line"}}],{height:3,wallType:"wall-white"},"wall-line");
    const walls=runtime.getAllRegionTopologies().filter((t)=>t.surfaceType==="wall-white");
    assert.equal(walls.length,2);
    assert.ok(walls.every((t)=>t.nodes.every((n)=>n.id.startsWith("p"))));
    const moved=plan(runtime,0,{x:0,y:1,z:0});
    assert.equal(moved.kind,"apply",moved.reason);
    runtime.applyRegionEdit(moved.ops);
    assert.deepEqual(heights(runtime),[1,4,7]);
  } finally {session.free();}
});
test("bottom wall edge moves both paired posts and propagates through actual incident types", () => {
  const {runtime,session}=building();
  try {
    const wall=runtime.getAllRegionTopologies().find((t)=>t.surfaceType==="wall-white"&&t.nodes.some((n)=>n.id==="p0:0"));
    const edge=wall.outerLoops.flat().find((e)=>e.startNodeId==="p0:0"&&e.endNodeId==="p0:1");
    const result=planEdit(resolveCloudTopology(runtime,wall.surfaceKey),{surfaceKey:wall.surfaceKey,target:{kind:"edge",edgeId:edge.edgeId},delta:{x:1,y:9,z:0}},runtime.getGraphSnapshot(),runtime);
    assert.equal(result.kind,"apply",result.reason);
    assert.equal(result.ops.length,6);
    assert.ok(result.ops.every((op)=>op.position.y===Number(op.nodeId[1])*3));
  } finally {session.free();}
});
test("wall openings follow the base and remain inside a wall when its top is lowered", () => {
  const {runtime,session}=building();
  try {
    const outer=["p0:0","p0:1","p1:1","p1:0"].map((id)=>runtime.getGraphSnapshot().nodes.find((n)=>n.id===id));
    const hole=[[1,1],[1,2],[2,2],[2,1]].map(([x,y],i)=>({id:`hole:${i}`,position:{x,y,z:0}}));
    const edges=(nodes,prefix)=>nodes.map((n,i)=>({edgeId:`${prefix}:${i}`,startNodeId:n.id,endNodeId:nodes[(i+1)%nodes.length].id}));
    const rim=edges(outer,"rim"), opening=edges(hole,"opening");
    const uses=(es)=>es.map((e)=>({edgeId:e.edgeId,reversed:false}));
    runtime.addPatch({nodes:[...outer,...hole],edges:[...rim,...opening],regions:[{regionId:"wall-with-hole",boundary:uses(rim),holes:[uses(opening)],surfaceType:"wall-white",physical:true}]});
    const moved=plan(runtime,0,{x:0,y:1,z:0});
    assert.equal(moved.kind,"apply",moved.reason);
    runtime.applyRegionEdit(moved.ops);
    assert.deepEqual(runtime.getGraphSnapshot().nodes.filter((n)=>n.id.startsWith("hole:")).map((n)=>n.position.y),[2,3,3,2]);
    assert.equal(plan(runtime,1,{x:0,y:-1.5,z:0}).kind,"deny");
  } finally {session.free();}
});
test("platform creation, extension retaining supports, hole, separation and topology history", () => {
  const {ctx,runtime,session,calls} = sessionFixture();
  try {
    commitPlatformContour(ctx,square(0,0,4,4),{mode:"create",elevation:3});
    assert.equal(runtime.getAllRegionTopologies().length,1,JSON.stringify(calls.feedback));
    const original = runtime.getAllRegionTopologies()[0].nodes.map((n)=>n.id);
    commitPlatformContour(ctx,square(-1,-1,5,5),{mode:"extend",elevation:3});
    const topologies = runtime.getAllRegionTopologies();
    for (const id of original) assert.ok(topologies.some((t)=>t.nodes.some((n)=>n.id===id)), id);
    assert.equal(runtime.cloudFor({seed:topologies[0].surfaceKey,surfaceType:"platform"}).surfaceKeys.length,topologies.length);
    commitPlatformContour(ctx,square(1,1,2,2),{mode:"cut",elevation:3});
    assert.ok(runtime.getAllRegionTopologies().some((t)=>t.holes.length),JSON.stringify(calls.feedback));
    commitPlatformContour(ctx,square(2.5,-2,3.5,6),{mode:"cut",elevation:3});
    const separated = runtime.getAllRegionTopologies();
    assert.ok(runtime.cloudFor({seed:separated[0].surfaceKey,surfaceType:"platform"}).surfaceKeys.length < separated.length,JSON.stringify(calls.feedback));
    const after = session.snapshot_json();
    const operationId = ctx.history.undo().operationId;
    session.undo_region_overlay(operationId);
    session.redo_region_overlay(operationId);
    assert.equal(session.snapshot_json(),after);
    assert.ok(runtime.getAllRegionTopologies().flatMap((t)=>t.nodes).every((n)=>n.position.y===3));
  } finally { session.free(); }
});
