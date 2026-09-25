import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { DEFAULT_TOOL_PARAMS } from "../src/features/edit-construction/index.ts";

// Mount the actual hook without a DOM renderer. Only React scheduling and
// rendering/picking adapters are substituted; pointer dispatch, tool and WASM are real.
const hookUrl=new URL("../src/composition/tabletop/use-construction-pointer.ts",import.meta.url).href;
const modules={
  react: "export const useRef=(v)=>({current:v}); export const useCallback=(f)=>f; export const useMemo=(f)=>f(); export const useEffect=(f)=>globalThis.__platformHook.effects.push(f);",
  "@/ports": 'export const TOOL_GHOST_PREVIEW_CHANNEL="ghost";',
  "../../adapters/rendering/index.ts": "export const GRID_SNAP_UNIT=1;",
  "./tools/index.ts": "export const toolFor=()=>globalThis.__platformHook.tool;",
  "./tools/core/edge-overlay.ts": "export const edgeOverlayOf=()=>[]; export const edgeOverlayChannel=(v)=>v; export const edgeOverlayDescriptor=(v)=>v;",
};
const hooks=registerHooks({resolve(spec,context,next){
  if(context.parentURL===hookUrl && modules[spec])return {url:"data:text/javascript,"+encodeURIComponent(modules[spec]),shortCircuit:true};
  return next(spec,context);
}});
const {useConstructionPointer}=await import(hookUrl);
hooks.deregister();

test("real pointer lifecycle: final release sample, one drag commit, Escape and unmount cancellation",()=>{
  const fixture=sessionFixture();
  const {runtime,session,calls}=fixture;
  const effects=[],listeners=new Map(),captures=new Set();
  const oldWindow=globalThis.window;
  const oldHTMLElement=globalThis.HTMLElement;
  globalThis.HTMLElement=class {};
  globalThis.window={addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:(k)=>listeners.delete(k)};
  globalThis.__platformHook={effects,tool:platformContourTool};
  Object.assign(runtime,{
    getSnapshot:()=>({status:"ready",tableId:"pointer",map:{nodePositions:new Map()}}),
    subscribe:()=>()=>{},
    pick:(_view,x,z)=>({point:{x:x/10,y:0,z:z/10}}),
    clearPreview(){},showPreview(){},
  });
  const target={
    getBoundingClientRect:()=>({left:0,top:0}),
    setPointerCapture:(id)=>captures.add(id),
    hasPointerCapture:(id)=>captures.has(id),
    releasePointerCapture:(id)=>captures.delete(id),
  };
  const params={...DEFAULT_TOOL_PARAMS,"platform-contour":{mode:"create",elevation:3,shape:"rectangle"}};
  const cleanups=[];
  try {
    const handlers=useConstructionPointer({
      activeTool:"platform-contour",toolParams:params,runtime,history:fixture.ctx.history,tableId:"pointer",viewId:"view",snapToGrid:false,
      structureEditParams:{mode:"shape"},
      onSelectionChange(){},onFeedbackChange:(f)=>calls.feedback.push(f),
    });
    for(const effect of effects)cleanups.push(effect());
    const event=(x,z)=>({button:0,pointerId:1,currentTarget:target,clientX:x,clientY:z});
    handlers.onPointerDown(event(0,0));
    handlers.onPointerMove(event(30,20));
    handlers.onPointerUp(event(50,40));
    const tops=runtime.getAllRegionTopologies();
    assert.equal(tops.length,1,JSON.stringify(calls.feedback));
    assert.equal(Math.max(...tops[0].nodes.map(n=>n.position.x)),5);
    assert.equal(Math.max(...tops[0].nodes.map(n=>n.position.z)),4);
    assert.ok(tops[0].nodes.every(n=>n.position.y===3),"drag commit must honor the chosen elevation, not the ground pick's own y");
    const feedbackCount=calls.feedback.length;
    handlers.onClick(event(50,40));
    assert.equal(calls.feedback.length,feedbackCount,"native trailing click must not reach the tool");
    assert.equal(captures.size,0);

    params["platform-contour"]={mode:"create",elevation:3,shape:"polygon"};
    const click=(x,z)=>{handlers.onPointerDown(event(x,z));handlers.onPointerUp(event(x,z));handlers.onClick(event(x,z));};
    click(100,100);
    handlers.onPointerDown(event(150,100));
    const input=Object.assign(new globalThis.HTMLElement(),{isContentEditable:false,closest:()=>true});
    listeners.get("keydown")({key:"Escape",target:input,preventDefault(){throw Error("text input key was intercepted");}});
    assert.equal(captures.size,1,"keys from form controls must not cancel a canvas gesture");
    listeners.get("keydown")({key:"Escape",preventDefault(){}});
    assert.equal(captures.size,0);
    handlers.onPointerUp(event(150,100));handlers.onClick(event(150,100));
    click(200,200);click(240,200);click(240,240);click(200,240);click(200,200);
    assert.equal(runtime.getAllRegionTopologies().length,2,JSON.stringify(calls.feedback));
    assert.ok(runtime.getAllRegionTopologies().flatMap(t=>t.nodes).every(n=>n.position.x<6 || n.position.x>=20));

    handlers.onPointerDown(event(300,300));
    for(const cleanup of cleanups)cleanup?.();
    assert.equal(captures.size,0);
    assert.equal(runtime.getAllRegionTopologies().length,2);
  } finally {
    delete globalThis.__platformHook;
    globalThis.window=oldWindow;
    globalThis.HTMLElement=oldHTMLElement;
    session.free();
  }
});

