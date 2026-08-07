import { createAnimator } from "../animation/create-animator.js";
import type { BackendSurface, RenderBackend } from "../backend/contract.js";
import { createThreeBackend } from "../backend/three/create-backend.js";
import { createClock } from "../clock/create-clock.js";
import type {
  EngineOptions,
  FrameObserver,
  FrameReport,
  LightDescriptor,
  RenderEngine,
} from "../contracts/engine.js";
import type { ItemId, LayerId } from "../contracts/scene.js";
import type { CameraDescriptor, PickResult, View, ViewOptions } from "../contracts/view.js";
import { createInvalidationTracker } from "../invalidation/create-invalidation.js";
import { createScene } from "../scene/create-scene.js";
import { createVisualRegistry } from "../visual/create-registry.js";

interface ViewState {
  view: View;
  readonly surface: BackendSurface;
  descriptor: CameraDescriptor;
  layers: readonly LayerId[] | undefined;
  background: number | undefined;
  width: number;
  height: number;
  active: boolean;
  dirty: boolean;
  disposed: boolean;
}

/**
 * Creates an engine: one graphics context, one world, many views.
 *
 * The single context is the load-bearing decision. Browsers cap live WebGL
 * contexts — commonly around sixteen — and enforce the cap by silently
 * dropping the oldest, so a design that spends one context per rendered
 * element does not fail with an error, it fails by having things vanish. Here
 * every view shares this engine's one context and is presented into its own
 * 2D surface, so the number of simultaneous views is bounded by memory.
 *
 * This file owns scheduling, invalidation, and lifetime. It does not import a
 * renderer; everything that draws sits behind {@link RenderBackend}.
 */
