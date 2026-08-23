import type { AssetDefinition } from "../contracts/definition.js";
import type { ResourceKind, ResourceOf, ResourceRef } from "../contracts/ref.js";
import type { CatalogSource, ResourceResolver } from "../contracts/resolver.js";
import type {
  AssetStore,
  AssetStoreOptions,
  DeclarationOutcome,
  InventoryEntry,
  ResourceHandle,
  ResourceStatus,
  RetentionPolicy,
  StoreEvent,
} from "../contracts/store.js";
import { invalidReason } from "./validate-definition.js";

/**
 * One `(ref, revision)` pair's live state.
 *
 * Keyed by revision as well as ref so a definition that changes loads as a
 * distinct entry: existing holders keep serving the resource they acquired
 * until they release, which is what stops a live scene blinking mid-frame when
 * content is re-published underneath it.
 */
interface Entry {
  readonly definition: AssetDefinition;
  holders: number;
  state: "idle" | "loading" | "ready" | "failed";
  resource?: unknown;
  error?: string;
  attempts: number;
  pending?: Promise<unknown>;
  controller?: AbortController;
  bytes?: number;
  /** Monotonic release order, for eviction. A counter, not a clock: no ambient time dependency, and deterministic in tests. */
  releasedAt?: number;
}

const entryKey = (ref: ResourceRef, revision: number): string => `${ref}@${revision}`;

const IMMEDIATE: RetentionPolicy = { kind: "immediate" };

/**
 * Creates an asset store.
 *
 * Ships no resolvers and no catalog sources: a store that knew how to load
 * anything would know where things live, and this package deliberately does
 * not. Register what the environment provides.
 */
