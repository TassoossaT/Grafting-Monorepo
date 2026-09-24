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


test("branch icon action starts a mouse-following draft from an inserted vertex even in brush mode",()=>{
  const f=fixture();
  try {
    f.click(sample(-10,0));f.click(sample(10,0));f.finish();
    const face=f.runtime.getAllRegionTopologies()[0];
    f.click({...sample(3,0),surfaceRef:surfaceRefFromNodeSet(face.surfaceKey)});
    const id=f.selected.id,before=state(f);
    assert.equal(tool.onSelectionAction(f.ctx,"branch",brush),true);
    assert.equal(f.selected,undefined);
    assert.equal(tool.onSelectionAction(f.ctx,"branch",brush),false,"double activation must not restart the draft");
    const cursor=sample(3,8);
    tool.previewFor(gesture(cursor,cursor),brush,f.ctx);
    assert.ok(f.previews.get("road-points").positions.length>12);
    assert.deepEqual(state(f),before,"hover must not construct or move the source vertex");
    f.click(cursor,cursor,brush);
    assert.deepEqual(state(f),before);
    tool.onKeyDown(f.ctx,"Enter",brush);
    assert.equal(edges(f).filter(e=>e.startNodeId===id||e.endNodeId===id).length,3,JSON.stringify(f.calls.feedback));
    assert.equal(f.previews.has("road-points"),false);
    f.session.undo_region_overlay("platform-test:road-points:3");assert.deepEqual(state(f),before);
  }finally{f.close();}
});

test("branch action cancellation and missing selection leave the road unchanged",()=>{
  const f=fixture();
  try {
    assert.equal(tool.onSelectionAction(f.ctx,"branch",brush),false);
    build(f);const e=edges(f)[0],node=f.runtime.getGraphSnapshot().nodes.find(n=>n.id===e.endNodeId);
    f.click({nodeId:node.id,point:node.position});const before=state(f);
    assert.equal(tool.onSelectionAction(f.ctx,"branch",brush),true);
    tool.onCancel(f.ctx);assert.deepEqual(state(f),before);
    assert.equal(tool.onKeyDown(f.ctx,"Enter",brush),false);
    assert.equal(f.previews.has("road-points"),false);
  }finally{f.close();}
});


test("in-scene branch action starts from its vertex without requiring toolbar selection",()=>{
  const f=fixture();
  try {
    build(f);const edge=edges(f)[0],id=edge.endNodeId;
    const action={...sample(0.8,4.8),constructionAction:{kind:"branch",nodeId:id}};
    const before=state(f);
    f.click(action,action,brush);
    const cursor=sample(0,9);tool.previewFor(gesture(cursor,cursor),brush,f.ctx);
    assert.ok(f.previews.get("road-points").positions.length>12);
    assert.deepEqual(state(f),before);
    f.click(cursor,cursor,brush);tool.onKeyDown(f.ctx,"Enter",brush);
    assert.equal(edges(f).filter(e=>e.startNodeId===id||e.endNodeId===id).length,3,JSON.stringify(f.calls.feedback));
  }finally{f.close();}
});

