import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { pathBrushTool as tool } from "../src/composition/tabletop/tools/paths/path-brush-tool.ts";
import { commitPathCloudIntent } from "../src/composition/tabletop/path/path-cloud-transaction.ts";
import { createPathBrushEffect, curveEdgesOf, curvePickId, curveWidthPickId, pathFormationFor, spineWidthHandles, structureTypeFor } from "../src/features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";
const sample=(x,z)=>({point:{x,y:0,z}});
const gesture=(a,b)=>({start:a,current:b,samples:[a,b]});
const params={...tool.defaultParams(),bedWidth:0.6};
const state=f=>JSON.parse(f.session.snapshot_json());
const edges=f=>f.runtime.getGraphSnapshot().edges.filter(e=>e.curve);
const degree=(f,id)=>edges(f).filter(e=>e.startNodeId===id||e.endNodeId===id).length;
const junctionAt=(f,x,z)=>f.runtime.getGraphSnapshot().nodes.find(n=>Math.hypot(n.position.x-x,n.position.z-z)<0.02&&degree(f,n.id)===3);
const errors=f=>f.calls.feedback.filter(v=>v?.tone==="error");
const closeCurves=(actual,expected,tolerance=1e-10)=>{assert.equal(actual.length,expected.length);actual.forEach((c,i)=>c.points.forEach((p,j)=>p.forEach((v,k)=>assert.ok(Math.abs(v-expected[i].points[j][k])<tolerance, `curve coordinate changed at ${i}/${j}/${k}: ${v} != ${expected[i].points[j][k]}`))));};
const bodyOf=(f,x,z)=>({...sample(x,z),surfaceRef:surfaceRefFromNodeSet(f.runtime.getAllRegionTopologies()[0].surfaceKey)});

function fixture() {
  const f=sessionFixture();f.previews=new Map();f.selected=undefined;
  f.ctx.reportSelection=value=>{f.selected=value;};
  f.runtime.showPreview=(d,c)=>f.previews.set(c,d);
  f.runtime.clearPreview=c=>f.previews.delete(c);
  f.runtime.getFootprintCoverage=()=>[];
  f.click=(a,b=a,p=params)=>{tool.onPointerDown(f.ctx,a,p);tool.onPointerUp(f.ctx,gesture(a,b),p);};
  f.drag=(a,b,p=params)=>{tool.onPointerDown(f.ctx,a,p);tool.onPointerMove(f.ctx,gesture(a,b),p);tool.onPointerUp(f.ctx,gesture(a,b),p);};
  f.end=()=>tool.onKeyDown(f.ctx,"Enter",params);
  f.close=()=>{tool.onCancel(f.ctx);f.session.free();};
  return f;
}
/** A road laid straight through the commit path, past any gesture -- the fixture a test edits. */
function lay(f,coordinates,p=params) {
  const curves=f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"automatic",points:coordinates}]})[0].curves;
  const effect=createPathBrushEffect({
    brushShape:{kind:"circle",radius:0.025},brushRegion:{samples:coordinates.map(([x,y,z])=>({x,y,z}))},
    authoredCurves:curves,curveMode:"automatic",parameters:pathFormationFor(p),
  },{operationId:`platform-test:road-lay:${f.ctx.nextSequence()}`,tableId:f.ctx.tableId,initiatedBy:"test"});
  assert.ok(commitPathCloudIntent(f.ctx,effect,0.025),JSON.stringify(f.calls.feedback));
}
function build(f) {lay(f,[[-10,0,0],[0,0,4],[10,0,0]]);}
function resolve(f,e) {
  const nodes=new Map(f.runtime.getGraphSnapshot().nodes.map(n=>[n.id,n.position]));
  const xyz=p=>[p.x,p.y,p.z];
  return f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"resolve",handles:e.curve,start:xyz(nodes.get(e.startNodeId)),end:xyz(nodes.get(e.endNodeId))}]})[0].curves[0];
}
function midpointOf(f,e) {
  const p=f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"split",curve:resolve(f,e),t:0.5}]})[0].curves[0].points[3];
  return {nodeId:curvePickId(e.edgeId,"midpoint"),point:{x:p[0],y:p[1],z:p[2]}};
}

for(const [name,coordinates,width] of [
  ["line",[[-8,0,0],[0,0,0],[8,0,0]],0.6],
  ["S",[[-8,0,-4],[-3,0,4],[3,0,-4],[8,0,4]],0.6],
  ["U",[[-4,0,0],[-4,0,6],[4,0,6],[4,0,0]],0.6],
  ["unequal spacing",[[-10,0,0],[-9.96,0,0.04],[0,0,4],[20,0,0]],0.6],
  ["elevation",[[-8,0,0],[0,5,4],[8,0,0]],0.6],
  ["short wide turn",[[0,0,0],[0.1,0,0.1],[0.2,0,0]],8],
]) test(`road stability matrix: ${name} preserves authorship and produces finite indexed meshes`,()=>{
  const f=fixture();
  try {
    lay(f,coordinates,{...params,bedWidth:width});
    assert.deepEqual(f.runtime.getGraphSnapshot().nodes.filter(n=>n.id.startsWith("spine:")).map(n=>n.position),coordinates.map(([x,y,z])=>({x,y,z})));
    assert.equal(edges(f).length,coordinates.length-1);
    const expected=f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"automatic",points:coordinates}]})[0].curves;
    closeCurves(edges(f).map(e=>resolve(f,e)),expected);
    const meshes=JSON.parse(f.session.all_surface_meshes_json());
    assert.ok(meshes.length>0);
    for(const mesh of meshes) {
      assert.ok(mesh.positions.length>0);
      assert.equal(mesh.positions.length%3,0);
      assert.ok(mesh.positions.every(Number.isFinite));
      assert.ok(mesh.indices.length>0);
      assert.equal(mesh.indices.length%3,0);
      assert.ok(mesh.indices.every(i=>Number.isInteger(i)&&i>=0&&i<mesh.positions.length/3));
    }
  } finally {f.close();}
});

