// Idiomatic Worker/Promise wrapper over `@grafting/isekai-wasm` (master
// source S9.2/S9.3). Never exposes memory offsets/handles to callers --
// those stay internal to `worker.ts`.

import type { WorkerRequest, WorkerResponse } from "./protocol.js";

export interface IncrementResult {
  newValue: bigint;
  stateHash: Uint8Array;
}

/** `poisoned: true` means this specific engine is dead (a Wasm panic or
 * an unexpected lifecycle rejection, see `worker.ts`'s docs) -- create a
 * fresh `IsekaiEngine` rather than retrying. */
export class EngineError extends Error {
  constructor(
    message: string,
    public readonly poisoned: boolean,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class IsekaiEngine {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private dead = false;

  private constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = (event: ErrorEvent) => {
      this.handleCrash(event.message);
    };
  }

  /** One Worker, one Wasm engine (this package's V1 scope -- see README).
   * `seed` must be exactly 32 bytes, caller-visible and caller-controlled
   * on purpose (DEC-044), matching the native/Wasm engines' own seed. */
  static async create(seed: Uint8Array): Promise<IsekaiEngine> {
    if (seed.length !== 32) {
      throw new RangeError("seed must be exactly 32 bytes");
    }
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    const engine = new IsekaiEngine(worker);
    await engine.send({ type: "init", id: engine.nextId++, seed });
    return engine;
  }

  /** One `postMessage` round trip = one Promise (S9.3's "Promise per
   * job") -- `increment` completes in microseconds inside Wasm, so there
   * is no meaningful mid-flight cancellation to offer here; cooperative
   * cancellation remains open for future long-running jobs. */
  async increment(amount: bigint): Promise<IncrementResult> {
    if (this.dead) {
      throw new EngineError("engine is dead (poisoned or crashed)", true);
    }
    const id = this.nextId++;
    const result = await this.send({ type: "increment", id, amount });
    return result as IncrementResult;
  }

  /** Voluntary shutdown (distinct from an unexpected crash, handled by
   * `onerror` below) -- rejects any still-outstanding Promises cleanly. */
  terminate(): void {
    this.dead = true;
    for (const { reject } of this.pending.values()) {
      reject(new EngineError("engine terminated", false));
    }
    this.pending.clear();
    this.worker.terminate();
  }

  private send(request: WorkerRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  private handleMessage(response: WorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);

    switch (response.type) {
      case "init-ok":
        pending.resolve(undefined);
        break;
      case "init-error":
        this.dead = true;
        pending.reject(new EngineError(response.message, false));
        break;
      case "increment-ok":
        pending.resolve({ newValue: response.newValue, stateHash: response.stateHash });
        break;
      case "increment-error":
        if (response.poisoned) {
          this.dead = true;
        }
        pending.reject(new EngineError(response.message, response.poisoned));
        break;
    }
  }

  /** S14.1/S19.5: handle Worker *crash*, not just voluntary termination
   * -- an unexpected failure outside the normal message protocol (e.g.
   * the Worker script itself throwing) must still reject outstanding
   * Promises instead of leaving them hanging forever. */
  private handleCrash(message: string): void {
    this.dead = true;
    for (const { reject } of this.pending.values()) {
      reject(new EngineError(`worker crashed: ${message}`, true));
    }
    this.pending.clear();
  }
}
