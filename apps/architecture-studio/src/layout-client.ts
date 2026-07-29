export interface GraphLayoutOptions {
  readonly nodeWidth: number;
  readonly nodeHeight: number;
  readonly horizontalGap: number;
  readonly verticalGap: number;
  readonly groupGap: number;
  readonly padding: number;
  readonly groupColumns: number;
  readonly memberColumns: number;
}

export interface GraphLayoutEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

export interface GraphLayoutRequest {
  readonly nodes: readonly string[];
  readonly edges: readonly GraphLayoutEdge[];
  readonly groupingEdgeIds: readonly string[];
  readonly options: GraphLayoutOptions;
}

export interface GraphLayoutPosition {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface GraphLayoutSnapshot {
  readonly positions: readonly GraphLayoutPosition[];
  readonly width: number;
  readonly height: number;
}

export interface GraphLayoutWorkerRequest {
  readonly type: "layout";
  readonly request: GraphLayoutRequest;
}

export type GraphLayoutWorkerResponse =
  | { readonly type: "result"; readonly snapshot: GraphLayoutSnapshot }
  | { readonly type: "error"; readonly message: string };

/** Runs one Rust-owned graph layout operation outside the browser UI thread. */
export function requestGraphLayout(request: GraphLayoutRequest): Promise<GraphLayoutSnapshot> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
    const finish = () => worker.terminate();

    worker.onmessage = (event: MessageEvent<GraphLayoutWorkerResponse>) => {
      finish();
      if (event.data.type === "result") {
        resolve(event.data.snapshot);
      } else {
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "The graph layout worker failed."));
    };
    worker.postMessage({ type: "layout", request } satisfies GraphLayoutWorkerRequest);
  });
}
