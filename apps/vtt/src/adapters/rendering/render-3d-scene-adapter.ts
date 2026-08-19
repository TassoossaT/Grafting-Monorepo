import {
  attachOrbit,
  createEngine,
  createVisualRegistry,
  gridVisual,
  orbitFromCamera,
  type ChangeOrigin as EngineChangeOrigin,
  type ClipPlaneDescriptor,
  type LightDescriptor,
  type RenderEngine,
  type View,
} from "@grafting/render-3d";

import type {
  CameraControlHandle,
  CameraControlOptions,
  ChangeOrigin,
  ConfirmedRenderChange,
  RenderPreviewDescriptor,
  RenderToken,
  RenderViewId,
  ScenePickResult,
  SceneRenderMetrics,
  SceneRenderPort,
} from "@/ports";

import {
  CONSTRUCTION_PREVIEW_ITEM_ID,
  CONSTRUCTION_PREVIEW_LAYER_ID,
  CONSTRUCTION_PREVIEW_VISUAL_KIND,
  constructionPreviewSceneItem,
  type ConstructionPreviewVisualParams,
} from "./construction-preview-scene-item.ts";
import {
  CONSTRUCTION_GRID_EXTENT,
  CONSTRUCTION_GRID_LAYER_ID,
  CONSTRUCTION_GROUND_LAYER_ID,
  CONSTRUCTION_GROUND_VISUAL_KIND,
  constructionGridSceneItems,
  constructionGroundSceneItem,
} from "./construction-grid-scene-item.ts";
import {
  MAP_LAYER_ID,
  MAP_SURFACE_VISUAL_KIND,
  mapChunkSceneItem,
  type MapChunkVisualParams,
} from "./map-chunk-scene-item.ts";
import {
  MAP_SURFACE_PICK_LAYER_ID,
  MAP_SURFACE_PICK_VISUAL_KIND,
  mapSurfacePickSceneItem,
  mapSurfacePickSceneItemId,
  type MapSurfacePickData,
  type MapSurfacePickVisualParams,
} from "./map-surface-pick-scene-item.ts";
import { clipPlaneForCameraHeight } from "./map-chunk-key.ts";
import { createMarkerTexture, createNodeHandleTexture } from "./marker-textures.ts";
import {
  NODE_HANDLE_LAYER_ID,
  NODE_HANDLE_VISUAL_KIND,
  nodeHandleSceneItem,
  nodeHandleSceneItemId,
  nodeHandleTransform,
  type NodeHandlePickData,
} from "./node-handle-scene-item.ts";
import {
  TOKEN_LAYER_ID,
  TOKEN_VISUAL_KIND,
  tokenSceneItem,
  tokenTransform,
  type TokenVisualParams,
} from "./token-scene-item.ts";

interface AttachedView {
  readonly view: View;
  readonly observer?: ResizeObserver;
  /** The framing the view was created with -- {@link Render3dSceneAdapter.attachCameraControls} starts orbiting from here. */
  readonly initialCamera: { readonly position: { x: number; y: number; z: number }; readonly target: { x: number; y: number; z: number } };
}

const INITIAL_VIEW_CAMERA = {
  fov: 38,
  near: 0.1,
  far: 200,
  position: { x: 6, y: 4.5, z: 7 },
  target: { x: 0, y: 0.8, z: 0 },
} as const;

// The engine ships no default lighting rig (`EngineOptions.lights`'s own
// doc comment). `"lit"`-material map surfaces (walls, terrain) need at
// least one light or they render solid black regardless of `color` --
// unlit visuals (tokens, node handles) are unaffected either way. One
// ambient light so no lit surface ever goes fully black, plus one
// directional light positioned above the scene (Y-up, per this app's own
// floor-cutaway clip plane convention) for shading definition.
const MAP_LIGHTS: readonly LightDescriptor[] = [
  { light: "ambient", color: 0xffffff, intensity: 0.55 },
  { light: "directional", color: 0xffffff, intensity: 0.85, direction: { x: 0.4, y: 1, z: 0.3 } },
];

