import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { pathPenTool } from "../src/composition/tabletop/tools/paths/path-pen-tool.ts";
import { beginCurveGesture } from "../src/composition/tabletop/tools/core/curve-edit-gesture.ts";
import { curvePickId } from "../src/features/edit-construction/index.ts";
const sample=(x,z)=>({point:{x,y:0,z}});
const gesture=(a,b)=>({start:a,current:b,samples:[a,b]});
const params={...pathPenTool.defaultParams(),creationMode:"pen",bedWidth:0.6};
function fixture() {
  const f=sessionFixture();f.previews=new Map();
  f.runtime.showPreview=(d,c)=>f.previews.set(c,d);
  f.runtime.clearPreview=c=>f.previews.delete(c);
  f.runtime.getFootprintCoverage=()=>[];
  f.place=(a,b=a)=>{pathPenTool.onPointerDown(f.ctx,a,params);pathPenTool.onPointerUp(f.ctx,gesture(a,b),params);};
  return f;
}
test("real WASM pen: draft is transient, authored controls survive one undoable confirmation",()=>{
  const f=fixture();
  try {
    const before=JSON.parse(f.session.snapshot_json());
    f.place(sample(-10,0),sample(-6,3));f.place(sample(10,0),sample(14,-3));
    assert.deepEqual(JSON.parse(f.session.snapshot_json()),before);
    assert.ok(f.previews.has("curve-pen"));
    assert.equal(pathPenTool.onKeyDown(f.ctx,"Enter",params),true);
    assert.ok(f.calls.feedback.some(x=>x.tone==="success"),JSON.stringify(f.calls.feedback));
    const edges=f.runtime.getGraphSnapshot().edges.filter(e=>e.curve);
    assert.equal(edges.length,1);
    assert.deepEqual(edges[0].curve.start,[4,0,3]);
    assert.deepEqual(edges[0].curve.end,[-4,0,3]);
    assert.equal(f.previews.has("curve-pen"),false);
    const after=JSON.parse(f.session.snapshot_json());
    assert.equal(pathPenTool.onKeyDown(f.ctx,"Enter",params),false);
    f.session.undo_region_overlay("platform-test:curve-pen:1");
    assert.deepEqual(JSON.parse(f.session.snapshot_json()),before);
    f.session.redo_region_overlay("platform-test:curve-pen:1");
    assert.deepEqual(JSON.parse(f.session.snapshot_json()),after);
  }finally{pathPenTool.onCancel(f.ctx);f.session.free();}
});
test("real WASM pen: cancel discards all anchors and allows a new draft",()=>{
  const f=fixture();
  try {
    const before=f.session.snapshot_json();
    f.place(sample(-10,0));f.place(sample(10,0));pathPenTool.onCancel(f.ctx);
    assert.equal(f.session.snapshot_json(),before);
    assert.equal(pathPenTool.onKeyDown(f.ctx,"Enter",params),false);
    f.place(sample(-5,0));f.place(sample(5,0));
    pathPenTool.onKeyDown(f.ctx,"Enter",params);
    assert.ok(f.runtime.getGraphSnapshot().edges.some(e=>e.curve),JSON.stringify(f.calls.feedback));
  }finally{pathPenTool.onCancel(f.ctx);f.session.free();}
});
test("real WASM editing: a cancelled drag and an out-and-back drag leave the spine unchanged",()=>{
  const f=fixture();
  try {
    f.place(sample(-10,0));f.place(sample(10,0));pathPenTool.onKeyDown(f.ctx,"Enter",params);
    const before=f.session.snapshot_json();
    const edge=f.runtime.getGraphSnapshot().edges.find(e=>e.curve);
    const a={...sample(-10,0),nodeId:curvePickId(edge.edgeId,1)};
    const edit=beginCurveGesture(f.ctx,a);
    edit.move(gesture(a,sample(-5,3)));assert.equal(f.session.snapshot_json(),before);
    edit.move(gesture(a,a));edit.commit();assert.equal(f.session.snapshot_json(),before);
    const cancelled=beginCurveGesture(f.ctx,a);
    cancelled.move(gesture(a,sample(-5,3)));cancelled.cancel();cancelled.commit();
    assert.equal(f.session.snapshot_json(),before);
  }finally{pathPenTool.onCancel(f.ctx);f.session.free();}
});

test("real WASM pen: closing joins the first anchor without a duplicate endpoint",()=>{
  const f=fixture();
  try {
    f.place(sample(-10,0));f.place(sample(10,0));f.place(sample(0,15));
    const before=f.session.snapshot_json();
    pathPenTool.onPointerDown(f.ctx,sample(-10,0),params);
    assert.equal(f.session.snapshot_json(),before);
    pathPenTool.onPointerUp(f.ctx,gesture(sample(-10,0),sample(-10,0)),params);
    const edges=f.runtime.getGraphSnapshot().edges.filter(e=>e.curve);
    assert.equal(edges.length,3,JSON.stringify(f.calls.feedback));
    const degrees=new Map();
    for(const e of edges) for(const id of [e.startNodeId,e.endNodeId])degrees.set(id,(degrees.get(id)??0)+1);
    assert.equal(degrees.size,3);assert.ok([...degrees.values()].every(n=>n===2));
  }finally{pathPenTool.onCancel(f.ctx);f.session.free();}
});

