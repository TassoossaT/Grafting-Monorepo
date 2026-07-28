/// <reference lib="webworker" />

// Dedicated Worker owning exactly one WasmEngine (DEC-015; "one Worker =
// one Engine" is this package's own V1 scope decision, not a
// `isekai-wasm` limitation -- see that crate's README).
//
// Panic handling: `isekai-wasm::WasmEngine`'s module docs establish
// (empirically, not assumed) that a Rust panic on wasm32 can't be caught
// by Rust itself -- it surfaces here as a thrown JS exception from
// whichever call was in flight, and permanently poisons that specific
// WasmEngine instance (wasm-bindgen's own per-object guard), while
// leaving the rest of the Wasm module/memory untouched. Since a "normal"
// Result::Err from Rust (e.g. calling submit_increment on an engine
// that's already been shut down) *also* surfaces as a thrown JS
// exception -- wasm-bindgen converts any Err into a throw the same way --
// this Worker deliberately does not try to distinguish the two: **any**
// thrown exception from a WasmEngine call marks this Worker's engine
// dead. That's a conservative, safe simplification (occasionally
// over-classifying an ordinary lifecycle rejection as "poisoned"), not a
// precise diagnosis -- a fresh engine (a fresh Worker, via
// `IsekaiEngine.create()`) is the correct recovery either way.

import * as wasmModuleImport from "@grafting/isekai-wasm";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";

// A normal static import: unlike spike 1's runtime-fetched static asset
// (which needed a `webpackIgnore`-guarded dynamic import to dodge
// build-time resolution), `@grafting/isekai-wasm` is a real, resolvable
// workspace package -- both Vite/Vitest (this package's own tests) and
// Next.js's bundler (the eventual real consumer) resolve it normally at
// build time.
type WasmModule = typeof wasmModuleImport;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let wasmModule: WasmModule | null = null;
let engine: InstanceType<WasmModule["WasmEngine"]> | null = null;
let dead = false;

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === "init") {
    try {
      await wasmModuleImport.default();
      engine = new wasmModuleImport.WasmEngine(msg.seed);
      wasmModule = wasmModuleImport;
      const response: WorkerResponse = { type: "init-ok", id: msg.id };
      ctx.postMessage(response);
    } catch (err) {
      dead = true;
      const response: WorkerResponse = {
        type: "init-error",
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
      };
      ctx.postMessage(response);
    }
    return;
  }

  if (msg.type === "increment") {
    if (dead || !engine || !wasmModule) {
      const response: WorkerResponse = {
        type: "increment-error",
        id: msg.id,
        message: "engine is dead or was never initialized",
        poisoned: true,
      };
      ctx.postMessage(response);
      return;
    }

    try {
      const job = engine.submit_increment(msg.amount);
      const state = engine.poll(job);

      if (state !== wasmModule.JobStateCode.Completed) {
        engine.job_release(job);
        const response: WorkerResponse = {
          type: "increment-error",
          id: msg.id,
          message: "command was rejected (e.g. overflow) -- not a poisoning event",
          poisoned: false,
        };
        ctx.postMessage(response);
        return;
      }

      const buffer = engine.take_result(job);
      const bytes = engine.buffer_view(buffer);
      engine.buffer_release(buffer);
      engine.job_release(job);

      const newValue = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0, true);
      const stateHash = bytes.slice(8, 40);

      const response: WorkerResponse = { type: "increment-ok", id: msg.id, newValue, stateHash };
      ctx.postMessage(response, [stateHash.buffer]);
    } catch (err) {
      // Any throw here (panic-poisoning or an unexpected lifecycle
      // rejection) permanently retires this Worker's engine -- see the
      // module doc comment above.
      dead = true;
      const response: WorkerResponse = {
        type: "increment-error",
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
        poisoned: true,
      };
      ctx.postMessage(response);
    }
  }
};
