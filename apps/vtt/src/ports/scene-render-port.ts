export type ChangeOrigin = "local" | "network" | "programmatic";
export type RenderViewId = string;
export type RenderLayerKey = "tokens" | "terrain" | "handles";

export interface RenderDependencyRevision {
  readonly layer: RenderLayerKey;
  readonly scopeId: string;
  readonly revision: number;
}

export interface RenderToken {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly appearance: {
    readonly label: string;
    readonly color: number;
    readonly size: number;
  };
}

export type ConfirmedTokenRenderChange =
  | {
      readonly type: "token-upserted";
      readonly origin: ChangeOrigin;
      readonly causeId: string;
      readonly runtimeGeneration: number;
      readonly dependency: RenderDependencyRevision;
      readonly token: RenderToken;
    }
  | {
      readonly type: "token-removed";
      readonly origin: ChangeOrigin;
      readonly causeId: string;
      readonly runtimeGeneration: number;
      readonly dependency: RenderDependencyRevision;
      readonly tokenId: string;
    };

/**
 * Packed vertex data for one piece of map geometry. Defined locally rather
 * than imported from `@grafting/render-3d`, matching how {@link RenderToken}
 * already keeps this port renderer-agnostic.
 */
export interface RenderMeshData {
  readonly positions: Float32Array;
  readonly normals?: Float32Array;
  readonly uvs?: Float32Array;
  readonly indices?: Uint16Array | Uint32Array;
}

/**
 * One spatially-bucketed unit of map geometry. `surfaceType`/`physical` echo
 * `grafting-procgen-construction-wasm`'s `Surface` fields directly -- this
 * port does not invent its own classification vocabulary.
 */
export interface RenderMapChunk {
  readonly chunkId: string;
  readonly surfaceType: string;
  readonly physical: boolean;
  readonly mesh: RenderMeshData;
}

export type ConfirmedMapChunkRenderChange =
  | {
      readonly type: "map-chunk-upserted";
      readonly origin: ChangeOrigin;
      readonly causeId: string;
      readonly runtimeGeneration: number;
      readonly dependency: RenderDependencyRevision;
      readonly chunk: RenderMapChunk;
    }
  | {
      readonly type: "map-chunk-removed";
      readonly origin: ChangeOrigin;
      readonly causeId: string;
      readonly runtimeGeneration: number;
      readonly dependency: RenderDependencyRevision;
      readonly chunkId: string;
    };

/** A construction node's live world position, rendered as a small pickable handle -- what edit-mode picking/drag-to-move hit-tests against. */
export interface RenderNodeHandle {
  readonly nodeId: string;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
}

export type ConfirmedNodeHandleRenderChange =
  | {
      readonly type: "node-handle-upserted";
      readonly origin: ChangeOrigin;
      readonly causeId: string;
      readonly runtimeGeneration: number;
      readonly dependency: RenderDependencyRevision;
      readonly handle: RenderNodeHandle;
    }
  | {
      readonly type: "node-handle-removed";
      readonly origin: ChangeOrigin;
      readonly causeId: string;
      readonly runtimeGeneration: number;
      readonly dependency: RenderDependencyRevision;
      readonly nodeId: string;
    };

export type ConfirmedRenderChange =
  | ConfirmedTokenRenderChange
  | ConfirmedMapChunkRenderChange
  | ConfirmedNodeHandleRenderChange;

/**
 * What a pointer position resolved to. `nodeId` is present only when the
 * pointer actually hit a node handle -- otherwise `point` alone (e.g. a hit
 * against map geometry) is still useful for continuing an in-progress drag
 * across the ground.
 */
export interface ScenePickResult {
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
  readonly nodeId?: string;
  readonly axis?: "y-height" | "xz-planar" | "all";
}

/**
 * A construction tool's not-yet-committed ghost, as plain geometry -- mirrors
 * `features/edit-construction`'s own `PreviewDescriptor` one-for-one, but
 * this port cannot import that layer (`ports` sits below `features` in
 * `VTT-ARCH-002`'s allowed-import graph), so the shape is repeated here
 * rather than shared. `"segments"` draws an open polyline; `"quad"` draws a
 * filled footprint as two triangles over 4 corner points.
 */
export type RenderPreviewDescriptor =
  | { readonly kind: "segments"; readonly positions: Float32Array; readonly color: number; readonly opacity?: number }
  | { readonly kind: "quad"; readonly positions: Float32Array; readonly color: number; readonly opacity?: number };

export interface SceneRenderMetrics {
  readonly rendererCreates: number;
  readonly rendererDisposes: number;
  readonly attachedViews: number;
  readonly confirmedTokenChanges: number;
  readonly terrainUploads: number;
}

/**
 * How a view's camera responds to dragging and scrolling. Mirrors
 * `@grafting/render-3d`'s `attachOrbit` options one-for-one in spirit but is
 * defined locally, like every other type in this port -- the render port
 * MUST NOT expose the concrete renderer package (`VTT-ARCH-002`).
 */
export interface CameraControlOptions {
  /**
   * Reserves one `PointerEvent.button` (0 = left, 1 = middle, 2 = right) for
   * orbit-drag. Leaving it unset lets any button orbit -- only correct for a
   * view with no competing left-button tool gesture on the same element.
   */
  readonly orbitButton?: number;
  /** Enables a lateral pan gesture, bound to this button, independent of `orbitButton`. */
  readonly panButton?: number;
  /**
   * `"cursor"` re-centers each orbit-drag on the point under the pointer,
   * resolved the same way {@link SceneRenderPort.pick} already resolves a
   * hit. `"center"` (the default) keeps orbiting around wherever the camera
   * is already looking.
   */
  readonly pivot?: "center" | "cursor";
}

/** Detaches the camera controls a call to {@link SceneRenderPort.attachCameraControls} started. */
export interface CameraControlHandle {
  dispose(): void;
}

export interface SceneRenderPort {
  start(runtimeGeneration: number): Promise<void>;
  attachView(target: HTMLElement): RenderViewId;
  detachView(viewId: RenderViewId): void;
  resizeView(viewId: RenderViewId, width: number, height: number): void;
  applyConfirmed(change: ConfirmedRenderChange): void;
  /** Sets the floor-cutaway height in continuous world-space Y. `undefined` disables cutaway. */
  setFloorClipHeight(height: number | undefined): void;
  /** Resolves a pointer position (in the view's CSS pixels) to what it hit, or `undefined` if it hit nothing. */
  pick(viewId: RenderViewId, x: number, y: number): ScenePickResult | undefined;
  /**
   * Shows (or replaces) the single active construction-tool preview. Never
   * touches the construction session -- purely visual, so a tool can call
   * this on every pointer move without paying for a real generate/mutate
   * request until the tool actually commits.
   */
  showPreview(descriptor: RenderPreviewDescriptor): void;
  /** Hides the active preview, if any. A no-op when nothing is shown. */
  clearPreview(): void;
  /**
   * Makes `element`'s drag/scroll gestures drive `viewId`'s camera, starting
   * from the framing that view was created with. Call once per view and hold
   * the returned handle for its lifetime, the same convention `attachView`
   * itself already follows -- calling this again on the same view resets to
   * that original framing rather than continuing from wherever the camera
   * currently is.
   */
  attachCameraControls(
    viewId: RenderViewId,
    element: HTMLElement,
    options?: CameraControlOptions,
  ): CameraControlHandle;
  getMetrics(): SceneRenderMetrics;
  dispose(): Promise<void>;
}
