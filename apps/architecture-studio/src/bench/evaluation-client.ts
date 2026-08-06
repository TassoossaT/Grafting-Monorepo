import type { EvaluationPlan } from "./evaluation-plan.ts";

// Unlike the layout and ordering boundaries, this worker is long-lived. It
// owns the result cache, and intermediate values -- which are whole grids --
// never cross to the main thread at all. Only the previews the surface asked
// for are transferred back.

/** A node's result, flattened into something the heightfield renderer accepts. */
export interface EvaluationPreview {
  /** Cells along the horizontal axis. */
  readonly width: number;
  /** Cells along the vertical axis. */
  readonly height: number;
  /** Normalized to zero-to-one so any value kind renders on the same scale. */
  readonly values: Float32Array;
  /** The value kind this preview was flattened from. */
  readonly dataType: string;
}

/** One evaluation pass and the previews the surface wants back. */
export interface EvaluationRequest {
  /** Executions in dependency order. */
  readonly plan: EvaluationPlan;
  /** Nodes whose results should be returned for rendering. */
  readonly previewNodeIds: readonly string[];
}

/** What one pass produced. */
export interface EvaluationOutcome {
  /** Nodes that actually ran. */
  readonly evaluated: readonly string[];
  /** Nodes served from cache without running. */
  readonly reused: readonly string[];
  /** Requested previews, by node identity. */
  readonly previews: Readonly<Record<string, EvaluationPreview>>;
  /** Node identity to the message explaining why it failed, when one did. */
  readonly failures: Readonly<Record<string, string>>;
}

/** Message sent to the evaluation worker. */
export interface EvaluationWorkerRequest {
  readonly type: "evaluate";
  readonly id: number;
  readonly request: EvaluationRequest;
}

/** Message returned by the evaluation worker. */
export type EvaluationWorkerResponse =
  | { readonly type: "result"; readonly id: number; readonly outcome: EvaluationOutcome }
  | { readonly type: "error"; readonly id: number; readonly message: string };

interface PendingEvaluation {
  readonly resolve: (outcome: EvaluationOutcome) => void;
  readonly reject: (error: Error) => void;
}

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<number, PendingEvaluation>();

const failAll = (message: string) => {
  for (const entry of pending.values()) entry.reject(new Error(message));
  pending.clear();
};

function ensureWorker(): Worker {
  if (worker !== null) return worker;
  const created = new Worker(new URL("./evaluation.worker.ts", import.meta.url), { type: "module" });
  created.onmessage = (event: MessageEvent<EvaluationWorkerResponse>) => {
    const entry = pending.get(event.data.id);
    if (entry === undefined) return;
    pending.delete(event.data.id);
    if (event.data.type === "result") entry.resolve(event.data.outcome);
    else entry.reject(new Error(event.data.message));
  };
  created.onerror = (event) => {
    // The cache dies with the worker, so the next call starts a fresh one and
    // simply recomputes; a lost cache is slow, not wrong.
    failAll(event.message || "The bench evaluation worker failed.");
    created.terminate();
    worker = null;
  };
  worker = created;
  return created;
}

/**
 * Runs one evaluation pass in the long-lived bench worker.
 *
 * @param request - The plan and the previews to return.
 * @returns What ran, what was reused, the requested previews, and any failures.
 */
export function requestEvaluation(request: EvaluationRequest): Promise<EvaluationOutcome> {
  return new Promise<EvaluationOutcome>((resolve, reject) => {
    const id = (nextRequestId += 1);
    pending.set(id, { resolve, reject });
    ensureWorker().postMessage({ type: "evaluate", id, request } satisfies EvaluationWorkerRequest);
  });
}

/**
 * Discards the worker and everything it has cached.
 *
 * Called when the bench unmounts so a long session does not keep whole grids
 * alive behind a page the user has left.
 */
export function disposeEvaluation(): void {
  failAll("The bench evaluation worker was disposed.");
  worker?.terminate();
  worker = null;
}