for(const mode of ["points","brush"])for(const destination of ["vertex","edge"]){
  test(`snap to ${destination} while drawing in ${mode} mode commits the highlighted junction`,()=>{
    const f=fixture();
    try {
      f.click(sample(-10,0));f.click(sample(0,0));f.click(sample(10,0));f.finish();
      const params={...points,creationMode:mode},x=destination==="vertex"?0:3;
      const face=f.runtime.getAllRegionTopologies()[0];
      const a=sample(x,8),b=destination==="vertex"?sample(0.3,0.25):{...sample(x,0.1),surfaceRef:surfaceRefFromNodeSet(face.surfaceKey)};
      const before=state(f);
      if(mode==="points"){
        f.click(a,a,params);tool.previewFor(gesture(b,b),params,f.ctx);
        assert.ok(f.previews.has("road-snap"));assert.deepEqual(state(f),before);
        f.click(b,b,params);tool.onKeyDown(f.ctx,"Enter",params);
      }else{
        tool.onPointerDown(f.ctx,a,params);tool.onPointerMove(f.ctx,gesture(a,b),params);
        assert.ok(f.previews.has("road-snap"));assert.deepEqual(state(f),before);
        tool.onPointerUp(f.ctx,gesture(a,b),params);
      }
      assert.equal(f.calls.feedback.filter(v=>v.tone==="error").length,0,JSON.stringify(f.calls.feedback));
      const graph=f.runtime.getGraphSnapshot();
      assert.ok(graph.nodes.some(n=>Math.abs(n.position.x-x)<0.01&&Math.abs(n.position.z)<0.01&&edges(f).filter(e=>e.startNodeId===n.id||e.endNodeId===n.id).length===3));
      assert.equal(f.previews.has("road-snap"),false);
    }finally{f.close();}
  });
}

test("snap respects height separation and clears its helper when the pointer leaves the target",async()=>{
  const {roadSnapTarget}=await import("../src/composition/tabletop/tools/paths/road-body-target.ts");
  const f=fixture();
  try {
    f.click(sample(-10,0));f.click(sample(0,0));f.click(sample(10,0));f.finish();
    assert.equal(roadSnapTarget(f.ctx,{point:{x:0,y:3,z:0}}),undefined);
    const a=sample(0,8),near=sample(0.2,0.1),far=sample(0,5);
    f.click(a,a,points);tool.previewFor(gesture(near,near),points,f.ctx);assert.ok(f.previews.has("road-snap"));
    tool.previewFor(gesture(far,far),points,f.ctx);assert.equal(f.previews.has("road-snap"),false);
    tool.previewFor(gesture(near,near),points,f.ctx);tool.onCancel(f.ctx);assert.equal(f.previews.has("road-snap"),false);
  }finally{f.close();}
});


test("snap hysteresis retains a vertex instead of oscillating between close targets",async()=>{
  const {roadSnapTarget,showRoadSnap}=await import("../src/composition/tabletop/tools/paths/road-body-target.ts");
  const f=fixture();
  try {
    for(const x of [-10,0,0.9,10])f.click(sample(x,0));f.finish();
    const first=roadSnapTarget(f.ctx,sample(0.35,0));
    assert.equal(first.point.x,0);
    assert.equal(roadSnapTarget(f.ctx,sample(0.55,0)).nodeId,first.nodeId);
    assert.notEqual(roadSnapTarget(f.ctx,sample(1.05,0)).nodeId,first.nodeId);
    showRoadSnap(f.ctx);
    assert.notEqual(roadSnapTarget(f.ctx,sample(0.55,0)).nodeId,first.nodeId);
  }finally{f.close();}
});

test("clicking a snapped edge confirms the displayed station and ends without Enter despite release jitter",()=>{
  const f=fixture();
  try {
    f.click(sample(-10,0));f.click(sample(10,0));f.finish();
    const face=f.runtime.getAllRegionTopologies()[0],a=sample(3,8);
    f.click(a,a,points);
    const hover={...sample(3,0.1),surfaceRef:surfaceRefFromNodeSet(face.surfaceKey)};
    tool.previewFor(gesture(hover,hover),points,f.ctx);
    const click={...hover,point:{x:3.2,y:0,z:0.1}},release={...hover,point:{x:3.4,y:0,z:0.1}};
    f.click(click,release,points);
    const graph=f.runtime.getGraphSnapshot();
    assert.ok(graph.nodes.some(n=>Math.abs(n.position.x-3)<0.01&&Math.abs(n.position.z)<0.01&&edges(f).filter(e=>e.startNodeId===n.id||e.endNodeId===n.id).length===3));
    assert.equal(tool.onKeyDown(f.ctx,"Enter",points),false);
    assert.equal(f.previews.has("road-points"),false);
    assert.equal(f.previews.has("road-snap"),false);
  }finally{f.close();}
});

