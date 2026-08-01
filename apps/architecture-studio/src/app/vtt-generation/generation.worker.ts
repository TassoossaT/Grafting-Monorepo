/// <reference lib="webworker" />

// Dedicated Worker (DEC-015: Wasm/compute runs off the main thread). Loads
// the wasm-pack "web" target output for grafting-vtt-generation-wasm as a
// static asset (populated by scripts/copy-wasm-assets.mjs) and calls its one
// real exported function, mirroring layout.worker.ts's already-proven
// pattern for the Graph IR explorer's Rust layout worker.

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

// Shape of wasm-pack's "web" target glue
// (packages/vtt-generation-wasm/pkg/grafting_vtt_generation_wasm.d.ts),
// asserted by hand: the module is a static asset fetched at runtime from
// public/vtt-generation-wasm-pkg/, not a file the TS project resolves at
// build time.
interface VttGenerationWasmModule {
  default: () => Promise<unknown>;
  generate_heightmap: (width: number, height: number, seed: number, scale: number) => Float32Array;
}

const wasmReady = (async (): Promise<VttGenerationWasmModule> => {
  const wasmPkgUrl = "/vtt-generation-wasm-pkg/grafting_vtt_generation_wasm.js";
  const wasm = (await import(/* webpackIgnore: true */ wasmPkgUrl)) as VttGenerationWasmModule;
  await wasm.default();
  return wasm;
})();

ctx.onmessage = async (event: MessageEvent<HeightmapWorkerRequest>) => {
  if (event.data.type !== "generate") return;

  try {
    const wasm = await wasmReady;
    const { width, height, seed, scale } = event.data;
    const values = wasm.generate_heightmap(width, height, seed, scale);
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
