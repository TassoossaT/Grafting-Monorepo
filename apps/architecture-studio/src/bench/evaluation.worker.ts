/// <reference lib="webworker" />

// Dedicated Worker (DEC-015: Wasm/compute runs off the main thread). Unlike
// the one-shot layout and ordering workers, this one is long-lived: it owns
// the result cache keyed by the plan's content hashes, so whole grids stay
// here and only the requested previews are transferred to the main thread.

import initGeneration, { generate_heightmap } from "@grafting/procgen-generation-wasm";
import initDiscretize, { discretize } from "@grafting/procgen-discretize";
import type {
  EvaluationOutcome,
  EvaluationPreview,
  EvaluationWorkerRequest,
  EvaluationWorkerResponse,
} from "./evaluation-client.ts";
import { createBenchEvaluators, type BenchValue } from "./evaluators.ts";
import { previewTransferables, toEvaluationPreview } from "./preview.ts";

interface WorkerScope {
  onmessage: ((event: MessageEvent<EvaluationWorkerRequest>) => void) | null;
  postMessage(message: EvaluationWorkerResponse, transfer?: readonly Transferable[]): void;
}

const workerScope = globalThis as unknown as WorkerScope;

const wasmReady = Promise.all([initGeneration(), initDiscretize()]);

const evaluators = createBenchEvaluators({
  generateHeightmap: (width, height, seed, scale) => generate_heightmap(width, height, seed, scale),
  discretize: (values, levels) => discretize(values, levels),
});

/** Results by content hash. Two nodes with the same hash share one entry. */
const cache = new Map<string, BenchValue>();

workerScope.onmessage = async (event) => {
  if (event.data.type !== "evaluate") return;
  const { id, request } = event.data;

  try {
    await wasmReady;

    const evaluated: string[] = [];
    const reused: string[] = [];
    const failures: Record<string, string> = {};
    const blocked = new Set<string>();

    for (const step of request.plan.steps) {
      if (cache.has(step.hash)) {
        reused.push(step.nodeId);
        continue;
      }

      const inputs: Record<string, BenchValue> = {};
      let missing = false;
      for (const [port, hash] of Object.entries(step.inputs)) {
        const value = cache.get(hash);
        // An input hash with no cached value means its producer failed earlier
        // in this same pass; running anyway would only produce a second,
        // more confusing error.
        if (value === undefined) missing = true;
        else inputs[port] = value;
      }
      if (missing) {
        blocked.add(step.nodeId);
        continue;
      }

      const evaluator = evaluators.get(step.kindId);
      if (evaluator === undefined) {
        failures[step.nodeId] = `No evaluator is registered for ${step.kindId}.`;
        continue;
      }

      try {
        cache.set(step.hash, evaluator(inputs, step.params));
        evaluated.push(step.nodeId);
      } catch (error) {
        failures[step.nodeId] = error instanceof Error ? error.message : String(error);
      }
    }

    const previews: Record<string, EvaluationPreview> = {};
    const transfer: Transferable[] = [];
    for (const nodeId of request.previewNodeIds) {
      const hash = request.plan.hashes[nodeId];
      const value = hash === undefined ? undefined : cache.get(hash);
      if (value === undefined) continue;
      const preview = toEvaluationPreview(value);
      if (preview === null) continue;
      previews[nodeId] = preview;
      transfer.push(...previewTransferables(preview));
    }

    // The plan names every result still reachable, so anything else is from a
    // node or a setting the user has since changed and cannot be asked for again.
    const live = new Set(request.plan.steps.map((step) => step.hash));
    for (const hash of [...cache.keys()]) {
      if (!live.has(hash)) cache.delete(hash);
    }

    const outcome: EvaluationOutcome = {
      evaluated,
      reused,
      previews,
      failures: {
        ...failures,
        ...Object.fromEntries(
          [...blocked].map((nodeId) => [nodeId, "An element upstream of this one failed."]),
        ),
      },
    };
    workerScope.postMessage({ type: "result", id, outcome }, transfer);
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
