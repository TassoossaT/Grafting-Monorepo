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
import type { RenderPointManipulator } from "../../ports/scene-render-port.ts";

import type {
  CameraControlHandle,
  CameraControlOptions,
  ChangeOrigin,
  ConfirmedRenderChange,
  RenderPreviewDescriptor,
  RenderPreviewLabel,
  RenderToken,
  RenderViewId,
  ScenePickResult,
  SceneRenderMetrics,
  SceneRenderPort,
} from "@/ports";

import {
  DEFAULT_PREVIEW_CHANNEL,
  constructionPreviewSceneItemId,
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
import { createAddHandleTexture, createDeleteHandleTexture, createHeightHandleTexture, createMarkerTexture, createMidpointHandleTexture, createMoveHandleTexture, createNodeHandleTexture, createRotateHandleTexture, createTurnsHandleTexture, createLinkHandleTexture, createRadiusHandleTexture, createTiltHandleTexture, createSideHandleTexture, createCornerHandleTexture, createUnlinkHandleTexture, createRulerLabelTexture } from "./marker-textures.ts";
import { RULER_LABEL_VISUAL_KIND, rulerLabelSceneItem, rulerLabelSceneItemId, type RulerLabelVisualParams } from "./ruler-label-scene-item.ts";
import {
  HANDLE_SCALE,
  NODE_HANDLE_LAYER_ID,
  NODE_HANDLE_VISUAL_KIND,
  nodeHandleSceneItem,
  nodeHandleSceneItemId,
  nodeHandleMeshSceneItem,
  nodeHandleMeshSceneItemId,
  nodeHandleTransform,
  type NodeHandlePickData,
  type NodeHandleVisualParams,
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

/** The camera's vertical field of view, in degrees -- fixed: orbiting and zooming move the camera, never the lens. */
export const VIEW_FOV_DEGREES = 38;

const INITIAL_VIEW_CAMERA = {
  fov: VIEW_FOV_DEGREES,
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

/**
 * A `"points"` preview's dot size, in world units. A point is scaled by the
 * screen's half height where a sprite is scaled by the view's half height in
 * world units, so a point handle's size over the tangent of half the field of
 * view draws the same dot on screen.
 */
const PREVIEW_POINT_SIZE = HANDLE_SCALE / Math.tan((VIEW_FOV_DEGREES * Math.PI) / 360);

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
  /** The glyph each handle is drawn with: a changed one is re-put, not moved. */
  readonly #nodeHandleGlyphs = new Map<string, import("@/ports").RenderHandleGlyph>();
  readonly #meshHandles = new Set<string>();
  /** Which preview channels currently have something on them, so an unnamed clear can empty them all. */
  readonly #previewChannels = new Set<string>();
  /** How many labels each preview channel has put up, so a shorter set takes the surplus down. */
  readonly #labelCounts = new Map<string, number>();
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
    const glyphTextures = {
      point: handleTexture,
      add: createAddHandleTexture(),
      midpoint: createMidpointHandleTexture(),
      move: createMoveHandleTexture(),
      rotate: createRotateHandleTexture(),
      height: createHeightHandleTexture(),
      turns: createTurnsHandleTexture(),
      link: createLinkHandleTexture(),
      radius: createRadiusHandleTexture(),
      tilt: createTiltHandleTexture(),
      side: createSideHandleTexture(),
      corner: createCornerHandleTexture(),
      unlink: createUnlinkHandleTexture(),
      delete: createDeleteHandleTexture(),
    } as const;
    registry.register<NodeHandleVisualParams>({
      kind: NODE_HANDLE_VISUAL_KIND,
      describe: (params) => params.mesh ? {
        geometry: { shape: "mesh", data: params.mesh },
        material: { surface: "unlit", color: params.emphasized ? 0xfff3ce : 0xffc878, opacity: params.emphasized ? 1 : 0.9, doubleSided: true, depthWrite: false, clippable: true },
        pickable: true,
      } : {
        geometry: { shape: "sprite" },
        material: { surface: "unlit", color: 0xffffff, texture: glyphTextures[params.glyph], clippable: true },
      },
      equals: (left, right) => left.glyph === right.glyph && left.mesh === right.mesh && left.emphasized === right.emphasized,
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
        // `depthWrite: false` is load-bearing, not tidiness. `opacity: 0` only
        // stops the proxy being *seen*; the renderer still defaults
        // `depthWrite` to true, so it would keep writing depth and occlude
        // whatever is behind it. That was harmless while every surface also
        // drew a visible chunk in the same place -- but a surface covered by
        // `none` draws nothing, and the proxy would then hide the geometry
        // behind an opening. That is precisely the see-through the `none`
        // covering exists to provide, defeated by an object nobody can see.
        material: {
          surface: "unlit",
          color: 0xffffff,
          opacity: 0,
          doubleSided: true,
          depthWrite: false,
          // Cut with the surface it stands for, so a surface the height cut
          // hides cannot be picked through the cut.
          clippable: true,
        },
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
    // A texture per text, kept: the same few numbers come round again and again.
    const labelTextures = new Map<string, HTMLCanvasElement>();
    registry.register<RulerLabelVisualParams>({
      kind: RULER_LABEL_VISUAL_KIND,
      describe: (params) => {
        let texture = labelTextures.get(params.text);
        if (texture === undefined) {
          if (labelTextures.size >= 256) labelTextures.clear();
          texture = createRulerLabelTexture(params.text);
          labelTextures.set(params.text, texture);
        }
        return {
          geometry: { shape: "sprite" },
          // On top of everything, like the ruler's own lines; never pickable.
          material: { surface: "unlit", color: 0xffffff, texture, depthTest: false, depthWrite: false },
          pickable: false,
        };
      },
      equals: (left, right) => left.text === right.text,
    });
    registry.register<ConstructionPreviewVisualParams>({
      kind: CONSTRUCTION_PREVIEW_VISUAL_KIND,
      describe: (params) => {
        switch (params.shape) {
          case "faces":
            return {
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
            };
          case "lines":
            return {
              geometry: { shape: "segments", positions: params.positions },
              material: {
                surface: "line",
                color: params.color,
                opacity: params.opacity,
                depthTest: false,
                depthWrite: false,
              },
              pickable: false,
            };
          case "points":
            // The node handle's own round dot, but drawn by the hundreds in one
            // object, and hidden behind what stands in front of it as a handle is.
            return {
              geometry: { shape: "segments", positions: params.positions },
              material: {
                surface: "points",
                color: params.color,
                opacity: params.opacity,
                size: PREVIEW_POINT_SIZE,
                sizeAttenuation: true,
                texture: handleTexture,
                depthWrite: false,
              },
              pickable: false,
            };
        }
      },
      equals: (left, right) =>
        left.positions === right.positions &&
        left.indices === right.indices &&
        left.color === right.color &&
        left.opacity === right.opacity &&
        left.shape === right.shape,
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
      engine.scene.remove(nodeHandleMeshSceneItemId(change.nodeId), origin);
      this.#nodeHandles.delete(change.nodeId);
      this.#nodeHandleGlyphs.delete(change.nodeId);
      this.#meshHandles.delete(change.nodeId);
    } else if (change.type === "node-handle-upserted") {
      const previous = this.#nodeHandles.get(change.handle.nodeId);
      const glyph = change.handle.glyph ?? "point";
      if (previous === undefined || this.#nodeHandleGlyphs.get(change.handle.nodeId) !== glyph) {
        engine.scene.put(nodeHandleSceneItem(change.handle.nodeId, change.handle.position, glyph), origin);
        this.#nodeHandleGlyphs.set(change.handle.nodeId, glyph);
      } else if (
        previous.x !== change.handle.position.x ||
        previous.y !== change.handle.position.y ||
        previous.z !== change.handle.position.z
      ) {
        engine.scene.setTransform(
          nodeHandleSceneItemId(change.handle.nodeId),
          nodeHandleTransform(change.handle.position, glyph),
          origin,
        );
      }
      if (change.handle.mesh) {
        engine.scene.put(nodeHandleMeshSceneItem(change.handle.nodeId, change.handle.position, glyph, change.handle.mesh, change.handle.emphasized), origin);
        this.#meshHandles.add(change.handle.nodeId);
      } else if (this.#meshHandles.delete(change.handle.nodeId)) {
        engine.scene.remove(nodeHandleMeshSceneItemId(change.handle.nodeId), origin);
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
    return { point: result.point, nodeId, surfaceRef, ...(result.ray ? { ray: result.ray } : {}), ...(result.forward ? { forward: result.forward } : {}) };
  }

  showPreview(descriptor: RenderPreviewDescriptor, channel = DEFAULT_PREVIEW_CHANNEL): void {
    const engine = this.#requireEngine();

    // `put` on a channel's own id always replaces whatever that channel had.
    // Channels never collide, so a diagnostic overlay and a tool ghost coexist
    // without either knowing about the other.
    engine.scene.put(constructionPreviewSceneItem(descriptor, channel), "engine");
    this.#previewChannels.add(channel);
  }

  showLabels(labels: readonly RenderPreviewLabel[], channel: string): void {
    const engine = this.#requireEngine();
    // Each number is an item of its own, on the channel's ids: a set shorter than the last takes the surplus down.
    labels.forEach((label, index) => engine.scene.put(rulerLabelSceneItem(label, index, channel), "engine"));
    for (let index = labels.length; index < (this.#labelCounts.get(channel) ?? 0); index += 1) engine.scene.remove(rulerLabelSceneItemId(channel, index), "engine");
    this.#labelCounts.set(channel, labels.length);
    this.#previewChannels.add(channel);
  }

  setPointManipulator(viewId: RenderViewId, target: RenderPointManipulator | undefined): void {
    this.#views.get(viewId)?.view.setPointManipulator(target ? { ...target, axes: ["x", "y", "z"], size: 1 } : undefined);
  }

  clearPreview(channel?: string): void {
    const engine = this.#requireEngine();
    // Safe no-op when nothing is currently shown (`scene.remove` on an
    // unknown id just returns `false`).
    const channels = channel === undefined ? [...this.#previewChannels] : [channel];
    for (const name of channels) {
      engine.scene.remove(constructionPreviewSceneItemId(name), "engine");
      for (let index = 0; index < (this.#labelCounts.get(name) ?? 0); index += 1) engine.scene.remove(rulerLabelSceneItemId(name, index), "engine");
      this.#labelCounts.delete(name);
      this.#previewChannels.delete(name);
    }
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
    this.#nodeHandleGlyphs.clear();
    this.#meshHandles.clear();
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
