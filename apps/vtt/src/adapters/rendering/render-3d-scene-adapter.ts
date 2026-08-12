import {
  createEngine,
  createVisualRegistry,
  type ChangeOrigin as EngineChangeOrigin,
  type ClipPlaneDescriptor,
  type RenderEngine,
  type View,
} from "@grafting/render-3d";

import type {
  ChangeOrigin,
  ConfirmedRenderChange,
  RenderToken,
  RenderViewId,
  ScenePickResult,
  SceneRenderMetrics,
  SceneRenderPort,
} from "@/ports";

import {
  MAP_LAYER_ID,
  MAP_SURFACE_VISUAL_KIND,
  mapChunkSceneItem,
  type MapChunkVisualParams,
} from "./map-chunk-scene-item.ts";
import { clipPlaneForCameraHeight } from "./map-chunk-key.ts";
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
}

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

function createMarkerTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("token marker texture needs a 2D canvas context");

  context.clearRect(0, 0, 128, 128);
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(64, 58, 47, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.72)";
  context.beginPath();
  context.moveTo(42, 95);
  context.lineTo(86, 95);
  context.lineTo(64, 123);
  context.closePath();
  context.fill();
  return canvas;
}

/** A small ring-dot, visually distinct from the token marker -- an editable construction-node handle, not a placed token. */
function createNodeHandleTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("node handle texture needs a 2D canvas context");

  context.clearRect(0, 0, 64, 64);
  context.strokeStyle = "#0b1a17";
  context.lineWidth = 4;
  context.fillStyle = "#f2c94c";
  context.beginPath();
  context.arc(32, 32, 22, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  return canvas;
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

    const engine = createEngine({ registry, autoplay: true });
    // Map geometry draws below node handles below tokens (10 / 15 / 20), so
    // nothing occludes the thing a pointer is more likely trying to hit.
    engine.scene.defineLayer({ id: MAP_LAYER_ID, order: 10 }, "engine");
    engine.scene.defineLayer({ id: NODE_HANDLE_LAYER_ID, order: 15 }, "engine");
    engine.scene.defineLayer({ id: TOKEN_LAYER_ID, order: 20 }, "engine");
    engine.start();

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
        fov: 38,
        position: { x: 6, y: 4.5, z: 7 },
        target: { x: 0, y: 0.8, z: 0 },
        near: 0.1,
        far: 200,
      },
      layers: [MAP_LAYER_ID, NODE_HANDLE_LAYER_ID, TOKEN_LAYER_ID],
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
    this.#views.set(id, { view, observer });
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

    const data = result.data as Partial<NodeHandlePickData> | undefined;
    const nodeId =
      data?.entity === "construction-node-handle" && typeof data.nodeId === "string"
        ? data.nodeId
        : undefined;
    return { point: result.point, nodeId };
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
