import type { ItemId, LayerId, SceneChange } from "../contracts/scene.js";

/**
 * What changed since the last frame, at the coarsest granularity that is still
 * correct.
 *
 * The point of tracking this at all is that most state changes cannot affect
 * most of what is drawn. Redrawing everything because something changed is the
 * default that looks fine with three objects on screen and becomes the whole
 * performance problem with three hundred. Moving one item must not be able to
 * invalidate a layer that item is not in.
 */
export interface Invalidation {
  /** Items whose visual must be rebuilt from its descriptor. */
  readonly rebuild: ReadonlySet<ItemId>;
  /** Items that only moved. Placement is reapplied; geometry is left alone. */
  readonly reposition: ReadonlySet<ItemId>;
  /** Items whose built visual must be released. */
  readonly release: ReadonlySet<ItemId>;
  /** Layers whose contents changed, and therefore the views that draw them. */
  readonly layers: ReadonlySet<LayerId>;
  /** Whether anything at all changed. */
  readonly empty: boolean;
}

/** Accumulates scene changes between frames. */
export interface InvalidationTracker {
  /** Folds a batch of scene changes in. */
  record(changes: readonly SceneChange[]): void;
  /** Marks every layer and item dirty. Used when lighting or the registry changes. */
  invalidateAll(layers: Iterable<LayerId>, items: Iterable<ItemId>): void;
  /** Returns what accumulated and resets, ready for the next frame. */
  drain(): Invalidation;
  /** Whether anything is currently pending. */
  readonly pending: boolean;
}

const EMPTY: Invalidation = Object.freeze({
  rebuild: new Set<ItemId>(),
  reposition: new Set<ItemId>(),
  release: new Set<ItemId>(),
  layers: new Set<LayerId>(),
  empty: true,
});

/** Creates the per-frame change accumulator. */
export function createInvalidationTracker(): InvalidationTracker {
  let rebuild = new Set<ItemId>();
  let reposition = new Set<ItemId>();
  let release = new Set<ItemId>();
  let layers = new Set<LayerId>();

  function isEmpty(): boolean {
    return (
      rebuild.size === 0 && reposition.size === 0 && release.size === 0 && layers.size === 0
    );
  }

  return {
    get pending() {
      return !isEmpty();
    },

    record(changes: readonly SceneChange[]) {
      for (const change of changes) {
        switch (change.type) {
          case "item-added":
            rebuild.add(change.id);
            release.delete(change.id);
            layers.add(change.layer);
            break;
          case "item-visual-changed":
            rebuild.add(change.id);
            // A rebuild reapplies placement anyway, so a pending reposition for
            // the same item is redundant work.
            reposition.delete(change.id);
            layers.add(change.layer);
            break;
          case "item-transformed":
            if (!rebuild.has(change.id)) reposition.add(change.id);
            layers.add(change.layer);
            break;
          case "item-removed":
            release.add(change.id);
            rebuild.delete(change.id);
            reposition.delete(change.id);
            layers.add(change.layer);
            break;
          case "layer-changed":
            layers.add(change.layer);
            break;
        }
      }
    },

    invalidateAll(allLayers: Iterable<LayerId>, allItems: Iterable<ItemId>) {
      for (const layer of allLayers) layers.add(layer);
      for (const item of allItems) rebuild.add(item);
    },

    drain(): Invalidation {
      if (isEmpty()) return EMPTY;
      const result: Invalidation = {
        rebuild,
        reposition,
        release,
        layers,
        empty: false,
      };
      rebuild = new Set();
      reposition = new Set();
      release = new Set();
      layers = new Set();
      return result;
    },
  };
}