test("a click sets an origin without laying anything; Esc drops it",()=>{
  const f=fixture();
  try {
    const before=state(f),a=sample(2,3);
    f.click(a);
    assert.deepEqual(state(f),before);
    assert.ok(f.previews.has("road-span"));
    tool.previewFor(gesture(sample(6,3),sample(6,3)),params,f.ctx);
    assert.ok(f.previews.has("road-draft-spine"),"the span to the pointer is previewed");
    assert.deepEqual(state(f),before);
    tool.onCancel(f.ctx);
    assert.equal(f.previews.size,0);
    assert.equal(f.end(),false,"no run is left waiting");
  }finally{f.close();}
});

test("click, click lays one straight span and carries the run on from its end, each span its own undo",()=>{
  const f=fixture();
  try {
    const before=state(f);
    f.click(sample(-10,0));f.click(sample(0,0));
    assert.equal(edges(f).length,1,JSON.stringify(f.calls.feedback));
    for(const p of resolve(f,edges(f)[0]).points)assert.ok(Math.abs(p[2])<1e-9,"a click-click span is straight");
    assert.ok(f.previews.has("road-span"),"the end waits as the next origin");
    const first=state(f);
    f.click(sample(0,8));
    assert.equal(edges(f).length,2,JSON.stringify(f.calls.feedback));
    const joint=f.runtime.getGraphSnapshot().nodes.find(n=>n.position.x===0&&n.position.z===0);
    assert.equal(degree(f,joint.id),2,"the run carries on from the shared end");
    assert.equal(f.end(),true);assert.equal(f.previews.size,0);assert.equal(f.end(),false);
    const after=state(f);
    f.session.undo_region_overlay("platform-test:road-span:2");assert.deepEqual(state(f),first);
    f.session.undo_region_overlay("platform-test:road-span:1");assert.deepEqual(state(f),before);
    f.session.redo_region_overlay("platform-test:road-span:1");f.session.redo_region_overlay("platform-test:road-span:2");
    assert.deepEqual(state(f),after);
  }finally{f.close();}
});

test("a duplicate click, Backspace, and a cancelled press lay nothing",()=>{
  const f=fixture();
  try {
    const before=state(f);
    f.click(sample(-10,0));f.click(sample(-10,0));
    assert.deepEqual(state(f),before);assert.ok(f.previews.has("road-span"));
    assert.equal(tool.onKeyDown(f.ctx,"Backspace",params),true);
    assert.equal(f.previews.size,0);
    tool.onPointerDown(f.ctx,sample(10,0),params);tool.onCancel(f.ctx);
    tool.onPointerUp(f.ctx,gesture(sample(10,0),sample(10,0)),params);
    assert.equal(f.end(),false);assert.deepEqual(state(f),before);assert.equal(f.previews.size,0);
  }finally{f.close();}
});

test("a span straight up lays nothing and keeps its origin; one too steep stops at the grade it can climb",()=>{
  const f=fixture();
  try {
    const before=state(f);
    f.click({point:{x:-4,y:0,z:0}});
    f.click({point:{x:-4,y:4,z:0}});
    assert.deepEqual(state(f),before);
    assert.equal(errors(f).length,0,"a limit is a stop, never an error");
    assert.ok(f.previews.has("road-span"),"the origin still waits");
    f.click({point:{x:4,y:4,z:0}});
    assert.equal(edges(f).length,1);
    const end=f.runtime.getGraphSnapshot().nodes.find(n=>n.id.startsWith("spine:")&&n.position.x===4);
    assert.ok(Math.abs(end.position.y-1.6)<1e-6,`8 m climbs 1.6 m at 20 %, not 4 m: ${end.position.y}`);
  } finally {f.close();}
});

test("a span aimed at a road higher than the grade reaches stops short and does not join it",()=>{
  const f=fixture();
  try {
    lay(f,[[0,4,10],[10,4,10]]);
    f.click(sample(-3,10));f.click({...bodyOf(f,0.1,10),point:{x:0,y:4,z:10}});f.end();
    assert.equal(errors(f).length,0,JSON.stringify(f.calls.feedback));
    const ys=f.runtime.getAllRegionTopologies().flatMap(t=>t.nodes.map(n=>n.position.y));
    assert.ok(Math.max(...ys)<=4+1e-6,"nothing climbs past the higher road");
    assert.equal(f.runtime.getGraphSnapshot().nodes.filter(n=>n.id.startsWith("spine:")&&Math.hypot(n.position.x,n.position.z-10)<0.02).length,2,"3 m cannot climb 4 m: the new road stops short at 0.6 m, not joined");
  } finally {f.close();}
});

test("a freehand loop is cut out and a tight scribble eased to the road's width",()=>{
  const f=fixture();
  try {
    const wide={...params,bedWidth:3};
    const loop=[...Array.from({length:21},(_,i)=>sample(i*0.5,0)),...Array.from({length:31},(_,i)=>{const a=-Math.PI/2+2*Math.PI*i/30;return sample(10+2*Math.cos(a),2+2*Math.sin(a));}),...Array.from({length:21},(_,i)=>sample(10+i*0.5,0))];
    const g={start:loop[0],current:loop.at(-1),samples:loop};
    tool.onPointerDown(f.ctx,g.start,wide);tool.onPointerMove(f.ctx,g,wide);tool.onPointerUp(f.ctx,g,wide);
    assert.equal(errors(f).length,0,JSON.stringify(f.calls.feedback));
    assert.ok(f.runtime.getGraphSnapshot().nodes.filter(n=>n.id.startsWith("spine:")).every(n=>n.position.z<1),"the loop drawn above the line is gone");
    for(const e of edges(f))for(const p of resolve(f,e).points)assert.ok(p[2]<1);
  } finally {f.close();}
});

