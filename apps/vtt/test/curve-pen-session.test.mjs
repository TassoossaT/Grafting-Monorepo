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
const closeCurves=(actual,expected,tolerance=1e-10)=>{assert.equal(actual.length,expected.length);actual.forEach((c,i)=>c.points.forEach((p,j)=>p.forEach((v,k)=>assert.ok(Math.abs(v-expected[i].points[j][k])<tolerance, `curve coordinate changed at ${i}/${j}/${k}: ${v} != ${expected[i].points[j][k]}`))));};
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

test("point-authored road reinterpolates moved anchors, with reversible automatic policy",()=>{
  const f=fixture();
  try {
    build(f);
    const before=state(f), id=edges(f)[0].endNodeId;
    assert.ok(edges(f).every(e=>e.curve.mode==="automatic"));
    const a={...sample(0,4),nodeId:id}, b=sample(1,6);
    tool.onPointerDown(f.ctx,a,points);tool.onPointerUp(f.ctx,gesture(a,b),points);
    const expected=f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"automatic",points:[[-10,0,0],[1,0,6],[10,0,0]]}]})[0].curves;
    closeCurves(edges(f).map(e=>resolve(f,e)),expected);
    assert.ok(edges(f).every(e=>e.curve.mode==="automatic"));
    const after=state(f);
    f.session.undo_region_overlay("curve-edit:2");assert.deepEqual(state(f),before);
    f.session.redo_region_overlay("curve-edit:2");assert.deepEqual(state(f),after);
  } finally {f.close();}
});

test("freehand road keeps explicit controls after point-mode policy addition",()=>{
  const f=fixture();
  try {
    const a=sample(-10,0),b=sample(0,4),c=sample(10,0);
    tool.onPointerDown(f.ctx,a,brush);
    tool.onPointerMove(f.ctx,{start:a,current:b,samples:[a,b]},brush);
    tool.onPointerUp(f.ctx,{start:a,current:c,samples:[a,b,c]},brush);
    assert.ok(edges(f).length>0);
    assert.ok(edges(f).every(e=>e.curve.mode==="free"));
  } finally {f.close();}
});
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
test("road body dragging curves the edge; obsolete tangent picks remain inert",()=>{
  const f=fixture();
  try {
    build(f);const before=state(f),face=f.runtime.getAllRegionTopologies()[0];
    const body={...sample(-4,2.6),surfaceRef:surfaceRefFromNodeSet(face.surfaceKey)};
    f.click(body,sample(-4,9),brush);assert.notDeepEqual(state(f),before);
    assert.equal(edges(f).length,2);const reshaped=state(f);
    const e=edges(f)[0],handle={...sample(-8,2),nodeId:curvePickId(e.edgeId,1)};
    f.click(handle,sample(-8,8));assert.deepEqual(state(f),reshaped);assert.equal(f.finish(),false);
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
    f.click(mid,sample(-5,8));assert.notDeepEqual(state(f),before);assert.equal(edges(f).length,2);
    const id=e.startNodeId,p=f.runtime.getGraphSnapshot().nodes.find(n=>n.id===id).position;
    f.click({point:p,nodeId:id});tool.onKeyDown(f.ctx,"Delete",points);
    assert.equal(edges(f).length,1,JSON.stringify(f.calls.feedback));
    assert.ok(edges(f).every(e=>e.startNodeId!==id&&e.endNodeId!==id));
    assert.ok(f.runtime.getAllRegionTopologies().length);
  }finally{f.close();}
});


test("freehand road uses brush margin and commits the preview's interpreted spine",()=>{
  const f=fixture();
  try {
    const params={...brush,radius:2.5,bedWidth:3};
    const samples=Array.from({length:161},(_,i)=>{const t=i/160;return sample(20*t,4*Math.sin(Math.PI*t)+0.15*Math.sin(32*Math.PI*t));});
    const g={start:samples[0],current:samples.at(-1),samples};
    const interpreted=[];const original=f.runtime.curveBatch;
    f.runtime.curveBatch=request=>{const result=original(request);if(request.commands[0]?.kind==="interpretStroke")interpreted.push({request,result});return result;};
    tool.onPointerDown(f.ctx,g.start,params);tool.onPointerMove(f.ctx,g,params);
    assert.equal(interpreted[0].request.commands[0].correction,1);
    assert.ok(interpreted[0].result[0].curves.length<10,"hand wobble must not create dozens of spines");
    tool.onPointerUp(f.ctx,g,params);
    assert.equal(f.calls.feedback.filter(x=>x.tone==="error").length,0,JSON.stringify(f.calls.feedback));
    closeCurves(interpreted[1].result[0].curves,interpreted[0].result[0].curves);
    // Graph node positions are stored as f32; handle reconstruction inherits that precision.
    closeCurves(edges(f).map(e=>resolve(f,e)),interpreted[0].result[0].curves,2e-6);
  }finally{f.close();}
});


test("scene gizmo raises a road anchor and horizontal editing retains its elevation",async()=>{
  const {beginCurveGesture}=await import("../src/composition/tabletop/tools/core/curve-edit-gesture.ts");
  const f=fixture();
  try {
    build(f);
    const id=edges(f)[0].endNodeId;
    const node=()=>f.runtime.getGraphSnapshot().nodes.find(n=>n.id===id);
    const start={nodeId:id,point:node().position};
    const raised={nodeId:id,point:{...start.point,y:3}};
    const edit=beginCurveGesture(f.ctx,start,{mode:"shape",insertOnClick:false,spatialTarget:true});
    edit.move(gesture(start,raised));edit.commit();
    assert.equal(node().position.y,3,JSON.stringify(f.calls.feedback));
    const above={nodeId:id,point:node().position};
    const horizontal=beginCurveGesture(f.ctx,above,{mode:"shape",insertOnClick:false});
    horizontal.move(gesture(above,{point:{x:above.point.x+1,y:0,z:above.point.z}}));horizontal.commit();
    assert.equal(node().position.y,3);
    assert.equal(node().position.x,above.point.x+1);
  }finally{f.close();}
});

