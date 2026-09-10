import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { createPathBrushEffect, pathFormationFor, planPathCloudMutation, planBezierEdit } from "../src/features/edit-construction/index.ts";

const point = (x,z,y=0) => ({x,y,z});
const road = { shape:"circle",radius:0.5,rotationDegrees:0,pathKind:"road",bedWidth:0.6,shoulderWidth:0.1,shoulderHeight:0,miterLimit:4 };
function draw(f, samples, operationId) {
  const effect=createPathBrushEffect({brushShape:{kind:"circle",radius:0.5},brushRegion:{samples},parameters:pathFormationFor(road)},
    {operationId,tableId:"bezier-test",initiatedBy:"path-brush"});
  const plan=planPathCloudMutation({bezier:f.runtime,tableId:"bezier-test",snapToGrid:false,graphSnapshot:f.runtime.getGraphSnapshot(),
    regionTopologies:f.runtime.getAllRegionTopologies(),coverageFor:()=>[],effect,tolerance:0.025});
  assert.equal(plan.kind,"ready");
  f.runtime.applyPatchReplacement(plan.request);
}
function edit(f, targetId, position, operationId, extra={}) {
  const plan=planBezierEdit({snapshot:f.runtime.getGraphSnapshot(),topologies:f.runtime.getAllRegionTopologies(),port:f.runtime,
    targetId,position,operationId,tableId:"bezier-test",...extra});
  assert.ok(plan);
  f.runtime.applyPatchReplacement(plan.request);
  return plan;
}
const curves = (f) => f.runtime.getGraphSnapshot().edges.filter((e)=>e.curve);
const pick = (e,index="midpoint") => index === "midpoint" ? "bezier-midpoint:"+encodeURIComponent(e.edgeId) : "bezier-handle:"+index+":"+encodeURIComponent(e.edgeId);

test("real WASM: split, pull and undo restore both authored curves and surfaces", () => {
  const f=sessionFixture();
  try {
    draw(f,[point(-10,0),point(10,0)],"road:1");
    const original=f.session.snapshot_json();
    const edge=curves(f)[0];
    edit(f,pick(edge),point(0,0),"split:1",{insert:true});
    assert.equal(curves(f).length,2);
    const split=f.session.snapshot_json();
    f.session.undo_region_overlay("split:1");
    assert.deepEqual(JSON.parse(f.session.snapshot_json()),JSON.parse(original));
    f.session.redo_region_overlay("split:1");
    assert.deepEqual(JSON.parse(f.session.snapshot_json()),JSON.parse(split));
    edit(f,pick(curves(f)[0]),point(-5,1),"pull:1");
    assert.notEqual(f.session.snapshot_json(),split);
    f.session.undo_region_overlay("pull:1");
    assert.deepEqual(JSON.parse(f.session.snapshot_json()),JSON.parse(split));
  } finally { f.session.free(); }
});

test("real WASM: a ground crossing shares one anchor; a bridge stays separate", () => {
  for(const height of [0,4]) {
    const f=sessionFixture();
    try {
      draw(f,[point(-10,0),point(10,0)],"road:1");
      draw(f,[point(0,-10,height),point(0,10,height)],"road:2");
      const edges=curves(f);
      const degrees=new Map();
      for(const e of edges) for(const id of [e.startNodeId,e.endNodeId]) degrees.set(id,(degrees.get(id)??0)+1);
      assert.equal([...degrees.values()].filter((d)=>d===4).length,height===0?1:0);
      assert.equal(edges.length,height===0?4:2);
    } finally { f.session.free(); }
  }
});

test("real WASM: bounded removal and width edits preserve controls and undo", () => {
  const f=sessionFixture();
  try {
    draw(f,[point(-10,0),point(10,0)],"road:1");
    const original=curves(f)[0].curve;
    const faceCount=f.runtime.getAllRegionTopologies().length;
    const split=edit(f,pick(curves(f)[0]),point(0,0),"split",{insert:true});
    edit(f,split.selectedId,point(0,0),"remove",{action:"remove-anchor"});
    assert.equal(curves(f).length,1);
    assert.deepEqual(curves(f)[0].curve,original);
    assert.ok(!f.runtime.getGraphSnapshot().nodes.some((n)=>n.id===split.selectedId));
    edit(f,pick(curves(f)[0]),point(0,0),"width",{action:"width",width:2});
    assert.deepEqual(curves(f)[0].curve.start,original.start);
    assert.deepEqual(curves(f)[0].curve.end,original.end);
    assert.deepEqual(curves(f)[0].curve.bandOffsets,[-1,1]);
    assert.equal(f.runtime.getAllRegionTopologies().length,faceCount);
    f.session.undo_region_overlay("width");
    assert.deepEqual(curves(f)[0].curve,original);
  } finally { f.session.free(); }
});