test("a refused span keeps its origin for a retry",()=>{
  const f=fixture();
  try {
    f.click(sample(-10,0));const before=state(f);
    const apply=f.runtime.applyPatchReplacement;
    f.runtime.applyPatchReplacement=r=>{apply(r);throw Error("simulated failure");};
    f.click(sample(10,0));assert.deepEqual(state(f),before);assert.ok(f.previews.has("road-span"));
    f.runtime.applyPatchReplacement=apply;f.click(sample(10,0));assert.equal(edges(f).length,1);
  }finally{f.close();}
});

test("a waiting origin never takes a handle: dragging the midpoint bends the road and drops the origin",()=>{
  const f=fixture();
  try {
    lay(f,[[-10,0,0],[10,0,0]]);
    f.click(bodyOf(f,-3,0.1));
    assert.ok(f.previews.has("road-span"),"a click on the body waits as an origin");
    const a=midpointOf(f,edges(f)[0]);
    f.drag(a,sample(0,4));
    assert.equal(edges(f).length,1,"no new spine is drawn from the waiting origin");
    assert.ok(resolve(f,edges(f)[0]).points.some(p=>p[2]>1),"the handle bent the road");
    assert.equal(f.previews.has("road-span"),false);
    assert.equal(f.end(),false);
  }finally{f.close();}
});

test("a drag drops a waiting straight origin and draws its own stroke",()=>{
  const f=fixture();
  try {
    f.click(sample(-10,8));
    const a=sample(-10,0),b=sample(0,3),c=sample(10,0);
    tool.onPointerDown(f.ctx,a,params);tool.onPointerMove(f.ctx,{start:a,current:b,samples:[a,b]},params);
    assert.equal(f.previews.has("road-span"),false);
    tool.onPointerUp(f.ctx,{start:a,current:c,samples:[a,b,c]},params);
    assert.ok(edges(f).length>0,JSON.stringify(f.calls.feedback));
    assert.ok(f.runtime.getGraphSnapshot().nodes.every(n=>n.position.z<7),"nothing starts at the dropped origin");
    assert.equal(f.end(),false);
  }finally{f.close();}
});

test("the panel only sets up the next road; standing roads keep their width",()=>{
  const f=fixture();
  try {
    lay(f,[[-10,0,0],[10,0,0]]);const before=state(f);
    const wide={...params,bedWidth:5};
    tool.onParamsChange(f.ctx,wide,params);
    assert.deepEqual(state(f),before);
    f.click(sample(-10,8),sample(-10,8),wide);f.click(sample(10,8),sample(10,8),wide);
    const added=edges(f).find(e=>f.runtime.getGraphSnapshot().nodes.find(n=>n.id===e.startNodeId).position.z===8);
    assert.equal(added.curve.bandOffsets.at(-1)-added.curve.bandOffsets[0],5);
  }finally{f.close();}
});

test("a span's width handle widens that span alone, in one reversible transaction",()=>{
  const f=fixture();
  try {
    lay(f,[[-10,0,0],[0,0,0],[10,0,0]]);
    const graph=f.runtime.getGraphSnapshot(),span=edges(f)[0],other=edges(f)[1];
    const handle=spineWidthHandles(curveEdgesOf(graph,[],f.runtime),graph,f.runtime,(t)=>structureTypeFor(t)?.spine?.defaultOffsets).find(h=>h.id===curveWidthPickId(span.edgeId));
    assert.ok(handle,"every span shows a width handle");
    const mid=midpointOf(f,span).point;
    assert.ok(Math.abs(Math.hypot(handle.position.x-mid.x,handle.position.z-mid.z)-0.3)<1e-6,"it stands on the band's edge");
    const before=state(f),out={x:(handle.position.x-mid.x)/0.3,z:(handle.position.z-mid.z)/0.3};
    const a={nodeId:handle.id,point:handle.position},b={point:{x:mid.x+out.x,y:0,z:mid.z+out.z}};
    tool.onPointerDown(f.ctx,a,params);tool.onPointerMove(f.ctx,gesture(a,b),params);
    assert.deepEqual(state(f),before,"dragging only previews");
    tool.onPointerUp(f.ctx,gesture(a,b),params);
    assert.equal(errors(f).length,0,JSON.stringify(f.calls.feedback));
    const widened=edges(f).find(e=>e.edgeId===span.edgeId);
    assert.equal(widened.curve.bandOffsets.at(-1)-widened.curve.bandOffsets[0],2);
    assert.deepEqual(edges(f).find(e=>e.edgeId===other.edgeId).curve.bandOffsets,other.curve.bandOffsets);
    const after=state(f);
    f.session.undo_region_overlay("curve-edit:2");assert.deepEqual(state(f),before);
    f.session.redo_region_overlay("curve-edit:2");assert.deepEqual(state(f),after);
  }finally{f.close();}
});