/** Two triangles over a preview's 4 corner points -- the only topology a `"quad"` preview ever needs. */
const PREVIEW_QUAD_INDICES = Uint32Array.from([0, 1, 2, 0, 2, 3]);

function engineOrigin(origin: ChangeOrigin): EngineChangeOrigin {
  switch (origin) {
    case "local":
      return "local";
    case "network":
      return "remote";
    case "programmatic":
      return "engine";
  }
}

export class Render3dSceneAdapter implements SceneRenderPort {
  readonly #views = new Map<RenderViewId, AttachedView>();
  readonly #tokens = new Map<string, RenderToken>();
  readonly #nodeHandles = new Map<string, { readonly x: number; readonly y: number; readonly z: number }>();
  // Keyed by `${layer}:${scopeId}` (not scopeId alone) so a terrain chunk id
  // and a token id can never collide, even though both are caller-chosen
  // strings that share no coordination.
  readonly #consumedRevisions = new Map<string, number>();
  #engine?: RenderEngine;
  #runtimeGeneration = 0;
  #viewSequence = 0;
  #rendererCreates = 0;
  #rendererDisposes = 0;
  #confirmedTokenChanges = 0;
  #terrainUploads = 0;

  async start(runtimeGeneration: number): Promise<void> {
    if (this.#engine !== undefined) throw new Error("scene renderer is already started");

    const texture = createMarkerTexture();
    const handleTexture = createNodeHandleTexture();
    const registry = createVisualRegistry();
    registry.register<TokenVisualParams>({
      kind: TOKEN_VISUAL_KIND,
      describe: (params) => ({
        geometry: { shape: "sprite" },
        material: {
          surface: "unlit",
          color: params.color,
          texture,
        },
      }),
      equals: (left, right) => left.color === right.color,
    });
    registry.register<Record<string, never>>({
      kind: NODE_HANDLE_VISUAL_KIND,
      describe: () => ({
        geometry: { shape: "sprite" },
        material: { surface: "unlit", color: 0xffffff, texture: handleTexture },
      }),
      equals: () => true,
    });
    registry.register<MapChunkVisualParams>({
      kind: MAP_SURFACE_VISUAL_KIND,
      describe: (params) => ({
        geometry: { shape: "mesh", data: params.mesh },
        material: { surface: "lit", color: params.color, clippable: true, doubleSided: true },
      }),
      // Reference-equality on the mesh buffers, like render-3d's own
      // `heightfieldVisual` -- an unchanged chunk costs nothing per frame,
      // and a new buffer is the caller's signal that the geometry changed.
      equals: (left, right) => left.mesh === right.mesh && left.color === right.color,
    });
    registry.register<MapSurfacePickVisualParams>({
      kind: MAP_SURFACE_PICK_VISUAL_KIND,
      describe: (params) => ({
        geometry: { shape: "mesh", data: params.mesh },
        material: { surface: "unlit", color: 0xffffff, opacity: 0, doubleSided: true },
      }),
      equals: (left, right) => left.mesh === right.mesh,
    });
    registry.register(gridVisual);
    registry.register<Record<string, never>>({
      kind: CONSTRUCTION_GROUND_VISUAL_KIND,
      describe: () => ({
        geometry: { shape: "plane", width: CONSTRUCTION_GRID_EXTENT * 2, depth: CONSTRUCTION_GRID_EXTENT * 2 },
        // Fully transparent -- this plane exists only to give `pick()`
        // something to hit over empty ground, never to be seen. The visible
        // grid lines (`gridVisual`, above) are the only thing drawn there.
        material: { surface: "unlit", color: 0x000000, opacity: 0 },
      }),
      equals: () => true,
    });
    registry.register<ConstructionPreviewVisualParams>({
      kind: CONSTRUCTION_PREVIEW_VISUAL_KIND,
      describe: (params) =>
        params.filled
          ? {
              geometry: { shape: "mesh", data: { positions: params.positions, indices: params.indices ?? PREVIEW_QUAD_INDICES } },
              material: {
                surface: "unlit",
                color: params.color,
                opacity: params.opacity,
                doubleSided: true,
                depthTest: false,
                depthWrite: false,
              },
              pickable: false,
            }
          : {
              geometry: { shape: "segments", positions: params.positions },
              material: {
                surface: "line",
                color: params.color,
                opacity: params.opacity,
                depthTest: false,
                depthWrite: false,
              },
              pickable: false,
            },
      equals: (left, right) =>
        left.positions === right.positions &&
        left.indices === right.indices &&
        left.color === right.color &&
        left.opacity === right.opacity &&
        left.filled === right.filled,
    });

    const engine = createEngine({ registry, autoplay: true, lights: MAP_LIGHTS });
    // The invisible ground plane draws first of all (order 0) -- it is
    // deliberately pickable (default), unlike the grid lines above it, so
    // `pick()` resolves a real point over empty ground and a construction
    // tool can start generating geometry there, not only extend geometry
    // that already exists. The board grid draws next (order 5), below map
    // geometry below node handles below tokens (10 / 15 / 20), so nothing
    // occludes the thing a pointer is more likely trying to hit -- the grid
    // itself is never pickable, so it can never intercept a click meant for
    // the geometry (or the ground plane) beneath it. The active tool preview
    // draws last (25), above tokens, so a ghost is never hidden behind real
    // geometry -- also never pickable, for the same reason the grid isn't.
    engine.scene.defineLayer({ id: CONSTRUCTION_GROUND_LAYER_ID, order: 0 }, "engine");
    engine.scene.defineLayer({ id: CONSTRUCTION_GRID_LAYER_ID, order: 5, pickable: false }, "engine");
    engine.scene.defineLayer({ id: MAP_LAYER_ID, order: 10, pickable: false }, "engine");
    engine.scene.defineLayer({ id: MAP_SURFACE_PICK_LAYER_ID, order: 11 }, "engine");
    engine.scene.defineLayer({ id: NODE_HANDLE_LAYER_ID, order: 15 }, "engine");
    engine.scene.defineLayer({ id: TOKEN_LAYER_ID, order: 20 }, "engine");
    engine.scene.defineLayer({ id: CONSTRUCTION_PREVIEW_LAYER_ID, order: 25, pickable: false }, "engine");
    engine.start();
    // The board is present from the first frame, independent of any
    // generated construction geometry -- matching the persistent build-grid
    // every reference surveyed in `vtt-board-construction-mode-ui-references.md`
    // renders before anything is built on it.
    engine.scene.put(constructionGroundSceneItem(), "engine");
    for (const item of constructionGridSceneItems()) engine.scene.put(item, "engine");

    this.#runtimeGeneration = runtimeGeneration;
    this.#engine = engine;
    this.#rendererCreates += 1;
  }

  attachView(target: HTMLElement): RenderViewId {
    const engine = this.#requireEngine();
    const id = `tabletop-view-${++this.#viewSequence}`;
    const view = engine.createView({
      id,
      target,
      camera: {
        projection: "perspective",
        fov: INITIAL_VIEW_CAMERA.fov,
        position: INITIAL_VIEW_CAMERA.position,
        target: INITIAL_VIEW_CAMERA.target,
        near: INITIAL_VIEW_CAMERA.near,
        far: INITIAL_VIEW_CAMERA.far,
      },
      layers: [
        CONSTRUCTION_GROUND_LAYER_ID,
        CONSTRUCTION_GRID_LAYER_ID,
        MAP_LAYER_ID,
        MAP_SURFACE_PICK_LAYER_ID,
        NODE_HANDLE_LAYER_ID,
        TOKEN_LAYER_ID,
        CONSTRUCTION_PREVIEW_LAYER_ID,
      ],
      background: 0x07100f,
    });

    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(([entry]) => {
            if (entry === undefined) return;
            this.resizeView(id, entry.contentRect.width, entry.contentRect.height);
          });
    observer?.observe(target);
    this.#views.set(id, {
      view,
      observer,
      initialCamera: { position: INITIAL_VIEW_CAMERA.position, target: INITIAL_VIEW_CAMERA.target },
    });
    return id;
  }

  detachView(viewId: RenderViewId): void {
    const attached = this.#views.get(viewId);
    if (attached === undefined) return;
    attached.observer?.disconnect();
    attached.view.dispose();
    this.#views.delete(viewId);
  }

  resizeView(viewId: RenderViewId, width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
      throw new Error("view dimensions must be finite and non-negative");
    }
    const attached = this.#views.get(viewId);
    if (attached === undefined) throw new Error(`unknown render view "${viewId}"`);
    if (width === 0 || height === 0) {
      attached.view.setActive(false);
      return;
    }
    attached.view.resize(width, height);
    attached.view.setActive(true);
  }

  applyConfirmed(change: ConfirmedRenderChange): void {
    if (change.runtimeGeneration !== this.#runtimeGeneration) return;
    const revisionKey = `${change.dependency.layer}:${change.dependency.scopeId}`;
    const previousRevision = this.#consumedRevisions.get(revisionKey);
    if (previousRevision !== undefined && change.dependency.revision <= previousRevision) return;

    const engine = this.#requireEngine();
    const origin = engineOrigin(change.origin);

    if (change.type === "token-removed") {
      engine.scene.remove(`token:${change.tokenId}`, origin);
      this.#tokens.delete(change.tokenId);
    } else if (change.type === "token-upserted") {
      const previous = this.#tokens.get(change.token.id);
      if (previous === undefined) {
        engine.scene.put(tokenSceneItem(change.token), origin);
      } else {
        if (previous.appearance.color !== change.token.appearance.color) {
          engine.scene.setVisualParams(
            `token:${change.token.id}`,
            { color: change.token.appearance.color } satisfies TokenVisualParams,
            origin,
          );
        }
        if (
          previous.position.x !== change.token.position.x ||
          previous.position.y !== change.token.position.y ||
          previous.position.z !== change.token.position.z ||
          previous.appearance.size !== change.token.appearance.size
        ) {
          engine.scene.setTransform(
            `token:${change.token.id}`,
            tokenTransform(change.token),
            origin,
          );
        }
      }
      this.#tokens.set(change.token.id, change.token);
      this.#confirmedTokenChanges += 1;
    } else if (change.type === "node-handle-removed") {
      engine.scene.remove(nodeHandleSceneItemId(change.nodeId), origin);
      this.#nodeHandles.delete(change.nodeId);
    } else if (change.type === "node-handle-upserted") {
      const previous = this.#nodeHandles.get(change.handle.nodeId);
      if (previous === undefined) {
        engine.scene.put(nodeHandleSceneItem(change.handle.nodeId, change.handle.position), origin);
      } else if (
        previous.x !== change.handle.position.x ||
        previous.y !== change.handle.position.y ||
        previous.z !== change.handle.position.z
      ) {
        engine.scene.setTransform(
          nodeHandleSceneItemId(change.handle.nodeId),
          nodeHandleTransform(change.handle.position),
          origin,
        );
      }
      this.#nodeHandles.set(change.handle.nodeId, change.handle.position);
    } else if (change.type === "surface-pick-target-removed") {
      engine.scene.remove(mapSurfacePickSceneItemId(change.surfaceRef), origin);
    } else if (change.type === "surface-pick-target-upserted") {
      engine.scene.put(mapSurfacePickSceneItem(change.target.surfaceRef, change.target.mesh), origin);
    } else if (change.type === "map-chunk-removed") {
      engine.scene.remove(`map-chunk:${change.chunkId}`, origin);
    } else {
      // `put` on an existing id is a full replace, but the visual kind's own
      // `equals` (registered in `start`) still gates whether the backend
      // actually rebuilds anything -- an unchanged chunk's mesh reference
      // means this is a no-op cost-wise, same as an unchanged token.
      engine.scene.put(mapChunkSceneItem(change.chunk), origin);
      this.#terrainUploads += 1;
    }

    this.#consumedRevisions.set(revisionKey, change.dependency.revision);
  }

  pick(viewId: RenderViewId, x: number, y: number): ScenePickResult | undefined {
    const attached = this.#views.get(viewId);
    if (attached === undefined) throw new Error(`unknown render view "${viewId}"`);

    const result = attached.view.pick(x, y);
    if (result === undefined) return undefined;

    const data = result.data as Partial<NodeHandlePickData> | Partial<MapSurfacePickData> | undefined;
    const nodeId =
      data?.entity === "construction-node-handle" && typeof data.nodeId === "string"
        ? data.nodeId
        : undefined;
    const surfaceRef =
      data?.entity === "map-surface-pick" && typeof data.surfaceRef === "string"
        ? data.surfaceRef
        : undefined;
    return { point: result.point, nodeId, surfaceRef };
  }

  showPreview(descriptor: RenderPreviewDescriptor): void {
    const engine = this.#requireEngine();
    // `put` on the fixed preview id always replaces whatever was there --
    // there is only ever one active tool preview, never a growing set.
    engine.scene.put(constructionPreviewSceneItem(descriptor), "engine");
  }

  clearPreview(): void {
    const engine = this.#requireEngine();
    // Safe no-op when nothing is currently shown (`scene.remove` on an
    // unknown id just returns `false`).
    engine.scene.remove(CONSTRUCTION_PREVIEW_ITEM_ID, "engine");
  }

  attachCameraControls(
    viewId: RenderViewId,
    element: HTMLElement,
    options: CameraControlOptions = {},
  ): CameraControlHandle {
    const attached = this.#views.get(viewId);
    if (attached === undefined) throw new Error(`unknown render view "${viewId}"`);

    const initial = orbitFromCamera(attached.initialCamera.position, attached.initialCamera.target);
    const dispose = attachOrbit(element, attached.view, initial, {
      fov: INITIAL_VIEW_CAMERA.fov,
      near: INITIAL_VIEW_CAMERA.near,
      far: INITIAL_VIEW_CAMERA.far,
      orbitButton: options.orbitButton,
      panButton: options.panButton,
      pivot: options.pivot,
      resolvePivot:
        options.pivot === "cursor"
          ? (clientX, clientY) => {
              const rect = element.getBoundingClientRect();
              return this.pick(viewId, clientX - rect.left, clientY - rect.top)?.point;
            }
          : undefined,
    });
    return { dispose };
  }

  setFloorClipHeight(height: number | undefined): void {
    const engine = this.#requireEngine();
    const plane: ClipPlaneDescriptor | undefined =
      height === undefined ? undefined : clipPlaneForCameraHeight(height);
    engine.setClipPlane(plane);
  }

  getMetrics(): SceneRenderMetrics {
    return Object.freeze({
      rendererCreates: this.#rendererCreates,
      rendererDisposes: this.#rendererDisposes,
      attachedViews: this.#views.size,
      confirmedTokenChanges: this.#confirmedTokenChanges,
      terrainUploads: this.#terrainUploads,
    });
  }

  async dispose(): Promise<void> {
    if (this.#engine === undefined) return;
    for (const viewId of [...this.#views.keys()]) this.detachView(viewId);
    this.#engine.dispose();
    this.#engine = undefined;
    this.#runtimeGeneration = 0;
    this.#tokens.clear();
    this.#nodeHandles.clear();
    this.#consumedRevisions.clear();
    this.#rendererDisposes += 1;
  }

  #requireEngine(): RenderEngine {
    if (this.#engine === undefined) throw new Error("scene renderer is not started");
    return this.#engine;
  }
}

export function createRender3dSceneAdapter(): SceneRenderPort {
  return new Render3dSceneAdapter();
}
