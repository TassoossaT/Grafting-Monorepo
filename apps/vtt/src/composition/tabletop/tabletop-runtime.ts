export type TabletopRuntimeStatus = "idle" | "starting" | "ready" | "disposed";

export interface TabletopSnapshot {
  readonly revision: number;
  readonly status: TabletopRuntimeStatus;
  readonly tableId: string;
}

export type TabletopRuntimeListener = () => void;

export interface TabletopRuntime {
  start(): Promise<void>;
  getSnapshot(): TabletopSnapshot;
  subscribe(listener: TabletopRuntimeListener): () => void;
  dispose(): Promise<void>;
}

const snapshot = (
  tableId: string,
  status: TabletopRuntimeStatus,
  revision: number,
): TabletopSnapshot => Object.freeze({ revision, status, tableId });

export class AppTabletopRuntime implements TabletopRuntime {
  readonly #listeners = new Set<TabletopRuntimeListener>();
  readonly #tableId: string;
  #generation = 0;
  #snapshot: TabletopSnapshot;

  constructor(tableId: string) {
    const normalizedTableId = tableId.trim();
    if (normalizedTableId.length === 0) {
      throw new Error("tableId must not be empty");
    }

    this.#tableId = normalizedTableId;
    this.#snapshot = snapshot(this.#tableId, "idle", 0);
  }

  async start(): Promise<void> {
    if (this.#snapshot.status === "starting" || this.#snapshot.status === "ready") {
      throw new Error(`tabletop runtime is already ${this.#snapshot.status}`);
    }

    const generation = ++this.#generation;
    this.#publish("starting");

    // The first slice has no external adapter yet. Keeping this asynchronous
    // makes the lifecycle contract stable when session/render adapters arrive.
    await Promise.resolve();

    if (generation !== this.#generation) return;
    this.#publish("ready");
  }

  getSnapshot = (): TabletopSnapshot => this.#snapshot;

  subscribe = (listener: TabletopRuntimeListener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  async dispose(): Promise<void> {
    if (this.#snapshot.status === "disposed") return;

    this.#generation += 1;
    this.#publish("disposed");
    this.#listeners.clear();
  }

  #publish(status: TabletopRuntimeStatus): void {
    if (this.#snapshot.status === status) return;

    this.#snapshot = snapshot(this.#tableId, status, this.#snapshot.revision + 1);
    for (const listener of this.#listeners) listener();
  }
}
