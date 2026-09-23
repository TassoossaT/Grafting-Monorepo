import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { pathBrushTool as tool } from "../src/composition/tabletop/tools/paths/path-brush-tool.ts";
import { curvePickId } from "../src/features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";
const sample=(x,z)=>({point:{x,y:0,z}});
const gesture=(a,b)=>({start:a,current:b,samples:[a,b]});
const points={...tool.defaultParams(),creationMode:"points",bedWidth:0.6};
const brush={...points,creationMode:"brush"};
const state=f=>JSON.parse(f.session.snapshot_json());
const edges=f=>f.runtime.getGraphSnapshot().edges.filter(e=>e.curve);
const closeCurves=(actual,expected)=>{assert.equal(actual.length,expected.length);actual.forEach((c,i)=>c.points.forEach((p,j)=>p.forEach((v,k)=>assert.ok(Math.abs(v-expected[i].points[j][k])<1e-10, "curve coordinate changed"))));};
function fixture() {
  const f=sessionFixture();f.previews=new Map();f.selected=undefined;
  f.ctx.reportSelection=value=>{f.selected=value;};
  f.runtime.showPreview=(d,c)=>f.previews.set(c,d);
  f.runtime.clearPreview=c=>f.previews.delete(c);
  f.runtime.getFootprintCoverage=()=>[];
  f.click=(a,b=a,params=points)=>{tool.onPointerDown(f.ctx,a,params);tool.onPointerUp(f.ctx,gesture(a,b),params);};
  f.finish=()=>tool.onKeyDown(f.ctx,"Enter",points);
  f.close=()=>{tool.onCancel(f.ctx);f.session.free();};
  return f;
}
function build(f) {f.click(sample(-10,0));f.click(sample(0,4));f.click(sample(10,0));f.finish();}
function resolve(f,e) {
  const nodes=new Map(f.runtime.getGraphSnapshot().nodes.map(n=>[n.id,n.position]));
  const xyz=p=>[p.x,p.y,p.z];
  return f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"resolve",handles:e.curve,start:xyz(nodes.get(e.startNodeId)),end:xyz(nodes.get(e.endNodeId))}]})[0].curves[0];
}
test("road points: exact click anchors, no pen handles, hover excluded, one reversible commit",()=>{
  const f=fixture();
  try {
    const before=state(f);
    f.click(sample(-10,0),sample(-7,3));f.click(sample(0,4));f.click(sample(10,0));
    tool.previewFor(gesture(sample(10,0),sample(20,9)),points,f.ctx);
    assert.deepEqual(state(f),before);assert.ok(f.previews.has("road-points"));
    assert.equal(f.finish(),true);
    assert.equal(edges(f).length,2,JSON.stringify(f.calls.feedback));
    const ids=new Set(edges(f).flatMap(e=>[e.startNodeId,e.endNodeId]));
    const actual=f.runtime.getGraphSnapshot().nodes.filter(n=>ids.has(n.id)).map(n=>n.position);
    assert.deepEqual(actual,[{x:-10,y:0,z:0},{x:0,y:0,z:4},{x:10,y:0,z:0}]);
    const expected=f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"automatic",points:[[-10,0,0],[0,0,4],[10,0,0]]}]})[0].curves;
    closeCurves(edges(f).map(e=>resolve(f,e)),expected);
    assert.equal(f.previews.has("road-points"),false);assert.equal(f.finish(),false);
    const after=state(f);
    f.session.undo_region_overlay("platform-test:road-points:1");assert.deepEqual(state(f),before);
    f.session.redo_region_overlay("platform-test:road-points:1");assert.deepEqual(state(f),after);
  }finally{f.close();}
});
test("road points: duplicate click, Backspace, cancellation and late release never build",()=>{
  const f=fixture();
  try {
    const before=state(f);f.click(sample(-10,0));f.click(sample(-10,0));
    assert.equal(f.finish(),true);assert.deepEqual(state(f),before);
    f.click(sample(0,4));tool.onKeyDown(f.ctx,"Backspace",points);f.finish();
    assert.deepEqual(state(f),before);
    tool.onPointerDown(f.ctx,sample(10,0),points);tool.onCancel(f.ctx);
    tool.onPointerUp(f.ctx,gesture(sample(10,0),sample(10,0)),points);
    assert.equal(f.finish(),false);assert.deepEqual(state(f),before);assert.equal(f.previews.size,0);
    build(f);assert.equal(edges(f).length,2);
  }finally{f.close();}
});
test("road points: a rejected commit retains the draft and rolls back for retry",()=>{
  const f=fixture();
  try {
    f.click(sample(-10,0));f.click(sample(10,0));const before=state(f);
    const apply=f.runtime.applyPatchReplacement;
    f.runtime.applyPatchReplacement=r=>{apply(r);throw Error("simulated failure");};
    f.finish();assert.deepEqual(state(f),before);assert.ok(f.previews.has("road-points"));
    f.runtime.applyPatchReplacement=apply;f.finish();assert.equal(edges(f).length,1);
  }finally{f.close();}
});
test("same road tool: anchor drag uses last sample, preserves grab offset and regenerates road",()=>{
  const f=fixture();
  try {
    build(f);
    const e=edges(f)[0],id=e.endNodeId,before=state(f);
    const surfaces=JSON.stringify(f.runtime.getAllRegionTopologies());
    const a={...sample(0.1,4.1),nodeId:id};
    tool.onPointerDown(f.ctx,a,points);
    const end=sample(1.1,6.1);
    const boolean=f.runtime.planarBoolean;
    f.runtime.planarBoolean=()=>{throw Error("preview regenerated a surface");};
    tool.onPointerMove(f.ctx,gesture(a,end),points);
    assert.ok(f.previews.has("curve-edit"));assert.deepEqual(state(f),before);
    f.runtime.planarBoolean=boolean;
    tool.onPointerUp(f.ctx,gesture(a,end),points);
    const p=f.runtime.getGraphSnapshot().nodes.find(n=>n.id===id).position;
    assert.ok(Math.abs(p.x-1)<1e-9 && Math.abs(p.z-6)<1e-9);
    assert.notEqual(JSON.stringify(f.runtime.getAllRegionTopologies()),surfaces);
    assert.equal(edges(f).length,2);
    const after=state(f);tool.onPointerUp(f.ctx,gesture(a,end),points);assert.deepEqual(state(f),after);
    f.session.undo_region_overlay("curve-edit:2");assert.deepEqual(state(f),before);
    f.session.redo_region_overlay("curve-edit:2");assert.deepEqual(state(f),after);
  }finally{f.close();}
});
test("road point drag: cancellation, click and out-and-back preserve graph",()=>{
  const f=fixture();
  try {
    build(f);const id=edges(f)[0].startNodeId,a={...sample(-10,0),nodeId:id},end=sample(-10,3),before=state(f);
    tool.onPointerDown(f.ctx,a,brush);tool.onPointerMove(f.ctx,gesture(a,end),brush);tool.onCancel(f.ctx);
    tool.onPointerUp(f.ctx,gesture(a,end),brush);assert.deepEqual(state(f),before);
    f.click(a,a,brush);assert.deepEqual(state(f),before);
    tool.onPointerDown(f.ctx,a,brush);tool.onPointerMove(f.ctx,gesture(a,end),brush);tool.onPointerUp(f.ctx,gesture(a,a),brush);
    assert.deepEqual(state(f),before);
  }finally{f.close();}
});
test("road midpoint: inserts without changing curve and selected internal point can be removed",()=>{
  const f=fixture();
  try {
    build(f);const original=edges(f)[0],curve=resolve(f,original);
    const half=f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"split",curve,t:0.5}]})[0].curves;
    const mid={...sample(half[0].points[3][0],half[0].points[3][2]),nodeId:curvePickId(original.edgeId,"midpoint")};
    f.click(mid);assert.equal(edges(f).length,3,JSON.stringify(f.calls.feedback));
    const split=edges(f).filter(e=>e.edgeId===original.edgeId||e.edgeId.startsWith(original.edgeId+":split:"));
    closeCurves(split.map(e=>resolve(f,e)),half);
    const id=split[0].endNodeId,p=f.runtime.getGraphSnapshot().nodes.find(n=>n.id===id).position;
    f.click({point:p,nodeId:id});
    assert.equal(tool.onKeyDown(f.ctx,"Delete",points),true);
    assert.equal(edges(f).length,2,JSON.stringify(f.calls.feedback));
    assert.ok(edges(f).every(e=>e.startNodeId!==id&&e.endNodeId!==id));
  }finally{f.close();}
});
test("road deletion: removes a deliberate bend; endpoint deletion fails without altering road",()=>{
  const f=fixture();
  try {
    build(f);const id=edges(f)[0].endNodeId,p=f.runtime.getGraphSnapshot().nodes.find(n=>n.id===id).position;
    f.click({point:p,nodeId:id});const before=state(f);
    tool.onKeyDown(f.ctx,"Delete",points);assert.equal(edges(f).length,1,JSON.stringify(f.calls.feedback));assert.notDeepEqual(state(f),before);
    const end=edges(f)[0].startNodeId,pos=f.runtime.getGraphSnapshot().nodes.find(n=>n.id===end).position;
    f.click({point:pos,nodeId:end});const kept=state(f);
    tool.onKeyDown(f.ctx,"Delete",points);assert.deepEqual(state(f),kept);assert.ok(f.calls.feedback.some(x=>x?.tone==="error"));
  }finally{f.close();}
});
test("road body and obsolete tangent picks never pull the curve or create another road",()=>{
  const f=fixture();
  try {
    build(f);const before=state(f),face=f.runtime.getAllRegionTopologies()[0];
    const body={...sample(-4,2.6),surfaceRef:surfaceRefFromNodeSet(face.surfaceKey)};
    f.click(body,sample(-4,9),brush);assert.deepEqual(state(f),before);
    const e=edges(f)[0],handle={...sample(-8,2),nodeId:curvePickId(e.edgeId,1)};
    f.click(handle,sample(-8,8));assert.deepEqual(state(f),before);assert.equal(f.finish(),false);
  }finally{f.close();}
});
test("freehand road: click and cancelled stroke do nothing; final release commits once with undo",()=>{
  const f=fixture();
  try {
    const before=state(f),a=sample(-10,0),b=sample(0,4),c=sample(10,0),g={start:a,current:c,samples:[a,b,c]};
    f.click(a,a,brush);assert.deepEqual(state(f),before);
    tool.onPointerDown(f.ctx,a,brush);tool.onPointerMove(f.ctx,g,brush);
    assert.ok(f.previews.has("road-stroke"));assert.deepEqual(state(f),before);
    tool.onCancel(f.ctx);tool.onPointerUp(f.ctx,g,brush);assert.deepEqual(state(f),before);
    tool.onPointerDown(f.ctx,a,brush);tool.onPointerUp(f.ctx,g,brush);
    assert.ok(edges(f).length,JSON.stringify(f.calls.feedback));
    const after=state(f);tool.onPointerUp(f.ctx,g,brush);assert.deepEqual(state(f),after);
    f.session.undo_region_overlay("platform-test:road-stroke:1");assert.deepEqual(state(f),before);
    f.session.redo_region_overlay("platform-test:road-stroke:1");assert.deepEqual(state(f),after);
  }finally{f.close();}
});
test("freehand road: failed final conversion never commits a stale preview",()=>{
  const f=fixture();
  try {
    const a=sample(-10,0),b=sample(10,0),g=gesture(a,b),before=state(f);
    tool.onPointerDown(f.ctx,a,brush);tool.onPointerMove(f.ctx,g,brush);assert.ok(f.previews.has("road-stroke"));
    f.runtime.curveBatch=()=>{throw Error("invalid final sample");};
    tool.onPointerUp(f.ctx,g,brush);assert.deepEqual(state(f),before);assert.equal(f.previews.has("road-stroke"),false);
  }finally{f.close();}
});

test("road endpoint deletion shortens a path; midpoint dragging never inserts by accident",()=>{
  const f=fixture();
  try {
    build(f);const e=edges(f)[0],mid={...sample(-5,2),nodeId:curvePickId(e.edgeId,"midpoint")},before=state(f);
    f.click(mid,sample(-5,8));assert.deepEqual(state(f),before);
    const id=e.startNodeId,p=f.runtime.getGraphSnapshot().nodes.find(n=>n.id===id).position;
    f.click({point:p,nodeId:id});tool.onKeyDown(f.ctx,"Delete",points);
    assert.equal(edges(f).length,1,JSON.stringify(f.calls.feedback));
    assert.ok(edges(f).every(e=>e.startNodeId!==id&&e.endNodeId!==id));
    assert.ok(f.runtime.getAllRegionTopologies().length);
  }finally{f.close();}
});