test("projected snap near an endpoint reuses it instead of introducing a tiny span",()=>{
  const f=fixture();
  try {
    const wide={...points,bedWidth:3};
    f.click(sample(-10,0),sample(-10,0),wide);f.click(sample(10,0),sample(10,0),wide);f.finish();
    const end=edges(f)[0].endNodeId,face=f.runtime.getAllRegionTopologies()[0];
    f.click(sample(10,8));
    const hit={...sample(9.8,1),surfaceRef:surfaceRefFromNodeSet(face.surfaceKey)};
    f.click(hit);
    assert.equal(edges(f).length,2,JSON.stringify(f.calls.feedback));
    assert.equal(edges(f).filter(e=>e.startNodeId===end||e.endNodeId===end).length,2);
    assert.equal(tool.onKeyDown(f.ctx,"Enter",points),false);
  }finally{f.close();}
});

test("world-distance endpoint reuse does not snap five percent of a long road",async()=>{
  const {roadBodyTarget}=await import("../src/composition/tabletop/tools/paths/road-body-target.ts");
  const f=fixture();
  try {
    f.click(sample(0,0));f.click(sample(100,0));f.finish();
    const face=f.runtime.getAllRegionTopologies()[0];
    const target=roadBodyTarget(f.ctx,{...sample(3,0.1),surfaceRef:surfaceRefFromNodeSet(face.surfaceKey)});
    assert.ok(Math.abs(target.sample.point.x-3)<0.01);
  }finally{f.close();}
});


test("a snap whose target changes between press and release is rejected without modifying the draft road",()=>{
  const f=fixture();
  try {
    f.click(sample(-10,0));f.click(sample(0,0));f.click(sample(10,0));f.finish();
    f.click(sample(0,8));const b=sample(0.2,0.1),before=state(f);
    tool.previewFor(gesture(b,b),points,f.ctx);tool.onPointerDown(f.ctx,b,points);
    const original=f.runtime.getGraphSnapshot;
    f.runtime.getGraphSnapshot=()=>{const graph=original();return {...graph,nodes:graph.nodes.map(n=>n.position.x===0&&n.position.z===0?{...n,position:{...n.position,y:2}}:n)};};
    tool.onPointerUp(f.ctx,gesture(b,b),points);f.runtime.getGraphSnapshot=original;
    assert.deepEqual(state(f),before);
    assert.ok(f.calls.feedback.some(v=>v.tone==="error"&&v.message.includes("alvo de encaixe mudou")));
    assert.equal(f.previews.has("road-snap"),false);
  }finally{f.close();}
});

for(const shape of ["inclined","curved"]){
  test(`stable T junction into ${shape} road uses the displayed curve parameter`,()=>{
    const f=fixture();
    try {
      f.click(sample(-10,0));if(shape==="curved")f.click(sample(0,4));f.click(sample(10,shape==="inclined"?5:0));f.finish();
      const edge=edges(f)[0],curve=resolve(f,edge);
      const p=f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"split",curve,t:0.55}]})[0].curves[0].points[3];
      const face=f.runtime.getAllRegionTopologies()[0];
      f.click(sample(p[0],p[2]+8));
      const hit={point:{x:p[0],y:p[1],z:p[2]},surfaceRef:surfaceRefFromNodeSet(face.surfaceKey)};
      tool.previewFor(gesture(hit,hit),points,f.ctx);f.click(hit);
      assert.equal(f.calls.feedback.filter(v=>v.tone==="error").length,0,JSON.stringify(f.calls.feedback));
      assert.ok(f.runtime.getGraphSnapshot().nodes.some(n=>Math.hypot(n.position.x-p[0],n.position.z-p[2])<0.02&&edges(f).filter(e=>e.startNodeId===n.id||e.endNodeId===n.id).length===3));
      assert.equal(tool.onKeyDown(f.ctx,"Enter",points),false);
    }finally{f.close();}
  });
}