test("an automatic road reinterpolates moved anchors, with reversible automatic policy",()=>{
  const f=fixture();
  try {
    build(f);
    const before=state(f), id=edges(f)[0].endNodeId;
    assert.ok(edges(f).every(e=>e.curve.mode==="automatic"));
    const a={...sample(0,4),nodeId:id}, b=sample(1,6);
    tool.onPointerDown(f.ctx,a,params);tool.onPointerUp(f.ctx,gesture(a,b),params);
    const expected=f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"automatic",points:[[-10,0,0],[1,0,6],[10,0,0]]}]})[0].curves;
    closeCurves(edges(f).map(e=>resolve(f,e)),expected);
    assert.ok(edges(f).every(e=>e.curve.mode==="automatic"));
    const after=state(f);
    f.session.undo_region_overlay("curve-edit:2");assert.deepEqual(state(f),before);
    f.session.redo_region_overlay("curve-edit:2");assert.deepEqual(state(f),after);
  } finally {f.close();}
});

test("a freehand road keeps explicit controls",()=>{
  const f=fixture();
  try {
    const a=sample(-10,0),b=sample(0,4),c=sample(10,0);
    tool.onPointerDown(f.ctx,a,params);
    tool.onPointerMove(f.ctx,{start:a,current:b,samples:[a,b]},params);
    tool.onPointerUp(f.ctx,{start:a,current:c,samples:[a,b,c]},params);
    assert.ok(edges(f).length>0);
    assert.ok(edges(f).every(e=>e.curve.mode==="free"));
  } finally {f.close();}
});

test("editing one road preserves every node, edge and control of a disconnected road",()=>{
  const f=fixture();
  try {
    build(f);
    const editedId=edges(f)[0].endNodeId;
    lay(f,[[90,4,0],[100,5,4],[110,4,0]]);
    const untouched=graph=>{
      const nodes=graph.nodes.filter(n=>n.position.x>70);
      const ids=new Set(nodes.map(n=>n.id));
      return {nodes,edges:graph.edges.filter(e=>ids.has(e.startNodeId)||ids.has(e.endNodeId))};
    };
    const before=state(f),other=untouched(f.runtime.getGraphSnapshot());
    const a={...sample(0,4),nodeId:editedId},b=sample(1,6);
    tool.onPointerDown(f.ctx,a,params);
    tool.onPointerUp(f.ctx,gesture(a,b),params);
    assert.notDeepEqual(state(f),before);
    assert.deepEqual(untouched(f.runtime.getGraphSnapshot()),other);
    assert.equal(errors(f).length,0);
  } finally {f.close();}
});
test("same road tool: anchor drag uses last sample, preserves grab offset and regenerates road",()=>{
  const f=fixture();
  try {
    build(f);
    const e=edges(f)[0],id=e.endNodeId,before=state(f);
    const surfaces=JSON.stringify(f.runtime.getAllRegionTopologies());
    const a={...sample(0.1,4.1),nodeId:id};
    tool.onPointerDown(f.ctx,a,params);
    const end=sample(1.1,6.1);
    const boolean=f.runtime.planarBoolean;
    f.runtime.planarBoolean=()=>{throw Error("preview regenerated a surface");};
    tool.onPointerMove(f.ctx,gesture(a,end),params);
    assert.ok(f.previews.has("curve-edit"));assert.deepEqual(state(f),before);
    f.runtime.planarBoolean=boolean;
    tool.onPointerUp(f.ctx,gesture(a,end),params);
    const p=f.runtime.getGraphSnapshot().nodes.find(n=>n.id===id).position;
    assert.ok(Math.abs(p.x-1)<1e-9 && Math.abs(p.z-6)<1e-9);
    assert.notEqual(JSON.stringify(f.runtime.getAllRegionTopologies()),surfaces);
    assert.equal(edges(f).length,2);
    const after=state(f);tool.onPointerUp(f.ctx,gesture(a,end),params);assert.deepEqual(state(f),after);
    f.session.undo_region_overlay("curve-edit:2");assert.deepEqual(state(f),before);
    f.session.redo_region_overlay("curve-edit:2");assert.deepEqual(state(f),after);
  }finally{f.close();}
});
test("road point drag: cancellation, click and out-and-back preserve graph",()=>{
  const f=fixture();
  try {
    build(f);const id=edges(f)[0].startNodeId,a={...sample(-10,0),nodeId:id},end=sample(-10,3),before=state(f);
    tool.onPointerDown(f.ctx,a,params);tool.onPointerMove(f.ctx,gesture(a,end),params);tool.onCancel(f.ctx);
    tool.onPointerUp(f.ctx,gesture(a,end),params);assert.deepEqual(state(f),before);
    f.click(a);assert.deepEqual(state(f),before);
    tool.onPointerDown(f.ctx,a,params);tool.onPointerMove(f.ctx,gesture(a,end),params);tool.onPointerUp(f.ctx,gesture(a,a),params);
    assert.deepEqual(state(f),before);
  }finally{f.close();}
});
test("a midpoint click only selects; a double-click inserts a point without changing the curve, and it can be removed",()=>{
  const f=fixture();
  try {
    build(f);const original=edges(f)[0],curve=resolve(f,original),before=state(f);
    const half=f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"split",curve,t:0.5}]})[0].curves;
    const mid=midpointOf(f,original);
    f.click(mid);
    assert.deepEqual(state(f),before,"one click is not an insertion");
    assert.equal(f.selected?.id,mid.nodeId);
    f.click(mid);
    assert.equal(edges(f).length,3,JSON.stringify(f.calls.feedback));
    const split=edges(f).filter(e=>e.edgeId===original.edgeId||e.edgeId.startsWith(original.edgeId+":split:"));
    closeCurves(split.map(e=>resolve(f,e)),half);
    const id=split[0].endNodeId,p=f.runtime.getGraphSnapshot().nodes.find(n=>n.id===id).position;
    f.click({point:p,nodeId:id});
    assert.equal(tool.onKeyDown(f.ctx,"Delete",params),true);
    assert.equal(edges(f).length,2,JSON.stringify(f.calls.feedback));
    assert.ok(edges(f).every(e=>e.startNodeId!==id&&e.endNodeId!==id));
  }finally{f.close();}
});
test("clicks on two different midpoints never insert",()=>{
  const f=fixture();
  try {
    build(f);const before=state(f);
    f.click(midpointOf(f,edges(f)[0]));f.click(midpointOf(f,edges(f)[1]));
    assert.deepEqual(state(f),before);
  }finally{f.close();}
});
test("road deletion: removes a deliberate bend; endpoint deletion fails without altering road",()=>{
  const f=fixture();
  try {
    build(f);const id=edges(f)[0].endNodeId,p=f.runtime.getGraphSnapshot().nodes.find(n=>n.id===id).position;
    f.click({point:p,nodeId:id});const before=state(f);
    tool.onKeyDown(f.ctx,"Delete",params);assert.equal(edges(f).length,1,JSON.stringify(f.calls.feedback));assert.notDeepEqual(state(f),before);
    const end=edges(f)[0].startNodeId,pos=f.runtime.getGraphSnapshot().nodes.find(n=>n.id===end).position;
    f.click({point:pos,nodeId:end});const kept=state(f);
    tool.onKeyDown(f.ctx,"Delete",params);assert.deepEqual(state(f),kept);assert.ok(errors(f).length>0);
  }finally{f.close();}
});

