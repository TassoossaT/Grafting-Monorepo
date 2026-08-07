import type { Bounds, Transform } from "./space.js";
import type { VisualRef } from "./visual.js";

/** Caller-chosen identity for a scene item. */
export type ItemId = string;

/** Caller-chosen identity for a draw group. */
export type LayerId = string;

/**
 * Where a change came from.
 *
 * Carried from the moment a change is made rather than inferred afterwards.
 * A renderer that reports its own placements the same way it reports the
 * user's produces feedback loops that are indistinguishable from real input,
 * and a network-authoritative caller has a third source to tell apart, not
 * just two.
 */
export type ChangeOrigin =
  /** The local user did this, through direct interaction. */
  | "local"
  /** An authority elsewhere did this; it arrived over the wire. */
  | "remote"
  /** The engine itself did this — placement, animation, layout. Never user input. */
  | "engine";

/**
 * An ordered draw group.
 *
 * Layers are the unit of invalidation as well as of ordering: a view redraws
 * when a layer it draws has changed, so a change confined to one layer cannot
 * force unrelated content to be redrawn. Declaring which layers exist and what
 * they mean is the caller's job; the engine ships no layer names of its own.
 */
export interface LayerDefinition {
  readonly id: LayerId;
  /** Draw order. Lower draws first, so higher values appear on top. */
  readonly order: number;
  /** Whether the layer is drawn at all. Defaults to `true`. */
  readonly visible?: boolean;
  /** Multiplies every item's opacity in this layer. Defaults to `1`. */
  readonly opacity?: number;
  /** Whether items in this layer can be picked. Defaults to `true`. */
  readonly pickable?: boolean;
}

/** One drawable thing placed in the world. */
export interface SceneItem<TParams = unknown> {
  readonly id: ItemId;
  /** The registered visual kind and its parameters. */
  readonly visual: VisualRef<TParams>;
  /** Which draw group the item belongs to. */
  readonly layer: LayerId;
  /** Placement. Defaults to the identity transform. */
  readonly transform?: Transform;
  /** Extent used for visibility and spatial queries. Derived from geometry when omitted. */
  readonly bounds?: Bounds;
  /** Whether the item is drawn. Defaults to `true`. */
  readonly visible?: boolean;
  /**
   * Opaque caller data carried through unchanged.
   *
   * The engine never reads this. It exists so a pick result can be traced back
   * to whatever the caller considers the real entity, without the engine
   * needing a concept of one.
   */
  readonly data?: unknown;
}

/** A single mutation applied to the scene. */
export type SceneChange =
  | {
      readonly type: "item-added";
      readonly id: ItemId;
      readonly layer: LayerId;
      readonly origin: ChangeOrigin;
    }
  | { readonly type: "item-removed"; readonly id: ItemId; readonly layer: LayerId; readonly origin: ChangeOrigin }
  | {
      readonly type: "item-transformed";
      readonly id: ItemId;
      readonly layer: LayerId;
      readonly origin: ChangeOrigin;
    }
  | {
      readonly type: "item-visual-changed";
      readonly id: ItemId;
      readonly layer: LayerId;
      readonly origin: ChangeOrigin;
    }
  | { readonly type: "layer-changed"; readonly layer: LayerId; readonly origin: ChangeOrigin };

/** Notified after each batch of changes, with every change's origin intact. */
export type SceneObserver = (changes: readonly SceneChange[]) => void;

/** The mutable world. Holds no renderer state and can be driven headlessly. */
export interface Scene {
  /** Declares or replaces a draw group. */
  defineLayer(layer: LayerDefinition, origin?: ChangeOrigin): void;
  /** Every declared layer, sorted by draw order. */
  layers(): readonly LayerDefinition[];

  /** Adds an item, or replaces one with the same id. */
  put<TParams>(item: SceneItem<TParams>, origin?: ChangeOrigin): void;
  /** Removes an item. Returns whether it existed. */
  remove(id: ItemId, origin?: ChangeOrigin): boolean;
  /** Reads an item without copying it. */
  get(id: ItemId): SceneItem | undefined;
  /** Every item in a layer, or every item when no layer is given. */
  items(layer?: LayerId): readonly SceneItem[];

  /** Moves an item, touching nothing else. */
  setTransform(id: ItemId, transform: Transform, origin?: ChangeOrigin): void;
  /** Replaces an item's visual parameters, keeping its placement. */
  setVisualParams(id: ItemId, params: unknown, origin?: ChangeOrigin): void;
  /** Shows or hides an item. */
  setVisible(id: ItemId, visible: boolean, origin?: ChangeOrigin): void;

  /**
   * Groups several mutations into one notification.
   *
   * Applying a turn's worth of changes inside one batch produces a single
   * observer call and a single redraw, rather than one of each per change.
   */
  batch(mutate: () => void, origin?: ChangeOrigin): void;

  /** Subscribes to changes. Returns an unsubscribe function. */
  observe(observer: SceneObserver): () => void;

  /** Drops every item and layer. */
  clear(origin?: ChangeOrigin): void;
}
