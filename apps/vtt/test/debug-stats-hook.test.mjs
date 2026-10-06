import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { clearRecentCommits, timeCommit } from "../src/composition/tabletop/commit-timing.ts";

const hookUrl=new URL("../src/composition/tabletop/use-debug-stats.ts",import.meta.url).href;
const hooks=registerHooks({resolve(spec,context,next){
 if(context.parentURL===hookUrl&&spec==="react")return {url:"data:text/javascript,"+encodeURIComponent(`
 export const useRef=v=>({current:v});
 export const useEffect=f=>globalThis.__debugHook.effects.push(f);
 export const useState=v=>{const i=globalThis.__debugHook.state.length;globalThis.__debugHook.state.push(v);return [v,value=>{const h=globalThis.__debugHook;h.state[i]=typeof value==="function"?value(h.state[i]):value;}];};
 `),shortCircuit:true};return next(spec,context);
}});
const {useDebugStats}=await import(hookUrl);hooks.deregister();

test("debug observations have distinct identities even when commits leave the same map revision",()=>{
 const saved=Object.fromEntries(["requestAnimationFrame","cancelAnimationFrame","setTimeout","clearTimeout","setInterval","clearInterval"].map(k=>[k,globalThis[k]]));
 const h={effects:[],state:[],timers:new Map()},cleanups=[];let sequence=0;
 globalThis.__debugHook=h;clearRecentCommits();
 try {
  globalThis.requestAnimationFrame=()=>++sequence;globalThis.cancelAnimationFrame=()=>{};
  globalThis.setTimeout=f=>{const id=++sequence;h.timers.set(id,f);return id;};globalThis.clearTimeout=id=>h.timers.delete(id);
  globalThis.setInterval=()=>++sequence;globalThis.clearInterval=()=>{};
  let notify;const runtime={getSnapshot:()=>({status:"ready",map:{revision:5}}),getGraphSnapshot:()=>({nodes:[{id:"a",position:{x:0,y:0,z:0}}],edges:[]}),getAllRegionTopologies:()=>[],subscribe:f=>{notify=f;return ()=>{};}};
  useDebugStats(runtime,true);for(const effect of h.effects)cleanups.push(effect());
  const flush=()=>{const timers=[...h.timers.values()];h.timers.clear();for(const f of timers)f();};flush();
  timeCommit("first observation",()=>{});notify();flush();
  timeCommit("second observation",()=>{});notify();flush();
  const records=h.state[2].changes;assert.equal(records.length,3);assert.deepEqual(records.map(r=>r.revision),[5,5,5]);assert.equal(new Set(records.map(r=>r.id)).size,3);
 } finally {for(const cleanup of cleanups)cleanup?.();Object.assign(globalThis,saved);delete globalThis.__debugHook;clearRecentCommits();}
});
