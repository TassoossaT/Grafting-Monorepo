/// <reference lib="webworker" />

// Dedicated Worker (DEC-015: Wasm/compute runs off the main thread). Runs
// the generation-wasm heightmap seed and the terrain-quantization crate in
// sequence, both as normal workspace dependencies (DEC-055/ADR-0017), and
// posts back both the continuous and quantized arrays so the client can
// compare them side by side.

import initGeneration, { generate_heightmap } from "@grafting/vtt-generation-wasm";
import initQuantization, { quantize_heightmap } from "@grafting/vtt-terrain-quantization";

export interface QuantizationWorkerRequest {
  readonly type: "generate";
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly scale: number;
  readonly levels: number;
}

export type QuantizationWorkerResponse =
  | {
      readonly type: "result";
      readonly width: number;
      readonly height: number;
      readonly levels: number;
      readonly continuous: Float32Array;
      readonly quantized: Int32Array;
    }
  | { readonly type: "error"; readonly message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const wasmReady = Promise.all([initGeneration(), initQuantization()]);

ctx.onmessage = async (event: MessageEvent<QuantizationWorkerRequest>) => {
  if (event.data.type !== "generate") return;

  try {
    await wasmReady;
    const { width, height, seed, scale, levels } = event.data;
    const continuous = generate_heightmap(width, height, seed, scale);
    const quantized = quantize_heightmap(continuous, levels);
    const response: QuantizationWorkerResponse = { type: "result", width, height, levels, continuous, quantized };
    ctx.postMessage(response, [continuous.buffer, quantized.buffer]);
  } catch (error) {
    const response: QuantizationWorkerResponse = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(response);
  }
};
