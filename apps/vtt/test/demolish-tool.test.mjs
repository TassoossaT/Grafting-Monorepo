import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createAliasResolveHook } from "./support/alias-resolve-hook.mjs";
import { sessionFixture, capturePreviews, addFace } from "./platform-session-fixture.mjs";
import { commitWallContour } from "../src/composition/tabletop/tools/walls/wall-shared.ts";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";
import { createPathBrushEffect, pathFormationFor } from "../src/features/edit-construction/index.ts";
import { commitPathCloudIntent } from "../src/composition/tabletop/path/path-cloud-transaction.ts";
registerHooks(createAliasResolveHook(new URL("../src/", import.meta.url)));
const { demolishTool: tool } = await import("../src/composition/tabletop/tools/demolish/demolish-tool.ts");
const params = tool.defaultParams();
const at = (x,z) => ({point:{x,y:0,z}});
function click(f, face) {
  const sample = {...at(0,0),surfaceRef:surfaceRefFromNodeSet(face.surfaceKey)};
  tool.onPointerUp(f.ctx,{start:sample,current:sample,samples:[sample],moved:false},params);
}
function wall(f,x) { commitWallContour(f.ctx,[{start:{x,y:0,z:0},end:{x:x+3,y:0,z:0},geometry:{kind:"line"}}],{wallType:"wall-white",height:3},"wall-line"); }
test("click deletion removes a wall and a single undo restores it",()=>{
 const f=capturePreviews(sessionFixture());
 try { wall(f,0); const before=f.session.snapshot_json(); click(f,f.runtime.getAllRegionTopologies()[0]); assert.equal(f.runtime.getAllRegionTopologies().length,0); const entry=f.ctx.history.undo(); assert.equal(entry.kind,"transaction"); f.session.undo_region_overlay(entry.transactionId); assert.equal(f.session.snapshot_json(),before); } finally {f.session.free();}
});
test("drag deletion deduplicates picked surfaces and undoes the whole gesture",()=>{
 const f=capturePreviews(sessionFixture());
 try { wall(f,0);wall(f,8); const faces=f.runtime.getAllRegionTopologies(); const before=f.session.snapshot_json(); f.runtime.getFootprintCoverage=()=>[...faces,...faces]; const start={...at(0,0),surfaceRef:surfaceRefFromNodeSet(faces[0].surfaceKey)},current={...at(12,0),surfaceRef:surfaceRefFromNodeSet(faces[1].surfaceKey)}; tool.onPointerUp(f.ctx,{start,current,samples:[start,current],moved:true},params); assert.equal(f.runtime.getAllRegionTopologies().length,0); const entry=f.ctx.history.undo();f.session.undo_region_overlay(entry.transactionId); assert.equal(f.session.snapshot_json(),before); } finally {f.session.free();}
});
test("ground dispatches to its own pending deletion action without generic fallback",()=>{
 const f=capturePreviews(sessionFixture());
 try { const face=addFace(f.runtime,"ground-delete","terrain-grass",[[0,0],[3,0],[3,3],[0,3]].map(([x,z],i)=>({id:`g${i}`,position:{x,y:0,z}}))); const before=f.session.snapshot_json();click(f,face); assert.equal(f.session.snapshot_json(),before);assert.ok(f.calls.feedback.some(item=>item.tone==="error"&&item.message.includes("ainda não foi implementada"))); } finally {f.session.free();}
});
test("deleting a generated path also retires its authoring spine; undo restores both",()=>{
 const f=capturePreviews(sessionFixture());
 try { const coords=[[-4,0,0],[0,0,0],[4,0,0]]; const curves=f.runtime.curveBatch({tolerance:0.025,commands:[{kind:"automatic",points:coords}]})[0].curves; const effect=createPathBrushEffect({brushShape:{kind:"circle",radius:0.025},brushRegion:{samples:coords.map(([x,y,z])=>({x,y,z}))},authoredCurves:curves,curveMode:"automatic",parameters:pathFormationFor({...params,pathKind:"trail",bedWidth:1,shoulderWidth:0,shoulderHeight:0,miterLimit:4})},{operationId:"platform-test:delete-road:1",tableId:f.ctx.tableId,initiatedBy:"test"}); assert.ok(commitPathCloudIntent(f.ctx,effect,0.025),JSON.stringify(f.calls.feedback)); const before=f.session.snapshot_json(); click(f,f.runtime.getAllRegionTopologies().find(t=>t.surfaceType==="path")); assert.equal(f.runtime.getAllRegionTopologies().filter(t=>t.surfaceType==="path").length,0); assert.equal(f.runtime.getGraphSnapshot().edges.filter(e=>e.curve).length,0); const entry=f.ctx.history.undo(); f.session.undo_region_overlay(entry.transactionId);assert.equal(f.session.snapshot_json(),before); } finally {f.session.free();}
});

