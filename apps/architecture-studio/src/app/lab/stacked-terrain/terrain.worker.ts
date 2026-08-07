/// <reference lib="webworker" />

// Dedicated Worker (DEC-015: Wasm/compute runs off the main thread). Takes the
// irregular grid's cell centres, generates a noise heightfield, reads it at
// each centre, and quantises the result into discrete levels.
//
// Both Rust crates are called through their real APIs as normal workspace
// dependencies (DEC-055/ADR-0017). The quantisation stays the `discretize`
// crate's own output rather than being recomputed here — the repository has
// one authoritative binning implementation and this is not it.

import initGeneration, { generate_heightmap } from "@grafting/procgen-generation-wasm";
import initQuantization, { discretize } from "@grafting/procgen-discretize";
import { sampleHeightfield } from "../../../vtt/stacked-terrain.ts";

export interface TerrainWorkerRequest {
  readonly type: "elevate";
  /** Normalised cell centres, `u` then `v` per cell, both in `[0, 1]`. */
  readonly centres: Float32Array;
  readonly fieldSize: number;
  readonly seed: number;
  readonly scale: number;
  readonly levels: number;
}

export type TerrainWorkerResponse =
  | {
      readonly type: "result";
      /** One discrete level per cell, in the order the centres arrived. */
      readonly levels: Int32Array;
      /** The continuous value each level came from, for the readout. */
      readonly sampled: Float32Array;
    }
  | { readonly type: "error"; readonly message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const wasmReady = Promise.all([initGeneration(), initQuantization()]);

ctx.onmessage = async (event: MessageEvent<TerrainWorkerRequest>) => {
  if (event.data.type !== "elevate") return;

  try {
    await wasmReady;
    const { centres, fieldSize, seed, scale, levels } = event.data;

    const values = generate_heightmap(fieldSize, fieldSize, seed, scale);
    const field = { width: fieldSize, height: fieldSize, values };

    // The grid is irregular and the noise is not, so nothing lines a cell
    // centre up with a sample; each one is read where it actually sits.
    const sampled = new Float32Array(centres.length / 2);
    for (let cell = 0; cell < sampled.length; cell += 1) {
      sampled[cell] = sampleHeightfield(field, centres[cell * 2] ?? 0, centres[cell * 2 + 1] ?? 0);
    }

    const discrete = discretize(sampled, levels);
    const response: TerrainWorkerResponse = { type: "result", levels: discrete, sampled };
    ctx.postMessage(response, [discrete.buffer, sampled.buffer]);
  } catch (error) {
    const response: TerrainWorkerResponse = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(response);
  }
};
