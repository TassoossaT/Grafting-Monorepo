import type { ClipPlaneDescriptor, LightDescriptor } from "../contracts/engine.js";
import type { ItemId, LayerId } from "../contracts/scene.js";
import type { Transform } from "../contracts/space.js";
import type { CameraDescriptor, PickResult } from "../contracts/view.js";
import type { VisualDescriptor } from "../contracts/visual.js";

/**
 * The internal seam between the engine and whatever actually draws.
 *
 * This interface is package-private — it is not exported from `src/index.ts`
 * and no consumer ever sees it. It exists so the engine can own scheduling,
 * invalidation, and lifetime without importing a renderer, which is what keeps
 * `three` confined to `src/backend/` as this package's `AGENTS.md` requires.
 *
 * Every type crossing this seam is Grafting-owned. A backend that needed to
 * hand a vendor object back through it would be a backend this engine cannot
 * use.
 */

/** One presentation target owned by a backend. Opaque to the engine. */
export interface BackendSurface {
  /** Resizes the presentation target. Cheap; never rebuilds scene content. */
  resize(width: number, height: number): void;
  /** Encodes the last drawn content. */
  toDataURL(mimeType: string): string;
  /** Detaches the target from the document. */
  destroy(): void;
}

/** What a backend must provide for the engine to drive it. */
export interface RenderBackend {
  /** Whether the graphics context is currently usable. */
  readonly available: boolean;

  /** Replaces scene lighting. */
  setLights(lights: readonly LightDescriptor[]): void;

  /** Replaces the active clip plane. `undefined` disables clipping. */
  setClipPlane(plane: ClipPlaneDescriptor | undefined): void;

  /** Declares or updates a draw group. */
  ensureLayer(layer: LayerId, order: number): void;
  /** Drops a draw group and everything still in it. */
  removeLayer(layer: LayerId): void;
  /** Applies a group-wide opacity multiplier. Only called when the value changed. */
  setLayerOpacity(layer: LayerId, opacity: number): void;

  /** Builds or replaces an item's drawable form. */
  buildItem(
    id: ItemId,
    layer: LayerId,
    descriptor: VisualDescriptor,
    transform: Transform | undefined,
    visible: boolean,
    data: unknown,
    layerOpacity: number,
  ): void;
  /** Re-applies placement and visibility without rebuilding. */
  placeItem(id: ItemId, transform: Transform | undefined, visible: boolean): void;
  /** Releases an item's drawable form. */
  releaseItem(id: ItemId): void;
  /** Whether an item currently has a built form. */
  hasItem(id: ItemId): boolean;

  /** Creates a presentation target inside a host element. */
  createSurface(target: HTMLElement, width: number, height: number): BackendSurface;
  /** Draws the given layers, in order, into a surface. */
  draw(
    surface: BackendSurface,
    camera: CameraDescriptor,
    layers: readonly LayerId[],
    background: number | undefined,
    width: number,
    height: number,
  ): void;
  /** Resolves a normalized device coordinate against the given layers. */
  pick(
    camera: CameraDescriptor,
    layers: readonly LayerId[],
    ndcX: number,
    ndcY: number,
    width: number,
    height: number,
  ): PickResult | undefined;

  /**
   * Registers callbacks for graphics-context loss and restoration.
   *
   * Context loss is not an edge case: a driver reset, a GPU switch, or too many
   * live contexts all produce it, and the failure mode without handling is
   * every view frozen forever with no error raised anywhere.
   */
  onContextLost(handler: () => void): void;
  onContextRestored(handler: () => void): void;

  /** Releases the context and everything built on it. */
  dispose(): void;
}
