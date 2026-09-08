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
  globalThis.window={addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:(k)=>listeners.delete(k)};
  globalThis.__platformHook={effects,tool:platformContourTool};
  Object.assign(runtime,{
    getSnapshot:()=>({status:"ready"}),
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
    listeners.get("keydown")({key:"Escape"});
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
    session.free();
  }
});
