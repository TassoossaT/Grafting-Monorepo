/// <reference lib="webworker" />

// Dedicated Worker (DEC-015: Wasm/compute runs off the main thread). Loads
// @grafting/procgen-generation-wasm as a normal workspace dependency
// (DEC-055/ADR-0017 -- the crate's own package.json postinstall regenerates
// its `pkg/` on `pnpm install`; no separate technical package, no
// static-asset copy step) and calls its one real exported function.

import init, { generate_heightmap } from "@grafting/procgen-generation-wasm";

export interface HeightmapWorkerRequest {
  readonly type: "generate";
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly scale: number;
}

export type HeightmapWorkerResponse =
  | { readonly type: "result"; readonly width: number; readonly height: number; readonly values: Float32Array }
  | { readonly type: "error"; readonly message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const wasmReady = init();

ctx.onmessage = async (event: MessageEvent<HeightmapWorkerRequest>) => {
  if (event.data.type !== "generate") return;

  try {
    await wasmReady;
    const { width, height, seed, scale } = event.data;
    const values = generate_heightmap(width, height, seed, scale);
    const response: HeightmapWorkerResponse = { type: "result", width, height, values };
    ctx.postMessage(response, [values.buffer]);
  } catch (error) {
    const response: HeightmapWorkerResponse = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(response);
  }
};