test("real WASM: disconnect and deletion are single reversible transactions", () => {
  const f=sessionFixture();
  try {
    draw(f,[point(-10,0),point(10,0)],"road:1");
    draw(f,[point(0,-10),point(0,10)],"road:2");
    const before=f.session.snapshot_json();
    const degrees=new Map();
    for(const e of curves(f))for(const id of [e.startNodeId,e.endNodeId])degrees.set(id,(degrees.get(id)??0)+1);
    const junction=[...degrees].find(([,d])=>d===4)[0];
    edit(f,junction,point(0,0),"disconnect",{action:"disconnect"});
    assert.equal(curves(f).filter((e)=>e.startNodeId===junction || e.endNodeId===junction).length,1);
    f.session.undo_region_overlay("disconnect");
    assert.deepEqual(JSON.parse(f.session.snapshot_json()),JSON.parse(before));
    const edge=curves(f)[0];
    edit(f,pick(edge),point(0,0),"delete",{action:"delete-segment"});
    assert.ok(!curves(f).some((e)=>e.edgeId===edge.edgeId));
    f.session.undo_region_overlay("delete");
    assert.deepEqual(JSON.parse(f.session.snapshot_json()),JSON.parse(before));
  } finally { f.session.free(); }
});

test("real WASM: tapered widths survive exact subdivision and restoration", () => {
  const f=sessionFixture();
  try {
    draw(f,[point(-10,0),point(10,0)],"road:1");
    edit(f,pick(curves(f)[0]),point(0,0),"taper",{action:"width",width:2,endWidth:6});
    const before=f.session.snapshot_json();
    const split=edit(f,pick(curves(f)[0]),point(0,0),"split",{insert:true});
    const edges=curves(f);
    const first=edges.find((e)=>e.endNodeId===split.selectedId);
    const second=edges.find((e)=>e.startNodeId===split.selectedId);
    assert.deepEqual(first.curve.bandOffsets,[-1,1]);
    assert.deepEqual(first.curve.endBandOffsets,[-2,2]);
    assert.deepEqual(second.curve.bandOffsets,[-2,2]);
    assert.deepEqual(second.curve.endBandOffsets,[-3,3]);
    f.session.undo_region_overlay("split");
    assert.deepEqual(JSON.parse(f.session.snapshot_json()),JSON.parse(before));
  } finally { f.session.free(); }
});

test("real WASM: mirrored handles preserve the explicit continuation pair", () => {
  const f=sessionFixture();
  try {
    draw(f,[point(-10,0),point(10,0)],"road:1");
    const split=edit(f,pick(curves(f)[0]),point(0,0),"split",{insert:true});
    const left=curves(f).find((e)=>e.endNodeId===split.selectedId);
    edit(f,pick(left,2),point(-2,1),"mirror",{mode:"mirrored"});
    const a=curves(f).find((e)=>e.endNodeId===split.selectedId);
    const b=curves(f).find((e)=>e.startNodeId===split.selectedId);
    for(let i=0;i<3;i++)assert.ok(Math.abs(a.curve.end[i]+b.curve.start[i])<1e-9);
  } finally { f.session.free(); }
});

test("real WASM: a roundabout keeps its island and restores after editing", () => {
  const f=sessionFixture();
  try {
    draw(f,[point(-10,0),point(0,-10),point(10,0),point(0,10),point(-10,0)],"ring");
    assert.ok(f.runtime.getAllRegionTopologies().some((t)=>t.holes.length>0),"the central island stays open");
    const before=f.session.snapshot_json();
    edit(f,pick(curves(f)[0]),point(-5,-5),"insert",{insert:true});
    assert.ok(f.runtime.getAllRegionTopologies().some((t)=>t.holes.length>0));
    f.session.undo_region_overlay("insert");
    assert.deepEqual(JSON.parse(f.session.snapshot_json()),JSON.parse(before));
  } finally { f.session.free(); }
});

test("real WASM: invalid edit rejects without changing graph or history", () => {
  const f=sessionFixture();
  try {
    draw(f,[point(-10,0),point(10,0)],"road:1");
    const before=f.session.snapshot_json();
    assert.throws(()=>edit(f,pick(curves(f)[0],1),point(NaN,0),"bad"));
    assert.equal(f.session.snapshot_json(),before);
    f.session.undo_region_overlay("road:1");
    assert.equal(curves(f).length,0);
  } finally { f.session.free(); }
});


test("real WASM: stacked parallel roads keep separate surface vertices", () => {
  const f=sessionFixture();
  try {
    draw(f,[point(-10,0),point(10,0)],"ground");
    draw(f,[point(-10,0,4),point(10,0,4)],"bridge");
    const faces=f.runtime.getAllRegionTopologies().filter(t=>t.surfaceType==="path");
    assert.equal(faces.length,2);
    const heights=faces.map(t=>[...new Set(t.nodes.map(n=>n.position.y))]);
    assert.deepEqual(heights.sort((a,b)=>a[0]-b[0]),[[0],[4]]);
    assert.equal(new Set(faces.flatMap(t=>t.nodes.map(n=>n.id))).size,faces.reduce((n,t)=>n+t.nodes.length,0));
  } finally { f.session.free(); }
});