test("road pointer lifecycle: one selected tool creates and edits the curve, and form keys are ignored", async()=>{
  const {pathBrushTool}=await import("../src/composition/tabletop/tools/paths/path-brush-tool.ts");
  const {curvePickId}=await import("../src/features/edit-construction/index.ts");
  const f=sessionFixture(), effects=[],listeners=new Map(),captures=new Set(),cleanups=[];
  const oldWindow=globalThis.window,oldHTMLElement=globalThis.HTMLElement;
  globalThis.HTMLElement=class {};
  globalThis.window={addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)};
  globalThis.__platformHook={effects,tool:pathBrushTool};
  let pickedId;
  Object.assign(f.runtime,{
    getSnapshot:()=>({status:"ready",tableId:"pointer-road",map:{nodePositions:new Map()}}),
    subscribe:()=>()=>{},getFootprintCoverage:()=>[],
    pick:(_view,x,z)=>({point:{x:x/10,y:0,z:z/10},nodeId:pickedId}),
    clearPreview(){},showPreview(){},
  });
  const target={getBoundingClientRect:()=>({left:0,top:0}),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)};
  const params={...DEFAULT_TOOL_PARAMS,"path-brush":{...DEFAULT_TOOL_PARAMS["path-brush"],creationMode:"points",bedWidth:0.6}};
  try {
    const handlers=useConstructionPointer({activeTool:"path-brush",toolParams:params,runtime:f.runtime,history:f.ctx.history,tableId:"pointer-road",viewId:"view",snapToGrid:false,onSelectionChange(){},onFeedbackChange:v=>f.calls.feedback.push(v)});
    for(const effect of effects)cleanups.push(effect());
    const event=(x,z)=>({button:0,pointerId:1,currentTarget:target,clientX:x,clientY:z});
    const draw=(a,b)=>{handlers.onPointerDown(event(...a));handlers.onPointerUp(event(...b));handlers.onClick(event(...b));};
    const blank=f.session.snapshot_json();
    draw([0,0],[20,20]);draw([100,0],[110,-20]);
    assert.equal(f.session.snapshot_json(),blank);
    const input=Object.assign(new globalThis.HTMLElement(),{isContentEditable:false,closest:()=>true});
    listeners.get("keydown")({key:"Enter",target:input,preventDefault(){throw Error("input consumed");}});
    assert.equal(f.session.snapshot_json(),blank);
    listeners.get("keydown")({key:"Enter",preventDefault(){}});
    const edge=f.runtime.getGraphSnapshot().edges.find(e=>e.curve);
    assert.ok(edge,JSON.stringify(f.calls.feedback));
    pickedId=edge.startNodeId;
    handlers.onPointerDown(event(0,0));pickedId=undefined;
    handlers.onPointerUp(event(30,30));handlers.onClick(event(30,30));
    assert.deepEqual(f.runtime.getGraphSnapshot().nodes.find(n=>n.id===edge.startNodeId).position,{x:3,y:0,z:3});
    assert.equal(f.runtime.getGraphSnapshot().edges.filter(e=>e.curve).length,1);
    assert.equal(captures.size,0);
  }finally{
    for(const cleanup of cleanups)cleanup?.();
    delete globalThis.__platformHook;globalThis.window=oldWindow;globalThis.HTMLElement=oldHTMLElement;f.session.free();
  }
});