test("pressing a road's body never edits it: a drag there branches instead of bending it",()=>{
  const f=fixture();
  try {
    lay(f,[[-10,0,0],[10,0,0]]);const original=resolve(f,edges(f)[0]);
    f.drag(bodyOf(f,-4,0.1),sample(-4,9));
    assert.equal(errors(f).length,0,JSON.stringify(f.calls.feedback));
    assert.ok(junctionAt(f,-4,0),"the drag began a branch at the pressed point");
    for(const e of edges(f).filter(e=>Math.abs(resolve(f,e).points[3][2])<1e-9&&Math.abs(resolve(f,e).points[0][2])<1e-9))
      for(const p of resolve(f,e).points)assert.ok(Math.abs(p[2])<1e-9,"the standing road keeps its line");
    assert.ok(original.points.every(p=>Math.abs(p[2])<1e-9));
  }finally{f.close();}
});
test("freehand road: a stroke commits once on release, a cancelled one never, with undo",()=>{
  const f=fixture();
  try {
    const before=state(f),a=sample(-10,0),b=sample(0,4),c=sample(10,0),g={start:a,current:c,samples:[a,b,c]};
    tool.onPointerDown(f.ctx,a,params);tool.onPointerMove(f.ctx,g,params);
    assert.ok(f.previews.has("road-stroke"));assert.deepEqual(state(f),before);
    tool.onCancel(f.ctx);tool.onPointerUp(f.ctx,g,params);assert.deepEqual(state(f),before);
    tool.onPointerDown(f.ctx,a,params);tool.onPointerUp(f.ctx,g,params);
    assert.ok(edges(f).length,JSON.stringify(f.calls.feedback));
    const after=state(f);tool.onPointerUp(f.ctx,g,params);assert.deepEqual(state(f),after);
    f.session.undo_region_overlay("platform-test:road-stroke:1");assert.deepEqual(state(f),before);
    f.session.redo_region_overlay("platform-test:road-stroke:1");assert.deepEqual(state(f),after);
  }finally{f.close();}
});
test("freehand road: failed final conversion never commits a stale preview",()=>{
  const f=fixture();
  try {
    const a=sample(-10,0),b=sample(10,0),g=gesture(a,b),before=state(f);
    tool.onPointerDown(f.ctx,a,params);tool.onPointerMove(f.ctx,g,params);assert.ok(f.previews.has("road-stroke"));
    f.runtime.curveBatch=()=>{throw Error("invalid final sample");};
    tool.onPointerUp(f.ctx,g,params);assert.deepEqual(state(f),before);assert.equal(f.previews.has("road-stroke"),false);
  }finally{f.close();}
});

test("road endpoint deletion shortens a path; midpoint dragging never inserts by accident",()=>{
  const f=fixture();
  try {
    build(f);const e=edges(f)[0],mid={...midpointOf(f,e),point:sample(-5,2).point},before=state(f);
    f.click(mid,sample(-5,8));assert.notDeepEqual(state(f),before);assert.equal(edges(f).length,2);
    const id=e.startNodeId,p=f.runtime.getGraphSnapshot().nodes.find(n=>n.id===id).position;
    f.click({point:p,nodeId:id});tool.onKeyDown(f.ctx,"Delete",params);
    assert.equal(edges(f).length,1,JSON.stringify(f.calls.feedback));
    assert.ok(edges(f).every(e=>e.startNodeId!==id&&e.endNodeId!==id));
    assert.ok(f.runtime.getAllRegionTopologies().length);
  }finally{f.close();}
});

