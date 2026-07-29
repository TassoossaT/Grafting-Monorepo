import initializeWasm, { layout_graph_json } from "@grafting/isekai-wasm";
import type {
  GraphLayoutSnapshot,
  GraphLayoutWorkerRequest,
  GraphLayoutWorkerResponse,
} from "./layout-client.js";

interface WorkerScope {
  onmessage: ((event: MessageEvent<GraphLayoutWorkerRequest>) => void) | null;
  postMessage(message: GraphLayoutWorkerResponse): void;
}

const workerScope = globalThis as unknown as WorkerScope;
const wasmReady = initializeWasm();

workerScope.onmessage = async (event) => {
  if (event.data.type !== "layout") return;

  try {
    await wasmReady;
    const snapshot = JSON.parse(
      layout_graph_json(JSON.stringify(event.data.request)),
    ) as GraphLayoutSnapshot;
    workerScope.postMessage({ type: "result", snapshot });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
