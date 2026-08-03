import init, { layout_graph_json } from "@grafting/isekai-wasm";
import type {
  GraphLayoutSnapshot,
  GraphLayoutWorkerRequest,
  GraphLayoutWorkerResponse,
} from "./layout-client.ts";

interface WorkerScope {
  onmessage: ((event: MessageEvent<GraphLayoutWorkerRequest>) => void) | null;
  postMessage(message: GraphLayoutWorkerResponse): void;
}

const workerScope = globalThis as unknown as WorkerScope;

// @grafting/isekai-wasm is a normal workspace dependency (DEC-055/ADR-0017
// -- libs/isekai/wasm-bridge's own package.json postinstall regenerates
// its `pkg/` on `pnpm install`; no separate technical package, no
// static-asset copy step). Next.js's own bundler resolves and packages the
// Wasm module for this Worker.
const wasmReady = init();

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
