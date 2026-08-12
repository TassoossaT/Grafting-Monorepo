import {
  createEngine,
  createVisualRegistry,
  type ChangeOrigin as EngineChangeOrigin,
  type RenderEngine,
  type View,
} from "@grafting/render-3d";

import type {
  ChangeOrigin,
  ConfirmedTokenRenderChange,
  RenderToken,
  RenderViewId,
  SceneRenderMetrics,
  SceneRenderPort,
} from "@/ports";

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

export class Render3dSceneAdapter implements SceneRenderPort {
  readonly #views = new Map<RenderViewId, AttachedView>();
  readonly #tokens = new Map<string, RenderToken>();
  readonly #consumedRevisions = new Map<string, number>();
  #engine?: RenderEngine;
  #runtimeGeneration = 0;
  #viewSequence = 0;
  #rendererCreates = 0;
  #rendererDisposes = 0;
  #confirmedTokenChanges = 0;

  async start(runtimeGeneration: number): Promise<void> {
    if (this.#engine !== undefined) throw new Error("scene renderer is already started");

    const texture = createMarkerTexture();
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

    const engine = createEngine({ registry, autoplay: true });
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
      layers: [TOKEN_LAYER_ID],
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

  applyConfirmed(change: ConfirmedTokenRenderChange): void {
    if (change.runtimeGeneration !== this.#runtimeGeneration) return;
    const previousRevision = this.#consumedRevisions.get(change.dependency.scopeId);
    if (previousRevision !== undefined && change.dependency.revision <= previousRevision) return;

    const engine = this.#requireEngine();
    const origin = engineOrigin(change.origin);
    if (change.type === "token-removed") {
      engine.scene.remove(`token:${change.tokenId}`, origin);
      this.#tokens.delete(change.tokenId);
    } else {
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
    }

    this.#consumedRevisions.set(change.dependency.scopeId, change.dependency.revision);
    this.#confirmedTokenChanges += 1;
  }

  getMetrics(): SceneRenderMetrics {
    return Object.freeze({
      rendererCreates: this.#rendererCreates,
      rendererDisposes: this.#rendererDisposes,
      attachedViews: this.#views.size,
      confirmedTokenChanges: this.#confirmedTokenChanges,
      terrainUploads: 0,
    });
  }

  async dispose(): Promise<void> {
    if (this.#engine === undefined) return;
    for (const viewId of [...this.#views.keys()]) this.detachView(viewId);
    this.#engine.dispose();
    this.#engine = undefined;
    this.#runtimeGeneration = 0;
    this.#tokens.clear();
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
