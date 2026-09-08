import assert from "node:assert/strict";
import test from "node:test";
import { planEdit, resolveCloudTopology } from "../src/features/edit-construction/index.ts";
import { editRegionTool } from "../src/composition/tabletop/tools/core/edit-region-tool.ts";
import { commitPlatformContour, commitPlatformShape, platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
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
test("wall endpoint drawn a few centimeters off a platform vertex still welds onto it",()=>{
  const {ctx,runtime,session} = sessionFixture();
  try {
    addFace(runtime,"platform-0","platform",[[0,0],[4,0],[4,4],[0,4]].map(([x,z],c)=>({id:`p0:${c}`,position:{x,y:3,z}})));
    // 0.1 world units off p0:0/p0:1 -- inside the corner-weld tolerance, well
    // outside the old exact-match check this regression guards against.
    commitWallContour(ctx,[{start:{x:0.05,y:3,z:0.05},end:{x:3.95,y:3,z:-0.05},geometry:{kind:"line"}}],{height:3,wallType:"wall-white"},"wall-line");
    const wall=runtime.getAllRegionTopologies().find((t)=>t.surfaceType==="wall-white");
    assert.ok(wall,"wall was not created");
    assert.ok(wall.nodes.some((n)=>n.id==="p0:0"),"lower-left endpoint did not weld onto the platform vertex");
    assert.ok(wall.nodes.some((n)=>n.id==="p0:1"),"lower-right endpoint did not weld onto the platform vertex");
    const moved=plan(runtime,0,{x:0,y:1,z:0});
    assert.equal(moved.kind,"apply",moved.reason);
  } finally {session.free();}
});
test("platform creation started on a wall's own top vertex inherits its elevation and welds onto it",()=>{
  const {ctx,runtime,session,calls} = sessionFixture();
  try {
    commitWallContour(ctx,[{start:{x:0,y:0,z:0},end:{x:4,y:0,z:0},geometry:{kind:"line"}}],{height:3,wallType:"wall-white"},"wall-line");
    const wall=runtime.getAllRegionTopologies().find((t)=>t.surfaceType==="wall-white");
    const top=wall.nodes.find((n)=>Math.abs(n.position.y-3)<1e-6&&n.position.x===0&&n.position.z===0);
    assert.ok(top,"wall top vertex not found");
    // `elevation:0` in params is deliberately wrong -- the pointer landing on
    // the wall's own top node has to win, the way it already does for a pick
    // on an existing platform.
    const from={point:{x:0,y:3,z:0},nodeId:top.id};
    const to={point:{x:4,y:3,z:4}};
    platformContourTool.onPointerUp(ctx,{start:from,current:to,samples:[from,to]},{mode:"create",elevation:0,shape:"rectangle"});
    const created=runtime.getAllRegionTopologies().find((t)=>t.surfaceType==="platform");
    assert.ok(created,JSON.stringify(calls.feedback));
    assert.ok(created.nodes.every((n)=>n.position.y===3));
    assert.ok(created.nodes.some((n)=>n.id===top.id),"platform corner did not weld onto the wall's own vertex");
  } finally {session.free();}
});
test("platform corner drawn a few centimeters off a wall's top vertex still magnets onto it",()=>{
  const {ctx,runtime,session,calls} = sessionFixture();
  try {
    commitWallContour(ctx,[{start:{x:0,y:0,z:0},end:{x:4,y:0,z:0},geometry:{kind:"line"}}],{height:3,wallType:"wall-white"},"wall-line");
    const wall=runtime.getAllRegionTopologies().find((t)=>t.surfaceType==="wall-white");
    const top=wall.nodes.find((n)=>Math.abs(n.position.y-3)<1e-6&&n.position.x===0&&n.position.z===0);
    assert.ok(top,"wall top vertex not found");
    // 0.05 world units off the wall's own vertex -- no nodeId on the pick,
    // inside the weld tolerance, so only distance-based magnetism (not an
    // exact pick match) can resolve this onto the wall's node.
    commitPlatformContour(ctx,[{point:{x:0.05,y:3,z:-0.05}},{point:{x:4,y:3,z:-0.05}},{point:{x:4,y:3,z:4}},{point:{x:0.05,y:3,z:4}}],{mode:"create",elevation:3});
    const created=runtime.getAllRegionTopologies().find((t)=>t.surfaceType==="platform");
    assert.ok(created,JSON.stringify(calls.feedback));
    assert.ok(created.nodes.some((n)=>n.id===top.id),"platform corner did not magnet onto the wall's own vertex");
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
test("platform extension welds onto a shared edge instead of crossing it, and topology history covers the whole gesture", () => {
  const {ctx,runtime,session,calls} = sessionFixture();
  try {
    commitPlatformContour(ctx,square(0,0,4,4),{mode:"create",elevation:3});
    assert.equal(runtime.getAllRegionTopologies().length,1,JSON.stringify(calls.feedback));
    const original = runtime.getAllRegionTopologies()[0].nodes.map((n)=>n.id);
    // Shares the whole x=4 edge with the original square -- a weld run, not a crossing.
    commitPlatformContour(ctx,square(4,0,8,4),{mode:"extend",elevation:3});
    const merged = runtime.getAllRegionTopologies();
    assert.equal(merged.length,1,JSON.stringify(calls.feedback));
    for (const id of original) assert.ok(merged[0].nodes.some((n)=>n.id===id), id);
    assert.ok(merged[0].nodes.some((n)=>n.position.x===8));
    const after = session.snapshot_json();
    const operationId = ctx.history.undo().operationId;
    session.undo_region_overlay(operationId);
    assert.equal(runtime.getAllRegionTopologies().length,1);
    assert.ok(!runtime.getAllRegionTopologies()[0].nodes.some((n)=>n.position.x===8));
    session.redo_region_overlay(operationId);
    assert.equal(session.snapshot_json(),after);
    assert.ok(runtime.getAllRegionTopologies().flatMap((t)=>t.nodes).every((n)=>n.position.y===3));
  } finally { session.free(); }
});

test("platform cut welds onto two boundary vertices to carve off a strip, and a fully disjoint cut becomes a hole", () => {
  const {ctx,runtime,session,calls} = sessionFixture();
  try {
    commitPlatformContour(ctx,square(0,0,4,4),{mode:"create",elevation:3});
    // Shares the (4,4)-(0,4) top edge -- welds at both corners, carves the top strip off.
    commitPlatformContour(ctx,square(0,3,4,4),{mode:"cut",elevation:3});
    const cut = runtime.getAllRegionTopologies();
    assert.equal(cut.length,1,JSON.stringify(calls.feedback));
    assert.ok(!cut[0].nodes.some((n)=>n.position.z>3.001));
    // Entirely interior, welds onto nothing -- a hole, not an error.
    commitPlatformContour(ctx,square(1,1,2,1.5),{mode:"cut",elevation:3});
    assert.ok(runtime.getAllRegionTopologies().some((t)=>t.holes.length),JSON.stringify(calls.feedback));
  } finally { session.free(); }
});

test("a stroke touching the boundary at only one point is refused, and extend refuses a stroke that never touches the target", () => {
  const {ctx,runtime,session,calls} = sessionFixture();
  try {
    commitPlatformContour(ctx,square(0,0,4,4),{mode:"create",elevation:3});
    const before = session.snapshot_json();
    // Shares only the single corner (4,4) with the original -- no full edge to weld.
    commitPlatformContour(ctx,square(4,4,8,8),{mode:"extend",elevation:3});
    assert.equal(session.snapshot_json(),before);
    assert.ok(calls.feedback.at(-1).message.includes("aresta inteira"),JSON.stringify(calls.feedback));
    // Shares nothing at all with the target platform.
    commitPlatformContour(ctx,square(20,20,24,24),{mode:"extend",elevation:3});
    assert.equal(session.snapshot_json(),before);
    assert.ok(calls.feedback.at(-1).message.includes("Encoste"),JSON.stringify(calls.feedback));
  } finally { session.free(); }
});

test("platform rectangle gesture welds onto the picked floor's own edge, resolving elevation from the pick", () => {
  const {ctx,runtime,session,calls}=sessionFixture();
  try {
    commitPlatformContour(ctx,square(0,0,4,4),{mode:"create",elevation:3});
    const original=runtime.getAllRegionTopologies()[0];
    // `elevation:0` in params is deliberately wrong -- the pick on the
    // existing platform (elevation 3) has to win. The dragged rectangle
    // itself lands exactly on the original's x=4 edge, corner to corner.
    const from={point:{x:4,y:3,z:0},surfaceRef:surfaceRefFromNodeSet(original.surfaceKey)};
    const to={point:{x:8,y:0,z:4}};
    const params={mode:"extend",elevation:0,shape:"rectangle"};
    platformContourTool.onPointerUp(ctx,{start:from,current:to,samples:[from,to]},params);
    const tops=runtime.getAllRegionTopologies();
    assert.equal(tops.length,1,JSON.stringify(calls.feedback));
    assert.ok(tops.flatMap(t=>t.nodes).every(n=>n.position.y===3));
    assert.ok(tops.flatMap(t=>t.nodes).some(n=>n.position.x===8));
    const snapshot=session.snapshot_json();
    const entry=ctx.history.undo();
    session.undo_region_overlay(entry.operationId);
    assert.equal(runtime.getAllRegionTopologies()[0].nodes.length,4);
    session.redo_region_overlay(entry.operationId);
    assert.equal(session.snapshot_json(),snapshot);
  } finally {session.free();}
});

test("platform circle shares the tower contour, welds cut holes, and refuses a freely crossing extend", async () => {
  const {circleContour}=await import("../src/composition/tabletop/tools/tower/tower-geometry.ts");
  const {ctx,runtime,session,calls}=sessionFixture();
  const curves=()=>runtime.getAllRegionTopologies().flatMap(t=>[...t.outerLoops,...t.holes].flat());
  try {
    platformContourTool.onClick(ctx,{point:{x:0,y:0,z:0}},{mode:"create",elevation:3,shape:"circle",radius:2.5});
    assert.equal(curves().length,4,JSON.stringify(calls.feedback));
    assert.ok(curves().every(c=>c.geometry.kind==="arc"));
    const before = session.snapshot_json();
    // Two independently drawn circles almost never share a whole arc span --
    // crossing without welding is exactly what this tool no longer does.
    commitPlatformShape(ctx,circleContour({x:3,y:3,z:0},2.5),{mode:"extend",elevation:3});
    assert.equal(session.snapshot_json(),before,JSON.stringify(calls.feedback));
    assert.equal(runtime.getAllRegionTopologies().length,1);
    // A smaller, fully interior circle still cuts a hole -- that case never needed welding.
    commitPlatformShape(ctx,circleContour({x:0,y:3,z:0},1),{mode:"cut",elevation:3});
    assert.ok(runtime.getAllRegionTopologies().some(t=>t.holes.length),JSON.stringify(calls.feedback));
    assert.ok(curves().every(c=>c.geometry.kind==="arc"));
    const snapshot=session.snapshot_json();
    const entry=ctx.history.undo();session.undo_region_overlay(entry.operationId);session.redo_region_overlay(entry.operationId);
    assert.equal(session.snapshot_json(),snapshot);
  } finally {session.free();}
});

test("platform freehand fits curves, polygon cancellation clears corners, lower picks never weld", () => {
  const {ctx,runtime,session,calls}=sessionFixture();
  try {
    addFace(runtime,"ground","terrain",square(-1,-1,1,1).map((s,i)=>({id:`ground-${i}`,position:{...s.point,y:0}})));
    const polygon={mode:"create",elevation:3,shape:"polygon"};
    platformContourTool.onClick(ctx,{point:{x:50,y:0,z:50}},polygon);
    platformContourTool.onCancel(ctx);
    const corners=square(0,0,4,4);
    for(const p of [...corners,corners[0]])platformContourTool.onClick(ctx,p,polygon);
    assert.ok(runtime.getAllRegionTopologies().filter(t=>t.surfaceType==="platform").flatMap(t=>t.nodes).every(n=>n.position.x<10));
    const samples=Array.from({length:65},(_,i)=>({point:{x:10+3*Math.cos(i*Math.PI/32),y:0,z:3*Math.sin(i*Math.PI/32)}}));
    platformContourTool.onPointerUp(ctx,{start:samples[0],current:samples.at(-1),samples},{mode:"create",elevation:3,shape:"freehand",tolerance:0.1});
    assert.ok(runtime.getAllRegionTopologies().filter(t=>t.surfaceType==="platform").some(t=>t.outerLoops.flat().some(e=>e.geometry.kind==="arc")),JSON.stringify(calls.feedback));
    commitPlatformContour(ctx,corners.map(s=>({...s,nodeId:"ground-0"})),{mode:"create",elevation:6});
    const upper=runtime.getAllRegionTopologies().filter(t=>t.surfaceType==="platform"&&t.nodes[0].position.y===6);
    assert.equal(upper.length,1,JSON.stringify(calls.feedback));
    assert.ok(upper[0].nodes.every(n=>!n.id.startsWith("ground")));
  }finally{session.free();}
});

test("editing an arc endpoint keeps a valid circle, and a freely crossing extend leaves distant identities untouched", async () => {
  const {circleContour}=await import("../src/composition/tabletop/tools/tower/tower-geometry.ts");
  const {ctx,runtime,session,calls}=sessionFixture();
  try {
    commitPlatformContour(ctx,square(100,100,104,104),{mode:"create",elevation:3});
    const far=runtime.getAllRegionTopologies()[0];
    commitPlatformShape(ctx,circleContour({x:0,y:3,z:0},2.5),{mode:"create",elevation:3});
    const disk=runtime.getAllRegionTopologies().find(t=>t.nodes[0].position.x<10);
    const node=disk.nodes[0];
    const before=session.snapshot_json();
    runtime.applyRegionEdit([{kind:"move-vertex",nodeId:node.id,position:{...node.position,x:node.position.x+1}}]);
    const deformed=runtime.getRegionTopology(disk.surfaceKey);
    const positions=new Map(deformed.nodes.map(n=>[n.id,n.position]));
    for(const edge of deformed.outerLoops.flat()) {
      const a=positions.get(edge.startNodeId),b=positions.get(edge.endNodeId);
      const center=edge.geometry.center;
      assert.ok(Math.abs(Math.hypot(a.x-center[0],a.z-center[1])-Math.hypot(b.x-center[0],b.z-center[1]))<1e-4);
    }
    runtime.applyRegionEdit([{kind:"move-vertex",nodeId:node.id,position:node.position}]);
    assert.equal(session.snapshot_json(),before);
    const edge=disk.outerLoops.flat().find(e=>e.startNodeId===node.id);
    const neighbor=disk.nodes.find(n=>n.id===edge.endNodeId);
    assert.throws(()=>runtime.applyRegionEdit([{kind:"move-vertex",nodeId:node.id,position:neighbor.position}]),/collapse/);
    assert.equal(session.snapshot_json(),before);
    commitPlatformShape(ctx,circleContour({x:3,y:3,z:0},2.5),{mode:"extend",elevation:3});
    assert.deepEqual(runtime.getRegionTopology(far.surfaceKey),far,JSON.stringify(calls.feedback));
    // Crosses without welding onto a shared arc -- refused, disk untouched (same node set, still a circle).
    const stillDisk=runtime.getRegionTopology(disk.surfaceKey);
    assert.deepEqual(new Set(stillDisk.nodes.map(n=>n.id)),new Set(disk.nodes.map(n=>n.id)),JSON.stringify(calls.feedback));
    assert.ok(stillDisk.outerLoops.flat().every(e=>e.geometry.kind==="arc"));
  } finally {session.free();}
});

test("two different arcs between the same vertices remain distinct platform boundaries",()=>{
  const {ctx,runtime,session,calls}=sessionFixture();
  const a={x:3,y:3,z:4},b={x:3,y:3,z:-4};
  try {
    commitPlatformShape(ctx,[
      {start:a,end:b,geometry:{kind:"arc",center:[0,0],clockwise:true}},
      {start:b,end:a,geometry:{kind:"arc",center:[6,0],clockwise:true}},
    ],{mode:"create",elevation:3});
    const tops=runtime.getAllRegionTopologies();
    assert.equal(tops.length,1,JSON.stringify(calls.feedback));
    const edges=tops[0].outerLoops.flat();
    assert.equal(new Set(edges.map(e=>e.edgeId)).size,2);
    assert.deepEqual(new Set(edges.map(e=>e.geometry.center[0])),new Set([0,6]));
  }finally{session.free();}
});