test("freehand road uses brush margin and commits the preview's interpreted spine",()=>{
  const f=fixture();
  try {
    const wide={...params,radius:2.5,bedWidth:3};
    const samples=Array.from({length:161},(_,i)=>{const t=i/160;return sample(20*t,4*Math.sin(Math.PI*t)+0.15*Math.sin(32*Math.PI*t));});
    const g={start:samples[0],current:samples.at(-1),samples};
    const interpreted=[];const original=f.runtime.curveBatch;
    f.runtime.curveBatch=request=>{const result=original(request);if(request.commands[0]?.kind==="interpretStroke")interpreted.push({request,result});return result;};
    tool.onPointerDown(f.ctx,g.start,wide);tool.onPointerMove(f.ctx,g,wide);
    assert.equal(interpreted[0].request.commands[0].correction,1);
    assert.ok(interpreted[0].result[0].curves.length<10,"hand wobble must not create dozens of spines");
    tool.onPointerUp(f.ctx,g,wide);
    assert.equal(errors(f).length,0,JSON.stringify(f.calls.feedback));
    closeCurves(interpreted[1].result[0].curves,interpreted[0].result[0].curves);
    // Graph node positions are stored as f32; handle reconstruction inherits that precision.
    closeCurves(edges(f).map(e=>resolve(f,e)),interpreted[0].result[0].curves,2e-6);
  }finally{f.close();}
});


test("scene gizmo raises a road anchor and direct editing fits to surface height while tangent handles retain elevation",async()=>{
  const {beginCurveGesture}=await import("../src/composition/tabletop/tools/core/curve-edit-gesture.ts");
  const f=fixture();
  try {
    build(f);
    const edge=edges(f)[0];
    const id=edge.endNodeId;
    const node=()=>f.runtime.getGraphSnapshot().nodes.find(n=>n.id===id);
    const start={nodeId:id,point:node().position};
    const raised={nodeId:id,point:{...start.point,y:3}};
    const edit=beginCurveGesture(f.ctx,start,{mode:"shape",insertOnClick:false,spatialTarget:true});
    edit.move(gesture(start,raised));edit.commit();
    assert.equal(node().position.y,3,JSON.stringify(f.calls.feedback));
    const above={nodeId:id,point:node().position};
    const direct=beginCurveGesture(f.ctx,above,{mode:"shape",insertOnClick:false});
    direct.move(gesture(above,{point:{x:above.point.x+1,y:1.5,z:above.point.z}}));direct.commit();
    assert.equal(node().position.y,1.5,"direct dragging must fit to surface elevation");
    assert.equal(node().position.x,above.point.x+1);

    // Tangent handle direct editing preserves elevation rather than collapsing to surface
    const handlePick={nodeId:`bezier-handle:1:${encodeURIComponent(edge.edgeId)}`,point:{x:above.point.x,y:3,z:above.point.z}};
    const handleEdit=beginCurveGesture(f.ctx,handlePick,{mode:"shape",insertOnClick:false});
    assert.ok(handleEdit,"tangent handle gesture should be created");
  }finally{f.close();}
});

test("a wide road's freehand stroke keeps a few anchors, never one per sample",()=>{
  const f=fixture();
  try {
    const wide={...params,bedWidth:8};
    const samples=Array.from({length:301},(_,i)=>{const t=i/300;return {...sample(40*t+0.02*Math.sin(97*i),6*Math.sin(Math.PI*t)),screenX:800*t,screenY:120*Math.sin(Math.PI*t)};});
    const g={start:samples[0],current:samples.at(-1),samples};
    tool.onPointerDown(f.ctx,g.start,wide);tool.onPointerMove(f.ctx,g,wide);tool.onPointerUp(f.ctx,g,wide);
    assert.ok(edges(f).length>0&&edges(f).length<=3,`${edges(f).length} spans`);
  }finally{f.close();}
});

test("freehand road keeps a hill between its ends, held to the road's grade",()=>{
  const f=fixture();
  try {
    const samples=Array.from({length:41},(_,i)=>{const t=i/40;return {point:{x:20*t,y:12*t*(1-t),z:0}};});
    const g={start:samples[0],current:samples.at(-1),samples};
    tool.onPointerDown(f.ctx,g.start,params);tool.onPointerUp(f.ctx,g,params);
    assert.equal(edges(f).length,1,JSON.stringify(f.calls.feedback));
    const c=resolve(f,edges(f)[0]);
    const middle=f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"split",curve:c,t:0.5}]})[0].curves[0].points[3];
    assert.ok(middle[1]>1.5&&middle[1]<=2+1e-5,`a 3 m hill 10 m from each end is climbed at 20 %: ${middle[1]}`);
    assert.ok(f.runtime.getAllRegionTopologies().some(t=>t.nodes.some(n=>n.position.y>1.5)),"the generated surface keeps the rise too");
  }finally{f.close();}
});

for(const way of ["click","drag"])for(const originKind of ["vertex","edge"]){
  test(`a ${way} begun on a road's ${originKind} branches from it, connected and reversible`,()=>{
    const f=fixture();
    try {
      lay(f,originKind==="vertex"?[[-10,0,0],[0,0,0],[10,0,0]]:[[-10,0,0],[10,0,0]]);
      const x=originKind==="vertex"?0:3;
      const origin=originKind==="vertex"?bodyOf(f,0.2,0.1):bodyOf(f,3,0.1);
      const before=state(f);
      if(way==="click"){f.click(origin);f.click(sample(x,8));f.end();}
      else f.drag(origin,sample(x,8));
      assert.equal(errors(f).length,0,JSON.stringify(f.calls.feedback));
      assert.ok(junctionAt(f,x,0),"branch must share a degree-three spine junction, not merely overlap visually");
      assert.equal(edges(f).length,3);
      const after=state(f),id=`platform-test:road-${way==="click"?"span":"stroke"}:2`;
      f.session.undo_region_overlay(id);assert.deepEqual(state(f),before);
      f.session.redo_region_overlay(id);assert.deepEqual(state(f),after);
    }finally{f.close();}
  });
}

