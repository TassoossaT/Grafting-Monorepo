import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture, addFace } from "./platform-session-fixture.mjs";
import { beginBezierGesture } from "../src/composition/tabletop/path/bezier-edit-gesture.ts";
import { planMuroCreation, planMuroEdit, createPathBrushEffect, pathFormationFor, planPathCloudMutation, structureTypeFor } from "../src/features/edit-construction/index.ts";

const p = (x,z,y=0) => ({x,y,z});
function draw(f, operationId="muro:1", stroke=[p(-2,0),p(0,1),p(2,0)]) {
  const plan = planMuroCreation({ snapshot:f.runtime.getGraphSnapshot(),topologies:f.runtime.getAllRegionTopologies(),port:f.runtime,stroke,operationId,height:3,thickness:0.4,tolerance:0.025 });
  assert.ok(plan);
  const outcome=f.runtime.applyPatchReplacement(plan.request);
  assert.deepEqual(outcome.skippedRegionIds,[]);
  return plan;
}
function edit(f,targetId,position,operationId,extra={}) {
  const plan=planMuroEdit({snapshot:f.runtime.getGraphSnapshot(),topologies:f.runtime.getAllRegionTopologies(),port:f.runtime,targetId,position,operationId,tableId:"muro-test",...extra});
  assert.ok(plan);
  assert.deepEqual(f.runtime.applyPatchReplacement(plan.request).skippedRegionIds,[]);
  return plan;
}
const muroFaces = f => f.runtime.getAllRegionTopologies().filter(t=>t.surfaceType==="muro");
const curves = f => f.runtime.getGraphSnapshot().edges.filter(e=>e.curve);
const mid = e => "bezier-midpoint:"+encodeURIComponent(e.edgeId);

test("muro follows sloped terrain with constant height and leaves terrain intact",()=>{
  const f=sessionFixture();
  try {
    addFace(f.runtime,"slope","terrain",[[-5,-5],[-5,5],[5,5],[5,-5]].map(([x,z],i)=>({id:`ground:${i}`,position:p(x,z,2+x*0.2)})));
    const terrain=f.runtime.getAllRegionTopologies();
    draw(f);
    const nodes=f.runtime.getGraphSnapshot().nodes.filter(n=>n.id.startsWith("muro:"));
    assert.ok(nodes.length>8);
    for(const n of nodes) {
      const top=Number(n.id.split(":").at(-1))%2===1;
      assert.ok(Math.abs(n.position.y-(2+n.position.x*0.2+(top?3:0)))<1e-5);
    }
    assert.deepEqual(f.runtime.getAllRegionTopologies().filter(t=>t.surfaceType==="terrain"),terrain);
  } finally {f.session.free();}
});

test("muro axis, handles, thickness, height and undo replace the same object",()=>{
  const f=sessionFixture();
  try {
    draw(f);
    const original=JSON.parse(f.session.snapshot_json());
    const edge=curves(f)[0];
    edit(f,mid(edge),p(0,2),"pull");
    assert.notDeepEqual(JSON.parse(f.session.snapshot_json()),original);
    f.session.undo_region_overlay("pull");
    assert.deepEqual(JSON.parse(f.session.snapshot_json()),original);
    edit(f,mid(edge),p(0,1),"height",{setHeight:true,height:5});
    assert.ok(muroFaces(f).every(t=>t.nodes.every(n=>n.position.y===0||n.position.y===5)));
    edit(f,mid(edge),p(0,1),"thickness",{action:"width",width:0.8});
    assert.deepEqual(curves(f)[0].curve.bandOffsets,[-0.4,0.4]);
    const split=edit(f,mid(curves(f)[0]),p(0,1),"split",{insert:true});
    edit(f,split.selectedId,p(0,3),"anchor");
    assert.ok(muroFaces(f).length>0);
    const beforeDelete=curves(f).length;
    edit(f,mid(curves(f)[0]),p(0,1),"delete",{action:"delete-segment"});
    assert.equal(curves(f).length,beforeDelete-1);
    for(let i=0;curves(f).length;i++) edit(f,mid(curves(f)[0]),p(0,1),`delete-last:${i}`,{action:"delete-segment"});
    assert.equal(muroFaces(f).length,0);
  } finally {f.session.free();}
});