test("freehand road retains a hill between endpoints at zero elevation",()=>{
  const f=fixture();
  try {
    const samples=Array.from({length:41},(_,i)=>{const t=i/40;return {point:{x:20*t,y:12*t*(1-t),z:0}};});
    const g={start:samples[0],current:samples.at(-1),samples};
    tool.onPointerDown(f.ctx,g.start,brush);tool.onPointerUp(f.ctx,g,brush);
    assert.equal(edges(f).length,1,JSON.stringify(f.calls.feedback));
    const c=resolve(f,edges(f)[0]);
    const middle=f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"split",curve:c,t:0.5}]})[0].curves[0].points[3];
    assert.ok(Math.abs(middle[1]-3)<1e-5,"road hill must survive fitting and commit");
    assert.ok(f.runtime.getAllRegionTopologies().some(t=>t.nodes.some(n=>n.position.y>2.9)),"the generated surface must retain the hill too");
  }finally{f.close();}
});


for(const mode of ["points","brush"])for(const originKind of ["vertex","edge"]){
  test(`T junction from ${originKind} in ${mode} mode is connected and reversible`,()=>{
    const f=fixture();
    try {
      f.click(sample(-10,0));if(originKind==="vertex")f.click(sample(0,0));f.click(sample(10,0));f.finish();
      const face=f.runtime.getAllRegionTopologies()[0];
      const vertex=edges(f)[0].endNodeId;
      const origin=originKind==="vertex"?{...sample(0,0),nodeId:vertex,shiftKey:true}:{...sample(3,0.1),surfaceRef:surfaceRefFromNodeSet(face.surfaceKey),shiftKey:true};
      const x=originKind==="vertex"?0:3, params={...points,creationMode:mode};
      const before=state(f);
      if(mode==="points"){f.click(origin,origin,params);f.click(sample(x,8),sample(x,8),params);f.finish();}
      else f.click(origin,sample(x,8),params);
      assert.equal(f.calls.feedback.filter(x=>x.tone==="error").length,0,JSON.stringify(f.calls.feedback));
      const graph=f.runtime.getGraphSnapshot();
      const junction=graph.nodes.find(n=>Math.abs(n.position.x-x)<0.01&&Math.abs(n.position.z)<0.01&&edges(f).filter(e=>e.startNodeId===n.id||e.endNodeId===n.id).length===3);
      assert.ok(junction,"branch must share a degree-three spine junction, not merely overlap visually");
      assert.equal(edges(f).length,3);
      const after=state(f),id=`platform-test:road-${mode==="points"?"points":"stroke"}:2`;
      f.session.undo_region_overlay(id);assert.deepEqual(state(f),before);
      f.session.redo_region_overlay(id);assert.deepEqual(state(f),after);
    }finally{f.close();}
  });
}

test("edge click inserts at the clicked parameter and preserves the original curve",()=>{
  const f=fixture();
  try {
    f.click(sample(-10,0));f.click(sample(10,0));f.finish();
    const face=f.runtime.getAllRegionTopologies()[0];
    f.click({...sample(3,0.1),surfaceRef:surfaceRefFromNodeSet(face.surfaceKey)});
    assert.equal(edges(f).length,2,JSON.stringify(f.calls.feedback));
    const node=f.runtime.getGraphSnapshot().nodes.find(n=>n.id===f.selected?.id);
    assert.ok(Math.abs(node.position.x-3)<0.01&&Math.abs(node.position.z)<0.01);
    for(const e of edges(f))for(const p of resolve(f,e).points)assert.ok(Math.abs(p[2])<1e-9);
  }finally{f.close();}
});

test("cancelling a branch from an edge does not split the standing road",()=>{
  const f=fixture();
  try {
    f.click(sample(-10,0));f.click(sample(10,0));f.finish();
    const face=f.runtime.getAllRegionTopologies()[0],before=state(f);
    const a={...sample(3,0),surfaceRef:surfaceRefFromNodeSet(face.surfaceKey),shiftKey:true},b=sample(3,8),g=gesture(a,b);
    tool.onPointerDown(f.ctx,a,brush);tool.onPointerMove(f.ctx,g,brush);
    assert.deepEqual(state(f),before);tool.onCancel(f.ctx);tool.onPointerUp(f.ctx,g,brush);assert.deepEqual(state(f),before);
  }finally{f.close();}
});


test("edge curvature drag previews transiently, cancels, and undoes without adding vertices",()=>{
  const f=fixture();
  try {
    f.click(sample(-10,0));f.click(sample(10,0));f.finish();
    const face=f.runtime.getAllRegionTopologies()[0],before=state(f);
    const a={...sample(3,0.1),surfaceRef:surfaceRefFromNodeSet(face.surfaceKey)},b=sample(3,4),g=gesture(a,b);
    tool.onPointerDown(f.ctx,a,brush);tool.onPointerMove(f.ctx,g,brush);
    assert.deepEqual(state(f),before);tool.onCancel(f.ctx);tool.onPointerUp(f.ctx,g,brush);assert.deepEqual(state(f),before);
    f.click(a,b,brush);assert.equal(edges(f).length,1);assert.notDeepEqual(state(f),before);
    assert.ok(resolve(f,edges(f)[0]).points.some(p=>p[2]>1));
    const after=state(f);f.session.undo_region_overlay("curve-edit:3");assert.deepEqual(state(f),before);
    f.session.redo_region_overlay("curve-edit:3");assert.deepEqual(state(f),after);
  }finally{f.close();}
});