test("a click on a road's end runs the road on from it",()=>{
  const f=fixture();
  try {
    lay(f,[[-10,0,0],[10,0,0]]);const end=edges(f)[0].endNodeId;
    f.click(bodyOf(f,9.8,0.1));f.click(sample(10,8));f.end();
    assert.equal(errors(f).length,0,JSON.stringify(f.calls.feedback));
    assert.equal(edges(f).length,2);
    assert.equal(degree(f,end),2);
  }finally{f.close();}
});

test("cancelling a branch from an edge does not split the standing road",()=>{
  const f=fixture();
  try {
    lay(f,[[-10,0,0],[10,0,0]]);
    const before=state(f),a=bodyOf(f,3,0),b=sample(3,8),g=gesture(a,b);
    tool.onPointerDown(f.ctx,a,params);tool.onPointerMove(f.ctx,g,params);
    assert.deepEqual(state(f),before);tool.onCancel(f.ctx);tool.onPointerUp(f.ctx,g,params);assert.deepEqual(state(f),before);
  }finally{f.close();}
});

test("midpoint curvature drag previews transiently, cancels, and undoes without adding vertices",()=>{
  const f=fixture();
  try {
    lay(f,[[-10,0,0],[10,0,0]]);
    const before=state(f),a=midpointOf(f,edges(f)[0]),b=sample(0,4),g=gesture(a,b);
    tool.onPointerDown(f.ctx,a,params);tool.onPointerMove(f.ctx,g,params);
    assert.deepEqual(state(f),before);tool.onCancel(f.ctx);tool.onPointerUp(f.ctx,g,params);assert.deepEqual(state(f),before);
    f.click(a,b);assert.equal(edges(f).length,1);assert.notDeepEqual(state(f),before);
    assert.ok(resolve(f,edges(f)[0]).points.some(p=>p[2]>1));
    const after=state(f);f.session.undo_region_overlay("curve-edit:3");assert.deepEqual(state(f),before);
    f.session.redo_region_overlay("curve-edit:3");assert.deepEqual(state(f),after);
  }finally{f.close();}
});

for(const way of ["click","drag"])for(const destination of ["vertex","edge"]){
  test(`snap to ${destination} while drawing by ${way} commits the highlighted junction`,()=>{
    const f=fixture();
    try {
      lay(f,[[-10,0,0],[0,0,0],[10,0,0]]);
      const x=destination==="vertex"?0:3;
      const a=sample(x,8),b=destination==="vertex"?sample(0.3,0.25):bodyOf(f,x,0.1);
      const before=state(f);
      if(way==="click"){
        f.click(a);tool.previewFor(gesture(b,b),params,f.ctx);
        assert.ok(f.previews.has("road-snap"));assert.deepEqual(state(f),before);
        f.click(b);
      }else{
        tool.onPointerDown(f.ctx,a,params);tool.onPointerMove(f.ctx,gesture(a,b),params);
        assert.ok(f.previews.has("road-snap"));assert.deepEqual(state(f),before);
        tool.onPointerUp(f.ctx,gesture(a,b),params);
      }
      assert.equal(errors(f).length,0,JSON.stringify(f.calls.feedback));
      assert.ok(junctionAt(f,x,0));
      assert.equal(f.previews.has("road-snap"),false);
      assert.equal(f.end(),false,"joining a standing road ends the run");
    }finally{f.close();}
  });
}

test("snap respects height separation and clears its helper when the pointer leaves the target",async()=>{
  const {roadSnapTarget}=await import("../src/composition/tabletop/tools/paths/road-body-target.ts");
  const f=fixture();
  try {
    lay(f,[[-10,0,0],[0,0,0],[10,0,0]]);
    assert.equal(roadSnapTarget(f.ctx,{point:{x:0,y:3,z:0}}),undefined);
    const a=sample(0,8),near=sample(0.2,0.1),far=sample(0,5);
    f.click(a);tool.previewFor(gesture(near,near),params,f.ctx);assert.ok(f.previews.has("road-snap"));
    tool.previewFor(gesture(far,far),params,f.ctx);assert.equal(f.previews.has("road-snap"),false);
    tool.previewFor(gesture(near,near),params,f.ctx);tool.onCancel(f.ctx);assert.equal(f.previews.has("road-snap"),false);
  }finally{f.close();}
});


test("snap hysteresis retains a vertex instead of oscillating between close targets",async()=>{
  const {roadSnapTarget,showRoadSnap}=await import("../src/composition/tabletop/tools/paths/road-body-target.ts");
  const f=fixture();
  try {
    lay(f,[[-10,0,0],[0,0,0],[0.9,0,0],[10,0,0]]);
    const first=roadSnapTarget(f.ctx,sample(0.35,0));
    assert.equal(first.point.x,0);
    assert.equal(roadSnapTarget(f.ctx,sample(0.55,0)).nodeId,first.nodeId);
    assert.notEqual(roadSnapTarget(f.ctx,sample(1.05,0)).nodeId,first.nodeId);
    showRoadSnap(f.ctx);
    assert.notEqual(roadSnapTarget(f.ctx,sample(0.55,0)).nodeId,first.nodeId);
  }finally{f.close();}
});

test("clicking a snapped edge confirms the displayed station and ends the run despite release jitter",()=>{
  const f=fixture();
  try {
    lay(f,[[-10,0,0],[10,0,0]]);
    const a=sample(3,8);
    f.click(a);
    const hover=bodyOf(f,3,0.1);
    tool.previewFor(gesture(hover,hover),params,f.ctx);
    const click={...hover,point:{x:3.2,y:0,z:0.1}},release={...hover,point:{x:3.3,y:0,z:0.1}};
    f.click(click,release);
    assert.ok(junctionAt(f,3,0));
    assert.equal(f.end(),false);
    assert.equal(f.previews.has("road-span"),false);
    assert.equal(f.previews.has("road-snap"),false);
  }finally{f.close();}
});

