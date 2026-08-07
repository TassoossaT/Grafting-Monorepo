import type {
  ChangeOrigin,
  ItemId,
  LayerDefinition,
  LayerId,
  Scene,
  SceneChange,
  SceneItem,
  SceneObserver,
} from "../contracts/scene.js";
import type { Transform } from "../contracts/space.js";

/**
 * Creates the mutable world.
 *
 * The scene holds no graphics state at all. It can be built, mutated, and
 * asserted on with no browser and no context, which is what lets the rules a
 * product cares about be tested without a renderer being involved.
 */
export function createScene(): Scene {
  const layers = new Map<LayerId, LayerDefinition>();
  const items = new Map<ItemId, SceneItem>();
  const byLayer = new Map<LayerId, Set<ItemId>>();
  const observers = new Set<SceneObserver>();

  let pending: SceneChange[] = [];
  let batchDepth = 0;

  function emit(change: SceneChange): void {
    pending.push(change);
    if (batchDepth === 0) flush();
  }

  function flush(): void {
    if (pending.length === 0) return;
    const changes = pending;
    pending = [];
    // Snapshot the observers: an observer that unsubscribes while being
    // notified must not shorten the list mid-iteration.
    for (const observer of [...observers]) observer(changes);
  }

  function requireItem(id: ItemId): SceneItem {
    const item = items.get(id);
    if (item === undefined) throw new Error(`Scene has no item "${id}"`);
    return item;
  }

  function indexOf(layer: LayerId): Set<ItemId> {
    let set = byLayer.get(layer);
    if (set === undefined) {
      set = new Set();
      byLayer.set(layer, set);
    }
    return set;
  }

  const scene: Scene = {
    defineLayer(layer: LayerDefinition, origin: ChangeOrigin = "local") {
      layers.set(layer.id, layer);
      indexOf(layer.id);
      emit({ type: "layer-changed", layer: layer.id, origin });
    },

    layers() {
      return [...layers.values()].sort((a, b) => a.order - b.order);
    },

    put<TParams>(item: SceneItem<TParams>, origin: ChangeOrigin = "local") {
      if (!layers.has(item.layer)) {
        // Falling back to an implicit layer would let a typo place an item in a
        // group nothing draws, which looks exactly like a rendering bug.
        throw new Error(
          `Item "${item.id}" references undeclared layer "${item.layer}"; call defineLayer first`,
        );
      }
      const previous = items.get(item.id);
      if (previous !== undefined && previous.layer !== item.layer) {
        byLayer.get(previous.layer)?.delete(item.id);
      }
      items.set(item.id, item as SceneItem);
      indexOf(item.layer).add(item.id);
      emit(
        previous === undefined
          ? { type: "item-added", id: item.id, layer: item.layer, origin }
          : { type: "item-visual-changed", id: item.id, layer: item.layer, origin },
      );
    },

    remove(id: ItemId, origin: ChangeOrigin = "local") {
      const item = items.get(id);
      if (item === undefined) return false;
      items.delete(id);
      byLayer.get(item.layer)?.delete(id);
      emit({ type: "item-removed", id, layer: item.layer, origin });
      return true;
    },

    get(id: ItemId) {
      return items.get(id);
    },

    items(layer?: LayerId) {
      if (layer === undefined) return [...items.values()];
      const ids = byLayer.get(layer);
      if (ids === undefined) return [];
      const result: SceneItem[] = [];
      for (const id of ids) {
        const item = items.get(id);
        if (item !== undefined) result.push(item);
      }
      return result;
    },

    setTransform(id: ItemId, transform: Transform, origin: ChangeOrigin = "local") {
      const item = requireItem(id);
      items.set(id, { ...item, transform });
      // Reported as a transform rather than a visual change so a consumer can
      // move something without its geometry being rebuilt.
      emit({ type: "item-transformed", id, layer: item.layer, origin });
    },

    setVisualParams(id: ItemId, params: unknown, origin: ChangeOrigin = "local") {
      const item = requireItem(id);
      items.set(id, { ...item, visual: { kind: item.visual.kind, params } });
      emit({ type: "item-visual-changed", id, layer: item.layer, origin });
    },

    setVisible(id: ItemId, visible: boolean, origin: ChangeOrigin = "local") {
      const item = requireItem(id);
      if ((item.visible ?? true) === visible) return;
      items.set(id, { ...item, visible });
      emit({ type: "item-transformed", id, layer: item.layer, origin });
    },

    batch(mutate: () => void, _origin?: ChangeOrigin) {
      batchDepth += 1;
      try {
        mutate();
      } finally {
        batchDepth -= 1;
        // Only the outermost batch flushes, so nesting stays one notification.
        if (batchDepth === 0) flush();
      }
    },

    observe(observer: SceneObserver) {
      observers.add(observer);
      return () => {
        observers.delete(observer);
      };
    },

    clear(origin: ChangeOrigin = "local") {
      scene.batch(() => {
        for (const id of [...items.keys()]) scene.remove(id, origin);
        for (const layer of [...layers.keys()]) {
          layers.delete(layer);
          byLayer.delete(layer);
          emit({ type: "layer-changed", layer, origin });
        }
      });
    },
  };

  return scene;
}
