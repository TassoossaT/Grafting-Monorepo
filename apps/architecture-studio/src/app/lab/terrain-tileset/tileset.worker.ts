/// <reference lib="webworker" />

// Dedicated Worker (DEC-015: Wasm/compute runs off the main thread). Loads
// @grafting/procgen-tileset-wfc as a normal workspace dependency
// (DEC-055/ADR-0017 -- the crate's own package.json postinstall regenerates
// its `pkg/` on `pnpm install`).
//
// Running the solve here is not only policy. Proving a tileset unsatisfiable
// is not a bounded search: the crate rejects the cheap cases up front, but a
// composer lets someone write constraints that are contradictory in a way no
// cheap check catches, and on the main thread that would freeze the page
// rather than merely take a while.

import init, { solveTileset } from "@grafting/procgen-tileset-wfc";

export interface TilesetWorkerRequest {
  readonly type: "solve";
  readonly cellCount: number;
  readonly facesPerCell: number;
  readonly links: Uint32Array;
  readonly sockets: Uint32Array;
  readonly weights: Float32Array;
  readonly compatible: Uint32Array;
  readonly rotationCycle: Uint32Array;
  readonly pinned: Uint32Array;
  readonly seed: number;
}

export type TilesetWorkerResponse =
  | {
      readonly type: "result";
      /** The authored module chosen for each cell. */
      readonly sources: Uint32Array;
      /** How far that module is turned, per cell. */
      readonly turns: Uint32Array;
      /** How many variants the authored modules expanded into. */
      readonly variantCount: number;
      readonly elapsedMs: number;
    }
  | { readonly type: "error"; readonly message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const wasmReady = init();

ctx.onmessage = async (event: MessageEvent<TilesetWorkerRequest>) => {
  if (event.data.type !== "solve") return;

  try {
    await wasmReady;
    const request = event.data;
    const started = performance.now();
    const solution = solveTileset(
      request.cellCount,
      request.facesPerCell,
      request.links,
      request.sockets,
      request.weights,
      request.compatible,
      request.rotationCycle,
      request.pinned,
      request.seed,
    );

    // The getters read out of Wasm memory, so copy before freeing.
    const sources = Uint32Array.from(solution.sources);
    const turns = Uint32Array.from(solution.turns);
    const variantCount = solution.variantCount;
    solution.free();

    const response: TilesetWorkerResponse = {
      type: "result",
      sources,
      turns,
      variantCount,
      elapsedMs: performance.now() - started,
    };
    ctx.postMessage(response, [sources.buffer, turns.buffer]);
  } catch (error) {
    const response: TilesetWorkerResponse = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(response);
  }
};