test("real WASM: angled joins keep the contour away from the spine", () => {
  const f=sessionFixture();
  try {
    draw(f,[point(-5,0),point(0,0)],"angle:1");
    draw(f,[point(0,0),point(0,5)],"angle:2");
    const faces=f.runtime.getAllRegionTopologies();
    assert.equal(faces.length,1);
    assert.ok(faces[0].nodes.every(n=>Math.hypot(n.position.x,n.position.z)>.2), "outside join must not cut down to the anchor");
  } finally { f.session.free(); }
});

test("real WASM: closed corners retain the island without cuts to the anchors", () => {
  const f=sessionFixture();
  try {
    const corners=[point(0,0),point(5,0),point(5,5),point(0,5)];
    for(let i=0;i<4;i++)draw(f,[corners[i],corners[(i+1)%4]],"corner:"+i);
    const faces=f.runtime.getAllRegionTopologies();
    assert.equal(faces.length,1);
    assert.equal(faces[0].holes.length,1);
    assert.ok(faces[0].nodes.every(n=>corners.every(p=>Math.hypot(n.position.x-p.x,n.position.z-p.z)>.2)));
    const count=faces.length;
    for(let i=0;i<3;i++){
      edit(f,pick(curves(f)[0]),point(0,0),"corner-width:"+i,{action:"width",width:.8+i*.1});
      assert.equal(f.runtime.getAllRegionTopologies().length,count);
      assert.equal(f.runtime.getAllRegionTopologies()[0].holes.length,1);
    }
  } finally { f.session.free(); }
});

test("real WASM: editing one disconnected remnant preserves the other surface", () => {
  const f=sessionFixture();
  try {
    draw(f,[point(-9,0),point(9,0)],"remnant");
    edit(f,pick(curves(f)[0]),point(0,0),"remnant-split:1",{insert:true});
    const left=curves(f).find(e=>f.runtime.getGraphSnapshot().nodes.find(n=>n.id===e.startNodeId).position.x===-9);
    edit(f,pick(left),point(-4.5,0),"remnant-split:2",{insert:true});
    const middle=curves(f).find(e=>{
      const nodes=new Map(f.runtime.getGraphSnapshot().nodes.map(n=>[n.id,n.position]));
      return nodes.get(e.startNodeId).x===-4.5 && nodes.get(e.endNodeId).x===0;
    });
    edit(f,pick(middle),point(0,0),"remnant-delete",{action:"delete-segment"});
    assert.equal(f.runtime.getAllRegionTopologies().length,2);
    for(let i=0;i<3;i++){
      const before=JSON.parse(f.session.snapshot_json());
      const edge=curves(f).find(e=>f.runtime.getGraphSnapshot().nodes.find(n=>n.id===e.startNodeId).position.x===-9);
      edit(f,pick(edge),point(0,0),"remnant-width:"+i,{action:"width",width:1+i*.1});
      const faces=f.runtime.getAllRegionTopologies();
      assert.equal(faces.length,2);
      assert.ok(faces.some(t=>t.nodes.some(n=>n.position.x>=8.99)), "remote remnant disappeared");
      const after=JSON.parse(f.session.snapshot_json());
      f.session.undo_region_overlay("remnant-width:"+i);
      assert.deepEqual(JSON.parse(f.session.snapshot_json()),before);
      f.session.redo_region_overlay("remnant-width:"+i);
      assert.deepEqual(JSON.parse(f.session.snapshot_json()),after);
    }
  } finally { f.session.free(); }
});

test("real WASM: disconnected corridors retain shared surface ownership across later edits", () => {
  const f=sessionFixture();
  try {
    draw(f,[point(-5,0),point(0,0)],"owner:a");
    draw(f,[point(0,0),point(0,5)],"owner:b");
    const original=f.runtime.getGraphSnapshot().nodes.find(n=>n.id.startsWith("spine:") && n.position.x===0 && n.position.z===0);
    edit(f,original.id,point(0,0),"owner:disconnect",{action:"disconnect"});
    const copy=f.runtime.getGraphSnapshot().nodes.find(n=>n.id.startsWith("spine:owner:disconnect:"));
    assert.ok(copy);
    edit(f,copy.id,point(2,0),"owner:move");
    for(let i=0;i<3;i++){
      const edge=curves(f).find(e=>e.startNodeId===copy.id || e.endNodeId===copy.id);
      edit(f,pick(edge),point(0,0),"owner:width:"+i,{action:"width",width:.8+i*.1});
      const faces=f.runtime.getAllRegionTopologies();
      assert.equal(faces.length,2);
      assert.ok(faces.some(t=>t.nodes.some(n=>n.position.x < -4.99)));
      assert.ok(faces.some(t=>t.nodes.some(n=>n.position.z > 4.9)));
    }
  } finally { f.session.free(); }
});