export function createAssetStore(options: AssetStoreOptions = {}): AssetStore {
  const retention = options.retention ?? IMMEDIATE;
  const definitions = new Map<string, AssetDefinition>();
  const entries = new Map<string, Entry>();
  const resolvers = new Map<ResourceKind, ResourceResolver<never>>();
  const listeners = new Set<(event: StoreEvent) => void>();
  /** Unheld but still-loaded entries, oldest release first. Empty under immediate retention. */
  const retained: string[] = [];
  let releaseCounter = 0;
  let disposed = false;

  const emit = (event: StoreEvent): void => {
    for (const listener of [...listeners]) listener(event);
  };

  const resolverFor = (kind: ResourceKind): ResourceResolver<never> => {
    const resolver = resolvers.get(kind);
    if (resolver === undefined) throw new Error(`no resolver registered for kind "${kind}"`);
    return resolver;
  };

  const disposeEntry = (key: string, entry: Entry): void => {
    if (entry.state === "ready" && entry.resource !== undefined) {
      const resolver = resolvers.get(entry.definition.kind);
      resolver?.dispose?.(entry.resource as never);
      emit({ type: "disposed", ref: entry.definition.ref });
    }
    entries.delete(key);
    const index = retained.indexOf(key);
    if (index !== -1) retained.splice(index, 1);
  };

  /** Drops retained entries, oldest release first, until the retained set fits the budget. */
  const evict = (): void => {
    if (retention.kind !== "least-recently-used") return;
    let total = 0;
    for (const key of retained) total += entries.get(key)?.bytes ?? 0;
    while (total > retention.maxBytes && retained.length > 0) {
      const key = retained[0];
      if (key === undefined) break;
      const entry = entries.get(key);
      total -= entry?.bytes ?? 0;
      if (entry !== undefined) disposeEntry(key, entry);
      else retained.shift();
    }
  };

  const onLastRelease = (key: string, entry: Entry): void => {
    // A load nobody is waiting for any more is cancelled rather than left to
    // finish into a resource with no holder -- which would otherwise allocate
    // exactly the memory the release was meant to avoid.
    if (entry.state === "loading") {
      entry.controller?.abort();
      entries.delete(key);
      return;
    }
    if (retention.kind === "immediate") {
      disposeEntry(key, entry);
      return;
    }
    releaseCounter += 1;
    entry.releasedAt = releaseCounter;
    if (!retained.includes(key)) retained.push(key);
    evict();
  };

  const startLoad = (key: string, entry: Entry): void => {
    const resolver = resolverFor(entry.definition.kind);
    const controller = new AbortController();
    entry.controller = controller;
    entry.state = "loading";
    entry.attempts += 1;
    emit({ type: "load-started", ref: entry.definition.ref });

    entry.pending = resolver
      .load(entry.definition as never, controller.signal)
      .then((resource) => {
        // The entry may have been abandoned mid-flight; disposing here rather
        // than storing it is what keeps a cancelled load from leaking.
        if (entries.get(key) !== entry) {
          resolver.dispose?.(resource as never);
          return resource;
        }
        entry.state = "ready";
        entry.resource = resource;
        entry.bytes = resolver.sizeOf?.(resource as never);
        emit({ type: "load-succeeded", ref: entry.definition.ref });
        return resource;
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (entries.get(key) === entry) {
          entry.state = "failed";
          entry.error = message;
          emit({ type: "load-failed", ref: entry.definition.ref, error: message });
        }
        // Rethrown for `whenReady`, and deliberately not retried: a store that
        // retried on its own would turn one unreachable asset into an endless
        // request loop. Retrying is the caller's explicit decision.
        throw cause instanceof Error ? cause : new Error(message);
      });
    // `whenReady` is what surfaces a failure; nothing else should see an
    // unhandled rejection just because no holder awaited this load.
    entry.pending.catch(() => {});
  };

  const handleFor = <TResource>(key: string, entry: Entry): ResourceHandle<TResource> => {
    let released = false;
    return {
      ref: entry.definition.ref,
      revision: entry.definition.revision,
      current: () => (entry.state === "ready" ? (entry.resource as TResource) : undefined),
      whenReady: async () => {
        if (entry.state === "ready") return entry.resource as TResource;
        if (entry.state === "failed") throw new Error(entry.error ?? "load failed");
        return (await entry.pending) as TResource;
      },
      release: () => {
        if (released) return;
        released = true;
        entry.holders -= 1;
        if (entry.holders <= 0) onLastRelease(key, entry);
      },
    };
  };

  /**
   * The one path a declaration takes, whether it arrived directly or from a
   * catalogue.
   *
   * Keeping the existing declaration rather than overwriting it is what makes
   * several catalogues able to coexist. A higher revision is the single
   * exception, because that is the one case meaning "this same thing changed"
   * rather than "a different thing wants this name".
   */
  const declare = (definition: AssetDefinition, sourceId?: string): DeclarationOutcome => {
    const reject = (reason: "already-declared" | "invalid", detail: string): "rejected" => {
      emit({
        type: "rejected",
        ref: typeof definition?.ref === "string" ? definition.ref : undefined,
        ...(sourceId === undefined ? {} : { sourceId }),
        reason,
        detail,
      });
      return "rejected";
    };

    const invalid = invalidReason(definition);
    if (invalid !== undefined) return reject("invalid", invalid);

    const existing = definitions.get(definition.ref);
    if (existing !== undefined) {
      if (definition.revision <= existing.revision) {
        return reject(
          "already-declared",
          `"${definition.ref}" is already declared at revision ${existing.revision}`,
        );
      }
      definitions.set(definition.ref, definition);
      emit({ type: "declared", ref: definition.ref });
      return "updated";
    }

    definitions.set(definition.ref, definition);
    emit({ type: "declared", ref: definition.ref });
    return "declared";
  };

  return {
    define(definition: AssetDefinition): DeclarationOutcome {
      return declare(definition);
    },

    async load(source: CatalogSource, signal?: AbortSignal): Promise<number> {
      const listed = await source.list(signal ?? new AbortController().signal);
      let accepted = 0;
      for (const definition of listed) {
        // `source.id` is attached here rather than inside `declare`, because
        // this is the only place that knows which catalogue an entry came
        // from -- and with several catalogues in play, "which pack did this"
        // is the first question anybody asks about a rejection.
        if (declare(definition, source.id) === "rejected") continue;
        accepted += 1;
      }
      return accepted;
    },

    registerResolver<TKind extends ResourceKind>(resolver: ResourceResolver<TKind>): void {
      if (resolvers.has(resolver.kind)) {
        throw new Error(`a resolver is already registered for kind "${resolver.kind}"`);
      }
      resolvers.set(resolver.kind, resolver as unknown as ResourceResolver<never>);
    },

    acquire<TKind extends ResourceKind>(
      ref: ResourceRef<TKind>,
    ): ResourceHandle<ResourceOf<TKind>> {
      if (disposed) throw new Error("store is disposed");
      const definition = definitions.get(ref);
      if (definition === undefined) throw new Error(`no definition declared for "${ref}"`);

      const key = entryKey(ref, definition.revision);
      let entry = entries.get(key);
      if (entry === undefined) {
        entry = { definition, holders: 0, state: "idle", attempts: 0 };
        entries.set(key, entry);
      }
      entry.holders += 1;

      // Re-acquiring something retained pulls it back out of the eviction queue
      // rather than reloading it -- the whole point of retaining it.
      const retainedIndex = retained.indexOf(key);
      if (retainedIndex !== -1) retained.splice(retainedIndex, 1);

      if (entry.state === "idle") startLoad(key, entry);
      return handleFor<ResourceOf<TKind>>(key, entry);
    },

    peek(ref: ResourceRef): AssetDefinition | undefined {
      return definitions.get(ref);
    },

    status(ref: ResourceRef): ResourceStatus {
      const definition = definitions.get(ref);
      if (definition === undefined) return { state: "undeclared" };
      const entry = entries.get(entryKey(ref, definition.revision));
      if (entry === undefined) return { state: "idle" };
      if (entry.state === "loading") return { state: "loading", holders: entry.holders };
      if (entry.state === "failed") {
        return { state: "failed", error: entry.error ?? "load failed", attempts: entry.attempts };
      }
      if (entry.state === "ready") {
        return {
          state: "ready",
          revision: entry.definition.revision,
          holders: entry.holders,
          bytes: entry.bytes,
        };
      }
      return { state: "idle" };
    },

    inventory(): readonly InventoryEntry[] {
      const rows: InventoryEntry[] = [];
      for (const definition of definitions.values()) {
        rows.push({
          ref: definition.ref,
          kind: definition.kind,
          status: this.status(definition.ref),
        });
      }
      return rows;
    },

    observe(listener: (event: StoreEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose(): void {
      disposed = true;
      for (const [key, entry] of [...entries]) {
        entry.controller?.abort();
        disposeEntry(key, entry);
      }
      entries.clear();
      retained.length = 0;
      listeners.clear();
    },
  };
}
