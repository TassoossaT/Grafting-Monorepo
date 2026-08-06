// Thin app-owned batch boundary to the Rust evaluation ordering, mirroring
// `src/layout-client.ts`. Ordering and cycle detection are Rust-owned
// (DEC-051); nothing here reimplements either.

/** One directed connection described for the ordering request. */
export interface EvaluationOrderEdge {
  /** Stable connection identity. */
  readonly id: string;
  /** Producing node. */
  readonly source: string;
  /** Consuming node. */
  readonly target: string;
}

/** Batched ordering request. */
export interface EvaluationOrderRequest {
  /** Every node identity in the graph. */
  readonly nodes: readonly string[];
  /** Every connection between them. */
  readonly edges: readonly EvaluationOrderEdge[];
}

/**
 * Rust's answer.
 *
 * A cycle is a normal authoring state rather than a failure, so it arrives as
 * a result the surface can explain by naming the blocked nodes.
 */
export type EvaluationOrderResult =
  | { readonly outcome: "ordered"; readonly order: readonly string[] }
  | { readonly outcome: "cyclic"; readonly blocked: readonly string[] };

/** Message sent to the ordering worker. */
export interface EvaluationOrderWorkerRequest {
  readonly type: "order";
  readonly request: EvaluationOrderRequest;
}

/** Message returned by the ordering worker. */
export type EvaluationOrderWorkerResponse =
  | { readonly type: "result"; readonly result: EvaluationOrderResult }
  | { readonly type: "error"; readonly message: string };

/**
 * Runs one Rust-owned evaluation ordering outside the browser UI thread.
 *
 * @param request - Nodes and connections to order.
 * @returns The deterministic order, or the nodes a cycle leaves blocked.
 */
export function requestEvaluationOrder(
  request: EvaluationOrderRequest,
): Promise<EvaluationOrderResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./evaluation-order.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => worker.terminate();

    worker.onmessage = (event: MessageEvent<EvaluationOrderWorkerResponse>) => {
      finish();
      if (event.data.type === "result") resolve(event.data.result);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "The evaluation ordering worker failed."));
    };
    worker.postMessage({ type: "order", request } satisfies EvaluationOrderWorkerRequest);
  });
}
