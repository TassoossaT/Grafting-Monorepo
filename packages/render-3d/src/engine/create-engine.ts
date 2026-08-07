import * as THREE from "three";
import { createAnimator } from "../animation/create-animator.js";
import { applyTransform, buildVisual, toVec3 } from "../backend/three/build-visual.js";
import type { BuiltVisual } from "../backend/three/build-visual.js";
import { createClock } from "../clock/create-clock.js";
import type {
  EngineOptions,
  FrameObserver,
  FrameReport,
  LightDescriptor,
  RenderEngine,
} from "../contracts/engine.js";
import type { ItemId, LayerDefinition, LayerId, SceneItem } from "../contracts/scene.js";
import type { CameraDescriptor, PickResult, View, ViewOptions } from "../contracts/view.js";
import { createInvalidationTracker } from "../invalidation/create-invalidation.js";
import { createScene } from "../scene/create-scene.js";
import { createVisualRegistry } from "../visual/create-registry.js";

interface ViewState {
  readonly view: View;
  readonly surface: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
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
 */
export function createEngine(options: EngineOptions = {}): RenderEngine {
  const registry = options.registry ?? createVisualRegistry();
  const scene = createScene();
  const clock = createClock({ autoplay: options.autoplay ?? true });
  const animator = createAnimator(scene);
  const invalidation = createInvalidationTracker();

  const renderScene = new THREE.Scene();
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const maxPixelRatio = options.maxPixelRatio ?? 2;
  const pixelRatio = Math.min(
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
    maxPixelRatio,
  );
  renderer.setPixelRatio(pixelRatio);

  const layerGroups = new Map<LayerId, THREE.Group>();
  const built = new Map<ItemId, BuiltVisual>();
  const lastParams = new Map<ItemId, unknown>();
  const lights: THREE.Object3D[] = [];
  const views: ViewState[] = [];
  const frameObservers = new Set<FrameObserver>();
  const raycaster = new THREE.Raycaster();

  let running = false;
  let animationFrame = 0;
  let disposed = false;
  let viewSequence = 0;

  scene.observe((changes) => invalidation.record(changes));
  setLights(options.lights ?? []);

  // ---------------------------------------------------------------- lighting

  function setLights(descriptors: readonly LightDescriptor[]): void {
    for (const light of lights) renderScene.remove(light);
    lights.length = 0;

    for (const descriptor of descriptors) {
      const light = buildLight(descriptor);
      lights.push(light);
      renderScene.add(light);
    }
    // Lighting is global, so every view that draws anything lit is stale.
    for (const state of views) state.dirty = true;
  }

  function buildLight(descriptor: LightDescriptor): THREE.Object3D {
    const color = descriptor.color ?? 0xffffff;
    const intensity = descriptor.intensity ?? 1;
    switch (descriptor.light) {
      case "ambient":
        return new THREE.AmbientLight(color, intensity);
      case "directional": {
        const light = new THREE.DirectionalLight(color, intensity);
        light.position.set(descriptor.direction.x, descriptor.direction.y, descriptor.direction.z);
        return light;
      }
      case "point": {
        const light = new THREE.PointLight(color, intensity, descriptor.distance ?? 0);
        light.position.set(descriptor.position.x, descriptor.position.y, descriptor.position.z);
        return light;
      }
    }
  }

  // ------------------------------------------------------------------ layers

  function groupFor(layer: LayerId): THREE.Group {
    let group = layerGroups.get(layer);
    if (group === undefined) {
      group = new THREE.Group();
      group.name = layer;
      layerGroups.set(layer, group);
      renderScene.add(group);
    }
    return group;
  }

  function syncLayers(): void {
    for (const definition of scene.layers()) {
      const group = groupFor(definition.id);
      group.renderOrder = definition.order;
      applyLayerOpacity(group, definition);
    }
  }

  function applyLayerOpacity(group: THREE.Group, definition: LayerDefinition): void {
    const layerOpacity = definition.opacity ?? 1;
    group.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | undefined;
      if (!material || Array.isArray(material)) return;
      const base = (object.userData.baseOpacity as number | undefined) ?? 1;
      const resolved = base * layerOpacity;
      material.opacity = resolved;
      material.transparent = resolved < 1;
    });
  }

  // ------------------------------------------------------------------- items

  function releaseItem(id: ItemId): void {
    const visual = built.get(id);
    if (visual === undefined) return;
    visual.object.parent?.remove(visual.object);
    visual.dispose();
    built.delete(id);
    lastParams.delete(id);
  }

  function rebuildItem(item: SceneItem): boolean {
    const definition = registry.get(item.visual.kind);
    if (definition === undefined) {
      throw new Error(
        `Item "${item.id}" uses unregistered visual kind "${item.visual.kind}"; ` +
          `registered kinds: ${registry.kinds().join(", ") || "(none)"}`,
      );
    }

    // Skip the rebuild when the kind says the parameters are equivalent. Without
    // this a caller that recreates an equal parameter object each frame rebuilds
    // geometry each frame, which is exactly the cost this engine exists to avoid.
    const previous = lastParams.get(item.id);
    const unchanged =
      built.has(item.id) &&
      (definition.equals !== undefined
        ? definition.equals(previous as never, item.visual.params as never)
        : previous === item.visual.params);

    if (unchanged) {
      const existing = built.get(item.id);
      if (existing) applyTransform(existing.object, item.transform);
      return false;
    }

    releaseItem(item.id);

    const descriptor = definition.describe(item.visual.params as never);
    const visual = buildVisual(descriptor);
    visual.object.name = item.id;
    visual.object.userData.itemId = item.id;
    visual.object.userData.layer = item.layer;
    visual.object.userData.data = item.data;
    visual.object.userData.baseOpacity = readOpacity(descriptor.material);
    visual.object.visible = item.visible ?? true;
    applyTransform(visual.object, item.transform);

    groupFor(item.layer).add(visual.object);
    built.set(item.id, visual);
    lastParams.set(item.id, item.visual.params);
    return true;
  }

  function repositionItem(item: SceneItem): void {
    const visual = built.get(item.id);
    if (visual === undefined) return;
    applyTransform(visual.object, item.transform);
    visual.object.visible = item.visible ?? true;
  }

  // ------------------------------------------------------------------- views

  function resolveCamera(
    descriptor: CameraDescriptor,
    width: number,
    height: number,
    existing?: THREE.Camera,
  ): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    const aspect = width / Math.max(height, 1);
    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;

    if (descriptor.projection === "perspective") {
      camera =
        existing instanceof THREE.PerspectiveCamera
          ? existing
          : new THREE.PerspectiveCamera();
      camera.fov = descriptor.fov ?? 45;
      camera.aspect = aspect;
    } else {
      camera =
        existing instanceof THREE.OrthographicCamera
          ? existing
          : new THREE.OrthographicCamera();
      const extent = descriptor.extent;
      camera.left = -extent * aspect;
      camera.right = extent * aspect;
      camera.top = extent;
      camera.bottom = -extent;
    }

    camera.near = descriptor.near ?? 0.1;
    camera.far = descriptor.far ?? 1000;
    camera.position.set(descriptor.position.x, descriptor.position.y, descriptor.position.z);
    const up = descriptor.up;
    if (up) camera.up.set(up.x, up.y, up.z);
    camera.lookAt(descriptor.target.x, descriptor.target.y, descriptor.target.z);
    camera.updateProjectionMatrix();
    return camera;
  }

  function visibleGroupsFor(state: ViewState): THREE.Group[] {
    const definitions = scene.layers();
    const allowed = state.layers === undefined ? undefined : new Set(state.layers);
    const groups: THREE.Group[] = [];
    for (const definition of definitions) {
      if (allowed !== undefined && !allowed.has(definition.id)) continue;
      if (definition.visible === false) continue;
      const group = layerGroups.get(definition.id);
      if (group) groups.push(group);
    }
    return groups;
  }

  function drawView(state: ViewState): void {
    const groups = visibleGroupsFor(state);
    const wasVisible = new Map<THREE.Group, boolean>();
    for (const [, group] of layerGroups) {
      wasVisible.set(group, group.visible);
      group.visible = false;
    }
    for (const group of groups) group.visible = true;

    renderer.setSize(state.width, state.height, false);
    renderer.setClearColor(state.background ?? 0x000000, state.background === undefined ? 0 : 1);
    renderer.clear();
    renderer.render(renderScene, state.camera);

    for (const [group, visible] of wasVisible) group.visible = visible;

    state.context.clearRect(0, 0, state.surface.width, state.surface.height);
    if (canvas.width > 0 && canvas.height > 0) {
      state.context.drawImage(canvas, 0, 0, state.surface.width, state.surface.height);
    }
    state.dirty = false;
  }

  function createView(viewOptions: ViewOptions): View {
    if (disposed) throw new Error("Cannot create a view on a disposed engine");

    const target = viewOptions.target;
    const width = Math.max(1, Math.floor(viewOptions.width ?? (target.clientWidth || 1)));
    const height = Math.max(1, Math.floor(viewOptions.height ?? (target.clientHeight || 1)));

    const surface = document.createElement("canvas");
    surface.style.width = "100%";
    surface.style.height = "100%";
    surface.style.display = "block";
    const context = surface.getContext("2d");
    if (context === null) throw new Error("View target could not provide a 2D presentation context");
    target.replaceChildren(surface);

    const id = viewOptions.id ?? `view-${(viewSequence += 1)}`;

    const state: ViewState = {
      view: undefined as unknown as View,
      surface,
      context,
      camera: resolveCamera(viewOptions.camera, width, height),
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
      id,
      get width() {
        return state.width;
      },
      get height() {
        return state.height;
      },

      setCamera(camera: CameraDescriptor) {
        state.descriptor = camera;
        state.camera = resolveCamera(camera, state.width, state.height, state.camera);
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
        surface.width = Math.floor(w * pixelRatio);
        surface.height = Math.floor(h * pixelRatio);
        // Resizing repoints the projection rather than rebuilding anything: a
        // resize is routine, and a renderer that can only answer it by being
        // torn down and recreated makes every panel drag an allocation storm.
        state.camera = resolveCamera(state.descriptor, w, h, state.camera);
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
        const ndc = new THREE.Vector2(
          (x / Math.max(state.width, 1)) * 2 - 1,
          -(y / Math.max(state.height, 1)) * 2 + 1,
        );
        raycaster.setFromCamera(ndc, state.camera);
        const hits = raycaster.intersectObjects(visibleGroupsFor(state), true);
        for (const hit of hits) {
          if (hit.object.userData.pickable === false) continue;
          const itemId = hit.object.userData.itemId as string | undefined;
          if (itemId === undefined) continue;
          return {
            itemId,
            layer: hit.object.userData.layer as LayerId,
            point: toVec3(hit.point),
            distance: hit.distance,
            data: hit.object.userData.data,
          };
        }
        return undefined;
      },

      capture(mimeType = "image/png") {
        if (state.dirty) drawView(state);
        return surface.toDataURL(mimeType);
      },

      dispose() {
        if (state.disposed) return;
        state.disposed = true;
        const index = views.indexOf(state);
        if (index >= 0) views.splice(index, 1);
        if (surface.parentNode === target) target.removeChild(surface);
      },
    };

    (state as { view: View }).view = view;
    surface.width = Math.floor(width * pixelRatio);
    surface.height = Math.floor(height * pixelRatio);
    views.push(state);
    return view;
  }

  // ------------------------------------------------------------------ frames

  function frame(realNow: number): FrameReport {
    const tick = clock.sample(realNow);

    // Animation runs on simulated time only, so a paused clock advances nothing
    // while the loop keeps running and views stay interactive.
    if (tick.simDelta > 0) animator.advance(tick.simDelta);

    const changed = invalidation.drain();
    let visualsRebuilt = 0;

    if (!changed.empty) {
      syncLayers();

      for (const id of changed.release) releaseItem(id);

      for (const id of changed.rebuild) {
        const item = scene.get(id);
        if (item === undefined) continue;
        if (rebuildItem(item)) visualsRebuilt += 1;
      }

      for (const id of changed.reposition) {
        const item = scene.get(id);
        if (item !== undefined) repositionItem(item);
      }

      // Re-apply layer opacity after rebuilds, since a freshly built object
      // carries only its own base opacity.
      for (const definition of scene.layers()) {
        if ((definition.opacity ?? 1) !== 1) {
          const group = layerGroups.get(definition.id);
          if (group) applyLayerOpacity(group, definition);
        }
      }
    }

    let viewsDrawn = 0;
    let viewsSkipped = 0;

    for (const state of views) {
      if (!state.active) {
        viewsSkipped += 1;
        continue;
      }
      // A view redraws only when it changed itself or when a layer it actually
      // draws changed. This is what keeps one item's movement from costing a
      // redraw in every view on screen.
      const touched = state.dirty || drawsAnyOf(state, changed.layers);
      if (!touched) {
        viewsSkipped += 1;
        continue;
      }
      drawView(state);
      viewsDrawn += 1;
    }

    const report: FrameReport = { tick, viewsDrawn, viewsSkipped, visualsRebuilt };
    for (const observer of [...frameObservers]) observer(report);
    return report;
  }

  function drawsAnyOf(state: ViewState, dirtyLayers: ReadonlySet<LayerId>): boolean {
    if (dirtyLayers.size === 0) return false;
    if (state.layers === undefined) return true;
    for (const layer of state.layers) {
      if (dirtyLayers.has(layer)) return true;
    }
    return false;
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

    setLights,

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
      for (const id of [...built.keys()]) releaseItem(id);
      for (const [, group] of layerGroups) renderScene.remove(group);
      layerGroups.clear();
      for (const light of lights) renderScene.remove(light);
      lights.length = 0;
      frameObservers.clear();
      renderer.dispose();
    },
  };

  return engine;
}

function readOpacity(material: { readonly opacity?: number }): number {
  return material.opacity ?? 1;
}