test("real WASM pen: a failed commit rolls back and leaves the draft available for retry",()=>{
  const f=fixture();
  try {
    f.place(sample(-10,0));f.place(sample(10,0));
    const before=f.session.snapshot_json();
    const apply=f.runtime.applyPatchReplacement;
    f.runtime.applyPatchReplacement=request=>{apply(request);throw Error("simulated failure");};
    pathPenTool.onKeyDown(f.ctx,"Enter",params);
    assert.equal(f.session.snapshot_json(),before);
    assert.ok(f.previews.has("curve-pen"));
    f.runtime.applyPatchReplacement=apply;
    pathPenTool.onKeyDown(f.ctx,"Enter",params);
    assert.equal(f.runtime.getGraphSnapshot().edges.filter(e=>e.curve).length,1);
    assert.equal(pathPenTool.onKeyDown(f.ctx,"Enter",params),false);
  }finally{pathPenTool.onCancel(f.ctx);f.session.free();}
});
test("real WASM edit tool: pointer-up applies the last sample even without a move event", async()=>{
  const { editRegionTool }=await import("../src/composition/tabletop/tools/core/edit-region-tool.ts");
  const f=fixture();
  try {
    f.place(sample(-10,0));f.place(sample(10,0));pathPenTool.onKeyDown(f.ctx,"Enter",params);
    const edge=f.runtime.getGraphSnapshot().edges.find(e=>e.curve);
    const a={...sample(-10,0),nodeId:curvePickId(edge.edgeId,1)};
    editRegionTool.onPointerDown(f.ctx,a,{mode:"shape"});
    editRegionTool.onPointerUp(f.ctx,gesture(a,sample(-6,3)),{mode:"shape"});
    const updated=f.runtime.getGraphSnapshot().edges.find(e=>e.edgeId===edge.edgeId);
    assert.deepEqual(updated.curve.start,[4,0,3]);
  }finally{editRegionTool.onCancel(f.ctx);pathPenTool.onCancel(f.ctx);f.session.free();}
});

test("unified road tool: legacy brush settings still create a curve, then edit it without changing tool", async()=>{
  const { pathBrushTool: tool }=await import("../src/composition/tabletop/tools/paths/path-brush-tool.ts");
  const f=fixture();
  const legacy={...params,creationMode:"brush"};
  try {
    const blank=f.session.snapshot_json();
    const put=(a,b=a)=>{tool.onPointerDown(f.ctx,a,legacy);tool.onPointerUp(f.ctx,gesture(a,b),legacy);};
    put(sample(-10,0),sample(-6,3));
    assert.equal(f.session.snapshot_json(),blank,"a drag places an anchor, never paints an area");
    put(sample(10,0),sample(14,-3));
    assert.equal(f.session.snapshot_json(),blank);
    tool.onKeyDown(f.ctx,"Enter",legacy);
    const before=f.session.snapshot_json();
    const edge=f.runtime.getGraphSnapshot().edges.find(e=>e.curve);
    const handle={...sample(-6,3),nodeId:curvePickId(edge.edgeId,1)};
    tool.onPointerDown(f.ctx,handle,legacy);
    tool.onPointerMove(f.ctx,gesture(handle,sample(-5,5)),legacy);
    assert.equal(f.session.snapshot_json(),before);
    tool.onPointerUp(f.ctx,gesture(handle,sample(-4,4)),legacy);
    const after=f.session.snapshot_json();
    assert.notEqual(after,before);
    assert.deepEqual(f.runtime.getGraphSnapshot().edges.find(e=>e.edgeId===edge.edgeId).curve.start,[6,0,4]);
    assert.equal(tool.onKeyDown(f.ctx,"Enter",legacy),false,"grabbing a handle must not start a new draft");
    f.session.undo_region_overlay("curve-edit:2");
    assert.deepEqual(JSON.parse(f.session.snapshot_json()),JSON.parse(before));
    f.session.redo_region_overlay("curve-edit:2");
    assert.deepEqual(JSON.parse(f.session.snapshot_json()),JSON.parse(after));
  }finally{tool.onCancel(f.ctx);f.session.free();}
});
test("unified road tool: moving an anchor, cancelling and subdividing all use the same tool", async()=>{
  const { pathBrushTool: tool }=await import("../src/composition/tabletop/tools/paths/path-brush-tool.ts");
  const f=fixture();
  try {
    f.place(sample(-10,0));f.place(sample(10,0));tool.onKeyDown(f.ctx,"Enter",params);
    let edge=f.runtime.getGraphSnapshot().edges.find(e=>e.curve);
    const a={...sample(-10,0),nodeId:edge.startNodeId};
    const before=f.session.snapshot_json();
    tool.onPointerDown(f.ctx,a,params);tool.onPointerMove(f.ctx,gesture(a,sample(-10,4)),params);
    tool.onCancel(f.ctx);tool.onPointerUp(f.ctx,gesture(a,sample(-10,4)),params);
    assert.equal(f.session.snapshot_json(),before);
    tool.onPointerDown(f.ctx,a,params);tool.onPointerUp(f.ctx,gesture(a,sample(-10,4)),params);
    assert.equal(f.runtime.getGraphSnapshot().nodes.find(n=>n.id===a.nodeId).position.z,4);
    edge=f.runtime.getGraphSnapshot().edges.find(e=>e.curve);
    const mid={...sample(0,2),nodeId:curvePickId(edge.edgeId,"midpoint")};
    tool.onPointerDown(f.ctx,mid,params);tool.onPointerUp(f.ctx,gesture(mid,mid),params);
    assert.equal(f.runtime.getGraphSnapshot().edges.filter(e=>e.curve).length,2);
    assert.equal(tool.onKeyDown(f.ctx,"Enter",params),false);
  }finally{tool.onCancel(f.ctx);f.session.free();}
});