test("deleting a curved ramp face removes its owned spine span and undo restores it",async()=>{
 const {commitPlatformSlope}=await import("../src/composition/tabletop/tools/slope/slope-commit.ts");
 const f=capturePreviews(sessionFixture());
 try {commitPlatformSlope(f.ctx,[{x:0,y:0,z:0},{x:4,y:1,z:2},{x:8,y:2,z:0}],{width:2});const face=f.runtime.getAllRegionTopologies().find(t=>t.surfaceType==="platform-slope");assert.ok(face);const before=f.session.snapshot_json();const spans=f.runtime.getGraphSnapshot().edges.filter(e=>e.curve).length;click(f,face);assert.ok(f.runtime.getGraphSnapshot().edges.filter(e=>e.curve).length<spans);const entry=f.ctx.history.undo();f.session.undo_region_overlay(entry.transactionId);assert.equal(f.session.snapshot_json(),before);}finally{f.session.free();}
});

test("deleting a wall preserves its hosted face and undo restores the host",async()=>{
 const {openingTool}=await import("../src/composition/tabletop/tools/openings/opening-tool.ts");
 const {click:createOpening}=await import("./support/opening-harness.mjs");
 const f=capturePreviews(sessionFixture());
 try {wall(f,0);openingTool.onCancel(f.ctx);createOpening(f.ctx,{point:{x:1.5,y:1,z:0}},{openingKind:"window",width:0.8,height:1});assert.ok(f.runtime.getAllRegionTopologies().some(t=>t.surfaceType==="opening"));const before=f.session.snapshot_json();click(f,f.runtime.getAllRegionTopologies().find(t=>t.surfaceType==="wall-white"));assert.equal(f.runtime.getAllRegionTopologies().length,1,JSON.stringify(f.calls.feedback));assert.equal(f.runtime.getAllRegionTopologies()[0].surfaceType,"opening");assert.ok(f.runtime.getAllRegionTopologies()[0].nodes.every(n=>!n.pin));const entry=f.ctx.history.undo();f.session.undo_region_overlay(entry.transactionId);assert.equal(f.session.snapshot_json(),before);}finally{openingTool.onCancel(f.ctx);f.session.free();}
});

test("hover and drag preview exactly their picked scope; empty space never deletes nearby faces",()=>{
 const f=capturePreviews(sessionFixture());
 try {wall(f,0);wall(f,8);const faces=f.runtime.getAllRegionTopologies(),sample={...at(1,0),surfaceRef:surfaceRefFromNodeSet(faces[0].surfaceKey)};let previewed;f.runtime.previewSurfaces=keys=>{previewed=keys;return {kind:"mesh",color:0xff0000,positions:new Float32Array(),indices:new Uint32Array()};};const gesture={start:sample,current:sample,samples:[sample]};assert.equal(tool.previewFor(gesture,params,f.ctx).kind,"mesh");assert.deepEqual(previewed,[faces[0].surfaceKey]);const before=f.session.snapshot_json();const blank=at(1,0);f.runtime.getFootprintCoverage=()=>{throw Error("direct selection must not use a footprint");};assert.equal(tool.previewFor({start:blank,current:blank,samples:[blank]},params,f.ctx),undefined);tool.onPointerUp(f.ctx,{start:blank,current:blank,samples:[blank],moved:false},params);assert.equal(f.session.snapshot_json(),before);}finally{f.session.free();}
});