export function createEngine(options: EngineOptions = {}): RenderEngine {
  const registry = options.registry ?? createVisualRegistry();
  const scene = createScene();
  const clock = createClock({ autoplay: options.autoplay ?? true });
  const animator = createAnimator(scene);
  const invalidation = createInvalidationTracker();
  const backend: RenderBackend = createThreeBackend({
    maxPixelRatio: options.maxPixelRatio ?? 2,
  });

  const knownLayers = new Set<LayerId>();
  const appliedOpacity = new Map<LayerId, number>();
  const lastParams = new Map<ItemId, unknown>();
  const views: ViewState[] = [];
  const frameObservers = new Set<FrameObserver>();

  let currentLights: readonly LightDescriptor[] = options.lights ?? [];
  let running = false;
  let animationFrame = 0;
  let disposed = false;
  let viewSequence = 0;
  let contextLost = false;

  scene.observe((changes) => invalidation.record(changes));
  backend.setLights(currentLights);

  backend.onContextLost(() => {
    contextLost = true;
  });
  backend.onContextRestored(() => {
    contextLost = false;
    // Everything built on the old context is gone. Rebuild from the scene,
    // which is the authority and never held graphics state to begin with.
    backend.setLights(currentLights);
    invalidation.invalidateAll(
      scene.layers().map((layer) => layer.id),
      scene.items().map((item) => item.id),
    );
    for (const state of views) state.dirty = true;
  });

  // ------------------------------------------------------------------ layers

  function orderedLayersFor(state: ViewState, forPicking: boolean): LayerId[] {
    const allowed = state.layers === undefined ? undefined : new Set(state.layers);
    const result: LayerId[] = [];
    for (const definition of scene.layers()) {
      if (allowed !== undefined && !allowed.has(definition.id)) continue;
      if (definition.visible === false) continue;
      if (forPicking && definition.pickable === false) continue;
      result.push(definition.id);
    }
    return result;
  }

  function drawsAnyOf(state: ViewState, dirtyLayers: ReadonlySet<LayerId>): boolean {
    if (dirtyLayers.size === 0) return false;
    if (state.layers === undefined) return true;
    for (const layer of state.layers) {
      if (dirtyLayers.has(layer)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------- pending changes

  /**
   * Applies everything the scene has reported since the last time it was
   * called, and marks the views that need to redraw as a result.
   *
   * Deliberately separate from {@link frame} so a caller that needs a correct
   * image *now* — a capture — can flush pending changes without waiting for
   * the next animation frame. Views are marked dirty here rather than the
   * frame body consulting the drained result, so draining from either caller
   * cannot lose the signal for the other.
   */
  function applyPending(): number {
    const changed = invalidation.drain();
    if (changed.empty) return 0;

    const definitions = scene.layers();
    const present = new Set(definitions.map((definition) => definition.id));

    for (const known of [...knownLayers]) {
      if (present.has(known)) continue;
      backend.removeLayer(known);
      knownLayers.delete(known);
      appliedOpacity.delete(known);
    }

    for (const definition of definitions) {
      if (!knownLayers.has(definition.id) || changed.layers.has(definition.id)) {
        backend.ensureLayer(definition.id, definition.order);
        knownLayers.add(definition.id);
      }
      const opacity = definition.opacity ?? 1;
      // Only when it actually changed. Re-applying it every frame would mean
      // walking every object in every layer for any change anywhere, which is
      // precisely the cost this engine exists to avoid.
      if (appliedOpacity.get(definition.id) !== opacity) {
        backend.setLayerOpacity(definition.id, opacity);
        appliedOpacity.set(definition.id, opacity);
      }
    }

    for (const id of changed.release) backend.releaseItem(id);

    let rebuilt = 0;
    for (const id of changed.rebuild) {
      if (rebuildItem(id)) rebuilt += 1;
    }

    for (const id of changed.reposition) {
      const item = scene.get(id);
      if (item !== undefined) {
        backend.placeItem(id, item.transform, item.visible ?? true);
      }
    }

    for (const state of views) {
      if (drawsAnyOf(state, changed.layers)) state.dirty = true;
    }

    return rebuilt;
  }

  function rebuildItem(id: ItemId): boolean {
    const item = scene.get(id);
    if (item === undefined) return false;

    const definition = registry.get(item.visual.kind);
    if (definition === undefined) {
      throw new Error(
        `Item "${item.id}" uses unregistered visual kind "${item.visual.kind}"; ` +
          `registered kinds: ${registry.kinds().join(", ") || "(none)"}`,
      );
    }

    // Skip the rebuild when the kind says the parameters are equivalent. Without
    // this a caller that recreates an equal parameter object each frame rebuilds
    // geometry each frame.
    const previous = lastParams.get(id);
    const unchanged =
      backend.hasItem(id) &&
      (definition.equals !== undefined
        ? definition.equals(previous as never, item.visual.params as never)
        : previous === item.visual.params);

    if (unchanged) {
      backend.placeItem(id, item.transform, item.visible ?? true);
      return false;
    }

    backend.buildItem(
      id,
      item.layer,
      definition.describe(item.visual.params as never),
      item.transform,
      item.visible ?? true,
      item.data,
      appliedOpacity.get(item.layer) ?? 1,
    );
    lastParams.set(id, item.visual.params);
    return true;
  }

  // ------------------------------------------------------------------- views

  function drawView(state: ViewState): void {
    backend.draw(
      state.surface,
      state.descriptor,
      orderedLayersFor(state, false),
      state.background,
      state.width,
      state.height,
    );
    state.dirty = false;
  }

  function createView(viewOptions: ViewOptions): View {
    if (disposed) throw new Error("Cannot create a view on a disposed engine");

    const target = viewOptions.target;
    const width = Math.max(1, Math.floor(viewOptions.width ?? (target.clientWidth || 1)));
    const height = Math.max(1, Math.floor(viewOptions.height ?? (target.clientHeight || 1)));

    const state: ViewState = {
      view: undefined as unknown as View,
      surface: backend.createSurface(target, width, height),
      descriptor: viewOptions.camera,
      layers: viewOptions.layers,
      background: viewOptions.background,
      width,
      height,
      active: true,
      dirty: true,
      disposed: false,
    };

    const view: View = {
      id: viewOptions.id ?? `view-${(viewSequence += 1)}`,
      get width() {
        return state.width;
      },
      get height() {
        return state.height;
      },

      setCamera(camera: CameraDescriptor) {
        state.descriptor = camera;
        state.dirty = true;
      },

      setLayers(layers: readonly LayerId[] | undefined) {
        state.layers = layers;
        state.dirty = true;
      },

      resize(nextWidth: number, nextHeight: number) {
        const w = Math.max(1, Math.floor(nextWidth));
        const h = Math.max(1, Math.floor(nextHeight));
        if (w === state.width && h === state.height) return;
        state.width = w;
        state.height = h;
        // Repoints the projection; rebuilds nothing. A resize is routine, and a
        // renderer that can only answer it by being torn down and recreated
        // makes every panel drag an allocation storm.
        state.surface.resize(w, h);
        state.dirty = true;
      },

      invalidate() {
        state.dirty = true;
      },

      setActive(active: boolean) {
        state.active = active;
        if (active) state.dirty = true;
      },

      pick(x: number, y: number): PickResult | undefined {
        return backend.pick(
          state.descriptor,
          orderedLayersFor(state, true),
          (x / Math.max(state.width, 1)) * 2 - 1,
          -(y / Math.max(state.height, 1)) * 2 + 1,
          state.width,
          state.height,
        );
      },

      capture(mimeType = "image/png") {
        // Flush first. Capturing without this returns whatever was drawn on the
        // last animation frame, so a capture taken right after a scene change
        // silently encodes the previous state.
        applyPending();
        drawView(state);
        return state.surface.toDataURL(mimeType);
      },

      dispose() {
        if (state.disposed) return;
        state.disposed = true;
        const index = views.indexOf(state);
        if (index >= 0) views.splice(index, 1);
        state.surface.destroy();
      },
    };

    state.view = view;
    views.push(state);
    return view;
  }

  // ------------------------------------------------------------------ frames

  function frame(realNow: number): FrameReport {
    const tick = clock.sample(realNow);

    // Animation runs on simulated time only, so a paused clock advances nothing
    // while the loop keeps running and views stay interactive.
    if (tick.simDelta > 0) animator.advance(tick.simDelta);

    const visualsRebuilt = applyPending();

    let viewsDrawn = 0;
    let viewsSkipped = 0;

    for (const state of views) {
      if (!state.active || !state.dirty || contextLost) {
        viewsSkipped += 1;
        continue;
      }
      drawView(state);
      viewsDrawn += 1;
    }

    const report: FrameReport = {
      tick,
      viewsDrawn,
      viewsSkipped,
      visualsRebuilt,
      contextLost,
    };
    for (const observer of [...frameObservers]) observer(report);
    return report;
  }

  function loop(): void {
    if (!running || disposed) return;
    animationFrame = requestAnimationFrame((now) => {
      frame(now);
      loop();
    });
  }

  // ------------------------------------------------------------------ public

  const engine: RenderEngine = {
    scene,
    clock,
    animator,
    registry,

    get contextLost() {
      return contextLost;
    },

    setLights(lights: readonly LightDescriptor[]) {
      currentLights = lights;
      backend.setLights(lights);
      // Lighting is global, so every view drawing anything lit is stale.
      for (const state of views) state.dirty = true;
    },

    createView,

    views() {
      return views.map((state) => state.view);
    },

    start() {
      if (running || disposed) return;
      running = true;
      loop();
    },

    stop() {
      running = false;
      if (animationFrame !== 0) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    },

    frame,

    observeFrames(observer: FrameObserver) {
      frameObservers.add(observer);
      return () => {
        frameObservers.delete(observer);
      };
    },

    dispose() {
      if (disposed) return;
      engine.stop();
      disposed = true;
      for (const state of [...views]) state.view.dispose();
      lastParams.clear();
      knownLayers.clear();
      appliedOpacity.clear();
      frameObservers.clear();
      backend.dispose();
    },
  };

  return engine;
}
