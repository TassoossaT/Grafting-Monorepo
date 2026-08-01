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

// Shape of wasm-pack's "web" target glue (packages/isekai-wasm/pkg/grafting_isekai_wasm.d.ts),
// asserted by hand: the module is a static asset fetched at runtime from
// public/wasm-pkg/ (populated by scripts/copy-wasm-assets.mjs), not a file
// the TS project resolves at build time. This mirrors
// spikes/wasm-worker-nextjs/web/app/spike.worker.ts's already-proven pattern.
interface IsekaiWasmModule {
  default: () => Promise<unknown>;
  layout_graph_json: (requestJson: string) => string;
}

const wasmReady = (async (): Promise<IsekaiWasmModule> => {
  // `webpackIgnore` keeps the bundler from statically resolving this as a
  // build-time module; held in a variable (not a literal) so TypeScript
  // treats the specifier as dynamic instead of trying to resolve it as a
  // project file.
  const wasmPkgUrl = "/wasm-pkg/grafting_isekai_wasm.js";
  const wasm = (await import(/* webpackIgnore: true */ wasmPkgUrl)) as IsekaiWasmModule;
  await wasm.default();
  return wasm;
})();

workerScope.onmessage = async (event) => {
  if (event.data.type !== "layout") return;

  try {
    const wasm = await wasmReady;
    const snapshot = JSON.parse(
      wasm.layout_graph_json(JSON.stringify(event.data.request)),
    ) as GraphLayoutSnapshot;
    workerScope.postMessage({ type: "result", snapshot });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
