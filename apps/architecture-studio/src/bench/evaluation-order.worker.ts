/// <reference lib="webworker" />

// Dedicated Worker (DEC-015: Wasm/compute runs off the main thread), same
// shape as `src/layout.worker.ts`. @grafting/isekai-wasm is a normal
// workspace dependency (DEC-055/ADR-0017).

import init, { evaluation_order_json } from "@grafting/isekai-wasm";
import type {
  EvaluationOrderResult,
  EvaluationOrderWorkerRequest,
  EvaluationOrderWorkerResponse,
} from "./evaluation-order-client.ts";

interface WorkerScope {
  onmessage: ((event: MessageEvent<EvaluationOrderWorkerRequest>) => void) | null;
  postMessage(message: EvaluationOrderWorkerResponse): void;
}

const workerScope = globalThis as unknown as WorkerScope;

const wasmReady = init();

workerScope.onmessage = async (event) => {
  if (event.data.type !== "order") return;

  try {
    await wasmReady;
    const result = JSON.parse(
      evaluation_order_json(JSON.stringify(event.data.request)),
    ) as EvaluationOrderResult;
    workerScope.postMessage({ type: "result", result });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