test("projected snap near an endpoint reuses it instead of introducing a tiny span",()=>{
  const f=fixture();
  try {
    lay(f,[[-10,0,0],[10,0,0]],{...params,bedWidth:3});
    const end=edges(f)[0].endNodeId;
    f.click(sample(10,8));
    f.click(bodyOf(f,9.8,1));
    assert.equal(edges(f).length,2,JSON.stringify(f.calls.feedback));
    assert.equal(degree(f,end),2);
    assert.equal(f.end(),false);
  }finally{f.close();}
});

test("world-distance endpoint reuse does not snap five percent of a long road",async()=>{
  const {spineBodyTarget}=await import("../src/composition/tabletop/tools/core/spine-body-target.ts");
  const f=fixture();
  try {
    lay(f,[[0,0,0],[100,0,0]]);
    const target=spineBodyTarget(f.ctx,bodyOf(f,3,0.1));
    assert.ok(Math.abs(target.sample.point.x-3)<0.01);
  }finally{f.close();}
});


test("a snap whose target changes between press and release is rejected without modifying the road",()=>{
  const f=fixture();
  try {
    lay(f,[[-10,0,0],[0,0,0],[10,0,0]]);
    f.click(sample(0,8));const b=sample(0.2,0.1),before=state(f);
    tool.previewFor(gesture(b,b),params,f.ctx);tool.onPointerDown(f.ctx,b,params);
    const original=f.runtime.getGraphSnapshot;
    f.runtime.getGraphSnapshot=()=>{const graph=original();return {...graph,nodes:graph.nodes.map(n=>n.position.x===0&&n.position.z===0?{...n,position:{...n.position,y:2}}:n)};};
    tool.onPointerUp(f.ctx,gesture(b,b),params);f.runtime.getGraphSnapshot=original;
    assert.deepEqual(state(f),before);
    assert.ok(errors(f).some(v=>v.message.includes("alvo de encaixe mudou")));
    assert.equal(f.previews.has("road-snap"),false);
  }finally{f.close();}
});

for(const shape of ["inclined","curved"]){
  test(`stable T junction into ${shape} road uses the displayed curve parameter`,()=>{
    const f=fixture();
    try {
      lay(f,shape==="curved"?[[-10,0,0],[0,0,4],[10,0,0]]:[[-10,0,0],[10,0,5]]);
      const edge=edges(f)[0],curve=resolve(f,edge);
      const p=f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"split",curve,t:0.55}]})[0].curves[0].points[3];
      f.click(sample(p[0],p[2]+8));
      const hit={...bodyOf(f,p[0],p[2]),point:{x:p[0],y:p[1],z:p[2]}};
      tool.previewFor(gesture(hit,hit),params,f.ctx);f.click(hit);
      assert.equal(errors(f).length,0,JSON.stringify(f.calls.feedback));
      assert.ok(f.runtime.getGraphSnapshot().nodes.some(n=>Math.hypot(n.position.x-p[0],n.position.z-p[2])<0.02&&degree(f,n.id)===3));
      assert.equal(f.end(),false);
    }finally{f.close();}
  });
}

test("dragging a spine vertex onto its direct neighbor collapses the edge and prunes the redundant vertex", () => {
  const f = fixture();
  try {
    lay(f, [[-10, 0, 0], [0, 0, 0], [10, 0, 0]]);
    assert.equal(edges(f).length, 2);
    const middleNodeId = edges(f)[0].endNodeId;
    tool.onPointerDown(f.ctx, { ...sample(0, 0), nodeId: middleNodeId }, params);
    tool.onPointerMove(f.ctx, gesture(sample(0, 0), sample(10, 0)), params);
    tool.onPointerUp(f.ctx, gesture(sample(0, 0), sample(10, 0)), params);
    assert.equal(errors(f).length, 0, JSON.stringify(f.calls.feedback));
    assert.equal(edges(f).length, 1, "direct edge must be collapsed into one remaining edge");
    const graph = f.runtime.getGraphSnapshot();
    assert.equal(graph.nodes.some(n => n.id === middleNodeId), false, "collapsed node must be pruned from graph");
  } finally { f.close(); }
});

test("dragging an endpoint onto another road's vertex welds the two roads into a shared junction", () => {
  const f = fixture();
  try {
    lay(f, [[-10, 0, 0], [10, 0, 0]]);
    assert.equal(edges(f).length, 1);
    const targetNode = f.runtime.getGraphSnapshot().nodes.find(n => n.id.startsWith("spine:") && Math.abs(n.position.x - 10) < 0.01);

    lay(f, [[0, 0, 8], [0, 0, 4]]);
    assert.equal(edges(f).length, 2);
    const road2End = f.runtime.getGraphSnapshot().nodes.find(n => n.id.startsWith("spine:") && Math.abs(n.position.z - 4) < 0.01);

    tool.onPointerDown(f.ctx, { ...sample(0, 4), nodeId: road2End.id }, params);
    tool.onPointerMove(f.ctx, gesture(sample(0, 4), sample(10, 0)), params);
    tool.onPointerUp(f.ctx, gesture(sample(0, 4), sample(10, 0)), params);
    assert.equal(errors(f).length, 0, JSON.stringify(f.calls.feedback));
    const graph = f.runtime.getGraphSnapshot();
    assert.equal(degree(f, targetNode.id), 2, "both roads must now meet at the shared junction node");
    assert.equal(graph.nodes.some(n => n.id === road2End.id), false, "welded endpoint is absorbed by the target node");
  } finally { f.close(); }
});