for (const type of ["platform", "wall-white"]) test(`deleting one ${type} face preserves a connected face, shared edge and vertices`,()=>{
 const f=capturePreviews(sessionFixture());
 try {
  const points=[[0,0],[2,0],[2,2],[0,2],[4,0],[4,2]].map(([x,z],i)=>({id:`shared:${i}`,position:{x,y:0,z}}));
  const edges=[{edgeId:"shared:edge",startNodeId:points[1].id,endNodeId:points[2].id}];
  const regions=[[0,1,2,3],[1,4,5,2]].map((ids,r)=>{
   const boundary=ids.map((id,i)=>{const next=ids[(i+1)%ids.length];if((id===1&&next===2)||(id===2&&next===1))return {edgeId:"shared:edge",reversed:id===2};const edgeId=`face:${r}:${i}`;edges.push({edgeId,startNodeId:points[id].id,endNodeId:points[next].id});return {edgeId,reversed:false};});
   return {regionId:`connected:${r}`,boundary,surfaceType:type,physical:true};
  });
  f.runtime.addPatch({nodes:points,edges,regions});
  const faces=f.runtime.getAllRegionTopologies();assert.equal(f.runtime.cloudFor({seed:faces[0].surfaceKey,surfaceType:type}).surfaceKeys.length,2);
  const before=f.session.snapshot_json(),survivor=faces[1];let highlighted;
  f.runtime.previewSurfaces=keys=>{highlighted=keys;return {kind:"mesh"};};const sample={...at(1,1),surfaceRef:surfaceRefFromNodeSet(faces[0].surfaceKey)};
  tool.previewFor({start:sample,current:sample,samples:[sample]},params,f.ctx);assert.deepEqual(highlighted,[faces[0].surfaceKey]);
  click(f,faces[0]);assert.deepEqual(f.runtime.getAllRegionTopologies().map(t=>t.surfaceKey),[survivor.surfaceKey]);
  assert.equal(f.runtime.getGraphSnapshot().nodes.length,4);assert.deepEqual(f.runtime.getRegionTopology(survivor.surfaceKey),survivor);
  assert.ok(f.runtime.getRegionTopology(survivor.surfaceKey).outerLoops.flat().some(e=>e.edgeId==="shared:edge"));
  const entry=f.ctx.history.undo();f.session.undo_region_overlay(entry.transactionId);assert.equal(f.session.snapshot_json(),before);
 } finally {f.session.free();}
});

test("a surviving contour face retains its shared authoring spine",async()=>{
 const {removalPatchForRegions}=await import("../src/features/edit-construction/structure-types/path/path-cloud-scope.ts");
 const owner="platform-test:shared-road:1",key=(suffix)=>["@region",`road-cloud:${encodeURIComponent(JSON.stringify([owner]))}:${suffix}`];
 const graph={nodes:[],edges:[{edgeId:`spine-edge:${owner}:0`,startNodeId:"a",endNodeId:"b",curve:{surfaceType:"path"}}]};
 const removed={surfaceType:"path",surfaceKey:key("removed")},remaining={surfaceType:"path",surfaceKey:key("remaining")};
 assert.deepEqual(removalPatchForRegions([removed],graph,[]).removedEdgeIds,[graph.edges[0].edgeId]);
 assert.deepEqual(removalPatchForRegions([removed],graph,[remaining]).removedEdgeIds,[]);
});
