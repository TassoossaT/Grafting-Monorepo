import * as THREE from "three";
import type { ClipPlaneDescriptor, LightDescriptor } from "../../contracts/engine.js";
import type { ItemId, LayerId } from "../../contracts/scene.js";
import type { Transform } from "../../contracts/space.js";
import type { CameraDescriptor, PickResult } from "../../contracts/view.js";
import type { VisualDescriptor } from "../../contracts/visual.js";
import type { BackendSurface, RenderBackend } from "../contract.js";
import { applyTransform, buildVisual, toVec3 } from "./build-visual.js";
import type { BuiltVisual } from "./build-visual.js";

/** Options for {@link createThreeBackend}. */
export interface ThreeBackendOptions {
  readonly maxPixelRatio?: number;
}

interface ThreeSurface extends BackendSurface {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | undefined;
  cameraKey: string;
  width: number;
  height: number;
}

/**
 * The Three.js implementation of {@link RenderBackend}.
 *
 * Together with `build-visual.ts`, this is the only place in the package that
 * imports `three`. Nothing it holds crosses back to the engine.
 */
export function createThreeBackend(options: ThreeBackendOptions = {}): RenderBackend {
  const renderScene = new THREE.Scene();
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });

  const pixelRatio = Math.min(
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
    options.maxPixelRatio ?? 2,
  );
  renderer.setPixelRatio(pixelRatio);
  renderer.setScissorTest(true);

  const groups = new Map<LayerId, THREE.Group>();
  const built = new Map<ItemId, BuiltVisual>();
  const lights: THREE.Object3D[] = [];
  const raycaster = new THREE.Raycaster();
  const surfaces = new Set<ThreeSurface>();
  // Shared for the backend's lifetime: mutating it in place propagates to
  // every already-built `clippable` material's `clippingPlanes` array without
  // rebuilding a single one of them, since they all hold this same reference.
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // The shared drawing buffer only ever grows to the largest surface asked for.
  // Sizing it per draw would make every frame with differently-sized views
  // reallocate the framebuffer, which costs far more than the draw itself.
  let bufferWidth = 1;
  let bufferHeight = 1;
  let contextLost = false;
  let lostHandler: (() => void) | undefined;
  let restoredHandler: (() => void) | undefined;

  canvas.addEventListener("webglcontextlost", (event) => {
    // Without preventDefault the browser will not attempt restoration at all.
    event.preventDefault();
    contextLost = true;
    lostHandler?.();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    contextLost = false;
    renderer.setPixelRatio(pixelRatio);
    renderer.setScissorTest(true);
    restoredHandler?.();
  });

  function ensureBuffer(width: number, height: number): void {
    if (width <= bufferWidth && height <= bufferHeight) return;
    bufferWidth = Math.max(bufferWidth, width);
    bufferHeight = Math.max(bufferHeight, height);
    renderer.setSize(bufferWidth, bufferHeight, false);
  }

  function cameraKeyOf(descriptor: CameraDescriptor, width: number, height: number): string {
    // Rebuilding a camera per draw allocates for nothing; the key detects the
    // rare case where the projection actually has to change.
    return `${descriptor.projection}:${width}x${height}`;
  }

  function resolveCamera(
    surface: ThreeSurface,
    descriptor: CameraDescriptor,
    width: number,
    height: number,
  ): THREE.Camera {
    const key = cameraKeyOf(descriptor, width, height);
    const aspect = width / Math.max(height, 1);

    if (surface.camera === undefined || surface.cameraKey !== key) {
      surface.camera =
        descriptor.projection === "perspective"
          ? new THREE.PerspectiveCamera()
          : new THREE.OrthographicCamera();
      surface.cameraKey = key;
    }
    const camera = surface.camera;

    if (descriptor.projection === "perspective" && camera instanceof THREE.PerspectiveCamera) {
      camera.fov = descriptor.fov ?? 45;
      camera.aspect = aspect;
    } else if (
      descriptor.projection === "orthographic" &&
      camera instanceof THREE.OrthographicCamera
    ) {
      camera.left = -descriptor.extent * aspect;
      camera.right = descriptor.extent * aspect;
      camera.top = descriptor.extent;
      camera.bottom = -descriptor.extent;
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

  function groupsFor(layers: readonly LayerId[]): THREE.Group[] {
    const result: THREE.Group[] = [];
    for (const layer of layers) {
      const group = groups.get(layer);
      if (group) result.push(group);
    }
    return result;
  }

  function applyOpacityTo(object: THREE.Object3D, layerOpacity: number): void {
    const material = (object as THREE.Mesh).material as THREE.Material | undefined;
    if (!material || Array.isArray(material)) return;
    const base = (object.userData.baseOpacity as number | undefined) ?? 1;
    const resolved = base * layerOpacity;
    material.opacity = resolved;
    material.transparent = resolved < 1;
  }

  const backend: RenderBackend = {
    get available() {
      return !contextLost;
    },

    setLights(descriptors: readonly LightDescriptor[]) {
      for (const light of lights) renderScene.remove(light);
      lights.length = 0;
      for (const descriptor of descriptors) {
        const light = buildLight(descriptor);
        lights.push(light);
        renderScene.add(light);
      }
    },

    setClipPlane(plane: ClipPlaneDescriptor | undefined) {
      if (plane === undefined) {
        renderer.localClippingEnabled = false;
        return;
      }
      clipPlane.normal.set(plane.normal.x, plane.normal.y, plane.normal.z);
      clipPlane.constant = plane.constant;
      renderer.localClippingEnabled = true;
    },

    ensureLayer(layer: LayerId, order: number) {
      let group = groups.get(layer);
      if (group === undefined) {
        group = new THREE.Group();
        group.name = layer;
        groups.set(layer, group);
        renderScene.add(group);
      }
      group.renderOrder = order;
    },

    removeLayer(layer: LayerId) {
      const group = groups.get(layer);
      if (group === undefined) return;
      // A layer that disappears takes its group with it. Leaving the group
      // attached retains every buffer it holds until the engine is disposed.
      for (const [id, visual] of [...built]) {
        if (visual.object.parent === group) {
          visual.dispose();
          built.delete(id);
        }
      }
      renderScene.remove(group);
      groups.delete(layer);
    },

    setLayerOpacity(layer: LayerId, opacity: number) {
      const group = groups.get(layer);
      if (group === undefined) return;
      for (const child of group.children) applyOpacityTo(child, opacity);
    },

    buildItem(
      id: ItemId,
      layer: LayerId,
      descriptor: VisualDescriptor,
      transform: Transform | undefined,
      visible: boolean,
      data: unknown,
      layerOpacity: number,
    ) {
      backend.releaseItem(id);

      const visual = buildVisual(descriptor, clipPlane);
      const object = visual.object;
      object.name = id;
      object.userData.itemId = id;
      object.userData.layer = layer;
      object.userData.data = data;
      object.userData.baseOpacity = readOpacity(descriptor.material);
      object.visible = visible;
      applyTransform(object, transform);
      // Applied to this one object at build time, rather than by walking the
      // whole layer afterwards.
      applyOpacityTo(object, layerOpacity);

      groups.get(layer)?.add(object);
      built.set(id, visual);
    },

    placeItem(id: ItemId, transform: Transform | undefined, visible: boolean) {
      const visual = built.get(id);
      if (visual === undefined) return;
      applyTransform(visual.object, transform);
      visual.object.visible = visible;
    },

    releaseItem(id: ItemId) {
      const visual = built.get(id);
      if (visual === undefined) return;
      visual.object.parent?.remove(visual.object);
      visual.dispose();
      built.delete(id);
    },

    hasItem(id: ItemId) {
      return built.has(id);
    },

    createSurface(target: HTMLElement, width: number, height: number): BackendSurface {
      const element = document.createElement("canvas");
      element.style.width = "100%";
      element.style.height = "100%";
      element.style.display = "block";
      element.width = Math.floor(width * pixelRatio);
      element.height = Math.floor(height * pixelRatio);

      const context = element.getContext("2d");
      if (context === null) {
        throw new Error("View target could not provide a 2D presentation context");
      }
      target.replaceChildren(element);

      const surface: ThreeSurface = {
        canvas: element,
        context,
        camera: undefined,
        cameraKey: "",
        width,
        height,
        resize(nextWidth: number, nextHeight: number) {
          surface.width = nextWidth;
          surface.height = nextHeight;
          element.width = Math.floor(nextWidth * pixelRatio);
          element.height = Math.floor(nextHeight * pixelRatio);
        },
        toDataURL(mimeType: string) {
          return element.toDataURL(mimeType);
        },
        destroy() {
          surfaces.delete(surface);
          if (element.parentNode === target) target.removeChild(element);
        },
      };
      surfaces.add(surface);
      return surface;
    },

    draw(
      target: BackendSurface,
      cameraDescriptor: CameraDescriptor,
      layers: readonly LayerId[],
      background: number | undefined,
      width: number,
      height: number,
    ) {
      if (contextLost) return;
      const surface = target as ThreeSurface;

      ensureBuffer(width, height);
      const camera = resolveCamera(surface, cameraDescriptor, width, height);

      // Group visibility is scratch state used only for the span of one draw,
      // so there is nothing to save or restore — and therefore no per-frame
      // allocation to do it with.
      for (const [, group] of groups) group.visible = false;
      for (const group of groupsFor(layers)) group.visible = true;

      // The drawn region sits at the top-left of the shared buffer. In GL the
      // origin is bottom-left, hence the flipped Y.
      const originY = bufferHeight - height;
      renderer.setViewport(0, originY, width, height);
      renderer.setScissor(0, originY, width, height);
      renderer.setClearColor(background ?? 0x000000, background === undefined ? 0 : 1);
      renderer.clear();
      renderer.render(renderScene, camera);

      const sourceWidth = Math.floor(width * pixelRatio);
      const sourceHeight = Math.floor(height * pixelRatio);
      surface.context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
      if (sourceWidth > 0 && sourceHeight > 0) {
        surface.context.drawImage(
          canvas,
          0,
          0,
          sourceWidth,
          sourceHeight,
          0,
          0,
          surface.canvas.width,
          surface.canvas.height,
        );
      }
    },

    pick(
      cameraDescriptor: CameraDescriptor,
      layers: readonly LayerId[],
      ndcX: number,
      ndcY: number,
      width: number,
      height: number,
    ): PickResult | undefined {
      if (contextLost) return undefined;
      const probe: ThreeSurface = {
        camera: undefined,
        cameraKey: "",
      } as ThreeSurface;
      const camera = resolveCamera(probe, cameraDescriptor, width, height);

      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      for (const hit of raycaster.intersectObjects(groupsFor(layers), true)) {
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

    onContextLost(handler: () => void) {
      lostHandler = handler;
    },

    onContextRestored(handler: () => void) {
      restoredHandler = handler;
    },

    dispose() {
      for (const surface of [...surfaces]) surface.destroy();
      for (const [id] of [...built]) backend.releaseItem(id);
      for (const [layer] of [...groups]) backend.removeLayer(layer);
      for (const light of lights) renderScene.remove(light);
      lights.length = 0;
      renderer.dispose();
    },
  };

  return backend;
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

function readOpacity(material: { readonly opacity?: number }): number {
  return material.opacity ?? 1;
}