test("crossing a road does not join, cut or replace muro geometry in either creation order",()=>{
  for(const wallFirst of [true,false]) {
    const f=sessionFixture();
    try {
      if(wallFirst)draw(f,"muro:1",[p(-2,0),p(2,0)]);
      const before=muroFaces(f);
      const effect=createPathBrushEffect({brushShape:{kind:"circle",radius:0.5},brushRegion:{samples:[p(0,-3),p(0,3)]},parameters:pathFormationFor({pathKind:"street",bedWidth:0.5,shoulderWidth:0,shoulderHeight:0,miterLimit:4})},{operationId:"road:1",tableId:"muro-test",initiatedBy:"path-brush"});
      const plan=planPathCloudMutation({bezier:f.runtime,tableId:"muro-test",snapToGrid:false,graphSnapshot:f.runtime.getGraphSnapshot(),regionTopologies:f.runtime.getAllRegionTopologies(),coverageFor:()=>before.map(t=>({...t,coverage:"overlap",centroid:p(0,0),nodeIds:t.nodes.map(n=>n.id)})),effect,tolerance:0.025});
      assert.equal(plan.kind,"ready");
      f.runtime.applyPatchReplacement(plan.request);
      assert.deepEqual(muroFaces(f),before);
      const roads=f.runtime.getAllRegionTopologies().filter(t=>t.surfaceType==="path");
      if(!wallFirst)draw(f,"muro:1",[p(-2,0),p(2,0)]);
      assert.deepEqual(f.runtime.getAllRegionTopologies().filter(t=>t.surfaceType==="path"),roads);
      assert.equal(curves(f).length,2);
    } finally {f.session.free();}
  }
  assert.equal(structureTypeFor("muro").interactionOver("path").kind,"ignore");
  assert.equal(structureTypeFor("path").interactionOver("muro").kind,"ignore");
});

test("invalid muro dimensions leave the live session unchanged",()=>{
  const f=sessionFixture();
  try {
    const before=f.session.snapshot_json();
    for(const height of [0,-1,NaN,Infinity]) assert.throws(()=>planMuroCreation({snapshot:f.runtime.getGraphSnapshot(),topologies:[],port:f.runtime,stroke:[p(0,0),p(2,0)],operationId:"invalid",height,thickness:.3,tolerance:.025}));
    assert.equal(f.session.snapshot_json(),before);
  } finally {f.session.free();}
});

test("muro gesture previews and cancellation do not mutate, release commits once",()=>{
  const f=sessionFixture();
  try {
    draw(f);
    draw(f,"muro:other",[p(10,0),p(12,0)]);
    const others=muroFaces(f).filter(t=>t.surfaceKey[1].startsWith("muro:muro%3Aother:"));
    const before=f.session.snapshot_json();
    f.runtime.showPreview=()=>{}; f.runtime.clearPreview=()=>{};
    let commits=0;
    const apply=f.runtime.applyPatchReplacement;
    f.runtime.applyPatchReplacement=(r)=>{commits++;return apply(r);};
    const sample={point:p(-2,0),nodeId:curves(f).find(e=>e.edgeId.startsWith("spine-edge:muro:muro%3A1:")).startNodeId};
    const gesture={current:{point:p(-3,1)}};
    const cancelled=beginBezierGesture(f.ctx,sample,{mode:"shape"});
    cancelled.move(gesture);
    assert.equal(f.session.snapshot_json(),before);
    cancelled.cancel();
    assert.equal(commits,0);
    const accepted=beginBezierGesture(f.ctx,sample,{mode:"shape"});
    accepted.move(gesture); accepted.commit();
    assert.equal(commits,1);
    assert.deepEqual(muroFaces(f).filter(t=>t.surfaceKey[1].startsWith("muro:muro%3Aother:")),others);
  } finally { f.session.free(); }
});
