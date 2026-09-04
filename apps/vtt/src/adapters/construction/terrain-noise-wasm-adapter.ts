// Wraps `@grafting/procgen-generation-wasm`'s `generate_heightmap` behind
// `TerrainNoisePort`. A separate Wasm module from
// `@grafting/procgen-construction-wasm` (no shared state), so it gets its
// own adapter/init lifecycle rather than being folded into
// `ConstructionSessionWasmAdapter`.

import initGeneration, { generate_heightmap } from "@grafting/procgen-generation-wasm";

import type { TerrainNoisePort } from "@/ports";

class TerrainNoiseWasmAdapter implements TerrainNoisePort {
  #started = false;

  async start(): Promise<void> {
    if (this.#started) throw new Error("terrain noise adapter is already started");
    await initGeneration();
    this.#started = true;
  }

  generateHeightmap(
    width: number,
    height: number,
    seed: number,
    scale: number,
    originX: number,
    originY: number,
  ): Float32Array {
    if (!this.#started) throw new Error("terrain noise adapter is not started");
    return generate_heightmap(width, height, seed, scale, originX, originY);
  }
}

export function createTerrainNoiseAdapter(): TerrainNoisePort {
  return new TerrainNoiseWasmAdapter();
}
