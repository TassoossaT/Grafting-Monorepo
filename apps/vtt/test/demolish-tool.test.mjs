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
test("ground is deletable through the same registered type contract",()=>{
 const f=capturePreviews(sessionFixture());
 try { const face=addFace(f.runtime,"ground-delete","terrain-grass",[[0,0],[3,0],[3,3],[0,3]].map(([x,z],i)=>({id:`g${i}`,position:{x,y:0,z}}))); click(f,face); assert.equal(f.runtime.getAllRegionTopologies().length,0); } finally {f.session.free();}
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

test("deleting a wall removes its hosted openings in the same undo transaction",async()=>{
 const {openingTool}=await import("../src/composition/tabletop/tools/openings/opening-tool.ts");
 const {click:createOpening}=await import("./support/opening-harness.mjs");
 const f=capturePreviews(sessionFixture());
 try {wall(f,0);openingTool.onCancel(f.ctx);createOpening(f.ctx,{point:{x:1.5,y:1,z:0}},{openingKind:"window",width:0.8,height:1});assert.ok(f.runtime.getAllRegionTopologies().some(t=>t.surfaceType==="opening"));const before=f.session.snapshot_json();click(f,f.runtime.getAllRegionTopologies().find(t=>t.surfaceType==="wall-white"));assert.equal(f.runtime.getAllRegionTopologies().length,0,JSON.stringify(f.calls.feedback));const entry=f.ctx.history.undo();f.session.undo_region_overlay(entry.transactionId);assert.equal(f.session.snapshot_json(),before);}finally{openingTool.onCancel(f.ctx);f.session.free();}
});

test("hover and drag preview exactly their picked scope; empty space never deletes nearby faces",()=>{
 const f=capturePreviews(sessionFixture());
 try {wall(f,0);wall(f,8);const faces=f.runtime.getAllRegionTopologies(),sample={...at(1,0),surfaceRef:surfaceRefFromNodeSet(faces[0].surfaceKey)};let previewed;f.runtime.previewSurfaces=keys=>{previewed=keys;return {kind:"mesh",color:0xff0000,positions:new Float32Array(),indices:new Uint32Array()};};const gesture={start:sample,current:sample,samples:[sample]};assert.equal(tool.previewFor(gesture,params,f.ctx).kind,"mesh");assert.deepEqual(previewed,[faces[0].surfaceKey]);const before=f.session.snapshot_json();const blank=at(1,0);f.runtime.getFootprintCoverage=()=>{throw Error("direct selection must not use a footprint");};assert.equal(tool.previewFor({start:blank,current:blank,samples:[blank]},params,f.ctx),undefined);tool.onPointerUp(f.ctx,{start:blank,current:blank,samples:[blank],moved:false},params);assert.equal(f.session.snapshot_json(),before);}finally{f.session.free();}
});
