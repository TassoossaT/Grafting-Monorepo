import type { AssetDefinition } from "./definition.js";
import type { ResourceKind, ResourceOf, ResourceRef } from "./ref.js";
import type { CatalogSource, ResourceResolver } from "./resolver.js";

/**
 * One holder's claim on a loaded resource.
 *
 * Holding a handle is what keeps a resource alive; releasing it is what allows
 * disposal. This is Bevy's strong handle, and the reason the three classic
 * asset bugs -- loading the same thing twice, leaking what is unused, disposing
 * what is still in use -- all reduce to one missing fact: nobody knows who
 * holds what.
 */
export interface ResourceHandle<TResource> {
  readonly ref: ResourceRef;
  /** Which revision of the definition this handle serves. */
  readonly revision: number;
  /**
   * The resource if it is ready, `undefined` while loading or after a failure.
   * Never throws -- a render loop must be able to call this every frame.
   */
  current(): TResource | undefined;
  /** Resolves when the resource is ready; rejects if the load failed. */
  whenReady(): Promise<TResource>;
  /** Drops this holder's claim. Idempotent; releasing twice is not an error. */
  release(): void;
}

/** What the store currently knows about one reference. */
export type ResourceStatus =
  /** No definition has been declared for this ref. */
  | { readonly state: "undeclared" }
  /** Declared, with nothing holding it and nothing loaded. */
  | { readonly state: "idle" }
  | { readonly state: "loading"; readonly holders: number }
  | {
      readonly state: "ready";
      readonly revision: number;
      readonly holders: number;
      /** Resolver-reported cost in bytes, when it could report one honestly. */
      readonly bytes?: number;
    }
  | { readonly state: "failed"; readonly error: string; readonly attempts: number };

/** One row of {@link AssetStore.inventory}. */
export interface InventoryEntry {
  readonly ref: ResourceRef;
  readonly kind: ResourceKind;
  readonly status: ResourceStatus;
}

/** Something the store did, for diagnostics and tests. */
export type StoreEvent =
  | { readonly type: "declared"; readonly ref: ResourceRef }
  | { readonly type: "load-started"; readonly ref: ResourceRef }
  | { readonly type: "load-succeeded"; readonly ref: ResourceRef }
  | { readonly type: "load-failed"; readonly ref: ResourceRef; readonly error: string }
  | { readonly type: "disposed"; readonly ref: ResourceRef };

/** What happens to a resource's bytes when its last holder releases. */
export type RetentionPolicy =
  /**
   * Dispose immediately. Memory in use is exactly memory held, which is the
   * predictable default -- and predictability is what matters most before any
   * measurement exists.
   */
  | { readonly kind: "immediate" }
  /**
   * Keep unheld resources until the retained set exceeds `maxBytes`, then
   * dispose the least recently released first. Re-acquiring something recent
   * becomes instant, at the cost of a memory tail that is harder to predict.
   */
  | { readonly kind: "least-recently-used"; readonly maxBytes: number };

/** Everything needed to stand a store up. */
export interface AssetStoreOptions {
  /** Defaults to `{ kind: "immediate" }`. */
  readonly retention?: RetentionPolicy;
}

/**
 * Owns what content exists, whether it is loaded, and who is holding it.
 *
 * It never answers how anything is drawn. Textures, prototypes and effect
 * content are all just resources here; filtering, batching, shaders and
 * particle simulation belong to the renderer, and product meaning belongs to
 * the app. Holding that line is what stops this package from slowly becoming a
 * second renderer -- the way Babylon's `AssetContainer`, which knows about
 * scenes, cannot be used by a consumer with a different scene model.
 */
export interface AssetStore {
  /** Declares a resource, replacing any prior declaration of the same ref. */
  define(definition: AssetDefinition): void;
  /** Declares everything a {@link CatalogSource} lists. */
  load(source: CatalogSource, signal?: AbortSignal): Promise<number>;
  /** Registers the resolver for one kind. Throws if that kind is already claimed. */
  registerResolver<TKind extends ResourceKind>(resolver: ResourceResolver<TKind>): void;

  /**
   * Claims a resource, starting its load if nothing else already has.
   *
   * Concurrent acquisitions of the same `(ref, revision)` join one load; there
   * is never a second request in flight for the same thing.
   */
  acquire<TKind extends ResourceKind>(
    ref: ResourceRef<TKind>,
  ): ResourceHandle<ResourceOf<TKind>>;

  /**
   * Reads a definition without loading anything and without keeping anything
   * loaded -- Bevy's weak handle, in the one form this package needs.
   *
   * A layout that needs only a unit's `dimensions` must not thereby pin its
   * mesh in memory. Without this, "just read the size" quietly costs megabytes.
   */
  peek(ref: ResourceRef): AssetDefinition | undefined;

  status(ref: ResourceRef): ResourceStatus;
  /**
   * Every declared resource with its state, holder count and reported size.
   *
   * The diagnostic this package exists for: it turns "something is leaking
   * textures" from a bisect into a table.
   */
  inventory(): readonly InventoryEntry[];
  /** Subscribes to store events. Returns an unsubscribe function. */
  observe(listener: (event: StoreEvent) => void): () => void;
  /** Disposes everything, held or not. For teardown, not for eviction. */
  dispose(): void;
}
